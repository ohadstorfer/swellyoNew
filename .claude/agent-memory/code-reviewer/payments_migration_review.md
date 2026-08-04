---
name: payments-migration-review
description: Review of task 1 of the Stripe-payments-for-operator-trips plan (migration 20260803000000) — what was wrong and why, so the same holes get checked in tasks 2+.
metadata:
  type: project
---

Reviewed 2026-08-03, commit `7360a62`, migration
`supabase/migrations/20260803000000_operator_trip_payments.sql` (unapplied at review time).
The implementer transcribed the brief's SQL byte-for-byte; the defects below are in the
**brief**, so they will recur in later tasks unless the brief is amended.

Findings that must be closed before money moves:
1. `group_trip_participants.price_total_usd` / `deposit_usd` are client-writable
   (see [[supabase-grant-gotchas]]), and `freeze_traveler_price()` deliberately yields to
   any value the client supplies and only fires `before insert`. A traveler can PATCH their
   own row to 0 and `operator_requirement_pay_state` returns `approved`.
2. `users.commission_bps` / `stripe_charges_enabled` / `stripe_account_id` are self-writable
   and world-readable for the same reason. Recommended fix: move them to a dedicated
   `operator_payout_accounts` table rather than patching grants on `public.users`.
3. `sum(amount_usd)` in the pay-state counts `event_type = 'failed'` rows, and nothing ties
   the sign of `amount_usd` to the event type.
4. Idempotency is `unique (provider, provider_event_id)` only — that stops a redelivery of the
   *same* Stripe event, not two different event types describing one payment. The webhook
   (task 2) must key on `provider_object_id` too.
5. Ledger `trip_id`/`user_id` cascade-delete, so deleting a trip or an account erases payment
   history — inconsistent with the `on delete set null` reasoning applied to `requirement_id`.

Status after reviewing tasks 4–6 (edge functions, 2026-08-03, `9894003..51e8e06`):
1 CLOSED (`freeze_traveler_price()` now authoritative), 2 CLOSED (`operator_payout_accounts`,
service-role write only; both edge fns read the renamed `charges_enabled` correctly),
3 CLOSED (sign CHECK + pay-state excludes `failed`), 4 CLOSED in the DB
(`uq_otpe_object`) but the webhook swallows **every** 23505 as "redelivery", so a second
partial refund — `charge.refunded` carries a *cumulative* `amount_refunded` — collides on
that index and is silently dropped. 5 still open (ledger `trip_id`/`user_id` cascade).
Two ledger columns the migration added are never written by the webhook: `is_livemode`
(so live money records as test) and `application_fee_usd` (checkout computes the commission
and discards it).

Re-review of fix round 1 (`7360a62..d765a02`, migration still UNAPPLIED): all of C1–C3 and
I1/I2/I4/I6 are genuinely closed in the SQL. Three things the fix round left or introduced:
- `greatest(..., 0)` on the `balance` branch of `operator_traveler_amount_due` collapses a
  NULL price to 0 (see [[pg-greatest-ignores-null]]), so pay state reads `approved` for a
  managed trip with null `cost_per_person` and a traveler with no frozen price — a free pass
  through a must_have pay requirement. `tripPaymentsService.amountDue()` guards the null
  correctly; the SQL is the outlier.
- That floor never fixed the original I5 auto-approval either: `0 >= 0` is still `approved`.
  Only the `group_trips_deposit_not_over_price` CHECK does real work.
- RLS on `group_trip_participants` still has no policy letting a host UPDATE another
  traveler's row. The freeze trigger permits host writes, but the host cannot reach the row
  from the client — the "operator edits a traveler's price" task needs a SECURITY DEFINER RPC.

Task 7 (client wiring, `2025486`) closed the RLS gap noted just above with a SECURITY DEFINER
RPC `operator_set_traveler_price` (`20260803000100`) instead of the brief's host UPDATE policy —
verified correct: `is_trip_host` check raises, 0-rows raises, deposit>total raises, search_path
pinned, `revoke from public, anon` + grant to authenticated, and the write genuinely survives
`freeze_traveler_price()` (auth.uid() still resolves to the host inside a definer function, so
the trigger's host branch returns `new` untouched). Remaining hole: a NULL `p_total_usd` passes
both guards and both table CHECKs, leaving deposit-without-total = a permanently unsatisfiable
`balance` requirement. Client side, `startCheckout`'s `'paid'` result is unreachable (no app link
for swellyo.com) and would be wrong if it ever fired, because `payments-checkout` sets
`success_url === cancel_url`.

Re-review of fix round 2 (`e045fbf`, migration still UNAPPLIED): the `greatest` regression and
I5 are both genuinely closed. `operator_traveler_amount_due`'s balance branch is now
`price is null -> null; (price - coalesce(deposit,0)) < 0 -> null; else the difference`, so the
boundary is right (exactly 0 still returns 0 -> approved) and the subtraction can never be NULL
(the coalesce-to-0 makes the comparison total). No `greatest` floor survives anywhere in
`supabase/migrations`. Consumers agree: `payments-checkout` does `Number(dueRaw ?? 0)` and
refuses `due <= 0`, and `tripPaymentsService.amountDue()` mirrors the same three rules.

The verification script `supabase/migrations/verify_20260803000000_operator_trip_payments.sql`
duplicates all of the migration DDL by hand — re-verified byte-identical after round 2 with
comments stripped. Any migration fix must be mirrored there or the next verification run
silently tests stale SQL.

Test-quality gotcha in that verify script: **most of its rows are print-only**, i.e.
`value := v_state` with the expectation only in the `step` text. They cannot emit `FAIL`, so
the report's stated pass criterion ("no FAIL: value anywhere") is blind to them — including
`'CRIT: pay state ... (expect not_started)'`, the one row that covers
`operator_requirement_pay_state`'s own `amount is null -> not_started` guard. Only the rows
written as `if <cond> then 'OK' else 'FAIL' end if` are real assertions. Check this shape
before believing an "all N assertions passed" claim on this file.

Edge-function fix round 1 (`6b02dfd`/`7f22d3d`/`9e47d0c`, 2026-08-03): C1 (secret fail-open),
C2 (`event.account`), I3 (multi-`v1` rotation), I5, I6, I7, I8 and all the minors are genuinely
closed; `on_behalf_of` was correctly NOT added. **I4 is only half closed and it is the one that
still loses money:** the webhook now computes a correct refund *delta*, but `uq_otpe_object` is
`(provider, provider_object_id, event_type)`, so the delta row for a second partial refund has
exactly the same key as the first refund row and can never be inserted. It now `throw`s, 23505 is
deliberately absent from `PERMANENT_PG_ERROR_CODES`, so Stripe 500-retries for ~3 days and the
refund is still never recorded. The migration and the webhook contradict each other — fixing it
needs an SQL change (scope `uq_otpe_object` to `event_type = 'paid'`, or add `provider_event_id`
for refunds); the delta logic already makes that index redundant for refunds. Two riders: once
multiple refunded rows are allowed, compute the delta in integer cents (summing `k/100` doubles
yields ~1e-17 positive residues that would insert junk rows and re-enter the 500 loop), and the
`priorRefunds` select currently discards its `error`, which on a transient read failure would
double-record the full cumulative refund.

Edge-function fix round 3 (`2df37f0` stripe-webhook / `26420a8` payments-checkout, 2026-08-03):
the round-3 critical (a Stripe 404 classified as permanent could 200-ack a real payment whose
only failure was the optional `application_fee_usd` enrichment lookup) and I1/I2/I3 are all
genuinely closed. Durable things learned, which the *next* round should not re-litigate:
- **`payments-checkout` has no durable record of the sessions it minted.** Dedup, price-freshness
  enforcement and now the idempotency-key discriminator are all derived from a live
  `GET /checkout/sessions?status=open&limit=100` (platform-wide, not per user). Every residual
  hole in this function traces back to that one missing store: a session past page 1 is invisible,
  and a session that was expired but whose replacement failed to mint leaves the key reverting to
  the byte-identical value that produced the now-dead session. The escalated
  `operator_checkout_sessions` table keyed on `(user_id, requirement_id)` is the fix for ALL of
  them, not just the `limit=100` cliff — that is the strongest argument for the deploy gate.
- Stripe's `Idempotency-Key` is capped at 255 chars. The round-3 key folds in comma-joined
  `cs_…` session ids (~66 chars each) on top of a ~90-char base, so three-plus stale sessions
  overflow it and hard-fail checkout. Any future discriminator should be a hash, not a join.
- `refund_application_fee` defaults to **false** and, when true on a partial refund, Stripe
  reverses the fee *proportionally*. So a missing `application_fee_usd` on refund rows does NOT
  overstate revenue on ordinary refunds — round 2's report claim was wrong and round 3's
  correction is accurate. Don't re-raise it as a defect.

Edge-function fix round 4 (`ad5e8ee`, both files in ONE commit, 2026-08-03): both Importants
genuinely closed in `payments-checkout`. The partition (`freshMatch` + `staleMatches =
matches.filter(s => s.id !== freshMatch?.id)`, expire loop, THEN `if (freshMatch) return`) is
correct and the fail-closed 500 survived — the only path to the create call requires every stale
session to have expired or re-fetched as `status === 'expired'`; `'complete'` and an unreadable
re-fetch both 500. The bounded key `:after=<count>:<newest id>` holds for arbitrary N (count is
capped at 100 by `limit=100`, so worst case ≈ 207 < 255). Two durable notes for round 5:
- The partition made an unexpirable stale session block a *fresh* session's URL with a 500 where
  round 3 would have returned it. That is deliberate and right (a stale session that just
  COMPLETED invalidates the fresh amount), not a regression — don't re-raise it.
- The `stripeGet(path, label)` redaction in `stripe-webhook` was applied only to the
  `checkout.session.completed` enrichment call. The sibling `payment_intents/${c.payment_intent}`
  fetch in the `charge.refunded` branch still throws with the raw id and is uncaught, so the
  outer `console.error('[stripe-webhook]', safeMessage(e))` reproduces exactly the identifier the
  round was closing. One-line fix, low urgency only because nothing issues refunds yet.

WHOLE-BRANCH REVIEW (`4ca5045..ecd59e7`, all 11 tasks, 2026-08-03). Three Criticals, all
cross-task, none of which any single-task review could have seen:
- **Onboarding deadlock.** `stripe-connect-onboard` refuses `action:'onboard'` unless the
  caller already hosts a `hosting_style='C'` trip (its I8 abuse guard), but
  `ConnectStripeCard` is rendered inside the CREATE wizard's budget step, before the trip
  exists, and `validateStep` hard-blocks publish on `!stripeReady`. A first-time operator
  can never turn managed payments on. Edit mode cannot turn them on either.
- **Deposit with no deposit ROW.** The wizard creates a `deposit` requirement only when the
  amount is > 0 (`payKinds` in CreateTripFlowA); `TravelerPriceSheet` shows a Deposit input
  unconditionally. Setting one on a single-payment trip subtracts it from the only payable
  row (`balance = price - coalesce(deposit,0)`) with no row to collect it. Silent shortfall.
  `ManageRequirementsSheet` already gates its Deposit card on a real ACTIVE row — the price
  sheet is the outlier.
- **Co-host price bypass** — see [[is-trip-host-vs-host-id-split]].
Also worth remembering: `removeRequirement()` decides delete-vs-deactivate from documents
and acknowledgements ONLY; it has no idea the ledger exists, and a pay row always has 0 docs
and 0 acks. The only thing stopping a hard delete (which SET NULLs the ledger and makes the
traveler pay twice) is a guard in the CALLER, `saveRequirementChanges`.
`REQUIREMENT_ORDER` gained deposit/balance at indices 0 and 1, shifting every document kind
by 2 — `sort_order` on rows added to pre-existing trips no longer lines up with rows created
before this branch (cosmetic).

**Why:** this migration is the whole DB layer for real payments on a prod DB with live users.
**How to apply:** when reviewing later tasks (client service, UI), confirm the amount shown
to a traveler is derived the same way `operator_traveler_amount_due` + the ledger derive it,
and that nothing re-introduces a client-supplied amount. See also
[[edge-fn-secret-fail-open]] for the webhook's auth boundary.

Re-review of task 7 fix round 1 (`d982110`, migrations still UNAPPLIED): all 5 findings
(I1 edge-fn error swallowing, I2 NULL-total guard, M1 negative-deposit guard, M2 unreachable/
unsafe `'paid'` return, M4 missing `.neq('event_type','failed')`) genuinely closed, no new
Critical/Important issues, commit scoped to exactly the 2 intended files. Two things worth
remembering for future `supabase.functions.invoke` error-handling reviews elsewhere in this
repo (see [[functions-invoke-swallows-error-body]]):
- The fix's `(error as any)?.context?.json?.().catch(() => null)` is safe even when
  `error.context` isn't a `Response` (e.g. `FunctionsFetchError.context` is a bare fetch
  error with no `.json` method) — a single optional-chain expression short-circuits the
  *entire* chain including the trailing non-optional `.catch(...)` once any `?.` step hits
  undefined, so it never throws. Don't flag this pattern as a "catch on undefined" risk.
- `error.context` really is the raw `Response` for `FunctionsHttpError`/`FunctionsRelayError`
  per `@supabase/functions-js` — confirmed in `node_modules/@supabase/functions-js/dist/main/FunctionsClient.js`.
  This is the correct, library-endorsed way to recover a server-composed error message that
  `invoke()` otherwise discards.

Re-review of whole-branch fix round 5 (`763aaf1`, both migrations still UNAPPLIED, 2026-08-03)
— **BLOCKED, do not apply.** C1, C2, I1, I2, I3, I4, I6, M3 all genuinely closed. **C3 is not.**
The round moved `operator_set_traveler_price` onto `host_id` and added `price_set_by`/`price_set_at`
exactly as instructed, but the finding survives through two routes the RPC never touches — a
promoted admin's direct PATCH of their own participant row, and seizure of `group_trips.host_id`
itself. Both are written up in [[is-trip-host-vs-host-id-split]]. The verify script grew 12 real
assertions but none of them PATCH a participant row *as a host*, which is why the round read clean.
Durable notes:
- The verify script now also carries `20260803000100`'s DDL. Two hand-maintained copies to keep
  in sync, not one.
- The report's "jest 54/55 → 88/89" is not this commit's doing — the new tests came from
  `d3e5594`/`ab3c5bf` (`tripValidation.test.ts`). Round 5 added zero tests for its own nine fixes.
- `app.stripe_livemode` defaulting to `false` is a hard go-live gate, not a nicety: with a live
  key installed and the GUC unflipped, `payments-checkout` (which reads the key prefix) and
  `operator_requirement_pay_state` (which reads the GUC) disagree, and a paid traveler is stuck
  between a `not_started` requirement and an "Already paid" 400.

Re-review of round 6 (`3a3fbbe`, both migrations still UNAPPLIED, 2026-08-03) — **still BLOCKED.**
C3 route 1 genuinely closed (`freeze_traveler_price` now authorises on `group_trips.host_id`; the
RPC's own write, the creator's first participant INSERT and the service role all still land on the
trusted branch — verified). I1/I2/I4 closed, 13 real tests added, jest 101/102 reproduced locally
(the failure is `tripInvitesService`, untouched, fails inside its own mock).
**C3 route 2 is closed only for the direct `PATCH group_trips {host_id}`.** The
`pg_trigger_depth() <= 1` escape on `guard_primary_trip_host` whitelists exactly the path the
attacker actually has — see trap 3 in [[is-trip-host-vs-host-id-split]]. Do not accept a
`guard_primary_trip_host`-only fix for this finding again.
Two reporting notes: the round-6 report's "tsc → 175, unchanged" is wrong (the tree is 179; the
4 extra are `OperatorTripEditScreen.tsx` from sibling commits `3eab621`/`50cb1a0`, not from the
fix). And the verify script's `v_host` is still `select user_id ... where role='host' limit 1`,
unordered — it only coincides with `host_id` by luck of the current data, so the "C1: host PATCH
sticks" assertion would flip to FAIL the day the chosen `hosting_style='C'` trip gains an admin.

Round 7 (`c4f1fc2`, still UNAPPLIED, 2026-08-03) — §11 `protect_trip_owner_membership` closes
C3 route 2 properly. Durable facts established while tracing it, so they don't get re-derived:
- **Trigger fire order on `group_trip_participants` is alphabetical:**
  `trg_enforce_min_one_trip_host` BEFORE `trg_protect_trip_owner_membership`. On the common
  single-host trip, an attempt to remove the owner therefore raises *"A trip must have at least
  one host"* (check_violation), not the owner-guard's insufficient_privilege. Any assertion that
  only catches `when others` cannot tell the two apart.
- **`group_trips` DELETE policy is `using (is_trip_host(id))`** — every promoted admin, not the
  owner — and `organized_trip_payment_events.trip_id` is `on delete cascade`. Deleting a trip
  erases its whole payment ledger. This is inert today ONLY because `enforce_min_one_trip_host`
  has no cascade exemption, so trip deletion always raises. §12 "fixes" that and thereby arms it.
  Do not let a `enforce_min_one_trip_host` cascade exemption ship without narrowing that policy.
- **`guard_primary_trip_host` still permits the OWNER to PATCH `host_id` to any current host at
  depth 1** ("only the current organiser can hand over a trip"). That is a live, UI-less,
  unnotified ownership transfer that contradicts §11's comment "there is no ownership-transfer
  feature today". Not an escalation (needs the owner's own session) but it is the last remaining
  client path by which payouts change Stripe account.
- **`group_trips.host_id` is `references auth.users(id) on delete cascade`**, so deleting an
  operator's account deletes their trips outright. The "sole host of a *surviving* trip" case the
  round-7 report leaves open is probably unreachable as described; what actually decides it is
  whether the `group_trips` RI cascade fires before the `group_trip_participants` one (constraint
  OID order — favourable today, asserted nowhere).
- `handleRemoveParticipant` in `TripDetailScreen.tsx` (~line 987) is **dead** — defined, never
  rendered. `TripMembersScreen` → `TripMemberSheet` is the only live remove/demote UI.
