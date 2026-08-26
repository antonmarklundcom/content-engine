import {
  pgTable,
  varchar,
  serial,
  integer,
  text,
  timestamp,
  pgEnum,
  json,
  boolean,
} from "drizzle-orm/pg-core";

export const formatEnum = pgEnum("format", [
  "reel",
  "carousel",
  "image_post",
  "story",
  "long_video",
]);

export const ideaStatusEnum = pgEnum("idea_status", [
  "proposed",
  "approved",
  "rejected",
  "planned",
]);

export const calendarStatusEnum = pgEnum("calendar_status", [
  "drafted",
  "ready_to_generate",
  "generating",
  "generated",
  "ready_to_post",
  "posted",
  "failed",
]);

export const assetKindEnum = pgEnum("asset_kind", ["image", "video", "audio"]);

// One row per business/brand. Drives which content gets made for whom, in
// what voice, on which platforms.
export const brands = pgTable("brands", {
  id: varchar("id", { length: 64 }).primaryKey(), // slug, e.g. "pozo"
  name: varchar("name", { length: 191 }).notNull(),
  domain: varchar("domain", { length: 191 }).notNull(),
  niche: varchar("niche", { length: 191 }).notNull(), // e.g. "well drilling / water"
  market: varchar("market", { length: 64 }).notNull(), // "paraguay" | "sweden" | "global"
  language: varchar("language", { length: 16 }).notNull().default("es"), // es | en | sv
  voice: text("voice"), // tone/style notes for research + captions
  platforms: json("platforms").$type<string[]>().notNull(), // ["instagram","tiktok","facebook"]
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// A raw content idea, before it's scheduled. Produced by the research/ideation
// step (a Claude Code agent turn), consumed by planning.
export const ideas = pgTable("ideas", {
  id: serial("id").primaryKey(),
  brandId: varchar("brand_id", { length: 64 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  angle: text("angle").notNull(), // why this idea, the hook
  format: formatEnum("format").notNull(),
  sourceNote: text("source_note"), // what research/trend prompted it
  status: ideaStatusEnum("status").notNull().default("proposed"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// A scheduled, structured content piece — the unit the generation step
// consumes and the posting step publishes.
export const calendarItems = pgTable("calendar_items", {
  id: serial("id").primaryKey(),
  ideaId: integer("idea_id"),
  brandId: varchar("brand_id", { length: 64 }).notNull(),
  scheduledFor: timestamp("scheduled_for").notNull(),
  platform: varchar("platform", { length: 32 }).notNull(), // "instagram" | "tiktok" | "facebook" | "linkedin"
  format: formatEnum("format").notNull(),
  caption: text("caption"),
  script: text("script"), // shot list / voiceover / scene breakdown for video
  provider: varchar("provider", { length: 32 }).notNull().default("higgsfield"), // swap point
  status: calendarStatusEnum("status").notNull().default("drafted"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Generated media, keyed to a calendar item. One item can have multiple
// assets (e.g. 3 image variants, or video + cover image).
export const assets = pgTable("assets", {
  id: serial("id").primaryKey(),
  calendarItemId: integer("calendar_item_id").notNull(),
  provider: varchar("provider", { length: 32 }).notNull(), // "higgsfield" | "runway" | "kling" | ...
  kind: assetKindEnum("kind").notNull(),
  url: text("url").notNull(), // where the file actually lives (storage/CDN)
  providerJobId: varchar("provider_job_id", { length: 191 }), // for lookup/debug on the provider side
  meta: json("meta"), // model name, prompt, cost credits, duration, etc.
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// A record of what was actually published where, for reporting and to avoid
// double-posting.
export const posts = pgTable("posts", {
  id: serial("id").primaryKey(),
  calendarItemId: integer("calendar_item_id").notNull(),
  platform: varchar("platform", { length: 32 }).notNull(),
  platformPostId: varchar("platform_post_id", { length: 191 }),
  postedAt: timestamp("posted_at").notNull().defaultNow(),
  permalink: text("permalink"),
});
