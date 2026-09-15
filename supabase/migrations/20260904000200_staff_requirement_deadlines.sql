-- Crew paperwork gets a deadline. It gets the TRAVELERS' deadline.
--
-- Product Specs §"Manage active staff member": "set required docs (deadlines
-- will be similar to rest of travelers)" and, under Manage trip, "changing
-- deadlines will effect the crew members deadlines accordingly".
--
-- ── What was here before, and why it stays ─────────────────────────────────
-- 20260812000200 returned no deadline at all, on purpose, and the reasoning is
-- good enough to keep intact: "a traveler with unmet requirements cannot join
-- the trip; a guide with unmet paperwork is FLAGGED... locking the guide out of
-- the trip two days before departure is a worse outcome than the missing
-- certificate."
--
-- Nothing below changes that. The deadline is DISPLAYED and can read as late.
-- It gates nothing, blocks nothing, and no reminder job is wired to it in this
-- change. Staff paperwork is still flagged, never gated.
--
-- ── Derived, not copied ────────────────────────────────────────────────────
-- The obvious build is to give staff requirement rows their own
-- `deadline_days_before` and keep it in step with the traveler row. That is two
-- clocks, and two clocks drift — one of them is edited, the other is not, and
-- six weeks later the guide and the travelers are looking at different dates
-- for the same passport.
--
-- So the staff row keeps no deadline of its own and READS the traveler row's.
-- That is possible because since 20260814000000 a kind is unique per
-- (trip_id, kind, audience) rather than per (trip_id, kind): the
-- audience = 'traveler' row of the same kind on the same trip is sitting right
-- there, at most one of it, and it is exactly the thing the spec means by
-- "similar to rest of travelers".
--
-- The second sentence of the spec then costs nothing at all. Editing a
-- traveler deadline in either requirements editor moves the crew's with it,
-- because there was never a second copy to move.
--
-- A staff-only kind with no traveler sibling — a first-aid certificate asked of
-- the head guide and of nobody else — returns null, exactly as today. There is
-- no traveler deadline for it to be similar to.
--
-- ── Why the join is safe inside a security invoker function ────────────────
-- `organized_trip_req_select` is `roster.view or is_trip_participant`. This
-- function already joins organized_trip_requirements for the caller's OWN
-- assigned rows, so anyone who gets any result from it today can already read
-- that table for that trip. The sibling row is on the same trip. No new
-- reader, no new row, no reason to reach for security definer.
--
-- Return type changes, so this is DROP + CREATE. Additive for callers: every
-- one of them reads by column name.

drop function if exists public.staff_my_requirements(uuid);

create or replace function public.staff_my_requirements(p_trip_id uuid)
returns table (
  requirement_id uuid,
  kind           text,
  req_type       text,
  title          text,
  help_text      text,
  assigned_at    timestamptz,
  fulfilled      boolean,
  -- The travelers' deadline for this same kind, as the operator stored it.
  -- Non-null whenever the sibling requirement has one, whether or not the trip
  -- has a real start date to resolve it against — same reason
  -- operator_trip_my_requirements returns it (20260824000100): a months-only
  -- trip still deserves to say "30 days before the trip" rather than nothing.
  deadline_days_before integer,
  -- The same deadline resolved against the trip's start date, or null when the
  -- trip has no dates yet.
  due_date       date
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
    case
      -- Kind first: a medical requirement carries req_type 'upload' but is
      -- satisfied by a completed form, never by a file. (20260813180000.)
      when r.kind = 'medical' then exists (
        select 1 from public.organized_trip_medical_forms m
         where m.trip_id = r.trip_id
           and m.user_id = auth.uid()
           and m.completed_at is not null
      )
      when r.req_type = 'upload' then exists (
        select 1 from public.organized_trip_travelers_documents d
         where d.requirement_id = r.id
           and d.user_id = auth.uid()
           and d.file_deleted_at is null
      )
      when r.req_type = 'acknowledge' then exists (
        select 1 from public.group_trip_acknowledgements k
         where k.requirement_id = r.id
           and k.user_id = auth.uid()
      )
      else false
    end,
    tw.deadline_days_before,
    case
      when tw.deadline_days_before is null or t.start_date is null then null
      else (t.start_date - make_interval(days => tw.deadline_days_before))::date
    end
  from public.organized_trip_staff_requirements a
  join public.organized_trip_requirements r on r.id = a.requirement_id
  join public.organized_trip_staff s        on s.id = a.staff_id
  join public.group_trips t                 on t.id = r.trip_id
  -- The travelers' row of the same kind. At most one, guaranteed by
  -- uq_organized_trip_req_kind_per_trip. `custom` is excluded by that index
  -- and so cannot match here either, which is correct: two custom asks that
  -- happen to share a title are not the same requirement.
  left join public.organized_trip_requirements tw
         on tw.trip_id  = r.trip_id
        and tw.kind     = r.kind
        and tw.audience = 'traveler'
        and tw.is_active
        and r.kind <> 'custom'
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
  'One crew member''s assigned paperwork on one trip. The deadline is DERIVED '
  'from the travelers'' requirement of the same kind, never stored on the staff '
  'row — so moving the travelers'' deadline moves the crew''s, and the two can '
  'never disagree. Flagged, never gated: nothing here blocks a guide, and no '
  'reminder job reads it.';

revoke all     on function public.staff_my_requirements(uuid) from public, anon;
grant  execute on function public.staff_my_requirements(uuid) to authenticated;

-- ── Verify (read-only) ─────────────────────────────────────────────────────
-- As a crew member on a trip that asks travelers for a passport 30 days before
-- departure, and asks this guide for a passport too:
--   select kind, deadline_days_before, due_date from staff_my_requirements('<trip>');
-- must show 30 and start_date - 30.
--
-- Move the travelers' deadline and re-run — the crew row must move with it,
-- with nothing else written:
--   update organized_trip_requirements set deadline_days_before = 45
--    where trip_id = '<trip>' and kind = 'passport' and audience = 'traveler';
--
-- A staff-only ask must still come back null:
--   select kind, deadline_days_before from staff_my_requirements('<trip>')
--    where kind = 'custom';
