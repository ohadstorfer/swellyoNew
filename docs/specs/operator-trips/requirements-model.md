# Operator Trips — Requirements Model

**Data model: extends `hosting_style='C'` group trips. Overrides SPEC.md §5.**

**Status:** implementation spec, written 2026-07-22, re-keyed 2026-07-22 to the extend-group-trips architecture, state-derivation decision applied 2026-07-23.
**Sources:** `SPEC.md` (root); `docs/operator-trips-workbench.html` features `onb-req`, `skip-task`, `tasks`, `chase`, `visa`, `passport`, `insurance`, `flights` (newer than SPEC.md and wins); `docs/superpowers/HANDOFF-notifications.md`.
**Scope:** the requirements model only. Payments, document storage, and the approval UI are separate specs.

## 0. Architecture

An operator trip is **not** a separate table. It is a `group_trips` row with `hosting_style = 'C'`, which already exists and already means "operator". We extend it: a few operator-only columns on `group_trips`, plus new `group_trip_*` child tables. "Operator" = the host of a `hosting_style='C'` trip. The roster is the existing `group_trip_participants` table. There is no booking concept.

## 1. Summary

An operator trip has one list of **requirements**: things a traveler must do. Each requirement has a type (upload, acknowledge, or pay) and a timing (must-have, or skippable until a date). "Open tasks" is not a table — it is the traveler's view of the requirements they have not finished yet.

## 2. Decisions this is built on

These are settled. Do not re-open them while building.

- **One list only.** There are requirements. There are no operator-authored "tasks". `operator_trip_tasks` from SPEC.md §6 is **dropped** and never created.
- **Three types:** `upload`, `acknowledge`, `pay`. The waiver is an `acknowledge`. Payment due is a `pay`.
- **Two timings:** `must_have` (no Skip button) or `skippable` (Skip button + a deadline).
- **Deadlines are relative to departure.** We store "30 days before departure". We show the real date. Copying a trip or moving its dates keeps deadlines correct.
- **Default list + custom items.** The operator starts from passport, waiver, medical, insurance, visa, flights. They can deselect any of them and add their own. Custom items also pick a type.
- **Visa is per trip, not per traveler.** No nationality dataset.
- **Requirements can be added after publish.** Everyone already joined gets the obligation and a notification.
- **Done = approved by the operator.** States shown to the traveler: `not_started`, `submitted`, `approved`, `overdue`. A rejected upload goes back to `not_started` with the reject reason attached.
- **The deposit secures the spot.** Not documents, not approval. Requirements never block joining. (Payment timing and method will be decided later on.)
- **A `pay` requirement reads its state from the payment ledger.** It never stores its own done flag. (Payment timing and method will be decided later on.)
- **State is never stored. It is always derived** from the evidence tables (documents, acknowledgements, medical form, ledger). Decided 2026-07-23.
- **At a missed deadline nothing happens automatically.** The item turns red and the operator is notified. No removal, no lockout.
- **Reuse the existing push queue** (`notification_queue` + `dispatch-notification-queue`). Do not build a second notification system.

## 3. Data model

### 3.1 What already exists (not created here)

| Table / function | What we use |
|---|---|
| `group_trips` | `id`, `host_id`, `hosting_style` (`'C'` = operator), `start_date` (departure). **Operator-shell columns (deposit config, etc.) are deferred** — nothing is added to `group_trips` until payment timing and method are decided (payment timing and method will be decided later on). When they come, it is a single `deposit_amount` in canonical USD, reusing the existing `budget_currency` + frozen `budget_fx_rate` — no `deposit_currency`. Decided 2026-07-23. |
| `group_trip_participants` | The roster: `trip_id`, `user_id`, `role` (`host`/`member`). Travelers are the `member` rows; the operator is a `host` row. |
| `group_trip_documents` | The uploaded file for an `upload` requirement (built by the documents spec). **The row is the state:** no row = not started, row = submitted, `approved_at` set = approved. |
| `group_trip_document_reviews` | Audit log of approve/reject actions (built by the approval spec). A `rejected` row newer than any current document supplies the reject reason. |
| `group_trip_acknowledgements` | One row per (requirement, traveler) agree action — the waiver and custom "I agree" items (built by the waiver/medical spec; generalizes `group_trip_waiver_agreements`). Carries `agreed_name`, `agreed_at`, and for the waiver `waiver_version_id` + `agreed_version`. Row = done. |
| `group_trip_medical_forms` | The traveler's medical form (built by the waiver/medical spec; renamed from `group_trip_medical`). `completed_at` set = done. |
| `group_trip_payment_events` | The append-only ledger a `pay` requirement reads (built by the payments spec; payment timing and method will be decided later on). |
| `is_trip_host(p_trip_id)` | Live `SECURITY DEFINER` helper. **Never modify it — it gates six live tables.** New helpers may call it. |

If `group_trips.start_date` is null, every relative deadline resolves to null and nothing is ever overdue. That is correct behaviour, not a bug.

### 3.2 Migration A — enum values (run alone, first)

`ALTER TYPE ... ADD VALUE` cannot be used in the same transaction that later reads it. So the enum goes in its own file and its own run.

```sql
-- supabase/migrations/20260722000000_operator_requirements_enum.sql
alter type public.notification_type add value if not exists 'operator_requirement_added';
alter type public.notification_type add value if not exists 'operator_requirement_due_soon';
alter type public.notification_type add value if not exists 'operator_requirement_overdue';
alter type public.notification_type add value if not exists 'operator_requirement_overdue_operator';
alter type public.notification_type add value if not exists 'operator_requirement_rejected';
```

### 3.3 Migration B — tables, RLS, helpers

```sql
-- supabase/migrations/20260722000100_operator_requirements.sql

-- ── 1. Permission primitives.
--   Operator/host check: we CALL the live public.is_trip_host(p_trip_id) directly.
--   We never modify it — it gates six live tables. It is the same host check the
--   native child tables (e.g. group_trip_gear_claims) already use.
--   Membership check: one new helper, is_trip_participant(). This is the SINGLE
--   canonical membership primitive — the sibling specs (documents, approval,
--   waiver/medical) reuse THIS function, they do not each define their own.
create or replace function public.is_trip_participant(p_trip_id uuid)
returns boolean language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select exists (
    select 1 from public.group_trip_participants p
    where p.trip_id = p_trip_id and p.user_id = auth.uid()
  );
$$;
revoke execute on function public.is_trip_participant(uuid) from public, anon;
grant  execute on function public.is_trip_participant(uuid) to authenticated;

-- Note: operator child tables only ever receive rows on hosting_style='C' trips
-- (the app only offers these features there). If a hard DB guarantee is wanted
-- later, add a trigger asserting hosting_style='C' on insert. OPEN — needs Eyal &
-- Ohad; not required for v1.

-- ── 2. The requirement definition. One row per requirement per trip.
create table if not exists public.group_trip_requirements (
  id                    uuid primary key default gen_random_uuid(),
  trip_id               uuid not null references public.group_trips(id) on delete cascade,
  kind                  text not null check (kind in
                          ('passport','waiver','medical','insurance','visa','flights','custom')),
  req_type              text not null check (req_type in ('upload','acknowledge','pay')),
  timing                text not null check (timing in ('must_have','skippable')),
  title                 text not null,                 -- shown to the traveler
  help_text             text,                          -- optional one-liner
  deadline_days_before  integer check (deadline_days_before >= 0),
  sort_order            integer not null default 0,
  is_active             boolean not null default true, -- false = deselected, keeps history
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- must-have has no deadline. skippable must have one.
  constraint group_trip_req_deadline_rule check (
    (timing = 'skippable' and deadline_days_before is not null) or
    (timing = 'must_have'  and deadline_days_before is null)
  )
);

-- A known kind can only appear once per trip. Custom items can repeat.
create unique index if not exists uq_group_trip_req_kind_per_trip
  on public.group_trip_requirements (trip_id, kind) where kind <> 'custom';
create index if not exists idx_group_trip_req_trip
  on public.group_trip_requirements (trip_id, sort_order) where is_active;

-- ── 3. There is NO per-traveler state table. State is always derived at read
--      time from the evidence tables (see §3.4):
--        upload      → group_trip_documents (the row is the state)
--        acknowledge → group_trip_acknowledgements (row = done)
--        medical     → group_trip_medical_forms (completed_at set = done)
--        pay         → the payment ledger, via operator_requirement_pay_state()
--      Decided 2026-07-23. Nothing to migrate, nothing to keep in sync.

-- ── 4. RLS. Reads are direct. All writes go through the RPCs in §3.4.
alter table public.group_trip_requirements enable row level security;

revoke all on public.group_trip_requirements from anon, authenticated;
grant  select on public.group_trip_requirements to authenticated;

drop policy if exists group_trip_req_select on public.group_trip_requirements;
create policy group_trip_req_select on public.group_trip_requirements
  for select using (
    public.is_trip_host(trip_id) or public.is_trip_participant(trip_id)
  );
```

### 3.4 Migration C — resolving deadlines and reading state

A relative deadline is stored as `deadline_days_before`. It becomes a real date only when it is read, against `group_trips.start_date`. Nothing is ever cached. This is why moving trip dates keeps every deadline correct with no backfill.

```sql
-- supabase/migrations/20260722000200_operator_requirements_reads.sql

-- ── 1. Resolved view: adds the real due date.
create or replace view public.group_trip_requirements_resolved as
select
  r.*,
  t.start_date as departure_date,
  case
    when r.deadline_days_before is null or t.start_date is null then null
    else (t.start_date - make_interval(days => r.deadline_days_before))::date
  end as due_date
from public.group_trip_requirements r
join public.group_trips t on t.id = r.trip_id;

alter view public.group_trip_requirements_resolved set (security_invoker = on);
grant select on public.group_trip_requirements_resolved to authenticated;

-- ── 2. Pay state. v1 stub — the payments spec replaces the body with a read of
--      group_trip_payment_events. The signature never changes.
--      Returns one of: not_started | submitted | approved
--        not_started = ledger shows nothing
--        submitted   = a payment event exists but is still pending/processing
--        approved    = the amount owed for this requirement is settled
create or replace function public.operator_requirement_pay_state(
  p_trip_id uuid, p_user_id uuid, p_requirement_id uuid
) returns text language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select 'not_started'::text;
$$;
revoke execute on function public.operator_requirement_pay_state(uuid, uuid, uuid) from public, anon;
grant  execute on function public.operator_requirement_pay_state(uuid, uuid, uuid) to authenticated;

-- ── 3. The traveler's list. One read powers both onboarding and the Plan panel.
--      There is no state table: the CASE below derives the state of each
--      requirement from its evidence table. Approximate SQL — exact join
--      conditions belong to the sibling specs that own those tables.
create or replace function public.operator_trip_my_requirements(p_trip_id uuid)
returns table (
  requirement_id uuid, kind text, req_type text, timing text, title text,
  help_text text, due_date date, effective_state text, submitted_at timestamptz,
  reject_reason text, document_id uuid
) language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select
    r.id, r.kind, r.req_type, r.timing, r.title, r.help_text, r.due_date,
    case
      -- pay: always the ledger (payment timing and method will be decided later on)
      when r.req_type = 'pay'
        then public.operator_requirement_pay_state(p_trip_id, auth.uid(), r.id)
      -- medical: the completed form is the evidence
      when r.kind = 'medical' then
        case when m.completed_at is not null then 'approved'
             when r.due_date is not null and r.due_date < current_date then 'overdue'
             else 'not_started' end
      -- acknowledge: the agreement row is the evidence
      when r.req_type = 'acknowledge' then
        case when a.id is not null then 'approved'
             when r.due_date is not null and r.due_date < current_date then 'overdue'
             else 'not_started' end
      -- upload: the document row is the evidence
      when d.id is not null and d.approved_at is not null then 'approved'
      when d.id is not null then 'submitted'
      when r.due_date is not null and r.due_date < current_date then 'overdue'
      else 'not_started'
    end as effective_state,
    coalesce(d.created_at, a.agreed_at, m.completed_at) as submitted_at,
    rej.reason as reject_reason,   -- only set when there is no newer document
    d.id as document_id
  from public.group_trip_requirements_resolved r
  left join public.group_trip_documents d
    on d.requirement_id = r.id and d.user_id = auth.uid()
  -- for the waiver, the row must also match the CURRENT waiver version
  -- (join condition owned by the waiver/medical spec)
  left join public.group_trip_acknowledgements a
    on a.requirement_id = r.id and a.user_id = auth.uid()
  left join public.group_trip_medical_forms m
    on m.trip_id = r.trip_id and m.user_id = auth.uid()
  -- rejected = no current document + a newer 'rejected' audit row.
  -- The effective state stays not_started; the reason rides along.
  left join lateral (
    select rv.reason
    from public.group_trip_document_reviews rv
    where rv.requirement_id = r.id and rv.user_id = auth.uid()
      and rv.decision = 'rejected'
      and rv.created_at > coalesce(d.created_at, '-infinity'::timestamptz)
    order by rv.created_at desc
    limit 1
  ) rej on true
  where r.trip_id = p_trip_id
    and r.is_active
    and public.is_trip_participant(p_trip_id)
  order by
    case when r.timing = 'must_have' then 0 else 1 end,
    r.due_date nulls first,
    r.sort_order;
$$;
revoke execute on function public.operator_trip_my_requirements(uuid) from public, anon;
grant  execute on function public.operator_trip_my_requirements(uuid) to authenticated;
```

Write RPCs to add in the same migration. All are `SECURITY DEFINER`, all check the caller, all need an explicit `GRANT EXECUTE ... TO authenticated` or the client gets a 403:

| RPC | Who | What it does |
|---|---|---|
| *(no submit RPC)* | traveler | An upload is submitted by writing the `group_trip_documents` row itself (documents spec). There is no separate submit RPC — the document row is the state. |
| `operator_requirement_acknowledge(p_requirement_id, p_full_name)` | traveler | Inserts the `group_trip_acknowledgements` row (`trip_id` from the requirement, `user_id = auth.uid()`; for the waiver, against the current waiver version). Only for `acknowledge`. |
| *(no review RPC here)* | operator | Approve/reject are the RPCs in approval-review.md. They operate on `group_trip_documents`: approve sets `approved_at`; reject deletes the row and writes the `group_trip_document_reviews` audit entry, so the item re-opens as `not_started` with the reason attached. |
| `operator_trip_requirement_matrix(p_trip_id)` | operator | One row per (`member` × active requirement) with the same derived `effective_state`, for the dashboard and the per-traveler page. Derives states exactly like `operator_trip_my_requirements`. |

Skipping writes nothing. There is no `skipped` state and no skip timestamp. A skipped item is simply a requirement with no evidence row and a due date in the future.

## 4. What the operator sees

### 4.1 During trip creation

A new step in the operator wizard (`hosting_style='C'`), placed after the trip basics (dates must already exist, because deadlines are shown against departure).

1. **The default list appears, all six pre-selected:** passport, waiver, medical, insurance, visa, flights. Each is a row with a checkbox.
2. **Deselect what does not apply.** Unchecking visa is how "no visa needed for this trip" is expressed. Nothing else changes.
3. **Each selected row opens a small sheet** with two controls:
   - *When:* "Must have — during onboarding" or "Can skip until…".
   - *Deadline* (only when skippable): a number of days before departure. The sheet always shows the resolved real date under it, e.g. "30 days before departure — 12 Oct 2026".
4. **Add a custom item:** title, optional help text, type (upload / acknowledge / pay), then the same When control.
5. The step writes nothing until the trip is published. Draft state lives in the wizard state object, same pattern as `CreateTripFlowA.tsx` (`WIZARD_STATE_VERSION` + AsyncStorage draft). On publish, insert one `group_trip_requirements` row per selected item.

Defaults for which items are must-have vs skippable: **OPEN — needs the design partners.** Until they answer, ship all six as skippable with a deadline the operator sets, except passport and waiver, which the workbench already marks as required parts of onboarding.

### 4.2 After publish

Entry point: the 3-dot menu on the trip Overview → "Requirements".

- Same list, same sheets. Editing a title or a deadline is an `update`, no fan-out of rows needed.
- **Adding a requirement** inserts a row. Because state is derived, there are no per-traveler rows to create. Every `member` on the roster gets a notification (§6).
- **Removing a requirement** sets `is_active = false`. It disappears from every traveler's list. History is kept.
- The list shows live counts next to each item: "received 15/15 · approved 3/15". The gap is the operator's own review backlog, not a document problem.

## 5. What the traveler sees

### 5.1 Onboarding (right after the deposit secures the spot)

1. Call `operator_trip_my_requirements(trip_id)`.
2. Show the must-have items first, one screen each. No Skip button.
3. Then the skippable items, one screen each, each with a visible **Skip** button and the real deadline under the title ("by 12 Oct 2026").
4. Skipping moves to the next screen and writes nothing.
5. Onboarding ends when there are no unseen screens left. It does **not** wait for approval and it does not block anything.

### 5.2 The Plan tab, after onboarding

An "Open" panel listing every requirement whose `effective_state` is not `approved`, in the order the RPC returns (must-have first, then by due date).

Row copy by state:

| `effective_state` | Row shows |
|---|---|
| `not_started` | The action button. Deadline as a real date if there is one. |
| `overdue` | Same, in red, "was due 12 Oct". |
| `submitted` | "Waiting for the operator." No action. |
| `approved` | Moves out of the Open panel into the trip wallet / medical card. |
| `not_started` + `reject_reason` | Rejected: red, the operator's reason if they gave one, and the action button again. |

## 6. State machine for one requirement, per traveler

```
  not_started ───────── due date passes ─────────► overdue
      │  ▲                                            │
      │  └── skip (writes nothing, stays not_started) │
      │                                               │
      └────── submit / acknowledge ───► submitted ◄───┘
                                            │
                    operator approves ──────┼──► approved   (end)
                                            │
                    operator rejects ───────┴──► rejected
                                                    │
                              traveler re-submits ──┴──► submitted
```

Rules:

- **No state above is stored as a status column.** `submitted` and `approved` live on the document row (`approved_at` null vs set); `rejected` is the absence of a document row plus the newer audit entry in `group_trip_document_reviews` (it reads back as `not_started` with the reject reason attached); acknowledge and medical items are done the moment their evidence row exists.
- `overdue` is **derived**, never stored. It is `not_started` plus a due date in the past.
- `pay` requirements never enter this machine. Their state is computed from the ledger every time it is read. (Payment timing and method will be decided later on.)
- Approval is quality control only. Nothing in the trip depends on it.
- Reject and "delete + reclaim" are the same action, one button.

## 7. Edge cases

**Trip dates move and a deadline had already passed.**
Because the deadline is stored relative to departure, moving `group_trips.start_date` recomputes every due date automatically on the next read. No backfill, no job. The mechanical result is that a requirement that was red goes back to normal when the trip moves later. Whether that is what we want — **OPEN — needs Eyal & Ohad** ("does a moved trip re-open an already-overdue requirement?"). Build the recompute either way. The overdue-notification dedupe keys on the resolved due date (§8), so when the date moves, a later miss notifies again on its own — nothing to clear.

**Requirement added after publish.**
Insert the row, notify every `member`. Because state is derived, there is nothing to fan out. If the new requirement's resolved due date is already in the past, the item would be born red — whether an operator may do that is **OPEN — needs Eyal & Ohad** (same open item covers pulling a deadline earlier). Interim guard, needs sign-off: the edit screen blocks a deadline that resolves to a past date, with the message "this date has already passed".

**Custom item with a type the dashboard does not know.**
Custom items do pick a type, so the per-traveler flow always works. The dashboard is the problem: its tiles are built around known kinds (passports, visas, insurance, flights). Interim: render custom items in a separate "Other requirements" list, one line each, with its own received/approved counts and a view-all. No aggregate tile, no export column. How custom items are properly counted and exported is **OPEN — needs Eyal & Ohad**.

**A pay requirement when the ledger is behind.**
The requirement has no stored flag, so it can never disagree with the ledger — it just shows whatever the ledger says right now. If a webhook is late, the traveler sees "not paid" for a few minutes. Show a line under the row: "Just paid? It can take a few minutes to show up." The one real risk is the overdue scan firing a red state and a push for money that has actually been sent. The scan must skip a `pay` requirement whose `operator_requirement_pay_state` is `submitted`. Confirm this with the payments spec before the scan goes live.

## 8. Notifications

Reuse the live queue. Do not build anything new. Flow is unchanged: insert a `public.notifications` row → the existing `tg_enqueue_push` trigger writes a `notification_queue` row → the cron dispatcher sends it.

Because an operator trip **is** a `group_trips` row, the operator trip id goes straight into `notifications.trip_id` and `notification_queue.trip_id` — both already FK to `group_trips(id)`. No workaround needed. Set `entity_type = 'requirement'` and `entity_id = <requirement id>` for the deep link. The deep-link mapper `tripFocusForNotification()` in `notificationsService.ts` gets a branch that returns a "requirements" focus for these types — it already knows how to open a group trip by `trip_id`.

| Type | To | Priority | Fired by |
|---|---|---|---|
| `operator_requirement_added` | every `member` | 1 | trigger on insert into `group_trip_requirements` |
| `operator_requirement_rejected` | that traveler | 0 | the reject RPC in approval-review.md |
| `operator_requirement_overdue` | that traveler | 0 | daily scan |
| `operator_requirement_overdue_operator` | the operator | 1 | daily scan |
| `operator_requirement_due_soon` | that traveler | 1 | daily scan — **kept off until cadence is decided** |

Add these to `notification_push_priority`. Add render copy in `dispatch-notification-queue/render.ts` and bell copy in `notificationsService.ts`.

Do **not** notify on every submission — 60 pushes a trip and the operator mutes us. The dashboard's needs-review count is the signal.

**Overdue dedupe.** There is no `overdue_notified_at` column — nothing stores state. Before inserting an overdue row, the daily scan checks `public.notifications` for an already-sent overdue notification for that (recipient, requirement) carrying the same resolved due date in `data`. Same due date already notified = skip. If the trip moves and the due date changes, the dedupe key changes, so a new miss can notify again.

Reminder cadence, how far ahead, and how this meets the graded quiet-hours logic: **OPEN — needs Eyal & Ohad.** Whether the operator is told once or repeatedly about the same overdue item: **OPEN.** The dedupe check makes either answer a one-line change in the scan.

## 9. Files to create or change

**New migrations** (applied BY HAND in the Supabase SQL editor, in filename order, as three separate runs — never `supabase db push`):
- `supabase/migrations/20260722000000_operator_requirements_enum.sql`
- `supabase/migrations/20260722000100_operator_requirements.sql`
- `supabase/migrations/20260722000200_operator_requirements_reads.sql`

**New edge function:**
- `supabase/functions/scan-operator-requirements/index.ts` — daily, mirrors `scan-trip-reminders`. Finds active requirements whose resolved due date passed, with no approving evidence row and no already-sent overdue notification for the same resolved due date (§8), and inserts the two overdue feed rows. Skips `pay` requirements whose ledger state is `submitted`. Needs a `pg_cron` entry.

**New client files:**
- `src/services/operator/requirementsService.ts` — one wrapper per RPC, plus the TS types (`OperatorRequirement`, `RequirementType`, `RequirementTiming`, `EffectiveState`).
- `src/screens/operator/RequirementsStep.tsx` — the creation-wizard step.
- `src/screens/operator/EditRequirementsScreen.tsx` — the after-publish editor.
- `src/screens/trips/operator-onboarding/RequirementScreen.tsx` — one screen per requirement, upload / acknowledge / pay variants.
- `src/screens/trips/operator-onboarding/OpenRequirementsPanel.tsx` — the Plan panel.

**Changed:**
- `src/services/notifications/notificationsService.ts` — new types in the bell renderer, new branch in `tripFocusForNotification()`.
- `supabase/functions/dispatch-notification-queue/render.ts` — push copy for the new types. Download the live version and diff before deploying; live edge functions here have been ahead of the repo before.

**Untouched:** `src/screens/trips/CreateTripFlowA.tsx`, `src/services/trips/groupTripsService.ts`, and the live `group_trips` / `group_trip_*` tables — no `ALTER` here, only new sibling tables. Do **not** modify `is_trip_host()`; new helpers call it. The operator wizard copies the existing patterns (versioned draft state, step list, sheet-per-field).

## 10. Open questions

Nothing here has an answer yet. Do not guess.

1. **Which items are skippable by default** (insurance, visa, flights are the likely ones). — needs the design partners.
2. **Can a deadline be tightened after the fact?** Can an operator add a requirement whose deadline has already passed? — needs Eyal & Ohad.
3. **Does a moved trip re-open an already-overdue requirement?** — needs Eyal & Ohad.
4. **How are custom items counted and exported on the dashboard?** — needs Eyal & Ohad.
5. **Reminder cadence and quiet hours.** How many reminders, how far ahead, once or repeatedly to the operator. — needs Eyal & Ohad.
6. **Approval queue is new scope not in SPEC.md.** — needs Eyal.
7. **What happens if the operator never reviews?** Decided: nothing automatic. Not decided: whether that is acceptable at departure. — unowned.
8. **Does the rejected file survive a reclaim?** Retention says do not keep extra copies. — unowned, belongs to the documents spec.
9. **Does anything else belong in the Open panel?** An operator wanting to chase "tell us your arrival time" has only chat today. — watch the design partners.
10. **Per-trip visa flag expires once explore listing works.** A mixed-nationality trip breaks a single flag. Accepted for now. — needs Eyal & Ohad, later.
