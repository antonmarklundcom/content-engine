/**
 * Model rates and cost accounting (PLAN.md §1).
 *
 * Rates are USD per million tokens, first-party Anthropic API, as of Aug 2026.
 * Kept in one table because PR-07's hard spend cap is only as trustworthy as
 * this arithmetic — a wrong rate here silently under-reports every row and the
 * cap trips too late.
 */

export type AnalysisModel = "claude-haiku-4-5" | "claude-sonnet-5";

/**
 * PLAN.md §1: Haiku 4.5 is the default. Summarising a transcript against a
 * fixed template is not a reasoning-hard task, and the 4x cost difference
 * decides it. Sonnet is a per-video opt-in.
 */
export const DEFAULT_MODEL: AnalysisModel = "claude-haiku-4-5";

type Rates = {
  /** USD per million input tokens. */
  input: number;
  /** USD per million output tokens. */
  output: number;
  /** Minimum prefix length that will cache on this model, in tokens. */
  cacheMinimumTokens: number;
};

export const MODEL_RATES: Record<AnalysisModel, Rates> = {
  "claude-haiku-4-5": { input: 1, output: 5, cacheMinimumTokens: 4096 },
  // Sonnet 5 has an introductory $2/$10 rate through 2026-08-31. The standard
  // rate is used here deliberately: over-estimating spend makes the PR-07 cap
  // trip early, which is the safe direction to be wrong in.
  "claude-sonnet-5": { input: 3, output: 15, cacheMinimumTokens: 1024 },
};

/** Cache reads cost 0.1x base input; 5-minute cache writes cost 1.25x. */
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

/** Batch API is a flat 50% discount on everything (PLAN.md §1.2). */
export const BATCH_DISCOUNT = 0.5;

export type TokenUsage = {
  /** Tokens processed at full price — excludes both cache figures. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export function estimateCostUsd(
  model: AnalysisModel,
  usage: TokenUsage,
  options: { batch?: boolean } = {},
): number {
  const rates = MODEL_RATES[model];
  const perMillion =
    usage.inputTokens * rates.input +
    usage.cacheReadTokens * rates.input * CACHE_READ_MULTIPLIER +
    usage.cacheWriteTokens * rates.input * CACHE_WRITE_MULTIPLIER +
    usage.outputTokens * rates.output;

  const cost = perMillion / 1_000_000;
  return options.batch ? cost * BATCH_DISCOUNT : cost;
}

/** decimal(10,6) in the schema — round here so the stored value matches. */
export function toCostString(costUsd: number): string {
  return costUsd.toFixed(6);
}

export function isAnalysisModel(value: string): value is AnalysisModel {
  return value === "claude-haiku-4-5" || value === "claude-sonnet-5";
}
