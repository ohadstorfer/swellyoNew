-- The waiver carve-out: replaceable while nobody is on the trip.
--
-- Follows 20260818000000_waiver_is_frozen_after_publish.sql, which froze the
-- waiver outright. Ohad, 18 Aug: allow the operator to change it when there are
-- 0 members — an operator who uploaded the wrong PDF at publish should not be
-- stuck with it on a trip nobody has joined.
--
-- ── Why this is not simply "count the members" ──────────────────────────────
-- Two facts make a naive member count the wrong test, both verified on prod
-- before writing this:
--
--   1. THE HOST IS A PARTICIPANT ROW. All four type-C trips carry their own
--      host in `group_trip_participants`. A literal `count(*) = 0` would never
--      be true, so the carve-out would never open.
--
--   2. CREW SIGN THE WAIVER TOO, and crew are NOT participants —
--      `trg_staff_not_traveler` makes staff and travelers mutually exclusive,
--      and 20260813160000 §7 exists precisely so a guide can agree to the same
--      `organized_trip_operator_documents` row. A trip can therefore have zero
--      travelers and a photographer who has already signed. Counting
--      participants alone would silently un-sign them — the exact bug this
--      whole thread is about.
--
-- So the gate is two conditions, and the second is the load-bearing one:
--
--   • no participants other than the host, and
--   • no signatures against this trip's waiver, from anyone.
--
-- The signature check is what actually prevents harm; the member check is the
-- rule as stated, and it keeps the promise easy to say out loud: "you can
-- change it until someone joins."
--
-- ── Why UPDATE in place, and not delete-then-insert ────────────────────────
-- The unique index from the previous migration stays: one waiver row per trip,
-- always. Replacing is therefore an UPDATE of the row that is already there,
-- which is atomic — there is never a moment where the trip has a waiver
-- requirement and no document to satisfy it. A delete-then-insert would open
-- exactly that window, and a failure inside it leaves a trip nobody can join.
--
-- The row keeps its `id` and its `version`. That is safe BECAUSE of the
-- precondition: with zero acknowledgements, nothing in the database references
-- the old document, so there is no stale pointer to leave behind. `version`
-- staying 1 is honest — the trip has only ever had one effective waiver.
-- `document_hash` is what records which bytes were agreed to, and it moves.
--
-- ── The UPDATE policy is new ───────────────────────────────────────────────
-- The table had INSERT and SELECT policies only, so nothing could ever update a
-- document row. The policy below is `trip.edit`, matching the existing insert
-- policy, and the trigger is what narrows it to an empty trip. Policy for WHO,
-- trigger for WHEN — the same split `guard_trip_money_and_cancel` uses, and for
-- the same reason: RLS cannot express "this row, only in this state".
--
-- ✅ APPLIED to prod 2026-08-18.

-- ── 1. The guard ────────────────────────────────────────────────────────────

create or replace function public.guard_waiver_replacement()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_host    uuid;
  v_others  integer;
  v_signed  integer;
begin
  -- A document never moves between trips, and 'waiver' is the only kind the
  -- CHECK constraint allows. Pinning both means the emptiness test below can
  -- never be answered about one trip and applied to another.
  if new.trip_id is distinct from old.trip_id
     or new.kind is distinct from old.kind then
    raise exception 'A waiver document cannot be moved to another trip'
      using errcode = 'check_violation';
  end if;

  select host_id into v_host from public.group_trips where id = new.trip_id;

  -- The host's own participant row does not count: they are the one asking.
  select count(*) into v_others
    from public.group_trip_participants
   where trip_id = new.trip_id
     and user_id is distinct from v_host;

  if v_others > 0 then
    raise exception
      'The waiver cannot be changed once travelers have joined (% on this trip). Signatures already given would be cancelled.',
      v_others
      using errcode = 'check_violation';
  end if;

  -- The one that actually prevents harm. Covers crew, who are not participants
  -- and are invisible to the count above.
  select count(*) into v_signed
    from public.group_trip_acknowledgements
   where trip_id = new.trip_id
     and operator_document_id is not null;

  if v_signed > 0 then
    raise exception
      'The waiver cannot be changed — % signature(s) have already been given against it.',
      v_signed
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

revoke execute on function public.guard_waiver_replacement()
  from public, anon, authenticated;

comment on function public.guard_waiver_replacement() is
  'Lets the operator replace a trip waiver only while the trip is empty: no '
  'participants besides the host, and no signatures from anyone (crew included, '
  'who sign the same document but are not participants).';

drop trigger if exists trg_guard_waiver_replacement
  on public.organized_trip_operator_documents;

create trigger trg_guard_waiver_replacement
  before update on public.organized_trip_operator_documents
  for each row execute function public.guard_waiver_replacement();

-- ── 2. Let `trip.edit` update the row at all ───────────────────────────────
-- Same subject as the insert policy. The trigger above is the state gate.

drop policy if exists "otod_update" on public.organized_trip_operator_documents;
create policy "otod_update" on public.organized_trip_operator_documents
  for update to authenticated
  using      (public.trip_staff_can(trip_id, 'trip.edit'))
  with check (public.trip_staff_can(trip_id, 'trip.edit'));
