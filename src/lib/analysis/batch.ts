import type Anthropic from "@anthropic-ai/sdk";
import { eq, inArray, notInArray } from "drizzle-orm";
import { db } from "@/db";
import { analyses, batches, transcripts, videos, type Batch, type Video } from "@/db/schema";
import { assertWithinCap, estimateBatchCostUsd, recordSpend } from "@/lib/spend";
import { parseAnalysisResponse } from "./parse";
import { DEFAULT_MODEL, estimateCostUsd, isAnalysisModel, toCostString, type AnalysisModel } from "./pricing";
import { ANALYSIS_JSON_SCHEMA, ANALYSIS_SYSTEM_PROMPT, buildUserPrompt } from "./prompt";
import { anthropic, insertAnalysis, MAX_OUTPUT_TOKENS, readUsage } from "./run";

/**
 * Batch API path for the nightly poller (PLAN.md §1.2).
 *
 * The channel/playlist job is inherently asynchronous — nobody is waiting on
 * it — so accepting batch latency buys a flat 50% discount. This alone halves
 * the running cost, which is why the poller uses this path and the interactive
 * /api/analyze route does not.
 */

const CUSTOM_ID_PREFIX = "video-";

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

  // Throws SpendCapExceededError before a single request is sent.
  await assertWithinCap(estimatedUsd);

  // The batch path stays English-only, deliberately (PR-22b). prompt_version is
  // written at *collection* time, and a collecting run has no memory of what the
  // submitting run asked for — making the batch multilingual means storing the
  // language on `batches`, which is a schema change this PR is not approved to
  // make. Whoever adds the language UI adds that column with it.
  const requests = usable.map((video) => {
    const transcript = byVideoId.get(video.id)!;
    return {
      custom_id: `${CUSTOM_ID_PREFIX}${video.id}`,
      params: {
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: [
          {
            type: "text" as const,
            text: ANALYSIS_SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" as const },
          },
        ],
        output_config: { format: { type: "json_schema" as const, schema: ANALYSIS_JSON_SCHEMA } },
        messages: [
          {
            role: "user" as const,
            content: buildUserPrompt({
              title: video.title,
              channelTitle: video.channelTitle,
              durationSeconds: video.durationSeconds,
              transcript: transcript.content,
            }),
          },
        ],
      },
    };
  });

  const batch = await anthropic().messages.batches.create({ requests });

  // Record the id BEFORE returning, and never behind a caller's opt-in: the
  // window between "the provider has taken the job" and "this app knows the id"
  // is exactly the window in which a crash strands paid work.
  await recordBatchSubmission({
    providerBatchId: batch.id,
    model,
    videoCount: usable.length,
    estimatedUsd,
  });

  return { batchId: batch.id, videoIds: usable.map((v) => v.id), estimatedUsd };
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
 * The provider's own ceiling for a batch is 24 hours and results are retained
 * for 29 days; a row this app cannot read for three days is not late, it is
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
 * Map the provider's processing status onto ours.
 *
 * `canceling` is treated as still open: its results are readable once it
 * settles, and calling it terminal early would drop rows that were already
 * paid for.
 */
export function mapProviderStatus(
  processingStatus: Anthropic.Messages.MessageBatch["processing_status"],
): Batch["status"] {
  return processingStatus === "ended" ? "ended" : "in_progress";
}

/**
 * The human-readable reason a batch entry did not succeed.
 *
 * The nesting here is the whole point. `entry.result.error` is an
 * `ErrorResponse` envelope whose own `type` is the constant string `"error"` —
 * so the previous `entry.result.error.type` recorded the literal word "error"
 * for every single failure, which is indistinguishable from every other
 * failure. The actionable discriminator (`invalid_request_error`,
 * `rate_limit_error`, `billing_error`, …) and the message are one level
 * further in, at `error.error`.
 */
export function batchFailureReason(
  result: Exclude<Anthropic.Messages.MessageBatchIndividualResponse["result"], { type: "succeeded" }>,
): string {
  if (result.type !== "errored") return `batch ${result.type}`;
  const detail = result.error.error;
  const message = typeof detail?.message === "string" ? detail.message.trim() : "";
  const type = detail?.type ?? "unknown_error";
  return message ? `batch error: ${type}: ${message}` : `batch error: ${type}`;
}

export async function batchStatus(batchId: string): Promise<Anthropic.Messages.MessageBatch> {
  return anthropic().messages.batches.retrieve(batchId);
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
    options.onPoll?.(batch.processing_status);
    if (batch.processing_status === "ended") return true;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
}

/**
 * Read a finished batch and write one analyses row per result.
 *
 * Results arrive in arbitrary order, so everything is keyed by custom_id —
 * never by position. Getting this wrong would attach each analysis to the
 * wrong video, which no later check would catch.
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

  for await (const entry of await anthropic().messages.batches.results(batchId)) {
    const videoId = parseCustomId(entry.custom_id);
    if (videoId === null) continue;

    if (alreadyWritten.has(videoId)) {
      outcome.alreadyWritten += 1;
      continue;
    }

    if (entry.result.type !== "succeeded") {
      // errored / canceled / expired — record it so the backfill can see why
      // this video has no analysis instead of silently retrying forever.
      const reason = batchFailureReason(entry.result);
      await insertAnalysis({
        videoId,
        model,
        status: "failed",
        error: reason.slice(0, 1024),
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        costUsd: 0,
        batchId,
      });
      if (entry.result.type === "expired") outcome.expired += 1;
      else outcome.failed += 1;
      continue;
    }

    const message = entry.result.message;
    const usage = readUsage(message);
    const costUsd = estimateCostUsd(model, usage, { batch: true });
    outcome.actualUsd += costUsd;

    const raw = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

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

function parseCustomId(customId: string): number | null {
  if (!customId.startsWith(CUSTOM_ID_PREFIX)) return null;
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
