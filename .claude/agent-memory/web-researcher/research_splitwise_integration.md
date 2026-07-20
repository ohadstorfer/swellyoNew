---
name: research-splitwise-integration
description: Splitwise API status 2026 (open self-serve but explicitly not licensed for commercial apps), deep-link/embed options (none), and alternatives (Spliit self-host, build-it-yourself debt simplification) for Swellyo group-trip expense splitting
metadata:
  type: project
---

## Splitwise API — status as of 2026

- **API is live and self-serve registration is open** at secure.splitwise.com/apps (register → get consumer_key/consumer_secret → OAuth or API key). No evidence found of registration being paused/closed — that rumor does not check out for 2025-2026. Docs: dev.splitwise.com, github.com/splitwise/api-docs.
- **BUT the self-serve tier is explicitly NOT licensed for commercial use.** Splitwise's own docs/ToS say: "conservative rate and access limits, which are subject to change at any time and not well suited to commercial projects" and "we strongly encourage you to contact developers@splitwise.com" for any commercial integration, where they offer a private API + Enterprise support + a negotiated commercial license.
- **ToS hard restriction**: "Splitwise Materials" (API + API docs + Splitwise Data) may only be used "solely as necessary to develop, test and support a Self-Service integration." You may NOT "sell, lease, rent, sublicense or in any way otherwise commercialize any Splitwise Data... and/or Splitwise Materials." Also can't use Splitwise's name/brand to promote your product.
- No public pricing tier for commercial API access — it's a negotiated deal via developers@splitwise.com, not self-serve checkout. Splitwise Pro ($4.99/mo or ~$29.99-39.99/yr) is a consumer subscription (receipt scanning, currency conversion) — unrelated to API access, does not grant commercial API rights.
- **API capabilities** (self-serve): create/update/delete/restore expenses, create/delete/restore groups + add/remove users, list friends, read balances, comments, currencies/categories. OAuth2 + API-key auth both supported. This covers what Swellyo would need functionally (create group, add expense on behalf of user, read balances) — the blocker is licensing/commercial terms, not missing endpoints.
- **No deep-link scheme found.** No `splitwise://add-expense` URL scheme, no Android intent, no share-sheet "add expense" action, no partner/embed widget program exists. The only documented automation path is iOS Shortcuts calling the REST API directly with a personal Bearer token (florianschroedl.com) — not viable for a multi-user third-party app since it needs per-user OAuth consent flow anyway, which loops back to the same self-serve-vs-commercial API question.

## Alternatives evaluated

- **Spliit** (github.com/spliit-app/spliit) — open-source, self-hostable (Next.js + Prisma + Postgres), MIT-style license, no user accounts needed for participants (link-based), has receipt-scanning AI feature. Has basic internal API routes but not designed as a public third-party integration API — you'd be forking/self-hosting it as your own backend, not "integrating" with it. **This is the closest fit to Swellyo's stack** (Next.js/Prisma — same ORM as Swellyo) if the choice is build-vs-fork rather than integrate.
- **Settle Up** — consumer app, confirmed no public API, no white-label option.
- **Tricount (by bunq)** — consumer app, confirmed no public API, no white-label/B2B option.
- **Tripcoin** — a travel budget/expense app, but no evidence of any Splitwise integration; it's a separate standalone tracker, not a proof-of-concept for third-party Splitwise integration.
- **Build-it-yourself debt-simplification** — well-trodden problem, multiple reference implementations (github.com/ykarikos/simplify-debts, github.com/IsaacCheng9/fairsplit — greedy O(n log n) transaction-minimization algorithm, github.com/Devasy/splitwiser — Expo+TS+FastAPI+Mongo full clone). The core algorithm (min-cash-flow / greedy debt netting) is simple and well documented (see Medium: "Algorithm Behind Splitwise's Debt Simplification Feature").

## Verdict for Swellyo

No app is known to have successfully shipped a commercial third-party Splitwise integration on the self-serve tier — the ToS language plus the "contact us" gate for anything commercial strongly implies Splitwise gates commercial use manually and doesn't advertise approved partners. Ranked options, deep to shallow:

1. **Build native in-app expense splitting** (own DB tables + a debt-simplification function) — full control, fits existing Supabase/Prisma stack, no external dependency or ToS risk, works offline-first for a group trip. Recommended path.
2. **Contact developers@splitwise.com for a commercial/enterprise agreement** — only viable if Swellyo wants actual Splitwise brand/data sync and is willing to negotiate terms (pricing/rate limits unknown, response time unknown, may be slow for a startup).
3. **Self-serve API "soft" integration** (e.g., "export your trip expenses to Splitwise" as a manual one-way push using a user's own OAuth token) — technically usable today without asking Splitwise for permission since it's still "self-service" per user, but ToS says self-serve tier isn't "well suited to commercial projects" — risk of being rate-limited/cut off if usage scales, and can't be marketed as an official integration.
4. **Deep link / intent** — does not exist, not an option.

## Sources
- https://dev.splitwise.com/
- https://github.com/splitwise/api-docs
- https://splitwise.readthedocs.io/en/latest/api.html
- https://www.splitwise.com/terms
- https://blog.splitwise.com/2013/07/15/setting-up-oauth-for-the-splitwise-api/ (registration flow, still current per 2026 secondary sources)
- https://splittyapp.com/learn/splitwise-free-limits/ (Splitwise Pro pricing 2026)
- https://github.com/spliit-app/spliit
- https://github.com/oss-apps/split-pro
- https://github.com/ykarikos/simplify-debts
- https://github.com/IsaacCheng9/fairsplit
- https://github.com/Devasy/splitwiser
- https://medium.com/@mithunmk93/algorithm-behind-splitwises-debt-simplification-feature-8ac485e97688
- https://florianschroedl.com/blog/creating-splitwise-shortcut-for-ios/ (confirms no deep link/share-sheet exists, only raw API calls)
