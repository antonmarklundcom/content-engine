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

