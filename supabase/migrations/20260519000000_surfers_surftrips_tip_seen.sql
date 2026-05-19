-- Surfers: track whether the one-time "Surf Trips tab" coach-mark (a tutorial
-- overlay on the home screen) has been shown to the user.
--
-- Mirrors welcome_guide_seen_at: NULL means the tip has never been shown and
-- it fires once the next time the home screen is the front-most layer; a
-- timestamp means it has been shown and never fires again.

ALTER TABLE public.surfers
  ADD COLUMN IF NOT EXISTS surftrips_tip_seen_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.surfers.surftrips_tip_seen_at IS
  'Set when the one-time Surf Trips tab coach-mark has been shown to this user. NULL = never seen, fires once on the home screen.';

-- Backfill: every user that already exists at migration time is treated as
-- "already seen" so the tip does not suddenly pop for existing users. New
-- rows inserted after this migration default to NULL and will see the tip.
-- Devs can re-trigger it via the "Replay surftrips tip" dev menu button.
UPDATE public.surfers
   SET surftrips_tip_seen_at = NOW()
 WHERE surftrips_tip_seen_at IS NULL;
