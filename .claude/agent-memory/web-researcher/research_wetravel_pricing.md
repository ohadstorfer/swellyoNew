---
name: wetravel-pricing
description: WeTravel revenue model deep dive — published fees, hidden margins (float/FX/spread), PayFac economics, and what Swellyo can copy on Stripe Connect
metadata:
  type: project
---

WeTravel is NOT a direct marketplace competitor. They are a B2B payments platform for tour operators. But their fintech revenue mechanics are instructive. Researched May 2026.

## WeTravel Business Scale (Sep 2025)
- Series C: $92M raised (Sep 2025, Sapphire Ventures). Total funding: $127M. Valuation: $450M.
- Revenue: $44M ARR. 297 employees.
- GMV: implied ~$4-5B/year (at 1% take rate to reach $44M — or a mix with subscriptions)
- 5,000+ travel businesses, 500,000+ travelers

## Published Fee Structure
- Free plan: 1% WeTravel fee + 2.9% card processing (3.9% AMEX). Both passable to traveler.
- Pro plan: $79/month per org — white-label, AI tools, API access, advanced reporting. Processing fees IDENTICAL to free — Pro is pure feature upsell.
- ACH / US bank transfer: 0% card fee for traveler. WeTravel still earns the 1% base fee.
- Non-USD currencies: 3.9% card fee + WeTravel fee + FX conversion at undisclosed rate.
- No setup, refund, cancellation, or payout fees (published). Local payout: free 1-3 days. Instant payout: 1.5% fee.

## Hidden Revenue Streams (Confirmed or Strongly Inferred)

### 1. Card Processing Spread — BIG LINE
- WeTravel uses Stripe + Airwallex as actual processors. Stripe/Airwallex wholesale rate ~1.5-2.2%.
- WeTravel charges operators 2.9%. Gap = ~0.7-1.4% per card transaction.
- At $2B card GMV estimate = ~$14-28M/year pure spread revenue. This is likely the #1 revenue line.

### 2. Float Interest — BIG LINE
- WeTravel is a PayFac: funds flow into WeTravel's master account first, then disbursed to operators.
- Multi-day travel deposits paid 60-180 days before trip departure. WeTravel holds all of it.
- Conservative estimate: $500M average float at 4.5% APY = ~$22M/year.
- WeTravel controls the hold period — the longer they hold, the more they earn. This is the core PayFac advantage.

### 3. FX Markup — MEDIUM LINE
- Airwallex charges its own FX markup on conversions. WeTravel layers additional spread.
- Non-USD trip pricing triggers 3.9% card fee which contains FX margin.
- Users explicitly complain about "hidden FX costs" and "hundreds lost vs bank rate."
- Industry typical: 1-2% spread on every currency conversion. At $500M international volume = $5-10M/year.

### 4. Pro Subscription — SMALL BUT PURE MARGIN
- $79/month. Estimate ~1,500-2,000 Pro orgs = $1.4-1.9M/year. High margin, no variable cost.

### 5. Growth Capital Lending — DISCLOSED BUT OPAQUE
- Launched Nov 2022. Operators apply for business loans (min $10k/month revenue, 550 credit score).
- WeTravel is a referral/originator for 3rd-party lenders, NOT direct lender. Revenue = referral fees.
- Exact terms undisclosed. Standard embedded lending referral = 1-3% of loan principal.

### 6. WeTravel Expense Card — GROWING LINE
- Corporate expense card for operators. "International transaction fees and FX markups apply."
- Revenue = interchange on card spend (1-1.5%) + FX spread on international purchases.
- No annual fee, so pure transaction economics.

### 7. Insurance Commission — CONFIRMED PARTNERSHIP
- Trawick International + Pattern Insurance embedded at checkout. Travelers see insurance option during booking.
- Trawick affiliate program "pays top dollar per new client." Standard embedded insurance referral = 15-30% of premium.
- Travel insurance premiums typically 4-8% of trip price. Swellyo math: 20% commission on 6% premium on $2,000 trip = ~$24/booking. Meaningful at scale.

### 8. Tips/Gratuity — NOT CONFIRMED
- No evidence of a tip add-on product at WeTravel checkout.

## PayFac Structure
- WeTravel IS a payment facilitator. They have a direct acquiring relationship (Visa/MC registered).
- All traveler funds flow into WeTravel's master merchant account first — this is the source of float.
- Operators are sub-merchants. This is NOT how Stripe Connect works.
- Payment partners: Stripe (US) + Airwallex (international/multi-currency). They use these as processors, not as the marketplace layer.

## What Swellyo CAN Copy on Stripe Connect Express
| Tactic | Feasibility | Notes |
|--------|-------------|-------|
| "0% bank transfer" pitch | Easy | ACH = 0.8% capped $5. Market as "almost free." |
| Deposit + balance payment plan | Easy | Two PaymentIntents; store card via SetupIntent for second charge |
| Hold funds until trip date | Easy | Stripe manual payout schedule (interval=manual, release day-of-trip) |
| Free plan + transaction fee | Pure pricing decision | No infra needed |
| Pro subscription ($79/mo analogue) | Pure billing decision | Stripe Billing, easy |
| Installment payment auto-reminders | Product feature | Scheduled charge + push notification |
| Group booking flow | Product feature | No payments complexity |
| Operator financial dashboard | Product feature | Stripe Express built-in |
| Insurance embed at checkout | Moderate | Need partner API (Battleface, Generali, Faye, etc.) |
| Operator expense card | Advanced | Stripe Issuing, ~$0.10/card/month + interchange rev share |
| Lending/cash advance | Advanced | Stripe Capital has a partner referral program |

## What Swellyo CANNOT Copy Without Becoming PayFac

### 1. Float Interest (~$22M/year for WeTravel)
- Stripe Connect = funds go directly to connected account balance. Swellyo NEVER holds the float.
- The float lives in the operator's Stripe balance, not Swellyo's.
- This is the single biggest structural revenue gap. No workaround.

### 2. Processing Spread (~$14-28M/year for WeTravel)
- Stripe charges Swellyo the full 2.9%+$0.30. Swellyo has no spread to capture.
- Swellyo can only add its own fee ON TOP of Stripe's fee, making total cost higher — not competitive.
- WeTravel's "1%" is actually 1% platform fee + 0.7-1.4% processing margin. True cost to WeTravel is much lower.

## Where Stripe Connect BEATS PayFac for Swellyo Right Now
- No PayFac registration: Visa/MC registration = $5k-$50k + compliance team + card brand audits
- No fraud liability: Stripe absorbs chargeback/fraud risk on connected accounts
- Speed to market: Express onboards operators in 10 minutes vs weeks of underwriting
- No reserve requirements: PayFacs hold 5-10% reserves against chargebacks
- No compliance overhead: WeTravel has had major account freeze incidents (€50k frozen, no support, FTC complaints). Stripe handles all of this.
- Fixed PayFac infrastructure: $200k-$500k/year minimum to maintain. Stripe Connect = variable cost.

## WeTravel Marketing Language Worth Stealing
- "No setup fees, no monthly fees, no refund fees, no payout fees" — emphasize absence of hidden fees
- "Fee-free bank transfer" — ACH/SEPA framed as the smart choice vs. card
- "Pass fees to participants or absorb them yourself" — operator empowerment framing
- "Collect deposits and installments automatically" — stress automation + cash flow predictability
- "Funds held securely until you're ready to pay suppliers" — frame the hold as a safety feature for operators
- WeTravel does NOT say "0% booking fee" — they say "1% flat, everything else free." More credible.
- Competitor framing: "Save up to X% vs. traditional payment processors" type claims appear in adjacent competitors (YouLi, Easol) but NOT WeTravel itself

## Key User Complaints (Trustpilot / Capterra 2024-2025) — Swellyo Differentiators
- Account freezes with funds held (€50k frozen, no support for months)
- Funds held during compliance review while trips were running — hotels, guides couldn't be paid
- FX spread described as "hidden cost" — hundreds of dollars lost vs bank rate
- No phone/live chat support — email only = critical risk when funds are frozen
- Chargeback handling: WeTravel "threatened legal action immediately"
- Israeli hosts: ILS not supported, international wire payout = $15-30 per transfer + FX loss

**Why:** Researched to understand WeTravel's actual unit economics vs. published pricing, and to identify which monetization levers are available on Stripe Connect.
**How to apply:** Swellyo's revenue must come from commission margin (12%) + eventual Pro subscriptions + possible insurance referral fees. Float and processing spread are not available on Stripe Connect. Do not model WeTravel's $44M ARR against Swellyo's unit economics — WeTravel's #1 and #2 revenue lines are structurally locked behind PayFac status.
