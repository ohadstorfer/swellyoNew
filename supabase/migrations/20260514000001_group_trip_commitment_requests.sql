-- Audit log of every commitment submission a member makes on a group trip.
--
-- The "current" state lives on group_trip_participants (status + items + note).
-- This table preserves history: every re-submission inserts a new row, and the
-- host's decision is recorded alongside. message_id links back to the chat
-- bubble that surfaced the request, so the chat UI can show "Approve" only
-- while the corresponding request is still pending.

create table if not exists public.group_trip_commitment_requests (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.group_trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  items jsonb not null default '[]'::jsonb,
  note text,
  status text not null default 'pending',
  message_id uuid references public.messages(id) on delete set null,
  decided_by uuid references auth.users(id) on delete set null,
  requested_at timestamptz not null default now(),
  decided_at timestamptz
);

alter table public.group_trip_commitment_requests
  drop constraint if exists group_trip_commitment_requests_status_check;

alter table public.group_trip_commitment_requests
  add constraint group_trip_commitment_requests_status_check
  check (status in ('pending', 'approved', 'superseded'));

create index if not exists idx_gtcr_trip_user
  on public.group_trip_commitment_requests (trip_id, user_id, requested_at desc);

create index if not exists idx_gtcr_pending
  on public.group_trip_commitment_requests (trip_id, status)
  where status = 'pending';

create index if not exists idx_gtcr_message_id
  on public.group_trip_commitment_requests (message_id)
  where message_id is not null;

alter table public.group_trip_commitment_requests enable row level security;

-- Member sees their own; host sees all for trips they host.
drop policy if exists "gtcr select" on public.group_trip_commitment_requests;
create policy "gtcr select"
  on public.group_trip_commitment_requests for select
  to authenticated
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.group_trips t
      where t.id = group_trip_commitment_requests.trip_id
        and t.host_id = auth.uid()
    )
  );

-- Member can insert a request for themselves only.
drop policy if exists "gtcr insert self" on public.group_trip_commitment_requests;
create policy "gtcr insert self"
  on public.group_trip_commitment_requests for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Host can update (approve/decline). Member can update only their own row
-- to mark it superseded when re-submitting.
drop policy if exists "gtcr update host or self supersede" on public.group_trip_commitment_requests;
create policy "gtcr update host or self supersede"
  on public.group_trip_commitment_requests for update
  to authenticated
  using (
    exists (
      select 1 from public.group_trips t
      where t.id = group_trip_commitment_requests.trip_id
        and t.host_id = auth.uid()
    )
    or auth.uid() = user_id
  )
  with check (
    exists (
      select 1 from public.group_trips t
      where t.id = group_trip_commitment_requests.trip_id
        and t.host_id = auth.uid()
    )
    or auth.uid() = user_id
  );

comment on table public.group_trip_commitment_requests is
  'Append-only-ish audit log of commitment submissions. Latest pending row per (trip, user) is the active request.';
