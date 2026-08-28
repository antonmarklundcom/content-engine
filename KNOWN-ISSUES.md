# Known issues

Minor, non-blocking findings recorded per PLAN.md §4.3 — things a later phase
should know about but that were not worth stopping a build for.

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
