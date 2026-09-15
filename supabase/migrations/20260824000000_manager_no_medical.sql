-- ═══════════════════════════════════════════════════════════════════════════
-- A Manager no longer reads the Medical Card.
--
-- Decided 24 Aug 2026, and it restores the answer the design partners gave in
-- the first place. Figma Notes card 10 (Q1/Q2) asked who can see a traveler's
-- complete Medical Card and the answer was "the traveler himself, and the
-- trips operator only". The 5-tier matrix in 20260807000000 gave it to Manager
-- and up instead, on the reasoning that "a manager tells a guide if there is
-- something they need to know" (see the comment above medical_operator_select
-- in 20260807000100). That is overruled. Allergies, medication, injuries and
-- an emergency contact are a medical record; the person who owns the trip is
-- the only one who needs it, and every extra pair of eyes is a decision
-- somebody has to be able to justify.
--
-- ONE ROW IS THE WHOLE CHANGE. Nothing is hardcoded: the RLS policy on
-- organized_trip_medical_forms reads `trip_staff_can(trip_id, 'medical.view')`
-- and every screen asks `can('medical.view')`, so removing the capability shuts
-- the door in the database and hides it in both apps at once. There is no
-- client release tied to this.
--
-- THE OPERATOR IS UNAFFECTED. The operator of record is granted everything by
-- trip_staff_can() itself, from `group_trips.host_id`, not from a role row —
-- so their access survives regardless of what this table says.
--
-- WHAT A MANAGER KEEPS: documents (view, approve, reject, export), payments,
-- the roster, editing the trip, removing travelers. Only the medical form goes.
--
-- ⚠️ PER-OPERATOR SETS. `operator_id is not null` rows are a Phase 3 idea and
-- none exist today; this statement covers them anyway so the rule holds for
-- every manager, not just the default one. If per-operator sets ever become
-- editable, whoever builds that has to decide whether 'medical.view' is
-- grantable at all — this migration only cleans up what exists now.
-- ═══════════════════════════════════════════════════════════════════════════

update public.organized_trip_staff_roles
   set capabilities = array_remove(capabilities, 'medical.view'),
       blurb        = 'Runs the trip. Docs, payments, roster — not medical.',
       updated_at   = now()
 where role_key = 'manager'
   and 'medical.view' = any(capabilities);

-- Belt and braces: prove the door is shut for Manager and still open for the
-- Operator. Raises rather than returning a row, so applying this against a
-- database where something else re-granted it fails loudly instead of quietly
-- leaving a medical record readable.
do $$
declare
  v_manager_has boolean;
  v_operator_has boolean;
begin
  select bool_or('medical.view' = any(capabilities)) into v_manager_has
    from public.organized_trip_staff_roles where role_key = 'manager';
  select bool_or('medical.view' = any(capabilities)) into v_operator_has
    from public.organized_trip_staff_roles where role_key = 'operator';

  if coalesce(v_manager_has, false) then
    raise exception 'manager still holds medical.view';
  end if;
  if not coalesce(v_operator_has, false) then
    raise exception 'operator lost medical.view — that was not the intent';
  end if;
end;
$$;
