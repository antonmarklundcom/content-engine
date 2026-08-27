import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// SQLite has no enum type — these are documented here and enforced at the
// application layer (scripts validate against them). Switching to a
// server database later (Postgres/MySQL) would turn these into real enums;
// nothing else about the schema needs to change to do that.
export const FORMATS = ["reel", "carousel", "image_post", "story", "long_video"] as const;
export type Format = (typeof FORMATS)[number];

export const IDEA_STATUSES = ["proposed", "approved", "rejected", "planned"] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];

export const CALENDAR_STATUSES = [
  "drafted",
  "ready_to_generate",
  "generating",
  "generated",
  "ready_to_post",
  "posted",
  "failed",
] as const;
export type CalendarStatus = (typeof CALENDAR_STATUSES)[number];

export const ASSET_KINDS = ["image", "video", "audio"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

// One row per business/brand. Drives which content gets made for whom, in
// what voice, on which platforms. Works for any niche — nothing here is
// specific to any one business; the niche/voice/market columns are what the
// research+ideation step reads to tailor itself per brand.
export const brands = sqliteTable("brands", {
  id: text("id").primaryKey(), // slug, e.g. "pozo"
  name: text("name").notNull(),
  domain: text("domain").notNull(),
  niche: text("niche").notNull(), // e.g. "well drilling / water"
  market: text("market").notNull(), // "paraguay" | "sweden" | "global"
  language: text("language").notNull().default("es"), // es | en | sv
  voice: text("voice"), // tone/style notes for research + captions
  platforms: text("platforms", { mode: "json" }).$type<string[]>().notNull(), // ["instagram","tiktok","facebook"]
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// A research finding worth sharing across brands — e.g. "Paraguay approves
// new investor visa rules" is relevant to both residency-guide and propia; a
// tax-law change is relevant to contador and negocio. One research run can
// write this once and tag every brand it applies to, instead of each brand
// re-researching the same topic. Ideas for each relevant brand then each get
// their own angle on it via `ideas.researchNoteId`.
export const researchNotes = sqliteTable("research_notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  topic: text("topic").notNull(), // short label, e.g. "DNM 407/2026 solvency rules"
  summary: text("summary").notNull(), // what was found, in enough detail to write an angle from
  market: text("market").notNull(), // "paraguay" | "sweden" | "global" — matches brands.market
  relatedBrandIds: text("related_brand_ids", { mode: "json" })
    .$type<string[]>()
    .notNull(), // brand ids this topic is relevant to, e.g. ["residency-guide","propia"]
  sources: text("sources", { mode: "json" }).$type<string[]>(), // URLs backing the summary
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// A raw content idea, before it's scheduled. Produced by the research/ideation
// step (a Claude Code agent turn), consumed by planning.
export const ideas = sqliteTable("ideas", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  brandId: text("brand_id").notNull(),
  title: text("title").notNull(),
  angle: text("angle").notNull(), // why this idea, the hook
  format: text("format", { enum: FORMATS }).notNull(),
  researchNoteId: integer("research_note_id"), // shared research this idea was spun from, if any
  sourceNote: text("source_note"), // what research/trend prompted it
  /**
   * Every factual claim the idea rests on (a law, a price, a program name,
   * a statistic), each with the URL(s) it was checked against. Required
   * whenever the idea makes a factual claim — not required for pure
   * lifestyle/inspo content. See SKILL.md's fact-check gate: an idea with
   * an unverified claim (fewer than 2 independent sources) must not move
   * past "proposed".
   */
  citations: text("citations", { mode: "json" }).$type<
    { claim: string; sources: string[] }[]
  >(),
  status: text("status", { enum: IDEA_STATUSES }).notNull().default("proposed"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// A scheduled, structured content piece — the unit the generation step
// consumes and the posting step publishes.
export const calendarItems = sqliteTable("calendar_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ideaId: integer("idea_id"),
  brandId: text("brand_id").notNull(),
  scheduledFor: integer("scheduled_for", { mode: "timestamp" }).notNull(),
  platform: text("platform").notNull(), // "instagram" | "tiktok" | "facebook" | "linkedin"
  format: text("format", { enum: FORMATS }).notNull(),
  caption: text("caption"),
  script: text("script"), // shot list / voiceover / scene breakdown for video
  provider: text("provider").notNull().default("higgsfield"), // swap point
  status: text("status", { enum: CALENDAR_STATUSES }).notNull().default("drafted"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// Generated media, keyed to a calendar item. One item can have multiple
// assets (e.g. 3 image variants, or video + cover image).
export const assets = sqliteTable("assets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  calendarItemId: integer("calendar_item_id").notNull(),
  provider: text("provider").notNull(), // "higgsfield" | "runway" | "kling" | ...
  kind: text("kind", { enum: ASSET_KINDS }).notNull(),
  url: text("url").notNull(), // where the file actually lives (storage/CDN)
  providerJobId: text("provider_job_id"), // for lookup/debug on the provider side
  meta: text("meta", { mode: "json" }), // model name, prompt, cost credits, duration, etc.
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// A record of what was actually published where, for reporting and to avoid
// double-posting.
export const posts = sqliteTable("posts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  calendarItemId: integer("calendar_item_id").notNull(),
  platform: text("platform").notNull(),
  platformPostId: text("platform_post_id"),
  postedAt: integer("posted_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  permalink: text("permalink"),
});
