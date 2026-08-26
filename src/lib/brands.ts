// Seed data for `brands`. Edit here, then run `npm run db:seed` to sync.
// Add new businesses to this list — everything downstream (research, plan,
// generation, posting) is driven off the brand row, not hardcoded per-brand.

export type BrandSeed = {
  id: string;
  name: string;
  domain: string;
  niche: string;
  market: "paraguay" | "sweden" | "global";
  language: "es" | "en" | "sv";
  voice: string;
  platforms: string[];
};

export const BRANDS: BrandSeed[] = [
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
