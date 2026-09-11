# PLAN — content-engine build 2: verify, harden, unify (phased autonomous build)

Build 1 (O1–O3, S3; 2026-08-28/29) wired the brand-ideation half and the
YouTube half together and added the clip inbox. Its plan and build log are
preserved verbatim in `docs/PLAN-v1-build1.md`. Its outcome: **every phase is
"code complete, UNVERIFIED"** — no build session could reach a database or the
Gemini API. Build 2 exists to fix that first, then to fix what the review
(`docs/REVIEW-2026-09-11.md`) found on top of it.

Same repo, same stack: Next.js (App Router) on Vercel, Neon Postgres via
drizzle, Gemini via `@google/genai`, all paid calls through `src/lib/ai.ts`
and `withSpendCap`.

## Phase table

Lane 1 runs first, sequentially, on Opus. When O6 merges, it creates the
watcher Routine and spawns every lane 2 phase at once. S9 runs after all of
lane 2 has merged.

| Phase | Lane | Model | Prompt file | Plan § | Owns | Depends on |
|---|---|---|---|---|---|---|
| O4 Verification foundation | 1 | Opus | `prompts/opus-4-verify-foundation.md` | §5.O4 | `src/db/index.ts`, `src/db/migrate.ts`, `src/db/seed.ts`, `drizzle.config.ts`, `package.json`, `package-lock.json`, `.github/**`, `tests/**`, `.env.example`, `docs/log/o4.md` | — |
| O5 Gemini double + live smoke | 1 | Opus | `prompts/opus-5-gemini-double-smoke.md` | §5.O5 | `src/lib/ai.ts` (test-double seam only), `src/lib/ai-fake.ts`, `scripts/smoke.ts`, `tests/integration/**`, `package.json` scripts, `docs/log/o5.md` | O4 |
| O6 Production hardening + lane-2 prep | 1 | Opus | `prompts/opus-6-prod-hardening.md` | §5.O6 | `vercel.json`, `src/app/api/cron/**`, `src/lib/poll.ts`, `src/lib/lease.ts`, `src/app/api/generate/route.ts`, `src/lib/clips/save.ts` (reaper hook only), `src/db/schema.ts`, `drizzle/**`, `src/lib/i18n/**` (split only), `prompts/_watcher.md` (fill in ids), `docs/log/o6.md` | O5 |
| S5 One design system | 2 | Sonnet | `prompts/sonnet-5-design-system.md` | §6.S5 | `src/app/page.tsx`, `src/app/layout.tsx`, `src/app/brand/**`, `src/app/globals.css`, `src/components/TopNav.tsx`, `src/components/Header.tsx`, `src/components/Brand*.tsx` (new), `src/lib/i18n/dict/brands.ts`, `docs/log/s5.md` | O6 |
| S6 Ideas workflow | 2 | Sonnet | `prompts/sonnet-6-ideas-workflow.md` | §6.S6 | `src/app/api/ideas/**`, `src/lib/bridge/ideas.ts` (new), `src/lib/ideas.actions.ts` (new), `src/components/Idea*.tsx` (new), `src/lib/i18n/dict/ideas.ts`, `tests/integration/ideas.test.ts`, `docs/log/s6.md` | O6 |
| S7 Caption probe route | 2 | Sonnet | `prompts/sonnet-7-probe-route.md` | §6.S7 | `src/lib/youtube/captions/probe.ts` (new), `scripts/probe-captions.ts`, `src/app/youtube/admin/**` (new), `src/app/api/admin/**` (new), `src/lib/i18n/dict/admin.ts`, `docs/log/s7.md` | O6 |
| S8 Docs + DX | 2 | Sonnet | `prompts/sonnet-8-docs.md` | §6.S8 | `README.md`, `CONTRIBUTING.md` (new), `docs/CAPTURE.md`, `docs/CAPTION-FETCH-RESILIENCE.md`, `docs/VERIFY.md` (new), `docs/log/s8.md` | O6 |
| S9 Link pass | — | Sonnet | `prompts/sonnet-9-link-pass.md` | §6.S9 | ESLint/Prettier config + repo-wide autofix, `.github/workflows/ci.yml` (lint step), `KNOWN-ISSUES.md`, `src/components/Header.tsx` nav, `docs/log/s9.md` | S5–S8 |

Right-sizing: every phase is one session, ≤ 90 minutes. If a phase cannot
finish in that, it was two phases — split it in this file, not in the session.

---

## §1. Decisions already made — do not re-litigate

Items 1–11 are carried from build 1 (full text in `docs/PLAN-v1-build1.md`
§1) and still hold: **1** home is Vercel + Neon; **2** no GitHub Actions
dependency at runtime; **3** `ideas.source_analysis_id` is the only cross-half
link, no `brand_id` on videos/sources; **4** no FK constraints, soft links +
drizzle `relations`; **5** the `brands` table is the source of truth;
**6** capture before processing; **7** URL + note is a clip's guaranteed
floor; **8** no audio transcription for IG/FB; **9** the caption probe gates
IG/FB/worker work; **10** one spend cap; **11** Opus and Sonnet only, never
Fable for phases.

Decided 2026-09-11 (Fable review, `docs/REVIEW-2026-09-11.md`):

12. **Verifiability is the foundation.** No feature phase starts until O4
    and O5 have run the build-1 code against a real Postgres and a Gemini
    test double in CI, and the live smoke has run at least once.
13. **Two drivers, one schema.** `src/db/index.ts` uses Neon's HTTP driver
    when `DATABASE_URL` is a Neon host (or `DB_DRIVER=neon`), and
    `drizzle-orm/node-postgres` (`pg`) otherwise. Same `schema`, same
    exports, same call sites. Production behaviour is unchanged.
14. **Migrations and seed run on deploy.** `vercel-build` =
    `db:migrate && db:seed && next build`. The seed is insert-only, so this
    is idempotent. Old §7.1 is closed by this, permanently.
15. **CI is GitHub Actions** with a `postgres:16` service container:
    typecheck → unit tests → migrate → integration tests → build. A PR that
    is red does not merge. Lint is added to the same workflow by S9.
16. **Gemini has a test double.** `GEMINI_FAKE=1` (or a missing key under
    `NODE_ENV=test`) swaps the client for `src/lib/ai-fake.ts`, which returns
    canned responses **with realistic `usageMetadata` and
    `groundingMetadata`** so the spend arithmetic is exercised, not skipped.
    The seam is the existing `geminiClient()`; nothing else in `ai.ts` learns
    about the fake.
17. **One live smoke script** (`npm run smoke`) runs against a real
    `DATABASE_URL` + `GEMINI_API_KEY`: one generate, one promote with
    `adapt`, one clip save (YouTube), one interactive analysis; prints the
    `spend_log` delta and the raw usage figures. It is the only thing that
    ever needs real credentials, and it is what re-baselines the reservation
    estimates in `ai.ts`.
18. **Vercel Cron is the scheduler.** `vercel.json` declares
    `/api/cron/poll` hourly. Vercel sends `Authorization: Bearer $CRON_SECRET`;
    `cron-auth.ts` already accepts it. The route gets `maxDuration = 300`.
19. **The poll lock is a DB lease**, not a module variable: one row in a
    `leases` table (`name` pk, `holder`, `expires_at`), acquired with a single
    `INSERT … ON CONFLICT DO UPDATE … WHERE expires_at < now()` statement so it
    works over Neon's single-statement HTTP driver. A dead run's lease expires
    on its own.
20. **Spend is owner-only, everywhere.** `/api/generate` requires the owner
    (same `ForbiddenError` → 403 shape as promote's `adapt`). Reading and
    editing ideas stays open to any signed-in user.
21. **Clips stuck in `ingesting` for > 15 minutes are failed by the poll
    run** with a retryable error; the inbox's existing retry covers them.
22. **One design system.** The Tailwind token system, `Header` +
    `SpendMeter`, and i18n cover the whole app. The `@layer legacy` CSS and
    the `:not([data-youtube-section] *)` scoping hack are deleted. This is a
    port, not a redesign: same information, same actions.
23. **Ideas gain a `posted` status and `posted_at`** (O6 adds both; S6
    builds the UI). Still no scheduling, no posting integration.
24. **The caption probe is an owner-only route** (S7) so the S4 verdict can
    come from the production IP. IG/FB metadata fetch and the Hostinger
    worker stay in §10 until a verdict is on file in `docs/decisions-needed.md`.
25. **ESLint (`next/core-web-vitals` + `@typescript-eslint`) and Prettier
    are adopted in S9**, sequentially, because a repo-wide autofix touches
    every file every parallel phase owns.
26. **i18n dictionary is split per feature before lane 2** (O6):
    `src/lib/i18n/dict/<feature>.ts`, spread into `dictionary.ts`. A lane 2
    phase owns its own dict file and adds exactly one import line.

## §2. Object model

Unchanged from build 1 (see `docs/PLAN-v1-build1.md` §2 and
`src/db/schema.ts`). Build 2 adds:

- **`leases`** — `name text pk`, `holder text`, `expires_at timestamp`.
  Owned by `src/lib/lease.ts`. First user: `poll`.
- **`ideas.posted_at`** (nullable timestamp) and `posted` in
  `IDEA_STATUSES`. `posted` is terminal for the app's purposes.
- Everything else is test/CI scaffolding, not schema.

## §3. Feature scope, by dependency

- **A. Verifiable** (O4 → O5): driver switch, CI, integration harness,
  Gemini fake, smoke script, migrate-on-deploy.
- **B. Correct in production** (O6, needs A): cron, lease, `maxDuration`,
  owner-gated generate, clip reaper, research-note linking fix, dict split,
  `posted` status.
- **C. Unified surfaces** (S5, S6, S7, S8; need B; parallel): design system
  port; ideas workflow; probe route; docs.
- **D. Link pass** (S9, needs C): lint adoption, nav, KNOWN-ISSUES prune,
  closing report.

## §4. Autonomy protocol

Every phase session works under these rules; each prompt re-states the ones
it most needs.

1. Work until the phase's exit criteria all pass; never ask permission for
   in-plan work.
2. One PR per phase. Branch `phase/<id>` off latest main — or the branch the
   session harness pins (`claude/…`), which is fine; note it in the log.
   Create, watch, and merge the PR when CI is green. A red build is always
   the session's own work. Lane 2 phases never wait for each other, only
   for O6.
3. Minor non-blocking issues → the phase's `docs/log/<id>.md` "Known
   issues". Only still-open, cross-phase items are promoted to the root
   `KNOWN-ISSUES.md`, by S9.
4. Stop and ask ONLY for: a missing credential with no graceful fallback, or
   a bad-foundation decision (schema, auth, money math, route contract)
   where guessing wrong forces a rewrite. "Ask" means: append the question
   to `docs/decisions-needed.md`, commit, push, end the session. Never wait
   in the session for an answer.
5. Missing env values never block: document in `.env.example`, degrade
   gracefully.
6. Every prompt is re-runnable: check what exists on the branch first,
   continue from the first unmet exit criterion. WIP commit at least every
   30 minutes.
7. Lane 2 hard limits: no schema, auth, spend-cap, ingest/analysis-pipeline,
   or `src/lib/ai.ts` changes. Data access only through `src/lib/bridge/`
   and the existing actions. Blocked by the limit → workaround + §10 note.
8. **Model cost guardrail.** Fable/Mythos-class models are never used for
   phases, subagents, spawned sessions, watchers or Routines. If one seems
   needed, write why to `docs/decisions-needed.md` and end.
9. **File ownership.** A phase writes only to its Owns column, plus: its own
   `docs/log/<id>.md`, its own new files, one import line in
   `src/lib/i18n/dictionary.ts`, one line in `docs/decisions-needed.md`.
   On `git merge main` conflicts: main wins, re-apply your change on top,
   re-run CI. Never edit a file outside Owns to resolve a conflict — log it
   in `docs/decisions-needed.md`, push, end.
10. **Handoff / spawning.** A phase is done when four gates pass: PR merged
    green; exit checklist passed; pre-handoff audit (ONE re-run of
    `npm run verify` on main + ONE adversarial re-read of the merged diff,
    findings fixed in ONE follow-up commit); phase log committed. Then per
    `prompts/_handoff.md`: lane 1 phases spawn the next lane 1 phase; O6
    creates the watcher Routine and spawns all lane 2 phases (≤ 4 running);
    lane 2 phases spawn nothing; S9 deletes the watcher and stops.
11. **Phase log** `docs/log/<id>.md`: ≤ 12 lines "Built", ≤ 8 "Decisions",
    ≤ 8 "Known issues", one line "Verification: CI green on <sha>". Add the
    index line to §9.
12. **Orientation read.** A fresh session reads: its prompt file, §1, §4, its
    own §5/§6 section, the phase table, §9's index, and `docs/log/<dep>.md`
    for its Depends on. Not the old plan, not every log.
13. **Polish cap.** ONE screenshot pass (≤ 5 pages × 2 widths, CI artifact,
    never committed — `docs/screenshots/` is git-ignored), PR body written
    once (≤ 25 lines). When exit criteria pass, open the PR that turn.
14. **Decisions travel by files.** To change a running phase, edit its
    prompt file on main. Never message a running session.
15. **`npm run verify`** is the one command every phase runs before opening a
    PR: `typecheck && test && test:db && build` (O4 defines it; O5 adds the
    fake-Gemini integration tests to `test:db`).

## §5. Lane 1 — Opus phases

### O4 — Verification foundation

1. **Driver switch** (§1.13). `src/db/index.ts`: detect Neon by hostname
   (`*.neon.tech`) or `DB_DRIVER=neon`; otherwise `drizzle-orm/node-postgres`
   with a `pg` `Pool`. `closeDb()` becomes real for the pool. `migrate.ts`
   and `drizzle.config.ts` follow the same rule. Add `pg` + `@types/pg`.
   The exported `db`/`schema` surface is unchanged; grep to prove no call
   site imports the driver directly.
2. **Migrate on deploy** (§1.14). `"vercel-build": "npm run db:migrate && npm run db:seed && next build"`.
   Seed stays insert-only. Document in `.env.example` and `README` (one
   paragraph; S8 rewrites the README).
3. **Integration harness.** `tests/integration/setup.ts` (connect, migrate,
   truncate between tests) using `node:test` like the unit tests, run by
   `npm run test:db` against `DATABASE_URL`. First tests, against real SQL:
   `spend.ts` (record, reserve, cap trip, release), `clips/save.ts`
   (upsert, note coalesce, `created` flag), `promote.ts` verbatim path,
   `bridge/*` reads over seeded rows, seed idempotence (`db:seed` twice, same
   row count). No Gemini yet — anything that would call it is out of scope
   until O5.
4. **CI** (§1.15). `.github/workflows/ci.yml`: Node 22, `postgres:16`
   service, `npm ci`, `typecheck`, `test`, `db:migrate`, `test:db`, `build`
   with placeholder env (`SESSION_SECRET`, `DATABASE_URL` → the service).
   Concurrency group per branch. Plus a `screenshots` job scaffold that runs
   `tests/screenshots.mjs` (Playwright, Chromium) against `next start` and
   uploads `docs/screenshots/` as an artifact — S5 fills the page list.
5. **`npm run verify`** (§4.15) and a `docs/log/o4.md`.

Exit: CI green on the PR with `test:db` running ≥ 12 integration tests
against the service container; `npm run verify` passes locally against the
session's Postgres; `vercel-build` script present; PR merged.

### O5 — Gemini test double + live smoke

1. **The fake** (§1.16). `src/lib/ai-fake.ts` implements the subset of
   `GoogleGenAI` that `ai.ts`, `analysis/run.ts`, `analysis/batch.ts`,
   `screening/run.ts`, `analysis/outline.ts` use (`models.generateContent`,
   `models.generateContentStream`, `batches.create/get`). Responses are
   schema-valid for each JSON schema in the repo, with `usageMetadata`
   (`promptTokenCount`, `candidatesTokenCount`, `thoughtsTokenCount`,
   `cachedContentTokenCount`) and, for grounded calls, `groundingMetadata.
   webSearchQueries`. `geminiClient()` returns it when `GEMINI_FAKE=1`.
   The fake records every call so a test can assert what was sent.
2. **Integration tests through the routes**: `/api/generate` (ideas inserted,
   `spend_log` row equals the fake's usage priced by `pricing.ts`, 429 when
   the cap is 0), promote with `adapt`, `/api/clips` Bearer path with the
   fake analysis, one `pollSources()` dry run and one real run collecting a
   fake batch. Call route handlers directly (`POST(new Request(...))`).
3. **Smoke** (§1.17). `scripts/smoke.ts`: refuses to run with `GEMINI_FAKE`;
   requires `DATABASE_URL` + `GEMINI_API_KEY`; runs the four live actions
   against a brand id given on the CLI; prints `spend_log` before/after,
   each call's `usageMetadata`, `webSearchQueries.length`, and the
   reservation each call held, so `ESTIMATED_THINKING_TOKENS`,
   `MAX_GROUNDING_QUERIES` and `PROMPT_OVERHEAD_TOKENS` can be re-baselined.
   `--dry-run` prints what it would do and the estimates.
4. **Run the smoke if the session has the credentials** (§7.1). If it does,
   record the figures in `docs/log/o5.md` and adjust the three estimates in
   `ai.ts` if a real run exceeded its reservation. If it does not, write the
   exact command Anton runs to `docs/decisions-needed.md` and continue — this
   is not a §4.4 stop.

Exit: CI green with fake-Gemini integration tests covering generate,
promote-adapt, clips, poll; `npm run smoke -- --dry-run` works; smoke either
run (figures logged) or its command handed off; PR merged.

### O6 — Production hardening + lane-2 prep

1. **Cron** (§1.18): `vercel.json` `{"crons":[{"path":"/api/cron/poll","schedule":"0 * * * *"}]}`;
   `export const maxDuration = 300` on the route; fix the route's comment.
2. **Lease** (§1.19): `leases` table + migration; `src/lib/lease.ts`
   `withLease(name, ttlMs, fn)`; the poll route uses it instead of
   `running`. Integration test: two concurrent calls, one 409.
3. **Owner-gated generate** (§1.20): `/api/generate` → `getSession` +
   `isOwner`, 401/403 with the same JSON shape promote uses. Test.
4. **Clip reaper** (§1.21): inside `pollSources`, before ingest, rows
   `ingesting` with `saved_at`/last update older than 15 min → `failed`,
   error "Ingest timed out — retry". Test.
5. **Research-note link fix**: an idea links to a note only when the fake
   /model returned it with this brand in `relatedBrandIds`; otherwise null.
   Query notes with a `jsonb` containment on `related_brand_ids` instead of
   loading all rows.
6. **`posted` status** (§1.23): `IDEA_STATUSES` + `posted_at` column,
   migration, `PATCH /api/ideas/[id]` sets `posted_at` on transition.
7. **Dict split** (§1.26): `src/lib/i18n/dict/{app,nav,youtube,inbox,spend,…}.ts`,
   `dictionary.ts` spreads them; `TranslationKey` unchanged; i18n tests
   green. Create empty `dict/brands.ts`, `dict/ideas.ts`, `dict/admin.ts`
   with their import lines already in place, so lane 2 never edits
   `dictionary.ts`.
8. **Watcher prep**: fill the phase ids into `prompts/_watcher.md`; verify
   `create_trigger` is available; on handoff create the Routine and spawn
   S5–S8 (§4.10, `prompts/_handoff.md`).

Exit: CI green; `vercel.json` present; lease, owner gate, reaper, notes fix
each covered by an integration test; migration 0004 generated; dict split
with zero key changes; PR merged; watcher created; S5–S8 spawned.

## §6. Lane 2 — Sonnet phases (parallel) and the link pass

Hard limits §4.7 apply to S5–S8.

### S5 — One design system

1. Port `/` (brand grid) and `/brand/[id]` onto the token system:
   `surface-card`, `text-[var(--color-ink)]`, the `Header` (with
   `SpendMeter` and nav) as the one app header — `RootLayout` renders it,
   `youtube/layout.tsx` stops rendering its own. `TopNav` is folded into
   `Header`'s nav (`Content` → `/`, then the existing items).
2. `BrandIdeas.tsx` → server component for the list + small client islands
   (generate button, seed picker, idea card with edit/approve/reject/copy),
   all copy through `t()` from `dict/brands.ts`. Use `CopyTextButton` for
   the caption. Keep every existing action working.
3. Delete `@layer legacy` and every `:not([data-youtube-section] *)`; drop
   `data-youtube-section` if nothing reads it. Confirm no page regressed
   (screenshot pass: `/`, `/brand/propia`, `/inbox`, `/youtube`,
   `/youtube/video/<id>` at 390 and 1280).
4. Fill the CI screenshot job's page list.

Exit: `grep -c "legacy\|data-youtube-section" src` = 0; `npm run verify`
green; screenshots in the CI artifact; PR merged.

### S6 — Ideas workflow

1. `src/lib/bridge/ideas.ts`: list by brand with status filter + counts, get
   one, last run's cost (sum of `spend_log` is not per-run — read `costUsd`
   returned by generate and show it in the response toast only; no schema).
2. `src/lib/ideas.actions.ts` (server actions, owner-gated where they
   destroy): set status incl. `posted`; delete a rejected idea; save edits.
3. UI in `src/components/Idea*.tsx`: status filter tabs, `posted` action,
   copy caption (already from S5's card — coordinate by using the component
   S5 creates only if it is on main; otherwise ship your own `IdeaActions`
   and let S9 dedupe), citations rendered as links, visual notes collapsed.
4. Integration test `tests/integration/ideas.test.ts` for the actions.

Exit: an idea can go proposed → approved → posted and be filtered; delete
works for rejected; `npm run verify` green; PR merged.

### S7 — Caption probe route

1. Move the probe's logic out of `scripts/probe-captions.ts` into
   `src/lib/youtube/captions/probe.ts` (`runProbe(videos) → ProbeReport`,
   with the outbound-IP lookup); the script becomes a thin CLI over it.
2. Owner-only `POST /api/admin/probe` (session, `requireOwner`) with
   `maxDuration = 300`; `/youtube/admin` page with a "Run caption probe"
   button showing the verdict table, outbound IP, and the
   `CAPTION_STRATEGIES=` line to paste into Vercel. Copy via `dict/admin.ts`.
3. Do not persist the verdict (no schema). The page tells the owner to
   paste the verdict line into `docs/decisions-needed.md`.

Exit: probe runs from the deployed Vercel function via the page; CLI still
works; `npm run verify` green; PR merged.

### S8 — Docs + DX

1. `README.md` rewritten for the whole app: what it is (both halves +
   inbox), login, env vars, local run with `pg`, `npm run verify`,
   `npm run smoke`, deploy (Vercel, cron, `vercel-build`), the plan/prompts
   workflow in three lines.
2. `CONTRIBUTING.md`: the autonomy protocol in 15 lines, file ownership,
   how to add a dict file, how to add an integration test.
3. `docs/VERIFY.md`: what CI checks, what smoke checks, what neither can.
4. Refresh `docs/CAPTURE.md` and `docs/CAPTION-FETCH-RESILIENCE.md` where
   S7's route replaces "run the CLI from the deployed env".

Exit: every command in the README runs as written; PR merged.

### S9 — Link pass (sequential, after S5–S8)

1. ESLint (`next/core-web-vitals`, `@typescript-eslint`) + Prettier; `npm run
   lint` in `verify` and in CI; one repo-wide autofix commit, then fix the
   remaining findings by hand (no rule disabled to get green).
2. Header nav final order; dedupe any component S5 and S6 both shipped.
3. Prune `KNOWN-ISSUES.md`: remove every "UNVERIFIED" item that O4–O6 now
   cover with a test; promote only still-open cross-phase items from the
   `docs/log/*.md` files.
4. Delete the watcher Routine. Closing report to Anton: what shipped per
   phase (PR links), §7 items still open, exact next manual steps.

Exit: lint green in CI; KNOWN-ISSUES only holds open items; watcher gone.

## §7. Human-inputs checklist

| # | Input | First needed | Status |
|---|---|---|---|
| 1 | **Recommended:** add a Neon *dev-branch* `DATABASE_URL` and a `GEMINI_API_KEY` (billed project, own low cap) as environment variables of the Claude Code cloud environment, so O5 can run `npm run smoke` itself. Alternative: after O5 merges, run `npm run smoke -- <brandId>` once locally and paste the printed figures into `docs/decisions-needed.md`. | O5 | ☐ |
| 2 | Vercel: confirm the project allows 300 s functions (Pro, or Fluid Compute on). `/api/generate`, `/api/clips`, `/api/cron/poll`, `/api/admin/probe` all set `maxDuration = 300`. | O6 | ☐ |
| 3 | Vercel env: `CRON_SECRET` set (Vercel Cron sends it as a Bearer token). Existing `SESSION_SECRET`, `GEMINI_API_KEY`, `DATABASE_URL`, `CLIP_TOKEN` unchanged. | O6 | ☐ |
| 4 | After S7: open `/youtube/admin`, run the probe, paste the verdict line into `docs/decisions-needed.md`. That verdict decides whether §10's IG/FB + worker item becomes a phase. | S7 | ☐ |
| 5 | Merge this plan PR before starting O4. | now | ☐ |

## §8. Open business questions (parked)

- IG/FB metadata fetch and the Hostinger worker (old S4) — waits on §7.4.
- Audio transcription for IG/FB (~20x) — no.
- Merge `research_notes` into `topics`/`entities` — no user asking.
- Scheduled/bulk generation across brands — after S6 has shown the manual
  loop is used.

## §9. Build log index

One line per phase; detail in `docs/log/<id>.md`.

| Phase | PR | Log | State |
|---|---|---|---|
| O1–O3, S3 | #6, #8, #9, #10–#12 | `docs/PLAN-v1-build1.md` §9 | merged, unverified |
| Plan v2 | this PR | `docs/REVIEW-2026-09-11.md` | — |
| O4 | #14 | `docs/log/o4.md` | merged |
| O5 | #15 | `docs/log/o5.md` | open, CI green |
| O6 | | `docs/log/o6.md` | not started |
| S5 | | `docs/log/s5.md` | not started |
| S6 | | `docs/log/s6.md` | not started |
| S7 | | `docs/log/s7.md` | not started |
| S8 | | `docs/log/s8.md` | not started |
| S9 | | `docs/log/s9.md` | not started |

## §10. Backlog

- IG/FB best-effort oEmbed/OpenGraph metadata; Hostinger relay/worker —
  gated on §7.4.
- Model the 5,000/month free grounding allowance (over-reports today).
- Re-price 3.7 Flash when the intro rate lapses (2026-12-31) — the table
  already holds the standard rate, so nothing breaks; this is a note.
- Telegram-bot capture as an alternative to the PWA share target.
- Retry/backoff for failed clip ingests beyond manual retry.
- Provider abstraction behind `ai.ts` — only if a second provider arrives.
- videos→brands join table, if a query ever needs it.
