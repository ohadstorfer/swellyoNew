# Money out — payout accounts, payouts, and paying suppliers

Companion to `RESEARCH-money.md` (money **in**: fees, plans,
refunds) and `RESEARCH-processors.md` (who holds the float, holds, liability).
This file is only about what an operator can do with a balance once it exists.

Researched 25 Aug 2026 from help.wetravel.com and academy.wetravel.com.

---

## The model, in one line

**Traveler money never touches the operator's bank account.** It lands in a
**WeTravel balance** — a stored-value wallet the operator holds *inside*
WeTravel, one per currency. Everything on the Payout Accounts screen is about
getting money out of that wallet, in two different directions:

1. **Payout** → to the operator's own bank or debit card.
2. **Transfer** → to a supplier, vendor or partner.

Payout Accounts is the settings page that stores the destinations for both. It
is not a screen that moves money on its own except through the per-beneficiary
`Transfer` buttons it hosts.

> This is the single biggest architectural difference from Swellyo. Swellyo is
> Stripe Connect paying an operator per trip. WeTravel is a **wallet the
> operator runs their whole supply chain out of**. See "Why this matters" below.

## Where it lives

Name (top right) ▸ **Payments** ▸ left rail ▸ **Payout Accounts**.

Sections on that page:
- **Local payout account** — one per currency. Only **one local USD bank
  account** per organization; the same one-per-currency rule applies to EUR/CAD.
- **Linked debit card** — US-issued, for instant payouts.
- **Wire Transfer Accounts** — up to **10 beneficiaries**, each row carrying its
  own green `Transfer` button.
- Recipients / suppliers, also reachable at Payments ▸ **Recipients**.

Page-level buttons: `Add Local Payout Account · Transfer · Convert · Top Up`.

## Paying yourself out

| Method | Speed | Fee |
|---|---|---|
| Standard payout, local bank (USD) | **1 business day** | free |
| Standard payout, local bank (EUR / CAD) | **2–3 business days** | free |
| Instant payout, linked US debit card | seconds – **30 min** | **1.5%**, min $0.50, **cap $3,000/day** |
| International wire | **3–5 business days** | **$15** (or equiv) + beneficiary and intermediary bank fees |

Constraints worth knowing:

- **Instant payout is not available on a first-time payout account**, and the
  card must be a real US debit card linked to an active local bank account —
  **no prepaid cards**.
- A local bank payout needs **SSN** (personal account) or **EIN** (business
  account). Stripe is the processor and is legally obliged to identity-check the
  operator once cumulative payouts pass "a few thousand dollars", which can
  stall the first large payout by several days. No SSN/EIN at all → **wire only**.
- Wire is capped at **$500,000/day**.

## Paying providers — four separate mechanisms

This is the part of WeTravel that has no Swellyo equivalent at all. "Pay a
provider" is not one feature; it is four, and they have very different
economics.

### 1. WeTravel Transfer — the vendor transfer network

The one they actually market.

Path: Payments ▸ **Recipients** ▸ `Transfer Money`, or Balance ▸ `Transfer` ▸
**Transfer to Supplier**.

Flow: amount → which currency wallet it comes from → pick or add recipient →
**payment purpose** → reference note (optional) → **invoice upload** (PDF, JPG,
PNG, GIF, Word, Excel, ≤ 5 MB) → review → `Confirm Transfer`.

- **Arrives in seconds. Free.**
- Both sides must have a WeTravel account and **both must be verified**.
- The supplier is paid in the **sender's** currency. There is no FX on the
  transfer itself — the supplier converts later, free, between their own wallets,
  or takes the FX hit on withdrawal to their own bank.
- Both parties get an email confirmation; the uploaded invoice surfaces in
  Payments, Transactions and Transfer Reporting.

The pitch, in their own framing: the money never leaves the platform, so it
skips bank rails, the 4–8% effective FX cost of a small international wire, and
1–5 day settlement. **This is the moat, not the checkout.** Free instant
intra-platform transfer is only possible because WeTravel is holding the float
on both sides of the transaction.

### 2. Wire transfer — for suppliers not on WeTravel

Payout Accounts ▸ Wire Transfer Accounts ▸ green `Transfer`.

Flow: amount → source currency wallet (6 supported) → payment purpose →
reference. If conversion applies, a rate table renders with a **locked exchange
rate**, then the system shows the final amount after wire fees are deducted.

- **$15 per transfer, 3–5 business days.** First-time beneficiaries take longer.
- **Irreversible.** Verbatim: *"Once you submit the wire transfer, you will not
  be able to cancel it."*
- The account must be **in your own business name** and *"all wire transfers
  have to be related to your trips and business."*
- Statement descriptor on the receiving end: **"Wetravel Inc."** or
  **"Cambridge Mercantile Corp."** (Corpay's FX entity — see
  `RESEARCH-processors.md`).
- **Unsupported destination currencies** (45+): ANG, ARS, AWG, AZN, BBD, BMD,
  BND, BOB, BRL, BSD, BTN, BYN, BYR, BZD, COP, CRC, DZD, FKP, GIP, GTQ, GYD,
  HNL, HTG, IQD, ISK, KGS, KMF, KYD, KZT, LBP, LYD, MDL, MKD, NAD, NIO, NPR,
  PAB, PYG, SLE, SRD, SVC, SZL, TMT, UAH, UYU, UZS, VEF, XCD, YER.
- **Unsupported countries** include Afghanistan, Belarus, Cuba, Iran, North
  Korea, Russia, Syria, Venezuela, Zimbabwe.

### 3. WeTravel Card — virtual Visa drawn on the balance

For suppliers that only take a card.

- **Virtual only** today; plastic "coming soon". Works anywhere Visa is accepted,
  plus Apple Pay and Google Pay.
- **Up to 50 virtual cards per organization.**
- **No annual, card-creation or membership fee.** Exchange and transaction fees
  vary US vs international.
- **Level 2 or Level 3 verification required**, business incorporated in an
  eligible region (Americas, Europe, Asia, Oceania).
- Funds are usable **immediately** for card spend; the bank-transfer funding path
  takes 5–7 business days.
- Powered by **Stripe**, issued by **Celtic Bank**.

### 4. Business Payment Request — the reverse direction

Not paying a supplier: **invoicing another business.** Co-organizers, agencies,
corporate clients, suppliers.

- Amount + due date + currency → recipient gets a secure checkout link by email.
- Pays by bank transfer, card or wire. **Installments supported** (minimum 7 days
  apart).
- Auto-reminders at **−7 days, −3 days, on the due date, +2 days** if unpaid.
- **You choose who covers the payment fees.**
- Requests over **$5,000 USD require an attached supporting document** (invoice)
  before the request can even be created.
- Explicitly **not for travelers** — the platform blocks that use and tells you
  to make a trip or a payment link instead.

## Verification gates all of it — three levels

Repeated here from `RESEARCH-money.md` because it is the actual gate on every
mechanism above.

| Level | Documents | Unlocks |
|---|---|---|
| **1 — Supplier** | gov ID + selfie | **Receive** transfers. Limited Partner Hub visibility (no full profile). |
| **2 — Trusted Partner** | + proof of address, business registration, website or social | Receive transfers, listed in the **WeTravel Partner Hub**, eligible for the Card |
| **3 — Trip Organizer** | + travel registration details | **Collect from travelers**, full organizer product suite |

- Submission takes 5–15 minutes; review up to **3 business days**.
- Each level is a **separate verification process** when upgrading.
- Most new users land on **"partial approval"**, with full approval possible
  after **30 days** — and partial approval blocks international wire, the Card
  and supplier transfers outright. See the correction in `RESEARCH-money.md`:
  for a brand-new operator this is functionally departure-date escrow, just never
  named that.

## Converting between your own wallets

Payments tab ▸ **Convert**. Pick amount, source currency, destination currency;
you can also enter the target amount and it back-solves the source.

- **20 currencies:** USD, EUR, GBP, CAD, AUD, ZAR, SEK, NOK, DKK, CHF, HKD, PLN,
  NZD, MXN, AED, CZK, HUF, JPY, SGD, TRY, BRL.
- **No fee.** The `Fee` field in Transaction Reporting literally logs `0`.
- **The margin is entirely in the rate, and the spread is never disclosed.** This
  is consistent with the FX-margin finding in `RESEARCH-processors.md` — one
  operator in the review corpus measured €250 lost on a transfer whose stated fee
  was €41.
- **Minimums:** ~20 units for majors (USD, EUR, GBP…); 40 ILS, 200 ZAR, 400 THB,
  2,000 JPY and HUF.
- **Daily cap:** 300k USD equivalent, and never more than the available balance.

## The balance is not unconditionally yours

Cross-reference, not new: risk-based holds keep funds **in the balance,
unavailable for payout but still available to issue refunds**, typically up to
**30 days** from receipt and longer on fraud or chargeback. On a dispute the full
trip amount is pulled and held by the processor for **60–80 days**. Full quotes
and the suspension clause are in `RESEARCH-processors.md`.

## Why this matters for Swellyo

Swellyo pays an operator per trip over Stripe Connect. WeTravel gives the
operator a **wallet they run the whole supply chain from** — the surf camp, the
driver, the guide, the boat, all paid without a bank round-trip, instantly, free.

Three consequences worth holding onto:

1. **The retention hook is not the checkout, it's the balance.** An operator with
   a working supplier network inside WeTravel cannot leave without rebuilding it.
   Swellyo has nothing that creates that stickiness.
2. **The float pays for the free transfers.** Free instant supplier transfer,
   free conversion, free local payout — all of it is funded by holding operator
   money and by an undisclosed FX spread. It is not generosity, it is a business
   model, and it only works if you are merchant of record. Compare
   `project_swellyo_is_merchant_of_record` and the reversal now in flight.
3. **It is a licence-shaped problem.** WeTravel holds no payments licence of its
   own (see `RESEARCH-processors.md`) — the wallet is a ledger over pooled bank
   accounts at partner EMIs. Swellyo would inherit exactly that constraint if it
   ever copied the wallet.

## Sources

- `help.wetravel.com/en/articles/3456081` — transfer money to a supplier
- `help.wetravel.com/en/articles/773162` — USD payout accounts
- `help.wetravel.com/en/articles/1788593` — EUR payout accounts
- `help.wetravel.com/en/articles/2390174` — CAD payout accounts
- `help.wetravel.com/en/articles/419852` — adding a wire transfer account
- `help.wetravel.com/en/articles/6926526` — initiating a wire transfer
- `help.wetravel.com/en/articles/6049882` — instant USD payouts
- `help.wetravel.com/en/articles/14594381` — Business Payment Request
- `help.wetravel.com/en/articles/3347411` — WeTravel Card FAQ
- `help.wetravel.com/en/articles/9039078` — converting currencies
- `help.wetravel.com/en/articles/1619345` — guide to getting verified
- `help.wetravel.com/en/articles/434422` — pricing
- `academy.wetravel.com/wetravel-vendor-transfers`
