import "dotenv/config";
import { defineConfig } from "drizzle-kit";

import { resolveDriver } from "./src/db/driver";

/**
 * drizzle-kit's job here is `generate` — it reads the schema and writes SQL to
 * ./drizzle, which needs no connection at all. `push`/`studio` do connect, and
 * they use the plain TCP client for `dialect: "postgresql"`.
 *
 * No `driver` key, deliberately: unlike the app (PLAN.md §1.13), drizzle-kit
 * has nothing to switch. A Neon endpoint serves TCP on the same hostname it
 * serves HTTP — `psql` connects to Neon this way — so one client reaches both
 * targets. The driver rule is still called, for its other half: it rejects a
 * malformed or mis-set DATABASE_URL here, at the tool that reports errors
 * clearly, rather than several statements into a migration.
 */
const url = process.env.DATABASE_URL ?? "";
if (url) resolveDriver(url);

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
});
