-- Operator Trips — the `updates.send` capability.
--
-- Spec: docs/specs/operator-trips/staff-gaps-spec-and-plan.md (Phase B)
--
-- WHY: posting an admin update is gated `trip.edit`
-- (20260807000100 §2, "Admin updates"). The Guide tier's own blurb promises
-- "Adds chat, updates, stats" — but the seed gives Guide no `trip.edit`, so a
-- Guide's insert is refused. Granting `trip.edit` would also hand them the
-- whole edit screen (dates, description, requirements, join requests). Wrong
-- tool. So: one narrow capability that means exactly "may post an update".
--
-- Peer trips do not move: trip_staff_can() falls back to is_trip_host() on any
-- trip that is not hosting_style = 'C', so `trip.edit OR updates.send` is
-- `is_trip_host OR is_trip_host` there — byte-identical behaviour.
--
-- Client half (already shipped, harmless before this runs — the capability is
-- simply never in anyone's set, so the button never appears):
--   - useTripCapabilities.ts adds 'updates.send' to the type union
--   - TripDetailScreen gates "+ Add update" on it
--
-- ✅ APPLIED to prod 2026-08-17 (by Claude, on Ohad's explicit say-so this
--    session — the standing convention is still that Ohad applies these by
--    hand). Ran as one transaction via MCP execute_sql rather than
--    apply_migration, so the frozen supabase_migrations history is untouched,
--    exactly as pasting into the SQL editor would be.
--    Verified before: live policies and the seeded tiers matched this repo
--    byte-for-byte, no CHECK constrains capability names, and trip_staff_can()
--    is a plain `= any(capabilities)` so an unknown key reads false.
--    Verified after: guide's array now ends with 'updates.send'; the other
--    four tiers unchanged; the three policies read as written below.

-- ── 1. The three policies ───────────────────────────────────────────────────

-- Insert: author + either capability.
drop policy if exists "admin_updates host can insert" on public.group_trip_admin_updates;
create policy "admin_updates host can insert" on public.group_trip_admin_updates
  for insert to authenticated
  with check (auth.uid() = author_id
              and (public.trip_staff_can(trip_id, 'trip.edit')
                   or public.trip_staff_can(trip_id, 'updates.send')));

-- Update / delete: the author fixes their own update; `trip.edit` (the
-- operator, a Manager) moderates anyone's. A Guide does NOT get to edit the
-- operator's updates — `updates.send` is deliberately absent from these two.
-- The author clause is new but adds nobody: before today every author WAS a
-- trip.edit holder, so the set of allowed rows is unchanged on existing data.
drop policy if exists "admin_updates host can update" on public.group_trip_admin_updates;
create policy "admin_updates host can update" on public.group_trip_admin_updates
  for update to authenticated
  using      (auth.uid() = author_id or public.trip_staff_can(trip_id, 'trip.edit'))
  with check (auth.uid() = author_id or public.trip_staff_can(trip_id, 'trip.edit'));

drop policy if exists "admin_updates host can delete" on public.group_trip_admin_updates;
create policy "admin_updates host can delete" on public.group_trip_admin_updates
  for delete to authenticated
  using (auth.uid() = author_id or public.trip_staff_can(trip_id, 'trip.edit'));

-- ── 2. Seed it into the global Guide row ────────────────────────────────────
-- Guide only, per the seed's own blurb. Handing it to Crew ("present but
-- silent") is one more UPDATE the day Eyal decides that — no release needed,
-- which is the whole point of capabilities-as-data.
-- Idempotent: @> guards a re-run from appending a duplicate.
update public.organized_trip_staff_roles
set capabilities = array_append(capabilities, 'updates.send')
where role_key = 'guide'
  and operator_id is null
  and not capabilities @> array['updates.send'];

-- ── Verify ──────────────────────────────────────────────────────────────────
-- select role_key, capabilities from public.organized_trip_staff_roles
--   where operator_id is null order by tier;
-- -- expect: guide's array now ends with 'updates.send'; nobody else moved.
-- select polname, pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)
--   from pg_policy where polrelid = 'public.group_trip_admin_updates'::regclass;
