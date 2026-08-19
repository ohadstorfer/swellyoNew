-- The answers pg_cron never reads.
--
-- Every scheduled job here fires net.http_post and pg_cron records `succeeded`
-- the moment the request goes out — the 401/500 that comes BACK lands in
-- net._http_response, which nothing watched. Two outages proved it:
--   · 18 Aug: dispatch-notification-queue returned 500 every minute for 9 hours.
--   · 7 Jun → 19 Aug: notify-abandoned-onboarding returned 401 hourly for 73
--     days (line-broken JWT in the job command). 1,753 "successful" runs, zero
--     reminders ever sent.
--
-- This RPC hands those answers to the health-check's `cron_http` check.
-- SECURITY DEFINER because `net` is not exposed through PostgREST; execution is
-- service_role-only (REVOKE policy per 2026-08 hardening — a recreate re-grants
-- PUBLIC, so the revoke must ride along with any future edit).
--
-- pg_net prunes _http_response after ~6h, so only small windows are answerable.

create or replace function public.health_cron_http_failures(window_minutes integer default 60)
returns table (
  status_code integer,
  timed_out boolean,
  error_msg text,
  body_head text,
  created timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select r.status_code,
         coalesce(r.timed_out, false),
         r.error_msg,
         left(r.content, 200),
         r.created
  from net._http_response r
  where r.created > now() - make_interval(mins => window_minutes)
    and (r.status_code is null or r.status_code >= 400 or r.timed_out)
  order by r.created desc
  limit 50;
$$;

revoke all on function public.health_cron_http_failures(integer) from public, anon, authenticated;
grant execute on function public.health_cron_http_failures(integer) to service_role;
