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

export type Rates = {
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

/**
 * Rates for the brand-ideation path (src/lib/anthropic.ts), which is not
 * limited to the two analysis models — it runs on ANTHROPIC_MODEL, defaulting
 * to Opus 5. Kept in the same file as MODEL_RATES for the reason stated at the
 * top: one place to be wrong about a price, not two.
 */
export const IDEATION_MODEL_RATES: Record<string, Rates> = {
  "claude-opus-5": { input: 5, output: 25, cacheMinimumTokens: 1024 },
  "claude-sonnet-5": { input: 3, output: 15, cacheMinimumTokens: 1024 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheMinimumTokens: 4096 },
};

/**
 * Rates for whatever ANTHROPIC_MODEL is set to.
 *
 * An unknown model bills at the most expensive rate on file rather than
 * throwing or guessing low: the cap is a guard, and over-estimating an unknown
 * model trips it early — the safe direction (the same reasoning as the Sonnet
 * introductory-rate comment above).
 */
export function ideationRates(model: string): Rates {
  return IDEATION_MODEL_RATES[model] ?? IDEATION_MODEL_RATES["claude-opus-5"];
}

/**
 * The server-side web search tool is billed per search on top of tokens:
 * $10 per 1,000 searches. `/api/generate` is the only caller — the analysis
 * pipeline does not search.
 */
export const WEB_SEARCH_USD_PER_REQUEST = 10 / 1000;

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
  return costUsdAtRates(MODEL_RATES[model], usage, options);
}

/** The same arithmetic, for a model whose rates are not in MODEL_RATES. */
export function costUsdAtRates(
  rates: Rates,
  usage: TokenUsage,
  options: { batch?: boolean } = {},
): number {
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
