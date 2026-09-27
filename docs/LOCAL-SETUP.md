# Running Content Engine on your Windows PC

About 20 minutes the first time. You type the lines in grey boxes into
**PowerShell** (Start menu → type "PowerShell" → open it). Paste with right-click,
**one line at a time** — pasting several lines at once can merge them.

If PowerShell says running scripts is disabled (`npm.ps1 cannot be loaded`),
run this once and answer **Y**:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```


## Quick install (recommended)

1. Open **PowerShell** and run these two lines (Git asks you to log in to GitHub once):
   ```powershell
   winget install --id Git.Git -e
   git clone https://github.com/antonmarklundcom/content-engine "$HOME\content-engine"
   ```
2. Open the `content-engine` folder in your user folder and double-click **`setup.bat`**.
   It installs Node.js (and, when it can, yt-dlp and ffmpeg), asks for your free Neon database link
   and a login, sets everything up and puts a **Content Engine** shortcut on
   your desktop.
3. Double-click the shortcut, log in, open **Settings** (`localhost:3000/settings`)
   and paste your **Gemini** and **YouTube** keys. Press **Test** next to each.

The numbered steps below are the same thing by hand, if the installer stops.

## 1. Install Node.js, Git, yt-dlp and ffmpeg (once)

One line at a time:

```powershell
winget install --id OpenJS.NodeJS.LTS -e
```

```powershell
winget install --id Git.Git -e
```

```powershell
winget install --id yt-dlp.yt-dlp -e
```

```powershell
winget install --id Gyan.FFmpeg -e
```

yt-dlp downloads saved reels for research (used by `npm run clips:fetch`,
which arrives with S17). ffmpeg gives videos their duration in the media
library. Both are optional: without them the app still runs.

Close PowerShell and open it again, then check both answer with a version number:

```powershell
node --version
git --version
```

Node must be 20.9 or newer.

## 2. Download the app (once)

```powershell
mkdir C:\dev
cd C:\dev
git clone https://github.com/antonmarklundcom/content-engine.git
cd content-engine
```

Every later step runs inside `C:\dev\content-engine`.

## 3. Get the keys (once)

You need four values. Keep them in a notepad for the next step.

1. **Database — `DATABASE_URL`.** Go to [neon.tech](https://neon.tech), sign in,
   create a project named `content-engine` (free plan is fine) and set its
   **Region to AWS Europe Central 1 (Frankfurt)** — next to the EU Hostinger
   server the app moves to later. The region cannot be changed afterwards.
   On the project dashboard click **Connect**, copy the connection string. It
   starts with `postgresql://` and contains `neon.tech`. (Old empty projects in
   another region can be deleted: **Settings → Delete project**.)
2. **Gemini — `GEMINI_API_KEY`.** Go to
   [aistudio.google.com/apikey](https://aistudio.google.com/apikey) →
   **Create API key**. The Google Cloud project behind it must have billing
   turned on — search grounding does not work on the free tier.
3. **YouTube — `YOUTUBE_API_KEY`.** Go to
   [console.cloud.google.com](https://console.cloud.google.com) → pick a project
   → **APIs & Services → Library** → search "YouTube Data API v3" → **Enable**.
   Then **APIs & Services → Credentials → Create credentials → API key**. Free.
4. **Login secret — `SESSION_SECRET`.** Make one:
   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

## 4. Create the `.env` file (once)

```powershell
copy .env.example .env
notepad .env
```

Fill in these lines (keep the quotes around `DATABASE_URL`), then save:

```
DATABASE_URL="postgresql://…your Neon string…"
DB_DRIVER=pg
GEMINI_API_KEY=…
YOUTUBE_API_KEY=…
SESSION_SECRET=…
ADMIN_EMAIL=your@email.com
ADMIN_PASSWORD=a password of at least 12 characters
```

`DB_DRIVER=pg` matters: without it some save buttons fail on Neon.
Everything else in `.env` can stay as it is.

Always edit `.env` with Notepad. Don't create it with `>` in PowerShell — that
writes a file encoding the app cannot read.

## 5. Install and set up the database (once)

```powershell
npm install
npm run db:check
npm run db:migrate
npm run db:seed
npm run yt:seed-owner
```

`db:check` tests the database connection. `yt:seed-owner` creates your login
from `ADMIN_EMAIL` and `ADMIN_PASSWORD`. After it succeeds you can delete the
`ADMIN_PASSWORD` line from `.env`.

**The media drive (recommended).** Photos and videos live on an external
drive, set with `MEDIA_ROOT=E:\ContentEngine` in `.env`. Steps, including
the Google Drive backup: [STORAGE.md](STORAGE.md).

## 6. Start it

```powershell
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and log in. Stop it with
**Ctrl+C** in PowerShell.

**Day to day:** double-click `start.bat` in `C:\dev\content-engine`. The first
time it builds the app (a minute or two), then starts it and opens the browser.
Keep its window open while you use the app.

## 7. Scheduled jobs (optional, once)

`setup.bat` offers to create the first two for you. By hand: open **cmd as
administrator** (Start → type "cmd" → right-click → Run as administrator) and
paste one block at a time, changing the path if you cloned somewhere else.
They run while you are logged in on this PC.

**Poll channels every hour.** Checks your YouTube channels for new videos and
analyses them:

```
schtasks /Create /F /SC HOURLY /MO 1 /TN "content-engine yt-poll" ^
  /TR "cmd /c cd /d C:\dev\content-engine && npm run yt:poll >> poll.log 2>&1"
```

Output goes to `poll.log` in the app folder. It never spends past
`MONTHLY_SPEND_CAP_USD` (default $25). To remove it:
`schtasks /Delete /TN "content-engine yt-poll" /F`.

Exit codes in `poll.log`: 0 ok or already running, 3 spend cap hit, 1 crashed.

**Weekly competitor report.** Mondays at 08:00, after the poll has run:

```
schtasks /Create /F /SC WEEKLY /D MON /ST 08:00 /TN "content-engine weekly report" ^
  /TR "cmd /c cd /d C:\dev\content-engine && npm run studio:weekly >> weekly.log 2>&1"
```

To remove it: `schtasks /Delete /TN "content-engine weekly report" /F`.

**Register new media every hour.** Picks up files saved to the media drive
(free, skips what it already knows; harmless when the drive is unplugged):

```
schtasks /Create /F /SC HOURLY /MO 1 /TN "content-engine media-scan" ^
  /TR "cmd /c cd /d C:\dev\content-engine && npm run media:scan >> media.log 2>&1"
```

**Prune old public copies weekly** (only once the Hostinger media endpoint is
set up, [STORAGE.md §6](STORAGE.md#6-retention)):

```
schtasks /Create /F /SC WEEKLY /D SUN /ST 03:00 /TN "content-engine media-prune" ^
  /TR "cmd /c cd /d C:\dev\content-engine && npm run media:prune >> media.log 2>&1"
```

**Publish due posts every 5 minutes** — arrives with O13 (`npm run
publish:due`); the exact line is added here then.

## 7b. Telegram capture (arrives with S16)

Save links from your phone by sending them to a Telegram bot, even while the
PC is off. It runs on a free Cloudflare Worker, not on this PC. What you need
first: a bot from **@BotFather** in Telegram, your chat id, and a free
Cloudflare account. The install steps (including `npx wrangler login`) come
with S16 in `workers/telegram-capture/README.md`. Until then, use the phone
share sheet: [CAPTURE.md](CAPTURE.md).

## 8. Updating

When there is a new version:

```powershell
cd C:\dev\content-engine
git pull
npm install
npm run db:migrate
npm run build
```

`npm run build` matters if you use `start.bat` — it only builds when there is no build yet.

## Troubleshooting

**"Port 3000 is already in use" / `EADDRINUSE`.** The app is already running
in another window — use that one, or close it. To find what holds the port:

```powershell
netstat -ano | findstr :3000
taskkill /PID <the number at the end of the line> /F
```

**Database errors** (`ECONNREFUSED`, `password authentication failed`,
`ENOTFOUND`, `Invalid URL`). `DATABASE_URL` is wrong. Copy it again from Neon
(**Connect** button), paste it between the quotes in `.env`, check there are no
spaces, and run `npm run db:check`. If `db:check` passes but the app still
fails, check the line `DB_DRIVER=pg` is there.

**"GEMINI_API_KEY is not set", "API key not valid", or a key error in the
app.** A key is missing or mistyped in `.env`. After fixing `.env`, stop the
app (Ctrl+C) and start it again — `.env` is only read at start. A Gemini error
about billing or grounding means the key's Google project has no billing.
YouTube errors (channel stats, outliers empty) mean `YOUTUBE_API_KEY` is
missing or the YouTube Data API v3 is not enabled on its project.

**Can't log in.** Re-run `npm run yt:seed-owner` with `ADMIN_PASSWORD` set in
`.env`; it resets the password.
