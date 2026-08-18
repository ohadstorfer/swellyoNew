-- Staff search: skip demo accounts, and stop scanning the whole user table.
--
-- APPLIED to prod 2026-08-13 (schema_migrations version 20260813142905).
-- Verified: "eyal" went from 14 rows to 2, and EXPLAIN shows a Bitmap Index
-- Scan on surfers_name_trgm_real_idx instead of a Seq Scan on surfers.
--
-- Two changes, one query.
--
-- ── 1. Demo users never appear ──────────────────────────────────────────────
-- 448 of 681 surfers are `is_demo_user` today. They are seeded accounts that
-- nobody can actually invite to run a trip, and they crowd out the real people
-- an operator is looking for — a search for "eyal" returned 14 rows, most of
-- them seeds. The column is `boolean not null default false`, so a plain
-- `not s.is_demo_user` is exact; no null branch needed.
--
-- ── 2. The index the search never had ───────────────────────────────────────
-- `name ilike '%q%'` has a leading wildcard, so no btree can serve it: every
-- keystroke was a full seq scan of `surfers`. Harmless at 681 rows, linear in
-- the user table forever after, and it runs on a 250ms debounce while someone
-- types a name.
--
-- pg_trgm 1.6 is already installed (in `extensions`, which this function's
-- search_path includes), so a GIN trigram index serves ILIKE with wildcards on
-- both ends. Two details:
--   • It is an EXPRESSION index on `(name)::text`. `gin_trgm_ops` takes text,
--     not varchar(255), and a bare `(name gin_trgm_ops)` is rejected outright.
--     varchar→text is a binary-coercible relabel, which is exactly what the
--     planner already inserts for `name ilike text`, so the predicate matches.
--   • It is PARTIAL on `is_demo_user = false`. That is the same rows the
--     search can ever return, so the index is a third the size and the demo
--     filter costs nothing at query time.
--
-- A two-character query produces no trigrams and falls back to a seq scan.
-- That is the floor case and it is fine — 681 rows scanned beats loosening the
-- two-character guard, which exists to stop enumeration.

create index if not exists surfers_name_trgm_real_idx
  on public.surfers using gin ((name::text) extensions.gin_trgm_ops)
  where is_demo_user = false;

comment on index public.surfers_name_trgm_real_idx is
  'Serves search_users_for_staff''s `name ilike ''%q%''`. Partial on real '
  'accounts because that is all the search returns.';

create or replace function public.search_users_for_staff(
  p_trip_id uuid,
  p_query   text
)
returns table(user_id uuid, name text, profile_image_url text)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_q text := btrim(coalesce(p_query, ''));
begin
  if not exists (
    select 1 from public.group_trips
    where id = p_trip_id and host_id = auth.uid() and hosting_style = 'C'
  ) then
    raise exception 'Only the operator of this trip can search for crew'
      using errcode = '42501';
  end if;

  -- Two characters minimum. A one-character query returns a slice of the whole
  -- user table, which is the enumeration this guard exists to prevent.
  if length(v_q) < 2 then
    return;
  end if;

  return query
  select s.user_id, s.name::text, s.profile_image_url::text
    from public.surfers s
         -- Written as `= false`, not `not s.is_demo_user`, so it matches the
         -- partial index predicate verbatim and the planner can use the index.
   where s.is_demo_user = false
     and s.name ilike '%' || v_q || '%'
     and s.user_id <> auth.uid()
     -- Already crew on this trip.
     and not exists (
       select 1 from public.organized_trip_staff st
        where st.trip_id = p_trip_id and st.user_id = s.user_id
          and st.revoked_at is null
     )
     -- Already a traveler: staff and travelers are exclusive (I3), so offering
     -- them would only produce a trigger error at insert time.
     and not exists (
       select 1 from public.group_trip_participants p
        where p.trip_id = p_trip_id and p.user_id = s.user_id
     )
     -- Already has an invite waiting.
     and not exists (
       select 1 from public.organized_trip_staff_invites i
        where i.trip_id = p_trip_id and i.invited_user_id = s.user_id
          and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
     )
     -- Blocks, both directions.
     and not exists (
       select 1 from public.user_blocks b
        where (b.blocker_id = auth.uid() and b.blocked_id = s.user_id)
           or (b.blocker_id = s.user_id and b.blocked_id = auth.uid())
     )
   order by
     -- Prefix matches first: typing "mar" should surface Marta before Omar.
     case when s.name ilike v_q || '%' then 0 else 1 end,
     s.name
   limit 20;
end $$;

-- CREATE OR REPLACE re-grants EXECUTE to PUBLIC. Re-apply the lockdown, or
-- anon regains a user-search endpoint.
revoke execute on function public.search_users_for_staff(uuid, text) from public, anon;
grant  execute on function public.search_users_for_staff(uuid, text) to authenticated;
