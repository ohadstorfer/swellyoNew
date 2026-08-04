# Money in the Operator Dashboard — Design

Add the money section to the operator dashboard, now that Stripe payments are live.

**Status:** design, 4 August 2026. Approved by Ohad. Nothing built yet.

---

## 1. Why now

`docs/SPEC.md` §4.2 says:

> **Money** — **not built.** The payment ledger does not exist in the database. The tile is hidden, not shown as zero.

That is no longer true. On 4 August 2026 the Stripe Connect build landed: three migrations applied to production, three edge functions deployed, and one real test payment recorded end to end. The ledger exists. The tile can be built.

Source of truth for the payment system itself:
`swellyoNative/docs/superpowers/specs/2026-08-03-stripe-payments-operator-trips-design.md`.

---

## 2. What the database gives us

Checked against production on 4 August 2026.

| What | Where | Can the browser read it? |
|---|---|---|
| Payment events | `organized_trip_payment_events` | **Yes.** RLS is `(user_id = auth.uid()) OR is_trip_host(trip_id)` |
| Each traveler's price | `group_trip_participants.price_total_usd`, `.deposit_usd` | Yes |
| Trip default price | `group_trips.cost_per_person`, `.deposit_amount` | Yes |
| Is the trip taking payments | `group_trips.payment_mode` — `offline` or `managed` | Yes |
| Which steps exist | `organized_trip_requirements_resolved` where `req_type = 'pay'`, kind `deposit` or `balance` | Yes |
| Set one traveler's price | `operator_set_traveler_price(...)` | Yes — granted to `authenticated` |
| Work out what is owed | `operator_traveler_amount_due(...)` | **No** |
| Work out if a step is paid | `operator_requirement_pay_state(...)` | **No** |

**This project still adds nothing to the database.** No new tables, no new functions, no migrations. Rule 1 of `docs/SPEC.md` §2 holds.

### Who can see the money

The ledger's RLS says `is_trip_host(trip_id)`, which means **every host on the trip, including admins promoted with "Set as admin"** — not only the operator of record.

This is accepted, not overlooked. Those same people can already read every passport, medical form and insurance document on this site. Someone trusted with the passports is not being newly trusted by seeing the totals.

Changing a price is different, and stays with the owner alone. See §6.

### The two functions we cannot call

`operator_traveler_amount_due` and `operator_requirement_pay_state` grant EXECUTE to `postgres` and `service_role` only. The browser signs in as `authenticated`, so it cannot call them.

Granting them would not help. Both return a single value for one traveler and one step, so 15 travelers would need 30 round trips to draw one page. The dashboard does the maths itself, from three bulk reads.

That makes this a **fourth copy** of a database rule — the same debt `docs/SPEC.md` §6 already records for requirement state. It is handled the same way: one small pure module, unit tested, with a header comment naming the database function it mirrors.

---

## 3. The money rules, exactly

Copied from the live function bodies, not from memory.

### What a traveler owes

```
price   = participant.price_total_usd ?? trip.cost_per_person
deposit = participant.deposit_usd     ?? trip.deposit_amount

due(deposit) = deposit                       // may be null
due(balance) = null   if price is null
               null   if price - (deposit ?? 0) < 0
               price - (deposit ?? 0)  otherwise
```

`null` means **no price is set for this person**. It is not zero, and it is not free.

### What a traveler has paid

Sum `amount_usd` from `organized_trip_payment_events` for that trip, that user and that requirement, where:

- `event_type <> 'failed'`, and
- `is_livemode` equals the mode we are counting (see §4).

Refunds are stored as negative rows, so the sum handles them with no special case.

### Is a step paid

```
due is null      → "No price set"
paid >= due      → "Paid"
otherwise        → "Unpaid"
```

The database has only these two outcomes, and this site must agree with it. The site may additionally **show** the numbers behind an unpaid step (`$400 of $1,000`), because more detail is not disagreement.

### Two traps that must be in the code

1. **Add money in whole cents, as integers.** `0.1 + 0.2` is not `0.3`. Convert to cents, sum, convert back once at the end.
2. **A Postgres `numeric` can arrive as a string.** Every amount goes through `Number()` before any maths. Without it `1000 + 2000` becomes `"10002000"` and the page shows a plausible, wrong total.

---

## 4. Test payments and real payments

The ledger holds both, split by `is_livemode`. The database decides which one counts through a setting called `app.stripe_livemode`, which reads as **false when unset** — so **today, test payments count as real**.

This is not academic. El Salvador 26 has one $1,000 test payment, and both the app and the database already treat Guy's deposit as paid.

**Rule: this site counts exactly what the database counts.** If it did anything else, the operator would read "$0 collected" for a deposit the traveler was told is settled — one system, two truths.

**How:** an environment variable `VITE_STRIPE_LIVEMODE`, defaulting to `false`, mirroring the database's `coalesce(setting, false)`.

That is now a **third** flag that must flip together with the live Stripe key:

| Flag | Where |
|---|---|
| `app.stripe_livemode` | Database setting |
| `EXPO_PUBLIC_STRIPE_LIVEMODE` | Mobile app |
| `VITE_STRIPE_LIVEMODE` | This site |

Three flags is three chances to forget one, and forgetting is silent. So this site makes it loud:

- **In test mode**, a strip at the top of the money page: *"Test mode — these are sandbox payments."*
- **If the site finds payment rows in the mode it is not counting**, a warning: *"3 payments are hidden. They come from the other Stripe mode — this site's setting may not match the database."*

Add `VITE_STRIPE_LIVEMODE` to `swellyoNative/PRE_BUILD_CHECKLIST.md` beside the other two.

---

## 5. Screens

### 5.1 Trip snapshot — a Money card

Goes where the "no money tile" comment sits today, directly under **Needs review**.

```
Money                                              ›
$1,000 collected of $6,000
1 of 2 paid the deposit · 0 of 2 paid the balance
```

If anyone has no price set, a second line says so plainly: *"1 traveler has no price set."* That is the operator's own backlog, shown the same way the document counts show theirs.

Both numbers count **every traveler on the trip**, including those with no price. Someone with no price is not paid, so counting them as paid — or leaving them out of the total — would make the trip look further along than it is. `$6,000` is likewise the sum of the prices that exist; if one traveler has no price, the expected total is short by one person and the "no price set" line is what explains the gap.

The whole card links to the money page.

### 5.2 New page — `/trips/:id/money`

One row per traveler:

| Traveler | Total | Deposit | Balance | Paid so far | |
|---|---|---|---|---|---|
| Guy | $3,000 | Paid | Unpaid · $2,000 | $1,000 | Set price |
| Maya | No price set | — | — | $0 | Set price |

Below it, a totals line, and then **the payment list** — date, traveler, which step, amount, and refunds shown as negatives.

The raw list is there because operators reconcile against their Stripe dashboard. A single total cannot be checked against anything; rows can.

### 5.3 Traveler page — a Money card

Added to `TravelerPage`, below Documents and above Medical. That person's two steps with the same wording as the money page, their payment history, and the **Set price** button.

---

## 6. Setting a traveler's price

`docs/SPEC.md` §1 says operators "cannot edit the trip" on desktop. This is a deliberate exception, decided by Ohad on 4 August, and it is the **second** one — approve and reject were the first. Everything else Eyal called real management still stays on mobile.

### Who sees the button

**Only the operator of record.** `operator_set_traveler_price` checks `host_id = auth.uid()`, not "any host".

This matters because the two are different. The dashboard finds trips through `group_trip_participants.role = 'host'`, which includes **every admin promoted with "Set as admin"**. Such a person can open this site and see the money, but must not see the price button — otherwise they click it and get a raw server error.

`fetchTrip` must therefore start returning `host_id`.

### What the dialog enforces

The server checks all of these and the dialog mirrors them, so the operator learns before submitting instead of after:

- A total is required. It may not be empty.
- Nothing may be negative.
- The deposit may not be more than the total.
- **The deposit field is hidden when the trip has no deposit step.** A trip created with a blank deposit publishes only a `balance` row. Writing a deposit on such a trip is money that can never be collected: the balance shrinks by the deposit amount, every step reads paid, and the operator is quietly short. The server refuses it; the dialog should not offer it.

### Changing a price after money has arrived

The server does **not** check this, and it should. Until it does, this dialog is the only guard.

| Situation | What happens |
|---|---|
| They have paid nothing | Save. **No confirmation.** |
| They have paid something, and the new total is at or above what they paid | **Confirm**, with the numbers: *"Guy has paid $1,000. He owed $2,000 more; after this he will owe $2,500."* |
| The new total is **below** what they already paid | **Blocked.** The button does not save. |

**Why block rather than warn.** Lowering a total below what someone already paid leaves them overpaid, and this site has no refund. Nothing in the system can resolve that state. Stripe refuses the same move for the same reason: a credit note reduces what is owed "but not below zero" ([Stripe: Edit invoices](https://docs.stripe.com/invoicing/invoice-edits)). Message: *"Guy has already paid $1,000. To charge less than that you need to refund him in Stripe first."*

**Why no popup when nothing is paid.** Confirmations only work while they stay rare. One on every price edit teaches the operator to click through the one that matters.

**Raising a total after full payment stays allowed.** The balance step re-opens and `payments-checkout` charges only the difference. Operators need this — an added week, a room upgrade.

> **Known gap, not fixed here.** `operator_set_traveler_price` accepts any total of zero or more, whatever has been paid. A direct API call still creates the overpaid state this dialog prevents. Fixing it means a migration, and this project adds nothing to the database. Logged for whoever is next in the payments schema.

---

## 7. Trips that are not taking payments

`payment_mode = 'offline'` — the trip has prices but Stripe was never turned on. Almost every trip today is in this state.

The money card and page still appear, showing what each traveler owes, with this instead of collected totals:

> Payments for this trip happen outside Swellyo. Swellyo does not know what has been paid.

No zeros and no progress bar. A zero would read as "nobody paid", which is a claim this site cannot make.

Setting a price still works. The price is real even when the collection is not.

---

## 8. Files

**New**

| File | Holds |
|---|---|
| `src/domain/money.ts` | The rules in §3. Pure functions, no network. |
| `src/domain/money.test.ts` | Vitest, covering §3 and §6 |
| `src/services/payments.ts` | Three reads: pay requirements, payment events, traveler prices |
| `src/routes/MoneyPage.tsx` | `/trips/:id/money` |
| `src/components/TravelerPriceDialog.tsx` | Set price, with the §6 rules |

**Changed**

| File | Change |
|---|---|
| `src/services/trips.ts` | `fetchTrip` also returns `host_id`, `payment_mode`, `cost_per_person`, `deposit_amount` |
| `src/services/actions.ts` | Add `setTravelerPrice` |
| `src/routes/TripPage.tsx` | The Money card replaces the "no ledger" comment |
| `src/routes/TravelerPage.tsx` | Add the Money card |
| `src/App.tsx` | Add the money route |
| `src/lib/format.ts` | Add `formatUsd` |
| `.env.example` | Add `VITE_STRIPE_LIVEMODE` |
| `docs/SPEC.md` | Rewrite §4.2, §7 and §1 (see §10) |

---

## 9. Errors and tests

**Errors** follow the rules already in `docs/SPEC.md` §10: never a raw message, always friendly text through `friendlyError`, a failed read shows what failed with a retry and does not blank the page. The price dialog shows its error inside the dialog and keeps what was typed.

**Tests** are Vitest, on `src/domain/money.ts` only — the same line `docs/SPEC.md` §9 draws. The maths is the only real logic; the rest is rendering.

What the tests must cover:

- `due(deposit)` falls back from the traveler's deposit to the trip's.
- `due(balance)` is null when there is no price, and null when the deposit is larger than the total.
- A missing price gives "No price set", never `$0`.
- `failed` events are excluded from the paid total.
- Events from the other Stripe mode are excluded.
- A refund reduces the paid total.
- Exactly paying the amount owed reads as Paid (`>=`, not `>`).
- Amounts arriving as strings still add up correctly.
- The three price-change cases in §6, including the block.

---

## 10. What this changes in `docs/SPEC.md`

Leaving the old spec in place would leave the site contradicting its own description.

- **§4.2** — money is built. Replace the "not built" paragraph with what §5.1 describes.
- **§7 "Not building"** — remove "The money tile — no ledger exists."
- **§1** — "They cannot edit the trip" gains its second exception: setting a traveler's price, owner only.
- **§8 "Still open"** — item 2, removing a traveler who already paid, can now be answered: the payment rows survive because the ledger is append-only. It is still not a desktop action.
- **§9** — record `VITE_STRIPE_LIVEMODE`.

---

## 11. Not building

- **Refunds.** They are read and displayed. Issuing one happens in the Stripe dashboard.
- **Payout status** — whether Stripe has paid the operator out. It is a different question from "did the traveler pay", it lives on a different Stripe object, and mixing the two on one screen is how people misread their own balance.
- **Charts.** Same rule as the rest of the site: counts and lists.
- **Bulk price setting.** One traveler at a time. Nobody has asked for more.
- **Invoices or receipts.** Stripe already emails them.
