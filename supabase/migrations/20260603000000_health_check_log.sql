-- Tiny table the daily health check writes to, to prove DB read+write works.
-- Not user data. RLS on with no policies => only the service role (used by the
-- edge function) can touch it.
create table if not exists public.health_check_log (
  id      bigint generated always as identity primary key,
  ran_at  timestamptz not null default now(),
  source  text        not null default 'health-check'
);

alter table public.health_check_log enable row level security;
