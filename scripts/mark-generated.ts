// Records a generated asset against a calendar item and advances its status.
// Called by the agent right after an MCP generate_* tool call succeeds.
// Usage: mark:generated -- --item 5 --provider higgsfield --kind video --url <asset-url> [--job-id <id>] [--meta '{"model":"..."}']
import { db, schema } from "../src/db";
import { eq } from "drizzle-orm";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const calendarItemId = Number(arg("item"));
const provider = arg("provider");
const kind = arg("kind") as (typeof schema.assets.$inferInsert)["kind"] | undefined;
const url = arg("url");
const jobId = arg("job-id");
const metaRaw = arg("meta");

if (!calendarItemId || !provider || !kind || !url) {
  console.error(
    "Usage: mark:generated -- --item <id> --provider <id> --kind <image|video|audio> --url <url> [--job-id <id>] [--meta '<json>']",
  );
  process.exit(1);
}

await db.insert(schema.assets).values({
  calendarItemId,
  provider,
  kind,
  url,
  providerJobId: jobId,
  meta: metaRaw ? JSON.parse(metaRaw) : undefined,
});

await db
  .update(schema.calendarItems)
  .set({ status: "ready_to_post" })
  .where(eq(schema.calendarItems.id, calendarItemId));

console.log(`Asset recorded for calendar item ${calendarItemId}; status -> ready_to_post`);
process.exit(0);
