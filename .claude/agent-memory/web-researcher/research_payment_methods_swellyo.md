---
name: payment-methods-swellyo
description: Local payment rails for Swellyo surf-trip marketplace — ACH, Stripe Link, Tashlumim, Bit, PayBox; US + Israel focus; Delaware-incorporated Stripe Connect merchant of record
metadata:
  type: project
---

## Context
Swellyo is a pre-launch surf-trip marketplace. Delaware corp, Stripe Connect (merchant of record). Travelers from USA + Israel (primary). Trip prices $800–$2,500 USD.

## USA

**ACH Direct Debit via Stripe**
- Fee: 0.8%, capped at $5. Cap kicks in at $625, so any trip $625+ pays exactly $5 (vs $72–$102 on cards at 2.9%). Big deal at $800–$2,500.
- Settlement: Standard T+4 business days. Faster T+2 for eligible accounts (check Stripe dashboard).
- Failure causes: insufficient funds, closed accounts, revoked authorization. Industry return rate ~8–12% for consumer ACH.
- Mitigation: Use Stripe Financial Connections (real-time account verification) to cut returns significantly. Pre-notify customers before debit.
- Verdict: worth offering for US travelers who are willing to wait on confirmation. Not suitable as the only method (failure rate, no instant confirmation). Good as "save $XX by paying via bank transfer" prompt.

**Stripe Link**
- Does NOT reduce fees. Fee is identical: 2.9% + $0.30 standard cards.
- Exception: "Instant Bank Payments" through Link starts at 2.6% + $0.30 (slight discount).
- Value is friction reduction, not cost reduction. Autofills saved card/bank details. Reduces checkout abandonment for returning users.
- Earlier search result claiming "1.5% for saved card via Link" was incorrect — Stripe's own page contradicts this.

**Apple Pay / Google Pay / Cash App Pay**
- Same card rails underneath. Same 2.9% + $0.30. No fee advantage.
- Value: checkout speed (one tap), reduces abandonment on mobile. Worth enabling regardless.

## Israel

**Reality check: Stripe handles Israeli cards fine.** A US Delaware company can accept Israeli Visa/Mastercard through Stripe Connect with no special setup. Stripe charges 2.9% + $0.30 for domestic (US) cards; Israeli cards are international, so add 1.5% cross-border fee = effectively ~4.4% + $0.30.

**Bit (ביט — Bank Hapoalim's mobile payment app)**
- 2M+ users, ~80% P2P market share in Israel.
- Has a merchant API (developer.bitpay.co.il). Currency: ILS only.
- Transaction limit: 5,000 ILS/transaction, 20,000 ILS/month (annual limit removable).
- Integrated by: Tranzila, Hyp, Meshulam — all Israeli PSPs.
- Restriction: These PSPs are for payments in Israel only, ILS only. A US company cannot open a direct account with them without an Israeli business entity or local bank relationship.
- NOT directly available through Stripe Connect. No Stripe integration exists.

**PayBox (Discount Bank P2P app)**
- Niche popularity, primarily P2P, rarely used for e-commerce checkout.
- No meaningful merchant API for international merchants.
- Skip.

**Tashlumim (תשלומים — installment payments)**
- The single most important Israeli payment expectation for big purchases ($500+).
- How it works: Israeli-issued credit card splits a purchase into 3–12 equal, interest-free monthly payments. The merchant receives the full amount immediately (minus fees). The bank/card company handles the installment schedule.
- Key fact: Tashlumim ONLY work with Israeli-issued cards. You cannot use a US card to pay in tashlumim at a foreign merchant. The installment logic lives in the Israeli card network (Isracard/Cal/Max), not the merchant's PSP.
- Stripe does NOT support tashlumim. Stripe has no integration with Israeli card network installment protocols. Israeli travelers paying via Stripe will see a standard one-time charge only.
- To offer tashlumim, you need a local Israeli PSP (Tranzila, Hyp, Meshulam, PayPlus) with a proper Israeli merchant account. These require an Israeli business entity or at minimum a local bank relationship — not straightforward for a Delaware corp.
- Conversion impact: For a $2,000 trip, Israeli consumers are highly conditioned to pay in installments. Anecdotally (no hard data found), lack of tashlumim is a meaningful conversion barrier for high-ticket purchases from Israeli consumers.

**Splitit — the workaround**
- Splitit is an Israeli-founded BNPL company that works WITH the customer's existing credit card. The customer authorizes the full amount; Splitit charges in monthly installments.
- Has Stripe Connect integration (confirmed partnership, used by global merchants).
- Merchant fees: 1.5% + $1.50 per installment (if merchant accepts installment payments), or 2.5% upfront if merchant wants immediate full payout.
- For a $2,000 trip in 6 installments (upfront payout): 2.5% = $50. Compare to Stripe card standard 2.9% + $0.30 = $58.30. Modest saving but also adds installment functionality.
- This is the most viable path to offering "installment-like" payments to Israeli customers without an Israeli entity.
- It is NOT native tashlumim (no Isracard/Cal/Max integration) but achieves the same consumer UX outcome.

**Israeli consumer checkout expectations (2026 data)**
- Cards dominate: 71% of online transactions (Visa 37%, Mastercard 26%, local Isracard 16%).
- E-wallets: 26% (digital wallets growing fast — Bit is P2P, not e-commerce dominant).
- Bank transfer: 1%. Virtually irrelevant for e-commerce.
- Gen Z: 95% prefer credit cards for online purchases specifically.
- Embedded forms preferred over redirect checkout flows (reduces drop-off).
- For high-ticket items ($800+): installment expectation is culturally embedded.

## Summary recommendations

**Launch with:**
- Stripe standard cards + Stripe Checkout (handles Apple Pay / Google Pay automatically).
- ACH Direct Debit via Stripe for US travelers (saves $38–$95 per trip vs cards; offer as "pay by bank and save" option with Financial Connections verification).
- Stripe Link (enable for free — friction reduction, not cost reduction).

**At scale, revisit:**
- Splitit for Israeli travelers who want installments. Stripe Connect integration exists. Needs custom checkout flow integration.
- Israeli PSP (Tranzila/Hyp) for native Bit + Tashlumim — only feasible if Swellyo registers an Israeli entity.

## Sources
- https://docs.stripe.com/payments/ach-direct-debit
- https://stripe.com/payments/link
- https://stripe.com/pricing/local-payment-methods
- https://developer.bitpay.co.il/docs
- https://docs.base44.com/Setting-up-your-app/accepting-payments-israel
- https://www.ppro.com/countries/israel/
- https://www.calcalistech.com/ctechnews/article/bkjsg8ssle
- https://www.retaildive.com/news/splitit-to-integrate-with-stripe-connect/571392/
- https://www.splitit.com/pricing-plans/
- https://www.kosherfrugal.com/2021/10/credit-cards-in-israel-including-what.html
