import { JobState, type BatchJob, type JobError } from "@google/genai";
import { eq, inArray, notInArray } from "drizzle-orm";
import { db } from "@/db";
import { analyses, batches, transcripts, videos, type Batch, type Video } from "@/db/schema";
import { estimateBatchCostUsd, recordSpend, withSpendCap } from "@/lib/spend";
import { parseAnalysisResponse } from "./parse";
import { DEFAULT_MODEL, estimateCostUsd, isAnalysisModel, toCostString, type AnalysisModel } from "./pricing";
import { ANALYSIS_JSON_SCHEMA, ANALYSIS_SYSTEM_PROMPT, buildUserPrompt } from "./prompt";
import {
  gemini,
  insertAnalysis,
  MAX_OUTPUT_TOKENS,
  readUsage,
  responseText,
  THINKING_LEVEL,
} from "./run";

/**
 * Batch API path for the nightly poller (PLAN.md §1.2).
 *
 * The channel/playlist job is inherently asynchronous — nobody is waiting on
 * it — so accepting batch latency buys a flat 50% discount. This alone halves
 * the running cost, which is why the poller uses this path and the interactive
 * /api/analyze route does not.
 *
 * PLAN.md §5.O3 kept this path across the provider swap rather than losing it:
 * Gemini's Batch API is the same bargain — a 24-hour target turnaround for
 * exactly half price on input and output alike, confirmed against Google's
 * pricing page on 2026-08-29 — so the poller's economics did not change with
 * the provider.
 */

const CUSTOM_ID_PREFIX = "video-";

/** The request-metadata key carrying our own id — Gemini's `custom_id`. */
const CUSTOM_ID_KEY = "custom_id";

export type BatchSubmission = {
  batchId: string;
  videoIds: number[];
  estimatedUsd: number;
};

export type BatchOutcome = {
  succeeded: number;
  failed: number;
  expired: number;
  /** Entries skipped because a previous collection of this batch already wrote them (PR-32). */
  alreadyWritten: number;
  actualUsd: number;
};

/**
 * Build and submit a batch, refusing up front if it would breach the cap.
 *
 * The cap is checked against the whole batch before submission: once requests
 * are in flight there is no partial-cancel that gets you a partial refund, so
 * "check halfway through" is not a real option.
 */
export async function submitAnalysisBatch(
  videoList: Video[],
  options: { model?: AnalysisModel } = {},
): Promise<BatchSubmission | null> {
  const model = options.model ?? DEFAULT_MODEL;
  if (videoList.length === 0) return null;

  const rows = await db
    .select({ videoId: transcripts.videoId, content: transcripts.content, wordCount: transcripts.wordCount })
    .from(transcripts)
    .where(inArray(transcripts.videoId, videoList.map((v) => v.id)));

  const byVideoId = new Map(rows.map((r) => [r.videoId, r]));
  const usable = videoList.filter((v) => {
    const t = byVideoId.get(v.id);
    return t && t.content.trim().length > 0;
  });
  if (usable.length === 0) return null;

  const estimatedUsd = estimateBatchCostUsd(
    usable.map((v) => byVideoId.get(v.id)?.wordCount ?? 0),
    model,
    { batch: true },
  );

  // Held for the duration of submission, not just checked-then-forgotten: two
  // concurrent submitAnalysisBatch calls (poller + a manual backfill, say)
  // must not both pass the check before either's `batches` row exists (that
  // row is what committedUsd() reads from here on — see withSpendCap).
  return withSpendCap(estimatedUsd, async () => {
    // The batch path stays English-only, deliberately (PR-22b). prompt_version is
    // written at *collection* time, and a collecting run has no memory of what the
    // submitting run asked for — making the batch multilingual means storing the
    // language on `batches`, which is a schema change this PR is not approved to
    // make. Whoever adds the language UI adds that column with it.
    //
    // Inlined requests rather than a file: the whole batch travels in the create
    // call, which keeps this one round trip with no bucket to configure. The
    // tradeoff is a payload ceiling — a poll run assembles at most
    // findPendingVideos()'s page of transcripts, comfortably inside it, but a
    // much larger backfill would need the file path instead (KNOWN-ISSUES.md).
    const requests = usable.map((video) => {
      const transcript = byVideoId.get(video.id)!;
      return {
        model,
        metadata: { [CUSTOM_ID_KEY]: `${CUSTOM_ID_PREFIX}${video.id}` },
        contents: buildUserPrompt({
          title: video.title,
          channelTitle: video.channelTitle,
          durationSeconds: video.durationSeconds,
          transcript: transcript.content,
        }),
        config: {
          systemInstruction: ANALYSIS_SYSTEM_PROMPT,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          thinkingConfig: { thinkingLevel: THINKING_LEVEL },
          responseMimeType: "application/json",
          responseJsonSchema: ANALYSIS_JSON_SCHEMA,
        },
      };
    });

    const batch = await gemini().batches.create({ model, src: requests });

    // Record the id BEFORE returning, and never behind a caller's opt-in: the
    // window between "the provider has taken the job" and "this app knows the id"
    // is exactly the window in which a crash strands paid work.
    const providerBatchId = batch.name;
    if (!providerBatchId) {
      // Nothing to record and nothing to collect. Failing loudly here, with the
      // reservation still held, beats returning a submission whose id is
      // undefined and losing the batch silently.
      throw new Error("Gemini accepted the batch but returned no job name to track it by.");
    }

    await recordBatchSubmission({
      providerBatchId,
      model,
      videoCount: usable.length,
      estimatedUsd,
    });

    return { batchId: providerBatchId, videoIds: usable.map((v) => v.id), estimatedUsd };
  });
}

/**
 * Store a submitted batch. Safe to re-run — the unique index on
 * provider_batch_id turns a repeat into a no-op rather than a duplicate ledger
 * entry, which matters because this is called on a path that has already spent
 * money and must not throw.
 */
export async function recordBatchSubmission(input: {
  providerBatchId: string;
  model: AnalysisModel;
  videoCount: number;
  estimatedUsd: number;
}): Promise<void> {
  await db
    .insert(batches)
    .values({
      providerBatchId: input.providerBatchId,
      status: "in_progress",
      model: input.model,
      videoCount: input.videoCount,
      estimatedUsd: toCostString(input.estimatedUsd),
    })
    .onConflictDoUpdate({
      target: batches.providerBatchId,
      set: { providerBatchId: input.providerBatchId },
    });
}

/**
 * Every batch this app submitted and has not finished with.
 *
 * Terminal rows are excluded rather than filtered by age: the whole point of
 * the table is that a batch stranded by a multi-day outage is still found.
 */
export async function openBatches(): Promise<Batch[]> {
  return db
    .select()
    .from(batches)
    .where(notInArray(batches.status, ["collected", "canceled"]));
}

/**
 * How long an unreadable batch stays open before the poller gives up on it.
 *
 * The provider's own target turnaround for a batch is 24 hours; a row this app
 * cannot read for three days is not late, it is
 * gone — deleted server-side, or submitted against a key that no longer sees
 * it. Before PR-26 a stranded row cost one failed retrieve per run. Now it also
 * holds its estimate against the monthly cap forever, which eventually refuses
 * all work.
 */
export const STALE_BATCH_HOURS = 72;

/** Pure so the cutoff is testable without a clock or a database. */
export function isStaleBatch(
  submittedAt: Date,
  now: Date = new Date(),
  hours: number = STALE_BATCH_HOURS,
): boolean {
  return now.getTime() - submittedAt.getTime() >= hours * 3_600_000;
}

/**
 * Give up on a batch whose results can no longer be read.
 *
 * The estimate is written to `spend_log` on the way out rather than discarded.
 * A submitted batch was almost certainly charged by the provider, so dropping
 * the row from `committedUsd()` without billing it would quietly hand back
 * money that was really spent — the cap would forgive a real charge. Recording
 * before marking means a crash in between re-runs the record, which over-counts
 * rather than under-counts; that is the safe direction for a guard.
 */
export async function abandonStaleBatch(row: Batch): Promise<number> {
  const estimated = Number(row.estimatedUsd) || 0;
  await recordSpend(estimated);
  await markBatchStatus(row.providerBatchId, "canceled");
  return estimated;
}

export async function markBatchStatus(
  providerBatchId: string,
  status: Batch["status"],
): Promise<void> {
  await db
    .update(batches)
    .set({ status, ...(status === "collected" ? { collectedAt: new Date() } : {}) })
    .where(eq(batches.providerBatchId, providerBatchId));
}

/** The model a batch was submitted with, for pricing its results correctly. */
export async function batchModel(providerBatchId: string): Promise<AnalysisModel | null> {
  const [row] = await db
    .select({ model: batches.model })
    .from(batches)
    .where(eq(batches.providerBatchId, providerBatchId))
    .limit(1);
  return row && isAnalysisModel(row.model) ? row.model : null;
}

/**
 * Map the provider's job state onto ours.
 *
 * Only a job that reached SUCCEEDED has results to read, so that is the one
 * state this app calls collectable. Everything else — CANCELLING and PAUSED
 * included — is treated as still open: a job mid-cancel can still settle with
 * results, and calling it terminal early would drop rows that were already paid
 * for. A job that ends FAILED, CANCELLED or EXPIRED also stays open here and is
 * closed out by the stale-batch path instead, which bills the estimate on the
 * way (abandonStaleBatch) rather than forgiving a charge the provider very
 * likely made.
 */
export function mapProviderStatus(state: JobState | string | undefined): Batch["status"] {
  return state === JobState.JOB_STATE_SUCCEEDED ? "ended" : "in_progress";
}

/**
 * The human-readable reason a batch entry did not succeed.
 *
 * The status code is the point, not decoration: it is the actionable
 * discriminator (429 rate limit, 400 malformed request, 403 billing or
 * permission) and it is what tells a reader whether re-running the backfill has
 * any chance of a different answer. A message on its own reads much the same
 * for a transient failure and a permanent one — which was exactly the bug the
 * Anthropic version of this function was written to fix, and the reason it is
 * still a named function with its own tests rather than an inline template.
 */
export function batchFailureReason(error: JobError | undefined | null): string {
  const message = typeof error?.message === "string" ? error.message.trim() : "";
  const code = typeof error?.code === "number" ? String(error.code) : "unknown_error";
  return message ? `batch error: ${code}: ${message}` : `batch error: ${code}`;
}

export async function batchStatus(batchId: string): Promise<BatchJob> {
  return gemini().batches.get({ name: batchId });
}

/**
 * Wait for a batch to finish.
 *
 * Most batches complete within an hour; the API's own ceiling is 24. The
 * default timeout here is deliberately shorter than that — a cron-invoked
 * process should give up and let the next run collect the results rather than
 * hold a connection open for a day.
 */
export async function awaitBatch(
  batchId: string,
  options: { timeoutMs?: number; pollIntervalMs?: number; onPoll?: (s: string) => void } = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 30 * 60_000;
  const pollIntervalMs = options.pollIntervalMs ?? 30_000;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const batch = await batchStatus(batchId);
    options.onPoll?.(batch.state ?? "JOB_STATE_UNSPECIFIED");
    if (mapProviderStatus(batch.state) === "ended") return true;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
}

/**
 * Read a finished batch and write one analyses row per result.
 *
 * Everything is keyed by the id this app put in the request metadata, never by
 * position. Gemini documents inlined responses as coming back in submission
 * order, but a silent reordering would attach each analysis to the wrong video
 * and no later check would catch it — which is not a bet worth taking to save a
 * map lookup.
 */
export async function collectBatchResults(
  batchId: string,
  options: { model?: AnalysisModel } = {},
): Promise<BatchOutcome> {
  // Prefer the model the batch was actually submitted with; an explicit option
  // still wins, for collecting a batch submitted before this table existed.
  const model = options.model ?? (await batchModel(batchId)) ?? DEFAULT_MODEL;
  const outcome: BatchOutcome = {
    succeeded: 0,
    failed: 0,
    expired: 0,
    alreadyWritten: 0,
    actualUsd: 0,
  };

  /**
   * Videos this batch has already been collected for.
   *
   * Collection marks a batch `collected` only after writing everything, so a
   * crash partway leaves the row open and the next run streams the same results
   * again. `analyses` is append-only, so re-writing them inserts duplicate rows
   * — and, worse, `insertAnalysis` records spend, so the second pass charges the
   * monthly counter a second time for money that was spent once.
   *
   * Read once up front rather than checked per entry: a batch is up to a few
   * hundred videos, and this is one indexed query against N round trips.
   */
  const alreadyWritten = new Set(
    (
      await db
        .select({ videoId: analyses.videoId })
        .from(analyses)
        .where(eq(analyses.batchId, batchId))
    ).map((row) => row.videoId),
  );

  const job = await batchStatus(batchId);
  const entries = job.dest?.inlinedResponses ?? [];

  // A job that has not succeeded has nothing to read, and marking it collected
  // would close a row whose results are still coming (or still owed). Throwing
  // leaves it open for the next poll, which is what the caller's retry loop and
  // the stale-batch cutoff are both built around.
  if (entries.length === 0 && mapProviderStatus(job.state) !== "ended") {
    throw new Error(
      `Batch ${batchId} is not collectable yet (state: ${job.state ?? "unknown"}).`,
    );
  }
  if (entries.length === 0 && job.dest?.fileName) {
    throw new Error(
      `Batch ${batchId} returned its results as file ${job.dest.fileName}; this app only submits inlined requests.`,
    );
  }

  // Per-entry expiry is not a thing on Gemini the way it was on the Anthropic
  // batch API — a job expires as a whole — so the distinction is drawn from the
  // job's own state rather than from each result.
  const jobExpired = job.state === JobState.JOB_STATE_EXPIRED;

  for (const entry of entries) {
    const videoId = parseCustomId(entry.metadata?.[CUSTOM_ID_KEY]);
    if (videoId === null) continue;

    if (alreadyWritten.has(videoId)) {
      outcome.alreadyWritten += 1;
      continue;
    }

    if (entry.error || !entry.response) {
      // Record it so the backfill can see why this video has no analysis
      // instead of silently retrying forever.
      const reason = batchFailureReason(entry.error);
      await insertAnalysis({
        videoId,
        model,
        status: "failed",
        error: reason.slice(0, 1024),
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        costUsd: 0,
        batchId,
      });
      if (jobExpired) outcome.expired += 1;
      else outcome.failed += 1;
      continue;
    }

    const message = entry.response;
    const usage = readUsage(message);
    const costUsd = estimateCostUsd(model, usage, { batch: true });
    outcome.actualUsd += costUsd;

    const raw = responseText(message);

    const parsed = parseAnalysisResponse(raw);
    if (!parsed.ok) {
      await insertAnalysis({
        videoId,
        model,
        status: "failed",
        error: parsed.error.slice(0, 1024),
        rawResponse: raw,
        usage,
        costUsd,
        batchId,
      });
      outcome.failed += 1;
      continue;
    }

    await insertAnalysis({
      videoId,
      model,
      status: "ok",
      payload: parsed.payload,
      rawResponse: raw,
      usage,
      costUsd,
      batchId,
    });
    outcome.succeeded += 1;
  }

  // Terminal only after every row is written: a throw partway through leaves
  // the batch open, and the next run re-reads it. Re-collection is safe because
  // `analyses` is append-only and the duplicate is visible, whereas a batch
  // marked collected after a partial write loses rows silently.
  await markBatchStatus(batchId, "collected");

  return outcome;
}

function parseCustomId(customId: string | undefined): number | null {
  if (!customId?.startsWith(CUSTOM_ID_PREFIX)) return null;
  const id = Number(customId.slice(CUSTOM_ID_PREFIX.length));
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Look up the videos a batch covered, for reporting. */
export async function videosByIds(ids: number[]): Promise<Video[]> {
  if (ids.length === 0) return [];
  return db.select().from(videos).where(inArray(videos.id, ids));
}

export async function videoById(id: number): Promise<Video | null> {
  const [row] = await db.select().from(videos).where(eq(videos.id, id)).limit(1);
  return row ?? null;
}
