-- Requirements a STAFF member has to satisfy, assigned per person.
--
-- Spec: docs/staff-requirements-and-wallet-delivery-spec-and-plan.html, Part A.
--
-- ── Why per person and not per trip ─────────────────────────────────────────
-- Traveler requirements are a property of the trip: everybody who joins is
-- asked the same things, so the requirement row alone is the whole answer.
-- Staff are not like that. On one trip the photographer flies in and needs a
-- visa, the head guide needs a first-aid certificate, and the local driver
-- needs neither. A trip-wide staff list would ask all three for all of it, the
-- operator would learn to ignore the list, and a requirements system nobody
-- reads is worse than none.
--
-- So: `audience` says who a requirement is written FOR, and for staff-audience
-- requirements a join table says WHICH staff it was assigned to. Traveler
-- requirements keep working exactly as before — they apply to everyone, and
-- the join table is not consulted for them at all.
--
-- ── What this deliberately does not add ─────────────────────────────────────
-- No second requirements engine. Fulfilment still lands in
-- `organized_trip_travelers_documents`, `group_trip_acknowledgements` and
-- `organized_trip_medical_forms`, all of which key on (requirement_id, user_id)
-- and never needed to know whether that user is a traveler or crew. Two
-- engines would drift, and the one used less would rot.

-- ══════════════════════════════════════════════════════════════════
-- 1. Who is a requirement written for?
-- ══════════════════════════════════════════════════════════════════

alter table public.organized_trip_requirements
  add column if not exists audience text not null default 'traveler';

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'organized_trip_req_audience_check') then
    alter table public.organized_trip_requirements
      add constraint organized_trip_req_audience_check
      check (audience in ('traveler','staff'));
  end if;
end $$;

comment on column public.organized_trip_requirements.audience is
  'Who this requirement is written for. ''traveler'' applies to everyone who joins '
  '(the default, and what every pre-existing row is). ''staff'' applies to nobody '
  'until assigned in organized_trip_staff_requirements.';

-- Staff do not pay to work.
--
-- Held here rather than in the UI because a 'pay' requirement pointed at staff
-- would reach the same checkout gate a traveler's deposit does and try to
-- charge a member of the crew. A CHECK is the only place that cannot be
-- forgotten by a future screen.
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'organized_trip_req_staff_never_pays') then
    alter table public.organized_trip_requirements
      add constraint organized_trip_req_staff_never_pays
      check (audience = 'traveler' or req_type <> 'pay');
  end if;
end $$;

-- ══════════════════════════════════════════════════════════════════
-- 2. Which staff member was asked for which requirement
-- ══════════════════════════════════════════════════════════════════

create table if not exists public.organized_trip_staff_requirements (
  id             uuid primary key default gen_random_uuid(),
  staff_id       uuid not null references public.organized_trip_staff(id) on delete cascade,
  requirement_id uuid not null references public.organized_trip_requirements(id) on delete cascade,
  -- Kept even though it is derivable through staff_id: the policies below join
  -- on it, and making RLS walk two tables to find the trip on every row read is
  -- a cost paid on every single query.
  trip_id        uuid not null references public.group_trips(id) on delete cascade,
  assigned_by    uuid not null references auth.users(id),
  assigned_at    timestamptz not null default now(),
  unique (staff_id, requirement_id)
);

create index if not exists otsr_staff_idx on public.organized_trip_staff_requirements(staff_id);
create index if not exists otsr_trip_idx  on public.organized_trip_staff_requirements(trip_id);

comment on table public.organized_trip_staff_requirements is
  'One row = this staff member was asked for this requirement. Assignment only; '
  'the fulfilment lives in the same tables travelers use.';

-- Assignment and the requirement must belong to the same trip. Without this a
-- requirement from trip A could be assigned to crew on trip B, and the
-- resolved view would hand the wrong person somebody else''s paperwork.
create or replace function public.check_staff_requirement_same_trip()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_req_trip   uuid;
  v_staff_trip uuid;
begin
  select trip_id into v_req_trip
    from public.organized_trip_requirements where id = new.requirement_id;
  select trip_id into v_staff_trip
    from public.organized_trip_staff where id = new.staff_id;

  if v_req_trip is null or v_staff_trip is null then
    raise exception 'Unknown requirement or staff member'
      using errcode = 'foreign_key_violation';
  end if;

  if v_req_trip <> v_staff_trip or new.trip_id <> v_req_trip then
    raise exception 'A staff requirement must belong to the same trip as the staff member'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_staff_requirement_same_trip
  on public.organized_trip_staff_requirements;
create trigger trg_staff_requirement_same_trip
  before insert or update on public.organized_trip_staff_requirements
  for each row execute function public.check_staff_requirement_same_trip();

-- ══════════════════════════════════════════════════════════════════
-- 3. RLS
-- ══════════════════════════════════════════════════════════════════

alter table public.organized_trip_staff_requirements enable row level security;

-- Read: whoever can see the crew list, plus the staff member themselves — they
-- cannot satisfy a requirement they are not allowed to know about.
drop policy if exists otsr_select on public.organized_trip_staff_requirements;
create policy otsr_select on public.organized_trip_staff_requirements
  for select to authenticated
  using (
    public.trip_staff_can(trip_id, 'roster.view')
    or exists (
      select 1 from public.organized_trip_staff s
       where s.id = organized_trip_staff_requirements.staff_id
         and s.user_id = auth.uid()
         and s.revoked_at is null
    )
  );

-- Write: managing who is asked for what is the same right as managing the crew.
drop policy if exists otsr_write on public.organized_trip_staff_requirements;
create policy otsr_write on public.organized_trip_staff_requirements
  for all to authenticated
  using      (public.trip_staff_can(trip_id, 'staff.manage'))
  with check (public.trip_staff_can(trip_id, 'staff.manage'));

-- ══════════════════════════════════════════════════════════════════
-- 4. Resolving a staff member's own list
-- ══════════════════════════════════════════════════════════════════

-- Mirrors what `organized_trip_requirements_resolved` does for travelers, but
-- driven by assignment rather than by "every active requirement on the trip".
--
-- Deliberately returns no deadline and no skip state. Those exist to protect a
-- departure a TRAVELER might miss; a staff member's paperwork is a working
-- arrangement with the operator who hired them, and a countdown that locks the
-- guide out of the trip two days before it starts is worse than the missing
-- certificate. Staff paperwork is flagged, never gated — see the spec.
create or replace function public.staff_my_requirements(p_trip_id uuid)
returns table (
  requirement_id uuid,
  kind           text,
  req_type       text,
  title          text,
  help_text      text,
  assigned_at    timestamptz,
  fulfilled      boolean
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    r.id,
    r.kind,
    r.req_type,
    r.title,
    r.help_text,
    a.assigned_at,
    case r.req_type
      when 'upload' then exists (
        select 1 from public.organized_trip_travelers_documents d
         where d.requirement_id = r.id
           and d.user_id = auth.uid()
           and d.file_deleted_at is null
      )
      when 'acknowledge' then exists (
        select 1 from public.group_trip_acknowledgements k
         where k.requirement_id = r.id
           and k.user_id = auth.uid()
      )
      else false
    end
  from public.organized_trip_staff_requirements a
  join public.organized_trip_requirements r on r.id = a.requirement_id
  join public.organized_trip_staff s        on s.id = a.staff_id
 where a.trip_id = p_trip_id
   and s.user_id = auth.uid()
   -- Revoked crew are asked for nothing. The assignment rows stay (they are a
   -- record that the ask was made), but somebody taken off the trip must not
   -- keep a task list for it.
   and s.revoked_at is null
   and r.is_active
 order by r.sort_order, r.title;
$$;

comment on function public.staff_my_requirements(uuid) is
  'The paperwork THIS signed-in staff member was assigned on this trip, with '
  'whether each is done. security invoker on purpose: the RLS above is the '
  'access rule, and a definer function here would quietly become a second one.';

revoke all on function public.staff_my_requirements(uuid) from public, anon;
grant execute on function public.staff_my_requirements(uuid) to authenticated;
