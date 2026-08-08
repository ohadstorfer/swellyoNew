# Payment section + partial payments (Plan tab)

**Built 2026-08-06.** Ohad's ask: at the bottom of the traveler's Plan tab, a
"Payment" section — how much they already paid, of what total — with a "Pay
now" button that opens a sheet: pay the full amount, or pay part of it (they
choose how much). Whatever they pay comes off what they still owe.

---

## 1. What the traveler sees

- **Payment section** (`PaymentSection` in `PlanSections.tsx`), rendered at the
  bottom of Plan for a traveler on a `managed` trip whose price is known:
  paid-so-far of the total, a progress bar (same 6px track as "Committed to
  trip"), what's left, and a "Pay now" button. All paid → green bar, no button.
- **Pay now** opens `PayAmountSheet` (`src/components/trips/PayAmountSheet.tsx`):
  two radio options — full amount / part of it. "Part of it" reveals a USD
  input (whole dollars). Israeli viewers get the same "about ₪X" hint the task
  rows use, off the trip's frozen `budget_fx_rate`.
- The sheet only **chooses an amount**. The checkout itself runs through the
  exact same path as tapping a pay task row (`handlePressDocumentRow`), so all
  the double-payment gates — confirming, processing, "you already started this
  payment" — apply unchanged. The section's button mirrors the target row's
  state and routes a gated tap to the explanation sheet, never to checkout.

## 2. One pot, but one step at a time

The summary is a single pot: paid = every payment event for this traveler on
this trip, total = their frozen price. But one Stripe Checkout session pays
against ONE requirement, so the button targets the first pay step with money
still owed — **deposit before balance**, the order the server collects in.

Partial amounts are capped by the step, not the pot. This keeps the
per-requirement ledger attribution untouched: no migration, no change to
`operator_requirement_pay_state`.

### 2a. The deposit is all-or-nothing

**A deposit cannot be part-paid.** It is not an early instalment — it is the
threshold that makes the booking real, so a traveler who pays $50 of a $1,000
deposit has committed to nothing while occupying a seat. Only once the deposit
is settled does the remaining balance become freely part-payable.

Enforced in two places, as usual:
- **Client** — `handlePayNow` sends a `deposit` target **straight to Checkout**
  for the full amount and never opens `PayAmountSheet`. With no amount to
  choose, the sheet would be a tap that asks nothing.
- **Server** — `payments-checkout` rejects an `amountUsd` below `outstanding`
  on a `deposit` requirement with "The deposit has to be paid in full."

A deposit that is already part-paid (reachable only from testing before this
rule existed) resolves cleanly: "full" is the *remaining* deposit, paid in one
go.

### 2b. Where the split is explained

The Payment card carries a two-row breakdown (`PaymentSection`'s `steps`):
`Deposit $500 of $1,000` / `Final payment $2,000`, with a finished step reading
"Paid". This exists because the first version explained the split inside the
sheet, and on device that read as the deposit arriving out of nowhere — the
card said "$2,500 left to pay" while the sheet said "$500 left on deposit", two
different figures with nothing connecting them. State the split once, in the
card; keep the sheet to the step name and the figure it will charge.

## 3. Server: `payments-checkout` accepts `amountUsd`

- Optional body field. Shape-checked (finite, > 0), then **clamped to what is
  actually outstanding** — the client's number is a request, never an authority.
- Two edges fold back into a full payment: asking for more than outstanding
  (the extra would be unrefundable overpayment), and leaving less than $0.50
  behind (Stripe's USD minimum — the remainder could never be paid and the
  step would be stuck short of `approved` forever). Requests below $0.50 are
  refused with a sentence.
- The response now echoes `amountUsd` (what will actually be charged), in BOTH
  success returns (fresh-match and newly-minted).
- No idempotency-namespace bump: the create call's fields are unchanged, and
  the amount was already part of the key (`amountCents`).

**Version-skew guard (the important part).** A deployment of the function that
predates this feature silently ignores the unknown field and mints a session
for the FULL outstanding amount — a "$100" button showing a $1,000 Checkout
page. `startCheckout` therefore refuses to open the browser when it asked for
a partial amount and the response carries no `amountUsd` echo.

> ⚠️ **Deploy order:** deploy `payments-checkout` BEFORE shipping the client.
> Until then the partial path fails safely ("Paying a custom amount is not
> available right now") — the full-amount path is unaffected either way.

## 4. Confirming a partial payment

Every confirmation path used to check one thing: requirement state ==
`approved`. A partial never reaches `approved`, so each path gained a second
signal — **the ledger shows more paid on this requirement than when the
checkout started**:

- `confirmPayment`'s post-checkout poll (baseline snapshotted from the query
  cache just before checkout opens);
- the background 5s poll that resolves "Processing" rows;
- PaymentStatusSheet's "Check again".

The baseline survives unmount because it is stored with the attempt:
`pendingPaymentStore` records `{ at, basePaidUsd }` per requirement (legacy
bare timestamps are upgraded on read with `basePaidUsd: null` — those fall
back to the approved-only check). See `payment-pending-state.md` §3.

## 5. What did NOT change

- No DB migration. No change to `operator_traveler_amount_due`,
  `operator_requirement_pay_state`, or the webhook — the webhook already
  records whatever amount the session charged, and partial sums simply
  accumulate per requirement.
- Task rows: a part-paid step keeps showing "Pay" with the reduced outstanding
  figure (`amountOutstanding` always subtracted paid; partials just make it
  matter).
- The host side reads the same ledger sums it always did.
