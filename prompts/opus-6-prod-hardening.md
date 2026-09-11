# Phase O6 — Production hardening + lane-2 prep. OPUS session. Lane 1 (last).

Read ONLY: this file, `PLAN.md` §1, §4, §5.O6, the phase table and §9 index,
`docs/log/o4.md`, `docs/log/o5.md`. Execute under the autonomy protocol §4.

Owns:
- `vercel.json` (new), `src/app/api/cron/**`, `src/lib/poll.ts`,
  `src/lib/lease.ts` (new), `src/app/api/generate/route.ts`,
  `src/app/api/ideas/[id]/route.ts` (posted_at only), `src/db/schema.ts`,
  `drizzle/**` (one new migration), `src/lib/i18n/**` (split only, zero key
  changes), `tests/integration/**`, `prompts/_watcher.md` (ids only),
  `.env.example`, `docs/log/o6.md`.

Budget: one session, ≤ 90 min. Open the PR the turn the exit criteria pass.

Phase rules:
- Schema comment convention in `src/db/schema.ts` is the quality bar: every
  new table/column says why it exists. No FK constraints (§1.4).
- Lease (§1.19): one statement, `INSERT … ON CONFLICT (name) DO UPDATE SET
  holder, expires_at WHERE leases.expires_at < now() RETURNING …` — no
  transactions, no advisory locks (Neon HTTP is single-statement).
  `withLease(name, ttlMs, fn)` releases in `finally`. Poll route: 409 when
  not acquired. Test with two concurrent handler calls.
- `vercel.json`: `{"crons":[{"path":"/api/cron/poll","schedule":"0 * * * *"}]}`.
  `export const maxDuration = 300` on the poll route; rewrite its header
  comment (Vercel Cron, Bearer `CRON_SECRET`).
- `/api/generate`: `getSession()` → 401; `!isOwner` → 403 with the same
  JSON shape promote's `adapt` uses. Test both.
- Reaper (§1.21): in `pollSources`, before sources, `update clips set
  status='failed', error='Ingest timed out — retry' where status='ingesting'
  and saved_at < now() - interval '15 minutes'`. Report the count in
  `PollResult`. Test.
- Research-note link: `researchNoteId` only when a returned note lists this
  brand; load candidate notes with a jsonb containment
  (`related_brand_ids @> '["<brandId>"]'`), not `select *`. Test.
- `posted` (§1.23): add to `IDEA_STATUSES`; `posted_at` nullable; PATCH sets
  it on transition to `posted` and clears it on leaving. Migration 0004
  carries `leases` + `posted_at`.
- Dict split (§1.26): `src/lib/i18n/dict/<feature>.ts` files, `en`/`sv`
  spread in `dictionary.ts`; `TranslationKey` identical (add a test that
  the key set is unchanged vs a snapshot taken before the split). Create
  empty `dict/brands.ts`, `dict/ideas.ts`, `dict/admin.ts` with imports
  already wired so S5/S6/S7 never touch `dictionary.ts`.
- Re-runnable; minor issues → `docs/log/o6.md`; stop only per §4.4.

Exit: CI green; `vercel.json`; lease + 409 test; owner gate tests; reaper
test; notes-link test; migration 0004; dict split with unchanged key set;
PR merged; log + §9 line.

## After this phase
Follow `prompts/_handoff.md`: create the watcher Routine (hourly, fresh
Sonnet session, prompt `Read prompts/_watcher.md in this repo and execute
it.`), then spawn ALL lane 2 phases on Sonnet: `sonnet-5-design-system.md`,
`sonnet-6-ideas-workflow.md`, `sonnet-7-probe-route.md`, `sonnet-8-docs.md`.
