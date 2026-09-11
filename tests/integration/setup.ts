import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import { closeDb, db } from "@/db";
import { resolveDriver } from "@/db/driver";
import { resetFakeGemini } from "@/lib/ai-fake";

/**
 * The integration harness (PLAN.md §5.O4.3).
 *
 * Everything build 1 wrote — the spend cap, the clip upsert, promote, the
 * bridge reads — is SQL, and none of it had ever met a database before this
 * phase (§1.12). These tests run that SQL against a real Postgres: the
 * `postgres:16` service container in CI, a local server on a laptop. O5 added
 * the other half: the paid paths, against the Gemini test double.
 *
 * Run with `npm run test:db`, which supplies the two flags this needs:
 * `--conditions=react-server` so the `server-only` marker in the modules under
 * test resolves to its empty build instead of throwing, and
 * `--test-concurrency=1` so one file's truncate cannot land in the middle of
 * another file's assertions.
 */

/**
 * [O5] No test in this directory may reach Google (§1.16).
 *
 * Set here rather than in the npm script so it holds however the suite is
 * started — a single file run from an editor, a debugger, `node --test` by
 * hand. `??=` so a run that deliberately unsets it (there is none today) still
 * can.
 *
 * Not the only guard: `fakeGeminiEnabled()` also refuses to build a real client
 * when `NODE_ENV=test` and no key is present, so a CI job that dropped this
 * line would still fail on an assertion rather than reach for a credential.
 */
process.env.GEMINI_FAKE ??= "1";

/** Refuse to run against anything that is not a local/CI Postgres. */
function requireLocalDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. The integration tests need a throwaway Postgres, e.g.\n" +
        "  export DATABASE_URL=postgres://postgres:postgres@localhost:5432/content_engine_test",
    );
  }
  // These tests truncate every table between files. Doing that to the Neon
  // database the app actually uses would be unrecoverable, so the driver rule
  // doubles as the safety catch: a Neon URL is never a test database.
  if (resolveDriver(url) === "neon") {
    throw new Error(
      "Refusing to run integration tests against a Neon database — they truncate every " +
        "table. Point DATABASE_URL at a local or CI Postgres.",
    );
  }
  return url;
}

let prepared: Promise<void> | undefined;

/**
 * Bring the schema up to date, once per process.
 *
 * The migrator is idempotent (it reads the same `drizzle.__drizzle_migrations`
 * bookkeeping table `npm run db:migrate` writes), so a file that runs after
 * another has already migrated does no work — which is what lets `npm run
 * verify` skip a separate migrate step and still find a schema here.
 */
export function prepareDatabase(): Promise<void> {
  prepared ??= (async () => {
    const url = requireLocalDatabaseUrl();
    const pool = new Pool({ connectionString: url });
    try {
      await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
    } finally {
      await pool.end();
    }
  })();
  return prepared;
}

/**
 * Empty every application table.
 *
 * Read from `information_schema` rather than a hand-kept list: a phase that
 * adds a table would otherwise leave rows behind for the next test file, and
 * the failure that produces points anywhere but here. One statement, so the
 * whole reset is atomic; `restart identity` because several assertions below
 * are about the ids the app hands out, and `cascade` for the soft links.
 *
 * [O5] The Gemini fake's recorded calls are process state with exactly the same
 * lifetime as the rows, so they are cleared here too — a `calls` array carrying
 * the previous test's requests is the same class of bug as a leftover row, and
 * every file already calls this between tests.
 */
export async function resetTables(): Promise<void> {
  resetFakeGemini();
  await prepareDatabase();
  const { rows } = await db.execute<{ names: string | null }>(sql`
    select string_agg(format('%I.%I', table_schema, table_name), ', ') as names
    from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
  `);
  const names = rows[0]?.names;
  if (!names) return;
  await db.execute(sql.raw(`truncate table ${names} restart identity cascade`));
}

/**
 * Close the pool so the test process can exit.
 *
 * `pg` keeps the event loop alive while a connection is open, so a file that
 * skipped this would pass and then hang until the runner's timeout.
 */
export async function teardown(): Promise<void> {
  await closeDb();
}

/** Fixed instants, so nothing here depends on which month the suite runs in. */
export const JAN = new Date("2026-01-15T12:00:00.000Z");
export const FEB = new Date("2026-02-15T12:00:00.000Z");
