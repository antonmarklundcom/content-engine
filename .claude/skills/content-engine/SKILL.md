---
name: content-engine
description: Run the multi-brand content ideation pipeline — research, cross-brand topic sharing, ideation, and full ready-to-post copy/captions — for any brand in src/lib/brands.ts (Paraguay Residency Guide, propia, and the .com.py brands). Media generation (via Higgsfield or another wired provider) and posting are optional follow-on steps once copy exists, not the point of the tool. Trigger on "run content engine", "make content for [brand]", "plan this week's posts", "research ideas for [brand]", "generate the queued content", or a brand name + "content"/"posts"/"social".
---

# Content Engine

**The deliverable of this pipeline is research + ideas + ready-to-post
copy.** Everything else — scheduling, media generation, posting — is
optional execution downstream of that, useful when the user wants it but
not what this tool exists to do. If a request is ambiguous, default to
stopping after ideation with a batch of ideas and written copy, not
pushing all the way through to generated media.

The database (`brands`, `research_notes`, `ideas`, `calendar_items`,
`assets`, `posts` — see `src/db/schema.ts`) is the source of truth. This skill
is the agent loop that fills it and drains it. Deterministic bookkeeping goes
through the CLI scripts in `scripts/`; anything that requires judgment
(research, angle selection, copywriting, brand voice) is done by you, the
agent, in-context — that judgment work, not the scripts, is the actual
value of this pipeline.

## Automation model

This runs on a schedule (a Routine) with **one approval gate**: research +
ideation (including full copy) run fully automatically; generation (spends
provider credits) and posting do NOT start until the user approves which
proposed ideas to run. Once an idea is approved, generation and posting both
proceed automatically — there is no second gate before posting. So a
scheduled run should:

1. Run stage 1 (research + ideate + copy) for every active brand, writing
   `proposed` ideas with full draft copy attached.
2. Stop and notify the user with the proposed list (don't silently continue)
   — they reply with which ideas to approve (or approve/reject individually).
   **Stopping here is a complete, useful run on its own** — the user may
   just want the copy to post manually and never touch stages 2-4.
3. Only if the user wants media made and posted: on approval, run stages 2-4
   (plan → generate → post) for just the approved ideas, unattended, no
   further check-ins.

A manual, in-conversation request ("plan this week for pozo") can skip
straight to whichever stage was asked for. "Give me ideas/content for X" or
similar should be read as stage 1 only unless generation/posting is asked
for explicitly.

## Modes

Figure out which mode the request is asking for and run only that stage,
unless the user asks for the full loop end-to-end. Most requests are stage 1
only — treat that as the default, not generation.

### 1. Research + ideate + copy (the core stage)

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

**Check for shared research first.** Some topics matter to more than one
brand — Paraguay real-estate/development news is relevant to both
`residency-guide` and `propia`; a tax or business-law change is relevant to
`contador` and `negocio`. Before researching a brand from scratch, run
`npm run research:list -- --brand <id>` to see if another brand's research
run already covered something this brand can use. If it did, spin this
brand's own angle from it (see `--research` below) instead of re-researching
the same topic.

When a research finding is relevant to more than one active brand, write it
once as a shared note instead of duplicating it per brand:
```
npm run research:add -- --topic "..." --summary "..." --market paraguay \
  --brands residency-guide,propia --sources "https://...,https://..."
```
Each relevant brand then gets its own idea off that note (own hook, own
format, own voice) via `idea:add --research <id>` below — the research isn't
repeated, only the angle is brand-specific.

Propose 5-10 concrete ideas per brand: a title, a one-line angle/hook,
and a format. Formats are Instagram/Facebook-first: `reel`, `carousel`,
`image_post`, `story`. `long_video` exists for brands that also run
YouTube/long-form (e.g. `residency-guide`'s `youtube_shorts` platform) but
is not the focus of this pipeline — most brands should stay in short-form/
post formats.

**Fact-check gate**: if an idea rests on a factual claim — a law/program name,
a price, a visa requirement, a statistic, anything a viewer could act on and
get burned if wrong — verify it against at least 2 independent sources
before writing the idea, and pass them as `--citations`. This matters most
for `residency-guide` (Paraguay immigration law changed twice in 2026 — the
Investor Pass in April, DNM 407/2026's solvency rules) and any pricing claim
for `propia`. Pure lifestyle/inspo ideas with no factual claim don't need
citations. Never invent a number or a program name — if you can't verify it,
either drop the claim from the idea or flag it to the user instead of
guessing.

**Write the actual copy, not just an angle.** Each idea's `--copy` is a
ready-to-post caption in the brand's `voice`/`language`: opening hook line,
body, call-to-action, hashtags — publish-ready, not a placeholder like
"write caption about X". This is what stage 1 is actually for; treat an
idea without real copy as unfinished. Only add `--prompt` (a media-generation
brief — shot description, style notes, aspect ratio) if the idea is likely
to go on to generation; skip it for a pure copy/text-post idea or when
unsure whether media will be made.

Write each one with:
```
npm run idea:add -- --brand <id> --title "..." --angle "..." --format reel \
  --copy "<full ready-to-post caption in the brand's voice/language>" \
  --prompt "<media-generation brief, if this idea may go to generation>" \
  --source "<what research prompted this>" \
  --research <researchNoteId> \
  --citations '[{"claim":"SUACE requires $70k investment","sources":["https://...","https://..."]}]'
```
`--research` is optional — pass it when this idea was spun from a shared
research note (see above) so it stays traceable to the same underlying
finding other brands' ideas may also reference.

Then show the user the list (`npm run idea:list -- --brand <id>`) and stop —
wait for their reply naming which ideas to run. When they do, record it:
```
npm run idea:approve -- --idea 12 --idea 14 --idea 15
npm run idea:approve -- --reject --idea 13
```
`plan:week` refuses any idea that isn't `approved` — this is the one gate in
the whole pipeline, so never bypass it by editing the DB directly.

### 2. Plan (optional — only if media/posting is wanted)

For each approved idea, turn it into a scheduled `calendar_items` row:

```
npm run plan:week -- --idea <ideaId> --platform instagram --date 2026-09-02T14:00:00Z --provider higgsfield
```

Spread items across the brand's `platforms` and a sensible cadence (don't
schedule everything for the same instant). Default `--provider` to
`higgsfield` unless the user specifies another one already wired up in
`src/lib/providers/registry.ts`.

### 3. Generate (optional — spends provider credits, only on explicit ask)

Run `npm run queue:due` to see items with status `ready_to_generate`. For
each:

1. Look up the item's `provider` and check `src/lib/providers/registry.ts`
   for its `mcpToolMap` — that names the actual MCP tool to call (e.g.
   `mcp__Higgsfield__generate_video`).
2. Start from the idea's `mediaPrompt` if one was written at ideation time;
   otherwise write the brief yourself from the idea's `angle`, the brand's
   `voice`, and the target `format`/`platform` aspect ratio (9:16 for
   Reels/TikTok/Stories, 1:1 or 4:5 for feed posts). For video, also write
   `script` (shot list / voiceover) into the calendar item if useful —
   update it directly via a one-off script or note it in the caption field.
   The idea's `draftCopy` is the caption — use it as-is unless the user
   asked for a rewrite.
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

### 4. Post (optional — only if the user wants this tool to publish too)

`posting/` isn't wired to a live API yet (see `src/lib/posting/README.md` —
Ayrshare is the recommended default). Until it is, treat "post" requests as:
present the generated asset + caption to the user for manual posting, or
implement the Ayrshare call if the user has set `AYRSHARE_API_KEY`. Once
posted (manually or via API), record it:

```
npm run mark:posted -- --item <id> --platform instagram --permalink <url>
```

## Long-form → shorts (not core yet)

The primary output of this pipeline is native IG/FB short-form content
generated from scratch, not clipped from existing video. Turning an
existing long-form YouTube video into shorts is a possible future addition,
not implemented — if asked to do this, treat it as a one-off (find the
video, identify a hook-worthy segment, note it as an idea with
`format: reel` and a `sourceNote` pointing at the source video) rather than
assuming a dedicated clipping tool exists. Check what's available (e.g.
Higgsfield's clipper/video-analysis MCP tools) before building anything new.

## Adding a new brand

Add an entry to `BRANDS` in `src/lib/brands.ts`, then `npm run db:seed`. No
other code changes needed — research/plan/generate/post all read from the
brand row.

## Guardrails

- Never invent a `brandId` — it must exist in `src/lib/brands.ts`.
- Never invent a specific property (price, address, photos) for `propia` —
  pull real listings from the `propia.node` repo/site (propia.com.py) or ask
  the user for the listing. Market-level content (price trends, neighborhood
  guides) is fine to write from research; a specific "for sale" post is not.
- Never call `mark:posted` without an actual publish having happened (or
  explicit user confirmation they posted it manually).
- Respect each brand's `market`/`language` — Paraguay-market brands get
  Spanish copy and Paraguay-specific research, not generic content.
- If asked to run this unattended/on a schedule, that's a Routine
  (`create_trigger`) firing this skill's prompt — set it up if the user asks,
  don't do it silently.
