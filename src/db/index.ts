import "dotenv/config";
import { drizzle as drizzleNeon, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { neon } from "@neondatabase/serverless";
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

function createDb(): Db {
  const url = process.env.DATABASE_URL;
  const driver = resolveDriver(url);
  // resolveDriver has already rejected a missing URL; this narrows the type.
  if (!url) throw new Error("DATABASE_URL is not set — see .env.example.");

  if (driver === "neon") return drizzleNeon(neon(url), { schema });

  pool = new Pool({ connectionString: url });
  // Structurally the two are the same query builder over the same schema, and
  // every call site uses only the parts they share. Declaring the exported type
  // as production's keeps `db`'s surface byte-for-byte what it was before the
  // switch — including the `Tx` type src/lib/tags.ts derives from it — so no
  // call site had to change to gain a local driver.
  //
  // The one place they genuinely differ is `db.transaction()`: node-postgres
  // runs it, neon-http throws "No transactions support in neon-http driver".
  // That divergence predates this file and is recorded in docs/log/o4.md — a
  // green test run here is therefore not evidence that a transactional path
  // works in production.
  return drizzlePg(pool, { schema }) as unknown as Db;
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
 * request — and this stays the no-op it always was. Under `pg` it is load
 * bearing: an open pool keeps the event loop alive, so a CLI script or a test
 * runner that skipped this would hang after its last query instead of exiting.
 */
export async function closeDb(): Promise<void> {
  const open = pool;
  if (!open) return;
  pool = undefined;
  cached = undefined;
  await open.end();
}
