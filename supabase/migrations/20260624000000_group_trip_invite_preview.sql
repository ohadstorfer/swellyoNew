-- ============================================================================
-- RPC: get_group_trip_invite_preview
-- ============================================================================
-- Anonymous-callable, whitelisted preview for the static invite site's link
-- preview (Open Graph). The Netlify edge function on swellyo-invite.netlify.app
-- calls this for `/?grouptrip=<id>` to inject the trip's hero image + title into
-- the og:image / og:title tags, so WhatsApp / iMessage / Telegram show the trip
-- photo instead of the generic Swellyo logo.
--
-- Mirrors get_surftrip_invite_preview (20260508000000): SECURITY DEFINER so it
-- can read past RLS (group_trips is authenticated-only), but it exposes nothing
-- beyond title / hero_image_url / host name / member count, and returns null
-- fields for missing or cancelled trips (don't leak existence).
-- ============================================================================
create or replace function public.get_group_trip_invite_preview(p_trip_id uuid)
returns json
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_trip public.group_trips;
  v_host_name text;
  v_count int;
begin
  select * into v_trip from public.group_trips where id = p_trip_id;

  -- Missing or no-longer-joinable trip → null fields (don't leak existence).
  if v_trip.id is null or v_trip.status = 'cancelled' then
    return json_build_object(
      'title', null,
      'hero_image_url', null,
      'host_display_name', null,
      'member_count', null
    );
  end if;

  select name into v_host_name
  from public.surfers where user_id = v_trip.host_id;

  select count(*) into v_count
  from public.group_trip_participants where trip_id = v_trip.id;

  return json_build_object(
    'title', v_trip.title,
    'hero_image_url', v_trip.hero_image_url,
    'host_display_name', v_host_name,
    'member_count', v_count
  );
end;
$$;

-- CREATE FUNCTION re-grants EXECUTE to PUBLIC by default; strip it, then grant
-- only anon + authenticated (the invite site calls this with the anon key).
revoke all on function public.get_group_trip_invite_preview(uuid) from public;
grant execute on function public.get_group_trip_invite_preview(uuid) to anon, authenticated;
