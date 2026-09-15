---
name: wetravel-marketing-growth
description: WeTravel marketing/growth feature UI details — discount codes, abandoned cart, embed widgets, white-label, partner hub, no real referral/affiliate program, no consumer marketplace
metadata:
  type: project
---

Researched Aug 2026 for Swellyo operator-dashboard mockup work. Complements [[wetravel-pricing]] (fee/margin econ) and [[wetravel-integration]] (API/webhook mechanics). This memory covers only the traveler/organizer-facing marketing & growth surface: discount codes, referral/affiliate, agent portal, abandoned booking recovery, embed widgets, white-label, SEO/marketplace, website builder, pricing gating.

## Discount / Promo Codes
- Created in trip builder → last tab **"Settings"** (NOT "Pricing" — one academy article said Pricing tab 4th, official help article says Settings; academy is likely stale, trust help center).
- Question: "Are you offering discount codes that apply only for this trip?" (Yes/No) → button **"Add a trip specific discount"** → pop-up → **"Publish"**.
- Account-level: **Business Settings → Discounts → "Create discount"**, auto-applies to all trips.
- Types: percentage or fixed amount. Fixed-amount only applies to trips in matching currency.
- Expiry: "Always available," specific date range, or N days before trip start.
- Usage limit: single "overall" cap field, no per-user limit.
- Checkout field for traveler: **"Discount code"**.
- Rule: one code per booking; applies only to balance due, NOT the deposit; not usable on installments or add-ons.
- Available on BOTH Basic (free) and Pro plan per pricing table.

## Referral / Affiliate — DOES NOT EXIST AS A FORMAL PROGRAM
- No dedicated referral or affiliate program found (neither traveler-refers-traveler nor organizer-refers-organizer-to-WeTravel).
- The only "referral" mechanic is generic: organizers manually create a discount code and hand it to a referred friend — reused general-purpose discount code tooling, not a tracked referral system with rewards/payouts.
- Confirmed via multiple targeted searches ("refer a friend," "affiliate program," "sign-up bonus") — nothing found beyond generic discount codes.

## Travel Agent / B2B
- No dedicated "agent portal" product page found (product.wetravel.com/travel-agencies-us = 404). Real page: **product.wetravel.com/travel-agency-software**.
- Agent booking-on-behalf-of-client flow = same "Add Participant" flow any organizer uses (not agent-specific): package select → currency → participant email/name → add-ons → payment option (Deposit+rest / Full amount / Enter Amount / No payment yet) → payment method (Checking Account / Credit-Debit Card / External Payment / Wire Transfer) → **"Confirm Booking"** → success toast "Participant successfully added."
- No commission-tracking feature for agents found. "WeTravel Transfer" is fee-free partner payouts, not a commission ledger.
- **Partner Hub** (Business Settings → Partner Hub) = B2B directory of organizers/suppliers, gated to fully-approved accounts. Toggle discoverability Yes/No, fill operating country/business type/travel type, "Save Settings." Search filters: country, business type, travel type, membership.
- **Partner Marketplace** = "Marketplace Board" inside Partner Hub (Network tab) — post types: "Request a Service," "Offer My Services as a Supplier," "Share Networking Opportunities." Anonymous by default (except supplier-offer posts). Response = "connection request," "Connection Requests" tab tracks sent/received.
- Messaging cap: 3 messages/day via hub.

## Abandoned Booking Recovery
- Article: "How do the abandoned checkout emails work on WeTravel?" (help.wetravel.com/en/articles/6601888 — redirects, slug changed).
- Sent 24h after checkout start if not completed. ONE email only per abandoned session.
- Toggle: **Business Settings → General → "Send abandoned checkout emails"**. Pro can toggle on/off; Basic can view only (read-only) — this conflicts with the pricing table which checkmarks "Abandoned cart emails" for BOTH Basic and Pro; help article is the more granular/authoritative source, flag discrepancy.
- Email button: **"Complete Your Booking"**; also has "contact us here" link.
- Auto-creates a CRM Opportunity: **CRM → Opportunities → filter Sources → "Abandoned Checkout"**, logs two activities: "Checkout Abandoned" and "Follow-up email."
- No customization of email content — feature request only, via info@wetravel.com.

## Embeddable Widgets
- Trip-level widgets: **Manage Trip → Promote tab**. Types: Book Now (button text/color, "Text link" checkbox), Packages (button text/color, "Show Reviews" toggle, low-availability warnings), Direct Link, Brochure Button, Trip Inquiry Form (Inline/Popup, drag-and-drop "Edit Form Template", fixed fields first/last/email).
- Account-level widgets: **Business Settings → Website Widgets tab**. Types: All Trips (button text/color/title, filter by tags, shows "Sold out"/"Only X spots left"), Reviews (show count/stars/both), Contact Us Form (Inline/Popup).
- Universal action: **"Copy HTML"** button → paste into site. iframe overlay checkout.
- Platform quirks: overlay doesn't work on WordPress.com Free/Personal; Wix needs Lightbox/booking-URL workaround (raw embed unsupported); Squarespace JS/iframe needs Business plan.
- Widgets are free on all plans (pricing table: "Website widgets integration — Free" for both).

## White-Label
- Called **"WeTravel Pro"** — gated entirely to Pro ($79/mo).
- Custom URL setup: Account → "WeTravel Pro settings" section → enter company name → **"Save Custom URL"** → confirm popup **"Confirm Custom URL"**.
- Format: `[company-name].wetravel.com/trips/[trip-slug]` (subdomain, not full custom domain — NOT a true custom domain like `book.yourcompany.com`; UNCERTAIN whether a true apex/custom-domain option exists beyond this subdomain — no evidence found of DNS/CNAME custom domain support).
- Branded login page shows logo + company name top-left + subdomain in URL; applies to all automated emails, payment reminders, auto-billing receipts.
- Restriction: letters/numbers/dash only in subdomain; only main account (not team members) can set/change it; changing it later requires emailing support.
- Customers "do not see any links to other offerings on WeTravel" once Pro white-label is active.

## SEO / Marketplace / Public Listing
- Trips (and itineraries) have a **Public/Private** visibility setting. Public = indexable by search engines and viewable by anyone; Private = accessible only via direct link. Itineraries default to Private. "The large majority of trips on WeTravel are private."
- No confirmed consumer-facing marketplace/directory (no `/marketplace`, `/explore` browsing UI found on wetravel.com). One academy blog line claims "we offer a great marketplace to list your tours" — but this reads as legacy/aspirational marketing copy, not a real discoverable feature; treat as UNCERTAIN / likely stale. The only concretely documented "marketplace" is the B2B **Partner Marketplace** (Partner Hub), which is NOT consumer-facing.
- WeTravel's own promotion for organizers = social sharing (Facebook/Twitter link), embeddable widgets, brochure downloads, occasional inclusion in WeTravel's own blog/social content — not a built-in SEO/listing product beyond the public/private toggle.

## Website Builder — DOES NOT EXIST
- No dedicated website builder product. WeTravel only provides embeddable widgets/iframes to drop into a site built elsewhere (WordPress/Squarespace/Wix/Weebly/Shopify — one help article each) plus Academy content teaching *how* to pick a 3rd-party website builder. Trip Pages themselves (hosted on wetravel.com/[subdomain]/trips/...) function as a lightweight de facto landing page per trip, but this is not marketed or built as a general website builder.

## Pricing Plan Gating (full table fetched from product.wetravel.com/pricing, Aug 2026)
- **Basic**: $0/mo. **Pro**: $79/mo/org. **Enterprise**: custom.
- Marketing Tools row on pricing table: Lead capture tools (Basic+Pro), Custom contact form (Basic+Pro), **Discount codes (Basic+Pro)**, Seasonal pricing (Pro only), **Abandoned cart emails (Basic+Pro per table — conflicts with granular help article above)**, Waitlists (Basic+Pro), Reviews display (Basic+Pro).
- Branding & Customization row: Branded email communications (Pro only), **Custom URLs (Pro only)**, Branded login pages and customer portal (Pro only), Personalized T&Cs in checkout (Basic+Pro), Custom insurance link (Pro only).
- Partner Management & Payouts row: **Partner Hub (Pro only)**, **Partner Marketplace (Pro only)** — i.e. Basic-plan organizers cannot access Partner Hub/Marketplace at all, contradicts earlier assumption that any approved org can join; gate is Pro-plan, not just approval.
- Integrations row: Zapier (Pro only), Partner API (Pro only), Google Analytics (Pro only).

**Why:** Ohad is rebuilding equivalent marketing/growth screens as a mockup (operator-dashboard) and needed exact field/button/tab names, not summaries.
**How to apply:** Use "Settings" tab (trip builder) as canonical location for discount code creation in the mockup, not "Pricing" tab. Model white-label as subdomain-only (not full custom domain) unless later evidence surfaces otherwise. Do not build a consumer marketplace/SEO directory parity feature — WeTravel doesn't clearly have one; the public/private trip toggle is the closest real analog.
