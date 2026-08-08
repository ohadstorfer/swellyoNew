-- Operator Trips — staff & permissions, PHASE 1 (route every gate through the
-- one function).
--
-- Spec + full inventory: docs/specs/operator-trips/staff-and-permissions.md
--
-- ── PREREQUISITE ────────────────────────────────────────────────────────────
-- Run 20260807000000_operator_trip_staff.sql FIRST and let it commit.
-- Everything below calls public.trip_staff_can(), which that migration creates.
--
-- ── The rule this migration follows: OUTPUT MUST BE IDENTICAL ───────────────
-- Nothing new is granted here. This is a refactor of WHERE the answer comes
-- from, not WHAT the answer is. Two facts make that true:
--
--   1. trip_staff_can() falls back to is_trip_host() on any trip that is not
--      hosting_style = 'C'. So every shared policy (gear, join requests, admin
--      updates, commitments — tables that serve ordinary social group trips
--      too) is a pure find-and-replace with zero behaviour change.
--
--   2. Every capability used below is in the seeded 'manager' set, and on an
--      operator trip today `is_trip_host()` already means manager-level. Plus
--      organized_trip_staff is empty until Phase 2, so on the operator side the
--      only person who currently matches is the operator of record — who
--      trip_staff_can() short-circuits to `true` anyway.
--
-- Verified before writing: zero live operator trips have more than one
-- role='host' participant, so host_id and is_trip_host() are the same single
-- person on every operator trip in production. Nobody loses access.
--
-- ── The part that is easy to forget ─────────────────────────────────────────
-- Section 4. Three policies on storage.objects gate the group-trip-documents
-- bucket. Block a Crew in the table and forget storage, and they still pull the
-- passport file straight from the bucket.

-- ══════════════════════════════════════════════════════════════════
-- 1. Operator-trip tables — these get real capabilities
-- ══════════════════════════════════════════════════════════════════

-- Requirements: reading the list is roster-level, writing it is trip.edit.
drop policy if exists organized_trip_req_select on public.organized_trip_requirements;
create policy organized_trip_req_select on public.organized_trip_requirements
  for select to authenticated
  using (public.trip_staff_can(trip_id, 'roster.view')
         or public.is_trip_participant(trip_id));

drop policy if exists organized_trip_req_write on public.organized_trip_requirements;
create policy organized_trip_req_write on public.organized_trip_requirements
  for all to authenticated
  using      (public.trip_staff_can(trip_id, 'trip.edit'))
  with check (public.trip_staff_can(trip_id, 'trip.edit'));

-- Traveler documents — passports live here. docs.view to read, docs.approve to
-- destroy. A traveler always keeps both rights over their own row.
drop policy if exists otd_select on public.organized_trip_travelers_documents;
create policy otd_select on public.organized_trip_travelers_documents
  for select to authenticated
  using (user_id = auth.uid() or public.trip_staff_can(trip_id, 'docs.view'));

drop policy if exists otd_delete on public.organized_trip_travelers_documents;
create policy otd_delete on public.organized_trip_travelers_documents
  for delete to authenticated
  using (user_id = auth.uid() or public.trip_staff_can(trip_id, 'docs.approve'));

-- Operator materials the trip hands OUT (itinerary, waivers to sign). Every
-- traveler reads them; putting one there is editing the trip.
drop policy if exists otod_select on public.organized_trip_operator_documents;
create policy otod_select on public.organized_trip_operator_documents
  for select to authenticated
  using (public.trip_staff_can(trip_id, 'roster.view')
         or public.is_trip_participant(trip_id));

drop policy if exists otod_insert on public.organized_trip_operator_documents;
create policy otod_insert on public.organized_trip_operator_documents
  for insert to authenticated
  with check (public.trip_staff_can(trip_id, 'trip.edit'));

-- Medical is its own capability. Per the agreed matrix it is Manager and up —
-- a manager tells a guide if there is something they need to know.
drop policy if exists medical_operator_select on public.organized_trip_medical_forms;
create policy medical_operator_select on public.organized_trip_medical_forms
  for select to authenticated
  using (public.trip_staff_can(trip_id, 'medical.view'));

-- Who paid and who did not. READ ONLY — this is payments.view_status, not
-- money.manage. Nothing here lets anyone move an amount.
drop policy if exists otpe_read_own on public.organized_trip_payment_events;
create policy otpe_read_own on public.organized_trip_payment_events
  for select to authenticated
  using (user_id = auth.uid()
         or public.trip_staff_can(trip_id, 'payments.view_status'));

drop policy if exists ack_select on public.group_trip_acknowledgements;
create policy ack_select on public.group_trip_acknowledgements
  for select to authenticated
  using (user_id = auth.uid() or public.trip_staff_can(trip_id, 'roster.view'));

-- ══════════════════════════════════════════════════════════════════
-- 2. Shared tables — mechanical swap, no behaviour change
-- ══════════════════════════════════════════════════════════════════
-- These serve BOTH trip kinds. trip_staff_can() returns is_trip_host() verbatim
-- for anything that is not hosting_style = 'C', so ordinary group trips do not
-- move at all.

-- Admin updates (the "host posted an update" feed).
drop policy if exists "admin_updates host can insert" on public.group_trip_admin_updates;
create policy "admin_updates host can insert" on public.group_trip_admin_updates
  for insert to authenticated
  with check (auth.uid() = author_id and public.trip_staff_can(trip_id, 'trip.edit'));

drop policy if exists "admin_updates host can update" on public.group_trip_admin_updates;
create policy "admin_updates host can update" on public.group_trip_admin_updates
  for update to authenticated
  using      (public.trip_staff_can(trip_id, 'trip.edit'))
  with check (public.trip_staff_can(trip_id, 'trip.edit'));

drop policy if exists "admin_updates host can delete" on public.group_trip_admin_updates;
create policy "admin_updates host can delete" on public.group_trip_admin_updates
  for delete to authenticated
  using (public.trip_staff_can(trip_id, 'trip.edit'));

-- Gear.
drop policy if exists "gear_items host can insert" on public.group_trip_gear_items;
create policy "gear_items host can insert" on public.group_trip_gear_items
  for insert to authenticated
  with check (auth.uid() = created_by and public.trip_staff_can(trip_id, 'trip.edit'));

drop policy if exists "gear_items host can update" on public.group_trip_gear_items;
create policy "gear_items host can update" on public.group_trip_gear_items
  for update to authenticated
  using      (public.trip_staff_can(trip_id, 'trip.edit'))
  with check (public.trip_staff_can(trip_id, 'trip.edit'));

drop policy if exists "gear_items host can delete" on public.group_trip_gear_items;
create policy "gear_items host can delete" on public.group_trip_gear_items
  for delete to authenticated
  using (public.trip_staff_can(trip_id, 'trip.edit'));

drop policy if exists "gear_requests host can review" on public.group_trip_gear_requests;
create policy "gear_requests host can review" on public.group_trip_gear_requests
  for update to authenticated
  using      (public.trip_staff_can(trip_id, 'trip.edit'))
  with check (public.trip_staff_can(trip_id, 'trip.edit'));

-- Join requests. Note the INSERT policy's NOT: a host cannot ask to join their
-- own trip. It now also stops staff — which is invariant I3 (staff and
-- travelers are exclusive), enforced a second time at the door.
drop policy if exists "join_requests readable by requester or host" on public.group_trip_join_requests;
create policy "join_requests readable by requester or host" on public.group_trip_join_requests
  for select to authenticated
  using (auth.uid() = requester_id or public.trip_staff_can(trip_id, 'roster.view'));

drop policy if exists "join_requests requester can insert pending" on public.group_trip_join_requests;
create policy "join_requests requester can insert pending" on public.group_trip_join_requests
  for insert to authenticated
  with check (auth.uid() = requester_id
              and status = 'pending'
              and not public.trip_staff_can(trip_id, 'roster.view'));

drop policy if exists "join_requests host can review" on public.group_trip_join_requests;
create policy "join_requests host can review" on public.group_trip_join_requests
  for update to authenticated
  using      (public.trip_staff_can(trip_id, 'trip.edit'))
  with check (public.trip_staff_can(trip_id, 'trip.edit')
              and status = any (array['approved','declined']));

drop policy if exists "join_requests host or requester can delete" on public.group_trip_join_requests;
create policy "join_requests host or requester can delete" on public.group_trip_join_requests
  for delete to authenticated
  using (auth.uid() = requester_id or public.trip_staff_can(trip_id, 'trip.edit'));

-- Commitments.
drop policy if exists "gtcr select" on public.group_trip_commitment_requests;
create policy "gtcr select" on public.group_trip_commitment_requests
  for select to authenticated
  using (auth.uid() = user_id or public.trip_staff_can(trip_id, 'roster.view'));

drop policy if exists "gtcr update host or self supersede" on public.group_trip_commitment_requests;
create policy "gtcr update host or self supersede" on public.group_trip_commitment_requests
  for update to authenticated
  using      (public.trip_staff_can(trip_id, 'trip.edit') or auth.uid() = user_id)
  with check (public.trip_staff_can(trip_id, 'trip.edit') or auth.uid() = user_id);

-- Removing a traveler is its own capability, separate from editing the trip.
drop policy if exists "group_trip_participants user leaves self or host removes"
  on public.group_trip_participants;
create policy "group_trip_participants user leaves self or host removes"
  on public.group_trip_participants
  for delete to authenticated
  using (auth.uid() = user_id or public.trip_staff_can(trip_id, 'travelers.remove'));

-- The trip row itself. host_id stays unseizable — guard_primary_trip_host
-- (20260803000000 §10) is untouched and still refuses a host_id PATCH.
drop policy if exists "group_trips host can update" on public.group_trips;
create policy "group_trips host can update" on public.group_trips
  for update to authenticated
  using      (public.trip_staff_can(id, 'trip.edit'))
  with check (public.trip_staff_can(id, 'trip.edit'));

-- ══════════════════════════════════════════════════════════════════
-- 3. Functions — swap the gate line, keep every body byte-for-byte
-- ══════════════════════════════════════════════════════════════════
-- NOT touched, on purpose:
--   • operator_set_traveler_price, operator_freeze_trip_prices,
--     freeze_traveler_price — the C3 money set. They gate on
--     group_trips.host_id, which is exactly trip_staff_can()'s operator branch.
--     Rewriting them would add indirection to the one rule we least want
--     indirect. They stay literal.
--   • promote_trip_host / demote_trip_host — social group-trip machinery.
--   • payments-checkout's read of trip.host_id — that is host_id as PAYEE, not
--     as a permission. Staff never change who gets paid.
--
-- ── Why this is done by text substitution and not by retyping the bodies ────
-- Because the repo files have DRIFTED from the live database, and retyping from
-- the repo silently produces the wrong function. Concretely, as of 2026-08-07:
--
--   repo 20260724000400: operator_approve_documents(uuid[])        returns void
--   live:                operator_approve_documents(uuid[], text)  returns integer
--
-- A hand-written `create or replace` from the repo version would have created a
-- SECOND, one-argument overload returning void — leaving the real two-argument
-- function still gated on is_trip_host(), and breaking the client, which passes
-- two arguments and reads the returned count.
--
-- These bodies also carry load-bearing comments. operator_remind_requirement is
-- ~100 lines documenting that its branch order MUST mirror
-- operator_trip_my_requirements, that `<> 'host'` is exactly what the Dashboard
-- counts, and why pay rows are refused. Retyping that to change one line is how
-- a subtle bug gets in.
--
-- So: read each live definition, replace ONLY the gate call, run it back. The
-- assertions are the point — if a function no longer contains the expected text
-- (someone changed it after 2026-08-07), this RAISES rather than silently
-- re-creating the old body and leaving the gate un-migrated.
do $do$
declare
  r        record;
  v_def    text;
  v_args   text;
  v_target text;
  v_n      integer;
begin
  for r in
    select * from (values
      -- function,                              old gate call,                        capability
      ('operator_approve_documents',            'public.is_trip_host(d.trip_id)',     'docs.approve'),
      ('operator_reject_document',              'public.is_trip_host(d.trip_id)',     'docs.approve'),
      ('operator_mark_document_file_deleted',   'public.is_trip_host(d.trip_id)',     'docs.approve'),
      ('organized_trip_document_counts',        'public.is_trip_host(p_trip_id)',     'docs.view'),
      -- The Dashboard "Remind N people" button. docs.view, i.e. Manager and up,
      -- which is what is_trip_host() already means on an operator trip today.
      ('operator_remind_requirement',           'public.is_trip_host(p_trip_id)',     'docs.view')
    ) as t(fname, old_call, cap)
  loop
    -- Count FIRST. plpgsql's SELECT ... INTO silently keeps the first row when
    -- a query returns several, so an overloaded name would migrate one
    -- signature and leave the other still gated on is_trip_host() — with no
    -- error anywhere. That is exactly the trap this migration exists to avoid:
    -- the repo already disagrees with live about
    -- operator_approve_documents' signature.
    select count(*) into v_n
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = r.fname;

    if v_n = 0 then
      raise exception 'public.% not found — the Phase 1 inventory is stale', r.fname;
    elsif v_n > 1 then
      raise exception 'public.% has % overloads; migrate each one by hand', r.fname, v_n;
    end if;

    select pg_get_functiondef(p.oid), pg_get_function_identity_arguments(p.oid)
      into v_def, v_args
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = r.fname;

    if position(r.old_call in v_def) = 0 then
      raise exception 'public.% no longer contains %; re-check the gate by hand',
        r.fname, r.old_call;
    end if;

    -- The argument the old call passed, reused verbatim: d.trip_id or p_trip_id.
    v_target := btrim(replace(replace(r.old_call, 'public.is_trip_host(', ''), ')', ''));

    v_def := replace(
      v_def,
      r.old_call,
      format('public.trip_staff_can(%s, %L)', v_target, r.cap)
    );

    execute v_def;

    -- A function recreated later by DROP+CREATE re-grants PUBLIC (see
    -- reference: function recreate re-grants public). CREATE OR REPLACE keeps
    -- grants, but re-assert anyway so this migration is safe to re-run and so
    -- the intent is on the record.
    execute format('revoke execute on function public.%I(%s) from public, anon', r.fname, v_args);
    execute format('grant  execute on function public.%I(%s) to authenticated',  r.fname, v_args);

    raise notice 'gated public.%(%) on %', r.fname, v_args, r.cap;
  end loop;
end $do$;

-- ══════════════════════════════════════════════════════════════════
-- 4. STORAGE — the gate people forget
-- ══════════════════════════════════════════════════════════════════
-- can_access_group_document() is the SELECT gate for the whole
-- group-trip-documents bucket. Rewriting its body is what actually stops a
-- Crew from fetching a passport they cannot see in the table.
--
-- Path shapes, unchanged:
--   <trip>/operator/<file>          operator materials, handed out to travelers
--   <trip>/<user>/<file>            a traveler's own upload (passports here)
create or replace function public.can_access_group_document(object_path text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select case
    when object_path ~ '^[0-9a-fA-F-]{36}/operator/' then
      public.trip_staff_can(((storage.foldername(object_path))[1])::uuid, 'roster.view')
      or public.is_trip_participant(((storage.foldername(object_path))[1])::uuid)
    when object_path ~ '^[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}/' then
      ((storage.foldername(object_path))[2])::uuid = auth.uid()
      or public.trip_staff_can(((storage.foldername(object_path))[1])::uuid, 'docs.view')
    else false
  end;
$$;

revoke execute on function public.can_access_group_document(text) from public, anon;
grant  execute on function public.can_access_group_document(text) to authenticated;

-- The two storage policies that call is_trip_host() directly.
-- NOTE: these are on storage.objects. Run this migration as the `postgres` role
-- (the dashboard SQL editor does); a lesser role cannot replace them.
drop policy if exists "group docs: host uploads operator materials" on storage.objects;
create policy "group docs: host uploads operator materials" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'group-trip-documents'
    and name ~ '^[0-9a-fA-F-]{36}/operator/[0-9a-fA-F-]{36}\.(jpg|jpeg|png|heic|pdf)$'
    and public.trip_staff_can(((storage.foldername(name))[1])::uuid, 'trip.edit')
  );

drop policy if exists "group docs: traveler or host deletes" on storage.objects;
create policy "group docs: traveler or host deletes" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'group-trip-documents'
    and case
      when name ~ '^[0-9a-fA-F-]{36}/operator/'
        then public.trip_staff_can(((storage.foldername(name))[1])::uuid, 'docs.approve')
      else public.can_access_group_document(name)
    end
  );

-- ══════════════════════════════════════════════════════════════════
-- 5. Verification — run these AFTER applying, all read-only
-- ══════════════════════════════════════════════════════════════════
-- (a) Nothing should still gate on is_trip_host() except the group-trip host
--     machinery (promote/demote) and trip_staff_can() itself:
--
--   select tablename, policyname from pg_policies
--   where schemaname in ('public','storage')
--     and (coalesce(qual,'')||coalesce(with_check,'')) ilike '%is_trip_host%';
--   -- expect: 0 rows
--
--   select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--   where n.nspname='public' and prosrc ilike '%is_trip_host%';
--   -- expect exactly: trip_staff_can, my_trip_capabilities,
--   --                 promote_trip_host, demote_trip_host
--
-- (b) The money set must still be literal host_id, NOT the gate:
--
--   select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--   where n.nspname='public' and prosrc ~* 'host_id\s*=\s*auth\.uid';
--   -- expect: operator_set_traveler_price, operator_freeze_trip_prices,
--   --         freeze_traveler_price
--
-- (c) On a real operator trip, as the operator, every capability is true:
--
--   select public.trip_staff_can('<operator-trip-id>', c)
--   from unnest(array['docs.view','medical.view','money.manage','trip.edit']) c;
--   -- expect: all true
--
-- (d) On an ordinary group trip, the fallback must equal the old answer:
--
--   select public.trip_staff_can('<group-trip-id>','trip.edit')
--        = public.is_trip_host('<group-trip-id>');
--   -- expect: true
--
-- (c) and (d) must be run as a real user (the SQL editor is not authenticated,
-- so auth.uid() is null there and both come back false/null). Easiest check is
-- from the app, or with a JWT set via set_config('request.jwt.claims', ...).
