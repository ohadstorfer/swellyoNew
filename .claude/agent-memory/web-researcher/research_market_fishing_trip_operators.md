---
name: research-market-fishing-trip-operators
description: Market sizing for fly-fishing / sport-fishing multi-day group-trip operators — census anchors found, anchors that blocked scrapers, and the price gap still open
metadata:
  type: project
---

Market-sizing research (2026-09-10) on destination fly-fishing / sport-fishing operators
selling multi-day fixed-date trips. Ran with the session's WebSearch budget already
exhausted (200/200), so everything below came from direct WebFetch on guessed URLs.

**Anchors that WORKED**
- Nervous Waters: "19 fishing operations" — Argentina 7, Chile 1, Mexico 3, Bahamas 3,
  USA 5. Source: https://www.nervouswaters.com/ . Cleanest hard number in the niche.
- The Fly Shop travel archive paginates to "25" pages at ~9 listings/page
  (~200-225 listings). Derived, not published. https://www.theflyshop.com/travel/
- Orvis says "hundreds of Orvis-Endorsed experiences worldwide" — qualitative only,
  no per-category count on https://www.orvis.com/adventures

**Anchors that BLOCKED or 404'd (do not retry the same paths)**
- orvis.com: every /endorsed-* path guessed returned 404. Only /adventures resolved.
- frontierstravel.com: 403 Forbidden on both root and /about-us. Needs search-engine
  cache or a different fetcher.
- yellowdogflyfishing.com: only "/" resolves. /about, /about-us, /lodges,
  /destinations, /why-book-with-yellow-dog all 404. Homepage lists ~31 named premier
  lodge partners but states no total.
- flyfishersinternational.org: /About-Us resolves but carries no membership numbers;
  /Clubs is 404.

**Still open**
- No published per-person price found. Fly-fishing lodges hide rates behind
  "contact us" / a separate "Our Rates" subpage; listing pages carry no prices.
  Next time go straight to a lodge's own /rates page, not the agency listing.
- Orvis endorsed-program category counts never obtained.

**Why:** feeding a niche-by-niche TAM comparison for Swellyo's operator-trips product.
**How to apply:** if this niche is revisited, start from Nervous Waters (19) and
The Fly Shop (~200 listings) as the anchors; treat charter-permit counts as day-ops
and out of scope.
