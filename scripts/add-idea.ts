// Usage: npm run idea:add -- --brand pozo --title "..." --angle "..." --format reel [--source "..."]
import { db, schema } from "../src/db";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const brandId = arg("brand");
const title = arg("title");
const angle = arg("angle");
const format = arg("format") as (typeof schema.ideas.$inferInsert)["format"] | undefined;
const sourceNote = arg("source");

if (!brandId || !title || !angle || !format) {
  console.error(
    'Usage: idea:add -- --brand <id> --title "..." --angle "..." --format <reel|carousel|image_post|story|long_video> [--source "..."]',
  );
  process.exit(1);
}

const [inserted] = await db
  .insert(schema.ideas)
  .values({ brandId, title, angle, format, sourceNote })
  .returning({ id: schema.ideas.id });

console.log("Idea added:", { brandId, title, format, insertId: inserted.id });
process.exit(0);
