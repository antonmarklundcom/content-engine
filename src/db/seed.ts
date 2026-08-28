/**
 * Initial rows for the `brands` table — the app's single source of truth for
 * which businesses it writes for (PLAN.md §1.5). This file replaced the
 * hardcoded `BRANDS` constant that used to live in src/lib/brands.ts: nothing
 * at runtime reads this data, only the database.
 *
 * Usage: `npm run db:seed` (add `--overwrite` to push edits here back over the
 * stored rows).
 *
 * Idempotence, and why the default is insert-only: once a row exists, the
 * database — not this file — owns it. A brand's voice or platform list gets
 * tuned in place, and a seed run that re-applied these literals every time
 * would silently undo that tuning on the next deploy. So a re-run inserts what
 * is missing and leaves everything else exactly as it is; `--overwrite` is the
 * explicit opt-in for the other direction. Either way, `id` is the conflict
 * target, so a re-run can never duplicate a brand.
 */
import { pathToFileURL } from "node:url";

import { sql } from "drizzle-orm";
import { db, schema } from "./index";
import type { NewBrand } from "./schema";

export const BRAND_SEEDS: NewBrand[] = [
  {
    id: "residency-guide",
    name: "Paraguay Residency Guide",
    domain: "paraguayresidencyguide.com",
    niche: "Paraguay residency, citizenship path, relocation for foreigners",
    market: "global",
    language: "en",
    voice:
      "Trustworthy expat guide voice. Clear, step-by-step, myth-busting. Speaks to US/EU/expat audience considering Paraguay residency.",
    platforms: ["instagram", "tiktok", "youtube_shorts"],
  },
  {
    id: "propia",
    name: "Propia (real estate)",
    domain: "propia.com.py",
    niche: "Paraguay real estate listings, buying/investing for foreigners and locals",
    market: "paraguay",
    language: "es",
    voice: "Aspirational but concrete — real listings, real prices, real neighborhoods.",
    platforms: ["instagram", "tiktok", "facebook"],
  },
  {
    id: "contador",
    name: "Contador.com.py",
    domain: "contador.com.py",
    niche: "Accounting / facturación / IVA / RUC services in Paraguay",
    market: "paraguay",
    language: "es",
    voice: "Practical, deadline-driven, answers real tax/accounting pain points.",
    platforms: ["instagram", "facebook"],
  },
  {
    id: "negocio",
    name: "Negocio.com.py",
    domain: "negocio.com.py",
    niche: "Business directory / how to start & register a business in Paraguay",
    market: "paraguay",
    language: "es",
    voice: "Encouraging, entrepreneur-facing, directory-driven.",
    platforms: ["instagram", "facebook"],
  },
  {
    id: "obra",
    name: "Obra.com.py",
    domain: "obra.com.py",
    niche: "Construction / contractors / building in Paraguay",
    market: "paraguay",
    language: "es",
    voice: "Visual, before/after, trust-building for a high-stakes purchase.",
    platforms: ["instagram", "tiktok", "facebook"],
  },
  {
    id: "viaje",
    name: "Viaje.com.py",
    domain: "viaje.com.py",
    niche: "Travel in/to Paraguay",
    market: "paraguay",
    language: "es",
    voice: "Visual, inspirational, discovery-driven.",
    platforms: ["instagram", "tiktok"],
  },
  {
    id: "visas",
    name: "Visas.com.py",
    domain: "visas.com.py",
    niche: "Paraguay visas (distinct from residency guide — transactional/local angle)",
    market: "paraguay",
    language: "es",
    voice: "Direct, procedural, answers 'how do I get X visa' fast.",
    platforms: ["instagram", "facebook"],
  },
  {
    id: "pozo",
    name: "Pozo.com.py",
    domain: "pozo.com.py",
    niche: "Well drilling / water services",
    market: "paraguay",
    language: "es",
    voice: "Rural/practical trust-building, visible proof of work.",
    platforms: ["facebook", "instagram"],
  },
  {
    id: "clientes",
    name: "Clientes.com.py",
    domain: "clientes.com.py",
    niche: "Lead-gen / marketing services for Paraguayan businesses",
    market: "paraguay",
    language: "es",
    voice: "Results-first, case-study driven — this brand sells marketing itself.",
    platforms: ["instagram", "linkedin", "facebook"],
  },
  {
    id: "sitiosweb",
    name: "SitiosWeb.com.py",
    domain: "sitiosweb.com.py",
    niche: "Website design/build services for Paraguayan businesses",
    market: "paraguay",
    language: "es",
    voice: "Before/after site transforms, fast turnaround proof.",
    platforms: ["instagram", "linkedin", "facebook"],
  },
  {
    id: "contenido",
    name: "Contenido.com.py",
    domain: "contenido.com.py",
    niche: "Content/social media services for Paraguayan businesses",
    market: "paraguay",
    language: "es",
    voice: "Meta-content — showcases this very pipeline's output as proof of skill.",
    platforms: ["instagram", "tiktok", "linkedin"],
  },
];

/**
 * Insert every missing brand. Returns how many rows the run actually wrote, so
 * a second run visibly reports 0 rather than claiming to have "seeded 11".
 *
 * `active` is deliberately left out of the overwrite set: it is a switch the
 * app flips, not seed data, and restoring a brand someone deactivated is the
 * one edit an overwrite has no business making.
 */
export async function seedBrands(options: { overwrite?: boolean } = {}): Promise<number> {
  let written = 0;

  for (const brand of BRAND_SEEDS) {
    const query = db.insert(schema.brands).values(brand);
    const rows = await (options.overwrite
      ? query.onConflictDoUpdate({
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
        })
      : query.onConflictDoNothing({ target: schema.brands.id })
    ).returning({ id: schema.brands.id });
    written += rows.length;
  }

  return written;
}

// Only run when invoked as a script (`npm run db:seed`), so importing
// BRAND_SEEDS from a test or another script does not hit the database.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const overwrite = process.argv.includes("--overwrite");
  const written = await seedBrands({ overwrite });
  console.log(
    overwrite
      ? `Seeded ${BRAND_SEEDS.length} brands (${written} inserted or updated).`
      : `Seeded ${BRAND_SEEDS.length} brands (${written} new, ${BRAND_SEEDS.length - written} already present and left untouched).`,
  );
  process.exit(0);
}
