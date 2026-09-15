---
name: project-wetravel-pricing-and-fees
description: Exact WeTravel.com subscription pricing and payout/treasury fees researched 2026-08-25, for the wetravel-mockup spec
metadata:
  type: project
---

Researched exact WeTravel pricing (subscription tiers) and payout/treasury fees on 2026-08-25 for the wetravel-mockup project. Full findings delivered inline in that conversation turn (not duplicated here in full — see below for the load-bearing numbers and gotchas future lookups should know).

**Why:** the mockup spec needed WeTravel's real numbers to model pricing/fee UI accurately, not invented placeholders.

**How to apply:** if this gets re-researched later, start from these facts and re-verify anything price-related (subscription price is the most likely to have changed) rather than re-deriving from scratch.

Key numbers (verified where noted, otherwise see caveats):
- Plans: **Basic** (free, 1% base processing fee floor), **Pro** ($79/month, monthly or annual billing), **Enterprise** (custom). No "Plus"/"Premium" tier exists.
- Pro annual = $948/year per a third-party aggregator (pricingnow.com) — this is $79×12 exactly, i.e. **no annual discount could be confirmed from an official WeTravel source**. Flag as DERIVED, not confirmed on wetravel.com/pricing itself (that page renders the annual figure as an interactive toggle that the text-extraction tools couldn't read).
- Free trial: 60 days for new users; 30-day money-back guarantee on any Pro upgrade.
- Non-profit (501(c)(3)) and select university student-trip discounts exist but **no exact percentage is published anywhere found** — repeated as "preferential rate" with no number.
- No evidence found that the WeTravel booking/processing fee % is lower on Pro vs Basic. Every source describes processing fees as method/currency-based (card vs ACH/SEPA/etc.), not plan-tier-based. This is a meaningful negative finding, not a gap — searched specifically per the task's flag and found nothing tying fee % reduction to Pro/Enterprise.
- WeTravel platform fee: "as low as 1% + $0.30" per transaction, **minimum fee $1.50 USD** (help.wetravel.com/en/articles/434422-pricing). Card network fees stack on top: 2.9% (Visa/MC USD), 3.9% AMEX, 3.3% Apple/Google Pay — varies materially by currency (table pulled from product.wetravel.com/payment-processing, e.g. EUR SEPA/iDeal/Bancontact = 0%, GBP BACS = 0%, CAD PAD = 0%).
- Local bank payout: free, 1-3 business days (help.wetravel.com/en/articles/434422-pricing).
- International wire **payout**: $15 (or equivalent) per transfer, 3-5 business days — this is a DIFFERENT number from wire-related fees elsewhere (see below), don't conflate them.
- Wire transfer **refund** fee: 25 EUR/USD (help.wetravel.com/en/articles/1217697-are-there-fees-for-refunds) — different context (refund, not payout).
- Wire transfer as a **top-up/collection** method: shows as $25 flat fee on product.wetravel.com/payment-processing table — again a different context (incoming funds, not payout).
- So there are three distinct "$15 vs $25" wire figures depending on direction (payout out / refund / top-up in) — this is NOT a source disagreement, it's three different flows. Future lookups should keep these separate.
- Instant Payout (USD only, US-issued debit card required): 1.5% fee per transaction, min $0.50, max $3,000/day. Arrives "sometimes instantly, up to 30 minutes." Source: help.wetravel.com/en/articles/6049882-how-to-payout-usd-funds-instantly.
- Supplier/vendor transfers: stated as free/zero-fee, "in seconds," on both academy.wetravel.com/wetravel-vendor-transfers and help.wetravel.com/en/articles/3392470-what-are-supplier-transfers.
- WeTravel Card: no annual/card-creation/membership fees confirmed. ATM withdrawal fee and exact FX markup % were NOT found in any fetchable text — the FAQ defers to region-specific (US vs International) sub-FAQs that weren't independently locatable/fetchable in this pass.
- Chargeback/dispute: no exact dollar chargeback fee found. Confirmed mechanism: the disputed Trip Cost amount is deducted from the organizer's WeTravel balance in full, organizer is liable for "all disputes or chargebacks received (including any relevant costs and fines)" — but no flat fee number is published (help.wetravel.com/en/articles/1687811-how-does-wetravel-handle-disputes, and Terms and Conditions).

**Access-method notes for next time:**
- `www.wetravel.com/*` direct WebFetch = 403. Workaround that WORKED: `https://r.jina.ai/https://www.wetravel.com/pricing`.
- `help.wetravel.com` and `product.wetravel.com` and `academy.wetravel.com` fetch fine directly with WebFetch, no proxy needed.
- `web.archive.org` / Wayback Machine is **completely blocked** for this WebFetch tool — both direct and via the r.jina.ai proxy (proxy got a 403 from archive.org itself). Could not get historical/older pricing to check for drift over time. If this matters later, try a different fetch path (curl via Bash, or a different MCP fetch tool) rather than WebFetch/jina.
- The `434422-pricing` help article's actual per-currency fee % table is rendered as **images**, not text — text extraction tools (WebFetch's markdown conversion) cannot read them. If exact per-currency % is needed again, use `product.wetravel.com/payment-processing` instead — that one rendered as an actual text/HTML table with all currencies and methods broken out.
