# Content Engine

A web app: pick a brand, hit "Generate ideas", get back researched content
ideas with full ready-to-post captions for Instagram/Facebook (and other
platforms per brand). That's the whole product — research, ideas, and copy.
No media generation, no scheduling, no posting integration.

## Stack

- **Next.js** (App Router) — UI + API routes, deployable to Vercel
- **Neon Postgres** — via `drizzle-orm`
- **Gemini API** (`gemini-3.1-pro-preview` by default) — does the actual
  research (Grounding with Google Search) and writes the ideas + captions,
  called server-side from `/api/generate`

## How it works

1. You open a brand's page and click **Generate ideas**.
2. `/api/generate` calls Gemini with the brand's niche/voice/market and
   Search grounding. It researches current, real topics and returns 5-10
   ideas, each with a title, an angle, and a **full ready-to-post caption**
   in the brand's language and voice — not a placeholder.
3. If a research finding is relevant to more than one brand (e.g. Paraguay
   real-estate/development news relevant to both `residency-guide` and
   `propia`), it's saved once as a shared `research_notes` row tagged with
   every relevant brand, so a later run for another brand can reuse it
   instead of researching the same thing again.
4. Ideas are saved to Postgres and shown in the UI. You edit the copy inline
   if you want, then Approve or Reject each one. That's the end of the loop
   — there's nothing downstream to run.

## Setup

1. **Neon**: create a project at [neon.tech](https://neon.tech), copy its
   connection string into `DATABASE_URL`.
2. **Gemini**: create an API key at
   [aistudio.google.com/apikey](https://aistudio.google.com/apikey) on a
   billed project, put it in `GEMINI_API_KEY`. Search grounding and the Batch
   API both need billing enabled.
3. Copy `.env.example` to `.env` and fill in both.
4. Install and set up the database:
   ```bash
   npm install
   npm run db:generate   # generate SQL migrations from src/db/schema.ts
   npm run db:migrate    # apply them to your Neon database
   npm run db:seed       # insert the initial brands from src/db/seed.ts
   ```
5. Run it:
   ```bash
   npm run dev
   ```

## Deploying

Deploy to Vercel (`vercel deploy` or via the dashboard, importing this repo).
Set `DATABASE_URL` and `GEMINI_API_KEY` as Vercel project environment
variables — same values as your local `.env`. Neon and Vercel are a standard
pairing; no extra config needed beyond the env vars.

## Brands

The `brands` table is the source of truth — the app reads it, nothing else.
`src/db/seed.ts` holds the initial rows (Paraguay Residency Guide, propia,
contador, negocio, obra, viaje, visas, pozo, clientes, sitiosweb, contenido).

Add a new business by adding an entry there and re-running `npm run db:seed`:
the run inserts what is missing and leaves existing rows exactly as they are,
so a brand whose voice was tuned in the database is never clobbered by a
re-seed. To push edits from the file back over the stored rows on purpose,
run `npm run db:seed -- --overwrite`.
