-- A new notification type: "you skipped your destinations in onboarding".
-- On its own because Postgres will not let a new enum value be USED in the
-- transaction that adds it — 20261002000300 does the rest.
alter type public.notification_type add value if not exists 'profile_destinations_missing';
