-- ============================================================================
-- notification_queue — push outbox. One row = one intended push.
-- Server-internal: written by the enqueue trigger (SECURITY DEFINER), read &
-- updated only by the dispatcher (service role). NO client access.
-- ============================================================================
create table if not exists public.notification_queue (
  id              uuid primary key default gen_random_uuid(),
  recipient_id    uuid not null references public.users(id) on delete cascade,
  trip_id         uuid references public.group_trips(id) on delete cascade,
  type            public.notification_type not null,
  priority        smallint not null default 1,        -- 0 = urgent (send now) · 1 = normal (held) · 2 = re-engagement (Phase 3)
  dedup_key       text not null,
  notification_id uuid references public.notifications(id) on delete cascade,
  send_after      timestamptz not null default now(),
  status          text not null default 'pending' check (status in ('pending','sent','skipped')),
  skip_reason     text,                                -- read_in_feed | muted | no_token | device_unregistered | shadow
  payload         jsonb not null default '{}'::jsonb,  -- {title, body} actually sent (audit)
  created_at      timestamptz not null default now(),
  sent_at         timestamptz                          -- also the "sent log" for the LATER frequency cap
);

-- Drain query: pending + due, urgent first.
create index if not exists idx_notification_queue_due
  on public.notification_queue (status, send_after, priority);
-- Future frequency cap (Phase 2): count recent sends per user.
create index if not exists idx_notification_queue_sentlog
  on public.notification_queue (recipient_id, sent_at) where status = 'sent';
-- Dedup: at most one PENDING push per (recipient, type, entity) at a time.
create unique index if not exists uq_notification_queue_pending_dedup
  on public.notification_queue (dedup_key) where status = 'pending';

-- RLS: service-role only. Clients never touch this table.
alter table public.notification_queue enable row level security;
revoke all on public.notification_queue from anon, authenticated;
-- (no policies → authenticated/anon get nothing; service role bypasses RLS)
