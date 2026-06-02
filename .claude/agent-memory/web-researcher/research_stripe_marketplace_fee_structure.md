---
name: stripe-marketplace-fee-structure
description: Fee structure design for Swellyo surf-trip marketplace — platform take rate, host/guest split, Stripe fee absorption, ACH discounts
metadata:
  type: project
---

## Recommended Structure (as of May 2026 research)

**12% host commission (deducted from payout) + Swellyo eats Stripe card fees from that 12% + optional 3% traveler service fee for international/FX surcharges only.**

On a $1,500 trip:
- Swellyo collects $1,500 from traveler
- Stripe card fee: ~$43.80 (2.9% + $0.30)
- Platform gross from host commission (12% = $180)
- Swellyo net after absorbing Stripe fee: $180 - $43.80 = $136.20 (~9.1% effective)
- Host payout: $1,320

**Why:** Industry benchmark is 14-15% for retreat/experience marketplaces (BookRetreats 14%, Retreat Guru 15%, Sharetribe average 12.4%). Pre-launch, 12% is competitive enough to recruit hosts without Bill Gurley's "rake too far" risk.

## ACH / Bank Transfer

- Stripe ACH: 0.8% capped at $5. On $1,500 = $5 flat.
- Card fee on $1,500 = $43.80.
- Savings if traveler pays by bank: ~$38.80 per booking.
- At $50k/mo GMV (~33 trips), that's ~$1,280/mo saved if half switch to ACH.
- ACH discount nudge does shift behavior at $800+ ticket sizes — 85% repeat purchase rate on Stripe Instant Bank Payments, 14% checkout lift.
- Recommend: offer "Pay by bank, save $30" as a visible line item on checkout.

## Competitor Benchmarks

- BookRetreats: 14% host commission + 3% payment processing fee on deposits only. Balance collected directly by host (not on platform).
- Retreat Guru: 15% marketplace commission.
- Airbnb (pre-Oct 2025): 3% host + 14-16.5% guest split. (Post-Oct 2025: 15.5% host-only.)
- Tripaneer/BookSurfCamps: commission not publicly disclosed, negotiated per host. Affiliate commissions suggest $10–$1,100 per booking = high ticket = high %.
- SquadTrip: processing fees only (~2.9%), no commission — but no marketplace discovery.

## Principles from Gurley / Sharetribe

- Lower fees = less friction = harder to displace. "High volume + modest rake = sustainable."
- Charge the supply-constrained side less. At launch, supply (hosts) is constrained — so don't burden hosts with both commission AND Stripe fees.
- 10% is Sharetribe's suggested floor for experience marketplaces; 12-15% is the comfortable range.

**Why:** [[stripe-connect-implementation]] (future)
