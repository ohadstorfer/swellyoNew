# Status — Ohad, July 13–14

1. **Geo-tiered matching is LIVE (server-side):** `match_surfers` RPC now ranks by distance to the requested spot (≈5 km / ≈40 km / country tiers; country wall unchanged). The real matching path is the `swelly-trip-planning-copy` edge fn → RPC — client `findMatchingUsers` is dead code, CLAUDE.md's "Phase 2 client matching" is stale.
2. **Extraction fix:** spots were landing in `destination_country` ("Israel, Hof Hatzuk"), silently disabling tiering — fixed in the prompt (deployed v92) + defensive client parse.
3. **New "Share to Story" (trip ⋮ menu):** branded 9:16 story card → Instagram Stories; the invite link goes via clipboard → manual Link sticker (IG blocks auto-links for third parties). **Native change** — needs the next rebuild + a Meta App ID env var before it works.
4. **Small fixes:** contact bubble shows "Open" for the sender, onboarding budget-card layout tweaks, invite recommendations capped at top 20.
5. Everything is on `origin/ohad` through `b9d96dc`; specs/plans in `docs/superpowers/`. Still pending: on-device tests for geo matching + story share.
