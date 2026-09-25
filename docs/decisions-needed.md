# Decisions needed

Append-only. A build session that hits a §4.4 stop writes its question here
(phase id, date, the question, the options it sees), commits, pushes, and
ends. The watcher notifies Anton; Anton answers in place, or edits the
relevant prompt file on main. Answered entries stay for the record.

### O4 · 2026-09-11 · `db.transaction()` does not work on Neon

Not a §4.4 stop — O4's exit criteria all passed — but it is a production bug
the verification foundation surfaced, and it needs an owner before a later
phase writes more transactional code.

`drizzle-orm/neon-http` throws "No transactions support in neon-http driver"
from `db.transaction()`. Two call sites use it: `src/lib/video.actions.ts:57`
and `src/lib/tags.ts:61`. Both run fine under the `pg` driver the integration
tests use, so CI being green is not evidence they work in production. Neither
file is in O4's Owns column.

Options: (a) switch production to `drizzle-orm/neon-serverless` (WebSocket
`Pool`, supports transactions) — contradicts §1.13's "Neon's HTTP driver" as
written, so it is Anton's call; (b) rewrite those two call sites as single
statements and keep HTTP. Worth settling before S6, which adds ideas writes.


### O5 · 2026-09-11 · the live smoke run still needs to be run once

Not a §4.4 stop — §5.O5.4 says so explicitly, and every other O5 exit
criterion passed. The build environment has neither `DATABASE_URL` nor
`GEMINI_API_KEY` (§7.1 item 1 is still ☐), so `npm run smoke` was written,
dry-run verified, and handed off rather than run.

What is still unverified without it: whether the three reservation constants
in `src/lib/ai.ts` — `ESTIMATED_THINKING_TOKENS` (8,000),
`MAX_GROUNDING_QUERIES` (8) and `PROMPT_OVERHEAD_TOKENS` (4,000) — are
actually above what Google bills. The test double reports the usage this repo
wrote for it, so the suite proves the arithmetic is consistent, never that its
inputs are right. Everything else about the paid paths is now covered by CI.

Run it once, from anywhere with the two credentials:

```
export DATABASE_URL='postgresql://…neon.tech/…'   # a dev branch, not production
export GEMINI_API_KEY='…'                          # billed project
export DB_DRIVER=pg                                # §1.27; neon-http has no db.transaction()
unset GEMINI_FAKE

npm run smoke -- residency-guide --dry-run         # plan + estimates, spends nothing
npm run smoke -- residency-guide --clip 'https://www.youtube.com/watch?v=<id>'
```

`<id>` is any YouTube video with captions; drop `--clip` to skip the capture
step and reuse whatever video is already ingested. The live run costs roughly
$0.10, writes real rows (ideas, one analysis, one clip), and prints:

- `spend_log` before and after, and the reservation still held at the end
- every call's raw `usageMetadata`, its `webSearchQueries` count, and its cost
- a "reservation vs actual" line per step, saying OK or TOO LOW
- a re-baselining block for the three constants above

Paste that output here. If any step says TOO LOW, raising the named constant
in `src/lib/ai.ts` is the whole fix — they are ceilings for a reservation, and
being wrong high only makes the cap trip early.
