# Phase O2 — Capture + bridge. Paste into a fresh OPUS session, ONLY after O1 is merged.

Read `PLAN.md` FIRST, in full — plus §9 build log and `KNOWN-ISSUES.md`.
Execute plan §5.O2 under the autonomy protocol §4. Build nothing outside
the plan.

Phase rules:
- Branch `phase/o2-capture-bridge` off latest main. O1 unmerged ⇒ finish it
  first (§4.2).
- Load the `claude-api` skill before writing the promote call or the
  seed-from-analysis prompt changes.
- Reuse, never rebuild: the YouTube save path goes through the EXISTING
  by-URL ingest (find it under `/youtube`'s ingest route/lib) — if it needs
  a small refactor to be callable from `/api/clips`, extract, don't fork.
- `CLIP_TOKEN`: generate a value, put the name in `.env.example`, use a
  constant-time comparison. Missing token env ⇒ Bearer path returns 503
  with a clear message; cookie path still works (§4.5).
- Every paid call goes through `withSpendCap`. The promote endpoint's
  voice-adaptation call is optional per request — promoting verbatim must
  work with zero spend.
- Re-runnable; minor issues → `KNOWN-ISSUES.md`; stop only per §4.4.

Exit: build/lint/typecheck green; against the dev DB: a YouTube URL saved
via Bearer token reaches status `analyzed` with `video_id` set; promote
inserts an `ideas` row with `source_analysis_id`; `/api/generate` with
`analysisId` returns grounded ideas; PR merged green.

## After this phase — hand off to the next (fresh session)

Only when all four §4.9 gates pass: spawn a NEW session via `create_session`
— inherit environment and permission mode (never `plan`), **`model` Sonnet**
(this is the model switch), prompt exactly:
`Read prompts/sonnet-3-inbox-ui.md in this repo and execute it.`
Never on a Fable/Mythos-class model (§1.11). Fallback without
`create_session`: model switch ⇒ STOP and report; Anton pastes the Sonnet
prompt in a fresh window himself.
