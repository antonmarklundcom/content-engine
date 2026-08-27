import assert from "node:assert/strict";
import { test } from "node:test";
import { batchFailureReason, isStaleBatch, mapProviderStatus, STALE_BATCH_HOURS } from "./batch";

/**
 * The regression these guard: `entry.result.error` is an ErrorResponse envelope
 * whose own `type` is the constant "error". Reading it recorded the literal
 * word "error" for every failure, so a billing failure and a malformed request
 * were indistinguishable in the analyses table.
 */

function errored(type: string, message: string) {
  return {
    type: "errored" as const,
    error: {
      type: "error" as const,
      request_id: "req_123",
      error: { type, message },
    },
  };
}

test("errored: reports the inner error type, not the 'error' envelope", () => {
  const reason = batchFailureReason(errored("invalid_request_error", "max_tokens too large") as never);
  assert.equal(reason, "batch error: invalid_request_error: max_tokens too large");
  assert.ok(!reason.includes("batch error: error"));
});

test("errored: distinguishes failures that used to collapse into one string", () => {
  const billing = batchFailureReason(errored("billing_error", "credit balance too low") as never);
  const rate = batchFailureReason(errored("rate_limit_error", "slow down") as never);
  assert.notEqual(billing, rate);
  assert.ok(billing.includes("billing_error"));
  assert.ok(rate.includes("rate_limit_error"));
});

test("errored: falls back to the type alone when the message is empty", () => {
  assert.equal(batchFailureReason(errored("api_error", "   ") as never), "batch error: api_error");
});

test("errored: survives an error object missing its inner detail", () => {
  const reason = batchFailureReason({
    type: "errored",
    error: { type: "error", request_id: null },
  } as never);
  assert.equal(reason, "batch error: unknown_error");
});

test("non-errored results keep their own outcome word", () => {
  assert.equal(batchFailureReason({ type: "expired" } as never), "batch expired");
  assert.equal(batchFailureReason({ type: "canceled" } as never), "batch canceled");
});

test("only 'ended' is collectable; canceling stays open so paid results are not dropped", () => {
  assert.equal(mapProviderStatus("ended"), "ended");
  assert.equal(mapProviderStatus("in_progress"), "in_progress");
  assert.equal(mapProviderStatus("canceling"), "in_progress");
});

/**
 * PR-27: an unreadable batch row used to be retried on every poll forever. Since
 * PR-26 it also holds its estimate against the monthly cap, so "harmless noise"
 * became "eventually refuses all work". The cutoff decides when to give up, and
 * being wrong in the early direction discards results that were paid for.
 */

const HOUR = 3_600_000;

test("a batch is not stale until the cutoff has fully elapsed", () => {
  const submitted = new Date("2026-08-01T00:00:00Z");
  const at = (hours: number) => new Date(submitted.getTime() + hours * HOUR);

  // The provider's own ceiling is 24 hours: a batch that is merely late must
  // stay open, because its results are still readable and already paid for.
  assert.equal(isStaleBatch(submitted, at(1)), false);
  assert.equal(isStaleBatch(submitted, at(24)), false);
  assert.equal(isStaleBatch(submitted, at(71.9)), false);
  assert.equal(isStaleBatch(submitted, at(STALE_BATCH_HOURS)), true, "exactly at the cutoff");
  assert.equal(isStaleBatch(submitted, at(240)), true);
});

test("clock skew backwards never makes a batch stale", () => {
  // submitted_at is written by MySQL and compared against this process's clock;
  // if they disagree the answer must fail towards "keep waiting".
  const submitted = new Date("2026-08-01T00:00:00Z");
  assert.equal(isStaleBatch(submitted, new Date("2026-07-31T00:00:00Z")), false);
});

test("the cutoff is configurable per call, for tests and for tuning", () => {
  const submitted = new Date("2026-08-01T00:00:00Z");
  const twoHoursLater = new Date(submitted.getTime() + 2 * HOUR);
  assert.equal(isStaleBatch(submitted, twoHoursLater, 1), true);
  assert.equal(isStaleBatch(submitted, twoHoursLater, 3), false);
});
