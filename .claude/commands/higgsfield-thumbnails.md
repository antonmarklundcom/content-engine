---
description: Generate a script's three thumbnail concepts (2 variants each, 16:9) with the Higgsfield MCP and save them to media/<script-id>/thumbnails/ with a manifest.
argument-hint: <script id | pasted thumbnail prompts>
---

# /higgsfield-thumbnails — render a script's thumbnails

Input: `$ARGUMENTS` — either a script id, or pasted thumbnail prompts (the
studio's `/studio/<id>/thumbnails` → "Copy", or
`GET /api/scripts/<id>/export?format=thumbnails`).

You are a Claude Code session with the Higgsfield MCP connected. The app never
calls Higgsfield and holds no Higgsfield key (PLAN.md §1.34). The rules are the
same as `/higgsfield-shots` (`.claude/commands/higgsfield-shots.md`); only the
list and the folder differ. Follow the steps in order.

## 1. Get the thumbnail list

- **Pasted:** use the fenced ` ```json ` block at the end of the paste. It is
  a `ThumbnailList`: `{ scriptId, title, mediaDir, variantsPerConcept,
  thumbnails[] }` (see `src/lib/scripts/export.ts`).
- **Script id:** fetch
  `http://localhost:3000/api/scripts/<id>/export?format=thumbnails&as=json`.
  It needs a signed-in session cookie; if you have none, ask Anton to paste
  the prompts from `/studio/<id>/thumbnails` instead. Do not try to sign in.

Each thumbnail has `number`, `description`, `textOverlay` (may be empty),
`imagePrompt` (the background as written), `prompt` (what to send — the
background plus the text overlay), `aspectRatio` (always `16:9`), `file`
(`media/<id>/thumbnails/<n>.png`) and `variants` — one path per image to make
(`<n>.png`, `<n>-2.png`).

## 2. Resume, don't redo

Read `media/<scriptId>/thumbnails/manifest.json` if it exists. Skip every
variant it lists as `done` whose file exists on disk. Never regenerate a
finished variant unless Anton names it.

## 3. Choose models — recommend first, cheapest that fits

- Before the **first** generation of this run, call Higgsfield's
  `models_explore` with `action: "recommend"` once: a 16:9 YouTube thumbnail,
  photographic, **with legible text** when any `textOverlay` is non-empty.
  Use its answer; do not pick a model from memory.
- Use the **cheapest model that fits**. A thumbnail with text needs a model
  that renders short text cleanly — that is the one reason to go above the
  cheapest; say so when you do. Concepts with an empty `textOverlay` can use
  the cheapest photographic model.
- Estimate the run: pending variants × image cost. Check `balance`. If the
  estimate is more than the credits left, or a step would spend more than
  that estimate, **stop and ask Anton** with the numbers before generating.

## 4. Generate — one batch

For every pending variant, one image from the thumbnail's `prompt` at 16:9 —
`variantsPerConcept` (2) per concept, so Anton has a choice. They are
independent: send them as **one batch** (`generate_image_batch`), then wait
with `jobs_wait`; do not poll job by job. A failed job: retry once with the
same model; if it fails again, record the error in the manifest and move on.

Use the `prompt` as given: it already asks for the text overlay (or for no
text). Do not invent concepts that are not in the list.

## 5. Save to `media/<script-id>/thumbnails/` with a manifest

Download each result to its exact path in `variants` (relative to the repo
root; create the folder). Then write `media/<scriptId>/thumbnails/manifest.json`:

```json
{
  "scriptId": 12,
  "title": "…",
  "generatedAt": "2026-09-26T10:00:00Z",
  "thumbnails": [
    {
      "number": 1,
      "variant": 1,
      "file": "media/12/thumbnails/1.png",
      "url": "https://…higgsfield result URL…",
      "prompt": "…",
      "model": "…",
      "jobId": "…",
      "status": "done"
    }
  ],
  "credits": { "estimated": 0, "spent": 0 }
}
```

One entry per file. `status` is `done` or `failed` (with an `error`). Merge
into an existing manifest; never drop entries from an earlier run.

## 6. Report

End with: files written, variants skipped as already done, failures, credits
estimated vs spent, and the link to pick one: `http://localhost:3000/studio/<id>/thumbnails`
("Use this one" sets the script's thumbnail). `media/` holds large binaries —
do not commit it.
