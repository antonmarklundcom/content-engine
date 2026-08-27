// Usage: npm run idea:add -- --brand pozo --title "..." --angle "..." --format reel \
//          --copy "..." [--prompt "..."] \
//          [--source "..."] [--research <researchNoteId>] \
//          [--citations '[{"claim":"...","sources":["https://..."]}]']
//
// --copy is the ready-to-post caption/hashtags (+ hook line for video) —
// this is the actual deliverable of ideation, write it out in full, not a
// placeholder. --prompt is the media-generation brief, only needed if this
// idea is going on to generation.
//
// --research links this idea to a shared research note (see research:add) —
// use it when the idea is this brand's angle on a topic another brand may
// also be covering, so the shared finding isn't re-researched per brand.
//
// --citations is required whenever the idea rests on a factual claim (a law,
// a price, a program name, a stat) — see SKILL.md's fact-check gate. Purely
// lifestyle/inspo ideas can omit it.
import { db, schema } from "../src/db";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const brandId = arg("brand");
const title = arg("title");
const angle = arg("angle");
const format = arg("format") as (typeof schema.ideas.$inferInsert)["format"] | undefined;
const draftCopy = arg("copy");
const mediaPrompt = arg("prompt");
const sourceNote = arg("source");
const researchNoteId = arg("research") ? Number(arg("research")) : undefined;
const citationsRaw = arg("citations");

if (!brandId || !title || !angle || !format) {
  console.error(
    'Usage: idea:add -- --brand <id> --title "..." --angle "..." --format <reel|carousel|image_post|story|long_video> --copy "..." [--prompt "..."] [--source "..."] [--citations \'<json>\']',
  );
  process.exit(1);
}

let citations: { claim: string; sources: string[] }[] | undefined;
if (citationsRaw) {
  citations = JSON.parse(citationsRaw);
  for (const c of citations ?? []) {
    if (!c.sources || c.sources.length < 2) {
      console.error(
        `Citation for "${c.claim}" has fewer than 2 sources — the fact-check gate requires at least 2 independent sources per factual claim.`,
      );
      process.exit(1);
    }
  }
}

const [inserted] = await db
  .insert(schema.ideas)
  .values({
    brandId,
    title,
    angle,
    format,
    draftCopy,
    mediaPrompt,
    sourceNote,
    researchNoteId,
    citations,
  })
  .returning({ id: schema.ideas.id });

console.log("Idea added:", { brandId, title, format, researchNoteId, insertId: inserted.id });
process.exit(0);
