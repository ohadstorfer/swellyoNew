-- Where the operator banks, and what currency Stripe pays them in.
--
-- WHY. `on_behalf_of` (Phase 1 of
-- docs/specs/operator-trips/refunds-and-merchant-of-record.md) made a charge
-- settle in the OPERATOR's country and settlement currency rather than ours.
-- From that moment "which of our operators settle outside USD?" became a
-- question with real consequences — and one we could not answer from our own
-- data at all, because we stored neither field.
--
-- The refund guardrail no longer needs it: it asks Stripe what a refund
-- actually costs in the operator's own currency (Phase 2d). This is about
-- VISIBILITY — knowing the shape of the operator base before something else
-- quietly depends on it. Concrete things it already answers:
--   • which operators are outside the auto-debit countries for
--     `debit_negative_balances` (AU, CA, Europe/SEPA + UK, NZ, US), i.e. where
--     a chargeback can only be recovered through the contract — see Phase 3;
--   • whether a trip priced in USD is paying FX on every settlement.
--
-- BOTH FIELDS COME FREE. `stripe-connect-onboard` and `stripe-connect-webhook`
-- already fetch the whole Stripe Account object to read `charges_enabled` and
-- friends; `country` and `default_currency` sit on that same response and were
-- simply being thrown away. No extra API call.
--
-- NULL means "not synced yet", never "USD". A row fills in on the next status
-- poll or `account.updated` webhook. Deliberately NOT backfilled with a guess:
-- inventing a country for a payout account is exactly the kind of quiet wrong
-- answer this column exists to prevent.

alter table public.operator_payout_accounts
  add column if not exists country          text,
  add column if not exists default_currency text;

comment on column public.operator_payout_accounts.country is
  'ISO 3166-1 alpha-2 of the Stripe account, e.g. ''US''. From the Stripe Account object. '
  'NULL = not synced yet, never a default.';

comment on column public.operator_payout_accounts.default_currency is
  'Lowercase ISO 4217 the connected account settles in, e.g. ''usd''. From the Stripe Account '
  'object. NULL = not synced yet. Need not match the charge currency — see '
  'docs/specs/operator-trips/refunds-and-merchant-of-record.md §2d.';
