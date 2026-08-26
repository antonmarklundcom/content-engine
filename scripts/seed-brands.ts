import { db, schema } from "../src/db";
import { BRANDS } from "../src/lib/brands";

for (const brand of BRANDS) {
  await db
    .insert(schema.brands)
    .values(brand)
    .onConflictDoUpdate({
      target: schema.brands.id,
      set: {
        name: brand.name,
        domain: brand.domain,
        niche: brand.niche,
        market: brand.market,
        language: brand.language,
        voice: brand.voice,
        platforms: brand.platforms,
      },
    });
  console.log(`seeded: ${brand.id}`);
}
process.exit(0);
