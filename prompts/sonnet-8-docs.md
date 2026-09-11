# Phase S8 — Docs + DX. SONNET session. Lane 2, parallel with S5, S6, S7.

Read ONLY: this file, `PLAN.md` (all of it — this phase documents the
method), `docs/log/o4.md`, `docs/log/o5.md`, `docs/log/o6.md`, and the
current `README.md`, `docs/*.md`, `.env.example`, `package.json`.

Owns: `README.md`, `CONTRIBUTING.md` (new), `docs/VERIFY.md` (new),
`docs/CAPTURE.md`, `docs/CAPTION-FETCH-RESILIENCE.md`, `docs/log/s8.md`.

HARD LIMITS: docs only. No code, no config, no `.env.example` edits (O4–O6
own it). If a doc reveals a code bug, write it to `docs/decisions-needed.md`
as one line and move on.

Budget: one session, ≤ 60 min. Open the PR the turn the exit criteria pass.

Phase rules:
- Branch `phase/s8-docs` off latest main.
- `README.md`: what the app is (both halves + inbox, ≤ 8 lines), login and
  roles, every env var with one line each (from `.env.example`), local run
  with `pg` (`DATABASE_URL=postgres://localhost/...`), `npm run verify`,
  `npm run smoke`, deploy (Vercel, `vercel-build`, cron, `CRON_SECRET`),
  and a three-line "how this repo is built" pointing at `PLAN.md` and
  `prompts/`. Every command must run as written — check each against
  `package.json`.
- `CONTRIBUTING.md`: §4 in 15 lines, file ownership, how to add a
  `dict/<feature>.ts`, how to add an integration test, how to write a phase
  log.
- `docs/VERIFY.md`: what CI proves, what `smoke` proves, what neither can
  (real Vercel timeouts, real YouTube IP blocking → the probe route).
- `docs/CAPTURE.md` + `docs/CAPTION-FETCH-RESILIENCE.md`: replace "run the
  CLI from the deployed env" with the S7 route (`/youtube/admin`); keep
  everything else.
- Re-runnable; minor issues → `docs/log/s8.md`; stop only per §4.4.

Exit: every command in README exists in `package.json`; no reference to
Anthropic, Hostinger-cron or "run from the deployed env" remains outside
`docs/PLAN-v1-build1.md`; PR merged; log + §9 line.

## After this phase
Follow `prompts/_handoff.md`. Spawn nothing.
