---
description: Pull existing Higgsfield generations into MEDIA_ROOT/_inbox/higgsfield/<date>/ with a manifest, for sorting in /media/inbox.
argument-hint: [since YYYY-MM-DD | last N | "all"]
---

# /higgsfield-import — bring Higgsfield history into the library

Input: `$ARGUMENTS` — optional: `since 2026-09-01`, `last 50`, or `all`.
Default: everything since the newest `generatedAt` among the existing
`_inbox/higgsfield/*/manifest.json` files, else the last 100 generations.

**Run this in Claude Code on Anton's PC** (PLAN.md §1.45), with the
Higgsfield MCP connected. It writes into `MEDIA_ROOT` — the external media
drive (e.g. `E:\ContentEngine`) — which a cloud session cannot reach. If
`MEDIA_ROOT` is not set in `.env` or the folder does not exist, stop and say
"media drive not connected".

This command **generates nothing and spends no credits**: it only lists and
downloads what already exists. (`models_explore` is not needed here; it is
for commands that generate — `/higgsfield-post`, `/higgsfield-shots`.)

## 1. Know what is already imported

Read every `<MEDIA_ROOT>/_inbox/higgsfield/*/manifest.json` and collect their
`jobId`s and `url`s. Anything listed with `status: "done"` whose file exists
is skipped. Sorted files leave the inbox, but their manifest entries are
repointed (by the app) rather than dropped, so they still count as imported.

## 2. List the history

Use the Higgsfield MCP's history tools (`show_generations`, and
`show_medias` for uploads if Anton asks for them) with the range from the
input. Page through until the range is covered. Keep, per result: job id,
result URL(s), media type, prompt, model, created time.

## 3. Download into the unsorted inbox

For each result not yet imported, download it to
`<MEDIA_ROOT>/_inbox/higgsfield/<YYYY-MM-DD>/` — the day it was **generated**
(`higgsfieldInboxFolder()` in `src/lib/storage/paths.ts`) — named
`<slug of the first ~6 prompt words>-<first 8 chars of the job id>.<ext>`
(lower-case `a-z0-9-`). A job with several outputs gets `-2`, `-3`, ….
Download in parallel batches of about 8; a failed download is retried once,
then recorded as `failed` with its `error`. Never write outside the inbox.

## 4. One manifest per day folder

Write or merge `<MEDIA_ROOT>/_inbox/higgsfield/<YYYY-MM-DD>/manifest.json`:

```json
{
  "source": "higgsfield",
  "importedAt": "2026-09-27T10:00:00Z",
  "generatedAt": "2026-09-26T18:20:00Z",
  "files": [
    {
      "file": "asuncion-skyline-at-dusk-3f9a1c2b.png",
      "url": "https://…",
      "jobId": "3f9a1c2b-…",
      "prompt": "…",
      "model": "…",
      "status": "done"
    }
  ]
}
```

`file` is relative to the manifest's folder (or to `MEDIA_ROOT`). No
`brandId`: inbox files are unsorted on purpose. `generatedAt` is the newest
generation in the folder (the next run's default start). Merge; never drop
entries.

## 5. Register and hand over

Run `npm run media:scan` (or press **Scan now** on `/media`). The files show
up in **`/media/inbox`**, where Anton tags them, approves or rejects them,
and assigns a brand (and account): assigning moves each file into
`<brand>/<handle|_brand>/<YYYY-MM>/` and updates the manifest. End with:
files downloaded, skipped as already imported, failures, and the folders
written.
