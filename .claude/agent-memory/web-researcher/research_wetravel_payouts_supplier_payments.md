---
name: research-wetravel-payouts-supplier-payments
description: How WeTravel's Payments > Payout Accounts actually works — the wallet model, paying yourself out, and paying suppliers/vendors (WeTravel Transfer, wire, virtual card, Business Payment Request)
metadata:
  type: project
---

Researched 2026-08-25 from help.wetravel.com + academy.wetravel.com. Complements
[[research_wetravel_pricing]], [[research_wetravel_checkout_refunds]], [[research_wetravel_integration]].

## The core model: WeTravel is the wallet, not a passthrough
Traveler money does NOT land in the operator's bank. It lands in a **WeTravel balance**
("wallet") the operator holds inside WeTravel, per currency — up to 6 wallets you can
transfer from, 20 currencies you can convert between (USD, EUR, GBP, CAD, AUD, ZAR, SEK,
NOK, DKK, CHF, HKD, PLN, NZD, MXN, AED, CZK, HUF, JPY, SGD, TRY, BRL).
From that balance the operator does two different things:
  1. **Payout** — move money out to their own bank / debit card.
  2. **Transfer** — pay a supplier/vendor, either inside WeTravel or by wire.
"Payout Accounts" is the settings page that stores the destinations for both.

## Where it lives
Name (top right) > **Payments** > left rail > **Payout Accounts**.
The page holds separate sections:
- local bank account (only ONE local USD account allowed per org; same idea for EUR/CAD)
- linked US debit card (for instant payouts)
- **Wire Transfer Accounts** — up to 10 beneficiaries, each with a green "Transfer" button
- Recipients / suppliers list (also reachable via Payments > Recipients)

## Paying yourself out
| method | speed | fee |
|---|---|---|
| standard payout to local bank (USD) | 1 business day | free |
| standard payout EUR/CAD | 2-3 business days | free |
| instant payout to linked US debit card | seconds-30 min | **1.5%**, min $0.50, max **$3,000/day**, not available on a first-time payout account, no prepaid cards |
| international wire | 3-5 business days | **$15 (or equiv) per transfer** + beneficiary/intermediary bank fees; daily cap $500k |

Local bank payout needs SSN (personal) or EIN (business) — Stripe is the processor and
legally identity-checks once cumulative payouts hit a few thousand dollars. No SSN/EIN =
wire only.

## Paying suppliers/providers — FOUR distinct mechanisms
1. **WeTravel Transfer (the "vendor transfer network")** — the marketed one.
   Payments > Recipients > Transfer Money, or Balance > Transfer > "Transfer to Supplier".
   Flow: amount + which currency wallet + pick/add recipient + payment purpose + reference
   + optional invoice upload (PDF/JPG/PNG/GIF/Word/Excel, ≤5MB) > Confirm.
   **Arrives in seconds. Free.** Both sides must have a WeTravel account and BOTH must be
   verified. Supplier receives in the SENDER's currency — no FX on the transfer itself; the
   supplier converts later (free inter-wallet convert) or on withdrawal to their bank.
   This is the whole pitch: it never leaves the platform, so it skips bank rails, 4-8% FX
   spreads and 1-5 day settlement.
2. **Wire transfer to any bank** — for suppliers not on WeTravel. Payout Accounts > Wire
   Transfer Accounts. $15/transfer, 3-5 days, locked FX rate shown before confirm,
   **irreversible once submitted**. Account must be in your own business name and the
   transfer must be business/trip related. Long unsupported-currency list (ARS, BRL, COP,
   UAH, VEF, ~45 more) and unsupported countries (Russia, Iran, Cuba, Venezuela, etc).
   Statement descriptor: "Wetravel Inc." or "Cambridge Mercantile Corp."
3. **WeTravel Card** — free virtual Visa, up to 50 cards per org, drawn on the balance.
   Level 2/3 verified only. For suppliers that only take a card. Apple/Google Pay.
   Funds usable immediately for card payments; 5-7 business days for the bank-transfer path.
   No annual/creation/membership fee. Physical cards "coming soon".
4. **Business Payment Request** — the reverse direction: you invoice another business
   (co-organizer, agency, corporate client, supplier) with a due date + currency, they get
   a checkout link, installments supported, auto-reminders at -7d/-3d/due/+2d. Explicitly
   NOT for travelers. Requests over $5,000 USD require an attached invoice. You choose who
   eats the fees.

## Verification gates everything (3 levels)
- **L1 Supplier** — gov ID + selfie. Can RECEIVE transfers. Limited Partner Hub visibility.
- **L2 Trusted Partner** — + proof of address, business registration, website/social.
  Receives transfers, listed in the WeTravel Partner Hub, eligible for the Card.
- **L3 Trip Organizer** — + travel registration details. Can COLLECT from travelers.
Submit 5-15 min, review up to 3 business days. Most start at "partial approval", full after
30 days. Each level is a separate process.

## Currency conversion between your own wallets
Payments tab > **Convert**. No fee ("Fee" field literally logs 0) — the margin is in the
rate, which WeTravel does not publish. Minimums ~20 units for majors (40 ILS, 200 ZAR,
400 THB, 2000 JPY/HUF). Daily cap 300k USD equivalent.

## Holds — the money is not unconditionally yours
Risk-based holds: funds stay in the balance, unavailable for payout but STILL available for
refunds, typically up to 30 days from receipt, longer if fraud/chargeback. On a dispute the
full trip amount is pulled and held by the processor for 60-80 days.

## The traveler-facing "Service Fee" — solved 25 Aug
Live checkout `wetravel.com/checkout_embed?uuid=5025737802` (Kale Brock, Jul 2027):
trip total $4,900, deposit $1,000, **Service Fee $20.30**, Due at Booking $1,020.30.
$20.30/$1000 = 2.03% = **2% + $0.30**. Re-checking the two older demo-account
screenshots against that shape: $1.80 on $150 = 1% + $0.30 exactly; $1.50 on $100 =
the $1.50 floor (1% + $0.30 would be $1.30). Three for three.
**Fee = `max(1.50, rate*amount + 0.30)` PER TRANSACTION**, rate account-dependent
(1% and 2% both seen; public copy says "as low as 1% + $0.30" => 1%=Pro, 2%=Basic,
inferred). Per transaction means a payment plan splits the fee, never avoids it:
$1,000 + $3,900 => $20.30 + $78.30 = $98.60 on a $4,900 trip.
**The Service Fee line is the WeTravel booking fee ONLY — not the card fee.**
US Visa/MC is 2.9% ($29 here), and the line renders before any payment method is
chosen. Card/wire fees only appear after the traveler picks card or wire; local
bank rails add nothing. Full writeup: `docs/specs/wetravel-mockup/RESEARCH-money.md`.

## Why this matters for Swellyo
Swellyo's model is Stripe Connect with per-trip payouts to the operator. WeTravel's model is
a **stored-value wallet the operator runs their whole supply chain from** — the operator
never needs a bank round-trip to pay the surf camp, the driver, or the guide. That closed
loop (free instant intra-platform transfers) is the moat, not the checkout. See
[[project_swellyo_is_merchant_of_record]] and
[[project_operator_becomes_merchant_of_record]] — WeTravel holds the float, which is
exactly what funds the free transfers.
CORRECTION vs an earlier draft of this note: WeTravel is **not** Stripe-only, and MoR
is **inferred, not stated**. Their own help articles name **Stripe AND Airwallex**;
Corpay/Cambridge Mercantile does cross-border payout FX; Celtic Bank issues the card.
The repo doc set has this properly sourced — see
`docs/specs/wetravel-mockup/RESEARCH-processors.md` and `RESEARCH-methods.md`, which
supersede this note wherever they disagree. Money-out detail:
`docs/specs/wetravel-mockup/RESEARCH-payouts.md`.

## Sources
- https://help.wetravel.com/en/articles/3456081-how-to-transfer-money-to-a-supplier
- https://help.wetravel.com/en/articles/773162-how-to-add-your-account-to-make-usd-payouts-and-transfer-funds
- https://help.wetravel.com/en/articles/419852-how-do-i-add-a-bank-account-to-make-wire-transfers
- https://help.wetravel.com/en/articles/6926526-how-do-i-initiate-a-wire-transfer
- https://help.wetravel.com/en/articles/6049882-how-to-payout-usd-funds-instantly
- https://help.wetravel.com/en/articles/14594381-business-payment-request
- https://help.wetravel.com/en/articles/3347411-wetravel-card-faq
- https://help.wetravel.com/en/articles/9039078-convert-currencies-within-wetravel
- http://help.wetravel.com/en/articles/1619345-guide-to-getting-verified-on-wetravel
- https://help.wetravel.com/en/articles/434422-pricing
- https://academy.wetravel.com/wetravel-vendor-transfers
