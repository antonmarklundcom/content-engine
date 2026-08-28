# Known issues

Minor, non-blocking findings recorded per PLAN.md §4.3 — things a later phase
should know about but that were not worth stopping a build for.

## S3 — Inbox UI + capture ergonomics

- **Still no `DATABASE_URL` in the build session — the whole live flow is
  unverified.** Same constraint as O1/O2 (below): `npm run build`, `npm run
  typecheck` and `npm run test` (177 tests) are all green, but no clip has
  actually been saved through `/inbox`'s quick-add form or the simulated
  `/share` POST, no promote button has actually been clicked against a real
  analysis, and no seed-from-video run has actually happened. This session
  also confirmed a local Postgres cannot stand in for Neon here:
  `src/db/index.ts` uses `@neondatabase/serverless`'s `neon()` HTTP driver,
  which speaks Neon's HTTP proxy protocol, not the Postgres wire protocol a
  local `postgresql-16` install answers — changing that is a foundation-layer
  decision (§4.7), not something this phase should do to get a local test rig.
  Whoever runs the two commands from the O1 entry should also click through
  `/inbox` once against the real dev DB.
- **Promote buttons only ever offer `analysis-idea` sources on the inbox
  page**, one per entry in `analyses.ideas`. The analysis page's promote
  buttons (next to every star) cover `unit` sources for summary/takeaways/
  hook/timeline/gaps/ideas — the inbox intentionally doesn't duplicate that
  full picker per clip; "promote one of this video's proposed ideas" is the
  common case a saved link is for. Promoting a specific starred takeaway
  from a clip still works — from the video page's own promote button, one
  click away via "Open analysis".
- **The `/share` page's URL/note guess is heuristic** (first `https?://…`
  substring in `url`, then `text`, then `title`; the note is whatever text is
  left over). Different apps hand the share target wildly different payloads
  — this is editable before saving specifically because the guess sometimes
  needs a correction, not because it usually will.
- **Retry is YouTube-only and owner-only.** A stuck/failed Instagram or
  Facebook clip has nothing to retry (§1.8 — no fetch pipeline exists yet for
  them); re-pasting the same URL through quick-add is the workaround until
  S4. Dismiss is also owner-only, matching the spend/destroy boundary
  `src/lib/auth/roles.ts` already draws for `removeSource`.
- **`share_target`'s manifest field isn't in Next's `MetadataRoute.Manifest`
  type** (`src/app/manifest.ts`) — cast around it rather than widen the type,
  since it's a real, broadly-supported manifest field the type just hasn't
  caught up to yet.

## O2 — Capture + bridge

- **Nothing in O2 has been run against a database.** Same missing
  `DATABASE_URL` as O1 (below). The code typechecks, builds and passes its unit
  tests, but no clip has been saved, no video ingested through `/api/clips`, no
  idea promoted, and no grounded generation run. Every O2 exit criterion is
  waiting on the two commands in the O1 entry. Treat the routes as unverified
  until someone runs them.

- **A clip can get stuck in `ingesting`.** `processYouTubeClip` sets that
  status, then does the work in the same request. If the request dies mid-way
  (a Vercel timeout on a very long video, a redeploy), the row keeps a status
  nothing will clear on its own. Re-saving the same URL re-runs the pipeline,
  which is the manual retry — S3's inbox should expose that as a retry button.
  A reaper for rows stuck in `ingesting` is not worth building until one
  actually sticks.

- **`/api/clips` is excluded from the session middleware.** It has to be — a
  share sheet sends no cookie and would get a 307 to the login page, which a
  Shortcut reports as success. The route authenticates itself (cookie OR
  Bearer) and fails closed on both paths, but it is now the second route whose
  auth is its own (the first is `/api/cron/poll`). Worth re-reading whenever
  either is touched.

- **Non-YouTube clips are stored and left alone.** No metadata fetch for
  Instagram/Facebook yet — that is S4's job, and §1.7 is the reason it is safe
  to defer: URL + note is the floor.

## O1 — Foundation

- **The migration and seed have not been run against the Neon dev DB by a
  session.** No `DATABASE_URL` is available inside the build sessions
  (`.env` is gitignored and the value lives only in Vercel/Neon), so
  `drizzle/0003_sticky_human_torch.sql` was generated but applied nowhere. It
  is a two-command manual step, and it is human-inputs checklist item 1 in
  PLAN.md §7:

  ```bash
  npm run db:migrate   # applies 0003 (clips + ideas.source_analysis_id)
  npm run db:seed      # inserts the 11 brands; re-running is a no-op
  ```

  Until it is run, `/` and `/brand/[id]` render an empty brand list and
  `/api/generate` answers `unknown brandId` for every id — the code is correct,
  the table is just empty. O2's exit criteria verify against the dev DB and so
  will hit this first.

- **`/api/generate` has not been executed end-to-end.** Same reason plus no
  `ANTHROPIC_API_KEY` in the session environment. The spend path it now goes
  through (`withSpendCap` → call → `recordSpend`) is the same machinery the
  analysis pipeline has been running on, and the arithmetic added for it is
  covered by `src/lib/analysis/pricing.test.ts`, but no row has been written to
  `spend_log` from this route yet.

- **There is no lint step in this repo.** `package.json` has `typecheck`,
  `test` and `build`; no ESLint config or dependency exists. `next build`'s
  own "Linting and checking validity of types" pass is what the phase exit
  criteria's "lint" amounts to today. Adding ESLint is not in the plan — if a
  later phase wants it, it is a decision for Anton, not a phase deliverable.

- **The `estimateContentPlanCostUsd` search-token figure is a guess.**
  6,000 input tokens per web search is an order-of-magnitude estimate, not a
  measurement. It only sets the size of the reservation held during the call
  (the *billed* figure comes from `usage`), and it errs high on purpose. Worth
  re-baselining against a few real `usage` readings once the route has run.
