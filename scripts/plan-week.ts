// Turns an approved idea into a scheduled calendar item.
// Usage: npm run plan:week -- --idea 12 --platform instagram --date 2026-09-02T14:00:00Z [--provider higgsfield]
import { db, schema } from "../src/db";
import { eq } from "drizzle-orm";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const ideaId = Number(arg("idea"));
const platform = arg("platform");
const date = arg("date");
const provider = arg("provider") ?? "higgsfield";

if (!ideaId || !platform || !date) {
  console.error(
    "Usage: plan:week -- --idea <id> --platform <instagram|tiktok|facebook|linkedin> --date <ISO> [--provider higgsfield]",
  );
  process.exit(1);
}

const [idea] = await db.select().from(schema.ideas).where(eq(schema.ideas.id, ideaId));
if (!idea) {
  console.error(`No idea with id ${ideaId}`);
  process.exit(1);
}
if (idea.status !== "approved") {
  console.error(
    `Idea ${ideaId} is "${idea.status}", not "approved" — run idea:approve first. This gate exists so scheduled/unattended runs never generate or post something nobody signed off on.`,
  );
  process.exit(1);
}

await db.insert(schema.calendarItems).values({
  ideaId: idea.id,
  brandId: idea.brandId,
  scheduledFor: new Date(date),
  platform,
  format: idea.format,
  provider,
  status: "ready_to_generate",
});

await db.update(schema.ideas).set({ status: "planned" }).where(eq(schema.ideas.id, ideaId));

console.log(`Planned: idea ${ideaId} -> ${platform} on ${date} via ${provider}`);
process.exit(0);
