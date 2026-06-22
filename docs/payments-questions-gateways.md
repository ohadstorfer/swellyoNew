# Israel Payments — Questions for PayPlus & Tranzila

Context: Swellyo Inc (US) runs a surf-trip marketplace (React Native / Expo app). An Israeli entity (Osek/Ltd) would be the merchant, collecting ₪ from Israeli travelers and splitting payouts to trip operators, taking a commission.

> Same list for both PayPlus and Tranzila — compare the answers.
> ⭐ = make-or-break. Lead with these. Don't accept "from 1.5%" — get every fee in writing.

## Eligibility (ask first)
- ⭐ Will you onboard an **Osek Murshe** (not only a Ltd) for your **marketplace / split-payment product**?
- ⭐ Does the marketplace product **split at source** — the operator's share goes straight to the operator's bank, and **only my commission lands in my account** (I never hold the operator's funds)?
- The merchant account is an Israeli entity, but it operates on behalf of a **US company (Swellyo Inc)** under contract — is that a problem?

## Mobile integration (Swellyo is React Native / Expo)
- ⭐ How do we integrate in a **React Native app** — native SDK, **hosted-fields iframe in a WebView**, or hosted payment page? Is there a **test/sandbox** environment?
- Does **Apple Pay / Google Pay** work inside a mobile WebView, or only on web?

## Payment methods
- **Tashlumim (installments)** — supported? Up to how many payments? Who bears the financing cost, and can it be passed to the traveler?
- **Bit** — supported? Transaction limit and fee?

## Fees — itemize ALL of these
- ⭐ Per-transaction **card rate** — **domestic Israeli**, **Amex**, and **foreign/international** cards (separate numbers).
- **Per-transaction fixed fee in agorot.**
- ⭐ **Marketplace / split-payout surcharge** — a % or a flat fee per payout?
- **Bit fee**, **tashlumim financing %**, **chargeback / dispute fee**.
- **Setup fee, monthly fee, monthly minimum, dormancy fee.**
- **Refunds** — is the processing fee returned when I issue a refund?
- Volume tiers / negotiated rate at scale.

## Operations & risk
- What **KYC do operators (payees)** provide — just bank + ID, or business registration too?
- **Payout timing** to operators — and can I **hold funds until the trip date** (escrow)?
- **Chargeback handling**, and any **rolling reserve** (% and duration)?
- ⭐ Does your contract require a **personal guarantee** from me? (I want it on the entity, not me personally.)
- Settlement **currency** + payout to an Israeli bank account.
- **API documentation** quality + webhooks for payment confirmation.

## Contacts
- Tranzila: 073-222-4444 · tranzila.com / tranzila.finance
- PayPlus: payplus.co.il · docs.payplus.co.il
