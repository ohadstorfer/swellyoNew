-- An approved join request on a type-C trip does not mean "you're in".
--
-- `join_request_decided` was written for peer trips, where approval IS the
-- finish line: the person is a member, and the next thing they do is commit.
-- On an operator trip approval is the STARTING line — `enforce_participant_status`
-- drops them into `status='onboarding'`, they owe a deposit and every must_have
-- requirement, `activate_trip_membership` refuses to promote them until those
-- are done, and until then they cannot see the Plan tab at all.
--
-- So the one push in the flow that people actually act on told them the
-- opposite of the truth ("You're in! 🌊") and deep-linked to a tab they cannot
-- open. Verified against production on El Salvador 26: every approval on that
-- trip — Ganani 29 Jul, sababa 18 and 21 Jul — went out that way.
--
-- The renderer cannot know which kind of trip it is: the row carries only
-- `decision` and `trip_title`. This adds the one fact it needs, the same way
-- `trg_notify_trip_dates_changed` carries `has_deadlines` for exactly the same
-- reason — a boolean answering the question the copy has to ask, resolved here
-- where the trip row is already in hand.
--
-- A row written before this migration has no `needs_onboarding` key, and both
-- readers (dispatch-notification-queue/render.ts and notificationsService.ts)
-- treat absent as false — today's behaviour, which is the safe half.

create or replace function public.tg_notify_join_request_decided()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title  text;
  v_style  char(1);
begin
  if new.status is distinct from old.status
     and new.status in ('approved','declined') then

    select g.title, g.hosting_style
      into v_title, v_style
      from public.group_trips g
     where g.id = new.trip_id;

    insert into public.notifications
      (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
    values (
      new.requester_id, new.trip_id, 'join_request_decided', 'user',
      new.reviewed_by, 'join_request', new.id,
      jsonb_build_object(
        'decision',   new.status,
        'trip_title', v_title,
        -- Deliberately a boolean, not the raw `hosting_style`. Two readers have
        -- to agree on what it means, and "does this person still have an
        -- onboarding flow to finish" is the question both are actually asking —
        -- a letter would make each of them re-derive it, and disagree the first
        -- time a fourth hosting style appears.
        'needs_onboarding', (v_style = 'C')
      )
    );
  end if;
  return new;
end
$$;

-- ⚠️ CREATE OR REPLACE re-grants EXECUTE to PUBLIC. This function had a tight
-- ACL before this migration ({postgres, service_role} only, checked on prod
-- 2026-08-20) and must keep it — it is a SECURITY DEFINER function that writes
-- notifications, and PostgREST exposes anything `anon` can execute. Putting the
-- grants back is not optional cleanup; without it this migration widens them.
revoke execute on function public.tg_notify_join_request_decided() from public;
revoke execute on function public.tg_notify_join_request_decided() from anon;
revoke execute on function public.tg_notify_join_request_decided() from authenticated;
