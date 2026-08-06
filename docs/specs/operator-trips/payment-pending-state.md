# Payment pending state — surviving a screen that unmounts

**Status:** ✅ **Phase 1 (Option A) BUILT 2026-08-05, uncommitted.** Phase 2 (Option B) still open.
**Why:** the `pending` row state added on 2026-08-05 exists to stop a traveler paying twice.
It is React state, so it survives exactly as long as `TripDetailScreen` stays mounted — which
is not long enough to do its job.
**Related:** `requirements-model.md` (where pay rows live), `documents-storage.md`,
`.superpowers/sdd/2026-08-03-stripe-payments-operator-trips/progress.md` (the payments ledger).

---

## 1. What exists today, and where it stops

When a traveler comes back from Stripe Checkout, `TripDetailScreen` polls for the webhook for
about 14 seconds. Almost always it lands and the row ticks itself off. When it does not:

| State | Row shows | Tapping it |
|---|---|---|
| `confirming` — polling, ≤14s | "Confirming…" (muted) | nothing — disabled |
| `pending` — poll gave up | "Processing" + "We'll tick this off automatically" | opens `PaymentStatusSheet`, **never a new Checkout** |
| approved | "Done" | — |

`pending` is `pendingRequirementId`, a `useState` in `TripDetailScreen`. It is **lost on
unmount**: navigate to the chat and back, background the app long enough to be killed, or
trigger any remount, and the row falls back to what the server says — `not_started` — which
renders as a plain, tappable **"Pay"**.

> ⚠️ **That is the whole bug this feature was built to prevent, just delayed by one
> navigation.** A traveler who has already sent $2,000 and is shown a "Pay" button will pay
> again. The background poll stops too (its 2-minute timer dies with the component), so nothing
> is watching for the late webhook either.

---

## 2. What "expire" actually means — the part worth getting right

The instinct is to store the pending flag with a TTL and pick a number. That is the wrong
shape, because the question a pending state answers is not *"how long has it been?"* but
**"could this payment still land?"** — and Stripe already knows the answer exactly:

| Stripe session status | Meaning | What the row should say |
|---|---|---|
| `complete` | Paid. The webhook is merely late | **Processing** — it will resolve itself |
| `open` | Not paid yet, still payable | **Processing** — they may still be finishing |
| `expired` | Never paid, can never be paid now | back to **Pay** (with §5's guard) |

So the correct rule is *derive it*, not *time it*. A timer is only the fallback for when we
cannot ask — offline, or before the server-side table in §4 exists.

Two clocks matter, and they are different things:

- **How long we show "Processing"** — bounded, because a webhook that has not arrived in
  minutes is broken rather than slow, and a traveler who genuinely wants to retry must not be
  locked out for a day. **30 minutes** is the recommendation.
- **How long we remember an attempt happened** — much longer, because that memory is what
  gates the retry in §5. **7 days**, comfortably past Stripe's webhook retry window.

Collapsing these two into one number is what makes every simple version of this feature either
nag forever or forget too early.

---

## 3. Option A — device-local — ✅ BUILT 2026-08-05

`src/services/trips/pendingPaymentStore.ts`. One AsyncStorage key per trip holding a map, so
restoring the whole screen is a single `getItem`:

```
swellyo:pendingPayments:<tripId>
  → { [requirementId]: startedAt }        // epoch ms
```

**One timestamp, not two.** The draft of this spec proposed a separate `lastAttemptAt` next to
`startedAt`. They are the same moment — when the poll gave up — asked two different questions,
so the phase is derived from a single number against two thresholds (`attemptPhase`). Two
fields would have been two things to keep in sync for no gain.

- Written when `confirmPayment` gives up, alongside the in-memory state.
- Read on mount and **merged as `{...stored, ...inMemory}`**, so a hydrate that resolves after a
  payment made in the same session cannot clobber the fresher record.
- Cleared when the server says `approved`, or when the traveler takes "Pay anyway".
- Pruned past 7 days on read — the only moment we know someone cares about this trip.
- Every failure path swallows and degrades to `{}`, i.e. to the in-memory behaviour this
  replaced. A storage error must never surface on a screen someone opened to look at their trip.

> ⚠️ **Dropped from the draft: passing Stripe's `session.expires_at` through.** The idea was to
> expire on the real event rather than a guess. It cannot fire: Checkout sessions default to
> **24h**, and the "Processing" window is **30 minutes**, so our clock always wins. Plumbing it
> through would have been dead code. It becomes useful only under §4, where the server can read
> the session's actual *status* rather than just its deadline.

**Trade-off:** device-local. Pay on the phone, open on the web, and the web shows "Pay". Given
that mobile is the live product for operator trips, the device holding the pending state is the
device that just paid — acceptable for a phase 1, not acceptable forever.

---

## 4. Option B — server-side, via `operator_checkout_sessions`

A table keyed on `(user_id, requirement_id)` recording every session we mint: `session_id`,
`status`, `expires_at`, `amount_cents`.

**This table is already a go-live gate for three unrelated reasons**, all documented in
`payments-checkout/index.ts` around the open-session lookup:

1. the platform-wide `status=open&limit=100` list cliff, past which price-freshness enforcement
   silently stops applying;
2. a non-durable idempotency suffix;
3. stale-priced sessions staying payable.

Persisting pending state would be a **fourth** hole the same table closes, on a table that has
to be built anyway. That is the argument for Option B: it is not new scope, it is scope that
already exists getting one more justification.

It also needs `stripe-webhook` to handle two events it currently ignores —
`checkout.session.expired` and `payment_intent.payment_failed` — writing the `failed` rows that
`organized_trip_payment_events` already has a CHECK constraint for and has never received.

**Recommendation:** ship **A** now, because the hole is live and A is a day's work with no
migration. Fold it into **B** when that table lands, and delete the AsyncStorage path rather
than keeping both.

---

## 5. The rule that matters most: what happens after pending expires — ✅ BUILT

When the 30 minutes are up, the row goes back to "Pay". It must **not** go back to being a
plain one-tap payment.

The first tap after a known unconfirmed attempt opens `PaymentStatusSheet` in a third mode:

> **You already started this payment**
> You started paying the deposit about 40 minutes ago and we never got a confirmation. It may
> still have gone through.
> **Check with your organiser before paying again.**
> [ Message your organiser ] [ Pay anyway ] [ Not now ]

- `PaymentStatusSheet` mode `'unconfirmed'`. Driven by the 7-day phase, not the 30-minute one.
- **The two buttons swap weight here.** In every other mode the action button is primary and
  "Message your organiser" is the outline; in this one they trade places. Asking is the
  recommended move, so it gets the filled button.
- "Pay anyway" is deliberately secondary and deliberately present — refusing to let someone pay
  is its own failure, and the operator may have already confirmed by chat.
- Taking "Pay anyway" clears the attempt **before** re-entering the tap handler, and writes the
  cleared map through a ref as well as state — otherwise the retry hits the gate it just
  cleared, in the same tick, and bounces back into this sheet.
- Falls back to pay-as-primary when there is no organiser to message: a sheet whose only button
  is an outline reads as having no action at all.

This is the piece that makes expiry safe. Without it, expiry just re-opens the trap on a delay.

---

## 6. Reconciliation — the case nobody is watching

If the webhook never lands at all (bad `STRIPE_WEBHOOK_SECRET`, a Stripe outage, a function
deploy that 500s), the traveler's money moved and no row in
`organized_trip_payment_events` records it. Today nothing detects this on either side.

Minimum viable: the operator dashboard grows a "started but never confirmed" list, sourced from
`operator_checkout_sessions` rows whose Stripe status is `complete` with no matching ledger row.
That is the operator's cue to check Stripe directly, and it is the only thing that turns a
silent loss into a support conversation. Depends on §4.

---

## 7. Decisions for Ohad

Built on the recommendations below. All five are still reversible — 2 and 3 are one constant
each in `pendingPaymentStore.ts`.

| # | Question | Recommendation | Built as |
|---|---|---|---|
| 1 | Phase 1 device-local, or wait for `operator_checkout_sessions`? | **Ship A now.** The hole is live; B is gated on a schema decision | ✅ A |
| 2 | 30 minutes for "Processing"? | Yes. Long enough for any real webhook, short enough not to lock out a retry | ✅ `PENDING_WINDOW_MS` |
| 3 | 7 days for "you already started this"? | Yes — past Stripe's retry window. Shorten to 48h if it feels naggy in testing | ✅ `ATTEMPT_WINDOW_MS` |
| 4 | Is "Pay anyway" allowed at all? | **Yes.** Blocking payment outright turns our uncertainty into their problem | ✅ secondary button |
| 5 | Should the web build get this too? | Only via B. Device-local storage cannot cross devices | ⬜ not done |

---

## 8. How to test it

`pendingPaymentStore.test.ts` covers both thresholds, their exact boundaries, a backwards
clock, corrupt storage, and two concurrent attempts on one trip — 23 tests, no device needed.
What it cannot cover is the flow, which needs a real webhook to not arrive.

The failure this prevents is hard to trigger by hand, because the webhook normally works. Force
it:

1. **Break the webhook on purpose** — temporarily point the Stripe test-mode endpoint at a dead
   URL, or unset `STRIPE_WEBHOOK_SECRET` so the function 400s on every delivery. Pay on the test
   trip (El Salvador 26, Guy's participant row). The row should reach "Processing" after ~14s.
2. **Navigate away and back.** Today the row says "Pay" — that is the bug. After this ships it
   must still say "Processing".
3. **Force-quit and reopen.** Same expectation.
4. **Wait past 30 minutes** (or shorten the constant). The row returns to "Pay"; the first tap
   must open the §5 sheet, not Checkout.
5. **Restore the webhook and replay the event** from the Stripe dashboard. The row must tick
   itself off and the stored state must clear, without a manual refresh.

⚠️ Test-mode payments write real rows into the production database — `is_livemode=false` is
what keeps them out of the traveler-facing totals. Use dev-only members; see
`project_notifications_testing_safety` for the same caution about pushes.
