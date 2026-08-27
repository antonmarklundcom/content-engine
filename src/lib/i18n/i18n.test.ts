/**
 * The dictionary is the UI's only copy, so the invariants worth testing are:
 * both languages cover the same keys, interpolation works, and a missing
 * translation degrades to English rather than to a raw key.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { en, sv } from "./dictionary";
import { isLocale, translator } from ".";

test("sv covers every en key and leaves none empty", () => {
  const missing = Object.keys(en).filter((key) => !(key in sv));
  assert.deepEqual(missing, []);
  const blank = Object.entries(sv).filter(([, value]) => value.trim() === "");
  assert.deepEqual(blank, []);
});

test("sv is not a copy of en", () => {
  // A few keys are legitimately identical (proper nouns, "Hook"); most are not.
  const identical = Object.keys(en).filter(
    (key) => sv[key as keyof typeof sv] === en[key as keyof typeof en],
  );
  assert.ok(
    identical.length < Object.keys(en).length / 4,
    `${identical.length} of ${Object.keys(en).length} sv strings are identical to en`,
  );
});

test("interpolation replaces known vars and leaves unknown ones alone", () => {
  const t = translator("en");
  assert.equal(t("pagination.position", { page: 2, total: 7 }), "Page 2 of 7");
  assert.equal(t("pagination.position", { page: 2 }), "Page 2 of {total}");
});

test("translator falls back to English for a missing translation", () => {
  const t = translator("sv");
  // Cast: the point is behaviour when a key is absent from the sv map at runtime.
  const partial = sv as Record<string, string | undefined>;
  const original = partial["nav.digest"];
  delete partial["nav.digest"];
  assert.equal(t("nav.digest"), en["nav.digest"]);
  partial["nav.digest"] = original;
});

test("isLocale rejects anything not shipped", () => {
  assert.equal(isLocale("sv"), true);
  assert.equal(isLocale("en"), true);
  assert.equal(isLocale("de"), false);
  assert.equal(isLocale(undefined), false);
});
