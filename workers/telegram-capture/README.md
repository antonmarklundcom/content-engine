# Telegram capture Worker

Send a link to your Telegram bot from your phone and it lands in the content-engine
inbox (`/inbox`), even while the PC is off (PLAN.md §1.43). Runs on Cloudflare's free
Workers plan and writes straight to the Neon database the app uses.

## Message grammar

```
https://instagram.com/reel/abc #guide #factcheck #visa says 90 days?
```

- the first link is the clip (tracking junk stripped, same as the app);
- `#<brand id>` (or an alias from `TELEGRAM_BRAND_ALIASES`) sets the brand;
- `#inspo` `#competitor` `#factcheck` `#own` set the purpose;
- any other `#tag` becomes a tag; the rest of the text is the note.

A photo or video sent **as a file** (paperclip → File) keeps its Telegram `file_id`, so
the PC-side fetch job (S17) can download it later (Bot API limit 20 MB). Put the link and
hashtags in the caption. With no link, the clip gets a placeholder
`https://telegram.invalid/file/<id>` URL.

Replies: `Saved ✓ (<brand>, <purpose>)` for a new clip, `Already saved, note updated`
for a link that was already in the inbox (only the note changes, like every other
capture path).

## One-time setup

1. **Create the bot.** In Telegram, message **@BotFather** → `/newbot` → pick a name.
   Copy the token it gives you (`123456:ABC…`). Keep it secret.
2. **Find your chat id.** Message your new bot once (anything), then open
   `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser and read
   `message.chat.id` (a number such as `123456789`). Do this *before* step 5 — once the
   webhook is set, `getUpdates` stops working.
3. **Install and log in** (from this folder):
   ```bash
   npm install
   npx wrangler login
   ```
4. **Set the secrets** (`wrangler secret put` prompts for each value):
   ```bash
   npx wrangler secret put DATABASE_URL             # the app's Neon URL (.env DATABASE_URL)
   npx wrangler secret put TELEGRAM_WEBHOOK_SECRET  # any random A-Z a-z 0-9 _ - string
   npx wrangler secret put TELEGRAM_ALLOWED_CHAT_IDS  # e.g. 123456789 (comma-separate several)
   npx wrangler secret put TELEGRAM_BRAND_ALIASES   # optional, e.g. {"guia":"guide"}
   ```
   A random secret: `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`.
5. **Deploy, then register the webhook:**
   ```bash
   npm run deploy      # prints https://content-engine-telegram-capture.<you>.workers.dev
   TELEGRAM_BOT_TOKEN=<token> TELEGRAM_WEBHOOK_SECRET=<same secret> \
     WORKER_URL=https://content-engine-telegram-capture.<you>.workers.dev npm run setup
   ```
   On Windows PowerShell set each with `$env:TELEGRAM_BOT_TOKEN="…"` first.
6. Send the bot a link. It should answer `Saved ✓ (no brand, no purpose)`.

## Safety

- Every request must carry Telegram's `X-Telegram-Bot-Api-Secret-Token`, compared in
  constant time; anything else gets 401.
- Chats not in `TELEGRAM_ALLOWED_CHAT_IDS` are ignored without a reply. An empty list
  serves nobody.
- The Worker only ever runs one `select` (active brand ids, cached 5 min) and one
  `insert … on conflict` into `clips`.

## Development

`npm test` runs the unit tests with a mocked Neon client (no install needed inside the
root repo: `tsx` and `@neondatabase/serverless` resolve from the root `node_modules`).
`npm run typecheck` checks this folder, which the root typecheck excludes.
The parser and URL canonicaliser are imported from `../../src/lib/clips/` and bundled
by Wrangler, so the Worker dedupes exactly like the app.
