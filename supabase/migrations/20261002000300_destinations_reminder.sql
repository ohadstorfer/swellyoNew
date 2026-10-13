-- Reminder for people who skipped "Where have you traveled?" in onboarding.
--
-- Two sends, then silence for good: 3 days after they finish onboarding, and
-- again at 7 days if the list is still empty. Not sooner — they chose to skip
-- minutes ago, and a push the same day argues with a decision they just made.
--
-- ⚠️ ONLY PEOPLE WHO FINISH ONBOARDING AFTER THIS MIGRATION. The cutoff below is
-- deliberate: ~100 existing users have no destinations, and without it the
-- first run would push every one of them at once.
--
-- No edge function. The scan is plain SQL on an hourly cron; it writes
-- `notifications` rows and the existing enqueue trigger turns them into queue
-- rows with quiet-hours `send_after`. The push copy is a `notification_templates`
-- row, which the dispatcher reads before its own renderer — so nothing needs
-- deploying for the push to say the right thing.

-- 1. Where each person is: 0 = nothing sent, 1 = the 3-day one, 2 = the 7-day one.
alter table public.surfers
  add column if not exists destinations_reminder_stage smallint not null default 0;

-- 2. Push priority 1 = sent, but held for quiet hours. Patched into the LIVE
--    definition (it drifts from the repo) rather than restated here.
do $$
declare
  v_def text := pg_get_functiondef('public.notification_push_priority(public.notification_type, jsonb)'::regprocedure);
  v_new text;
begin
  if v_def like '%profile_destinations_missing%' then
    return;
  end if;
  v_new := regexp_replace(
    v_def,
    '(\s+)else -1(\s+)end::smallint',
    E'\\1when ''profile_destinations_missing'' then 1\\1else -1\\2end::smallint'
  );
  if v_new not like '%profile_destinations_missing%' then
    raise exception 'notification_push_priority: could not find the else branch to patch';
  end if;
  execute v_new;
end $$;

-- 3. The copy. One text for both sends: the template key is the type.
--    The BELL text is set here too, on purpose: apps installed before this
--    type existed do not know it, and would draw the row as a blank
--    "Notification". Every build reads bell texts from this table first, so the
--    row reads correctly on old and new apps alike.
insert into public.notification_templates (key, push_title, push_body, bell_title, bell_body)
values (
  'profile_destinations_missing',
  'Where have you surfed?',
  'Add your surf trips to your profile to match with surfers who know the same spots.',
  'Where have you surfed?',
  'Add your surf trips to your profile to match with surfers who know the same spots.'
)
on conflict (key) do update
  set bell_title = excluded.bell_title,
      bell_body  = excluded.bell_body;

-- 4. The scan.
create or replace function public.scan_destination_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_sent integer := 0;
begin
  for r in
    with due as (
      select s.user_id,
             -- Derived from the clock, not from what we sent last: someone first
             -- seen at day 8 gets ONE message (the 7-day one), not two.
             case when now() - s.onboarding_completed_at >= interval '7 days' then 2 else 1 end as stage
      from public.surfers s
      where s.finished_onboarding
        and coalesce(s.is_demo_user, false) = false
        -- "Only from now on" — see the warning at the top.
        and s.onboarding_completed_at >= timestamptz '2026-10-02 13:45:00+00'
        and s.onboarding_completed_at <= now() - interval '3 days'
        -- If the cron was down for weeks, do not wake people up about it.
        and s.onboarding_completed_at > now() - interval '14 days'
        and s.destinations_reminder_stage < 2
        and (
          s.destinations_array is null
          or jsonb_typeof(s.destinations_array) <> 'array'
          or jsonb_array_length(s.destinations_array) = 0
        )
    )
    -- Claim before sending: a second run finds the stage already raised and
    -- matches nothing, so a retry loses a nudge rather than doubling a push.
    update public.surfers s
       set destinations_reminder_stage = d.stage
      from due d
     where s.user_id = d.user_id
       and s.destinations_reminder_stage < d.stage
    returning s.user_id, d.stage
  loop
    insert into public.notifications (recipient_id, type, audience, data)
    values (
      r.user_id,
      'profile_destinations_missing',
      'user',
      jsonb_build_object('stage', case r.stage when 1 then '3d' else '7d' end)
    );
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end $$;

revoke all on function public.scan_destination_reminders() from public, anon, authenticated;
grant execute on function public.scan_destination_reminders() to service_role;

-- 5. Hourly, so the push lands near the hour of day they finished onboarding.
select cron.unschedule(jobid) from cron.job where jobname = 'scan-destination-reminders-hourly';
select cron.schedule(
  'scan-destination-reminders-hourly',
  '50 * * * *',
  $cron$select public.scan_destination_reminders()$cron$
);
