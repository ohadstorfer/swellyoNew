-- Cancelling a managed trip says nothing about the money.
--
-- Two fixes to one trigger.
--
-- 1. THE REFUND. `trip-cancel` (2026-08-19) refunds every traveler in full when
--    the operator cancels — the frozen cancellation policy governs a traveler
--    who backs out, not this. But `trip_cancelled` carries only `trip_title`,
--    so the push reads "X was cancelled by the admin — see why" and leaves
--    someone who paid $3,000 to guess.
--
--    `member_removed` already solved exactly this, and its comment says why:
--    "Someone who is removed AND refunded will otherwise write in to ask where
--    their money is, and the person who removed them is the last one they want
--    to ask." A cancel is that case times the whole roster.
--
--    The ordering makes it computable. `trip-cancel` cancels FIRST — which is
--    what fires this trigger — and refunds afterwards, so at this moment the
--    ledger still holds exactly what each traveler paid, and the rule is that
--    all of it comes back. Same `is_livemode` gate as
--    `operator_stalled_onboarders`, so test-mode rows never quote a real number
--    at anyone (and vice versa).
--
--    Follows `member_removed`'s convention exactly: `refund_usd` is OMITTED,
--    never zero, when nothing is coming back. Readers treat absent as "say
--    nothing about money", so peer trips and unpaid travelers are unchanged.
--
-- 2. THE CO-HOST. `p.user_id <> new.host_id` predates multi-host
--    (20260708000000). `group_trips.host_id` is only the PRIMARY host, so every
--    promoted co-host was told their own trip had been cancelled "by the
--    admin". `trg_notify_trip_dates_changed` already filters on `p.role <>
--    'host'` and its comment names this function as the one still doing it the
--    old way. Now it does not.
--
-- Also wraps the whole thing in the same non-fatal handler
-- `tg_notify_trip_dates_changed` uses. This trigger had none, so a failed
-- notification INSERT aborted the UPDATE that fired it — and that UPDATE is
-- what closes the door on new payments (`payments-checkout` 409s on a
-- non-active trip). Losing a push is bad; leaving a cancelled trip payable
-- because a push failed is worse.

create or replace function public.tg_notify_trip_cancelled()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title    text;
  v_livemode boolean;
begin
  if new.status = 'cancelled' and new.status is distinct from old.status then
    begin
      v_title := new.title;
      v_livemode := coalesce(
        nullif(current_setting('app.stripe_livemode', true), '')::boolean,
        false);

      -- Members, excluding anyone running the trip.
      insert into public.notifications
        (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
      select
        p.user_id, new.id, 'trip_cancelled', 'user', new.host_id, 'group_trip', new.id,
        jsonb_build_object('trip_title', v_title)
        || case
             when new.payment_mode = 'managed' and coalesce(paid.net, 0) > 0
               then jsonb_build_object('refund_usd', paid.net)
             else '{}'::jsonb
           end
      from public.group_trip_participants p
      left join lateral (
        select sum(e.amount_usd) as net
          from public.organized_trip_payment_events e
         where e.trip_id     = new.id
           and e.user_id     = p.user_id
           and e.is_livemode = v_livemode
      ) paid on true
      where p.trip_id = new.id
        and p.role <> 'host';

      -- Pending requesters. Never any money — they were never approved, so
      -- nothing was ever charged. Excluded from the refund shape entirely
      -- rather than sent a zero.
      insert into public.notifications
        (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
      select jr.requester_id, new.id, 'trip_cancelled', 'user', new.host_id, 'group_trip', new.id,
             jsonb_build_object('trip_title', v_title)
      from public.group_trip_join_requests jr
      where jr.trip_id = new.id
        and jr.status = 'pending'
        and jr.requester_id <> new.host_id
        and not exists (
          select 1 from public.group_trip_participants p
           where p.trip_id = new.id and p.user_id = jr.requester_id
        );

    exception when others then
      -- The cancellation itself must land: it is what stops new payments.
      raise warning
        'tg_notify_trip_cancelled: could not notify trip % (%)', new.id, sqlerrm;
    end;
  end if;
  return new;
end
$$;

revoke execute on function public.tg_notify_trip_cancelled() from public;
revoke execute on function public.tg_notify_trip_cancelled() from anon;
revoke execute on function public.tg_notify_trip_cancelled() from authenticated;
