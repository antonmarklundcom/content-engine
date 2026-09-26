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
