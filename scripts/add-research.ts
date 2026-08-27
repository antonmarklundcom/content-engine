// Usage: npm run research:add -- --topic "..." --summary "..." --market paraguay \
//          --brands residency-guide,propia [--sources "https://...,https://..."]
//
// Writes one shared research finding that multiple brands can spin ideas
// from (via `idea:add --research <id>`), instead of re-researching the same
// topic per brand.
import { db, schema } from "../src/db";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const topic = arg("topic");
const summary = arg("summary");
const market = arg("market");
const brandsRaw = arg("brands");
const sourcesRaw = arg("sources");

if (!topic || !summary || !market || !brandsRaw) {
  console.error(
    'Usage: research:add -- --topic "..." --summary "..." --market <paraguay|sweden|global> --brands <id,id,...> [--sources "url,url"]',
  );
  process.exit(1);
}

const relatedBrandIds = brandsRaw.split(",").map((s) => s.trim()).filter(Boolean);
const sources = sourcesRaw
  ? sourcesRaw.split(",").map((s) => s.trim()).filter(Boolean)
  : undefined;

const [inserted] = await db
  .insert(schema.researchNotes)
  .values({ topic, summary, market, relatedBrandIds, sources })
  .returning({ id: schema.researchNotes.id });

console.log("Research note added:", { topic, market, relatedBrandIds, insertId: inserted.id });
process.exit(0);
