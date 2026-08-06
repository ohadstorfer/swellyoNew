-- notification_templates — the table, and ONE row.
--
-- WHY THIS EXISTS SEPARATELY FROM 20260611000200
--
-- `20260611000200_notification_templates.sql` creates this same table and seeds
-- 24 rows. It was written 2026-06-11 and NEVER APPLIED — verified 2026-08-06,
-- production has only `notifications` and `notification_queue`. Every
-- notification in Swellyo has therefore always rendered from hardcoded copy.
--
-- Applying it now would be a visible, app-wide regression, and this is the part
-- worth reading before anyone "finishes the job" by running it:
--
--   A template row does not just supply words — it CHANGES THE LAYOUT. The bell
--   renders `bodyParts` when it has them (NotificationCenter.tsx:762), which is
--   the Figma name/action line with the actor and trip name bolded. But
--   `renderNotification` returns `bodyParts: undefined` whenever a template row
--   exists, because a single editable string cannot express that split.
--
--   So seeding all 24 rows would flatten every notification in the bell —
--   member_joined, member_committed, join_request_received, the lot — from the
--   bold two-part line down to plain text. To fix the wording of one push.
--
-- So: the table, and only the row that is actually needed. Every other type has
-- no row, hits the `tpl` miss, and keeps the code default it has always used.
-- 20260611000200 stays unapplied on purpose. If it is ever wanted, the bell's
-- bodyParts handling has to be reconciled FIRST.
--
-- ── APPLY BY HAND, in the SQL editor. Never `db push`. ──────────────────────

-- DDL copied verbatim from 20260611000200 so the two can never disagree about
-- shape, and so applying that file later is a clean no-op on the table itself.
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

-- ── The one row ─────────────────────────────────────────────────────────────
-- Without it, a reminder sent by `operator_remind_requirement` pushes
-- `dispatch-notification-queue/render.ts`'s default — title = the trip name,
-- body = "You have a new trip update". Not broken, but useless: the traveler
-- cannot tell WHICH document is being asked for, which is the entire point of
-- the reminder.
--
-- This fixes it with NO EDGE FUNCTION DEPLOY. renderPush checks the template
-- map first (render.ts:44-55) and only falls through to its switch on a miss —
-- which matters, because the live dispatch-notification-queue is BEHIND this
-- repo (an undeployed batching refactor), so deploying it to ship two lines of
-- copy would ship considerably more than two lines of copy.
--
-- {trip} → tripTitle, {item} → data.item_name, which
-- operator_remind_requirement writes as the requirement title.
insert into public.notification_templates (key, push_title, push_body, bell_title, bell_body)
values (
  'operator_requirement_due_soon',
  'Still needed for {trip}',
  'Your organiser is waiting for {item}',
  '{item} still needed',
  'Your organiser is still waiting for this for {trip}.'
)
on conflict (key) do nothing;   -- never overwrite a later hand-edit
