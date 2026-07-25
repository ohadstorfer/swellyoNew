# Operator approval and review

> **APPLIED TO PRODUCTION 2026-07-24.** Tables renamed to the `organized_trip_*` scheme and
> created on prod via migrations `20260724000000`–`20260724000700`. Anything payment-related is
> still unbuilt. `group_trip_acknowledgements` is **OPEN** — Eyal wants it removed; not dropped
> yet because it is the only record of who signed which waiver version. The storage bucket is
> still named `group-trip-documents` (naming-consistency question, deliberately left alone).


**Status:** Draft v1, written 2026-07-22.
**Data model:** extends `hosting_style='C'` group trips. Overrides SPEC.md §5.
**Scope:** how an operator reviews traveler documents, and what "done" means.
**Related:** `SPEC.md` (§4.3, §7), `docs/operator-trips-workbench.html` (rows `approval-queue`, `reclaim`, `snap-docs`, `onb-req`, `trav-file`), `docs/specs/operator-trips/documents-storage.md` (where files live — **not** designed here).
**2026-07-23:** the derive-from-rows model in this spec is now the canonical requirement-state model — `group_trip_requirement_states` (never created) was dropped from `requirements-model.md`. Document state = document row (+ `approved_at`). Nothing else changed.
**2026-07-23 (final):** reviews table folded into `approbation_note` on the document row. `group_trip_document_reviews` is gone. Reject now deletes the **file** and keeps the **row** (`rejected_at` + `approbation_note`).

An operator trip is **not** a separate data model. It IS a `group_trips` row with `hosting_style='C'`. We extend that row's world — new `group_trip_*` tables, all keyed by `trip_id references group_trips(id)`. There is no booking table. A traveler is a `group_trip_participants` row, same as any group trip.

## 1. Summary

A traveler uploads a document. The operator opens it, looks at it, and taps **Approve**. That is the whole loop.

"Done" means **approved by the operator**, not merely submitted. The dashboard counts approved. Without this, "14/15 passports" can be fourteen blurry photos nobody has looked at.

But approval **never gates anything**. Submitting gets a traveler nothing and blocks nothing. **The deposit is what secures a spot** (payment timing and method will be decided later on). Approval is quality control on people who are already on the trip.

### The approval concept is NEW SCOPE. It is not in SPEC.md.

Say this plainly, because Eyal has not seen it.
- `SPEC.md` has **no approval concept at all**. Its document sketch (§5) carries only `uploaded_at` and a deleted/reclaimed state. No review step, no approved state, no review workload anywhere.
- This spec adds all of it, decided 2026-07-22. It adds real work: ~15 travelers × ~4 documents = **~60 reviews per trip**. `SPEC.md` never budgeted for that.
- Separately, the **data model** in `SPEC.md` §5 (a separate `operator_trips` cluster) is also overridden — see the note above. This spec uses the extend-`C` model throughout.
- What does **not** change: the deposit still secures the spot, and `SPEC.md` §4.3 "delete + reclaim" stays as written — it just also becomes the reject button.

## 2. Why approve-on-view, not an approval queue

Do not "simplify" this back into a queue later. A separate queue means ~60 deliberate approvals per trip, and nothing bad happens if the operator skips them — approval gates nothing, and that is deliberate and stays. So the queue decays: operators stop grinding it, approved counts stay low, and the number we added to make the dashboard trustworthy becomes the one number nobody trusts.

Approve-on-view removes the second job. The operator already opens documents — to send a passport to a hotel, to check an insurance policy. Approving is one tap **inside the viewer they were already in**.

The dashboard still shows a **needs-review count**, so the work is visible and owned. Nothing automatic happens if it is ignored: no auto-approval, no timers, no escalation.

## 3. Document states

Four states, and one of them is the absence of a row.

| State | Meaning | How it is stored |
|---|---|---|
| **Not submitted** | The requirement is open for this traveler | no document row |
| **Submitted** | Uploaded, nobody has looked | row exists, `approved_at is null`, `rejected_at is null` |
| **Approved** | The operator opened it and approved | row exists, `approved_at` set |
| **Rejected** | The operator rejected it; the file is already deleted | row exists, `rejected_at` set (+ `approbation_note`), file gone |

A document row is anchored on `(trip_id, user_id, requirement_id)` — the group trip, the traveler, and the requirement. No booking id.

Transitions:
- **Not submitted → Submitted** — the traveler uploads.
- **Submitted → Approved** — the operator taps Approve, in the viewer or via bulk approve.
- **Submitted → Rejected** — the operator rejects. The storage file is deleted right away; the row stays with `rejected_at` and `approbation_note`. The requirement re-opens **because the row is in the rejected state**, not because the row is gone.
- **Approved → Rejected** — the same reject action. Allowed after approval, so a bad bulk approve is recoverable.
- **Rejected → Submitted** — the traveler re-uploads. The upload **replaces the row**: new file, and `rejected_at` / `approbation_note` / `approved_at` are cleared.
- **Any → file gone** — retention deletes the file 30 days after the trip ends. The row stays. See `documents-storage.md`.

There is **no** "rejected but keep the file" state — a rejected file is deleted immediately. Reject and delete + reclaim are still the same single action (§6); it deletes the file, never the row.

Approval applies to **upload** requirements only. A **pay** requirement reads from the payment ledger and never stores a state. Whether an **acknowledge** requirement (the waiver) needs approval is **OPEN — needs Eyal & Ohad** (there is nothing to look at, so probably not, but nobody has said so).

## 4. What the operator sees

**4.1 The document viewer — one tap to approve.** Reuse the existing full-screen viewer chrome, `src/components/filePreview/FilePreviewShell.tsx` (close X, swipe-down to dismiss). Do not build a new one. Footer, for the trip host: **Approve** (primary — becomes a small "Approved · 22 Jul" line once tapped), **Reject** (secondary, opens the reject sheet, §6), and **Export** (the existing real-file download).

Haptic success on approve (`hapticSuccess`, `src/utils/haptics.ts`). Optimistic: flip the row locally, call the RPC, revert on error with `friendlyErrorMessage`.

**4.2 The dashboard shows both numbers.** On the documents snapshot tile and on every per-type page:

```
Passports    Received 15/15 · Approved 3/15
Insurance    Received 11/15 · Approved 11/15
```

Both numbers, always. The gap is then visibly the **operator's own backlog**, not a document problem.

A **needs-review count** sits at the top of the trip dashboard: `12 documents waiting for you`. Tapping it opens the review list (submitted, unapproved documents, oldest first). It is a shortcut, not a queue the operator must clear.

**4.3 Bulk approve — in v1, not a maybe.** Sixty one-by-one taps is the difference between review happening and not. Lives on the per-type page (all passports) and on the needs-review list.
- Every card shows a real thumbnail, big enough to judge. The operator is still looking. Long-press or a "Select" button enters selection mode, and **Select all** is available.
- Footer bar `Approve 12`. Confirm in a sheet built with **`BottomSheetShell`** — never a hand-rolled `Modal`: `Approve 12 documents? You can still reject any of them later.` One RPC call for the whole selection (§7).

## 5. What the traveler sees

Per requirement, in Plan → open tasks and in the travel wallet:

| Document state | Traveler sees |
|---|---|
| Not submitted | `Passport — needed` (plus `Skip` and the deadline date if skippable) |
| Submitted | `Waiting for the operator` |
| Approved | `Approved` with a check |
| Just rejected | Back to `needed`, with a banner: `The operator asked for a new one.` plus the reason if one was given |

"Waiting for the operator" is deliberate. It is honest about where the delay sits, and it puts the pressure in the right place instead of making the traveler feel they did something wrong. Nothing about the traveler's place on the trip changes in any of these states, and the wording must never imply otherwise — no "pending approval to join", no locks, no warnings.

## 6. Reject = delete + reclaim

`SPEC.md` §4.3 already defines delete + reclaim: the operator deletes the document and the system re-opens it as a task for that traveler, with a notification. This spec makes it **the same button as reject**. There is only one button.

The action, in order: (1) delete the **storage object** — the bytes are gone immediately, see `documents-storage.md`; (2) set `rejected_at` and `approbation_note` (the optional reason) on the row — the requirement re-opens for that traveler because the row is now in the rejected state; (3) notify the traveler. No audit insert, no row delete. The traveler's re-upload replaces the row and clears both fields.

The sheet (`BottomSheetShell`, `avoidKeyboard`):
- Title `Ask for a new passport?`, body `This deletes the file and asks <name> to upload it again.` Primary button `Delete and ask again`, destructive styling.
- **Reason — optional.** One free-text field, empty by default. Never required. Never block the button on it.
- **Send a message** — right next to the reason, opens the 1:1 DM with that traveler via `messagingService.createDirectConversation(userId, false)`. One tap to explain properly.

Why optional: forcing a reason adds friction to the common case (a blurry scan, obvious to both sides). The message button covers the case where the traveler would otherwise be guessing.

## 7. Counts, and where they must not double count

Per requirement, per trip: **received** = travelers with a document row where `rejected_at is null` (a rejected row does not count as received — the traveler owes a new file); **approved** = travelers whose row has `approved_at`; **expected** = current participants with `role = 'member'` (co-hosts and staff are `role = 'host'` rows and are not counted).

Rules that must hold, or the dashboard lies:
1. **Count per (trip, traveler, requirement), never per document row.** A traveler who is rejected and re-uploads must not count twice. Enforced by a unique index, not by application code.
2. **approved ⊆ received.** Never add them. Never show a total that sums both.
3. **A removed participant drops out of both numbers** — numerator and denominator. Their `group_trip_participants` row is gone, so they leave `received` and `expected` together. Removing someone does not leave a permanent gap that makes the trip look incomplete forever.
4. **Pay requirements are not counted here.** Payment status is derived from the append-only ledger (`SPEC.md` §5 ledger, which survives the model change). A pay requirement never stores its own state.
5. **Acknowledge requirements (the waiver) count as signed / not signed**, not received / approved — pending the open question in §3. **Custom operator-defined requirements** are already open on the workbench (`snap-docs`, `onb-req`) and not resolved here.

### SQL — run by hand in the Supabase SQL editor

Migrations here are applied by hand, never with `supabase db push`. Run block A, then B as a **separate** run (`alter type … add value` cannot be used by code in the same transaction), then C. Table and column names are reconciled with `documents-storage.md` (2026-07-23): `organized_trip_travelers_documents` carries `requirement_id`, `approved_at`, `approved_by`, `rejected_at`, `approbation_note`; there is no `doc_type` / `review_status` / `reclaimed_at`, and no separate audit table. All tables live in the group-trip world and key on `trip_id references group_trips(id)`.

**Block A — review state and uniqueness**
```sql
alter table public.organized_trip_travelers_documents
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references auth.users(id) on delete set null,
  add column if not exists rejected_at timestamptz,
  add column if not exists approbation_note text;  -- operator's note: written on reject, optional on approve
-- Rule 1: one live doc per (trip, traveler, requirement) — stops double counting.
create unique index if not exists uq_otd_trip_user_requirement
  on public.organized_trip_travelers_documents (trip_id, user_id, requirement_id);
-- Needs-review = submitted: not yet approved, not rejected.
create index if not exists idx_otd_pending_review
  on public.organized_trip_travelers_documents (trip_id) where approved_at is null and rejected_at is null;
```

**Block B — notification types (separate run)**
```sql
alter type public.notification_type add value if not exists 'operator_document_rejected';
alter type public.notification_type add value if not exists 'operator_document_approved';
```

**Block C — RPCs.** The operator check CALLS the existing `public.is_trip_host(trip_id)` — never modify that function; it gates six live tables.
```sql
-- Approve one or many. Same function for the single tap and for bulk.
-- Approving clears any earlier reject and can carry an optional note.
create or replace function public.operator_approve_documents(p_document_ids uuid[], p_note text default null)
returns integer language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v_count integer;
begin
  update public.organized_trip_travelers_documents d
     set approved_at = now(), approved_by = auth.uid(),
         rejected_at = null,
         approbation_note = nullif(p_note, '')
   where d.id = any(p_document_ids) and d.approved_at is null
     and public.is_trip_host(d.trip_id);
  get diagnostics v_count = row_count;  -- what the client shows as "12 approved"
  return v_count;
end $$;

-- Reject == delete the FILE, keep the ROW. One action.
-- The storage object is deleted in the same client flow that calls this RPC:
-- the operator's own JWT passes the storage DELETE policy (documents-storage.md §4.3),
-- so the caller removes the object right before/after this call. The row keeps
-- only metadata — rejected_at, approbation_note, and the typed fields. No copy survives.
create or replace function public.operator_reject_document(p_document_id uuid, p_reason text default null)
returns void language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare d record;
begin
  select * into d from public.organized_trip_travelers_documents where id = p_document_id;
  if d is null then raise exception 'document not found'; end if;
  if not public.is_trip_host(d.trip_id) then raise exception 'not your trip'; end if;
  -- The requirement re-opens because the row is now in the rejected state.
  update public.organized_trip_travelers_documents
     set rejected_at = now(),
         approbation_note = nullif(p_reason,''),
         approved_at = null,
         approved_by = null
   where id = p_document_id;
  -- An operator trip IS a group_trips row, so trip_id is a real FK here (§8).
  insert into public.notifications
    (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
  values (d.user_id, d.trip_id, 'operator_document_rejected', 'user', auth.uid(),
          'group_trip_document', d.id,
          jsonb_build_object('requirement_id', d.requirement_id, 'reason', nullif(p_reason,'')));
end $$;

-- Dashboard counts, per (trip, traveler, requirement).
create or replace function public.organized_trip_document_counts(p_trip_id uuid)
returns table (requirement_id uuid, expected int, received int, approved int)
language plpgsql stable security definer
set search_path = public, extensions, pg_temp as $$
begin
  if not public.is_trip_host(p_trip_id) then raise exception 'not your trip'; end if;
  return query
  with active as (
    -- travelers only. Exclude by ROLE, not by host_id: multi-host trips have
    -- several role='host' rows (co-hosts, staff), and host_id is just the
    -- primary one. Excluding only host_id would count co-hosts as travelers
    -- and the trip would read 13/15 forever.
    select p.user_id from public.group_trip_participants p
     where p.trip_id = p_trip_id and p.role = 'member'
  ), reqs as (
    select r.id from public.organized_trip_requirements r
     where r.trip_id = p_trip_id and r.kind = 'upload'
  )
  select r.id, (select count(*) from active)::int, count(d.id)::int,
         count(d.id) filter (where d.approved_at is not null)::int
    from reqs r
    left join public.organized_trip_travelers_documents d
           on d.requirement_id = r.id and d.user_id in (select user_id from active)
   group by r.id;
end $$;

-- SECDEF functions here are revoked by default; new client RPCs need an explicit grant or they 403.
revoke execute on function public.operator_approve_documents(uuid[]) from public, anon;
revoke execute on function public.operator_reject_document(uuid, text) from public, anon;
revoke execute on function public.organized_trip_document_counts(uuid) from public, anon;
grant execute on function public.operator_approve_documents(uuid[]) to authenticated;
grant execute on function public.operator_reject_document(uuid, text) to authenticated;
grant execute on function public.organized_trip_document_counts(uuid) to authenticated;
```

## 8. Notifications

Reuse the existing push queue (`public.notifications` → `tg_enqueue_push` → `notification_queue` → `dispatch-notification-queue`). Do not build a second notification path.

**These notify:**

| Event | Who | Note |
|---|---|---|
| Document rejected (delete + reclaim) | the traveler | P1 — it creates work for them |
| Operator adds a requirement after publish | everyone joined | decided elsewhere (`onb-req`) |
| Deadline near / passed | traveler, and the operator at the deadline | decided elsewhere (`chase`) |

**These deliberately do NOT notify:**
- **Every document submission → operator.** Rejected on purpose: 60 pushes per trip and operators mute us. The needs-review count is the signal instead.
- **Nothing when the operator ignores that count.** No timers, no escalation, no auto-approval.

**OPEN — needs Eyal & Ohad:** does approving notify the traveler? Recommendation, not a decision: no push, just the in-app state change — approval gets the traveler nothing, and a push per approved document is the same ~60 pushes from the other direction. The enum value `operator_document_approved` is added anyway so the choice stays cheap.

Build notes:
- **Resolved by the extend-`C` decision:** an operator trip IS a `group_trips` row, so `public.notifications.trip_id` (which FKs `group_trips`) is used directly — no null-and-carry-in-`data` workaround.
- The push mapping function (`20260609000100_notification_push_mapping.sql`) must learn the new type: copy, priority, dedup key. Suggested key `opdoc_reject:<user_id>:<requirement_id>`.
- Copy must never imply a lost spot: `Your passport needs to be uploaded again`, not `Your passport was rejected`.

## 9. Edge cases

**Operator rejects, the traveler re-uploads the same bad file.** Nothing detects this, and nothing should try. The second reject works like the first. With no audit table there is no reject history — repeated rejects look identical, and we only know the latest one (its `rejected_at` + `approbation_note` on the row). Escalation is the "Send a message" button on the reject sheet.

**Bulk approve on a traveler with one bad document.** Two safety nets, both needed. (1) Selection is explicit — thumbnails are shown and the operator deselects the bad one. (2) Reject is allowed **after** approval (§3), so a mistaken bulk approve is fully recoverable and the traveler simply gets asked again.

**A document is deleted by retention while still unreviewed.** Retention runs 30 days after the trip ends, so that file can never be reviewed. The document row goes; the audit rows stay, so historical approved counts survive without keeping a copy of anything sensitive. **OPEN — needs Eyal & Ohad:** what a finished trip shows once the files are gone — frozen counts from the audit table, or no document section at all.

**A traveler is removed mid-review.** Their `group_trip_participants` row is gone, so they leave both count sides (§7 rule 3). Their documents follow the normal 30-day clock — no special case (`g-retention`). **Co-hosts:** any host of the trip passes `is_trip_host(trip_id)` and can review, consistent with the live multi-host model.

## 10. Files to create or change

**Create**
- `supabase/migrations/2026XXXXXXXXXX_group_trip_document_review.sql` — blocks A/B/C from §7.
- `src/services/operator/documentsService.ts` — `approveDocuments(ids)`, `rejectDocument(id, reason?)`, `getDocumentCounts(tripId)`, `getNeedsReview(tripId)`.
- `src/components/operator/OperatorDocumentViewer.tsx` — wraps `FilePreviewShell`, adds the approve / reject / export footer.
- `src/components/operator/RejectDocumentSheet.tsx` — **`BottomSheetShell`**, optional reason + "Send a message".
- `src/components/operator/BulkApproveBar.tsx` — selection footer.
- `src/screens/operator/OperatorDocumentsScreen.tsx` (per-type view-all, selection mode, bulk approve) and `OperatorNeedsReviewScreen.tsx` (the needs-review list).

**Change**
- `src/screens/operator/OperatorTripDashboardScreen.tsx` — `Received x/y · Approved x/y` tiles + the needs-review count; `OperatorTravelerFileScreen.tsx` — per-document state, approve/reject entry points, `Asked again 2×`.
- The traveler requirement card (operator-trip Plan / travel wallet) — the four states in §5.
- `src/services/notifications/notificationsService.ts` — new types, copy, tap-through target; and the push mapping function, re-applied by hand.

**Untouched**
- `public.is_trip_host()` — the review RPCs CALL it, never modify it; it gates six live tables.
- The storage layer — bucket, RLS, signed URLs, retention job. That is `documents-storage.md`.

## 11. Open questions

| # | Question | Owner |
|---|---|---|
| 1 | **Is the rejected file truly deleted, or archived?** The retention design says do not keep extra copies of sensitive documents. Confirm the bytes are gone, not moved. | **OPEN — needs Eyal & Ohad** |
| 2 | **What happens if an operator simply never reviews?** The decision is "nothing automatic", so documents can sit unreviewed until departure. Less likely now that approving is one tap inside the viewer, but still possible, and nothing catches it. | **OPEN — needs Eyal & Ohad** |
| 3 | Does an **acknowledge** requirement (the waiver) need approval at all? (§3) | **OPEN — needs Eyal & Ohad** |
| 4 | Does **approving notify the traveler**? (§8) | **OPEN — needs Eyal & Ohad** |
| 5 | What does the dashboard show after retention deletes the files? (§9) | **OPEN — needs Eyal & Ohad** |
| 6 | This spec's **approval concept is added scope Eyal has not seen** — `SPEC.md` has no approved state, and it adds ~60 reviews per trip. | **OPEN — needs Eyal** |
| 7 | How **custom operator-defined requirements** are counted, since the dashboard is built around known types. Already open on the workbench (`snap-docs`). | **OPEN — needs Eyal & Ohad** |

*Resolved by the extend-`C` decision (was open in the prior draft): `notifications.trip_id` FKs `group_trips`, and an operator trip is a `group_trips` row, so the reject notification uses `trip_id` directly.*
