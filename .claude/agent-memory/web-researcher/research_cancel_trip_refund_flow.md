---
name: cancel-trip-refund-flow
description: Best practices for organizer-cancels-event flow with Stripe Connect destination-charge refunds — confirmation UX, full-refund norm, refund mechanics, bulk orchestration, order of operations
metadata:
  type: project
---

# Cancel Trip/Event + Refunds — Best Practices (researched 2026-08-18)

Context: Swellyo operator trips use Stripe Connect **destination charges**, Swellyo
as merchant of record (see [[project_swelly_is_merchant_of_record]] equivalent in
main memory — note a reversal to operator-as-MoR was designed but NOT applied as
of last check, so verify which model is live before implementing).

## 1. Confirmation UX
- Airbnb/Eventbrite/GetYourGuide dashboards use an explicit consequence list +
  single confirm button, NOT type-to-confirm, for cancel-event flows — because
  the action is bounded (one event) not a bulk/irrecoverable data wipe.
- Type-to-confirm (typing the trip/resource name) is reserved for the most
  severe, truly irreversible top-tier actions (deleting an org, wiping a
  workspace) — general UX consensus (saasui.design, UX Planet, NN/g) says it's
  overkill below that tier and adds friction without adding comprehension.
- Best practice for "cancel trip affecting other people's money":
  - State the blast radius explicitly and with a number: "This will cancel the
    trip for **12 travelers** and refund **$4,800** total." (NN/g: bulk
    destructive actions must state count — "selection scope multiplies blast
    radius").
  - List consequences as bullets, not prose: refunds issued to all paid
    travelers, trip removed from listings, chat/notifications sent, cannot be
    undone.
  - Notify affected parties as part of the confirm step's promise ("travelers
    will be notified immediately") — Medium/UX Bootcamp guidance: when the
    action affects other people, the confirmation should name that as a
    consequence, not bury it.
  - A single explicit confirm button with a non-default/destructive style
    (e.g., red "Cancel Trip & Refund Everyone") is standard; disable it until
    the operator has actively acknowledged the loss (checkbox, or read the
    consequence list) if you want extra friction without full type-to-confirm.

## 2. Refund choices — full refund is the universal norm
- **Airbnb**: host cancels → guest gets full refund unconditionally, no
  negotiation of amount. Host cancellation policy (flexible/moderate/strict)
  never applies — that policy only governs *guest*-initiated cancellations.
  Host also loses payout and can face penalties (up to $1,000 fee, Superhost
  status loss) for cancelling without a valid "extenuating circumstance."
- **Eventbrite**: organizer-cancelled event → Eventbrite's Cancelled Event
  Policy requires the organizer to refund **all** attendees, ticket price +
  Eventbrite fees, no partial/selective option offered as compliant. Organizer
  triggers it, not automatic — a manual "cancel event → refund all orders"
  flow, but the requirement is you refund everyone, full amount.
- **GetYourGuide**: supplier cancels a booking → GetYourGuide automatically
  gives the customer a full refund (3–5 day timeline). If the cancellation
  isn't due to Force Majeure, GYG can charge the supplier a penalty fee (25%
  of retail price per affected customer) on top of the refund.
- **Consensus across all three**: organizer/host/supplier-initiated
  cancellation = **always 100% refund to every paying customer**, regardless
  of what the trip's own cancellation policy says for traveler-initiated
  cancels. The cancellation policy (flexible/moderate/non-refundable) is a
  one-way shield that protects the operator when the *traveler* backs out —
  it has zero relevance when the *operator* is the one cancelling. This
  aligns directly with Swellyo's existing [[project_operator_cancellation_policy]]
  model, which should explicitly carve out "operator cancels = full refund,
  ignore policy" as a documented, hard-coded branch, not something inferred.
- No major platform researched offers "partial refund" or "operator picks who
  gets refunded" as a legitimate self-serve path when the organizer cancels
  the whole event — doing so would be a trust/legal liability (implied
  contract breach, consumer protection exposure) since the traveler didn't
  cause the cancellation.

## 3. Stripe mechanics — destination charges
- Refund the **platform's charge** (the original PaymentIntent/Charge object
  created by the platform, not anything on the connected account).
- Pass `reverse_transfer: true` on the refund. This pulls the already-
  transferred funds back from the connected account's Stripe balance.
  - Stripe does **not** refund the original card-processing fee (2.9%+$0.30)
    — that's gone regardless; the connected account or platform (depending on
    who "eats" the processing fee in your fee model) absorbs it.
  - Pass `refund_application_fee: true` if you want your platform commission
    refunded too (standard for a full-cancel scenario — you shouldn't keep
    your cut on a trip that never happened). Without it, the platform keeps
    its application fee even though the charge is refunded.
- Partial refunds work the same way — pass an `amount` less than the full
  charge, with `reverse_transfer: true` and a proportional/explicit transfer
  reversal amount if you want fine control (Stripe supports partial transfer
  reversals independently via the Transfer Reversal API too).
- **Insufficient connected-account balance**: if the connected account's
  Stripe balance can't cover the transfer reversal, the reversal (and by
  extension the refund flow) fails unless `debit_negative_balances: true` is
  set on that connected account (Swellyo's existing Connect setup already
  recommends this — see [[research_stripe_connect_setup]]). Without it, the
  platform's own balance absorbs the shortfall, or the refund errors out.
  Practically: keep `debit_negative_balances: true` on all operator accounts,
  and hold platform balance headroom before initiating bulk refunds.
- **Idempotency**: use a unique idempotency key per refund request (e.g.
  `refund_{charge_id}_{cancellation_event_id}`), not one key for a whole
  bulk batch — Stripe keys are per-request, and reusing one key for N
  different refunds will make all but the first a no-op replay. Keys expire
  after 24h; retries within that window are safe no-ops if the underlying
  request truly repeats.
- **`refund.failed` webhook**: refunds can fail after being created (closed
  bank account, expired card, etc.) — status transitions from `pending` to
  `failed` asynchronously. Handle this webhook explicitly; a "refund issued"
  UI state should not be the final/terminal state — track pending → succeeded
  / failed as separate states, and surface failed refunds for manual
  intervention (this is a common gap: teams treat refund creation success as
  refund success).
- **Timing**: card refunds typically land in 5–10 business days (Stripe's own
  range; Eventbrite quotes 5 days US / 7 international; GetYourGuide quotes
  3–5 days) — communicate this range to travelers, don't imply instant.

## 4. Bulk refund orchestration
- Standard pattern for refunding N travelers when an operator cancels:
  1. Server-side job (not a client-triggered loop) enumerates all paid
     participants for the trip.
  2. Per-participant: create a refund with reverse_transfer + a unique
     idempotency key, record `pending` in a `refunds`/`payments` tracking
     table row keyed by participant.
  3. Process sequentially or with limited concurrency (Stripe rate limits;
     also simpler failure isolation) rather than firing all requests at once.
  4. On each Stripe response, update that row's status (`succeeded`/`failed`)
     immediately — don't wait for the webhook if the synchronous API call
     already returned a terminal-looking status, but still listen for
     `refund.failed`/`charge.refund.updated` webhooks since some refunds
     resolve asynchronously after the initial call returns `pending`.
  5. Retry failed rows individually (not the whole batch) — a retry button
     per failed traveler, or an automatic backoff retry with a cap (e.g. 3
     attempts) before surfacing to a human/ops queue.
  6. Show the operator (and ideally the traveler) a per-traveler progress
     list: "12 of 14 refunded, 1 processing, 1 failed — needs attention."
     This mirrors GetYourGuide's supply-partner "batch cancellations" UI
     concept (single vs batch, with visible per-item status).
- This is functionally the same shape as Swellyo's own [[project_stalled_onboarding_nudges]]
  and [[project_dashboard_remind_button]] patterns — a service-role job that
  iterates a set of rows and does an idempotent per-row action with status
  tracking — so the codebase likely already has a template for this
  (RPC + per-row status column) worth reusing rather than inventing a new
  orchestration shape.

## 5. Order of operations
- Mark the trip `cancelled` (and close it to new payments/joins) **before**
  issuing any refunds — every platform researched does status-flip first,
  refund-processing second, because:
  - It stops new payments/bookings from slipping in mid-cancellation (a race
    where someone pays into a trip that's being killed).
  - It lets the UI immediately reflect "this trip is cancelled" to anyone
    who loads it while refunds are still draining through Stripe's 5-10 day
    window.
- Communicate a distinct **"refund processing"** state to travelers, separate
  from "cancelled" — e.g. trip status = cancelled, but each traveler's
  individual payment record shows "Refund processing" until the webhook
  confirms `succeeded`, then flips to "Refunded." Don't conflate trip-level
  cancelled with payment-level refunded; they resolve on different timelines
  and a bulk operation can partially fail.
- Send the cancellation notification to travelers immediately on trip-cancel
  (don't wait for all refunds to clear) but make the copy honest: "Trip
  cancelled. Your refund of $X is being processed and will appear in 5-10
  business days" rather than implying it already happened.

## Sources
- https://www.airbnb.com/help/article/166 — host cancellation
- https://www.airbnb.com/help/article/170 — guest side of host cancellation, full refund
- https://www.airbnb.com/help/article/2278 — Experiences/Services refund policy
- https://www.eventbrite.com/help/en-us/articles/724340/eventbrites-cancelled-event-policy/ — refund-all-attendees requirement
- https://www.eventbrite.com/help/en-us/articles/895183/how-to-cancel-an-event/ — cancel flow steps
- https://supply.getyourguide.support/hc/en-us/articles/13980989354141-Canceling-Bookings-Single-and-Batch-Cancellations-Explained — batch cancellation UI pattern
- https://www.getyourguide.com/c/supplier-terms-and-conditions/ — full refund + 25% penalty fee mechanics
- https://docs.stripe.com/connect/destination-charges — destination charge refund mechanics
- https://docs.stripe.com/connect/marketplace/tasks/refunds-disputes — reverse_transfer, application fee refund
- https://docs.stripe.com/api/transfer_reversals — partial transfer reversal API
- https://docs.stripe.com/refunds — refund.failed, timing (5-10 business days)
- https://docs.stripe.com/api/idempotent_requests — idempotency key mechanics, 24h retention
- https://stripe.com/blog/idempotency — idempotency design rationale
- https://www.nngroup.com/articles/proximity-consequential-options/ — destructive action UX proximity risk
- https://www.saasui.design/blog/saas-destructive-actions-confirmation-ux-patterns — type-to-confirm tiering
- https://medium.com/design-bootcamp/a-ux-guide-to-destructive-actions-their-use-cases-and-best-practices-f1d8a9478d03 — actions affecting other people
