-- ============================================================================
-- notification_templates — editable notification texts (push + bell).
--
-- One row per notification "key" (type, or type:variant for decision/stage
-- splits). Placeholders are substituted at render time:
--   {trip}    trip title              {actor}  who did it
--   {item}    gear item name          {qty}    claimed quantity
--   {preview} update message preview  {days}   days before the trip (nudges)
--
-- Readers:
--   • dispatch-notification-queue (service role) → push_title / push_body
--   • the app's bell renderer (authenticated)    → bell_title / bell_body
-- Both fall back to the hardcoded defaults when a row/field is missing,
-- so this table can never break notifications.
--
-- Editing: notification-texts-editor.html (project root) generates the
-- UPDATE statements. push changes apply within ~1 min; bell changes apply
-- on next app launch.
-- ============================================================================

create table if not exists public.notification_templates (
  key        text primary key,
  push_title text,           -- null on bell-only types
  push_body  text,
  bell_title text,
  bell_body  text,
  updated_at timestamptz not null default now()
);

alter table public.notification_templates enable row level security;
revoke all on public.notification_templates from anon, authenticated;
grant select on public.notification_templates to authenticated;
drop policy if exists notification_templates_read on public.notification_templates;
create policy notification_templates_read on public.notification_templates
  for select to authenticated using (true);

-- Seed with the current texts (idempotent — never overwrites later edits).
insert into public.notification_templates (key, push_title, push_body, bell_title, bell_body) values
  ('join_request_received',          'New trip request',          '{actor} wants to join {trip}',                    'New join request',         '{actor} asked to join {trip}.'),
  ('join_request_decided:approved',  'You''re in! 🌊',            'Your request to join {trip} was approved',        'Request approved',         'Your request to join {trip} was approved.'),
  ('join_request_decided:declined',  'Trip request update',       'Your request for {trip} wasn''t accepted this time','Request declined',        'Your request to join {trip} was declined.'),
  ('commitment_request_received',    'Commit request',            '{actor} wants to commit to {trip}',               'New commitment request',   '{actor} wants to commit to {trip}.'),
  ('commitment_decided:approved',    'You''re locked in 🤙',      'Your commitment to {trip} was approved',          'Commitment approved',      'Your commitment was approved.'),
  ('commitment_decided:declined',    null,                        null,                                              'Commitment declined',      'Your commitment was declined.'),
  ('member_committed',               '{trip}',                    '{actor} just committed — the group is filling up','New commitment',           '{actor} committed to {trip}.'),
  ('gear_request_received',          'Gear request',              '{actor} proposed "{item}" for {trip}',            'New gear request',         '{actor} requested {item}.'),
  ('gear_request_decided:approved',  'Gear approved',             '"{item}" was added — claim it in {trip}',         'Gear request approved',    'Your request for {item} was approved.'),
  ('gear_request_decided:declined',  'Gear update',               '"{item}" wasn''t added to {trip}',                'Gear request declined',    'Your request for {item} was declined.'),
  ('admin_update_posted',            'Update in {trip}',          '{preview}',                                       'New trip update',          '{preview}'),
  ('group_gear_updated',             'Gear list updated',         'The group gear list changed in {trip}',           'Group gear updated',       'The group gear list for {trip} changed.'),
  ('personal_gear_updated',          'Your packing list',         'Your packing list for {trip} was updated',        'Your gear updated',        'Your gear list for {trip} was updated.'),
  ('member_left',                    'A spot opened',             '{actor} left {trip} — invite or refill',          'A member left',            '{actor} left {trip}.'),
  ('trip_cancelled',                 'Trip cancelled',            '{trip} was cancelled — see why',                  'Trip cancelled',           '{trip} was cancelled.'),
  ('member_removed',                 'Trip update',               'You''re no longer part of {trip}',                'Removed from trip',        'You''re no longer part of {trip}.'),
  ('trip_reminder:week',             '{trip} — 1 week to go',     'Get ready — packing list inside',                 'Trip reminder',            '{trip} is coming up.'),
  ('trip_reminder:tomorrow',         '{trip} is tomorrow!',       'Final details + meeting point inside',            'Trip tomorrow',            '{trip} starts tomorrow.'),
  ('trip_reminder:today',            '{trip} starts today',       'Have a great trip',                               'Trip today',               '{trip} starts today.'),
  ('trip_reminder:commit',           'Lock your spot in {trip}',  '{days} days out — commit now',                    'Lock your spot',           'Commit to {trip} before it fills up.'),
  ('trip_reminder:gear',             '{trip}: gear still needed', 'Some items still need an owner',                  'Gear still needed',        'Some gear for {trip} still needs an owner.'),
  ('trip_ended',                     '{trip} — that''s a wrap',   'Share your photos & memories',                    'Trip ended',               'Share your photos & memories from {trip}.'),
  ('member_joined',                  null,                        null,                                              'New member',               '{actor} joined {trip}.'),
  ('gear_claimed',                   null,                        null,                                              'Gear claimed',             '{actor} claimed {qty} {item}.')
on conflict (key) do nothing;
