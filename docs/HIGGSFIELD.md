# Higgsfield hand-off (PLAN.md §1.34, §1.45, §6.S12, §6.S14)

Every Higgsfield command runs **in Claude Code on Anton's PC**, with the Higgsfield MCP connected: they write into `MEDIA_ROOT` (the external media drive, e.g. `E:\ContentEngine`; unset = `<repo>/media`), which a cloud session cannot reach. Commands that generate always ask `models_explore` (`action: "recommend"`) first, batch the jobs and wait with `jobs_wait`, write a `manifest.json` next to the files, and resume on re-run.

## Posts (build 3)

1. Open the post, then **Brief → Copy** — or `GET /api/posts/<id>/export?format=brief` (`&as=json` for just the JSON). Every visual has its prompt, aspect ratio and a `targetFile` relative to `MEDIA_ROOT` in the post's folder (`<brand>/<handle|_brand>/<YYYY-MM>/<post-id>-<slug>/NN-<slug>.<ext>`), plus the brand kit's Higgsfield element/character ids and style notes.
2. Run `/higgsfield-post <post-id>` (or paste the brief after it). It recommends models, uses the cheapest that fits, stops to ask before spending more than its estimate, generates the stills in one batch and image-to-video only for shots with a video prompt.
3. Files and `manifest.json` land in the post's folder. Then `npm run media:scan` or **Scan now** on `/media` registers them as assets for the brand (deduped by sha256, so re-running is safe).

## Importing existing Higgsfield history

1. Run `/higgsfield-import` (optionally `since 2026-09-01`, `last 50` or `all`). It spends nothing: it lists the account's past generations and downloads the ones not yet imported into `_inbox/higgsfield/<YYYY-MM-DD>/` with a manifest (prompt, model, job id, URL).
2. **Scan now** on `/media`; the files appear in **`/media/inbox`** (unsorted = no brand yet).
3. There, select files and tag, approve/reject/archive, or **Assign brand / account**. Assigning moves each inbox file into `<brand>/<handle|_brand>/<YYYY-MM>/` and repoints the inbox manifest, so a later scan keeps its prompt and reports nothing missing.

## The library (`/media`)

Filters (brand or unsorted, account, status, source, kind, tag, date) are URL parameters, so every view is a link. The grid only loads thumbnails (`/api/media/asset/<id>/thumb`); the full file loads in the detail drawer (prompt, model, source link, the posts it is used in). With the drive unplugged the page says "media drive not connected" and still filters and edits metadata; moves wait for the drive.

## Scripts (build 2)

1. Write and edit a script in the studio (`/studio/new` → `/studio/<id>`), then **Save**.
2. On `/studio/<id>`, **Export → Shot list → Copy** (or download it). It is Markdown for you plus a fenced JSON block for Claude Code; every shot already has its image/video prompt, aspect ratio and target file name.
3. Open Claude Code in this repo with the Higgsfield MCP connected and run `/higgsfield-shots <script-id>` — or `/higgsfield-shots` followed by the pasted shot list.
4. The command (`.claude/commands/higgsfield-shots.md`) asks Higgsfield's `models_explore` to recommend models first, uses the cheapest that fits, and stops to ask before spending more than its estimate.
5. It generates every still in one batch, then image-to-video only for shots with a video prompt, waiting with `jobs_wait`.
6. Results land in `media/<script-id>/` (`01-<slug>.png`, `01-<slug>.mp4`, `thumb-1-<slug>.png`) with `manifest.json`: shot → file → Higgsfield URL → prompt → model.
7. Re-running resumes: finished shots in the manifest are skipped; failures are retried.
8. The app never calls Higgsfield and stores no Higgsfield key — Claude Code does the spending, with you watching.
9. `media/` is large binaries: keep it out of git (add it to `.gitignore` on your machine if it is not there yet).
10. Editing a shot's prompt later? Save the script, re-export, and ask the command to redo that shot number.

## Thumbnails (build 2b, idea 10)

1. On `/studio/<id>`, open **Thumbnails** (`/studio/<id>/thumbnails`) and **Copy** the prompts — or `GET /api/scripts/<id>/export?format=thumbnails` (`&as=json` for just the JSON).
2. Each of the script's three concepts is a numbered 16:9 prompt with its text overlay built in, and two target files: `media/<id>/thumbnails/<n>.png` and `<n>-2.png`.
3. Run `/higgsfield-thumbnails <script-id>` (or paste the prompts after it). Same rules as the shots: `models_explore` recommend first, the cheapest model that renders the text, one batch + `jobs_wait`, a manifest at `media/<id>/thumbnails/manifest.json`, resume on re-run.
4. Back on `/studio/<id>/thumbnails` the images show up (served owner-only by `/api/media/<id>/thumbnails/<file>`); **Use this one** stores the path in `scripts.thumbnail_file`.
5. `/api/media/…` serves images, videos and manifests under `media/` only — `..`, absolute paths and symlinks leading outside are a 404. Set `MEDIA_ROOT` to keep the folder elsewhere on the PC.

## Listing scripts (build 2b, idea 8)

`/studio/listing` turns a propia.com.py (or any) listing into a short (60–90 s, 9:16) or a tour (3–5 min, 16:9). Its b-roll uses the listing's own photos first: those shots' image prompt reads `LISTING PHOTO (download, do not generate): <url>`. When running `/higgsfield-shots` on such a script, download that photo to the shot's `files.image` instead of generating it, and use it as the start frame for the shot's video prompt; only the other shots are generated.
