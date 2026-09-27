import "dotenv/config";
import { drizzle as drizzleNeon, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { drizzle as drizzleNeonWs } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { neon, Pool as NeonPool } from "@neondatabase/serverless";
import { setDefaultResultOrder } from "node:dns";
import { Pool } from "pg";
import { resolveDriver } from "./driver";
import * as schema from "./schema";

/**
 * The one database handle (PLAN.md §1.13). Two transports, one schema:
 * production talks to Neon over HTTP, CI and a laptop talk to a plain Postgres
 * server over TCP. `src/db/driver.ts` decides which from the connection string;
 * nothing else in the app imports a driver, so this file is the only place that
 * knows there is more than one.
 */

type Db = NeonHttpDatabase<typeof schema>;

/** Set by the pg branch so `closeDb()` has something to close. */
let pool: Pool | undefined;
/** Set by the first Neon transaction, for the same reason. */
let neonTxPool: NeonPool | undefined;

function createDb(): Db {
  const url = process.env.DATABASE_URL;
  const driver = resolveDriver(url);
  // resolveDriver has already rejected a missing URL; this narrows the type.
  if (!url) throw new Error("DATABASE_URL is not set — see .env.example.");

  if (driver === "neon") return withNeonTransactions(drizzleNeon(neon(url), { schema }), url);

  // Hostinger's shared servers have a broken IPv6 route to Neon (see
  // docs/DEPLOY-HOSTINGER.md): resolving A records first keeps pg on IPv4.
  if (process.env.DB_FORCE_IPV4 === "1") setDefaultResultOrder("ipv4first");

  pool = new Pool({ connectionString: url });
  // Structurally the two are the same query builder over the same schema, and
  // every call site uses only the parts they share. Declaring the exported type
  // as production's keeps `db`'s surface byte-for-byte what it was before the
  // switch — including the `Tx` type src/lib/tags.ts derives from it — so no
  // call site had to change to gain a local driver.
  //
  // The one place they differ is `db.transaction()`: neon-http cannot run one,
  // so the neon branch routes it through withNeonTransactions() below.
  return drizzlePg(pool, { schema }) as unknown as Db;
}

type TransactionFn = Db["transaction"];

/**
 * Neon's HTTP driver throws "No transactions support in neon-http driver"
 * (docs/log/o4.md). Every other query stays on HTTP — stateless, no socket to
 * keep alive — and only `transaction()` goes over Neon's WebSocket `Pool`,
 * which speaks the Postgres wire protocol and so runs BEGIN/COMMIT like pg.
 * The pool is created on the first transaction, not before, so a process that
 * never opens one never opens a socket.
 *
 * `openTransactionDb` is injectable for the unit test; production uses the
 * WebSocket pool. The two builders share the schema and the query-builder
 * surface, which is what the cast relies on (same as the pg branch).
 */
export function withNeonTransactions(
  httpDb: Db,
  url: string,
  openTransactionDb: (url: string) => Db = openNeonWebSocketDb,
): Db {
  let txDb: Db | undefined;
  const transaction: TransactionFn = (fn, config) => {
    txDb ??= openTransactionDb(url);
    return txDb.transaction(fn, config);
  };
  return new Proxy(httpDb, {
    get(target, prop, receiver) {
      if (prop === "transaction") return transaction;
      return Reflect.get(target, prop, receiver);
    },
  });
}

function openNeonWebSocketDb(url: string): Db {
  // Node 22+ has a global WebSocket; @neondatabase/serverless uses it by
  // default. On older Node, say so instead of failing inside the driver.
  if (typeof globalThis.WebSocket === "undefined") {
    throw new Error(
      "Database transactions over Neon need a global WebSocket (Node.js 22 or newer). " +
        "Upgrade Node, or use DB_DRIVER=pg with a direct connection string.",
    );
  }
  neonTxPool = new NeonPool({ connectionString: url });
  return drizzleNeonWs(neonTxPool, { schema }) as unknown as Db;
}

let cached: Db | undefined;

// Lazy: avoids throwing at import time during `next build`'s route analysis,
// which loads this module without env vars available.
export const db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    if (!cached) cached = createDb();
    return Reflect.get(cached, prop, receiver);
  },
});

export { schema };

/**
 * Release the connection pool, if this process opened one.
 *
 * Under Neon's HTTP driver there is nothing to release — each query is its own
 * request — unless a transaction opened the WebSocket pool, which is closed here
 * too. Under `pg` it is load
 * bearing: an open pool keeps the event loop alive, so a CLI script or a test
 * runner that skipped this would hang after its last query instead of exiting.
 */
export async function closeDb(): Promise<void> {
  const open = [pool, neonTxPool].filter((p) => p !== undefined);
  pool = undefined;
  neonTxPool = undefined;
  if (open.length === 0) return;
  cached = undefined;
  await Promise.all(open.map((p) => p.end()));
}
