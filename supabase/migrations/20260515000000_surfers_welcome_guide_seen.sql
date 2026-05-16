-- Surfers: track whether the Swelly welcome guide (tutorial overlay) has been
-- shown to the user at least once. Replaces the prior AsyncStorage-only flag.
--
-- Why DB-backed: the AsyncStorage flag conflated "shown" with "completed" and
-- was scoped per-device, which made the trigger fragile (cross-device sync
-- broken, test accounts left in inconsistent states). NULL means the guide
-- has never been shown; a timestamp means it has.

ALTER TABLE public.surfers
  ADD COLUMN IF NOT EXISTS welcome_guide_seen_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.surfers.welcome_guide_seen_at IS
  'Set when the Swelly welcome guide has been shown to this user at least once. NULL = never seen, fires the guide on next Swelly chat open.';

-- Backfill: every user that already exists at migration time is treated as
-- "already seen" so the redesigned tutorial does not suddenly pop for users
-- who have been using the app for a while. New rows inserted after this
-- migration default to NULL and will see the guide on first Swelly open.
-- Devs can re-trigger the guide for themselves via the "Replay welcome guide"
-- dev button (clears AS cache + nullifies this column).
UPDATE public.surfers
   SET welcome_guide_seen_at = NOW()
 WHERE welcome_guide_seen_at IS NULL;
