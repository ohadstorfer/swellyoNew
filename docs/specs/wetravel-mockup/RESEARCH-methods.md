# Payment methods, and which processor is behind each

## The processor question, settled

WeTravel states it plainly in two help articles:
> "We partner with multiple globally recognized payment processors, including
> **Stripe** and **Airwallex**." (article 414993)
> "payments are securely processed by our trusted payment partners, **Stripe**
> and **Airwallex**." (article 434422)

And it can be proved from the method list alone, in both directions:
- **MB WAY** (Portugal, EUR) — Stripe supports it; Airwallex does not. → Stripe is live.
- **FPS** (Hong Kong, HKD) — Airwallex supports it; **Stripe has no FPS at all**
  (Stripe's FPX is Malaysia/MYR, a different scheme). → Airwallex is live.

**The seam is visible on the traveller's bank statement** (article 419857):
- USD, EUR, GBP → prefixed `WT*`; "EUR SEPA transactions can appear as
  **WeTravel BV** and USD ACH transactions as **WeTravel Inc.**" → Stripe book.
- AUD, CAD, NZD, DKK, NOK, SEK, CHF, PLN, MXN, HKD, SGD, HUF, JPY, CZK, AED,
  TRY and GBP BACS → no prefix; "GBP and BACS transactions may appear as
  **'Airwallex'** on clients' bank statements." → Airwallex book.

Wire is independently confirmed as Stripe (article 12691807). Outbound
international wires show as **Cambridge Mercantile Corp.** — Corpay's FX entity.

**Four money paths in total:** Stripe (acquiring + wires + US card issuing via
Celtic Bank) · Airwallex (acquiring + international card issuing) · Corpay /
Cambridge Mercantile (cross-border payout + FX) · and a fourth that bypasses
WeTravel entirely — connect your own Stripe Standard account, in which case
"payments will go directly to your Stripe account; WeTravel will not have access
to payment data" and multi-currency checkout is switched off.

## Method × currency, with fees

| Currency | Bank / local methods (fee) | Cards | Wallets | Wire |
|---|---|---|---|---|
| **USD** | ACH **0%** | V/MC **2.9%**, AMEX 3.9% | 3.3% | $25 |
| **EUR** | SEPA DD **0%**, iDEAL **0%**, Bancontact **0%**, Bizum 1%, EPS 1%, MB WAY 1%, P24 2% | V/MC **1.5%**, AMEX 2.9%, UK-issued 2.5% | 2% | €25 |
| **GBP** | BACS **0%** | V/MC **1.5%**, AMEX 2.9%, EU-issued 2.5% | 2% | — |
| **CAD** | PAD **0%** | V/MC 2.7%, AMEX 2.9% | — | — |
| **AUD** | BECS **0%**, PayTo **0%** | V/MC 1.7%, AMEX 2.9% | 1.7% | — |
| **MXN** | SPEI **0%** | V/MC 2.9%, AMEX 3.4% | 2.9% | — |
| **HKD** | FPS 1% | V/MC 3.4%, AMEX 3.9% | — | — |
| **PLN** | BLIK 1%, P24 2% | V/MC 1.5%, AMEX 2.9% | — | — |
| **SGD** | PayNow 1% | V/MC 3.3%, AMEX 3.8% | — | — |
| **SEK** | Swish 0.7% | V/MC 1.5%, AMEX 2.9% | — | — |
| **CHF** | TWINT 2.2% | V/MC 2.9%, AMEX 2.9% | — | — |
| CZK/DKK/HUF | *coming soon* | V/MC 1.5%, AMEX 2.9% | — | — |
| JPY / TRY | *coming soon* | V/MC 3.4%, AMEX 3.9% | — | — |
| NZD | *coming soon* | V/MC 2.7%, AMEX 2.9% | — | — |
| NOK | *coming soon* | V/MC 2.4%, AMEX 2.9% | — | — |
| AED | *coming soon* | V/MC 2.9%, AMEX 3.8% | — | — |

**Non-local card surcharge** ("rest of the world"): USD/HKD/JPY/MXN/TRY **3.9%** ·
AED/SGD 3.8% · CAD/NZD 3.7% · AUD 3.5% · everything European **3.25%**.

**Not offered at all:** PayPal, Klarna/Affirm/Afterpay (no BNPL), Pix, Boleto,
OXXO, Multibanco, MobilePay, Alipay, WeChat Pay, Cash App Pay.

## Clearing times — the table everyone gets wrong

Proxies scramble this table's cells; these come from the raw HTML.

| Method | Time |
|---|---|
| All cards, Apple/Google Pay | **Instant** |
| **ACH, SEPA DD, BACS DD, PAD** | **5–7 business days** |
| BECS DD (AUD) | 3–5 business days |
| **Wire** | **1–5 business days** |
| iDEAL, Bancontact, EPS, P24, MB WAY, Bizum, PayTo, TWINT, Swish, BLIK, FPS, SPEI, PayNow | **Instant** |

Note the counter-intuitive part: **a wire clears faster than ACH.**

## Auto-billing

"Credit cards, debit cards, and local bank payments support auto-billing."
**Ten methods cannot be auto-charged:** SPEI · wire (USD and EUR) · Bizum · EPS ·
MB WAY · Przelewy24 · Swish · BLIK · FPS · PayNow.

There is no explicit "save card" step — the method is saved automatically the
first time an installment is paid with a supported one, and it is saved **per
currency**. Pay the deposit with an excluded method and the traveller falls back
to manual billing emails for every installment. Batch runs daily at **19:10 UTC**.

## Geography

**There is no positive allowlist of operator countries** — 492 help-centre URLs
were enumerated and no such article exists. The model is open-minus-blocklist,
gated by KYC.

**Prohibited outright:** Cuba, Iran, North Korea, Syria, Russia, Yemen, and the
Crimea, Donetsk and Luhansk regions. Plus a **domicile-only** ban on Kazakhstan,
Kyrgyzstan, Tajikistan, Turkmenistan and Uzbekistan — you may still *run trips*
there, you just cannot be based there.

**22 currencies have a free local payout rail.** Everything else is
international wire at $15, and 48 currencies cannot be wired at all (including
**BRL**, ARS, COP, ISK, KZT, UAH).

## Conflicts left unresolved

- **BECS on AUD**: the descriptor list puts AUD on Airwallex, but Airwallex has
  no BECS pay-in. Either AUD is split across both processors, or the descriptor
  list is approximate.
- **"In-Person QR Payments"**: one research pass saw it as a nav item in a
  screenshot; this pass found `product.wetravel.com/in-person-qr-payments`
  returns **404**, it is absent from the Products nav and the sitemap, and
  help-centre searches for `QR`, `in-person`, `card reader` and `terminal` return
  nothing relevant. Treat as unreleased or flag-gated, not shipped.
- **36 vs 34 priced-in currencies** — neither list is published; only 23 are
  identifiable anywhere.
- WeTravel's docs list "Carte Bleue" for CAD and AUD, which is near-certainly an
  error — Cartes Bancaires is a French domestic network.

## One flag for Swellyo

Airwallex **FPS is QR-only, non-refundable and non-disputable**, and the payer
sees "Airwallex (Hong Kong) Limited" as the recipient rather than the merchant
name. Both properties matter for the merchant-of-record work in flight.
