-- 20260713000000_trip_invites_enum.sql
alter type public.notification_type add value if not exists 'trip_invite_received';
alter type public.notification_type add value if not exists 'trip_invite_accepted';
alter type public.notification_type add value if not exists 'trip_invite_declined';
