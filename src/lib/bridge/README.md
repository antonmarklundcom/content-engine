# `src/lib/bridge/` — the query layer between the app's two halves

The brand-ideation half (`brands`/`research_notes`/`ideas`) and the YouTube
research half (`sources`→`videos`→`analyses`→`topics`) share a repo, a deploy
and a login, and now share data through exactly these functions (PLAN.md
§5.O1.4).

Two rules keep that boundary meaningful:

1. **Reads only, and only what a later phase actually needs.** Writes stay in
   the route or server action that owns them; this module never inserts.
2. **Later phases read through here.** The Sonnet UI phase (§4.7) may not
   query `db` directly — if a page needs a shape this module does not expose,
   the shape gets added here rather than a join getting written in a view.

Everything here is server-side: `db` is a Neon HTTP client and the modules are
marked `server-only` so an accidental client import fails at build time rather
than at runtime.
