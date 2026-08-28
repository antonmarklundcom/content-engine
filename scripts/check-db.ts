/**
 * PR-02 done-when: "DB connects".
 *
 *   export DATABASE_URL='postgres://user:pass@host/dbname'
 *   npx tsx scripts/check-db.ts
 *
 * tsx does NOT auto-load .env — export the var first, or run through a tool
 * that does (drizzle-kit, `next dev`).
 */

import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db";

async function main(): Promise<void> {
  // Redact the password before printing — this output ends up pasted into chats.
  const target = redact(process.env.DATABASE_URL ?? "");
  console.log(`Connecting to ${target || "(DATABASE_URL not set)"}`);

  const started = Date.now();
  const info = await db.execute<{ version: string; db: string; now: string }>(
    sql`select version() as version, current_database() as db, now() as now`,
  );
  const row = info.rows[0] as Record<string, unknown> | undefined;

  console.log(`Connected in ${Date.now() - started}ms`);
  console.log(`  Postgres  ${String(row?.["version"] ?? "?")}`);
  console.log(`  Database  ${String(row?.["db"] ?? "?")}`);
  console.log(`  Server now ${String(row?.["now"] ?? "?")}`);

  const tables = await db.execute<{ table_name: string }>(
    sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
  );
  const names = tables.rows.map((t) => String((t as Record<string, unknown>)["table_name"] ?? ""));
  console.log(
    names.length > 0
      ? `  Tables    ${names.length}: ${names.join(", ")}`
      : "  Tables    none yet — run `npm run db:migrate`.",
  );
}

function redact(url: string): string {
  return url.replace(/\/\/([^:/@]+):([^@]*)@/, "//$1:***@");
}

main()
  .then(() => {
    console.log("\nOK");
    process.exit(0);
  })
  .catch((err) => {
    console.error("\nDatabase check FAILED");
    console.error(err instanceof Error ? err.message : err);
    console.error(
      "\nCommon causes:\n" +
        "  DATABASE_URL unset — tsx does not read .env; export it explicitly.\n" +
        "  Connection refused/timeout — check the Neon project is not suspended\n" +
        "                                and the connection string is the pooled one.\n" +
        "  ERR_INVALID_URL — the value contains 'DATABASE_URL=' inside it (a paste\n" +
        "                    slip). The value field takes the raw connection string only.",
    );
    process.exit(1);
  });
