# Web dashboard parity — late work, removals, and a refused Stripe account

**Status:** spec + build, 2026-08-19.
**Scope:** `operator-dashboard/` only. Rule 1 of `operator-dashboard/docs/SPEC.md`
still holds — **nothing here adds anything to the database.** Every read below is
already permitted, every write already happens from the app, and the two edge
functions called here are already deployed.

## Why

The in-app Dashboard tab (`TripDashboardTab`) and this site are meant to agree.
An audit on 19 August found three places where they do not, and each one costs
the operator something real:

1. **Nothing on the web says what is late.** No countdown, no "2 documents
   late", nothing per requirement. Deadlines are the reason the product exists,
   and a web-only operator cannot answer "who is behind?" without opening each
   requirement page in turn.
2. **A traveler cannot be removed on the web.** It is the one destructive,
   money-touching action, and it is the one the operator most wants a keyboard
   for. Today they have to pick up their phone.
3. **A Stripe account Stripe REFUSED reads as "Not finished".** The operator is
   told to go and complete a form that will never help. Nobody can pay for their
   trips meanwhile, and no screen on this site says so.

Not in scope, deliberately: "Remind N people" (Ohad, 19 Aug — the RPC exists and
the app has it; the web can wait), messaging, sort-by-urgency.

---

## 1. What is late

### The rule

`RequirementState` already has `'overdue'` and this site already computes it
(`deriveState`). **Counting `state === 'overdue'` is the trap**, not the answer:
`'overdue'` means the traveler sent NOTHING and the date passed. Someone who
sent a blurry passport, had it rejected, and never sent another reads
`'rejected'` for ever — and that is the person most likely to miss the flight.

```
isLate(item) = state === 'overdue' || (state === 'rejected' && dueDate && dueDate < today)
```

Byte-for-byte the app's `dashboardWork.isLate`. Lives in a new
`src/domain/late.ts` with unit tests, because it is read from three places on
one page and they must not drift.

`pay` rows can never be late: `fetchTripReview` hardcodes them to
`not_started` (it does not load the ledger). Unchanged here — money deadlines
are decision D3 in `dashboard-tab-ux.md` and still open.

### Where it shows

| Surface | Copy |
|---|---|
| Trip page, under the header | `12 days to go · 2 documents late` / `· nothing late` |
| Trip page, ended trip | `Trip ended` — the count stops being work and becomes a reproach |
| Trip page, no start date | the countdown is dropped, the late count stays |
| Each requirement row | `7/15 in · 5/15 approved · 2 late` |
| Each traveler row | a `2 late` tag, left of the existing `N waiting` tag |

**Nothing renders while the review query is loading.** A line that says "nothing
late" and flips to "2 late" a second later is worse than a beat of nothing: the
operator reads the first one and relaxes. Same rule the app follows.

`tripPhase()` is ported too — it parses `YYYY-MM-DD` as a LOCAL date, because
`new Date('2026-08-19')` is UTC midnight and reads as the previous evening for
anyone west of Greenwich.

---

## 2. Removing a traveler

The web twin of `RemoveTravelerSheet`. Same order, same gates, same copy.

### The order is refund, then remove

The operator decides the money while looking at the person. Reversing it means
hunting for someone who is no longer on the roster. But **a refund that fails
must not trap them**: if Stripe is short, the dialog says so and still offers
"Remove anyway", carrying whatever partly succeeded into the removal.

### Why it asks, when cancelling does not

Cancelling a trip has one possible reason, so it refunds everyone in full and
offers no choice. Removing one person has several — they backed out (the frozen
policy governs), the operator cleared a spot (owe it all back), they never
finished their documents (a judgement call). Nothing can tell those apart, so
the dialog asks for the AMOUNT, which is the only part of the reason with
consequences, and pre-computes the policy's answer.

Three options: **Everything** (`paidUsd`), **What the policy gives**
(`suggestedRefundUsd`), **Something else** (typed, 0 ≤ x ≤ paidUsd).

⚠️ **`null` must never collapse to 0.** `refundPctFor` returns null when the trip
never stated terms — every trip published before the policy columns. Suggesting
`$0, per the policy` there invents a term. Null suppresses the policy option and
"Everything" leads instead. The option is also hidden at 100%, where it would
show the same number twice.

### Gates

| Who | What happens |
|---|---|
| No `travelers.remove` | No button at all |
| `travelers.remove`, traveler paid **$0** | Straight confirm, no money step |
| `travelers.remove` without `money.manage`, traveler **has paid** | The dialog refuses and names who can: only the operator of record can remove someone who paid, because only they can refund |
| Operator of record | The full three-option dialog |

Both halves are enforced server-side already — the participant DELETE policy is
`trip_staff_can(trip_id, 'travelers.remove')`, and `trip-cancel` requires
`money.manage` for its single-traveler mode. The UI only explains it.

### The calls

1. `trip-cancel` with `{ tripId, userId, amountUsd }` — single-traveler mode,
   spreads the amount across their payments newest-first. Skipped entirely at
   `amountUsd = 0`: no rows, no Stripe, no audit noise.
2. `DELETE group_trip_participants` — the awaited one. This is what makes them
   leave.
3. Best effort, after, never blocking the UI, exactly as the app does it:
   the `X removed Y` system message in the group chat, the
   `group_trip_join_requests` row (so they can ask again later), their
   `conversation_members` row, and `send-trip-removed-notification` carrying
   `refund_usd`.

⚠️ **`refund_usd` is omitted, never zeroed.** `$0.00 is being refunded` is worse
than silence, and the renderer treats absent as "say nothing about money".

⚠️ The figure that goes into the push is what **actually** went back — the sum of
the refunds that succeeded — not what was asked for.

⚠️ `conversation_members` DELETE is permitted to the conversation's creator, who
is the operator on their own trips. A Manager's attempt fails; it is
fire-and-forget on both sides, and the app has the same limit.

---

## 3. A Stripe account that was refused

Today this site reads three booleans and shows four states. Stripe has six, and
the missing one is the one that matters: **rejected**.

`src/domain/connect.ts` is the hand-kept twin of the app's
`src/services/trips/connectStatus.ts` — same order, same `UNRECOVERABLE_REASONS`
set, unit tested here as it is there.

⚠️ **`disabled_reason` is NOT a rejection flag.** Stripe reuses it for
`under_review`, `pending_verification` and `past_due` — ordinary stages. Only
`rejected.*`, `platform_paused` and `listed` are unrecoverable. A naive
`disabledReason != null` tells an operator whose paperwork is merely being read
that they were refused.

⚠️ **`action_needed` is gated on `charges_enabled` already being true.** A failed
SSN match leaves `past_due` on an account that was never live; ranking `past_due`
above the charges check would put it in a state that permits selling.

### Where it shows

- **Settings → Payments** gains the `blocked` state: *"Stripe could not approve
  this account"*, and the same six-state rule now decides all the others.
- **The trip page** gains the app's banner: on a `managed` trip whose operator
  cannot yet take charges, *"Travelers can't pay yet"* / *"Stripe is still
  checking your details"* / *"Stripe turned down your payout account"*.
  Silent on `not_started` (we do not yet know) and on offline trips (no Stripe
  account to wait on).

Only the operator of record sees it: `operator_payout_accounts` is readable by
its owner alone (`opa_read_own`), which is correct — a Manager cannot fix
somebody else's Stripe account and should not be told about it.

New columns read (all live since 2026-08-05, kept fresh by the Connect webhook
and the daily sweep): `requirements_due`, `requirements_past_due`,
`disabled_reason`.
