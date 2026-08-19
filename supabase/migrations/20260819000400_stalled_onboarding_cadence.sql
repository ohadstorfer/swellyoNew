-- Re-times the stalled-onboarding ladder. Supersedes the cadence half of
-- 20260818000300 (that migration's RPCs are unchanged and still live).
--
-- Spec: docs/operator-trips-checklist.html §4 — "Deposit paid, onboarding
--       abandoned — and nobody notices".
--
-- ── What changed ────────────────────────────────────────────────────────────
-- Was: traveler at 24h / 3d / 7d then silence; operator once at 3d repeating
--      weekly; dashboard to-do after 7 days.
-- Now: traveler at 4h, then at 24h, then every 24h — no end. Operator joins at
--      24h and repeats every 24h, and the dashboard carries it from 24h too.
--
-- The reasoning behind the old ladder was that money held does not buy
-- unlimited pushes. That is now overridden deliberately: a paid traveler who is
-- not on the trip is a state nobody can afford to let go quiet, and the ladder
-- self-terminates anyway — the moment they act, the RPC stops returning them,
-- and `operator_stalled_onboarders` already drops anyone whose trip has started
-- or been cancelled. Silence here only ever happens because the problem is gone.
--
-- ── Why the three columns had to go ─────────────────────────────────────────
-- `stall_nudge_{24h,3d,7d}_sent_at` encoded the schedule in the SCHEMA: one
-- column per rung, NULL as the claim. A ladder with no last rung cannot be
-- three columns, so the state is now (stage, anchor):
--
--   stage  — the last rung sent. 0 = the 4-hour nudge, n>=1 = day n.
--   anchor — the `last_activity_at` that stage was computed against.
--
-- The anchor is what makes the clock resettable. A traveler who uploads
-- something on day 3 restarts at zero, and the stored stage of 3 must NOT then
-- suppress their next 4-hour nudge — so a stage only counts while its anchor
-- still matches. Without it, one late upload would buy permanent silence.
--
-- Both columns are written together, which is also the claim: the scanner
-- updates only where the pair still reads what it read, so a double cron run,
-- a retry, or two overlapping invocations cannot send the same nudge twice.
--
-- The three old columns are left in place, unused. Rows on prod carry real
-- sends in them, and a dropped column is not recoverable; they can be dropped
-- once nobody wants the history. Anyone already nudged under the old ladder
-- starts the new one from scratch (stage NULL) — which is correct: the new
-- cadence says they should be hearing from us again.

-- ── 1. The new bookkeeping ─────────────────────────────────────────────────

alter table public.group_trip_participants
  add column if not exists stall_nudge_stage    smallint,
  add column if not exists stall_nudge_anchor_at timestamptz;

comment on column public.group_trip_participants.stall_nudge_stage is
  'Last stalled-onboarding rung sent to this traveler: 0 = the 4-hour nudge, '
  'n>=1 = day n. NULL = none yet. Only meaningful together with '
  'stall_nudge_anchor_at — a stage whose anchor no longer matches the '
  'traveler''s last action is stale and ignored.';

comment on column public.group_trip_participants.stall_nudge_anchor_at is
  'The last_activity_at that stall_nudge_stage was computed from. When the '
  'traveler does anything, their clock restarts and this stops matching, which '
  'is what lets the ladder start over instead of staying silent forever.';

comment on column public.group_trip_participants.stall_nudge_24h_sent_at is
  'DEPRECATED 2026-08-19 — superseded by stall_nudge_stage/anchor_at. Kept for '
  'the history of sends made under the old 24h/3d/7d ladder. Not read.';

comment on column public.group_trip_participants.stall_nudge_3d_sent_at is
  'DEPRECATED 2026-08-19 — see stall_nudge_24h_sent_at.';

comment on column public.group_trip_participants.stall_nudge_7d_sent_at is
  'DEPRECATED 2026-08-19 — see stall_nudge_24h_sent_at.';

-- ── 2. The operator digest keeps its column, not its rhythm ────────────────
-- Still one row per trip, never one per stuck traveler: ten people stalling on
-- a big trip is one notification. Only the interval moved, so only the comment
-- needs correcting — a stale comment on a timing column is exactly the kind of
-- thing the next person trusts.

comment on column public.group_trips.operator_stall_digest_sent_at is
  'Last time the operator was told travelers are stuck in onboarding on this '
  'trip. One digest per trip, not one per traveler. First sent once someone has '
  'been stalled 24 hours, then repeats every 24 hours while anyone still is.';
