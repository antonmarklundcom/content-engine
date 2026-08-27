// Lists shared research notes, optionally filtered to ones relevant to a
// given brand. Check this before spending a fresh research round on a topic
// another brand may have already covered.
// Usage: npm run research:list [-- --brand pozo]
import { db, schema } from "../src/db";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const brandId = arg("brand");

const rows = await db.select().from(schema.researchNotes);
const filtered = brandId ? rows.filter((r) => r.relatedBrandIds.includes(brandId)) : rows;

console.table(
  filtered.map((r) => ({
    id: r.id,
    topic: r.topic,
    market: r.market,
    brands: r.relatedBrandIds.join(","),
  })),
);
process.exit(0);
