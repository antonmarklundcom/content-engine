# Known issues

Still-open, cross-phase items only (PLAN.md §4.3), one line each, with the log it
came from. Pruned by S9: every build-1 "UNVERIFIED" entry is gone — O4–O6 put that
code under CI against a real Postgres and the Gemini test double. The full build-1
notes are in this file's git history.

## Needs a live run (credentials)

- Live smoke (`npm run smoke`) never run; the reservation constants in `ai.ts` are estimates — `o5.md`, PLAN §7.1.
- No live titles/script run; `SCRIPT_*`/`TITLES_*` reservations unmeasured — `o8.md`, `s12.md`, PLAN §7.9.
- `VIDEO_TOKENS_PER_SECOND = 110` (no-caption fallback) is unmeasured — `o7.md`.
- No live listing fetch or live pack/report model run; fixtures and the fake only — `b2b-c.md`, `b2b-d.md`.
- Windows steps (`start.bat`, `schtasks`, winget ids) are not exercised by CI — `s8.md`.

## Money and model

- Gemini Search grounding has no hard cap; the monthly free 5,000 queries are not modelled (over-reports) — build 1 O3.
- 3.7 Flash is billed at the standard rate, not the intro rate to 2026-12-31 (over-reports) — build 1 O3.
- A report/titles/script answer that fails validation has still been billed — `b2b-a.md`.
- `SCRIPT_PROMPT_OVERHEAD_TOKENS` was not raised for the FACTS block (≤ 40 facts, still covered) — `b2b-b.md`.
- Batch analysis submits inlined requests only; a very large backfill needs the file-based path — build 1 O3, `o5.md`.
- Source URLs in scripts are the model's, not the grounding redirect URIs — `o8.md`.

## Data and correctness

- `db.transaction()` throws on the Neon HTTP driver (fine on `pg`, the local-first driver §1.27) — `o4.md`, `b2b-c.md`.
- `canonicalClipUrl` does not strip `utm_*`, so one video shared from two apps can become two clips — `o4.md`.
- The ingest reaper keys on `saved_at`, so a retried old clip can be failed early (self-heals) — `o6.md`.
- A fallback analysis is indistinguishable from a caption one in `analyses` — `o7.md`.
- Filming-plan setup detection is a fixed en/es word list and can false-positive — `b2b-c.md`.
- The listing LAN check is on the literal host; a public name resolving to a private IP is not caught — `b2b-d.md`.
- Swedish (`sv`) brands fall back to the English style guide — `o8.md`.
- Style guides are read from `process.cwd()`; a Vercel deploy would need output file tracing — `o8.md`.

## Tests and tooling

- The Gemini fake has no pack/shorts/prose payloads (those calls throw under `GEMINI_FAKE`) — `b2b-c.md`.
- `tests/integration/route.ts` imports two Next internals; a Next upgrade may move them — `o5.md`.
- Action tests stub `incrementalCache` themselves; `callRoute` could set it once — `s6.md`, `s11.md`.
- The CI screenshot list does not include `/research`, `/lessons`, `/studio` or `/facts` — `s10.md`.
- `src/lib/bridge/README.md` says "reads only" and `index.ts` does not re-export research/lessons/scripts — `o7.md`, `s8.md`.

## UI

- The header has no active-link highlight; the wordmark is still `app.name` ("YT Intel") — `s5.md`.
- The brand page still shows Generate to non-owners (they get the 403 message) — `o6.md`.
- `/studio/[id]` guards unsaved edits only with a `beforeunload` prompt — `s12.md`.
- `/higgsfield-shots` does not know the `LISTING PHOTO` prefix; `StudioExports` has no thumbnails link — `b2b-d.md`.
