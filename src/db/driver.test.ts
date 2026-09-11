import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveDriver } from "./driver";

const NEON = "postgres://u:p@ep-cool-name-123456.us-east-2.aws.neon.tech/neondb?sslmode=require";
const LOCAL = "postgres://postgres:postgres@localhost:5432/content_engine_test";

test("a Neon host picks the neon driver", () => {
  assert.equal(resolveDriver(NEON, undefined), "neon");
  assert.equal(resolveDriver("postgresql://u:p@foo.neon.tech/db", undefined), "neon");
  assert.equal(resolveDriver("postgres://u:p@neon.tech/db", undefined), "neon");
});

test("localhost picks the pg driver", () => {
  assert.equal(resolveDriver(LOCAL, undefined), "pg");
  assert.equal(resolveDriver("postgres://u:p@127.0.0.1:5432/db", undefined), "pg");
  assert.equal(resolveDriver("postgres://u:p@db.internal:5432/db", undefined), "pg");
});

test("a host that merely contains neon.tech is not a Neon host", () => {
  // The suffix has to be a domain boundary: `notneon.tech` and a host with
  // neon.tech in the middle are somebody else's server.
  assert.equal(resolveDriver("postgres://u:p@notneon.tech/db", undefined), "pg");
  assert.equal(resolveDriver("postgres://u:p@neon.tech.example.com/db", undefined), "pg");
});

test("DB_DRIVER overrides the hostname in both directions", () => {
  assert.equal(resolveDriver(NEON, "pg"), "pg");
  assert.equal(resolveDriver(LOCAL, "neon"), "neon");
  assert.equal(resolveDriver(NEON, " PG "), "pg");
});

test("an empty or absent DB_DRIVER falls through to the hostname", () => {
  assert.equal(resolveDriver(NEON, ""), "neon");
  assert.equal(resolveDriver(NEON, "   "), "neon");
  assert.equal(resolveDriver(LOCAL, undefined), "pg");
});

test("an unrecognised DB_DRIVER throws rather than guessing", () => {
  assert.throws(() => resolveDriver(NEON, "postgres"), /DB_DRIVER must be "neon" or "pg"/);
});

test("a missing or unparseable DATABASE_URL throws a URL-shaped message", () => {
  assert.throws(() => resolveDriver(undefined, undefined), /DATABASE_URL is not set/);
  assert.throws(() => resolveDriver("", undefined), /DATABASE_URL is not set/);
  assert.throws(() => resolveDriver("not a url", undefined), /not a valid connection URL/);
});
