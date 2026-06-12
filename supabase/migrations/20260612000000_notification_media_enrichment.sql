-- Notification media enrichment
-- =============================================================================
-- Stores the actor's avatar + the trip cover image on every notification's
-- `data` snapshot so the bell UI can render real (stacked) photos instead of an
-- initial/icon.
--
-- WHY A SINGLE BEFORE-INSERT TRIGGER (not edits to the ~14 per-type trigger
-- functions): this fires for EVERY row that lands in public.notifications,
-- regardless of which source trigger or the dispatcher inserted it. It covers
-- all current notification types and any future ones automatically, with zero
-- churn in the existing functions.
--
-- Both fields are looked up from the row's own actor_id / trip_id:
--   actor_avatar_url <- surfers.profile_image_url  (user_id = actor_id)
--   trip_image_url   <- group_trips.hero_image_url  (id      = trip_id)
--
-- Frozen at insert time (same contract as the rest of `data`): if the actor
-- later changes their photo, existing notifications keep the photo as it was.
-- =============================================================================

create or replace function public.tg_enrich_notification_media()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_avatar     text;
  v_trip_image text;
begin
  if new.actor_id is not null then
    select s.profile_image_url
      into v_avatar
      from public.surfers s
     where s.user_id = new.actor_id;
  end if;

  if new.trip_id is not null then
    select gt.hero_image_url
      into v_trip_image
      from public.group_trips gt
     where gt.id = new.trip_id;
  end if;

  -- Enrichment wins over any pre-existing keys; null values are dropped so we
  -- never store empty keys (the client checks presence).
  new.data := coalesce(new.data, '{}'::jsonb)
    || jsonb_strip_nulls(jsonb_build_object(
         'actor_avatar_url', v_avatar,
         'trip_image_url',   v_trip_image
       ));

  return new;
end;
$$;

-- Trigger invocation does not require EXECUTE; lock it down (security hardening).
revoke execute on function public.tg_enrich_notification_media() from public, anon, authenticated;

drop trigger if exists enrich_notification_media on public.notifications;
create trigger enrich_notification_media
  before insert on public.notifications
  for each row
  execute function public.tg_enrich_notification_media();

-- One-time backfill so existing bell rows show photos immediately (recent only).
update public.notifications n
   set data = coalesce(n.data, '{}'::jsonb)
     || jsonb_strip_nulls(jsonb_build_object(
          'actor_avatar_url',
            (select s.profile_image_url from public.surfers s where s.user_id = n.actor_id),
          'trip_image_url',
            (select gt.hero_image_url from public.group_trips gt where gt.id = n.trip_id)
        ))
 where n.created_at > now() - interval '30 days';
