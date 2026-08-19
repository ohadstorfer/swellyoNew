-- Enum values alone, in their own migration: Postgres refuses to USE a new
-- enum value in the same transaction that adds it, so the function that
-- references these lives in 20260820000400. Same split every prior
-- notification type used (20260819000000/000100 is the freshest precedent).
--
--   operator_charge_disputed — a traveler's bank opened a chargeback on one of
--     the operator's payments. Written by stripe-webhook from
--     charge.dispute.created.
--   operator_dispute_closed  — the case closed; data.outcome is 'won' or
--     'lost'. Same producer, from charge.dispute.closed.

alter type public.notification_type add value if not exists 'operator_charge_disputed';
alter type public.notification_type add value if not exists 'operator_dispute_closed';
