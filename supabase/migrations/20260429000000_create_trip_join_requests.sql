-- Group Trip Join Requests
-- Adds a host-approval workflow on top of group_trip_participants.
-- A user submits a request → host approves/declines → on approval, a row is
-- inserted into group_trip_participants automatically (via trigger).

-- ============================================================================
-- Table: group_trip_join_requests
-- ============================================================================
create table if not exists public.group_trip_join_requests (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.group_trips(id) on delete cascade,
  requester_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','approved','declined','withdrawn')),
  request_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  unique (trip_id, requester_id)
);

create index if not exists group_trip_join_requests_trip_id_idx
  on public.group_trip_join_requests(trip_id);
create index if not exists group_trip_join_requests_requester_id_idx
  on public.group_trip_join_requests(requester_id);
create index if not exists group_trip_join_requests_status_idx
  on public.group_trip_join_requests(status);

-- ============================================================================
-- updated_at trigger
-- ============================================================================
create or replace function public.set_updated_at_group_trip_join_requests()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_group_trip_join_requests_set_updated_at
  on public.group_trip_join_requests;
create trigger trg_group_trip_join_requests_set_updated_at
  before update on public.group_trip_join_requests
  for each row execute function public.set_updated_at_group_trip_join_requests();

-- ============================================================================
-- Approval trigger: when status flips pending → approved, add participant row
-- ============================================================================
create or replace function public.handle_join_request_approval()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    insert into public.group_trip_participants (trip_id, user_id, role)
    values (new.trip_id, new.requester_id, 'member')
    on conflict (trip_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_group_trip_join_requests_on_approve
  on public.group_trip_join_requests;
create trigger trg_group_trip_join_requests_on_approve
  after update of status on public.group_trip_join_requests
  for each row execute function public.handle_join_request_approval();

-- ============================================================================
-- RLS
-- ============================================================================
alter table public.group_trip_join_requests enable row level security;

-- Read: requester sees own requests; trip host sees their trip's requests
drop policy if exists "join_requests readable by requester or host"
  on public.group_trip_join_requests;
create policy "join_requests readable by requester or host"
  on public.group_trip_join_requests for select
  to authenticated
  using (
    auth.uid() = requester_id
    or auth.uid() = (select host_id from public.group_trips where id = trip_id)
  );

-- Insert: only the requester themselves, and only as pending.
-- Hosts cannot self-approve someone else's request via insert; the user must request.
drop policy if exists "join_requests requester can insert pending"
  on public.group_trip_join_requests;
create policy "join_requests requester can insert pending"
  on public.group_trip_join_requests for insert
  to authenticated
  with check (
    auth.uid() = requester_id
    and status = 'pending'
    -- Forbid the host from requesting to join their own trip.
    and auth.uid() <> (select host_id from public.group_trips where id = trip_id)
  );

-- Update: host can approve/decline; requester can withdraw.
-- Two policies (PostgreSQL OR's policies of the same command).
drop policy if exists "join_requests host can review"
  on public.group_trip_join_requests;
create policy "join_requests host can review"
  on public.group_trip_join_requests for update
  to authenticated
  using (
    auth.uid() = (select host_id from public.group_trips where id = trip_id)
  )
  with check (
    auth.uid() = (select host_id from public.group_trips where id = trip_id)
    and status in ('approved','declined')
  );

drop policy if exists "join_requests requester can withdraw"
  on public.group_trip_join_requests;
create policy "join_requests requester can withdraw"
  on public.group_trip_join_requests for update
  to authenticated
  using (auth.uid() = requester_id)
  with check (auth.uid() = requester_id and status = 'withdrawn');
