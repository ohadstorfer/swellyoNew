# WeTravel — the money (research lane 2)

## Plans
**Basic $0 · Pro $79/mo per organization** (unlimited team members, no per-seat
fee, 60-day trial) **· Enterprise custom.**

Pro gates the money screens that matter: Payments tracking dashboard, Cash Flow
report, Upcoming Payments, tax lines, contribution pages, QuickBooks CSV.
Free on both: accepting payments, multi-currency checkout, **payment plans**,
**auto-billing**, refunds, discount codes, waitlists, transfers.

## Fees

Processing, by trip currency (the ones we'd use):

| Currency | Bank rails | Visa/MC | AMEX | Apple/Google Pay | Rest of world |
|---|---|---|---|---|---|
| USD | ACH **0%**, wire $25 | **2.9%** | 3.9% | 3.3% | 3.9% |
| EUR | SEPA/iDEAL/Bancontact **0%**, wire €25 | **1.5%** | 2.9% | 2.0% | 3.25% |
| GBP | BACS **0%** | **1.5%** | 2.9% | 2.0% | 3.25% |
| AUD | BECS/PayTo **0%** | **1.7%** | 2.9% | 1.7% | 3.5% |

**The WeTravel fee itself is deliberately unpublished.** Their payment-processing
page lists every card rate in a table and then prints "**+ WeTravel Booking
Fee**" with a *Learn more* link and no number. Only two facts are stated
publicly: charged **per transaction**, **minimum $1.50 USD**.
No WeTravel fee on wire transfers, on payment plans, or on cash/external.

### ⚠️ Update (25 Aug) — the formula is `X% + $0.30`, min $1.50

Superseding the earlier "~1.2%" note. A **third data point, from a real
third-party live checkout** (not our demo account) resolves the shape of the
fee, if not the rate.

Observed on Kale Brock's trip, `wetravel.com/checkout_embed?uuid=5025737802`,
Jul 11–18 2027, package "Private apartment accommodation – single" $4,900,
deposit $1,000, final payment $3,900 due Apr 12 2027:

```
Trip Total       $4,900.00
Service Fee         $20.30
Due at Booking   $1,020.30     ⓘ  Deposit     $1,000.00
                                  Service Fee    $20.30
```

$20.30 on $1,000 is **2.03%** — which is **2% + $0.30**. Re-run the two demo-account
screenshots against that shape and both fall out exactly:

| Charge | Observed fee | `1% + $0.30` | `2% + $0.30` | Min $1.50 |
|---|---|---|---|---|
| $150 (demo) | $1.80 | **$1.80 ✓** | $3.30 | — |
| $100 (demo) | $1.50 | $1.30 → floored | $2.30 | **$1.50 ✓** |
| $1,000 (Kale Brock) | $20.30 | $10.30 | **$20.30 ✓** | — |

Three for three. **The fee is `percentage + $0.30`, floored at $1.50, and the
percentage is account-dependent** — 1% on our demo account, 2% on Kale Brock's.
Public secondary sources describe the rate as "**as low as** 1% + $0.30", which
points at **1% = Pro, 2% = Basic**. That last mapping is inference; the formula
itself is now three-for-three.

**It is charged per transaction, not per booking.** The $20.30 is levied on the
$1,000 due now. The $3,900 final payment in Apr 2027 carries its own fee —
$78.30 on the same formula — for **$98.60 total on a $4,900 trip**. So a payment
plan neither costs extra nor dodges the fee; it just splits it. This matches the
published "charged per transaction" and is why the $1.50 minimum bites hardest
on many-installment plans of small amounts.

**The Service Fee line is the WeTravel fee only — the card fee is not in it.**
Two proofs from the same screenshot: US Visa/MC is 2.9%, which would be $29.00,
not $20.30; and **no payment method has been selected yet** at the point the line
renders. Consistent with their own doc — card and wire fees only materialise at
checkout once the traveler picks card or wire, and local bank rails add nothing.
So Kale Brock passes the *WeTravel fee* to travelers and either absorbs the card
fee or has it appear at the next step. The two toggles are independent — see
"Who pays" above.

**Implication for the mockup:** `FEES` / `DB.settings.platformFeePct` currently
models `1.2` with `platformFeeMin: 1.50` and no fixed component. The shape is
wrong, not just the number. Correct model is
`max(1.50, rate * amount + 0.30)` per transaction, with `rate` configurable and
defaulted to `0.02`. Still label it as configurable in the UI — the rate is
genuinely unpublished, only the shape is now known.

**Who pays** — Trip Builder ▸ Settings ▸ *"Who pays the fees?"*, two radio pairs:
`Payment fees (when applicable) are paid by: Organizer / Participant` and
`WeTravel fee is paid by: Organizer / Participant`. Per trip, new transactions
only. If passed on, the fee line only appears once the traveler picks card or
wire — local bank rails add nothing.

Payout fees: local **free** (1–3 days) · international wire **$15** (3–5 days) ·
instant USD to debit **1.5%**, min $0.50, cap $3k/day · currency conversion
**free** · supplier transfers **free**, "within seconds".

## Payment plans — configured per package, not per trip

Trip Builder ▸ **Packages** ▸ `Add Deposit / Payment Plan` → Yes.

The modal, verbatim:
```
Number of payments
  Deposit plus  [1..24]        ← grid picker, 1 to 24 installments

Payment dates
  Deposit        Due at booking      [$100]
  1st Payment    [Oct 31, 2025 📅]   [$300.00]
  2nd Payment    [Nov 30, 2025 📅]   [$300.00]
  Final Payment  [Dec 31, 2025 📅]   [$300.00]

☐ Allow partial payment
☐ Enable auto-billing
☐ Auto-adjust payment plan for late bookings
                                     Total: $1,000.00
```

- **Fixed calendar dates, not relative offsets.** Defaults to monthly and equal;
  every date and amount is individually editable.
- Deposit is always **"Due at booking"** and that cannot be changed. With no
  plan, the amount is labelled **"Upfront Payment"** instead.
- Installment amounts must sum to exactly the price minus the deposit.
- No minimum deposit — $0.00 deposits appear in their own screenshots.
- **No late fee exists anywhere in the product.**
- Plans cannot be cancelled — you edit down to a single installment.
- Multiple packages merge into **one** combined plan on booking.

**Auto-billing** is off by default and is the *organizer's* switch, not the
traveler's. One global daily batch at **19:10 UTC**. Cards and local bank only —
never wire, SPEI, BLIK, Przelewy24, Swish.

**Missed payments:** no auto-retry. The missed installment is lumped into the
next one. `Auto-adjust for late bookings` redistributes the balance excluding
the deposit across remaining dates.

**Reminders** (all sent 19:00–20:30 UTC):
manual plans — 7 days before · 3 days before · on the due date · late notice
2 days after · organizer alerted at 3+ days.
auto-billing — 3 days before the charge · failure notice on the day ·
organizer alerted 2 days after a failure.

**Per-participant editing:** Manage Trip ▸ row ⋮ ▸ **Manage Payment Plan** ▸
Edit Plan. Saving auto-emails the traveler the new schedule, with an optional
custom message.

## Checkout money, traveler-facing

```
Payment Options
  (•) Pay amount due — $100.00
      $100.00 — Amount due at booking
      $900.00 — Final payment due Dec 31, 2025
      You will receive an email with a link to pay when a payment is due.
  ( ) Pay full amount — $1,000.00
```
With auto-billing: *"We will automatically charge your payment method on the
dates below:"*

Right rail **"Your Booking"** with a currency dropdown:
Trip Total · **Service Fee** · **Due at Booking**.
The platform fee is called **Service Fee** to travelers and **WeTravel fee** to
organizers.

Travelers never choose between plans — one schedule per package, organizer-set.
Partial payment only after the deposit is fully paid. **No BNPL.**

## Multi-currency
Priced in 36 currencies, paid in 19–21, and **23 balance currencies** (the 19
wallet currencies plus ZAR, BRL, THB and ILS, which exist only if you price a
trip in them). **22 currencies have a free local payout rail**; everything else
falls back to international wire. Anything
else auto-converts to USD daily. Traveler's default comes from geolocation.
**The organizer always receives the trip currency; WeTravel absorbs the FX** —
and never discloses the spread. (Reviews say the spread is the real cost:
one operator measured €250 lost on a transfer whose stated fee was €41.)

## Payouts

> Full detail — the Payout Accounts screen, payout methods and limits, the four
> ways to pay a supplier, wallet conversion, and what each verification level
> unlocks — now lives in **`RESEARCH-payouts.md`**. Summary only below.

**Manual and organizer-initiated. There is no automatic payout schedule.**

⚠️ **Correction (25 Aug):** the claim that there is "no departure-date escrow"
holds only for a **fully verified** account. WeTravel says **Partial Approval is
"the most common verification decision for our new users"**, and it blocks
international wire, the card and supplier transfers outright. The exit is to
wait until **30 days after your first trip has completed** and then **email
support** — not automated. For a new operator that is functionally escrow past
departure, just never called that. Separately, the Terms let WeTravel place a
discretionary hold "equivalent to total payments for upcoming and future trips"
on suspension. See `RESEARCH-processors.md`.

Once verified, funds are withdrawable as soon as the payment clears.
Card clears instantly; bank transfers take 5–7 business days.
Payments ▸ Payout Accounts. Buttons: **Add Local Payout Account · Transfer ·
Convert · Top Up**. One local account per currency.

**KYC has three levels:** Supplier (ID + selfie, receive only) → Trusted Partner
(+ proof of address, business registration) → **Trip Organizer** (+ travel
registration; required to collect from travelers). Review takes up to 3 business
days, and most new accounts land in **"Partial Approval", which blocks payouts** —
the single most-complained-about thing in the review corpus.

## Refunds
Manage Trip ▸ row ⋮ ▸ **Cancel or Refund**, three modes:
1. **Cancel and Refund** — if the refund is smaller than the cancelled amount,
   it asks: **"Keep the difference"** (a cancellation fee) or **"Apply the
   difference to the remaining booking balance."**
2. **Cancel Only** — no money moves.
3. **Refund Only** — including **"Return Now, Collect Later"**, which reduces
   amount-paid but not the booking total.

Fee treatment: the traveler always gets the full amount, **WeTravel refunds its
own fee**, but the **card processing fee comes out of the organizer's balance
and is never recovered.** Refunds land in 5–10 business days and cannot be
reversed. Bank rails hard-stop at **180 days** (90 for PIX/PayNow/BECS).

**No structured cancellation policy tiers exist.** The policy is freeform text
in the trip description. The platform default when nothing is written: *"All
payments paid through WeTravel are non-refundable."*

**Disputes:** the organizer bears full liability. The full payment is pulled and
held, 60–80 day resolution, 120-day filing window.

## Supplier payments

> Expanded in **`RESEARCH-payouts.md`** — four distinct mechanisms, not one.

**Supplier Transfers** — free, WeTravel-balance to WeTravel-balance, seconds.
**Both sides must be independently KYC-verified.** Recipient statuses: `Verified`
· `Invite Pending` · `Verification in progress` · `Verification not started`.
**Business Payment Request** — the B2B invoice: Title · Amount · Due date ·
Currency · reference · invoice attachment · fee responsibility · trip linkage.
Supports installments a minimum 7 days apart. Also **WeTravel Cards**.

## Who actually processes the money — verified 25 Aug 2026

WeTravel is **built on Stripe**. Two WeTravel-owned sources:

- Their card page, verbatim: *"WeTravel Visa® Commercial cards are powered by
  Stripe and issued by Celtic Bank."*
  (`product.wetravel.com/wetravel-card`)
- Their verification help article refers to *"how to connect your Stripe
  Standard account"*, and names **Persona** as the KYC/identity partner.
  (`help.wetravel.com/en/articles/1619345`)
- Their **Terms of Service** (last updated 1 Dec 2025), read directly in a
  browser at `https://www.wetravel.com/terms` — the page 403s to fetchers but
  loads normally in Chrome. Verbatim:

  > "Payment processing services for Wetravel are **among others** provided by
  > Stripe, Inc. and Stripe Payments Europe, Ltd. ("Stripe") and are subject to
  > the Stripe Connected Account Agreement, which includes the Stripe Terms of
  > Service… As a condition of Wetravel enabling payment processing services
  > through Stripe, you agree to provide Wetravel accurate and complete
  > information about you and your business…"

  **Note the qualifier.** Second-hand summaries of this clause drop the words
  "among others". Stripe is confirmed as *a* processor on WeTravel's own binding
  terms — it is **not** stated to be the only one. That fits a payment-method
  list spanning SPEI, Pix, BLIK, PayNow and FPS, which are not all Stripe-native
  in every market. The accurate claim is *"WeTravel processes through Stripe
  Connect, among other providers"*, not *"WeTravel's processor is Stripe"*.

**Inference, not fact:** "Stripe Standard account" + "Connected Account
Agreement" means Stripe **Connect**, and in Stripe's model a Standard connected
account is itself the merchant of record and carries the dispute liability. That
matches the review corpus exactly — operators report bearing 100% of chargebacks
and WeTravel's own dispute policy says the organizer is "legally liable to cover
the disputed amount". It is a coherent reading, but the Terms page itself was
not readable directly, so treat the merchant-of-record conclusion as inferred.

**Why this matters for Swellyo:** it puts WeTravel on the same rails Swellyo is
already on, and on the far side of the merchant-of-record question Swellyo is
currently reversing. Their fee tables and payment-method list — SEPA, iDEAL,
BECS, PayTo, BLIK, Przelewy24, SPEI, Pix, PayNow, FPS — are essentially Stripe's
method catalogue with a margin on top.

## Money screens

**Bookings (per trip)** — columns: Buyer · Participants · Add-ons · **Payment
Status** · Booking Date. Row ⋮ menu, with dividers:
`View Booking Details · Manage Payment Plan · Send Message` — *Booking* —
`Rebook to Another Trip · Switch Package · Add Add-On · Re-assign Add-On ·
Cancel Booking or Add-On` — *Payment* — `Add Payment · Set Custom Price ·
Adjust Balance · Issue Refund`.

> Note the split worth stealing: the **Participants** table has **no payment
> column at all**. Payment state lives only in Bookings.

**Reports ▸ Payments Reporting** — Amount (with a bank/card icon) · Customer ·
Trip · Date. Status renders as a red pill only when abnormal (`Failed`).
Filters: Date · Payment Source · Status · Currency · Trip.

**Reports ▸ Transaction Reporting** — Type · Net · Amount · Fee · Description ·
Date. Filters by type: payment, refund, dispute, supplier transfer, payout,
wire, card transfer, top-up, adjustment, conversion. Export is two sheets, 24
columns, including **Net** (fees withheld), gross **Amount**, **Customer-facing
amount**, WeTravel fee, organizer card fee, customer card fee, running balance.

**Reports ▸ Cash Flow (Pro)** — Payments Collected · Available Balance as of
Today · Total Payouts as of Today (split local / wire / cards / supplier) · Net
Collected · Sales. Metrics: customers, cancelled, disputes, refunds, add-ons,
external payments, leads, leads converted, revenue from leads, contributions,
waitlisted. Explicitly **historical only** — no forward projection.

**Upcoming Payments (Pro)** — bar graph, **blue = upcoming installments due,
red = past due**. This is the one forward-looking screen.

## Terminology
WeTravel fee (organizer) = **Service Fee** (traveler) · **Buyer** vs
**participant** · **Due at booking** · **Upfront Payment** · **auto-billing** ·
**Allow partial payment** · **Pay amount due / Pay full amount** · **Discount
code** · **Cancel or Refund** · **Return Now, Collect Later** · **Set Custom
Price / Adjust Balance / Add Custom Adjustment** · **Supplier Transfers** ·
**Business Payment Request** · **Top-up** · **Convert**.
