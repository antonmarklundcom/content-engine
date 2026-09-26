# What is verified, and by what

Three layers. Each one proves something the others cannot.

## CI — every PR (`npm run verify`)

`.github/workflows/ci.yml` runs on Node 22 with a real `postgres:16`:

- **Typecheck** (`tsc --noEmit`) — including that every Swedish UI string exists.
- **Unit tests** (`npm test`) — pure logic: prices, outlier score, script
  contract, caption parsing, i18n key snapshot.
- **Migrations** (`db:migrate`) apply cleanly to an empty database.
- **Integration tests** (`npm run test:db`) — real SQL through the real code:
  spend cap reserve/record/trip, clip save, lease, bridges, and every paid route
  (`/api/generate`, promote with adapt, `/api/clips`, poll, fallback analysis,
  titles, scripts, exports) end to end — with Gemini replaced by
  `src/lib/ai-fake.ts`, which returns schema-valid answers and realistic usage
  figures so the money arithmetic runs for real.
- **Build** (`next build`).
- **Screenshots job** — migrates, seeds, starts the built app, captures pages at
  two widths as a CI artifact. Catches pages that crash at runtime, which a build
  alone does not (a bad `SESSION_SECRET` once passed the build and 500'd every page).

A red CI means a PR does not merge.

## Smoke — by hand, with real keys (`npm run smoke -- <brandId>`)

`scripts/smoke.ts` runs against your real `DATABASE_URL` and `GEMINI_API_KEY`:
one idea generation, one promote with adapt, one clip save (with `--clip <url>`),
one interactive analysis. It prints the `spend_log` before and after, each call's
raw token usage and search count, and whether each call stayed under the amount
the spend cap reserved for it. It costs about $0.10 and writes real rows.
`--dry-run` spends nothing and prints the plan and the estimates.

This is the only check that proves:

- the Gemini key, billing and models actually work;
- what Google really bills matches what the app records;
- the reservation estimates in `src/lib/ai.ts` are ceilings, not guesses.

It has **not been run yet** — see `docs/decisions-needed.md` (O5 entry) for
the exact command. The titles and scripts calls are not in it; their first
real run is PLAN.md §7 item 9.

## What neither can prove

- **Captions from your IP.** CI stubs YouTube. Run `npm run yt:probe-captions`
  on the PC; it prints the outbound IP and a verdict.
- **The YouTube Data API key and quota.** Only a real `yt:poll` or `/research`
  page load uses it.
- **Content quality.** Whether ideas, titles and scripts are good, whether the
  Paraguayan Spanish sounds right, whether a source URL says what the script
  claims. Scripts mark lines to check with ⚠ — read them before recording.
- **Windows specifics.** CI runs on Linux: `start.bat`, Task Scheduler, and
  paths are checked only by following `docs/LOCAL-SETUP.md` on the PC.
- **Neon itself.** CI uses a local Postgres with the `pg` driver — the same
  driver the PC uses with `DB_DRIVER=pg` — but not Neon's network or limits.
  `npm run db:check` tests the real connection.
- **The phone capture flow** (share sheet, iOS Shortcut) — see `docs/CAPTURE.md`.
