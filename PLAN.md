# PLAN — merging YT + content-engine, and what's next

This is the plan doc the repo didn't have. It exists because a merge already
happened (§1) without anyone writing down what it did or didn't connect, and
because this session made real infra decisions (§2) that weren't recorded
anywhere either. Read this before starting new work here.

---

## 0. What this app is, as of today

One Next.js app, one Neon Postgres DB, two halves that don't talk to each
other yet:

- **The content half** (original scope): pick a brand, hit "Generate ideas",
  get researched ideas + ready-to-post captions. `brands`, `research_notes`,
  `ideas`. This is what `README.md` describes.
- **The YouTube half** (ported in, §1): ingest a channel/video, fetch
  captions, run a paid Anthropic analysis (summary/takeaways/topics/entities),
  browse it, listen to it, mark passages. Lives under `/youtube/*`. This is
  the entire former `yt` repo (Hostinger/MySQL) with its schema converted to
  Postgres.

They share one repo, one deploy, one login system, and one Anthropic client.
They do **not** share data — see §3.

---

## 1. Status — the merge already happened

Contrary to what I told you earlier in this conversation: **yes, we already
combined them.** Commit `13433bf` ("Merge YouTube intelligence workspace into
content-engine") ported the whole `yt` repo in as `/youtube/*` — schema
converted MySQL→Postgres, shared login, shared Anthropic client — and a
follow-up PR (#3, merged) added the caption-fetch resilience layer (health
tracking + optional proxy) on top, explicitly "before the Vercel move." Both
are on `main` today.

What that merge did NOT do, because it wasn't its job:

- **No data linkage.** `brands`/`research_notes`/`ideas` and
  `sources`/`videos`/`transcripts`/`analyses`/`topics`/`entities` sit in the
  same database with zero foreign keys between them. "Generate ideas" cannot
  see anything the YouTube half has ever ingested or analyzed.
- **No deploy verification.** `README.md` documents Vercel as the deploy
  target; nothing in this repo confirms it has actually been deployed there,
  or that the caption probe has been run from Vercel's IP (the reason PR #3
  exists in the first place — see `docs/CAPTION-FETCH-RESILIENCE.md`).
- **No save-clip inbox.** Neither half has a "save a link now, deal with it
  later" surface. See §4.

---

## 2. Infra decisions made this session (not yet written down anywhere else)

- **Home stays Vercel + Neon**, not Hostinger. This is a personal tool, not a
  product being sold — Vercel's free tier and zero-maintenance deploys win
  over saving a Hostinger Node.js slot you already have paid for and aren't
  using elsewhere.
- **The existing Hostinger slot becomes a background worker**, not a second
  app. It handles the two things Vercel's serverless functions are a bad fit
  for: long-running/blocking jobs (execution-time caps) and anything that
  needs a stable, already-proven-working outbound IP (caption fetching —
  datacenter IPs, Vercel's included, get blocked by YouTube; the Hostinger
  box's IP was verified to work). Triggered by a webhook or queue from the
  Vercel app, not cron-polled by it. **Not built yet.**
- **No GitHub Actions dependency for anything the app needs to run.** GitHub
  Actions stays CI-only (typecheck/build/test on push, standard usage). The
  free tier is 2,000 min/month on private repos, unlimited on public — and
  these repos are going back to private soon, which reintroduces that cap.
  Nothing about ingest, analysis, rendering, or the clip inbox may require an
  Actions run to function.
- **`CAPTION_PROXY_URL` stays the fallback**, not the default. Run the probe
  from Vercel first (`npm run yt:probe-captions`, per
  `docs/CAPTION-FETCH-RESILIENCE.md`); only reach for a proxy or the
  Hostinger relay if it comes back blocked.

---

## 3. The real gap: wiring the two halves together

The whole point of merging was "share and double tap on the research and
ideas and data" — that's still undone. Concretely:

- `ideas` generation (`/api/generate`) only calls the Anthropic web-search
  tool. It has no path to read `analyses.payload` (takeaways/topics/entities)
  for videos already ingested and paid for under `/youtube`.
- `research_notes` (shared across brands, tagged by brand) and `topics`/
  `entities` (shared across YouTube sources) are two independently-built
  versions of the same idea — "signal worth reusing, tagged by what it's
  relevant to" — that don't reference each other.

**Proposed shape**, to validate before building: add a nullable
`source_video_id` (→ `videos.id`) on `ideas`, and a `brand_id` (→ `brands.id`,
nullable) on `videos`/`sources`, so either half can point at the other without
forcing every row to have both. `/api/generate` gains an optional "seed from
a video" path that pulls the stored `analyses` payload into the prompt instead
of (or alongside) fresh web search — cheaper and grounded in something real
rather than only what search turns up.

---

## 4. New feature: the save-clip inbox

The stated problem: clips saved from Instagram/Facebook/YouTube ("oh, a new
open-source repo, save that") get saved and forgotten. Nothing currently
catches them.

**Shape:** a `clips` table (platform, url, saved_at, status, linked video/
source id once processed) and one route to drop a link into. On save:

1. If it's a YouTube URL, route it through the existing `/youtube` ingest
   path (already does captions + analysis) instead of building a second
   pipeline.
2. If it's Instagram/Facebook, there is no caption/transcript to grab the
   same way — this needs its own fetch step (oEmbed/scrape for metadata at
   minimum; audio transcription if the point is searchable content, which
   costs money per §11 of the old `yt` `PLAN.md`'s reasoning on that
   tradeoff).
3. Either way, the clip lands in a searchable inbox — status `unprocessed` →
   `analyzed` → (optionally) `turned into an idea`, linking to `ideas` via
   §3's `source_video_id` once that exists.

This is genuinely new work, not a port — nothing in either original repo did
"save now, understand later" for non-YouTube platforms. Build it after §3's
linkage exists, so a saved clip has somewhere to plug into on day one instead
of sitting in its own dead-end table.

---

## 5. Suggested build order

| # | Scope | Depends on |
|---|---|---|
| 1 | Run the caption probe from Vercel; confirm the deploy is actually live there | none — do this first, it's a decision gate like the old `yt` PLAN.md's A0 |
| 2 | §3 data linkage: `source_video_id` on `ideas`, `brand_id` on `videos`/`sources`, migration only, no UI yet | 1 |
| 3 | `/api/generate` "seed from a video" path | 2 |
| 4 | Hostinger worker: webhook endpoint + the one job that needs it most (caption fetch, if Vercel's probe comes back blocked) | 1 |
| 5 | `clips` table + save-link route + inbox list view (YouTube links only — reuses existing ingest) | 2 |
| 6 | IG/FB clip support in the inbox (own fetch step, no transcript by default) | 5 |

Batches 2–3 and 4 are independent of each other — do 4 only if step 1 shows
Vercel is actually blocked; otherwise skip it and revisit if/when a job
genuinely needs the worker.

---

## 6. Open decisions (yours, not code)

- Does a saved IG/FB clip get transcribed (cost per §11 of the old `yt`
  `PLAN.md` — audio transcription is ~20x a captions-based analysis) or does
  the inbox work off title/caption/metadata only until you decide it's worth
  paying for more?
- Should `research_notes` and `topics`/`entities` actually merge into one
  table, or stay separate with a link? Merging is cleaner long-term but the
  ~20 `topics`/`entities` writers in `/youtube` and the `research_notes`
  writer in `/api/generate` would both need updating — not a small find-and-
  replace.
