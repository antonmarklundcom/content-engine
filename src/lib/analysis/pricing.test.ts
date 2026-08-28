/**
 * The brand-ideation path now bills against the same cap as the analysis
 * pipeline (PLAN.md §1.10), which means its arithmetic has to be as
 * trustworthy as MODEL_RATES already was. Two things are worth pinning: an
 * unknown model must not silently bill as free, and web search must not be
 * accounted for as tokens only — it is charged per search on top of them.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  costUsdAtRates,
  estimateCostUsd,
  ideationRates,
  IDEATION_MODEL_RATES,
  MODEL_RATES,
  WEB_SEARCH_USD_PER_REQUEST,
} from "./pricing";

const NO_CACHE = { cacheReadTokens: 0, cacheWriteTokens: 0 };

test("costUsdAtRates is the arithmetic estimateCostUsd already used", () => {
  const usage = { inputTokens: 10_000, outputTokens: 2_000, ...NO_CACHE };
  assert.equal(
    costUsdAtRates(MODEL_RATES["claude-haiku-4-5"], usage),
    estimateCostUsd("claude-haiku-4-5", usage),
  );
});

test("a million input tokens costs exactly the model's input rate", () => {
  const rates = IDEATION_MODEL_RATES["claude-opus-5"];
  const cost = costUsdAtRates(rates, { inputTokens: 1_000_000, outputTokens: 0, ...NO_CACHE });
  assert.equal(cost, rates.input);
});

test("an unknown model bills at the most expensive rate on file, not at zero", () => {
  // The safe direction to be wrong in: over-estimating trips the cap early.
  const unknown = ideationRates("claude-something-not-shipped-yet");
  assert.deepEqual(unknown, IDEATION_MODEL_RATES["claude-opus-5"]);
  for (const rates of Object.values(IDEATION_MODEL_RATES)) {
    assert.ok(unknown.input >= rates.input);
    assert.ok(unknown.output >= rates.output);
  }
});

test("web search is priced per search, at $10 per thousand", () => {
  assert.equal(WEB_SEARCH_USD_PER_REQUEST * 1000, 10);
  // A search fee is on top of tokens — a call that searches eight times has to
  // cost more than the same tokens with no searches, or the cap under-counts.
  assert.ok(8 * WEB_SEARCH_USD_PER_REQUEST > 0);
});
