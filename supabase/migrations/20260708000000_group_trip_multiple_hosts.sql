-- 20260708000000_group_trip_multiple_hosts.sql
-- Group trips can have multiple hosts.
--  * Permission moves from group_trips.host_id (one user) to
--    group_trip_participants.role = 'host' (a set).
--  * group_trips.host_id becomes "primary host" — display + notification target,
--    kept in sync by trigger. Still exactly one per trip.
--  * Enforced invariants (all in Postgres, none trusted to the app):
--      I1  every trip has >= 1 host
--      I2  host_id always points at a current host of that trip
--      I3  role cannot be changed by a direct client write
--  * Closes two pre-existing holes on group_trip_participants:
--      - anyone could UPDATE their own row to role='host' (self-promotion)
--      - anyone could INSERT themselves into any trip (bypassing join requests)
--
-- Applied by hand in the SQL editor. Do NOT db push.

begin;

-- ── 1. role_granted_at: tie-breaker for primary-host reassignment ───────────
alter table public.group_trip_participants
  add column if not exists role_granted_at timestamptz not null default now();

update public.group_trip_participants
  set role_granted_at = coalesce(joined_at, role_granted_at)
  where role = 'host';

-- ── 2. Defensive backfill: guarantee every trip has its host participant row ──
-- createGroupTrip inserts the host participant best-effort; a past failure could
-- leave a hostless trip. Guarantee I1's precondition before enforcing it.
insert into public.group_trip_participants (trip_id, user_id, role)
select t.id, t.host_id, 'host'
from public.group_trips t
where not exists (
  select 1 from public.group_trip_participants p
  where p.trip_id = t.id and p.user_id = t.host_id
)
on conflict do nothing;

-- Any trip whose host_id row exists but isn't marked host → mark it.
update public.group_trip_participants p
  set role = 'host'
from public.group_trips t
where p.trip_id = t.id and p.user_id = t.host_id and p.role <> 'host';

-- ── 3. is_trip_host: the permission primitive (SECURITY DEFINER → no RLS
--       recursion when called from a policy on group_trip_participants itself) ─
create or replace function public.is_trip_host(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select exists (
    select 1 from public.group_trip_participants
    where trip_id = p_trip_id and user_id = auth.uid() and role = 'host'
  );
$$;
revoke execute on function public.is_trip_host(uuid) from public, anon;
grant execute on function public.is_trip_host(uuid) to authenticated;

-- ── 4. I1: a trip always keeps >= 1 host ────────────────────────────────────
create or replace function public.enforce_min_one_trip_host()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_trip_id uuid := old.trip_id;
  v_was_host boolean := (old.role = 'host');
  v_still_host boolean := (tg_op = 'UPDATE' and new.role = 'host');
  v_remaining int;
begin
  -- Only relevant when a host row is leaving the host set.
  if not v_was_host or v_still_host then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  -- Lock the trip so two concurrent demotions can't both pass this count.
  perform 1 from public.group_trips where id = v_trip_id for update;
  select count(*) into v_remaining
  from public.group_trip_participants
  where trip_id = v_trip_id and role = 'host' and user_id <> old.user_id;
  if v_remaining = 0 then
    raise exception 'A trip must have at least one host'
      using errcode = 'check_violation';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_enforce_min_one_trip_host on public.group_trip_participants;
create trigger trg_enforce_min_one_trip_host
  before update or delete on public.group_trip_participants
  for each row execute function public.enforce_min_one_trip_host();

-- ── 5. I2: keep group_trips.host_id pointing at a current host ──────────────
create or replace function public.sync_primary_trip_host()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_trip_id uuid := case when tg_op = 'DELETE' then old.trip_id else new.trip_id end;
  v_current_primary uuid;
  v_new_primary uuid;
begin
  select host_id into v_current_primary from public.group_trips where id = v_trip_id;
  -- Still a host? nothing to do.
  if exists (
    select 1 from public.group_trip_participants
    where trip_id = v_trip_id and user_id = v_current_primary and role = 'host'
  ) then
    return null;
  end if;
  -- Reassign to the longest-tenured remaining host (I1 guarantees one exists).
  select user_id into v_new_primary
  from public.group_trip_participants
  where trip_id = v_trip_id and role = 'host'
  order by role_granted_at asc, user_id asc
  limit 1;
  if v_new_primary is not null then
    update public.group_trips set host_id = v_new_primary where id = v_trip_id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_sync_primary_trip_host on public.group_trip_participants;
create trigger trg_sync_primary_trip_host
  after update or delete on public.group_trip_participants
  for each row execute function public.sync_primary_trip_host();

-- I2 guard on the other side: a direct write to group_trips.host_id must land
-- on a current host. (Internal reassignment above always satisfies this.)
create or replace function public.guard_primary_trip_host()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if new.host_id is distinct from old.host_id then
    if not exists (
      select 1 from public.group_trip_participants
      where trip_id = new.id and user_id = new.host_id and role = 'host'
    ) then
      raise exception 'host_id must reference a current host of the trip'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_primary_trip_host on public.group_trips;
create trigger trg_guard_primary_trip_host
  before update on public.group_trips
  for each row execute function public.guard_primary_trip_host();

-- ── 6. Rewrite every host_id-based policy to is_trip_host ────────────────────
-- group_trips
drop policy if exists "group_trips host can update" on public.group_trips;
create policy "group_trips host can update" on public.group_trips
  for update using (public.is_trip_host(id)) with check (public.is_trip_host(id));
drop policy if exists "group_trips host can delete" on public.group_trips;
create policy "group_trips host can delete" on public.group_trips
  for delete using (public.is_trip_host(id));

-- group_trip_participants
--   I3: role immutable via client UPDATE; only own row, role unchanged.
drop policy if exists "group_trip_participants user updates self" on public.group_trip_participants;
create policy "group_trip_participants user updates self" on public.group_trip_participants
  for update using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and role = (
      select p.role from public.group_trip_participants p
      where p.trip_id = group_trip_participants.trip_id and p.user_id = group_trip_participants.user_id
    )
  );
--   DELETE: self-leave OR any host removes.
drop policy if exists "group_trip_participants user leaves self or host removes" on public.group_trip_participants;
create policy "group_trip_participants user leaves self or host removes" on public.group_trip_participants
  for delete using (auth.uid() = user_id or public.is_trip_host(trip_id));
--   INSERT: self, and only with an approved join request OR as the trip creator
--   (the createGroupTrip host row; group_trips INSERT already gates host_id=uid).
drop policy if exists "group_trip_participants user joins self" on public.group_trip_participants;
create policy "group_trip_participants user joins self" on public.group_trip_participants
  for insert with check (
    auth.uid() = user_id
    and (
      exists (
        select 1 from public.group_trip_join_requests jr
        where jr.trip_id = group_trip_participants.trip_id
          and jr.requester_id = auth.uid() and jr.status = 'approved'
      )
      or auth.uid() = (select host_id from public.group_trips where id = group_trip_participants.trip_id)
    )
  );

-- group_trip_join_requests
drop policy if exists "join_requests readable by requester or host" on public.group_trip_join_requests;
create policy "join_requests readable by requester or host" on public.group_trip_join_requests
  for select using (auth.uid() = requester_id or public.is_trip_host(trip_id));
drop policy if exists "join_requests requester can insert pending" on public.group_trip_join_requests;
create policy "join_requests requester can insert pending" on public.group_trip_join_requests
  for insert with check (
    auth.uid() = requester_id and status = 'pending' and not public.is_trip_host(trip_id)
  );
drop policy if exists "join_requests host can review" on public.group_trip_join_requests;
create policy "join_requests host can review" on public.group_trip_join_requests
  for update using (public.is_trip_host(trip_id))
  with check (public.is_trip_host(trip_id) and status = any (array['approved','declined']));
drop policy if exists "join_requests host or requester can delete" on public.group_trip_join_requests;
create policy "join_requests host or requester can delete" on public.group_trip_join_requests
  for delete using (auth.uid() = requester_id or public.is_trip_host(trip_id));
-- ("join_requests requester can withdraw" UPDATE is requester-only — unchanged.)

-- group_trip_commitment_requests
drop policy if exists "gtcr select" on public.group_trip_commitment_requests;
create policy "gtcr select" on public.group_trip_commitment_requests
  for select using (auth.uid() = user_id or public.is_trip_host(trip_id));
drop policy if exists "gtcr update host or self supersede" on public.group_trip_commitment_requests;
create policy "gtcr update host or self supersede" on public.group_trip_commitment_requests
  for update using (public.is_trip_host(trip_id) or auth.uid() = user_id)
  with check (public.is_trip_host(trip_id) or auth.uid() = user_id);
-- ("gtcr insert self" INSERT is user-only — unchanged.)

-- group_trip_gear_items
drop policy if exists "gear_items host can insert" on public.group_trip_gear_items;
create policy "gear_items host can insert" on public.group_trip_gear_items
  for insert with check (auth.uid() = created_by and public.is_trip_host(trip_id));
drop policy if exists "gear_items host can update" on public.group_trip_gear_items;
create policy "gear_items host can update" on public.group_trip_gear_items
  for update using (public.is_trip_host(trip_id)) with check (public.is_trip_host(trip_id));
drop policy if exists "gear_items host can delete" on public.group_trip_gear_items;
create policy "gear_items host can delete" on public.group_trip_gear_items
  for delete using (public.is_trip_host(trip_id));

-- group_trip_gear_requests
drop policy if exists "gear_requests host can review" on public.group_trip_gear_requests;
create policy "gear_requests host can review" on public.group_trip_gear_requests
  for update using (public.is_trip_host(trip_id)) with check (public.is_trip_host(trip_id));
-- (insert / withdraw are requester-based — unchanged.)

-- group_trip_admin_updates
drop policy if exists "admin_updates host can insert" on public.group_trip_admin_updates;
create policy "admin_updates host can insert" on public.group_trip_admin_updates
  for insert with check (auth.uid() = author_id and public.is_trip_host(trip_id));
drop policy if exists "admin_updates host can update" on public.group_trip_admin_updates;
create policy "admin_updates host can update" on public.group_trip_admin_updates
  for update using (public.is_trip_host(trip_id)) with check (public.is_trip_host(trip_id));
drop policy if exists "admin_updates host can delete" on public.group_trip_admin_updates;
create policy "admin_updates host can delete" on public.group_trip_admin_updates
  for delete using (public.is_trip_host(trip_id));

-- ── 7. Role-change RPCs (the ONLY way role changes; I3 blocks direct writes) ─
create or replace function public.promote_trip_host(p_trip_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if not public.is_trip_host(p_trip_id) then
    raise exception 'Only a host can promote' using errcode = 'insufficient_privilege';
  end if;
  update public.group_trip_participants
    set role = 'host', role_granted_at = now()
    where trip_id = p_trip_id and user_id = p_user_id and role <> 'host';
  if not found then
    -- Either already a host (no-op ok) or not a participant (error).
    if not exists (
      select 1 from public.group_trip_participants
      where trip_id = p_trip_id and user_id = p_user_id
    ) then
      raise exception 'That user is not a participant of this trip'
        using errcode = 'no_data_found';
    end if;
  end if;
end;
$$;
revoke execute on function public.promote_trip_host(uuid, uuid) from public, anon;
grant execute on function public.promote_trip_host(uuid, uuid) to authenticated;

create or replace function public.demote_trip_host(p_trip_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if not public.is_trip_host(p_trip_id) then
    raise exception 'Only a host can demote' using errcode = 'insufficient_privilege';
  end if;
  -- The >=1-host trigger (I1) rejects demoting the last host.
  update public.group_trip_participants
    set role = 'member'
    where trip_id = p_trip_id and user_id = p_user_id and role = 'host';
end;
$$;
revoke execute on function public.demote_trip_host(uuid, uuid) from public, anon;
grant execute on function public.demote_trip_host(uuid, uuid) to authenticated;

-- ── 8. Notification fan-out: trip_admin_ids already unions role='admin' (never
--       matches). Point it at 'host' so all hosts receive join/commit/gear pushes ─
create or replace function public.trip_admin_ids(p_trip_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select array_agg(distinct uid)
  from (
    select host_id as uid from public.group_trips where id = p_trip_id
    union
    select user_id from public.group_trip_participants
      where trip_id = p_trip_id and role = 'host'
  ) x
  where uid is not null;
$$;

commit;
