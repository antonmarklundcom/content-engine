import { pgTable, text, integer, boolean, timestamp, json } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const FORMATS = ["reel", "carousel", "image_post", "story"] as const;
export type Format = (typeof FORMATS)[number];

export const IDEA_STATUSES = ["proposed", "approved", "rejected"] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];

// One row per business/brand. Drives which content gets researched/written
// for whom, in what voice, on which platforms. Nothing here is specific to
// any one business — niche/voice/market/platforms are what generation reads
// to tailor itself per brand.
export const brands = pgTable("brands", {
  id: text("id").primaryKey(), // slug, e.g. "pozo"
  name: text("name").notNull(),
  domain: text("domain").notNull(),
  niche: text("niche").notNull(), // e.g. "well drilling / water"
  market: text("market").notNull(), // "paraguay" | "sweden" | "global"
  language: text("language").notNull().default("es"), // es | en | sv
  voice: text("voice"), // tone/style notes for research + copy
  platforms: json("platforms").$type<string[]>().notNull(), // ["instagram","facebook",...]
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

// A research finding worth sharing across brands — e.g. "Paraguay approves
// new investor visa rules" is relevant to both residency-guide and propia; a
// tax-law change is relevant to contador and negocio. Written once, tagged
// with every brand it applies to, instead of every brand re-researching the
// same topic from scratch.
export const researchNotes = pgTable("research_notes", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  topic: text("topic").notNull(),
  summary: text("summary").notNull(),
  market: text("market").notNull(),
  relatedBrandIds: json("related_brand_ids").$type<string[]>().notNull(),
  sources: json("sources").$type<string[]>(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

// The actual deliverable: a content idea with ready-to-post copy. Produced
// by the /api/generate research+ideation call for a brand, reviewed by the
// user, and approved/rejected.
export const ideas = pgTable("ideas", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  brandId: text("brand_id").notNull(),
  title: text("title").notNull(),
  angle: text("angle").notNull(), // why this idea, the hook
  format: text("format", { enum: FORMATS }).notNull(),
  platform: text("platform").notNull(), // "instagram" | "facebook" | "tiktok" | ...
  // Ready-to-post caption: hook line, body, call-to-action, hashtags — in
  // the brand's voice/language. This is the point of the whole app.
  draftCopy: text("draft_copy").notNull(),
  // Optional brief for whoever ends up shooting/designing the post (a shot
  // idea, an image description) — not a generation prompt for any specific
  // AI tool, just enough for a human (or the user) to know what to make.
  visualNotes: text("visual_notes"),
  researchNoteId: integer("research_note_id"), // shared research this was spun from, if any
  /**
   * Every factual claim the idea rests on (a law, a price, a program name,
   * a statistic), each with the URL(s) it was checked against.
   */
  citations: json("citations").$type<{ claim: string; sources: string[] }[]>(),
  status: text("status", { enum: IDEA_STATUSES }).notNull().default("proposed"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});
