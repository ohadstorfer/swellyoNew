-- Record WHICH ENTITY was the merchant of record for each payment.
--
-- Phase 1 of docs/specs/operator-trips/refunds-and-merchant-of-record.md.
--
-- WHY THIS COLUMN EXISTS. `payments-checkout` is starting to send
-- `payment_intent_data[on_behalf_of]`, which makes the OPERATOR the settlement
-- merchant / merchant of record instead of Swellyo. Two things follow:
--
--   1. A card dispute can arrive up to ~18 months after the charge, and the
--      first question is "who was the seller on this transaction?". Deriving
--      that later from deploy dates is guesswork; deriving it from Stripe means
--      an API call per row. Store it once, at write time.
--   2. The two paths are not interchangeable. On the operator path the
--      traveler's statement says the operator, and their country's fee
--      structure and settlement currency apply. Reconciliation that assumes a
--      single seller is wrong the moment both kinds of row exist.
--
-- The value is read from `payment_intents.on_behalf_of` on the PaymentIntent
-- the webhook already fetches for `application_fee_usd` — Stripe's own record,
-- not our claim about what we sent. No extra API call.
--
-- NULL is meaningful: the webhook could not read the PaymentIntent (that fetch
-- is deliberately non-fatal, so that recording the money never depends on it).
-- NULL means unknown, NOT 'platform'.

alter table public.organized_trip_payment_events
  add column if not exists settlement_merchant text;

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'organized_trip_payment_events_settlement_merchant_check') then
    alter table public.organized_trip_payment_events
      add constraint organized_trip_payment_events_settlement_merchant_check
      check (settlement_merchant is null or settlement_merchant in ('platform', 'operator'));
  end if;
end $$;

comment on column public.organized_trip_payment_events.settlement_merchant is
  'Who was the merchant of record for this charge: ''operator'' when the '
  'PaymentIntent carried on_behalf_of, ''platform'' when it did not. NULL means '
  'the webhook could not read the PaymentIntent — unknown, not platform. '
  'See docs/specs/operator-trips/refunds-and-merchant-of-record.md.';

-- BACKFILL IS SAFE HERE, unlike the cancellation-policy columns.
--
-- That migration deliberately left old trips NULL because writing a policy onto
-- them would have INVENTED terms nobody agreed to. This is the opposite case:
-- `on_behalf_of` has never been sent by any version of `payments-checkout`, so
-- every row that predates this migration is a platform charge as a matter of
-- fact, not of assumption. Leaving them NULL would throw away information we
-- have.
update public.organized_trip_payment_events
   set settlement_merchant = 'platform'
 where settlement_merchant is null;
