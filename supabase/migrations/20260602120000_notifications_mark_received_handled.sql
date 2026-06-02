-- ============================================================================
-- Mark "*_request_received" notifications handled when their source request is
-- decided ANYWHERE (chat, trip screen, notification panel, …), not only when an
-- admin uses the inline Approve/Decline buttons in the notification panel.
--
-- Problem: the panel hides the inline Approve/Decline buttons based on the
-- notification's `handled_at`. That column was only stamped by the panel's own
-- handler, so deciding a request from the chat or trip screen left the matching
-- admin notification looking actionable forever (stale buttons).
--
-- Fix: when a join / gear / commitment request leaves 'pending', stamp
-- `handled_at = now()` on the corresponding `*_request_received` notification(s)
-- for every admin, and record the outcome in `data.decision` for the status
-- label. This rides the existing realtime UPDATE stream, so an open panel
-- updates live; a closed one is correct on next open.
--
-- REPLICA IDENTITY FULL + supabase_realtime publication for `notifications`
-- were already set in 20260601010000_notification_center.sql.
-- ============================================================================

-- ── join_request_received ───────────────────────────────────────────────────
create or replace function public.tg_mark_join_received_handled()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status and new.status <> 'pending' then
    update public.notifications
       set handled_at = now(),
           data = case when new.status in ('approved','declined')
                       then data || jsonb_build_object('decision', new.status)
                       else data end
     where type = 'join_request_received'
       and entity_id = new.id
       and handled_at is null;
  end if;
  return new;
end $$;
drop trigger if exists trg_join_received_handled on public.group_trip_join_requests;
create trigger trg_join_received_handled
  after update of status on public.group_trip_join_requests
  for each row execute function public.tg_mark_join_received_handled();

-- ── gear_request_received ────────────────────────────────────────────────────
create or replace function public.tg_mark_gear_received_handled()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status and new.status <> 'pending' then
    update public.notifications
       set handled_at = now(),
           data = case when new.status in ('approved','declined')
                       then data || jsonb_build_object('decision', new.status)
                       else data end
     where type = 'gear_request_received'
       and entity_id = new.id
       and handled_at is null;
  end if;
  return new;
end $$;
drop trigger if exists trg_gear_received_handled on public.group_trip_gear_requests;
create trigger trg_gear_received_handled
  after update of status on public.group_trip_gear_requests
  for each row execute function public.tg_mark_gear_received_handled();

-- ── commitment_request_received ──────────────────────────────────────────────
create or replace function public.tg_mark_commitment_received_handled()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status and new.status <> 'pending' then
    update public.notifications
       set handled_at = now(),
           data = case when new.status in ('approved','declined')
                       then data || jsonb_build_object('decision', new.status)
                       else data end
     where type = 'commitment_request_received'
       and entity_id = new.id
       and handled_at is null;
  end if;
  return new;
end $$;
drop trigger if exists trg_commitment_received_handled on public.group_trip_commitment_requests;
create trigger trg_commitment_received_handled
  after update of status on public.group_trip_commitment_requests
  for each row execute function public.tg_mark_commitment_received_handled();

-- ----------------------------------------------------------------------------
-- Backfill: any already-decided request whose received notification is still
-- unhandled (e.g. the commitment Eyal had approved from the chat).
-- ----------------------------------------------------------------------------
update public.notifications n
   set handled_at = now(),
       data = case when r.status in ('approved','declined')
                   then n.data || jsonb_build_object('decision', r.status)
                   else n.data end
  from public.group_trip_join_requests r
 where n.type = 'join_request_received'
   and n.entity_id = r.id
   and n.handled_at is null
   and r.status <> 'pending';

update public.notifications n
   set handled_at = now(),
       data = case when r.status in ('approved','declined')
                   then n.data || jsonb_build_object('decision', r.status)
                   else n.data end
  from public.group_trip_gear_requests r
 where n.type = 'gear_request_received'
   and n.entity_id = r.id
   and n.handled_at is null
   and r.status <> 'pending';

update public.notifications n
   set handled_at = now(),
       data = case when r.status in ('approved','declined')
                   then n.data || jsonb_build_object('decision', r.status)
                   else n.data end
  from public.group_trip_commitment_requests r
 where n.type = 'commitment_request_received'
   and n.entity_id = r.id
   and n.handled_at is null
   and r.status <> 'pending';
