-- The follow-up 20260818230000 named and did not fix: rows stranded in
-- 'sending'.
--
-- The dispatcher claims rows (status='sending') before contacting Expo, and
-- only the run that claimed them ever writes their terminal state. If that run
-- dies between the claim and the write — a timeout, a redeploy mid-flight —
-- the rows sit in 'sending' forever, because the drain selects only 'pending'.
-- Same class of silence as the outage itself: no error, no retry, no alarm,
-- just a push that never arrives.
--
-- ── claimed_at, stamped by trigger ──────────────────────────────────────────
-- The table records WHEN a row entered 'sending' nowhere (created_at is queue
-- insert; send_after is the quiet-hours gate; sent_at is terminal). Without
-- it, a sweep cannot tell "stranded for an hour" from "claimed two seconds
-- ago" — send_after can be long past at claim time (any backlog row), so
-- aging on it would yank rows out from under a LIVE run and double-push.
--
-- Stamped by trigger rather than by the dispatcher so no deploy is needed and
-- no future writer can forget it.

alter table public.notification_queue
  add column if not exists claimed_at timestamptz;

create or replace function public.tg_stamp_queue_claim()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.claimed_at := now();
  return new;
end $$;

drop trigger if exists trg_stamp_queue_claim on public.notification_queue;

create trigger trg_stamp_queue_claim
  before update on public.notification_queue
  for each row
  when (new.status = 'sending' and old.status is distinct from 'sending')
  execute function public.tg_stamp_queue_claim();

-- ── The sweep ───────────────────────────────────────────────────────────────
-- Every 10 minutes, return anything claimed more than 10 minutes ago to
-- 'pending'; the next 1-minute drain re-picks it.
--
-- 10 minutes is not tuned, it is BOUNDED: an Edge Function invocation cannot
-- outlive ~400s wall clock, so a claim older than 10 minutes cannot belong to
-- a live run — the sweep can never race one. The cost of sweeping a run that
-- died AFTER contacting Expo for some rows is a duplicate push for those rows;
-- the alternative is a push that never arrives, and the outage taught which
-- one goes unnoticed.
--
-- coalesce(claimed_at, created_at): only pre-trigger claims can have a NULL
-- claimed_at, and created_at is always <= the claim time, so they age out
-- FASTER — never slower — than the truth.
select cron.schedule(
  'unstick-sending-pushes',
  '*/10 * * * *',
  $$
  update public.notification_queue
     set status = 'pending', claimed_at = null
   where status = 'sending'
     and coalesce(claimed_at, created_at) < now() - interval '10 minutes';
  $$
);

-- To undo:
--   select cron.unschedule('unstick-sending-pushes');
--   drop trigger if exists trg_stamp_queue_claim on public.notification_queue;
--   drop function if exists public.tg_stamp_queue_claim();
--   alter table public.notification_queue drop column if exists claimed_at;
