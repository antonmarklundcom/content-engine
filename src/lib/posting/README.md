# Posting layer

Native platform APIs for posting are inconsistent and gated (Instagram/TikTok
require Meta/TikTok Business API approval; X's API is paid; LinkedIn has its
own review process). The pragmatic default for a multi-brand, multi-platform
setup like this is **Ayrshare** (https://www.ayrshare.com) — one API that
posts to Instagram, TikTok, Facebook, LinkedIn, X, YouTube Shorts, etc., and
handles the platform-specific auth dance for you per connected account.

## Plan

- One Ayrshare "profile" per brand (it supports multi-profile/multi-account
  setups on paid plans) — keeps each business's connected accounts separate.
- `AYRSHARE_API_KEY` (and per-brand `AYRSHARE_PROFILE_KEY`) go in `.env`,
  never committed.
- A `post()` call takes the generated asset URL + caption from a
  `calendar_items` row (status `ready_to_post`), posts via Ayrshare's REST
  API, then the agent calls `scripts/mark-posted.ts` to record the result.

## Alternative

If you'd rather post natively without a middleman: Meta Graph API directly
covers Instagram + Facebook (free, but requires a Business app + review).
TikTok's Content Posting API is available but has stricter approval. Start
with Ayrshare for coverage across all platforms/brands at once; drop to
native APIs later for any platform where Ayrshare's terms or cost don't work
for you.

This adapter isn't implemented yet — wire it once you've created the
Ayrshare account and connected the first brand's social accounts.
