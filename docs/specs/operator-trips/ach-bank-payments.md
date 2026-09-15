# ACH bank payments for US travelers

**Status:** LIVE 27 Aug 2026 (server + client). Migrations applied:
`ach_processing_event_type`, `operator_payment_landed_enum`,
`operator_payment_landed`. Deployed: stripe-connect-onboard v15,
payments-checkout **v21**, stripe-webhook **v13**, dispatch-notification-queue v27.
Stripe sandbox: async_payment events subscribed, ACH capability on the one
connected account. Nothing committed.
**Scope:** US travelers paying USD trips from a US checking account. No
currency work, no EU rails.

## Why

Stripe caps ACH Direct Debit at **$5.00** (0.8%, `$5` cap — verified on
stripe.com/pricing, 26 Aug 2026). Cards are 2.9% + $0.30, uncapped. Above about
$625 the bank rail is always cheaper, and the gap grows with the price:

| Trip | Card | ACH | Saved |
|---|---|---|---|
| $2,000 | $58.30 | $5.00 | $53.30 |
| $6,250 | $181.55 | $5.00 | $176.55 |

Operator trips are all above $625, so this is not an edge case — it is every
booking.

## The one thing that makes this non-trivial

**ACH is not instant.** The traveler finishes Checkout and the money arrives
up to 4 business days later. Stripe models this as three separate events:

```
checkout.session.completed          payment_status='processing'   (day 0)
checkout.session.async_payment_succeeded                          (day ~3)
   or
checkout.session.async_payment_failed                             (day ~3)
```

Before this change the webhook handled **only the first**, and correctly
refused to write a row for it (`payment_status !== 'paid'` → early return).
The other two were not handled anywhere in the repo. So the failure mode was:

> Traveler pays. Money arrives three days later. Nobody notices. They are
> marked unpaid forever.

Money is never lost — it fails safe — but the payment is never recorded.

Second problem: with nothing recorded, the client's existing doubt flow
(`PaymentStatusSheet`) escalates from `pending` to `unconfirmed` after 30
minutes and offers **"Pay anyway"**. For a card that is right. For a bank
payment still in flight it invites a **double payment**.

## Design

Three moving parts. The organising idea: a bank payment in flight becomes a
**visible row** rather than an absence.

### 1. A `processing` event type, pinned to zero

`organized_trip_payment_events` gains `'processing'` alongside
`paid | refunded | failed | disputed | dispute_lost`.

**`amount_usd` is pinned to exactly 0** by the same CHECK that already pins
`failed` rows. This is the whole safety argument:

- every money sum in the system is `sum(amount_usd)` with an exclusion list;
- a row worth 0 cannot move any of them, whether it is excluded or not;
- so `operator_requirement_pay_state()` **is not touched** — no risk of
  clobbering the live drift documented in
  `reference_db_functions_repo_drifts_from_live`.

The row exists to answer "is a bank payment in flight?", not to carry money.

### 2. Webhook: three new branches

| Event | `payment_status` | Writes | Notifies |
|---|---|---|---|
| `checkout.session.completed` | `paid` | `paid` row (unchanged) | — |
| `checkout.session.completed` | `processing` | **`processing` row** | — |
| `checkout.session.completed` | anything else | nothing (unchanged) | — |
| `checkout.session.async_payment_succeeded` | — | **`paid` row** | — |
| `checkout.session.async_payment_failed` | — | **`failed` row** | `notifyPaymentStuck` |

The `paid` row written from `async_payment_succeeded` is byte-identical in
shape to the one written from `completed` — same builder, same enrichment,
same `provider_object_id` (the PaymentIntent). `uq_otpe_object` is scoped to
`event_type = 'paid'`, so the `processing` row from day 0 and the `paid` row
from day 3 coexist without colliding.

Redelivery safety is unchanged: `uq_otpe_provider_event` keys on the *event*
id, and these are three different events.

### 3. Checkout: refuse a second session while one is clearing

`payments-checkout` gains a guard before minting a session: if a `processing`
row exists for this traveler+requirement with no matching `paid`/`failed` row
for the same PaymentIntent, refuse with

> "Your bank payment is still on its way. Bank payments take about 3 business
> days. We'll update this as soon as it lands."

This is the actual protection against double payment. The client sheet copy is
a courtesy; this is the enforcement, and it lives on the server because the
client is never the authority on what may be charged.

## Files

| File | Change |
|---|---|
| `supabase/migrations/20260827000000_ach_processing_event_type.sql` | new — extend two CHECKs |
| `supabase/functions/stripe-webhook/index.ts` | 3 branches, shared row builder |
| `supabase/functions/payments-checkout/index.ts` | enable `us_bank_account`; in-flight guard; bump idempotency namespace |
| `supabase/functions/stripe-connect-onboard/index.ts` | request `us_bank_account_ach_payments` |
| `src/services/trips/tripPaymentsService.ts` | exclude `processing` from the paid mirror |
| `supabase/functions/payments-checkout/inflight.ts` | new — the guard, extracted so it is testable |
| `supabase/functions/payments-checkout/__tests__/inflight.test.ts` | new — 12 cases, jest-style so `npx jest` actually runs it |
| `operator-dashboard/src/routes/MoneyPage.tsx` | render `processing` as a marker, not "Payment $0.00" |
| `operator-dashboard/src/routes/TravelerPage.tsx` | same |
| `src/components/trips/dashboard/TravelerExtras.tsx` | same |

## Verification done

- 12 guard cases pass, including the two that matter most: a bounce unblocks
  (or the requirement is unpayable forever) and a stale marker expires at 10
  days (or a lost webhook locks it forever).
- 79 payment tests pass in total; no new `tsc` errors in any touched file; all
  three edge functions parse.
- **Not tested end-to-end.** No ACH payment has been put through Stripe test
  mode. The three webhook branches are reasoned, not observed.

## Open items — must be settled before this goes live

1. **Connected-account capability — VERIFIED REQUIRED, backfill mandatory.**
   docs.stripe.com/connect/account-capabilities, verbatim: *"To enable
   connected accounts to accept a payment method for direct charges or
   charges with `on_behalf_of`, you must request that payment method's
   capability for those accounts."* Express: *"you must request payment
   method capabilities for them."* New accounts now request it at creation.
   **Every operator onboarded before 27 Aug 2026 lacks it** and needs, per
   account:

   ```
   POST /v1/accounts/{acct_id}
     capabilities[us_bank_account_ach_payments][requested]=true
   ```

   Not automated — it touches live connected accounts and should be run
   deliberately against a known list. Without it, a US traveler choosing
   the bank option on that operator's trip gets a declined payment.

2. **Dashboard switch.** ACH must also be enabled in the Stripe Dashboard
   under Payment methods. `payment_method_types` is now set explicitly, which
   overrides dynamic payment methods, so this may be redundant — verify.

3. **Microdeposit path — CLOSED 27 Aug.** The first real test hit it: manual
   entry → "One more step" → Checkout completed with a `payment_status` the
   webhook silently dropped → `async_payment_failed` 20 s later (a $200
   "Final payment" attempt, correctly left as `failed`). Two fixes, both
   live: `payments-checkout` v21 sends
   `payment_method_options[us_bank_account][verification_method]=instant`
   (+ `financial_connections[permissions][0]=payment_method`), so the manual
   link no longer appears and a traveler without bank login pays by card;
   `stripe-webhook` v13 logs status + event id instead of dropping silently.
   Idempotency namespace bumped m5 → m6 (request shape changed).
   Traveler-facing illustration: `docs/specs/operator-trips/ach-traveler-flow.html`.

4. **Cancelling a trip while an ACH payment is clearing — MITIGATED 27 Aug
   (webhook v14).** `trip-cancel` refunds `paid` rows only, so a payment that
   clears AFTER the cancel still lands unrefunded. The webhook now notices:
   on `async_payment_succeeded` for a cancelled trip, instead of silence it
   sends the OPERATOR (`host_id`) an `operator_payment_landed` notification
   flagged `on_cancelled_trip: true` — both renderers switch the copy to
   "A $X bank payment landed on a cancelled trip — refund it from the
   traveler's Money card." Deliberately NOT an auto-refund: refunds on an
   operator-cancelled trip are the operator's decision (see
   refunds-and-merchant-of-record.md), and their refund button is one tap.

5. **The 30-minute `unconfirmed` window** in `TripDetailScreen` is unchanged.
   With the server-side guard in place a second payment is refused, so the
   worst case is a confusing message rather than a double charge. Improving
   the copy is deliberately out of scope for this pass.


## Client — the traveler's three days (added 27 Aug, same day)

The server side above was right; the client told the traveler three wrong
things, because every screen was written for a card that confirms on the spot.
Fixed by one idea: **the client reads the `processing` row instead of
guessing.** `fetchInFlightByRequirement` → `resolveInFlight` (pure, tested,
mirrors `inflight.ts` including the 10-day bound — the two MUST agree).

| Moment | Was | Now |
|---|---|---|
| Back from Checkout | amber "usually takes a few seconds… message your organiser" | `clearing` sheet: "$1,000 is on its way · up to 4 business days · we'll message you · don't pay again" — primary button is **Got it** |
| The row, up to 4 days | "Processing" for 30 min, then **Pay** | "On its way" (quiet text) + "Bank transfer · up to 4 business days"; tap → the sheet |
| Pay now card | "Processing…" then Pay now | "On its way", routes to the sheet |
| Tap Pay again | "Pay anyway" → server refuses → RED "couldn't start… nothing was charged" | never reaches the gate — row/card route to the sheet first |
| Bounce (day 3) | reason `card_declined` | reason `bank_returned`; bell: "Your bank returned the payment… pay again, by card if that's easier" |
| Lands (day 3) | silence | **new type `operator_payment_landed`**, priority 1, push + bell: "Your $1,000 deposit arrived 🎉", opens the Plan tab |
| Onboarding deposit step | "usually takes a moment" | same clearing copy with amount and timescale |

Files: `tripPaymentsService.ts` (resolver + fetch), `PaymentStatusSheet.tsx`
(`clearing` mode), `PlanSections.tsx` (`bankClearing` row + card state),
`TripDetailScreen.tsx` (cache, routing, poll fallback), `TravelerOnboardingScreen.tsx`,
`notificationsService.ts` (type, bell copy, focus), `stripe-webhook`
(`bank_returned`, `notifyPaymentLanded`), `dispatch-notification-queue/render.ts`.
Tests: `resolveInFlight.test.ts` (10). 173 tests pass across the affected suites.

`operator_payment_landed` has NO template row on purpose — `fill()` knows no
`{amount}`; a row would win over the renderer and print the placeholder.


## Timing and two ACH limits (Stripe's ACH page, read 27 Aug)

- **Settlement:** standard **T+4** (4 business days, cutoff 21:00 ET). **T+2**
  exists for eligible US accounts; on Connect with Express + destination
  charges *the platform controls the settlement speed* — one Dashboard toggle
  covers every operator. Copy now says "up to 4 business days" everywhere.
- **Full refunds only — GUARDED 27 Aug (payments-refund v5).** ACH:
  "✗ Partial refunds, ✓ Full refunds", up to 3 business days, cannot be
  cancelled. `payments-refund` now refuses a partial when the charge's
  payment method is `us_bank_account`, BEFORE the pending row exists, with a
  message naming the rule and the workaround (refund everything and collect
  the difference again). A successful ACH refund returns `bankRefund: true`;
  both refund UIs (`RefundSheet.tsx` alert, `RefundDialog.tsx` done-state)
  then tell the operator: ~3 business days, arrives as an UNLABELED credit,
  give the traveler a heads-up — which is Stripe's own recommendation.
- **Disputes are final.** 60 days to file, no appeal. Stripe auto-refunds the
  application fee to the platform when an ACH destination charge fails.
