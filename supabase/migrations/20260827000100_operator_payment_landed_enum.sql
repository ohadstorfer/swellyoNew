-- ACH bank payments (docs/specs/operator-trips/ach-bank-payments.md): the
-- notification type for "your bank payment arrived".
--
-- A card payment confirms while the traveler is watching, so nothing needs to
-- be said. A bank payment lands about three business days after they last
-- thought about it — and for three days the row has been saying "on its way".
-- Silence at the moment it finally clears is the one thing Stripe's own
-- guidance for delayed payment methods says not to do. Written by
-- `stripe-webhook` on `checkout.session.async_payment_succeeded`.
--
-- Own file for the usual reason: Postgres will not let a new enum value be
-- USED in the transaction that adds it, and 20260827000200 references this
-- value inside `notification_push_priority`. Run this, then that.

alter type public.notification_type add value if not exists 'operator_payment_landed';
