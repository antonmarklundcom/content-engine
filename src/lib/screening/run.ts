import Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { analyses, screenings, transcripts, videos, type Video } from "@/db/schema";
import { anthropic, readUsage } from "@/lib/analysis/run";
import {
  DEFAULT_MODEL,
  estimateCostUsd,
  MODEL_RATES,
  toCostString,
  type AnalysisModel,
} from "@/lib/analysis/pricing";
import { assertWithinCap, recordSpend } from "@/lib/spend";
import { SCREENING_PROMPT_VERSION } from "./contract";
import { parseScreeningResponse } from "./parse";
import { screenInterests, screenMinScore } from "./policy";
import {
  buildScreeningPrompt,
  MAX_DESCRIPTION_CHARS,
  SCREENING_JSON_SCHEMA,
  SCREENING_SYSTEM_PROMPT,
} from "./prompt";

/**
 * [PR-35] Gallringen, step 1 — running the screen.
 *
 * Interactive calls, not the Batch API, and that is not an oversight. The
 * batch's 50% discount costs hours of latency, and the whole value of a
 * screening is that it happens *before* the batch is assembled in the same poll
 * run. A batched screen would need a second run to act on its own results, by
 * which time the videos it was meant to cull have already been submitted and
 * paid for at the full analysis price. Half of a twentieth is not worth a day.
 */

/** A screening answers with a number and a sentence; anything longer is a bug. */
export const MAX_SCREENING_OUTPUT_TOKENS = 400;

/** System prompt plus the metadata framing, in tokens. Measured against the prompt above. */
const SCREENING_OVERHEAD_TOKENS = 750;

/** Rough tokens-per-character for description text. Runs high, like every estimate here. */
const TOKENS_PER_CHAR = 0.3;

/** What the model actually returns is ~60; the estimate rounds up for the cap's sake. */
const ESTIMATED_OUTPUT_TOKENS = 120;

/**
 * How many screens to keep in flight.
 *
 * Four rather than one because a poll run screening 60 videos sequentially at
 * ~2s each would sit for two minutes before it started the work it exists to
 * do, and the cron route has a request timeout. Four rather than forty because
 * this shares an API key and a rate limit with the analysis path, and a burst
 * that 429s the batch submission would cost more than it saved.
 */
const SCREEN_CONCURRENCY = 4;

export function estimateScreeningCostUsd(
  descriptionChars: number,
  model: AnalysisModel = DEFAULT_MODEL,
): number {
  const rates = MODEL_RATES[model];
  const inputTokens =
    SCREENING_OVERHEAD_TOKENS +
    Math.ceil(Math.min(descriptionChars, MAX_DESCRIPTION_CHARS) * TOKENS_PER_CHAR);
  return (inputTokens * rates.input + ESTIMATED_OUTPUT_TOKENS * rates.output) / 1_000_000;
}

export function estimateScreeningBatchUsd(
  subjects: Array<{ description: string | null }>,
  model: AnalysisModel = DEFAULT_MODEL,
): number {
  return subjects.reduce(
    (sum, s) => sum + estimateScreeningCostUsd((s.description ?? "").length, model),
    0,
  );
}

export type ScreenResult =
  | { status: "ok"; videoId: number; score: number; reason: string; costUsd: number }
  | { status: "failed"; videoId: number; error: string; costUsd: number };

export type ScreenOptions = {
  model?: AnalysisModel;
  /** Overrides SCREEN_INTERESTS; pass "" to screen on substance alone. */
  interests?: string;
};

export async function screenVideo(video: Video, options: ScreenOptions = {}): Promise<ScreenResult> {
  const model = options.model ?? DEFAULT_MODEL;
  const interests = options.interests ?? screenInterests();

  let response: Anthropic.Message;
  try {
    response = await anthropic().messages.create({
      model,
      max_tokens: MAX_SCREENING_OUTPUT_TOKENS,
      // No cache_control here. The system prompt is ~700 tokens, far under
      // Haiku 4.5's 4096-token minimum cacheable prefix, so a breakpoint would
      // be a silent no-op — see PLAN.md §1.4's correction. Asking for caching
      // that cannot engage is how the analysis path ended up with a saving in
      // the budget that never arrived.
      system: SCREENING_SYSTEM_PROMPT,
      output_config: { format: { type: "json_schema", schema: SCREENING_JSON_SCHEMA } },
      messages: [
        {
          role: "user",
          content: buildScreeningPrompt(video, interests ? { interests } : {}),
        },
      ],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordScreening({
      videoId: video.id,
      model,
      status: "failed",
      error: `api error: ${message}`.slice(0, 1024),
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    });
    return { status: "failed", videoId: video.id, error: message, costUsd: 0 };
  }

  // Priced through the same function the analysis path uses, rather than by
  // multiplying two numbers here: the cap is only as trustworthy as this
  // arithmetic, and it should exist once (lib/analysis/pricing.ts).
  const usage = readUsage(response);
  const costUsd = estimateCostUsd(model, usage);
  const inputTokens = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  const outputTokens = usage.outputTokens;

  const raw = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const parsed = parseScreeningResponse(raw);
  if (!parsed.ok) {
    // A screening that hit the ceiling is a model that ignored "one sentence",
    // not malformed JSON — naming it saves reading a parse error that describes
    // the symptom.
    const error =
      response.stop_reason === "max_tokens"
        ? `response hit max_tokens (${MAX_SCREENING_OUTPUT_TOKENS}); output truncated`
        : parsed.error;
    await recordScreening({
      videoId: video.id,
      model,
      status: "failed",
      error: error.slice(0, 1024),
      rawResponse: raw,
      inputTokens,
      outputTokens,
      costUsd,
    });
    return { status: "failed", videoId: video.id, error, costUsd };
  }

  await recordScreening({
    videoId: video.id,
    model,
    status: "ok",
    score: parsed.payload.score,
    reason: parsed.payload.reason,
    inputTokens,
    outputTokens,
    costUsd,
  });

  return {
    status: "ok",
    videoId: video.id,
    score: parsed.payload.score,
    reason: parsed.payload.reason,
    costUsd,
  };
}

/**
 * Write the video's current screening, replacing any earlier one.
 *
 * An upsert on the unique video_id rather than an insert: re-screening is
 * expected (the prompt version moves, a description gets edited, the owner
 * writes a SCREEN_INTERESTS statement), and a second row would make "the
 * screening" ambiguous in every query that reads it.
 *
 * Spend is recorded from here for the same reason insertAnalysis does it: no
 * code path may charge the account without the monthly counter seeing it.
 */
async function recordScreening(input: {
  videoId: number;
  model: AnalysisModel;
  status: "ok" | "failed";
  score?: number;
  reason?: string;
  error?: string;
  rawResponse?: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}): Promise<void> {
  const values = {
    videoId: input.videoId,
    model: input.model,
    promptVersion: SCREENING_PROMPT_VERSION,
    status: input.status,
    score: input.score ?? null,
    reason: input.reason ?? null,
    error: input.error ?? null,
    rawResponse: input.rawResponse ?? null,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    costUsd: toCostString(input.costUsd),
  };

  await db
    .insert(screenings)
    .values(values)
    .onConflictDoUpdate({
      target: screenings.videoId,
      set: {
        model: values.model,
        promptVersion: values.promptVersion,
        status: values.status,
        score: values.score,
        reason: values.reason,
        error: values.error,
        rawResponse: values.rawResponse,
        inputTokens: values.inputTokens,
        outputTokens: values.outputTokens,
        costUsd: values.costUsd,
        createdAt: new Date(),
      },
    });

  await recordSpend(input.costUsd);
}

/**
 * Videos that would be analysed and have never been screened.
 *
 * The same "pending" definition as findPendingVideos — captioned, transcript
 * stored, no successful analysis — plus "no screening row". Screening anything
 * outside that set would be paying to triage work that is not queued: a video
 * with no captions is never analysed whatever a screening thinks of it.
 */
export async function findUnscreenedVideos(limit = 100): Promise<Video[]> {
  return findScreenableVideos(limit);
}

/**
 * The same set, optionally including videos that already carry a screening.
 *
 * `includeScreened` is how a prompt-version bump or a newly written
 * SCREEN_INTERESTS statement is applied to the corpus: every judgement is
 * re-made against the new prompt and the upsert replaces the old row. It is
 * never the poll run's path — an hourly cron that re-screened everything it had
 * already screened would pay for the same opinion forever.
 */
export async function findScreenableVideos(
  limit = 100,
  options: { includeScreened?: boolean } = {},
): Promise<Video[]> {
  return db
    .select()
    .from(videos)
    .where(
      and(
        eq(videos.captionStatus, "available"),
        sql`exists (select 1 from ${transcripts} where ${transcripts.videoId} = ${videos.id})`,
        sql`not exists (
          select 1 from ${analyses}
          where ${analyses.videoId} = ${videos.id} and ${analyses.status} = 'ok'
        )`,
        options.includeScreened
          ? undefined
          : sql`not exists (select 1 from ${screenings} s where s.video_id = ${videos.id})`,
      ),
    )
    .orderBy(desc(videos.publishedAt))
    .limit(limit);
}

export type ScreenRunResult = {
  screened: number;
  failed: number;
  culled: number;
  costUsd: number;
  minScore: number;
  results: ScreenResult[];
};

/**
 * Screen a set of videos, respecting the spend cap.
 *
 * The cap is checked once, for the whole set, before the first call — the same
 * shape as submitAnalysisBatch. Checking per video would let a run creep past
 * the cap by a screening at a time, and there is nothing useful to do with the
 * knowledge halfway through.
 */
export async function screenVideos(
  subjects: Video[],
  options: ScreenOptions & { onProgress?: (result: ScreenResult) => void } = {},
): Promise<ScreenRunResult> {
  const minScore = screenMinScore();
  const empty: ScreenRunResult = {
    screened: 0,
    failed: 0,
    culled: 0,
    costUsd: 0,
    minScore,
    results: [],
  };
  if (subjects.length === 0) return empty;

  const model = options.model ?? DEFAULT_MODEL;
  await assertWithinCap(estimateScreeningBatchUsd(subjects, model));

  const results: ScreenResult[] = new Array(subjects.length);
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= subjects.length) return;
      const result = await screenVideo(subjects[index]!, { ...options, model });
      results[index] = result;
      options.onProgress?.(result);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(SCREEN_CONCURRENCY, subjects.length) }, () => worker()),
  );

  return results.reduce<ScreenRunResult>(
    (acc, result) => ({
      ...acc,
      screened: acc.screened + (result.status === "ok" ? 1 : 0),
      failed: acc.failed + (result.status === "failed" ? 1 : 0),
      culled: acc.culled + (result.status === "ok" && result.score < minScore ? 1 : 0),
      costUsd: acc.costUsd + result.costUsd,
      results: [...acc.results, result],
    }),
    empty,
  );
}
