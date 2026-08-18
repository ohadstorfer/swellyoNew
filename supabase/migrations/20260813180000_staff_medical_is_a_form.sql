-- A crew member's medical form was never going to count as done.
--
-- ── The bug ────────────────────────────────────────────────────────────────
-- `medical` is stored with req_type = 'upload' — deliberately, and there is a
-- warning about it on REQUIREMENT_CATALOG — but its evidence is a ROW in
-- organized_trip_medical_forms, not a file in
-- organized_trip_travelers_documents. The traveler-side resolver knows that and
-- branches on `kind = 'medical'` BEFORE it looks for a document
-- (operator_my_requirements, 20260724000700). `staff_my_requirements` from
-- 20260812000200 only copied the req_type branches, so a guide asked for
-- medical info could fill the form in, save it, and watch the row stay
-- outstanding forever with no way to clear it.
--
-- Found while building the dev shortcut for the crew paperwork screen, before
-- any operator had assigned a medical requirement to anyone — so nothing in
-- production is in this state, and nothing needs backfilling.
--
-- ── The fix ────────────────────────────────────────────────────────────────
-- The same branch order the traveler side uses: kind first, then req_type. Also
-- adds `security invoker` back explicitly and pins the search_path the way the
-- original did.
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
    case
      -- Kind first: a medical requirement carries req_type 'upload' but is
      -- satisfied by a completed form, never by a file.
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

revoke all    on function public.staff_my_requirements(uuid) from public, anon;
grant  execute on function public.staff_my_requirements(uuid) to authenticated;
