---
name: project-wetravel-holds-escrow-kyc
description: WeTravel's KYC/verification tiers, Partial Approval hold, dispute timeline, and lack of true escrow — competitive research for Swellyo operator-trips payments
metadata:
  type: project
---

Researched 2026-08-25 for competitive analysis of WeTravel's money-holding model (operator-trips / merchant-of-record work, see [[project_operator_becomes_merchant_of_record]] in the main Swellyo memory).

**KYC**: 3 tiers via Persona — Supplier (ID+selfie, can receive funds) → Trusted Partner (+address, biz docs) → Trip Organizer (+travel registration, required to collect traveler payments). Review takes up to 3 business days. Source: help.wetravel.com/en/articles/1619345-guide-to-getting-verified-on-wetravel (direct fetch works fine, only www.wetravel.com apex domain 403s scrapers).

**Partial Approval = WeTravel's de-facto escrow substitute, not a universal rule.** Most new organizers land here. It blocks international wire, WeTravel Card, and Supplier Transfers — but does NOT block a Stripe Standard passthrough (funds bypass WeTravel entirely if you connect your own Stripe). Exit path: wait 30 days after first trip completes, email support, manual re-review (no automated upgrade). Source: help.wetravel.com/en/articles/6460145-partial-approval-decision.

**Why this matters for us**: WeTravel has NO universal "funds held until trip departs" rule. Fully-verified organizers can withdraw the instant a card payment clears (help.wetravel.com/en/articles/415020-...). The hold is entirely a function of verification tier, not trip timing. If we build merchant-of-record features, "hold until departure" would be a stricter/different model than WeTravel's — worth deciding deliberately rather than assuming WeTravel-parity.

**Disputes**: full trip amount frozen instantly by processor on dispute filing, 60-80 day resolution typical, organizer is liable for the disputed amount + admin fees even into negative balance. Source: help.wetravel.com/en/articles/1687811-how-does-wetravel-handle-disputes (this matches the URL structure the user already had — good sign that URL pattern is stable for future lookups).

**Rolling reserve clause — UNVERIFIED, flag if reused**: search snippets (not a direct page read) suggest WeTravel's ToS lets them hold "risk-based holds ... up to 30 days" and hold an amount "equivalent to total payments for upcoming and future trips, expected refunds, or potential chargeback amounts." Could not confirm by reading wetravel.com/terms directly — it 403s WebFetch, Wayback snapshot exists (web.archive.org/web/20260103101032/https://www.wetravel.com/terms) but the WebFetch tool refuses archive.org, and r.jina.ai proxy returned a blocked-page stub, not content. If this fact is needed again, get someone to open the ToS in a real browser and paste the text — don't re-attempt automated fetch, it won't work.

**Access method that works**: help.wetravel.com (Intercom-hosted) is fully fetchable by WebFetch. www.wetravel.com apex domain (terms, security, marketing pages) 403s every automated fetcher tried (direct, Wayback, r.jina.ai). Trustpilot review pages fetch fine directly and have concrete organizer complaints (Andres Campos ~$500 held >1 month, Jim Zuckerman "withheld a lot of money... for weeks").

**How to apply**: When designing Swellyo's own hold/reserve/verification-tier logic for operator trips, WeTravel's Partial-Approval-as-escrow-substitute is a reasonable pattern to reference, but don't assume the rolling-reserve ToS language above is accurate without a human re-check.
