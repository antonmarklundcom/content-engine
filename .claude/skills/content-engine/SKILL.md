---
name: content-engine
description: Run the multi-brand social content pipeline — research, ideate, plan, generate via Higgsfield (or another wired provider), and hand off for posting — for any brand in src/lib/brands.ts (Paraguay Residency Guide, propia, and the .com.py brands). Trigger on "run content engine", "make content for [brand]", "plan this week's posts", "generate the queued content", or a brand name + "content"/"posts"/"social".
---

# Content Engine

Multi-brand social pipeline. The database (`brands`, `ideas`, `calendar_items`,
`assets`, `posts` — see `src/db/schema.ts`) is the source of truth. This skill
is the agent loop that fills it and drains it. Deterministic bookkeeping goes
through the CLI scripts in `scripts/`; anything that requires judgment
(research, angle selection, prompt writing, brand voice) is done by you, the
agent, in-context.

## Automation model

This runs on a schedule (a Routine) with **one approval gate**: research +
ideation run fully automatically; generation (spends provider credits) and
posting do NOT start until the user approves which proposed ideas to run.
Once an idea is approved, generation and posting both proceed automatically
— there is no second gate before posting. So a scheduled run should:

1. Run stage 1 (research + ideate) for every active brand, writing `proposed`
   ideas.
2. Stop and notify the user with the proposed list (don't silently continue)
   — they reply with which ideas to approve (or approve/reject individually).
3. On approval, run stages 2-4 (plan → generate → post) for just the
   approved ideas, unattended, no further check-ins.

A manual, in-conversation request ("plan this week for pozo") can skip
straight to whichever stage was asked for.

## Modes

Figure out which mode the request is asking for and run only that stage,
unless the user asks for the full loop end-to-end.

### 1. Research + ideate

For the target brand(s), pull `src/lib/brands.ts` to get niche/voice/market/
platforms. Research current trends relevant to that niche and market (use
WebSearch — for Paraguay-market brands, prioritize what's actually working
for similar accounts/creators in LatAm/Paraguay, not generic US social
advice).

If `YT_DATABASE_URL` is set, also pull from the `yt` repo's analyzed YouTube
videos — it already extracts summaries/takeaways/hooks/ideas/topics per
video for any channel the user tracks there:
```
npm run yt:insights -- --keyword paraguay --keyword residency --keyword "real estate"
```
Use `--keyword` terms matching the brand's niche. This is free, already-
analyzed signal — check it before spending a fresh web search round on a
niche the user is already tracking channels for in `yt`. If it returns
nothing useful, that's a sign to (a) fall back to WebSearch and (b) suggest
the user add the relevant channels/videos to `yt` (`npm run ingest '<url>'`
in that repo) so future runs have real signal.

Propose 5-10 concrete ideas per brand: a title, a one-line angle/hook,
and a format (`reel`, `carousel`, `image_post`, `story`, `long_video`).

Write each one with:
```
npm run idea:add -- --brand <id> --title "..." --angle "..." --format reel --source "<what research prompted this>"
```

Then show the user the list (`npm run idea:list -- --brand <id>`) and stop —
wait for their reply naming which ideas to run. When they do, record it:
```
npm run idea:approve -- --idea 12 --idea 14 --idea 15
npm run idea:approve -- --reject --idea 13
```
`plan:week` refuses any idea that isn't `approved` — this is the one gate in
the whole pipeline, so never bypass it by editing the DB directly.

### 2. Plan

For each approved idea, turn it into a scheduled `calendar_items` row:

```
npm run plan:week -- --idea <ideaId> --platform instagram --date 2026-09-02T14:00:00Z --provider higgsfield
```

Spread items across the brand's `platforms` and a sensible cadence (don't
schedule everything for the same instant). Default `--provider` to
`higgsfield` unless the user specifies another one already wired up in
`src/lib/providers/registry.ts`.

### 3. Generate

Run `npm run queue:due` to see items with status `ready_to_generate`. For
each:

1. Look up the item's `provider` and check `src/lib/providers/registry.ts`
   for its `mcpToolMap` — that names the actual MCP tool to call (e.g.
   `mcp__Higgsfield__generate_video`).
2. Write the brief/prompt yourself from the idea's `angle`, the brand's
   `voice`, and the target `format`/`platform` aspect ratio (9:16 for
   Reels/TikTok/Stories, 1:1 or 4:5 for feed posts). For video, also write
   `script` (shot list / voiceover) into the calendar item if useful —
   update it directly via a one-off script or note it in the caption field.
3. Call the MCP tool. For Higgsfield specifically: call
   `get_workflow_instructions` first if this looks like a templated video
   (ad, explainer, UGC-style) — there may be a purpose-built workflow.
   Otherwise call `generate_image`/`generate_video` directly, or the
   `_batch` variant if generating several pieces for the same brand at once
   (then `jobs_wait` + `show_generation_by_ids`).
4. Once you have a resulting asset URL, record it and advance the item:
   ```
   npm run mark:generated -- --item <id> --provider higgsfield --kind video --url <assetUrl> --job-id <providerJobId>
   ```

**Swapping providers**: this is the one step that changes when you add a new
provider (Runway, Kling, fal.ai, ...). Add it to
`src/lib/providers/registry.ts` with its MCP tool names, wire the actual MCP
server/connection, and set `--provider <newId>` on new `plan:week` calls (or
`UPDATE calendar_items SET provider = '<newId>' WHERE ...` for existing
drafted items). Nothing else in the pipeline needs to change.

### 4. Post

`posting/` isn't wired to a live API yet (see `src/lib/posting/README.md` —
Ayrshare is the recommended default). Until it is, treat "post" requests as:
present the generated asset + caption to the user for manual posting, or
implement the Ayrshare call if the user has set `AYRSHARE_API_KEY`. Once
posted (manually or via API), record it:

```
npm run mark:posted -- --item <id> --platform instagram --permalink <url>
```

## Adding a new brand

Add an entry to `BRANDS` in `src/lib/brands.ts`, then `npm run db:seed`. No
other code changes needed — research/plan/generate/post all read from the
brand row.

## Guardrails

- Never invent a `brandId` — it must exist in `src/lib/brands.ts`.
- Never call `mark:posted` without an actual publish having happened (or
  explicit user confirmation they posted it manually).
- Respect each brand's `market`/`language` — Paraguay-market brands get
  Spanish copy and Paraguay-specific research, not generic content.
- If asked to run this unattended/on a schedule, that's a Routine
  (`create_trigger`) firing this skill's prompt — set it up if the user asks,
  don't do it silently.
