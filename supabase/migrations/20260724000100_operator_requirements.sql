-- Operator Trips — membership helper + the requirement definitions table.
--
-- An operator trip IS a group_trips row with hosting_style = 'C'. There is no
-- separate operator model. This adds sibling child tables only; no ALTER on
-- group_trips, no change to A/B trips, no change to is_trip_host().
--
-- Spec: docs/specs/operator-trips/requirements-model.md

-- ── 1. The single canonical membership primitive.
--   The operator/host check CALLS the live public.is_trip_host(p_trip_id).
--   Never modify that function — it gates six live tables.
--
--   NOTE: this is an RLS helper. Policy expressions run as the CALLING role, so
--   `authenticated` MUST keep EXECUTE. Do not include it in any blanket
--   "revoke execute on all security definer functions" pass.
create or replace function public.is_trip_participant(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select exists (
    select 1 from public.group_trip_participants p
    where p.trip_id = p_trip_id and p.user_id = auth.uid()
  );
$$;

revoke execute on function public.is_trip_participant(uuid) from public, anon;
grant  execute on function public.is_trip_participant(uuid) to authenticated;

-- ── 2. Requirement definitions. One row per requirement per trip.
--   Per-traveler state is NEVER stored here or anywhere else — it is derived
--   from the evidence tables (documents / acknowledgements / medical / ledger).
create table if not exists public.group_trip_requirements (
  id                    uuid primary key default gen_random_uuid(),
  trip_id               uuid not null references public.group_trips(id) on delete cascade,
  kind                  text not null check (kind in
                          ('passport','waiver','medical','insurance','visa','flights','custom')),
  req_type              text not null check (req_type in ('upload','acknowledge','pay')),
  timing                text not null check (timing in ('must_have','skippable')),
  title                 text not null,
  help_text             text,
  deadline_days_before  integer check (deadline_days_before >= 0),
  sort_order            integer not null default 0,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- must_have has no deadline; skippable must have one.
  constraint group_trip_req_deadline_rule check (
    (timing = 'skippable' and deadline_days_before is not null) or
    (timing = 'must_have'  and deadline_days_before is null)
  )
);

-- A known kind appears at most once per trip. Custom items may repeat.
create unique index if not exists uq_group_trip_req_kind_per_trip
  on public.group_trip_requirements (trip_id, kind) where kind <> 'custom';

create index if not exists idx_group_trip_req_trip
  on public.group_trip_requirements (trip_id, sort_order) where is_active;

-- ── 3. updated_at
-- SECURITY INVOKER on purpose: stamping updated_at needs no elevated rights,
-- and a SECURITY DEFINER trigger function carries the default PUBLIC execute
-- grant, which makes it anon-callable over /rest/v1/rpc/. See 20260724000600.
create or replace function public.touch_group_trip_requirements()
returns trigger
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$ begin new.updated_at := now(); return new; end $$;

revoke execute on function public.touch_group_trip_requirements() from public, anon, authenticated;

drop trigger if exists trg_touch_group_trip_requirements on public.group_trip_requirements;
create trigger trg_touch_group_trip_requirements
  before update on public.group_trip_requirements
  for each row execute function public.touch_group_trip_requirements();

-- ── 4. RLS. Reads are direct; writes go through RPCs added later.
alter table public.group_trip_requirements enable row level security;

revoke all    on public.group_trip_requirements from anon, authenticated;
grant  select on public.group_trip_requirements to   authenticated;

drop policy if exists group_trip_req_select on public.group_trip_requirements;
create policy group_trip_req_select on public.group_trip_requirements
  for select to authenticated
  using (public.is_trip_host(trip_id) or public.is_trip_participant(trip_id));

drop policy if exists group_trip_req_write on public.group_trip_requirements;
create policy group_trip_req_write on public.group_trip_requirements
  for all to authenticated
  using       (public.is_trip_host(trip_id))
  with check  (public.is_trip_host(trip_id));

grant insert, update, delete on public.group_trip_requirements to authenticated;
