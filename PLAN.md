# PLAN — content-engine: wire the two halves + clip inbox (phased autonomous build)

One Next.js app on Vercel + Neon, two halves: the brand ideation tool
(`brands`/`research_notes`/`ideas`, `/api/generate`) and the YouTube research
tool (`/youtube/*`, `sources`→`videos`→`transcripts`→`analyses`→`topics`/
`entities`). They share a repo, deploy, login, and Anthropic client — and no
data. This plan wires them together and adds the save-clip inbox, as a
sequence of autonomous phases: one PR each, all Opus phases first, then all
Sonnet phases.

| Phase | Model | Prompt file | Plan sections |
|---|---|---|---|
| O1 | Opus | `prompts/opus-1-foundation.md` | §5.O1 |
| O2 | Opus | `prompts/opus-2-capture-bridge.md` | §5.O2 |
| S3 | Sonnet | `prompts/sonnet-3-inbox-ui.md` | §6.S3 |
| S4 | Sonnet | `prompts/sonnet-4-worker-igfb.md` | §6.S4 (conditional — see §1.9) |

---

## §1. Decisions already made — do not re-litigate

1. **Home is Vercel + Neon.** Hostinger's existing Node slot is only a
   background worker (webhook-triggered from the app, never cron-polling),
   and only if/when a job needs it. Not a second app.
2. **No GitHub Actions dependency at runtime.** Actions is CI only
   (typecheck/build on push). Nothing the app needs to function may require
   an Actions run.
3. **Linkage is asymmetric.** `ideas.source_analysis_id` (nullable, →
   `analyses.id`) is the only new cross-half link. Pointing at the analysis,
   not the video, records exactly which payload grounded the idea (analyses
   are append-only/versioned). **No `brand_id` on `videos`/`sources`** —
   nothing writes it, nothing reads it, and one-to-one contradicts the
   `relatedBrandIds`-array precedent. If videos→brand is ever needed, it's a
   join table added then.
4. **House convention: no FK constraints.** Soft links + drizzle `relations`
   only (see the comment above `sourcesRelations` in `src/db/schema.ts`).
   Ingest is idempotent and out-of-order; keep it that way.
5. **The `brands` DB table becomes the single source of truth.** The
   hardcoded `BRANDS` constant in `src/lib/brands.ts` is retired; a seed
   script owns initial rows. `/api/generate` reads the table.
6. **Capture before processing.** The clips inbox (capture, time-sensitive —
   unlogged clips are lost forever) ships before/alongside seed-from-video
   (processing over stored data, which doesn't decay). The inbox lives or
   dies on phone ergonomics: share-sheet/shortcut capture, not
   "open the app and paste".
7. **A clip saved with zero fetched metadata must still be useful**: the
   save payload includes an optional one-line `note` ("why I saved this").
   IG/FB metadata fetch is best-effort (Meta gates oEmbed; scraping from
   datacenter IPs is unreliable) — the URL + note is the guaranteed floor.
8. **No audio transcription for IG/FB clips in this build** (~20x the cost
   of a captions-based analysis). Metadata + note only; revisit later (§10).
9. **The caption probe is a decision gate for S4 only.** O1–S3 do not depend
   on it. S4 (Hostinger worker) is built only if the probe run from Vercel
   comes back blocked, or a job genuinely needs the worker.
10. **Spend goes through one cap.** `/api/generate`'s paid web-search calls
    join the YouTube half's `spend_log`/`withSpendCap` machinery.
11. **Model rule:** phases run on Opus or Sonnet exactly as the table says.
    Fable/Mythos-class models are never used for phases, subagents, or
    spawned sessions — if one ever seems needed, stop and ask Anton.

## §2. Roles & object model

Unchanged from what exists: `yt_users` with `owner`/`employee` roles guards
the whole app (`src/middleware.ts`); owner spends money and deletes. New
objects this build adds:

- **`clips`** — one row per saved link. `id`, `url` (unique), `platform`
  (`youtube` | `instagram` | `facebook` | `other`, derived from the URL),
  `note` (nullable text), `title`/`author`/`thumbnail_url` (nullable,
  best-effort fetched), `status` (`unprocessed` | `ingesting` | `analyzed` |
  `promoted` | `failed`), `video_id` (nullable soft link once a YouTube clip
  is ingested), `idea_id` (nullable soft link once promoted), `error`
  (nullable), `saved_at`. Indexed on `status`, `saved_at`.
- **`ideas.source_analysis_id`** — nullable integer, soft link to
  `analyses.id`. Sits beside the existing `researchNoteId` precedent.
- Identifiers in English; UI copy matches the app's existing conventions.

## §3. Feature scope

Dependency-grouped:

- **A. Foundation** (O1): brands table as source of truth; `clips` table +
  `ideas.source_analysis_id` migration; unified spend cap.
- **B. Capture + bridge** (O2, needs A): token-authed save-clip route;
  YouTube clips auto-route through existing ingest; "promote" endpoint
  (marked unit / analysis idea → `ideas` row for a chosen brand); optional
  seed-from-analysis path in `/api/generate`.
- **C. Surfaces** (S3, needs B): inbox list view; promote/seed UI; PWA
  `share_target` + iOS Shortcut capture path.
- **D. Worker + IG/FB** (S4, needs C; conditional per §1.9): Hostinger
  webhook worker; best-effort IG/FB metadata fetch (worker-side, since
  Meta blocks datacenter IPs even harder than YouTube does).

## §4. Autonomy protocol

Every phase session works under these rules; each prompt re-states the ones
it most needs.

1. Work until the phase's exit criteria all pass; never ask permission for
   in-plan work.
2. One PR per phase: branch `phase/<id>` off latest main; create, watch, and
   merge the PR when green. A red build is always this session's own work.
   Never start on top of an unmerged previous phase.
3. Minor non-blocking issues → `KNOWN-ISSUES.md`, keep building.
4. Stop and ask ONLY for: a missing credential with no graceful fallback, or
   a bad-foundation decision (schema shape, auth, money math) where guessing
   wrong forces a rewrite. Everything else: choose reasonably, record in §9,
   continue.
5. Missing env values never block: document in `.env.example`, degrade
   gracefully.
6. Every prompt is re-runnable: check what exists on the branch first,
   continue from the first unmet exit criterion.
7. Sonnet phases (S3/S4) hard limits: no schema, auth, spend-cap, or
   ingest/analysis-pipeline changes. Data access only through the query/
   action layer O1/O2 built. Blocked by the limit → workaround + §10 note.
8. Model cost guardrail: Opus and Sonnet only, per §1.11. Spawning anything
   on a Fable/Mythos-class model without Anton's explicit approval is
   treated like a destructive action.
9. Phase handoff — only when four gates pass: PR merged green; exit
   checklist passed; pre-handoff audit done (re-run build/lint/typecheck,
   adversarially re-read your own merged diff, fix findings); §9 build-log
   entry committed. Then spawn the next phase as a NEW session via the
   claude-code-remote `create_session` tool: inherit environment and
   permission mode (never `plan`), set `model` per the phase table, prompt
   exactly `Read prompts/<next-file>.md in this repo and execute it.`
   Fallback without `create_session` (local CLI): same model → continue in
   this window; model switch → stop and report.
10. Build log: before merging, append a 5–10 line dated entry to §9 — phase
    id + PR, what now exists, decisions/deviations, where the next phase
    should look first. Fresh sessions orient from this file + §9 +
    `KNOWN-ISSUES.md` only.

## §5. Opus phases

### O1 — Foundation: one source of truth, the migration, one spend cap

1. **Brands reconciliation.** Retire the `BRANDS` constant: `/api/generate`
   (and anything else importing `src/lib/brands.ts`) reads the `brands`
   table. Move the constant's data into `src/db/seed.ts` (idempotent
   upsert). Keep the exported `Brand` type where the prompt-building code
   needs it.
2. **Migration** (drizzle-kit, one migration): `clips` table per §2;
   `ideas.source_analysis_id`. No FK constraints (§1.4); add drizzle
   `relations` (clip→video, clip→idea, idea→analysis).
3. **Unified spend.** Route `/api/generate`'s Anthropic call through the
   same `withSpendCap`/`spend_log` path the YouTube half uses
   (`src/lib/.../spend.ts`). Its cost lands in the same daily log and
   respects the same cap.
4. **Query layer.** Small server-side module (e.g. `src/lib/bridge/`)
   exposing exactly what later phases need: list clips by status; get an
   analysis payload + its marked units for a video; list a user's
   `video_unit_marks` with video context. S3 may only read through this.

Exit: migration applied to Neon; `npm run build` + lint + typecheck green;
seed script run against dev DB; `/api/generate` works with the constant gone
and logs spend; PR merged.

### O2 — Capture + bridge

1. **Save-clip route** `POST /api/clips`: body `{ url, note? }`. Auth:
   existing session cookie OR `Authorization: Bearer <CLIP_TOKEN>` (new env
   var, documented in `.env.example`) so share-sheet/Shortcut flows work
   without a cookie. Dedupe on URL (re-save updates `note`, doesn't
   duplicate). Derive `platform` from the URL.
2. **YouTube wiring.** A YouTube clip immediately reuses the existing
   by-URL ingest path (captions + screening/analysis as configured) —
   status `ingesting` → `analyzed`, `video_id` set. Never a second
   pipeline. Non-YouTube: store with metadata floor per §1.7, stay
   `unprocessed`.
3. **Promote endpoint.** `POST /api/ideas/promote`: from a
   `video_unit_mark` or one entry of `analyses.ideas`, plus a `brandId` and
   format/platform, insert an `ideas` row (status `proposed`,
   `source_analysis_id` set). One cheap Anthropic call MAY adapt the copy to
   the brand's voice/language (through the spend cap); no web search.
4. **Seed-from-analysis in `/api/generate`.** Optional `analysisId` in the
   body: the stored payload (summary/takeaways/topics) goes into the prompt
   as grounding, replacing or supplementing web search. Ideas produced this
   way carry `source_analysis_id`.

Exit: build/lint/typecheck green; saving a YouTube URL via Bearer token ends
`analyzed` with a linked video (verified against dev DB); promote inserts a
correctly-linked idea; `/api/generate` with `analysisId` produces grounded
ideas; PR merged.

## §6. Sonnet phases

Hard limits per §4.7 apply to both.

### S3 — Surfaces: inbox UI + capture ergonomics

1. **Inbox page** (`/inbox` or similar, matching the app's existing UI
   conventions/styles): clips newest-first, filter by status/platform,
   showing note + fetched metadata; a clip links to its video page when
   ingested; inline actions: promote (opens brand/format picker → calls
   O2's endpoint), dismiss/delete, retry failed.
2. **Promote/seed touchpoints** in the existing YouTube views: on an
   analysis page, "promote to idea" on each takeaway/idea/marked unit; on
   the brand ideas page, "seed from a video" (picker over analyzed videos →
   `/api/generate` with `analysisId`).
3. **Capture path**: web app manifest with `share_target` pointing at a
   thin page that posts to `/api/clips`; plus `docs/CAPTURE.md` with exact
   steps for an iOS Shortcut hitting the route with the Bearer token.
4. Quick-add form on the inbox page (paste URL + note) as the fallback.

Exit: build/lint/typecheck green; share-target manifest validates; full
manual flow works on dev (save → appears in inbox → promote → idea appears
for the brand); PR merged.

### S4 — Hostinger worker + IG/FB metadata (conditional)

**Gate first:** read §9 for the probe verdict (§7.2). No verdict recorded →
stop and ask Anton to run it. Verdict PASS and no other job needs the
worker → skip the worker, build only the IG/FB fetch below Vercel-side,
note the skip in §9.

1. **Worker** (if gated in): minimal Node service for the existing Hostinger
   slot (deploy per the `nextjs-deploy-hostinger` skill): one authed webhook
   endpoint the Vercel app calls with a job (`fetch_captions` | `fetch_clip_
   metadata`); worker calls back to a Vercel callback route with the result.
   Shared secret in env both sides. No polling, no queue infra beyond a
   simple in-process queue.
2. **IG/FB metadata fetch**: best-effort oEmbed/OpenGraph fetch for
   title/author/thumbnail on saved IG/FB clips, run worker-side when the
   worker exists, else Vercel-side. Failure is normal: clip stays useful on
   URL + note (§1.7); record the failure on the clip row, no retry storms.

Exit: build green both apps; a saved IG clip gains metadata when fetchable
and degrades cleanly when not; worker (if built) deployed and round-trips a
job; PR merged; final closing report to Anton (live URLs, manual-steps list).

## §7. Human-inputs checklist

| Input | First needed | Status |
|---|---|---|
| 1. Confirm the app is actually deployed on Vercel + Neon env vars set, then run `npm run db:migrate && npm run db:seed` | before O1 merge (migration hits Neon) — **still open, O1 could not reach a database** | ☐ |
| 2. Caption probe verdict from Vercel (`npm run yt:probe-captions` from the deployed env, or ask a session to add a probe route) | S4 gate | ☐ |
| 3. `CLIP_TOKEN` value set in Vercel env (session generates, Anton stores) | O2 | ☐ |
| 4. iOS Shortcut created on the phone per `docs/CAPTURE.md` | after S3 | ☐ |
| 5. Hostinger SSH/panel access for the worker slot | S4, only if gated in | ☐ |

## §8. Open business questions (parked)

- **Move the app's paid model calls from the Anthropic API to Gemini?**
  Anton's preference, on cost, recorded 2026-08-28. Parked, not decided, and
  explicitly NOT part of O2/S3/S4 — it is its own phase after the build lands,
  because it touches money math and every generation path at once. What it
  actually involves, so the decision is made on facts:
  - Two paid paths: the YouTube analysis/screening pipeline (Haiku 4.5,
    ~$0.02/video, uses the Batch API's 50% discount) and `/api/generate`
    (Opus 5 + up to 8 paid web searches — the expensive one by an order of
    magnitude).
  - Portable: `spend_log`, `withSpendCap`, the reservation row, and the
    per-model rate tables in `src/lib/analysis/pricing.ts`. None of that is
    Anthropic-specific; only the numbers in it are.
  - Not portable without work: tool-use/response shapes, the Batch API
    discount the analysis pipeline is priced around, prompt caching, and the
    server-side `web_search` tool (Gemini's equivalent is Search grounding,
    billed differently).
  - **The cheap lever first:** `ANTHROPIC_MODEL` already switches the
    ideation call, and `IDEATION_MODEL_RATES` already prices Sonnet 5 and
    Haiku 4.5. Dropping that one call from Opus to Sonnet cuts its token cost
    ~60% with no code change at all. Measure a few real runs against the cap
    before deciding a provider swap is what the bill needs.
- Pay for audio transcription of IG/FB clips later? (~20x captions-based.)
- Merge `research_notes` with `topics`/`entities` into one signal table, or
  keep the soft link? (~20 writer call-sites in `/youtube` make this a real
  refactor — not this build.)

## §9. Build log & handoff

*(append-only; every phase adds an entry before merging its PR)*

### 2026-08-28 — O1 Foundation (PR #6)

- **Exists now:** `brands` is the single source of truth — `src/lib/brands.ts`
  and the `BRANDS` constant are deleted, seed data lives in `src/db/seed.ts`
  (insert-only by default, `--overwrite` to push edits back, never duplicates).
  Migration `0003` adds the `clips` table and `ideas.source_analysis_id`, no FK
  constraints, with relations for clip→video, clip→idea, idea→analysis.
  `/api/generate` runs inside `withSpendCap` and logs its real cost (tokens +
  $10/1k web searches) to `spend_log`; it answers 429 when the cap refuses.
  `src/lib/bridge/` is the read-only query layer S3 must go through.
- **Decisions/deviations:** (a) the seed no longer overwrites existing rows —
  §5.O1 said "idempotent upsert", but an upsert that re-applies file literals
  clobbers a voice edited in the database, so insert-only is the default and
  overwrite is a flag; (b) retiring the constant meant touching `/` and
  `/brand/[id]` despite the phase's "no UI" rule — the markup is unchanged,
  only the data source, and both are now `force-dynamic`; (c) the ideation call
  streams now (16k output on a thinking model exceeds the non-streaming
  timeout); (d) the branch is `claude/opus-1-foundation-prompt-io65cd`, not
  `phase/o1-foundation` — the session harness pins the branch name.
- **Not done:** migration not applied and seed not run — no `DATABASE_URL` in
  the build session (§7 item 1, still ☐). `/api/generate` therefore never
  executed end-to-end. Two commands: `npm run db:migrate && npm run db:seed`.
- **Next phase looks first at:** `src/lib/bridge/` (add O2's reads there, not
  in the routes), `src/db/schema.ts`'s `clips` state machine for the statuses
  O2 must drive, and `generateContentPlan` in `src/lib/anthropic.ts` for how a
  paid call is wrapped — the promote endpoint's cheap adaptation call and the
  `analysisId` grounding path both go through the same cap. `KNOWN-ISSUES.md`
  is new; read it before assuming the dev DB has the tables.

## §10. Backlog

- videos→brands join table, if a query ever needs it (§1.3).
- Provider abstraction for paid calls (one module behind which Anthropic or
  Gemini sits), if §8's Gemini question is answered yes. Until then: new call
  sites go through the existing helpers, never their own client.
- Telegram-bot capture path as an alternative to the PWA share target.
- Retry/backoff policy for failed clip ingests beyond manual retry.
