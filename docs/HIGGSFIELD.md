# Higgsfield hand-off (PLAN.md §1.34, §6.S12)

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
