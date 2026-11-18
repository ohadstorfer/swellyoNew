-- Explore search, server-side.
--
-- Until now the Explore search box filtered only the trips the phone had
-- already loaded, and only by title and place. That breaks once the catalogue
-- is bigger than a few pages. This moves search into explore_feed.
--
-- What is searched (one text "doc" per trip):
--   title, description (About), accommodation name, host name,
--   destination (name, short label, region, country),
--   surf levels, boards, vibe, trip structure, wave shapes
--   (each tag as its slug AND the words people type, e.g. softtop → "soft top").
--
-- How:
--   * group_trip_search_docs: one row per trip, the doc already normalized
--     (lower case, accents removed, punctuation → spaces). A side table, not a
--     column on group_trips, so keeping it fresh never fires group_trips'
--     own UPDATE triggers (notifications, realtime, updated_at).
--   * Kept fresh by triggers on group_trips, group_trip_destinations and
--     surfers.name (the host's name).
--   * GIN trigram index (pg_trgm) on the doc: `doc LIKE '%word%'` uses it, so
--     partial words work ("nica" → Nicaragua) and it stays fast as trips grow.
--   * explore_feed gets p_search. Every word typed must appear in the doc
--     (AND). Order and keyset pagination are unchanged.
--
-- Old clients: p_search has a default, so their 7-argument call still resolves.
-- Rebuilt from 20261105000000_explore_feed_cert_badges.sql (itself taken from
-- live on 2026-11-05). Diff against live before applying.

create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

-- ---------------------------------------------------------------------------
-- Normalizer — used for the doc AND the query, so both sides always match.
-- "Mid-length, Señor!" → "mid length senor"
-- ---------------------------------------------------------------------------
create or replace function public.search_normalize(p text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select btrim(regexp_replace(
    lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p, ''))),
    '[^[:alnum:]]+', ' ', 'g'
  ));
$$;

-- ---------------------------------------------------------------------------
-- Side table + index
-- ---------------------------------------------------------------------------
create table if not exists public.group_trip_search_docs (
  trip_id uuid primary key references public.group_trips(id) on delete cascade,
  doc text not null,
  updated_at timestamptz not null default now()
);

-- Read only through explore_feed (SECURITY DEFINER). No policies on purpose.
alter table public.group_trip_search_docs enable row level security;
revoke all on table public.group_trip_search_docs from public, anon, authenticated;

create index if not exists group_trip_search_docs_doc_trgm
  on public.group_trip_search_docs using gin (doc extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Build one trip's doc
-- ---------------------------------------------------------------------------
create or replace function public.group_trip_search_doc(p_trip_id uuid)
returns text
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select public.search_normalize(concat_ws(' ',
    gt.title,
    gt.description,
    gt.accommodation_name,
    s.name,
    d.name, d.short_label, d.admin_level_1, d.country,
    (select string_agg(case l::text
        when 'advanced' then 'advanced adv'
        when 'pro' then 'pro professional expert'
        when 'all' then 'all levels any level'
        else l::text end, ' ')
       from unnest(gt.target_surf_levels) l),
    (select string_agg(case b::text
        when 'shortboard' then 'shortboard short board'
        when 'midlength' then 'midlength mid length'
        when 'longboard' then 'longboard long board log'
        when 'softtop' then 'softtop soft top foamie'
        when 'all' then 'all boards any board'
        else b::text end, ' ')
       from unnest(gt.target_surf_styles) b),
    (select string_agg(case v::text
        when 'improve_surf' then 'improve your surfing training camp coaching'
        when 'surf_focused' then 'surf focused'
        when 'explore' then 'surf explore'
        when 'vacation' then 'vacation chill lay days'
        else v::text end, ' ')
       from unnest(gt.trip_vibes) v),
    (select string_agg(case t::text
        when 'shared_decisions' then 'shared decisions'
        when 'structured_schedule' then 'structured schedule'
        when 'loose_schedule' then 'loose schedule'
        when 'book_own_stay' then 'book your own accommodation'
        when 'book_together' then 'accommodation booked together'
        when 'group_all_day' then 'group together'
        when 'own_thing_day' then 'do your own thing'
        else t::text end, ' ')
       from unnest(gt.trip_structure) t),
    (select string_agg(w::text, ' ') from unnest(gt.wave_shapes) w)
  ))
  from public.group_trips gt
  left join public.surfers s on s.user_id = gt.host_id
  left join lateral (
    select dd.name, dd.short_label, dd.admin_level_1, dd.country
    from public.group_trip_destinations dd
    where dd.trip_id = gt.id
    limit 1
  ) d on true
  where gt.id = p_trip_id;
$$;

create or replace function public.refresh_group_trip_search_doc(p_trip_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_doc text;
begin
  if p_trip_id is null then
    return;
  end if;
  v_doc := public.group_trip_search_doc(p_trip_id);
  if v_doc is null then
    -- Trip is gone (e.g. mid-cascade delete).
    delete from public.group_trip_search_docs where trip_id = p_trip_id;
    return;
  end if;
  insert into public.group_trip_search_docs (trip_id, doc, updated_at)
  values (p_trip_id, v_doc, now())
  on conflict (trip_id) do update
    set doc = excluded.doc, updated_at = now()
    where public.group_trip_search_docs.doc is distinct from excluded.doc;
end;
$$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create or replace function public.trg_group_trips_search_doc()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  perform public.refresh_group_trip_search_doc(new.id);
  return null;
end;
$$;

drop trigger if exists group_trips_search_doc on public.group_trips;
create trigger group_trips_search_doc
  after insert or update of
    title, description, accommodation_name, host_id,
    target_surf_levels, target_surf_styles, trip_vibes, trip_structure, wave_shapes
  on public.group_trips
  for each row execute function public.trg_group_trips_search_doc();

create or replace function public.trg_group_trip_destinations_search_doc()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.refresh_group_trip_search_doc(old.trip_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.trip_id is distinct from old.trip_id) then
    perform public.refresh_group_trip_search_doc(new.trip_id);
  end if;
  return null;
end;
$$;

drop trigger if exists group_trip_destinations_search_doc on public.group_trip_destinations;
create trigger group_trip_destinations_search_doc
  after insert or update or delete on public.group_trip_destinations
  for each row execute function public.trg_group_trip_destinations_search_doc();

-- The host's name is part of the doc.
create or replace function public.trg_surfers_name_search_doc()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_trip uuid;
begin
  for v_trip in select gt.id from public.group_trips gt where gt.host_id = new.user_id loop
    perform public.refresh_group_trip_search_doc(v_trip);
  end loop;
  return null;
end;
$$;

drop trigger if exists surfers_name_search_doc on public.surfers;
create trigger surfers_name_search_doc
  after update of name on public.surfers
  for each row
  when (old.name is distinct from new.name)
  execute function public.trg_surfers_name_search_doc();

-- Internal only. Recreating a function re-grants EXECUTE to PUBLIC.
revoke all on function public.search_normalize(text) from public, anon, authenticated;
revoke all on function public.group_trip_search_doc(uuid) from public, anon, authenticated;
revoke all on function public.refresh_group_trip_search_doc(uuid) from public, anon, authenticated;
revoke all on function public.trg_group_trips_search_doc() from public, anon, authenticated;
revoke all on function public.trg_group_trip_destinations_search_doc() from public, anon, authenticated;
revoke all on function public.trg_surfers_name_search_doc() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Backfill every existing trip
-- ---------------------------------------------------------------------------
insert into public.group_trip_search_docs (trip_id, doc)
select gt.id, public.group_trip_search_doc(gt.id)
from public.group_trips gt
on conflict (trip_id) do update set doc = excluded.doc, updated_at = now();

-- ---------------------------------------------------------------------------
-- explore_feed + p_search
-- ---------------------------------------------------------------------------
drop function public.explore_feed(integer, timestamptz, uuid, text[], numeric, numeric, integer);

create function public.explore_feed(
  p_limit integer DEFAULT 10,
  p_cursor timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_cursor_id uuid DEFAULT NULL::uuid,
  p_months text[] DEFAULT NULL::text[],
  p_budget_min numeric DEFAULT NULL::numeric,
  p_budget_max numeric DEFAULT NULL::numeric,
  p_cursor_participant_count integer DEFAULT NULL::integer,
  p_search text DEFAULT NULL::text
)
 RETURNS TABLE(id uuid, host_id uuid, status text, hosting_style text, title text, hero_image_url text, start_date date, end_date date, dates_set_in_stone boolean, date_months text[], cost_per_person numeric, budget_min numeric, budget_max numeric, budget_fx_rate numeric, budget_currency text, max_participants integer, participant_count integer, created_at timestamp with time zone, destination jsonb, host_name text, host_avatar text, member_avatars text[], target_surf_levels text[], trip_vibes text[], stoke_certified boolean, ci_surf_conservation boolean)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  -- Search words: normalized like the doc, at most 8, longest first. The
  -- longest one drives the trigram index; the rest are checked on those rows.
  WITH srch AS (
    SELECT array_agg('%' || w || '%' ORDER BY length(w) DESC) AS patterns
    FROM (
      SELECT DISTINCT w
      FROM unnest(string_to_array(public.search_normalize(left(p_search, 100)), ' ')) AS w
      WHERE w <> ''
      LIMIT 8
    ) words
  ),
  hits AS (
    SELECT sd.trip_id
    FROM public.group_trip_search_docs sd, srch
    WHERE srch.patterns IS NOT NULL
      AND sd.doc LIKE srch.patterns[1]
      AND sd.doc LIKE ALL (srch.patterns)
  )
  SELECT gt.id, gt.host_id, gt.status, gt.hosting_style, gt.title, gt.hero_image_url,
         gt.start_date, gt.end_date, gt.dates_set_in_stone, gt.date_months,
         gt.cost_per_person, gt.budget_min, gt.budget_max, gt.budget_fx_rate,
         gt.budget_currency,
         gt.max_participants, gt.participant_count, gt.created_at,
         (SELECT jsonb_build_object('name', d.name, 'short_label', d.short_label,
                   'country', d.country, 'admin_level_1', d.admin_level_1,
                   'lat', d.lat, 'lng', d.lng)
            FROM public.group_trip_destinations d WHERE d.trip_id = gt.id) AS destination,
         s.name AS host_name, s.profile_image_url AS host_avatar,
         (SELECT array_agg(sub.av) FROM (
              SELECT s2.profile_image_url AS av FROM public.group_trip_participants p
              JOIN public.surfers s2 ON s2.user_id = p.user_id
              WHERE p.trip_id = gt.id AND s2.profile_image_url IS NOT NULL
              ORDER BY (p.user_id = gt.host_id) DESC, p.user_id LIMIT 4) sub) AS member_avatars,
         gt.target_surf_levels, gt.trip_vibes,
         gt.stoke_certified, gt.ci_surf_conservation
  FROM public.group_trips gt
  LEFT JOIN public.surfers s ON s.user_id = gt.host_id
  CROSS JOIN srch
  CROSS JOIN LATERAL (
    SELECT COALESCE(
      p_cursor_participant_count,
      (SELECT g2.participant_count FROM public.group_trips g2 WHERE g2.id = p_cursor_id)
    ) AS pc
  ) cur
  WHERE gt.status = 'active'
    AND (gt.visibility IS NULL OR gt.visibility = 'public')
    AND (srch.patterns IS NULL OR gt.id IN (SELECT hits.trip_id FROM hits))
    AND (
      p_cursor IS NULL
      OR gt.participant_count < cur.pc
      OR (gt.participant_count = cur.pc AND gt.created_at < p_cursor)
      OR (gt.participant_count = cur.pc AND gt.created_at = p_cursor AND gt.id < p_cursor_id)
    )
    AND (
      p_months IS NULL OR array_length(p_months, 1) IS NULL
      OR gt.date_months && p_months
      OR (
        gt.start_date IS NOT NULL AND gt.end_date IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM unnest(p_months) AS m(ym)
          WHERE m.ym >= to_char(gt.start_date, 'YYYY-MM')
            AND m.ym <= to_char(gt.end_date, 'YYYY-MM')
        )
      )
    )
    AND (
      (p_budget_min IS NULL AND p_budget_max IS NULL)
      OR (
        (gt.cost_per_person IS NOT NULL OR gt.budget_min IS NOT NULL OR gt.budget_max IS NOT NULL)
        AND (
          (p_budget_max IS NOT NULL AND
             COALESCE(gt.cost_per_person, gt.budget_min, gt.budget_max) <= p_budget_max)
          OR (p_budget_min IS NOT NULL AND
             COALESCE(gt.cost_per_person, gt.budget_max, gt.budget_min) >= p_budget_min)
        )
      )
    )
  ORDER BY gt.participant_count DESC, gt.created_at DESC, gt.id DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 50);
$function$;

-- Recreating a function re-grants EXECUTE to PUBLIC; match live grants.
revoke all on function public.explore_feed(integer, timestamptz, uuid, text[], numeric, numeric, integer, text) from public, anon;
grant execute on function public.explore_feed(integer, timestamptz, uuid, text[], numeric, numeric, integer, text) to authenticated, service_role;
