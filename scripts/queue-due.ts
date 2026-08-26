// Lists calendar items ready for the agent to act on: generation-ready or
// generated-and-ready-to-post. This is what the Claude Code skill polls at
// the start of each run.
import { db, schema } from "../src/db";
import { inArray } from "drizzle-orm";

const rows = await db
  .select()
  .from(schema.calendarItems)
  .where(inArray(schema.calendarItems.status, ["ready_to_generate", "ready_to_post"]));

console.table(
  rows.map((r) => ({
    id: r.id,
    brand: r.brandId,
    platform: r.platform,
    format: r.format,
    provider: r.provider,
    status: r.status,
    scheduledFor: r.scheduledFor,
  })),
);
process.exit(0);
