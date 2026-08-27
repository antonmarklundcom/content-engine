// Syncs BRANDS from src/lib/brands.ts into the brands table (upsert by id).
// Usage: npm run db:seed
import { db, schema } from "./index";
import { BRANDS } from "../lib/brands";
import { sql } from "drizzle-orm";

for (const brand of BRANDS) {
  await db
    .insert(schema.brands)
    .values(brand)
    .onConflictDoUpdate({
      target: schema.brands.id,
      set: {
        name: sql`excluded.name`,
        domain: sql`excluded.domain`,
        niche: sql`excluded.niche`,
        market: sql`excluded.market`,
        language: sql`excluded.language`,
        voice: sql`excluded.voice`,
        platforms: sql`excluded.platforms`,
      },
    });
}

console.log(`Seeded ${BRANDS.length} brands.`);
process.exit(0);
