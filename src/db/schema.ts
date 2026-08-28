import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  json,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import type {
  AnalysisGap,
  AnalysisHook,
  AnalysisIdea,
  AnalysisTimelineEntry,
  OutlinePayload,
} from "@/lib/analysis/contract";

// =============================================================================
// Content (brand ideation) — content-engine's original tables.
// =============================================================================

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
   * The analysis this idea was spun out of, if any (PLAN.md §1.3). Points at
   * `analyses.id` rather than `videos.id` on purpose: analyses are append-only
   * and versioned, so the analysis id records exactly which payload — which
   * model, which prompt version — grounded the idea. Sits beside
   * `researchNoteId`: an idea has at most one of the two, never both.
   */
  sourceAnalysisId: integer("source_analysis_id"),
  /**
   * Every factual claim the idea rests on (a law, a price, a program name,
   * a statistic), each with the URL(s) it was checked against.
   */
  citations: json("citations").$type<{ claim: string; sources: string[] }[]>(),
  status: text("status", { enum: IDEA_STATUSES }).notNull().default("proposed"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

// =============================================================================
// clips — the save-link inbox (PLAN.md §2)
// =============================================================================

export const CLIP_PLATFORMS = ["youtube", "instagram", "facebook", "other"] as const;
export type ClipPlatform = (typeof CLIP_PLATFORMS)[number];

export const CLIP_STATUSES = [
  "unprocessed",
  "ingesting",
  "analyzed",
  "promoted",
  "failed",
] as const;
export type ClipStatus = (typeof CLIP_STATUSES)[number];

/**
 * One row per link saved from a phone share sheet — the capture half of the
 * app (PLAN.md §1.6). Capture is time-sensitive in a way processing is not: a
 * clip scrolled past and not logged is gone, so a row is written the moment a
 * URL arrives, before anything is known about it.
 *
 * `status` is the pipeline's state machine:
 *   unprocessed — stored, nothing fetched (the resting state for IG/FB)
 *   ingesting   — a YouTube clip handed to the existing ingest path
 *   analyzed    — ingest finished; `videoId` points at the video row
 *   promoted    — turned into an idea; `ideaId` points at it
 *   failed      — ingest or fetch broke; `error` says how, and a retry is manual
 */
export const clips = pgTable(
  "clips",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    /** The saved link, verbatim. Unique: re-saving updates the note, never duplicates. */
    url: varchar("url", { length: 1024 }).notNull(),
    /** Derived from the URL at save time, not asked for — the share sheet sends no fields. */
    platform: text("platform", { enum: CLIP_PLATFORMS }).notNull().default("other"),
    /**
     * "Why I saved this", one line, optional. PLAN.md §1.7: metadata fetching
     * is best-effort (Meta gates oEmbed, YouTube blocks datacenter IPs), so the
     * URL plus this note is the guaranteed floor of a clip's usefulness — the
     * one field that never depends on a network call succeeding.
     */
    note: text("note"),
    /** Best-effort fetched metadata. Null is normal, not an error state. */
    title: varchar("title", { length: 512 }),
    author: varchar("author", { length: 255 }),
    thumbnailUrl: varchar("thumbnail_url", { length: 1024 }),
    status: text("status", { enum: CLIP_STATUSES }).notNull().default("unprocessed"),
    /** Soft link to `videos.id`, set once a YouTube clip has been ingested. */
    videoId: integer("video_id"),
    /** Soft link to `ideas.id`, set once the clip has been promoted. */
    ideaId: integer("idea_id"),
    /** Why the last attempt failed, for the inbox to show next to a retry. */
    error: varchar("error", { length: 1024 }),
    savedAt: timestamp("saved_at").notNull().defaultNow(),
  },
  (t) => [
    // Dedupe key: the save route upserts on this rather than checking first.
    uniqueIndex("clips_url_idx").on(t.url),
    // The inbox's two queries: filter by status, order newest-first.
    index("clips_status_idx").on(t.status),
    index("clips_saved_idx").on(t.savedAt),
  ],
);

// =============================================================================
// YouTube research tool — ported from the standalone "yt" repo, converted
// from MySQL (drizzle-orm/mysql-core) to Postgres/Neon (drizzle-orm/pg-core):
//   - mysqlTable -> pgTable
//   - int(...).autoincrement().primaryKey() -> integer(...).primaryKey().generatedAlwaysAsIdentity()
//   - mysqlEnum(col, [...]) -> text(col, { enum: [...] as const }), matching
//     the convention already used above for `format`/`status`
//   - longtext -> text (Postgres text has no length ceiling)
//   - decimal -> numeric (pg-core's name for the same type)
//   - JSON columns keep the same json(...).$type<T>() shape as the tables above
// Table names and columns are otherwise unchanged from the source schema; see
// PLAN.md §3 in the yt repo for the original rationale behind each field.
// =============================================================================

// ---------------------------------------------------------------------------
// yt_users — owner/employee login (PLAN.md §9 PR-23/24)
// ---------------------------------------------------------------------------

/**
 * Auth for the whole merged app (see src/middleware.ts) — not just the
 * /youtube/* section. Named `yt_users` (not `users`) only to keep the table's
 * origin obvious in the shared schema file; nothing about its columns is
 * YouTube-specific.
 */
export const users = pgTable("yt_users", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  /** owner spends money and deletes things; employee does neither. */
  role: text("role", { enum: ["owner", "employee"] as const }).notNull().default("employee"),
  /** bcrypt hash, null until a password is set. */
  passwordHash: varchar("password_hash", { length: 255 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// sources — tracked channels and playlists
// ---------------------------------------------------------------------------

export const sources = pgTable(
  "sources",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    kind: text("kind", { enum: ["channel", "playlist"] as const }).notNull(),
    /** Channel ID (UC…) or playlist ID (PL…, UU…). */
    youtubeId: varchar("youtube_id", { length: 64 }).notNull(),
    title: varchar("title", { length: 512 }).notNull(),
    url: varchar("url", { length: 512 }).notNull(),
    lastPolledAt: timestamp("last_polled_at"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sources_youtube_id_idx").on(t.youtubeId),
    // The poller's only query: active sources, least recently polled first.
    index("sources_active_polled_idx").on(t.active, t.lastPolledAt),
  ],
);

// ---------------------------------------------------------------------------
// videos
// ---------------------------------------------------------------------------

/**
 * caption_status is the pipeline's state machine (PR-05):
 *   unknown   — not probed yet
 *   available — captions fetched, transcript row exists
 *   none      — the video genuinely has no captions; skipped forever
 *   failed    — probing broke for a reason that may not recur; safe to retry
 */
export const videos = pgTable(
  "videos",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    youtubeId: varchar("youtube_id", { length: 16 }).notNull(),
    /** Null for videos added directly by URL rather than discovered via a source. */
    sourceId: integer("source_id"),
    title: varchar("title", { length: 512 }).notNull(),
    /** [PR-33] The uploader's description, as written — stored in full. */
    description: text("description"),
    channelTitle: varchar("channel_title", { length: 255 }),
    publishedAt: timestamp("published_at"),
    durationSeconds: integer("duration_seconds"),
    viewCount: bigint("view_count", { mode: "number" }),
    /** [PR-33] Null means the uploader hides the counter, not zero. */
    likeCount: bigint("like_count", { mode: "number" }),
    commentCount: bigint("comment_count", { mode: "number" }),
    thumbnailUrl: varchar("thumbnail_url", { length: 512 }),
    captionStatus: text("caption_status", {
      enum: ["unknown", "available", "none", "failed"] as const,
    })
      .notNull()
      .default("unknown"),
    captionCheckedAt: timestamp("caption_checked_at"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("videos_youtube_id_idx").on(t.youtubeId),
    index("videos_source_idx").on(t.sourceId),
    // The feed orders by published_at desc; the backfill scans by caption_status.
    index("videos_published_idx").on(t.publishedAt),
    index("videos_caption_status_idx").on(t.captionStatus),
    // The "added" sort order. Read state lives in video_reads (PR-25).
    index("videos_created_idx").on(t.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// transcripts
// ---------------------------------------------------------------------------

/**
 * `source` records where the text came from. 'ai' exists in the enum but is
 * never written in v1 — audio transcription is a paid-tier feature.
 */
export const transcripts = pgTable(
  "transcripts",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    videoId: integer("video_id").notNull(),
    language: varchar("language", { length: 16 }),
    source: text("source", { enum: ["captions", "manual", "ai"] as const })
      .notNull()
      .default("captions"),
    wordCount: integer("word_count").notNull().default(0),
    content: text("content").notNull(),
    fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("transcripts_video_id_idx").on(t.videoId)],
);

// ---------------------------------------------------------------------------
// analyses
// ---------------------------------------------------------------------------

/**
 * One row per analysis run. Analyses are never overwritten — re-analysing
 * with a different model or prompt_version inserts a new row.
 */
export const analyses = pgTable(
  "analyses",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    videoId: integer("video_id").notNull(),
    model: varchar("model", { length: 64 }).notNull(),
    promptVersion: smallint("prompt_version").notNull().default(1),

    status: text("status", { enum: ["ok", "failed"] as const }).notNull().default("ok"),

    summary: text("summary"),
    takeaways: json("takeaways").$type<string[]>(),
    hookBreakdown: json("hook_breakdown").$type<AnalysisHook>(),
    timeline: json("timeline").$type<AnalysisTimelineEntry[]>(),
    gaps: json("gaps").$type<AnalysisGap[]>(),
    ideas: json("ideas").$type<AnalysisIdea[]>(),

    /**
     * [PR-34] The payload's own immutable copy of the grouping fields — see
     * the comment on `topics`/`video_topics` below for why this is not
     * redundant with the lookup tables. Null on a version-1 row.
     */
    topics: json("topics").$type<string[]>(),
    entities: json("entities").$type<string[]>(),
    contentType: varchar("content_type", { length: 64 }),

    /** Store raw response on parse failure rather than crashing the batch. */
    rawResponse: text("raw_response"),
    error: varchar("error", { length: 1024 }),

    /** Batch API request id (PR-07), null for interactive runs. */
    batchId: varchar("batch_id", { length: 128 }),

    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),

    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }).notNull().default("0"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("analyses_video_idx").on(t.videoId),
    index("analyses_status_idx").on(t.status),
    index("analyses_batch_idx").on(t.batchId),
  ],
);

// ---------------------------------------------------------------------------
// batches
// ---------------------------------------------------------------------------

/**
 * One row per submitted Batch API job (PR-15) — this app's own ledger for a
 * job's lifecycle, since walking the provider's `batches.list()` has a
 * 24-hour horizon and includes every other project on the same API key.
 *
 * `status`:
 *   in_progress — submitted, results not ready
 *   ended       — provider finished it, we have not written the rows yet
 *   collected   — rows are in `analyses`; never looked at again
 *   canceled    — terminal, nothing to collect
 */
export const batches = pgTable(
  "batches",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    /** The provider's batch id (`msgbatch_…`). */
    providerBatchId: varchar("provider_batch_id", { length: 128 }).notNull(),
    status: text("status", {
      enum: ["in_progress", "ended", "collected", "canceled"] as const,
    })
      .notNull()
      .default("in_progress"),
    model: varchar("model", { length: 64 }).notNull(),
    videoCount: integer("video_count").notNull().default(0),
    estimatedUsd: numeric("estimated_usd", { precision: 10, scale: 6 }).notNull().default("0"),
    submittedAt: timestamp("submitted_at").notNull().defaultNow(),
    collectedAt: timestamp("collected_at"),
  },
  (t) => [
    uniqueIndex("batches_provider_id_idx").on(t.providerBatchId),
    index("batches_status_idx").on(t.status),
  ],
);

// ---------------------------------------------------------------------------
// outlines
// ---------------------------------------------------------------------------

/**
 * Generated on demand from one idea in an analysis, so the five-part outline
 * never inflates the per-video analysis cost. idea_index points into
 * `analyses.ideas`.
 */
export const outlines = pgTable(
  "outlines",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    analysisId: integer("analysis_id").notNull(),
    ideaIndex: smallint("idea_index").notNull(),

    status: text("status", { enum: ["ok", "failed"] as const }).notNull().default("ok"),
    error: varchar("error", { length: 1024 }),

    content: json("content").$type<OutlinePayload>(),
    rawResponse: text("raw_response"),
    model: varchar("model", { length: 64 }),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }).notNull().default("0"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    // One outline per idea — regenerating replaces rather than accumulates.
    uniqueIndex("outlines_analysis_idea_idx").on(t.analysisId, t.ideaIndex),
  ],
);

// ---------------------------------------------------------------------------
// screenings
// ---------------------------------------------------------------------------

/**
 * [PR-35] Gallringen, step 1 — a metadata-only screening that decides whether
 * a video is worth a full ($0.02) analysis. Stores a score, not a verdict
 * (the bar, SCREEN_MIN_SCORE, is a spend dial that moves); not append-only
 * (a screening is a disposable opinion, one current row per video).
 */
export const screenings = pgTable(
  "screenings",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    videoId: integer("video_id").notNull(),
    status: text("status", { enum: ["ok", "failed"] as const }).notNull().default("ok"),
    /** 0–100, how well the metadata says this video is worth reading. Null on a failed row. */
    score: smallint("score"),
    /** One sentence, in the model's words, for why. Shown in the UI verbatim. */
    reason: varchar("reason", { length: 512 }),
    model: varchar("model", { length: 64 }).notNull(),
    promptVersion: smallint("prompt_version").notNull().default(1),
    error: varchar("error", { length: 1024 }),
    rawResponse: text("raw_response"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }).notNull().default("0"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    // One current screening per video — recordScreening's upsert depends on this.
    uniqueIndex("screenings_video_id_idx").on(t.videoId),
    index("screenings_score_idx").on(t.score),
  ],
);

// ---------------------------------------------------------------------------
// topics / video_topics, entities / video_entities
// ---------------------------------------------------------------------------

/**
 * The cross-corpus grouping index (PLAN.md §7). No topic is hardcoded
 * anywhere — the corpus says what it is about. `slug` is the match key,
 * `name` the display form (see slugifyTag in lib/tags.ts).
 */
export const topics = pgTable(
  "topics",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    name: varchar("name", { length: 128 }).notNull(),
    slug: varchar("slug", { length: 128 }).notNull(),
  },
  (t) => [uniqueIndex("topics_slug_idx").on(t.slug)],
);

export const videoTopics = pgTable(
  "video_topics",
  {
    videoId: integer("video_id").notNull(),
    topicId: integer("topic_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.videoId, t.topicId] }),
    index("video_topics_topic_idx").on(t.topicId),
  ],
);

/** Named things a video discusses — tools, products, companies, people. */
export const entities = pgTable(
  "entities",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    name: varchar("name", { length: 128 }).notNull(),
    slug: varchar("slug", { length: 128 }).notNull(),
  },
  (t) => [uniqueIndex("entities_slug_idx").on(t.slug)],
);

export const videoEntities = pgTable(
  "video_entities",
  {
    videoId: integer("video_id").notNull(),
    entityId: integer("entity_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.videoId, t.entityId] }),
    index("video_entities_entity_idx").on(t.entityId),
  ],
);

// ---------------------------------------------------------------------------
// video_reads
// ---------------------------------------------------------------------------

/**
 * [PR-25] Read state, per user. A row exists only once a user has read or
 * pinned the video — absence means "unread and unpinned". read_at is set
 * once, on first open.
 */
export const videoReads = pgTable(
  "video_reads",
  {
    videoId: integer("video_id").notNull(),
    userId: integer("user_id").notNull(),
    readAt: timestamp("read_at"),
    pinned: boolean("pinned").notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.videoId, t.userId] }),
    index("video_reads_user_read_idx").on(t.userId, t.readAt),
    index("video_reads_user_pinned_idx").on(t.userId, t.pinned),
  ],
);

// ---------------------------------------------------------------------------
// video_unit_marks
// ---------------------------------------------------------------------------

/**
 * [PR-37] "This bit was interesting" — at the level of one takeaway, one
 * idea, one timeline beat, rather than one video. `unit_text` is a snapshot:
 * re-analysing a video can reword or drop the unit a mark pointed at, and the
 * snapshot is what survives that.
 */
export const videoUnitMarks = pgTable(
  "video_unit_marks",
  {
    videoId: integer("video_id").notNull(),
    userId: integer("user_id").notNull(),
    /** Mirrors UnitType in lib/listen/units.ts. The two must not drift. */
    unitType: text("unit_type", {
      enum: ["summary", "takeaway", "hook", "timeline", "gap", "idea"] as const,
    }).notNull(),
    unitIndex: integer("unit_index").notNull(),
    /** What was marked, as it read at the time. Truncated on write, not rejected. */
    unitText: varchar("unit_text", { length: 1024 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.videoId, t.userId, t.unitType, t.unitIndex] }),
    index("video_unit_marks_user_created_idx").on(t.userId, t.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// spend_log
// ---------------------------------------------------------------------------

/**
 * One row per UTC day, incremented as analyses complete. Drives the header
 * counter and the hard monthly cap (PR-07).
 */
export const spendLog = pgTable(
  "spend_log",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    /** UTC calendar day. */
    day: date("day", { mode: "string" }).notNull(),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }).notNull().default("0"),
  },
  (t) => [uniqueIndex("spend_log_day_idx").on(t.day)],
);

// ---------------------------------------------------------------------------
// spend_reservation
// ---------------------------------------------------------------------------

/**
 * Single-row table (id always 1) holding in-flight spend not yet in `spend_log`
 * or `batches`. Closes the gap between "checked the cap" and "billed for it":
 * two concurrent analyses can each read the same spend_log/batches totals and
 * both pass the check before either's bill lands. Reserving here first forces
 * them to serialize on this row's write lock — see spend.ts's withSpendCap.
 */
export const spendReservation = pgTable("spend_reservation", {
  id: integer("id").primaryKey(),
  reservedUsd: numeric("reserved_usd", { precision: 10, scale: 6 }).notNull().default("0"),
});

// ---------------------------------------------------------------------------
// relations
// ---------------------------------------------------------------------------

/**
 * No foreign key constraints are declared. Ingest is idempotent and inherently
 * out of order — a video can arrive before its source row is committed — and a
 * mid-batch FK violation would abort a whole poll run. Referential integrity is
 * enforced by the upsert paths; these relations exist for query ergonomics.
 */

export const sourcesRelations = relations(sources, ({ many }) => ({
  videos: many(videos),
}));

export const videosRelations = relations(videos, ({ one, many }) => ({
  source: one(sources, { fields: [videos.sourceId], references: [sources.id] }),
  transcript: one(transcripts, { fields: [videos.id], references: [transcripts.videoId] }),
  analyses: many(analyses),
  screening: one(screenings, { fields: [videos.id], references: [screenings.videoId] }),
  videoTopics: many(videoTopics),
  reads: many(videoReads),
  unitMarks: many(videoUnitMarks),
}));

export const videoUnitMarksRelations = relations(videoUnitMarks, ({ one }) => ({
  video: one(videos, { fields: [videoUnitMarks.videoId], references: [videos.id] }),
  user: one(users, { fields: [videoUnitMarks.userId], references: [users.id] }),
}));

export const videoReadsRelations = relations(videoReads, ({ one }) => ({
  video: one(videos, { fields: [videoReads.videoId], references: [videos.id] }),
  user: one(users, { fields: [videoReads.userId], references: [users.id] }),
}));

export const transcriptsRelations = relations(transcripts, ({ one }) => ({
  video: one(videos, { fields: [transcripts.videoId], references: [videos.id] }),
}));

export const analysesRelations = relations(analyses, ({ one, many }) => ({
  video: one(videos, { fields: [analyses.videoId], references: [videos.id] }),
  outlines: many(outlines),
}));

export const screeningsRelations = relations(screenings, ({ one }) => ({
  video: one(videos, { fields: [screenings.videoId], references: [videos.id] }),
}));

export const outlinesRelations = relations(outlines, ({ one }) => ({
  analysis: one(analyses, { fields: [outlines.analysisId], references: [analyses.id] }),
}));

export const clipsRelations = relations(clips, ({ one }) => ({
  video: one(videos, { fields: [clips.videoId], references: [videos.id] }),
  idea: one(ideas, { fields: [clips.ideaId], references: [ideas.id] }),
}));

export const ideasRelations = relations(ideas, ({ one }) => ({
  brand: one(brands, { fields: [ideas.brandId], references: [brands.id] }),
  sourceAnalysis: one(analyses, {
    fields: [ideas.sourceAnalysisId],
    references: [analyses.id],
  }),
  researchNote: one(researchNotes, {
    fields: [ideas.researchNoteId],
    references: [researchNotes.id],
  }),
}));

export const brandsRelations = relations(brands, ({ many }) => ({
  ideas: many(ideas),
}));

export const topicsRelations = relations(topics, ({ many }) => ({
  videoTopics: many(videoTopics),
}));

export const videoTopicsRelations = relations(videoTopics, ({ one }) => ({
  video: one(videos, { fields: [videoTopics.videoId], references: [videos.id] }),
  topic: one(topics, { fields: [videoTopics.topicId], references: [topics.id] }),
}));

// ---------------------------------------------------------------------------
// inferred types — import these rather than redeclaring row shapes in the UI
// ---------------------------------------------------------------------------

export type Brand = typeof brands.$inferSelect;
export type NewBrand = typeof brands.$inferInsert;
export type Idea = typeof ideas.$inferSelect;
export type NewIdea = typeof ideas.$inferInsert;
export type ResearchNote = typeof researchNotes.$inferSelect;
export type NewResearchNote = typeof researchNotes.$inferInsert;
export type Clip = typeof clips.$inferSelect;
export type NewClip = typeof clips.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;
export type Video = typeof videos.$inferSelect;
export type NewVideo = typeof videos.$inferInsert;
export type VideoRead = typeof videoReads.$inferSelect;
export type NewVideoRead = typeof videoReads.$inferInsert;
export type VideoUnitMark = typeof videoUnitMarks.$inferSelect;
export type NewVideoUnitMark = typeof videoUnitMarks.$inferInsert;
export type Transcript = typeof transcripts.$inferSelect;
export type NewTranscript = typeof transcripts.$inferInsert;
export type Analysis = typeof analyses.$inferSelect;
export type NewAnalysis = typeof analyses.$inferInsert;
export type Outline = typeof outlines.$inferSelect;
export type Screening = typeof screenings.$inferSelect;
export type NewScreening = typeof screenings.$inferInsert;
export type NewOutline = typeof outlines.$inferInsert;
export type Topic = typeof topics.$inferSelect;
export type NewTopic = typeof topics.$inferInsert;
export type SpendLogRow = typeof spendLog.$inferSelect;
export type Batch = typeof batches.$inferSelect;
export type NewBatch = typeof batches.$inferInsert;

export type CaptionStatus = Video["captionStatus"];
export type BatchStatus = Batch["status"];
export type SourceKind = Source["kind"];
