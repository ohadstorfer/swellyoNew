# Adding other currencies — a note for later

What it would take to charge in a currency other than USD, written while the money
code is still fresh.

**Status:** note, 13 August 2026. Nothing is being built. Nothing is decided beyond
§2, which is already how the system works today.

**Why it exists:** the first operator who will want this is Israeli, and the question
was asked before there were real trips to break. Everything below was checked against
the code on 13 August 2026, not remembered.

---

## 1. What is true today

Every amount in this system is US dollars. There is no currency column anywhere —
the currency is baked into the column *name*, and into every identifier that reads it.

| Where | What is baked in |
|---|---|
| `group_trip_participants` | `price_total_usd`, `deposit_usd` |
| `group_trips` | `cost_per_person`, `deposit_amount` — **not named `usd`, but they are USD** |
| `organized_trip_payment_events` | `amount_usd`, plus `is_livemode` (see §6) |
| `operator_set_traveler_price(...)` | parameters `p_total_usd`, `p_deposit_usd` |
| `src/domain/money.ts` | `amountDueUsd`, `sumPaidUsd`, `effectiveTotalUsd`, `parseUsdInput`, `toCents` |
| `src/lib/format.ts` | `formatUsd` — hardcodes `currency: 'USD'` and locale `'en-US'` |
| `src/services/payments.ts`, `trips.ts`, `actions.ts` | every field mapped as `…Usd` |
| `TravelerPriceDialog.tsx` | the label literally reads *"Total price (USD)"* |

The two rows without `usd` in the name are the trap in this table. `cost_per_person`
and `deposit_amount` are the trip's default price, and nothing about them says what
currency they are. Whoever adds a second currency must not skip them because the
name did not remind them.

---

## 2. The decision that is already made

**The traveler always pays USD.** The operator may type a price in another currency
for their own convenience; it is converted to USD at publish and the rate is frozen
there, so the price cannot drift afterwards. The traveler may be shown an approximate
figure in their own currency, clearly marked as approximate — their bank converts at
its own rate on the day.

The reason is not a product preference. **The Stripe account is a US account and
settles in USD.** Charging in another currency would add a conversion and a fee
without paying anyone in that currency at the other end.

> **Booking.com does something different, and it is worth knowing why.** They charge
> in the *property's* currency, because they hold payment infrastructure in dozens of
> countries and pay each hotel in its own money. We do not. Platforms shaped like ours
> — Viator, GetYourGuide — settle everything in one currency and treat the rest as
> display. Our model is the right one *for our payout arrangement*, and it stops being
> right the day we owe an operator shekels. That day is §3.

---

## 3. Waiting costs nothing

This is the important part, and it is the reason there is no work to do today.

Every row that exists now is unambiguously USD. When a second currency arrives, the
backfill is `currency = 'USD'` on every existing row, and **it cannot be wrong** —
there is no row anywhere whose currency has to be guessed, inferred from the operator,
or reconstructed from a date.

So adding a currency column in six months costs the same as adding it today, except
that today it also costs a migration in the main project for no present benefit.
`docs/SPEC.md` §2 rule 1 — this project adds nothing to the database — holds.

**Do not pre-emptively add a currency column "to be safe."** It buys nothing that
cannot be bought later at the same price.

The one thing already worth protecting is protected: the trip snapshot card, the money
page and the traveler card all read the same `useTripMoney` hook, and every amount goes
through `amountDueUsd` / `sumPaidUsd` / `formatUsd` rather than touching columns
directly. That is what keeps this a change in a few files instead of everywhere.
**Keep it that way.** A component that formats an amount itself is the thing that makes
this migration expensive.

---

## 4. The one thing that cannot be recovered later

**The exchange rate at the moment a payment was taken must be stored on the payment
row itself, in the same migration that allows the first non-USD payment — before the
first such row exists.**

Not on the trip, not looked up afterwards. Nobody can reconstruct what a rate was on a
Tuesday afternoon eight months ago, and an operator reconciling their books against
Stripe will ask exactly that question. Everything else in this document can be fixed
late at ordinary cost. This one is lost the moment the first payment lands without it.

The trip-level rate frozen at publish (§2) answers *"what does this person owe"*.
The row-level rate answers *"what actually arrived"*. They are different numbers and
both are needed. Refunds carry their own rate too, and it is not the rate of the
payment being refunded.

---

## 5. What would actually change

| Layer | Change | Difficulty |
|---|---|---|
| Database | `currency` on prices and on the ledger; rate + rate-taken-at on the ledger; new RPC parameters | Mechanical. Backfill is `'USD'` (§3). Lives in `swellyoNative`, not here. |
| `src/domain/money.ts` | Amounts become `{ amount, currency }` instead of a bare number. `sumPaidUsd` must refuse to add two currencies rather than adding them | The only place with real thinking in it |
| `src/lib/format.ts` | `formatUsd` → `formatMoney(amount, currency)` | Small |
| Services | Field mapping and RPC parameter names | Tedious, no risk |
| UI | Labels that say "(USD)", the `$` in copy, the money page columns | Tedious, no risk |
| Renaming | ~10 files where every identifier ends in `Usd` | Pure rename. 46 tests in `money.test.ts` catch a slip. No data is touched. |

Three smaller traps that are easy to miss:

1. **`parseUsdInput` strips `$` and `,`.** It treats a comma as a thousands separator.
   In a locale that uses the comma as the *decimal* separator, `3.000,50` parses to
   nonsense — and nonsense here is a wrong price, not an error.
2. **`toCents` assumes two decimal places.** True for USD and for ILS (agorot). **Not
   true for zero-decimal currencies** — JPY, KRW, CLP. Stripe has the same distinction
   in its API. If "other countries" ever reaches Japan, this assumption is a silent
   factor of 100.
3. **`formatUsd` hardcodes the `en-US` locale as well as the currency.** Symbol
   placement differs by locale, so the currency and the locale have to move together.

---

## 6. The hard part: the ledger is Stripe-shaped

`organized_trip_payment_events` carries `is_livemode` — Stripe's test/real split. A
second payment processor has no such concept, and `countsAsPayment()` in
`src/domain/money.ts` filters on it for every payment the system counts. That function
feeds the total on all three screens.

So a second processor forces a decision that has nothing to do with currency: what
`is_livemode` means for a row that did not come from Stripe. The safe answer is a
`provider` column, with the livemode filter applying only to Stripe rows — but it has
to be a deliberate answer, because the failure mode is silent. A row that is filtered
out reads as *money that never arrived*.

This is made worse by something already recorded in the money design, §4: **the
livemode flag exists in three places** — `app.stripe_livemode` in the database,
`EXPO_PUBLIC_STRIPE_LIVEMODE` in the mobile app, `VITE_STRIPE_LIVEMODE` here — and all
three must agree. A fourth payment provider is a fourth chance to get that wrong.

**This, not the currency, is the expensive part of adding an Israeli payment method.**
If the second method is still Stripe, in a different currency, none of §6 applies.

---

## 7. The rule for trips that are already running

**Currency is frozen when the trip is published, alongside the exchange rate. It never
changes for that trip.**

A trip published in USD stays USD until it ends, even if its operator switches methods
the next day. Only new trips get the choice. This means **no live trip is ever
converted**, which removes the entire class of risk the question was really about:
there is no migration step that touches a trip with real travelers and real payments
in flight.

The alternative — currency attached to the operator — would silently re-price every
running trip the moment an operator changed a setting. Do not do that.

---

## 8. Mixed currency inside one trip must be impossible

A traveler priced in shekels who paid a deposit in dollars is a trip whose total cannot
be computed without inventing a rate. `sumPaidUsd` today adds cents blindly, and would
happily return a confident, meaningless number.

Two defences, both required:

- The currency is on the **trip** (§7), so a trip cannot hold two.
- `sumPaidUsd` **throws** when it meets a currency it is not summing, rather than
  coercing. A loud failure on one page beats a wrong total on three.

The only legitimate mixed case is a trip published before the change and a refund
issued after it. The refund is in the trip's frozen currency. It is not an exception.

---

## 9. Not doing now

- Adding a currency column ahead of need — §3.
- A live FX-rate feed. The rate is frozen at publish and stored per payment; nothing
  on this site needs today's rate.
- Showing travelers a converted estimate. That is the mobile app's screen, not this one.
- Multi-currency payouts. That is a Stripe Connect account question in `swellyoNative`,
  and it is the thing that would actually force all of the above.

---

## 10. Order of work, when the day comes

1. Decide the payout first — does the Israeli operator get shekels? If not, none of
   this is needed and the answer is still §2.
2. Database migration in `swellyoNative`: currency, rate, rate-taken-at, provider.
   **Together, in one migration, before any non-USD row exists** (§4, §6).
3. `src/domain/money.ts` and its tests. Make `sumPaidUsd` refuse mixed currencies (§8)
   before anything can produce them.
4. Services, then UI, then the rename. In that order, so the tests are meaningful the
   whole way.

Days, not weeks — as long as steps 2 and 3 happen in that order. The cost of doing them
out of order is not measured in days.

---

## 11. Related

- `docs/superpowers/specs/2026-08-04-operator-dashboard-money-design.md` — the money
  rules themselves, and §4 there for the three-flag livemode problem.
- `docs/SPEC.md` §6 "Money state" — the ported-rule debt this would touch.
- `swellyoNative/docs/superpowers/specs/2026-08-03-stripe-payments-operator-trips-design.md`
  — the payment system's own source of truth. Any currency work starts there, not here.
