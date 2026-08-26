// Lists proposed ideas awaiting a decision, optionally filtered by brand.
// Usage: npm run idea:list [-- --brand pozo]
import { db, schema } from "../src/db";
import { eq, and } from "drizzle-orm";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const brandId = arg("brand");

const rows = await db
  .select()
  .from(schema.ideas)
  .where(
    brandId
      ? and(eq(schema.ideas.status, "proposed"), eq(schema.ideas.brandId, brandId))
      : eq(schema.ideas.status, "proposed"),
  );

console.table(
  rows.map((r) => ({ id: r.id, brand: r.brandId, title: r.title, format: r.format })),
);
process.exit(0);
