---
name: project-wetravel-wallet-fx-payouts
description: WeTravel wallet/convert/supplier-transfer/card/top-up/instant-payout mechanics, fees, and bank partners — researched for the wetravel-mockup spec
metadata:
  type: project
---

Researched 2026-08-25 for the wetravel-mockup spec, comparing routes for an operator paying an overseas supplier (Bali villa scenario). help.wetravel.com is directly fetchable via WebFetch (no Wayback/proxy needed — 403s reported for www.wetravel.com and product.wetravel.com did not apply to the help subdomain).

**Why this matters:** the mockup is modeling WeTravel's money-movement UX, so exact fees/timing/eligibility gates are load-bearing for the scenario copy, not just flavor text.

## Wallet / Convert
- 21 currencies convertible: USD, EUR, GBP, CAD, AUD, ZAR, SEK, NOK, DKK, CHF, HKD, PLN, NZD, MXN, AED, CZK, HUF, JPY, SGD, TRY, BRL. No conversion fee. Daily cap 300k USD equivalent. Seconds to process. Min conversion ~20 units major currencies (40 ILS, 200 ZAR, 400 THB, 2000 JPY/HUF). Source: https://help.wetravel.com/en/articles/9039078-convert-currencies-within-wetravel
- Multi-currency checkout: if a trip is priced in USD but customer pays EUR, WeTravel auto-converts EUR→USD at checkout and deposits USD; installment payments convert at that day's rate. Source: https://help.wetravel.com/en/articles/8694062-how-does-multi-currency-checkout-work-on-wetravel

## Supplier Transfer (route a in the Bali scenario)
- Free, seconds, but **both accounts must be verified/KYC'd on WeTravel** — this is the real-world blocker for a small overseas villa that isn't already a WeTravel user.
- Supplier receives in the SAME currency sent (no forced conversion). Optional invoice upload (PDF/JPG/PNG/GIF/Word/Excel, 5MB).
- Sources: https://help.wetravel.com/en/articles/3392470-what-are-supplier-transfers , https://help.wetravel.com/en/articles/3456081-how-to-transfer-money-to-a-supplier

## Wire transfer (route b) — KEY GOTCHA
- **WeTravel wire transfers only go to a bank account in your OWN business name** — verbatim: "You can only add a bank account that is in your own (business) name." Direct wire-out to a third-party supplier is explicitly NOT supported: "To pay suppliers or partners, please use our Supplier Transfer feature." Source: https://help.wetravel.com/en/articles/419852-how-do-i-add-a-bank-account-to-make-wire-transfers
- So "wire to pay a supplier" is not a native WeTravel feature — the real route is payout-to-self ($15 flat fee, 3-5 business days per https://help.wetravel.com/en/articles/434422-pricing) then the operator wires the villa manually outside WeTravel, eating their own bank's fees/spread.
- Daily wire limit $500k USD, beneficiary sees "Wetravel Inc. or Cambridge Mercantile Corp." as sender. Long unsupported-currency and unsupported-country lists exist (includes many exotic currencies; sanctioned/high-risk countries excluded). Source: https://help.wetravel.com/en/articles/6926526-how-do-i-initiate-a-wire-transfer

## WeTravel Card / Supplier Card (route c)
- TWO separate card products with separate FAQs: **US Card** (companies incorporated in US w/ US bank account) vs **International Card**, issued via **Airwallex** as the card-issuing partner, Visa network, virtual only (physical "coming soon"/waitlist).
- International Card eligible countries do NOT include Indonesia — list is Americas (Canada, Brazil, Mexico, Argentina, Colombia), Europe/UK (long EU+UK+EEA list), Asia (Singapore, Thailand, Philippines, Hong Kong, Israel), Oceania (Australia, NZ). A Bali-incorporated operator would likely be ineligible for a card themselves. Source: https://help.wetravel.com/en/articles/3347411-wetravel-card-faq
- No annual/creation/membership/**cross-border fees** on the card. Foreign-currency spend "auto-converts from your main balance at our issuing partner's [Airwallex] rate — with no separate conversion fee" (no separate WeTravel markup disclosed beyond Airwallex's rate). Source: https://help.wetravel.com/en/articles/16032403-how-to-create-your-virtual-wetravel-card-international
- **Supplier Card is the actual answer for a non-onboardable overseas supplier (e.g., a Bali villa)**: single-use virtual card for the exact amount owed; supplier gets a secure link/charges it on their own POS. No annual/creation/membership/cross-border fee from WeTravel; if the supplier processes in a different currency than the card's issued currency, THEY may incur their own merchant-side fees (outside WeTravel's visibility/control). Requires the operator to already be Level 2 (Trusted Partner)/Level 3 (Trip Organizer) verified and have sufficient balance in the selected currency. Source: https://help.wetravel.com/en/articles/16032756-how-to-create-and-manage-supplier-cards-international

## Instant Payout
- USD only. 1.5% fee/transaction. Min $0.50, max $3,000/day. Arrives within ~30 min, any day/time incl weekends. Requires a US-issued, non-prepaid debit card linked to an active local bank account; not available on new payout accounts. Source: https://help.wetravel.com/en/articles/6049882-how-to-payout-usd-funds-instantly

## Top-up
- Purpose: ONLY for issuing refunds after funds already paid out — verbatim "Top-ups can be used for refund purposes only." 17 currencies. Credit card = instant (1.5-3.4% fee depending on currency, +0.5% AMEX-ish premium); US checking = free, 5 business days; wire = free from WeTravel (bank/intermediary fees may apply), up to 5 business days, requires emailing info@wetravel.com for setup/approval. Sources: https://help.wetravel.com/en/articles/798783-how-to-top-up-your-account , https://help.wetravel.com/en/articles/3845787-how-to-top-up-with-wire-transfer

## Business Payment Request (B2B invoice flow)
- Payer does NOT need a WeTravel account — gets a direct payment link by email. Payment methods: local bank debit (ACH/SEPA/BACS/BECS/PAD), instant bank transfer (iDEAL/Bancontact/SPEI/PayTo), cards (Visa/Mastercard), or wire (USD/EUR only, for larger amounts). Payer picks who covers fees. Requests ≥$5,000 USD equivalent require a supporting invoice document upfront. Source: https://help.wetravel.com/en/articles/14594381-business-payment-request

## Fund custody / segregation
- "WeTravel securely separates client funds across multiple holding accounts. This includes FDIC-insured financial institutions such as Wells Fargo or JPMorgan Chase." Payment PROCESSING (not custody) goes through Stripe and Airwallex as regulated third-party processors — GBP/BACS statements can show "Airwallex." Source: https://help.wetravel.com/en/articles/415019-what-happens-to-the-money-from-my-participants-after-they-book
- This reads as segregated-by-design language (marketing/trust copy) rather than a technical account-level segregation disclosure — treat as WeTravel's claim, not an audited fact.

## Bali-villa scenario verdict (for spec writing)
1. **Supplier Transfer** — free/instant/no FX spread, but ONLY works if the villa is a verified WeTravel user. Realistically the hardest to satisfy for a small overseas supplier.
2. **Wire "out"** — does not exist as a direct third-party payment feature; it's a payout-to-self ($15, 3-5 days) plus the operator's own bank wiring the villa separately (fees/spread outside WeTravel entirely).
3. **Supplier Card (International)** — the actual designed-for-this-scenario feature: single-use virtual card, no WeTravel cross-border fee, but requires operator to hold Level 2/3 verification and the villa to accept a card/POS charge (many villas won't take Visa without a surcharge) — and the operator's own business must be in an Airwallex-eligible country, which Indonesia is not.

All content above is READ from the pages (WebFetch model summaries against live help.wetravel.com pages), not inferred, except the "Bali-villa scenario verdict" section which is this agent's synthesis/inference layered on the read facts.
