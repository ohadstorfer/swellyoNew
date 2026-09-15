---
name: research-stripe-instant-bank-payments
description: Stripe Instant Bank Payments (US, via Link) — Connect/on_behalf_of support, enablement, pricing, guarantee, settlement, eligibility (verified Aug 2026)
metadata:
  type: reference
---

Researched 2026-08-27. All claims sourced from docs.stripe.com / stripe.com (official). Gaps flagged explicitly.

## 1. Connect + destination charges with on_behalf_of

- The Instant Bank Payments (IBP) doc page has a property table with **"Connect support: Yes"**.
  Source: https://docs.stripe.com/payments/link/instant-bank-payments
- The Bank Debits product-support matrix lists **"Instant Bank Payments or ACH Direct Debit"** as one combined row → Connect: ✓ Supported (also Checkout, Payment Links, Payment Element, Subscriptions, Invoicing, Customer Portal ✓; Express Checkout Element and Mobile Payment Element ✗).
  Source: https://docs.stripe.com/payments/payment-methods/payment-method-support (Bank debits product support table)
- **No page names "Instant Bank Payments" explicitly in a charge-type-by-charge-type (Direct / Destination / Destination+on_behalf_of) breakdown.** That granular breakdown exists only for **ACH Direct Debit**, on https://docs.stripe.com/payments/ach-direct-debit — under "Connect and settlement" and the statement-descriptor table it explicitly includes **"Destination (with `on_behalf_of`)"** as a supported combination (descriptor sourced from the connected account in that case). It also says: "Set the `us_bank_account_ach_payments` capability to `active` on your platform account, and for any connected accounts you want to enable for ACH debits" and "Stripe automatically refunds the application fee to your platform account when the destination charge for an ACH debit fails."
- **Inference, not a direct quote:** Instant Bank Payments uses the same underlying PaymentMethod type (`us_bank_account`) and the same capability (`us_bank_account_ach_payments`) as ACH Direct Debit — it's a UX/confirmation-speed variant delivered via Link on top of the same rails, not a separate PaymentMethod type. Because of that, it is reasonable to expect it inherits the same Connect charge-type support (destination charges + on_behalf_of works, same as ACH). **This is not explicitly confirmed by an official page naming IBP by name in that context — flag as unverified-by-name and confirm with Stripe support or a sandbox test before relying on it for the marketplace fee model.**
- General on_behalf_of caveats table (https://docs.stripe.com/payments/payment-methods/payment-method-support, "Additional API support" section): explicitly calls out that `customer_balance` (bank transfers) has limited on_behalf_of support and PayPal doesn't support on_behalf_of at all — **`us_bank_account` / Link is not listed as restricted**, which is indirect confirmation it's NOT in the excluded list.
- SEPA Direct Debit's Connect page (different payment method, same doc index) explicitly requires a **fresh mandate per connected account** when using on_behalf_of ("You can't clone SEPA direct debit payment methods and their mandates to connected accounts for use with destination charges"). ACH Direct Debit's own Connect section has the equivalent rule: **"If a mandate is authorized for a PaymentIntent or SetupIntent on_behalf_of a connected account, you can't use that mandate with a different connected account."** This applies to IBP too since it's the same mandate/PaymentMethod mechanism.

## 2. How it's enabled in Checkout

- **Automatic, not a separate PaymentMethod type or dashboard toggle.** Quote: "Instant Bank Payments are automatically enabled when you turn on Link, subject to eligibility requirements. Go to your payment method settings to manage Link in your payment integrations." (https://docs.stripe.com/payments/link/instant-bank-payments)
- **Critical interaction rule — ACH Direct Debit takes precedence over IBP for the same transaction, and you can't offer both simultaneously:**
  - If you explicitly include `us_bank_account` in `payment_method_types` on a Checkout Session / PaymentIntent / SetupIntent, **Link never presents Instant Bank Payments** for that transaction.
  - If you use dynamic payment methods, for any transaction eligible for ACH Direct Debit, Link doesn't present IBP — **unless** you restrict ACH eligibility via a [payment method rule](https://docs.stripe.com/payments/payment-method-rules). Transactions that fail the ACH rule but pass IBP risk checks will see IBP instead.
  - Practical implication for a new integration: don't explicitly list `us_bank_account`; use dynamic payment methods with Link on, and if you want to steer eligible transactions toward IBP over ACH, add a payment method rule limiting ACH.
- Supported integrations: Checkout, Payment Links, Hosted Invoice Page, Payment Element, Mobile Payment Element.

## 3. Pricing

- **Instant Bank Payments: 2.6% + $0.30 per successful charge.** Confirmed on both stripe.com/pricing and stripe.com/payments/us-bank-debits (marketing pages, official).
- **ACH Direct Debit: 0.8%, capped at $5.00 per transaction.**
- IBP is ~3x more expensive than ACH for typical transaction sizes but confirms/settles instantly instead of up to 4 business days.
- Sources: https://stripe.com/pricing, https://stripe.com/payments/us-bank-debits

## 4. The "guarantee" — exact scope

Quote (https://docs.stripe.com/payments/link/instant-bank-payments, "Timing and guaranteed settlement"):
> "Confirmation of Instant Bank Payments is immediate, and authorized payments settle to your Stripe balance on the same timeline as card payments. Stripe guarantees that authorized payments settle to your account unless the customer initiates a dispute with their bank."

Two distinct return paths:
- **Bank-initiated ACH returns** (e.g., insufficient funds, closed account, invalid account — the returns ACH Direct Debit is vulnerable to): "Stripe still guarantees settlement and doesn't debit any funds from your balance." This is the actual guarantee — it protects against the failure modes that plague plain ACH.
- **Customer-initiated disputes** (customer disputes with their bank, i.e., a chargeback-like claim): **NOT covered.** "When your customer initiates a dispute with their bank, Stripe debits your balance for the payment amount and dispute fee." You respond via the same guided Dashboard flow as card disputes; evidence-by-return-code is documented separately at https://docs.stripe.com/payments/link/instant-bank-payments/disputed-payments.

So: the guarantee is specifically about the operational/bank-return risk ACH normally carries (why IBP markets "protection from common ACH failures"), not about fraud/customer disputes — that risk still sits with the merchant, same as cards.

## 5. Settlement/availability timing

- Confirmation: instant (at checkout).
- Settlement to Stripe balance: **2 business days — "same timeline as card payments."**
- Compare: ACH Direct Debit is T+4 standard, or T+2 for an extra fee if eligible.
- Connect: settlement speed is controlled at the platform level per the ACH Direct Debit Connect table (Standard-with-platform-control / Standard-without / Express / Custom); Express connected accounts → **platform controls settlement speed** for all charge types (direct, destination, separate charges/transfers). No IBP-specific settlement-timing override was found; the general "2-day, card-like" timing on the IBP page is described as fixed, not configurable like ACH's T+2 option.
- Off-session/recurring: supported — after first authenticated transaction via Link, subsequent charges to the saved bank account don't require re-authentication.

## 6. Geographic / account eligibility limits

- **US only** on both sides: "Available in: US." Customer locations: United States. Presentment currency: USD only.
- Business/onboarding eligibility (not automatic for every account): "You must satisfy certain onboarding criteria, including, but not limited to, being a US business and having a history of Stripe usage." Not all businesses/transactions qualify — Stripe's risk system decides per-session.
- **Transaction cap:** "By default, Instant Bank Payments are presented only for transactions under 7500 USD" (dynamically adjustable by Stripe's risk systems).
- Cannot coexist with ACH Direct Debit on the same transaction (see section 2).
- **Sandbox/testing: yes, fully supported.** Stripe provides simulated institutions/flows: Success, Disputed (generates a customer-initiated dispute you can view in Dashboard), Blocked (risk decline), Bank Non-OAuth and OAuth test flows, and failure simulations (Down scheduled/unscheduled/error). Source: https://docs.stripe.com/payments/link/instant-bank-payments#testing
- Promotions: Stripe may fund cash-back/promotional incentives to drive IBP adoption (US only), fully Stripe-funded, doesn't cost the platform anything; configurable in Link settings.

## Sources
- https://docs.stripe.com/payments/link/instant-bank-payments (primary IBP doc — properties, timing/guarantee, eligibility, testing)
- https://docs.stripe.com/payments/ach-direct-debit (Connect charge-type breakdown, mandate/on_behalf_of rules, comparison table)
- https://docs.stripe.com/payments/payment-methods/payment-method-support (Bank debits Connect/product support matrix)
- https://docs.stripe.com/payments/payment-methods/payment-method-connect-support (per-payment-method Connect guide — no dedicated IBP entry, only ACH Direct Debit)
- https://docs.stripe.com/connect/charges (general charge-type/on_behalf_of mechanics)
- https://stripe.com/pricing and https://stripe.com/payments/us-bank-debits (pricing: 2.6% + 30c vs 0.8% capped $5)

## Open question to verify before relying on it in prod
Whether Instant Bank Payments specifically (by name, not just its shared `us_bank_account` plumbing) is supported with **destination charges + on_behalf_of** for Express connected accounts has no single official page stating it explicitly by name — only strongly implied by shared PaymentMethod type/capability with ACH Direct Debit, which IS explicitly documented as on_behalf_of-compatible. Recommend: test end-to-end in Stripe test mode with a real Express connected account (`on_behalf_of` set, destination charge) using the IBP test bank flows before shipping, or ask Stripe support to confirm in writing.
