// Records a publish result and advances the calendar item to "posted".
// Usage: mark:posted -- --item 5 --platform instagram [--platform-post-id <id>] [--permalink <url>]
import { db, schema } from "../src/db";
import { eq } from "drizzle-orm";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const calendarItemId = Number(arg("item"));
const platform = arg("platform");
const platformPostId = arg("platform-post-id");
const permalink = arg("permalink");

if (!calendarItemId || !platform) {
  console.error(
    "Usage: mark:posted -- --item <id> --platform <platform> [--platform-post-id <id>] [--permalink <url>]",
  );
  process.exit(1);
}

await db.insert(schema.posts).values({
  calendarItemId,
  platform,
  platformPostId,
  permalink,
});

await db
  .update(schema.calendarItems)
  .set({ status: "posted" })
  .where(eq(schema.calendarItems.id, calendarItemId));

console.log(`Post recorded for calendar item ${calendarItemId}; status -> posted`);
process.exit(0);
