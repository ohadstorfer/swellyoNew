---
name: wetravel-integration
description: Can a third party (Swellyo) integrate with WeTravel so WeTravel is only the payment/checkout layer? API access model, embed widget, webhooks, deep-linking feasibility.
metadata:
  type: project
---

Researched July 2026. Complements [[wetravel-pricing]] (which covers WeTravel's fee/margin structure). This memory covers integration mechanics: can Swellyo use WeTravel purely as a checkout processor while Swellyo owns organizing/matching/social layer.

## The core blocker: no multi-tenant partner model

WeTravel's API/webhook system is single-account only. There is NO OAuth-based marketplace/partner program where a platform (Swellyo) registers once and gets programmatic access across many operator accounts (unlike Stripe Connect). Confirmed by checking "WeTravel Partner Hub" — that's just a B2B networking directory between WeTravel organizers/suppliers, not an integration framework.

Practical implication: to integrate any given operator, THAT operator must individually:
1. Be on WeTravel **Pro plan** ($79/mo) — API/webhook access is Pro-only, free plan has none.
2. Log into their own WeTravel account and manually click "Generate API Key" (Account → Profile → Partner API Integration).
3. Share that key with Swellyo, and set up webhooks pointing at a Swellyo endpoint (managed via an embedded Svix dashboard).
4. Only the main account owner can do this — team members can't access API/webhook settings.

This does NOT scale to "many small operators" — most surf camp operators are on WeTravel's free plan (1% fee + 2.9% card fee), not Pro. Expecting each to upgrade to Pro and hand-configure API keys per integration is a major adoption blocker.

## What the API actually offers (if an operator did set it up)

Seven API categories via developer.wetravel.com/docs: Authentication, Payment Links, Trip Builder, Booking, Transactions, Suppliers, Leads. Webhooks fire on booking created/updated, payment created, cancellation, etc. — could theoretically let Swellyo mark a participant "paid" in near-real time. No published fees for API usage itself (only Pro plan gatekeeps access).

Payment Links API is closest to "use WeTravel purely as processor" — lets you generate/update a shareable one-time payment link programmatically. Still requires operator API key + Pro plan.

## Embeddable checkout widget — the more realistic option

WeTravel has a "Book Now" embed widget (Manage Trip → Promote tab) that generates an iframe-overlay checkout on the operator's own website — no API/Pro plan required, available to ALL operators. Copy-paste HTML snippet. This is web-embed only; no confirmed evidence of React Native WebView compatibility, and iframe-based Stripe checkouts inside RN WebViews commonly hit 3DS/redirect friction (general industry pattern, not WeTravel-specific — flag as a risk to test, not confirmed either way).

## Deep-linking (simplest fallback)

No policy barrier found: operators can link out to their own WeTravel trip/checkout page (it's their own public booking URL). This works from a mobile app via `Linking.openURL()` — opens in the system browser, sidesteps WebView/iframe payment risk entirely. No API tier requirement, no per-operator engineering, no Pro plan needed. Downside: Swellyo gets zero signal that a payment happened — no automatic way to mark a participant "paid" without either (a) asking the operator to manually mark it in Swellyo, or (b) the Pro+API+webhook path above.

## Ranked integration options (lightest to deepest)

1. **Deep link only** — zero integration cost, works today for any operator regardless of plan. No "paid" status signal into Swellyo; operator must self-report.
2. **Embedded "Book Now" widget in WebView** — keeps user in-app, still no Pro/API requirement, but untested for RN WebView + Stripe iframe compatibility; needs a spike to de-risk 3DS/redirect flows.
3. **Zapier bridge** — WeTravel has an official Zapier integration (booking/payment triggers → 8000+ apps). Could route WeTravel events into a Swellyo-facing endpoint via Zapier without writing to the raw API, but still requires the operator's own Zapier account + likely still gated behind Pro for the richer triggers (unconfirmed — worth a follow-up test with a real operator's account).
4. **Direct Partner API + webhooks** — real-time "mark as paid" capability, but requires per-operator Pro plan ($79/mo) + manual API key exchange + no multi-tenant OAuth. Only worth doing for a handful of high-volume operator partners Swellyo actively courts, not a general-purpose feature for the long tail of small operators.

## Sources
- https://product.wetravel.com/api-overview
- https://help.wetravel.com/en/articles/5783395-how-to-use-wetravel-s-apis
- https://developer.wetravel.com/docs
- https://help.wetravel.com/en/articles/12956347-embedding-widgets-into-your-website
- https://academy.wetravel.com/ways-to-embed-a-wetravel-trip-into-your-website
- https://help.wetravel.com/en/articles/12546503-wetravel-partner-hub
- https://help.wetravel.com/en/articles/9886395-payment-link
- https://academy.wetravel.com/wetravel-zapier-integration
- https://help.wetravel.com/en/articles/4787245-how-to-use-wetravel-zapier-api-integration

**Why:** Eyal asked whether Swellyo can let operators keep using WeTravel for payments while Swellyo owns the organizing/matching layer, as an alternative/precursor to building Stripe Connect in-house.
**How to apply:** Do not plan a real-time "paid" webhook integration as a v1 — it doesn't scale across WeTravel's actual user base (mostly free-plan, not Pro). Recommend deep-link as the pragmatic v1 (manual "mark as paid" by operator), revisit API/webhook integration only for a small number of high-value operator partnerships willing to go Pro.
