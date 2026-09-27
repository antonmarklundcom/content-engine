import assert from "node:assert/strict";
import { test } from "node:test";
import { withNeonTransactions } from "./index";

type Db = Parameters<typeof withNeonTransactions>[0];

/**
 * The Neon HTTP driver cannot run transactions (docs/log/o4.md). These pin the
 * routing: transaction() goes to the WebSocket-backed db, opened once and only
 * on first use; every other query stays on HTTP.
 */
test("transaction() is routed away from the HTTP driver, opened lazily and once", async () => {
  const calls: string[] = [];
  const httpDb = {
    select: () => "http-select",
    transaction: () => {
      throw new Error("No transactions support in neon-http driver");
    },
  } as unknown as Db;
  let opened = 0;
  const wsDb = {
    transaction: async (fn: (tx: string) => Promise<string>) => {
      calls.push("ws-transaction");
      return fn("tx");
    },
  } as unknown as Db;

  const db = withNeonTransactions(httpDb, "postgres://x@ep-a.neon.tech/db", (url) => {
    opened++;
    assert.equal(url, "postgres://x@ep-a.neon.tech/db");
    return wsDb;
  });

  assert.equal(opened, 0, "no socket until a transaction is asked for");
  assert.equal((db as unknown as { select: () => string }).select(), "http-select");

  const run = db.transaction as unknown as (fn: (tx: string) => Promise<string>) => Promise<string>;
  assert.equal(await run(async (tx) => `ran in ${tx}`), "ran in tx");
  await run(async () => "again");

  assert.equal(opened, 1);
  assert.deepEqual(calls, ["ws-transaction", "ws-transaction"]);
});
