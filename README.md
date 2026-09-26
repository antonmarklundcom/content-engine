# Content Engine

A private research studio for Anton's brands, run on his own PC:

- **Competitors** — link YouTube channels to a brand, rank their videos by outlier score.
- **Digests** — captions pulled from YouTube, analysed by Gemini into summaries and key points.
- **Lessons** — hooks, facts and title patterns saved by hand from a digest.
- **Titles and scripts** — 10 title ideas, then an on-camera script (teleprompter lines, b-roll shots).
- **Higgsfield hand-off** — a script's shot list, exported for a Claude Code session to generate.
- **Ideas** — researched post ideas with ready-to-post captions, per brand.
- **Inbox** — links saved from your phone, waiting to be used.

## Run it locally (start here)

Follow **[docs/LOCAL-SETUP.md](docs/LOCAL-SETUP.md)**. It is written for Windows,
step by step, and takes about 20 minutes. In short:

```bash
npm install
npm run db:migrate      # create/upgrade the tables
npm run db:seed         # insert the brands (insert-only, safe to re-run)
npm run yt:seed-owner   # create the owner login from ADMIN_EMAIL / ADMIN_PASSWORD
npm run dev             # http://localhost:3000
```

After that, `start.bat` in the repo root builds once and starts the app.
To update: `git pull`, `npm install`, `npm run db:migrate`.

Studio writing (titles, scripts, reports, packs) can run through your logged-in
Claude Code or Codex CLI at no app cost instead of Gemini: see
**[docs/SUBSCRIPTION-MODE.md](docs/SUBSCRIPTION-MODE.md)** (`AI_PROVIDER`).

## Login and roles

Every page is behind a login (`/youtube/login`). There are two roles:

- **owner** — the only role that can spend money (generate ideas, titles,
  scripts, analyses) or delete things. Created by `npm run yt:seed-owner`.
- **employee** — can read everything and edit ideas; never spends.

`SESSION_SECRET` signs the login cookie. Changing it signs everyone out.

## Environment variables

Copy `.env.example` to `.env`. Each variable is explained there in full.

| Variable | Needed | What it is |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string (a free Neon database). |
| `DB_DRIVER` | yes, locally | Set to `pg`. Neon's HTTP driver cannot run transactions. |
| `SESSION_SECRET` | yes | 32+ random characters; signs the login cookie. |
| `GEMINI_API_KEY` | yes | From aistudio.google.com/apikey, on a billed project. |
| `YOUTUBE_API_KEY` | yes | Google Cloud, YouTube Data API v3. Free quota. |
| `ADMIN_EMAIL` | once | Owner login, read by `npm run yt:seed-owner`. |
| `ADMIN_PASSWORD` | once | Owner password (12+ chars), same script. |
| `MONTHLY_SPEND_CAP_USD` | no | Hard monthly cap across every paid call. Default 25. |
| `GEMINI_MODEL` | no | Override the ideas model. |
| `GEMINI_PROMOTE_MODEL` | no | Override the model that adapts a promoted idea. |
| `GEMINI_FAKE` | no | `1` = canned Gemini answers. Tests only. |
| `CLIP_TOKEN` | no | Bearer token for saving clips from a phone Shortcut. |
| `CRON_SECRET` | no | Enables `/api/cron/poll`. Leave unset locally. |
| `YOUTUBE_QUOTA_BUDGET` | no | Per-run guard on YouTube API units. |
| `CAPTION_STRATEGIES` | no | Allowlist/order of caption strategies. |
| `CAPTION_FAILURE_THRESHOLD` | no | Failures before a caption strategy is dropped for a run. |
| `CAPTION_PROXY_URL` | no | Proxy for caption fetches only. Not needed from a home IP. |
| `CAPTION_LANGUAGES` | no | Preferred caption languages. Default `en`. |
| `CAPTION_DELAY_MS` | no | Pause between videos in a batch. |
| `SCREEN_MIN_SCORE` | no | Bar (0–100) a video must pass before paid analysis. |
| `SCREENING_ENABLED` | no | `0` switches screening off. |
| `SCREEN_INTERESTS` | no | What you are working on, for the screening model. |

## Checking it works

- `npm run verify` — typecheck, lint (ESLint + Prettier), unit tests, integration tests, build. Needs a
  local, non-Neon Postgres in `DATABASE_URL` (the tests wipe every table). CI
  runs the same thing on every PR.
- `npm run smoke -- <brandId> --dry-run` — what a live run would do and cost.
- `npm run smoke -- <brandId>` — one real call per paid path against your
  real database and Gemini key; costs about $0.10.

What each proves, and what neither can: [docs/VERIFY.md](docs/VERIFY.md).

## Other commands

| Command | What it does |
|---|---|
| `npm run build` / `npm run start` | Production build and server. |
| `npm run db:check` | Test the database connection. |
| `npm run db:generate` | Write a migration after a schema change (developers). |
| `npm run yt:poll` | Poll channels, screen and analyse new videos (Task Scheduler runs it hourly). |
| `npm run yt:ingest`, `yt:analyze`, `yt:backfill`, `yt:screen`, `yt:uploads` | One-off YouTube pipeline steps. |
| `npm run yt:spend` | This month's spend. |
| `npm run yt:probe-captions` | Check caption fetching works from this machine. |

## Phone capture

Save links from your phone into the inbox: [docs/CAPTURE.md](docs/CAPTURE.md).

## Optional: deploy to Vercel

The app still deploys to Vercel: import the repo, set the same env vars in the
project settings. The `vercel-build` script migrates and seeds before
`next build`. Two caveats: set `DB_DRIVER=pg`, and captions may be blocked from
Vercel's datacenter IPs — see
[docs/CAPTION-FETCH-RESILIENCE.md](docs/CAPTION-FETCH-RESILIENCE.md).

## How this repo is built

`PLAN.md` is the build plan: decisions, phases, and a build log index.
Each phase is one Claude Code session run from a file in `prompts/`, one PR each.
How to contribute inside that system: [CONTRIBUTING.md](CONTRIBUTING.md).

## Brands

The `brands` table is the source of truth. `src/db/seed.ts` holds the initial
rows; `npm run db:seed` inserts the missing ones and never overwrites an edited
brand (`npm run db:seed -- --overwrite` does, on purpose).
