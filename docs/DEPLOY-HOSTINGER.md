# Deploy to Hostinger (EU account, Node.js app)

The online copy of content-engine runs on **one Node.js slot on the EU Hostinger
account** (PLAN.md §1.42). Never the Brazil account: its process limit is already
the bottleneck for live client sites. The temporary `*.hostingersite.com` domain
is fine; it is a private, login-gated tool. Map a real subdomain later if you want.

What stays on your PC even after this: YouTube caption polling (`npm run yt:poll`,
YouTube blocks datacenter IPs) and the free Claude/Codex writing mode
(`AI_PROVIDER`). Online, all writing uses Gemini under the spend cap.

Both copies use **the same Neon database**, so the PC and the online app see the
same data.

## 1. Database first (from your PC)

Run migrations and seeds from your PC, never from Hostinger SSH (its IPv6 route to
Neon is broken). One command at a time, in PowerShell, in the repo folder:

```
npm install
npm run db:migrate
npm run db:seed
npm run yt:seed-owner
npm run db:check
```

`.env` on the PC must have `DATABASE_URL` (the Frankfurt Neon project),
`DB_DRIVER=pg`, `ADMIN_EMAIL` and `ADMIN_PASSWORD` (12+ characters).

After every update that adds a migration: `git pull`, `npm install`,
`npm run db:migrate` from the PC. Do this before or right after Hostinger redeploys.

## 2. Create the app (hPanel, EU account)

1. Websites → Add website → **Node.js Apps** → Import Git repository.
2. Authorize GitHub, pick `antonmarklundcom/content-engine`, branch `main`.
3. Check the detected settings: framework Next.js, build `npm run build`, start
   `npm start`, Node 20 or newer.
4. Add the environment variables below **before** the first deploy. Put only the
   raw value in the Value field; never paste `KEY=value` into it.
5. Deploy. Open the temporary URL, sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

Env var changes need a **redeploy** to take effect; a restart is not enough.

## 3. Environment variables

### Required

| Variable | Value |
|---|---|
| `DATABASE_URL` | The Neon connection string (Frankfurt), same as on the PC. |
| `DB_DRIVER` | `pg` (Neon's HTTP driver cannot run transactions). |
| `DB_FORCE_IPV4` | `1` (Hostinger's IPv6 route to Neon is broken). |
| `SESSION_SECRET` | 32+ random characters. May differ from the PC's; changing it signs everyone out. |
| `GEMINI_API_KEY` | From aistudio.google.com/apikey, billed project. |
| `YOUTUBE_API_KEY` | Google Cloud, YouTube Data API v3. |
| `MONTHLY_SPEND_CAP_USD` | e.g. `25`. One cap shared by the PC and the online app. |

Generate a secret with:
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

### Optional now

| Variable | When |
|---|---|
| `CLIP_TOKEN` | For the iOS Shortcut capture path to the online app. |
| `CRON_SECRET` | Only if you add an hPanel cron job calling `/api/cron/*` with `Authorization: Bearer <value>`. Do **not** schedule `/api/cron/poll` online (captions are blocked from datacenters). |
| `MEDIA_ROOT` | A folder **outside** the app's build directory, e.g. `/home/<user>/content-engine-media`, so redeploys never wipe it. Online it only holds files uploaded there; your full library stays on the external drive (PLAN.md §1.41). |
| `MEDIA_UPLOAD_URL`, `MEDIA_UPLOAD_TOKEN`, `MEDIA_PUBLIC_BASE`, `MEDIA_PUBLIC_RETENTION_DAYS` | Once the `media.` subdomain endpoint is set up (`hosting/media-upload/README.md`). Same values as on the PC. |
| `GEMINI_MODEL`, `GEMINI_PROMOTE_MODEL` | Only to override model defaults. |

### Never set online

`AI_PROVIDER` (the CLI modes need the Claude/Codex CLI on your PC), `GEMINI_FAKE`
(tests only), `ADMIN_PASSWORD` (only used by `yt:seed-owner` on the PC).

### Added by later phases

Each phase documents its own variables in `.env.example`: `ENCRYPTION_KEY` and
the Meta app id/secret (O12), `TELEGRAM_BOT_TOKEN` for downloading files sent to
the bot (S17; the bot's webhook itself runs on the Cloudflare Worker, S16), the
publish cron (O13), and Google Drive read-only access (O14).

## 4. The Settings page

`/settings` writes keys into a local `.env` file. That only works on your PC. On
Hostinger, set keys in hPanel → Environment variables and redeploy.

## 5. Checklist after the first deploy

- [ ] The temporary URL loads and redirects to the login page.
- [ ] Sign-in works with your real admin credentials.
- [ ] `/brand/guide` and `/research` load (database reads work).
- [ ] Saving a clip in `/inbox` works (database writes work).
- [ ] Note the slot in your records: EU account, content-engine.

## Troubleshooting

- **"Application error" / a Digest page:** check hPanel → Runtime logs, then the
  env vars (a missing `SESSION_SECRET` or `DATABASE_URL` is the usual cause), then
  redeploy.
- **Database timeouts or `ECONNREFUSED`:** confirm `DB_FORCE_IPV4=1` and
  `DB_DRIVER=pg`, then redeploy.
- **A new page 500s after a deploy:** a migration has not run yet. Run
  `npm run db:migrate` from the PC.
