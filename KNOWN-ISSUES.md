# Known issues

Still-open, cross-phase items only (PLAN.md §4.3), one line each, with the log it
came from. Pruned by S9: every build-1 "UNVERIFIED" entry is gone — O4–O6 put that
code under CI against a real Postgres and the Gemini test double. The full build-1
notes are in this file's git history. Pruned again by S20 after lane 2 of build 3
(S13–S19): closed items dropped, still-open cross-phase items promoted.

## Needs a live run (credentials)

- Live smoke (`npm run smoke`) never run; the reservation constants in `ai.ts` are estimates — `o5.md`, PLAN §7.1.
- No live titles/script run; `SCRIPT_*`/`TITLES_*` reservations unmeasured — `o8.md`, `s12.md`, PLAN §7.9.
- `VIDEO_TOKENS_PER_SECOND = 110` (no-caption fallback) is unmeasured — `o7.md`.
- No live listing fetch or live pack/report model run; fixtures and the fake only — `b2b-c.md`, `b2b-d.md`.
- Windows steps (`start.bat`, `schtasks`, winget ids, `setup.ps1`'s yt-dlp/ffmpeg) are not exercised by CI — `s8.md`, `s19.md`.
- Telegram capture Worker not deployed; needs a bot token and a Cloudflare account (PLAN §7.5) — `s16.md`.
- No live clip fetch (yt-dlp on a real reel) or transcript run; fake binary and Gemini fake only — `s17.md`, PLAN §7.7.

## Money and model

- Gemini Search grounding has no hard cap; the monthly free 5,000 queries are not modelled (over-reports) — build 1 O3.
- 3.7 Flash is billed at the standard rate, not the intro rate to 2026-12-31 (over-reports) — build 1 O3.
- A report/titles/script answer that fails validation has still been billed — `b2b-a.md`.
- `SCRIPT_PROMPT_OVERHEAD_TOKENS` was not raised for the FACTS block (≤ 40 facts, still covered) — `b2b-b.md`.
- Batch analysis submits inlined requests only; a very large backfill needs the file-based path — build 1 O3, `o5.md`.
- Source URLs in scripts are the model's, not the grounding redirect URIs — `o8.md`.

## Data and correctness

- Neon transactions run over a WebSocket pool that needs Node.js 22+ (global `WebSocket`); older Node gets a clear error — O14 should pin Node 22 on the slot.
- A fallback analysis is indistinguishable from a caption one in `analyses` — `o7.md`.
- Filming-plan setup detection is a fixed en/es word list and can false-positive — `b2b-c.md`.
- The listing LAN check is on the literal host; a public name resolving to a private IP is not caught — `b2b-d.md`.
- Style guides are read from `process.cwd()`; a Vercel deploy would need output file tracing — `o8.md`.
- A re-save of a known clip link (any door: Telegram, share, Shortcut) updates only the note; a new `#brand` or file is ignored — `s16.md`.

## Tests and tooling

- The Gemini fake has no pack/shorts/prose payloads (those calls throw under `GEMINI_FAKE`) — `b2b-c.md`.
- `tests/integration/route.ts` imports two Next internals; a Next upgrade may move them — `o5.md`.
- Action tests stub `incrementalCache` themselves; `callRoute` could set it once — `s6.md`, `s11.md`.
- The CI screenshot list does not include `/research`, `/lessons`, `/studio`, `/facts` or any build 3 page (`/posts`, `/media`, `/brands`, …) — `s10.md`, `s13.md`, `s14.md`.
- CI does not run `workers/telegram-capture`'s own tests (no workflow edits, §1.54); `capture-ui.test.ts` covers its SQL — `s16.md`.
- `src/lib/bridge/README.md` says "reads only" and `index.ts` does not re-export research/lessons/scripts/`family-facts`/`hooks`; brand/account/kit, media and `post_assets` writes live in actions — `o7.md`, `s8.md`, `s13.md`, `s14.md`, `s15.md`, `s18.md`.
- `.prettierignore`'s unanchored `media/` also skips `src/app/media/**` and `src/lib/media/**` (anchoring it reformats O10's files) — `s14.md`, `s20.md`.

## UI

- `/studio/[id]` guards unsaved edits only with a `beforeunload` prompt — `s12.md`.
- Media thumbnails and downloads are owner-only (O10's route), so employees see blank tiles in `/media`, the post editor and the pack — `s15.md`.
- `/higgsfield-shots` does not know the `LISTING PHOTO` prefix; `StudioExports` has no thumbnails link — `b2b-d.md`.
