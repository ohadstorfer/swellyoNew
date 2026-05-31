-- Drop orphan table public.message_edits.
-- It was never wired up: zero references in src/ or supabase/, no trigger or
-- function wrote to it, and it held 0 rows. Message editing in the app
-- overwrites the message row directly (edited flag/timestamp on `messages`),
-- so a separate edit-history table was never used. Applied 2026-05-27.

drop table if exists public.message_edits;
