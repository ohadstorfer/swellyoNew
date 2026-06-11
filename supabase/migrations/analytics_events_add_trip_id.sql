-- Analytics charts A/B/C: trip-scoped events.
-- Adds trip_id to analytics_events so chart C (trip health heatmap) can read
-- activity per trip. Null for non-trip events (app_opened, onboarding, etc.).
--
-- Apply manually via the Supabase SQL editor (never `supabase db push`).

alter table public.analytics_events
  add column if not exists trip_id uuid;

-- Chart C reads "events for trip X in date range" — partial index keeps it
-- cheap and skips the (majority) rows with no trip.
create index if not exists idx_analytics_events_trip_occurred
  on public.analytics_events (trip_id, occurred_at)
  where trip_id is not null;
