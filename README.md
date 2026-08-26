# Content Engine

Multi-brand social content pipeline: research → ideate → plan → generate
(via a swappable AI provider — Higgsfield today) → post, for Paraguay
Residency Guide, propia.com.py, and the .com.py brand family.

## How it works

- **Database is the source of truth** (`src/db/schema.ts`): `brands`,
  `ideas`, `calendar_items`, `assets`, `posts`. Deterministic bookkeeping —
  adding ideas, scheduling, recording generated assets/posts — goes through
  the scripts in `scripts/`.
- **Claude Code is the orchestrator.** Research, ideation, prompt-writing,
  and the actual media generation/posting calls (via MCP tools) happen as
  agent reasoning, driven by `.claude/skills/content-engine/SKILL.md`. Run it
  by asking Claude Code to "run content engine" / "plan this week's posts for
  pozo" / etc.
- **Providers are swappable.** `src/lib/providers/registry.ts` maps a
  provider id (`higgsfield`, `runway`, ...) to the MCP tool names that
  generate for it. `calendar_items.provider` picks the provider per item.
  Adding Runway/Kling/fal.ai later means: add an entry to the registry, wire
  the MCP connection, done — no pipeline code changes.

## Setup

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL
npm run db:migrate     # after generating migrations with drizzle-kit
npm run db:seed        # seeds all brands from src/lib/brands.ts
npm run db:check
```

## Brands

See `src/lib/brands.ts` for the full list (Paraguay Residency Guide, propia,
contador, negocio, obra, viaje, visas, pozo, clientes, sitiosweb, contenido).
Add a new business by adding an entry there and re-running `db:seed`.

## Day-to-day usage

```bash
npm run idea:list -- --brand pozo         # see proposed ideas awaiting approval
npm run plan:week -- --idea 12 --platform instagram --date 2026-09-02T14:00:00Z
npm run queue:due                          # what's ready to generate/post
```

But normally you won't run these by hand — ask Claude Code to run the
`content-engine` skill and it drives the loop, calling these scripts itself
between research/generation steps.

## Posting

Not wired to a live API yet — see `src/lib/posting/README.md`. Recommended
default is Ayrshare (one API across Instagram/TikTok/Facebook/LinkedIn/etc.)
rather than juggling each platform's native, gated API separately.
