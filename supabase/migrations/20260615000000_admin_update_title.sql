-- Admin updates: split into a short title + an optional description.
-- Previously a single `body` column held the whole update. From now on every
-- update has a title; the Plan-tab preview shows ONLY the title, and the full
-- title + description shows in the detail overlay and the Updates screen.
-- `body` keeps holding the description (now optional).

alter table public.group_trip_admin_updates
  add column if not exists title text not null default '';

-- Backfill legacy single-field rows: use the old body as the title (trimmed for
-- the one-line preview) while keeping the full text as the description.
update public.group_trip_admin_updates
  set title = left(body, 60)
  where title = '' and body is not null and body <> '';

-- Push preview now prefers the title (falls back to the description for any
-- legacy row without one). Everything else matches the original trigger.
create or replace function public.tg_notify_admin_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_trip_title text; v_host uuid; v_name text;
begin
  select title, host_id into v_trip_title, v_host from public.group_trips where id = new.trip_id;
  v_name := public.user_display_name(new.author_id);
  insert into public.notifications (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
  select p.user_id, new.trip_id, 'admin_update_posted',
         case when p.user_id = v_host or p.role = 'admin' then 'admin' else 'user' end,
         new.author_id, 'admin_update', new.id,
         jsonb_build_object('actor_name', v_name, 'trip_title', v_trip_title,
           'preview', left(coalesce(nullif(new.title, ''), new.body), 140))
  from public.group_trip_participants p
  where p.trip_id = new.trip_id and p.user_id <> new.author_id;
  return new;
end $$;
