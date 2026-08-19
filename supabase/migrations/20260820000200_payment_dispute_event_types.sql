-- Phase 3 of docs/specs/operator-trips/refunds-and-merchant-of-record.md:
-- chargebacks stop being invisible. Two new ledger event types:
--
--   'disputed'     — the bank opened a case (charge.dispute.created). Amount is
--                    pinned to 0: the outcome is not known yet, and a WON
--                    dispute returns the money, so no total may move on this
--                    row. It is a marker, not a movement — the disputed amount
--                    lives on the notification and on Stripe.
--   'dispute_lost' — the case closed against us (charge.dispute.closed with
--                    status 'lost'). Negative, like 'refunded', so every
--                    consumer that sums non-'failed' rows — including
--                    operator_requirement_pay_state — self-corrects: the
--                    traveler's pay state falls back to unpaid the moment the
--                    money is really gone.
--
-- Deliberately NO 'dispute_won' type: a won dispute moves no money net, so a
-- row for it would be a marker summing to 0 next to a marker already there.

alter table public.organized_trip_payment_events
  drop constraint organized_trip_payment_events_event_type_check;
alter table public.organized_trip_payment_events
  add constraint organized_trip_payment_events_event_type_check
  check (event_type = any (array['paid'::text, 'refunded'::text, 'failed'::text, 'disputed'::text, 'dispute_lost'::text]));

alter table public.organized_trip_payment_events
  drop constraint otpe_amount_sign_matches_type;
alter table public.organized_trip_payment_events
  add constraint otpe_amount_sign_matches_type
  check (
       ((event_type = 'paid'::text)         and (amount_usd > (0)::numeric))
    or ((event_type = 'refunded'::text)     and (amount_usd < (0)::numeric))
    or ((event_type = 'failed'::text)       and (amount_usd = (0)::numeric))
    or ((event_type = 'disputed'::text)     and (amount_usd = (0)::numeric))
    or ((event_type = 'dispute_lost'::text) and (amount_usd < (0)::numeric))
  );
