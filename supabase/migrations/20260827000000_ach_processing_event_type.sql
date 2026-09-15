-- ACH bank payments for US travelers.
-- docs/specs/operator-trips/ach-bank-payments.md
--
-- One new ledger event type:
--
--   'processing' — the traveler authorised a BANK payment and the money is on
--                  its way. ACH takes about 3 business days, so unlike a card
--                  there is a real window where a payment exists but has not
--                  arrived. Stripe reports it as
--                  `checkout.session.completed` with
--                  `payment_status = 'processing'`, and resolves it later with
--                  `async_payment_succeeded` or `async_payment_failed`.
--
-- Amount is pinned to 0, exactly like 'failed' and 'disputed'. This is the
-- whole safety argument for the feature:
--
--   * every money total in the system is sum(amount_usd) over an exclusion
--     list — operator_requirement_pay_state, fetchPaidByRequirement, and the
--     `paid` reducer in payments-checkout;
--   * a row worth 0 cannot move any of them, whether it is excluded or not;
--   * therefore operator_requirement_pay_state() is DELIBERATELY NOT TOUCHED
--     by this migration. The live definition of that function has drifted
--     from the repo before, and rewriting it to add an exclusion that
--     provably changes nothing would risk clobbering that drift for no gain.
--
-- The row exists to answer "is a bank payment in flight?" — which
-- payments-checkout asks before minting a second session, so a traveler
-- cannot pay twice while the first payment clears. It never carries money.
--
-- Deliberately NO 'processing' → 'paid' mutation: the day-3
-- async_payment_succeeded event writes its OWN 'paid' row, keyed on its own
-- event id. uq_otpe_object is scoped to event_type = 'paid', so the two rows
-- share a provider_object_id (the PaymentIntent) without colliding, and the
-- ledger keeps both halves of the story.

alter table public.organized_trip_payment_events
  drop constraint organized_trip_payment_events_event_type_check;
alter table public.organized_trip_payment_events
  add constraint organized_trip_payment_events_event_type_check
  check (event_type = any (array[
    'paid'::text,
    'refunded'::text,
    'failed'::text,
    'disputed'::text,
    'dispute_lost'::text,
    'processing'::text
  ]));

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
    or ((event_type = 'processing'::text)   and (amount_usd = (0)::numeric))
  );
