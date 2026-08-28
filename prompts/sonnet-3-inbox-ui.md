# Phase S3 — Inbox UI + capture ergonomics. Paste into a fresh SONNET session, ONLY after O2 is merged AND its endpoints are verified against the dev DB (§0).

Read `PLAN.md` FIRST, in full — plus §9 build log and `KNOWN-ISSUES.md`.
Execute plan §6.S3 under the autonomy protocol §4. Build nothing outside
the plan.

HARD LIMITS (§4.7): no schema, auth, spend-cap, or ingest/analysis-pipeline
changes. Read data ONLY through `src/lib/bridge/` and the O2 endpoints. If a
limit blocks you: workaround + note in §10 Backlog — never a foundation edit.

## §0. Check the ground before you build on it

O1 and O2 were written without a database in reach, so their code shipped
verified only by build, typecheck and unit tests. Before writing any UI:

1. **O2 must be merged.** Not open, not "nearly" — merged into main (§4.2:
   never start on top of an unmerged previous phase). If its PR is still open,
   stop and tell Anton; do not branch off it.
2. **The database must be migrated and seeded.** Run `npm run db:migrate`,
   `npm run db:seed`, `npm run db:check`. Missing `DATABASE_URL` ⇒ stop and
   say so (§4.4); every exit criterion below reads real rows.
3. **Prove the two endpoints you are about to hang buttons on actually work**,
   because nobody has yet:
   - `POST /api/clips` with `{ "url": "<a real YouTube video>", "note": "test" }`
     and an `Authorization: Bearer $CLIP_TOKEN` header → a clip that reaches
     status `analyzed` with `video_id` set.
   - `POST /api/ideas/promote` with a `{ kind: "analysis-idea", analysisId,
     ideaIndex }` source, a real `brandId`, a format and a platform → an
     `ideas` row with `source_analysis_id` set.
   Anything broken there is a **foundation bug, not yours to route around**:
   report it and stop rather than building UI over it (§4.7 forbids you the
   fix, and a workaround would hide it).

What already exists for you, so you build none of it: `src/lib/bridge/`
(`listClips`, `clipCountsByStatus`, `getClip`, `analysisBundleForVideo`,
`listAnalyzedVideos`, `listBrands`, `listMarkedUnits`) and the two endpoints
above. Read through the bridge only — never `db` directly.

## Phase rules

- Branch `phase/s3-inbox-ui` off latest main — unless the session harness pins
  a branch name, in which case use the pinned one and say so in the §9 entry
  (O1 and O2 both hit this).
- Match the app's existing UI conventions — copy the patterns of the
  existing `/youtube` list views and the brand pages; no new UI libraries,
  no redesigns of existing pages beyond adding the promote/seed buttons.
- The capture path is the point of this phase (§1.6): the `share_target`
  manifest + `docs/CAPTURE.md` (exact iOS Shortcut steps, Bearer header,
  request body) are exit criteria, not extras.
- Mobile-first for the inbox and the share-target landing page — they will
  be used from a phone mid-scroll.
- Re-runnable; minor issues → `KNOWN-ISSUES.md`; stop only per §4.4.

Exit: build/lint/typecheck green; manifest with `share_target` served and
valid; on dev the full flow works: save (form AND simulated share POST) →
inbox → promote to a brand → idea visible with its source link; YouTube
clip rows link to their video page; `docs/CAPTURE.md` committed; PR merged.

## After this phase — hand off to the next (fresh session)

Only when all four §4.9 gates pass: spawn a NEW session via `create_session`
— inherit environment and permission mode (never `plan`), `model` Sonnet,
prompt exactly:
`Read prompts/sonnet-4-worker-igfb.md in this repo and execute it.`
Never on a Fable/Mythos-class model (§1.11). Fallback without
`create_session`: same model, so continue in this window.
