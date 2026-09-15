---
name: research-wetravel-checkout-refunds
description: WeTravel traveler-side checkout UX (payment plans, autopay, promo codes, multi-currency) and refund/cancellation/dispute mechanics, sourced from help.wetravel.com
metadata:
  type: project
---

Researched 2026-08-25 via help.wetravel.com (www.wetravel.com blocks WebFetch with 403; academy.wetravel.com has no useful checkout detail). Complements [[research_wetravel_pricing]] (margins) and [[research_wetravel_integration]] (partner API).

## Checkout (traveler side)
- At signup, traveler picks ONE of: pay per schedule, pay a partial custom amount (if organizer enabled "Allow partial payment"), or pay in full. Not a multi-plan picker — one schedule per trip, organizer-set (1-24 installments).
- Promo code field is literally labeled "Discount code". Applies to balance-due after deposit; on a plan, reduces installments starting from the LAST one backward. One code per booking, no stacking, entered only at initial checkout.
- Saved payment methods live in traveler Personal Settings > Payment Settings, cards/banks listed separately. A method becomes "default" ONLY if added fresh during checkout or manually set in Payment Settings — picking a saved method at checkout does not change the default.
- Autopay ("auto-billing"): organizer enables via a checkbox on their side; exact traveler-facing opt-in copy/default state is NOT documented anywhere in the help center (checked thoroughly — genuine gap). Auto-billing runs as one global daily batch at 7:10 PM UTC regardless of trip timezone.
- Payment method picker is currency-filtered, not a universal list (ACH=USD only, SEPA/iDEAL=EUR only, BACS=GBP, PAD=CAD, BECS/PayTo=AUD, etc). Apple/Google Pay auto-appear for USD/GBP/EUR/MXN/AUD on supported browsers.
- Multi-currency checkout: traveler can pay in any of 21 currencies regardless of trip's base currency; defaults by geolocation; non-native-currency card payment incurs its own card fee (e.g. 1.5% EUR-card example) before conversion; local rails in that currency can be fee-free.
- BNPL/Affirm: explicitly NOT supported ("We don't support Affirm or other BNPL services at this time") — no carve-outs by country/currency.
- Contribution pages (family/friends funding a traveler's balance): Pro-plan feature, min $5 / max = remaining balance, ONE page per booking (shared across co-participants on same booking), contributor identity hidden from organizer reporting, card statement shows "WT* [Participant First Name] Trip Payment".
- Fees: WeTravel platform fee min $1.50 USD/equivalent per transaction; bank transfers have no card fee; non-native-currency trips add a flat 3.9% card fee. Payment plans themselves carry NO extra fee vs paying in full.

## Refunds / cancellations
- Organizer flow (current, detailed): Trips > Manage Trip > (⋮) > "Cancel or Refund" > three modes: Cancel-and-Refund (with "Keep the difference" vs "Apply difference to remaining balance" sub-choice), Cancel Only, Refund Only (sub-modes: refund-to-original-method-or-external, or "Return Now, Collect Later" which lowers amount-paid without changing total booking price). Refunds are irreversible once processed; failed refunds auto-reverse + email.
- Fee-on-refund pattern is consistent everywhere: WeTravel's own platform fee is ALWAYS reimbursed to the organizer; the underlying rail's processing cost (card fee, or flat 25 EUR/USD wire fee) is NEVER recovered and is absorbed by the organizer. Bank-transfer refunds (ACH/BACS/SEPA) are fully free.
- Refund timing: 5-10 business days typically to hit traveler's statement.
- 180-day bank-transfer refund wall: ACH/BACS/SEPA/PayTo/SPEI/iDEAL/Bancontact/PAD cannot be refunded past 180 days (network rule, not WeTravel policy); PIX/PayNow/BECS cut off at 90 days. Past that, organizer must refund externally and loses the original WeTravel fee + payment fees permanently (not recoverable even externally).
- Traveler has NO self-serve cancel button. Must go to Booking Dashboard > "Contact, Cancellation & Support" > "Message organizer". WeTravel support explicitly refuses to process cancellations on traveler's behalf — 100% delegated to organizer.
- Default cancellation policy if organizer states nothing in trip description: "All payments paid through WeTravel are non-refundable." No evidence of built-in structured tiers (flexible/moderate/strict presets) in the platform itself — it's freeform text the organizer writes into the trip description. CAVEAT: this comes from an older FAQ article (#253925) that reads as less mechanically detailed than the 2025-era cancel/refund guide (#15193199) — flag as possibly stale if precision on policy tiers matters later.
- Disputes/chargebacks: organizer bears full liability by ToS. On dispute, full payment auto-pulled and held by processor, funds provisionally returned to traveler, 60-80 day resolution window. No guarantee of winning — bank/network decides. Evidence packet (cancellation policy text, email threads, supplier comms, proof of refund-recovery attempts) submitted to WeTravel who forwards to the bank.

## Gaps confirmed via direct search (not just "didn't look")
- No documented exact autopay-checkbox copy/default state for travelers.
- No documented itemized fee line-item breakdown at the checkout screen moment (bundled vs itemized "WeTravel Fee" + "Card Fee" — unclear).
- No documented base % card processing rate for native-currency cards (only the $1.50 min fee and the 3.9% non-native-currency surcharge were found).

## Sources
- https://help.wetravel.com/en/articles/15193199-guide-to-canceling-and-refunding-travelers
- https://help.wetravel.com/en/articles/3334609-refunding-bank-transfer-payments-that-are-older-than-180-days
- https://help.wetravel.com/en/articles/1687811-how-does-wetravel-handle-disputes
- https://help.wetravel.com/en/articles/4270355-how-to-offer-payment-collections-from-participants-family-friends
- https://help.wetravel.com/en/articles/11711977-do-you-support-affirm-or-other-buy-now-pay-later-bnpl-options
- http://help.wetravel.com/en/articles/253925-cancellation-refund-policies
- http://help.wetravel.com/en/articles/1270486-payment-plans-how-they-work-setup
- http://help.wetravel.com/en/articles/414967-discount-promo-codes
- http://help.wetravel.com/en/articles/1217697-are-there-fees-for-refunds
- http://help.wetravel.com/en/articles/1674833-what-payment-methods-does-wetravel-accept-for-different-currencies
- http://help.wetravel.com/en/articles/8694062-how-does-multi-currency-checkout-work-on-wetravel
- http://help.wetravel.com/en/collections/176778-faq-joining-a-trip
- http://help.wetravel.com/en/collections/176798-accepting-payments
