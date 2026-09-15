# The Figma notes vs. what is actually built

**Written:** 21 August 2026
**Source:** the 13 "Notes" cards on the Figma page ` 🖥️ Swellyo V.1.3`
(`node-id=13977-33603`), exported as PDF. They are the open-questions round with
the design partners — black = the question, blue = the answer.

**What this is:** every answer in those cards, checked line by line against the
live database and the code in this repo. Nothing here is from memory; each row
names the file or table that settles it.

The headline: **the notes are older than the product.** Seven answers have been
overruled by decisions taken after the cards were written, and two of those seven
changed the shape of the thing, not a detail. (§1.1 has since been overruled
back — the note was right, and the code moved to it on 21 Aug.) Anything the notes still leave
open is listed at the bottom.

---

## 1. Answers the code has overruled

These are the ones that matter. In each case the note records a decision, and
the product now does something else. If the design partners are still working
from these cards, they are working from the wrong picture.

### 1.1 The operator picks again — RESOLVED 21 Aug, the note was right

> **Note 8, Q4** — "Are the passport, waiver, and Medical Card always required?"
> *"no, up to operator to decide what are the required tasks for his group –
> decided upon the trip creation"*

**True again.** This was the one item on this list where the note turned out to
be the better answer, and the code moved back to it rather than the other way
round.

Between 10 Aug and 21 Aug the set was fixed: seven requirements on every
operator trip, split the same way, with only the deadlines left to the
operator. The on/off toggles had been deleted from the create wizard. The
inconsistency that gave the game away is that **both post-publish editors kept
them** — `ManageRequirementsSheet` (in-app: Dashboard tab → Documents → Edit)
and `RequirementsEditor` (operator dashboard) have always let an operator add
and remove requirements on a live trip. So "the operator no longer picks" only
ever held until the trip was published, after which they could pick freely. A
wizard that refuses what the very next screen allows does not enforce a rule;
it just makes the operator publish first and fix it after.

`ONBOARDING_REQUIREMENT_SPEC` (`src/services/trips/tripDocumentsService.ts:927`)
survives as the **seed** — what every trip starts with, so an operator who reads
the step and moves on publishes exactly what operator trips have always asked
for:

| Kind | Seeded as | Default deadline | Switchable off? | Timing editable? |
|---|---|---|---|---|
| waiver | must-have | — | **No** — see below | yes |
| medical | must-have | — | yes | yes |
| deposit | must-have | — | no (the budget step decides it exists) | **No** — see below |
| balance | skippable | 30 days before | no (same) | yes |
| insurance | skippable | 30 days before | yes | yes |
| passport | skippable | 30 days before | yes | yes |
| flights | skippable | 14 days before | yes | yes |
| visa | skippable | 21 days before | yes | yes |

**The waiver is the one exception**, on all three screens (`LOCKED_ON_KINDS`).
Not for a technical reason: it is the only agreement the product has — there is
no terms acceptance and no separate liability form — so a trip running without
it holds no record of what anyone agreed to. It locks OFF, never ON: a trip
whose waiver was removed before this rule existed still shows an unticked,
tappable card, because forcing it on would silently re-create a requirement the
operator had deliberately removed.

Required-vs-optional came back with it. The wizard now shows the same two pills
the editors do — "When they join" / "They can skip" — seeded from the table
above. ⚠️ "When they join" is not urgency, it is **access**: the must-have set
is the wall between approved and actually on the trip
(`activate_trip_membership`), and a trip with none of them activates a traveler
the moment they open it.

**The deposit's timing is pinned** — `LOCKED_TIMING`, also written three times.
It is *the* wall, and making it skippable does not move a date, it removes the
wall. `freeze_traveler_price` / `operator_trip_full_payment_due`
(20260817000000) exist ONLY because the balance is skippable and the deposit is
not; a skippable deposit lets a traveler leave onboarding a full member having
paid nothing, holding a seat, owing the whole price — the exact hole that
migration was written to close. Nothing in the database refuses it
(`enforce_pay_requires_managed_trip` only checks `payment_mode`), so the rule
lives on the write path: `resolveTiming()` clamps it in both projects, not just
in the three UIs that hide the control. **The editors used to allow it** — that
was a latent bug, closed 21 Aug.

**Deadlines now move on one scale everywhere.** The wizard stepped in flat ±7
days while both editors snapped through `DEADLINE_STEPS`
(1/3/7/14/21/30/60/90/120/180/365) and refused a step that would land in the
past. Both wizard steppers — the Requirements step and the Pricing step's
"Payment deadline" — now use `stepDeadline` / `isDeadlineAtEnd` /
`deadlineStepBlocked` like the rest. ⚠️ **Plus means EARLIER**: the scale is
days *before* departure, so it runs backwards against the calendar, and `+` is
the only direction that can walk a deadline off the back of today.

**The three screens are twins and have to stay that way.** They share no code —
the dashboard is a separate Vite app with its own `catalog.ts` — so
`LOCKED_ON_KINDS`, `LOCKED_TIMING` and `resolveTiming` are each written twice
or three times on purpose. If one changes, change the
others, or "always on" is only true on whichever screen the operator did not
use.

### 1.2 A Manager can read the Medical Card

> **Note 10, Q1/Q2** — *"the traveler himself, and the trips operator only"* /
> *"only admins, so the creator of the trip and who ever else he gave the admin to"*

`medical.view` is a tier-4 capability, so **Manager** sees it too, not only the
trip creator. Whether "Manager" is what the partners meant by "admin" is a
question worth putting back to them — it is a medical record.

### 1.3 Requirements can be edited after publish

> **Note 8, Q5** — "Can the Operator add, remove, or modify the mandatory
> requirements?" *"not in V1, but good to keep in mind"*

Built, and on both platforms: `src/components/trips/ManageRequirementsSheet.tsx`
(in-app) and `operator-dashboard/src/components/RequirementsEditor.tsx` (web)
both let an operator switch a requirement on or off and re-time it on a
**published** trip. Switching one off is a clean delete when nothing has been
sent, and `is_active = false` once anything has (`removeRequirement`,
`tripDocumentsService.ts:620`) — so a passport already uploaded is never
stranded and a signed waiver is never erased.

Since 21 Aug the create wizard offers the same choices (§1.1), so the three
screens finally agree.

### 1.4 Removing an approved traveler is decided and shipped

> **Note 9, Q5** — *"TBD, depends on the cancelation policy which is not yet
> decided upon"*

Both the policy and the removal are built. The policy is frozen onto the trip at
publish (`group_trips.cancellation_preset` / `cancellation_rules`), the traveler
consents to it (`organized_trip_policy_consents`), and removal makes the refund
decision **first**, then removes — on mobile (`RemoveTravelerSheet.tsx`) and on
desktop (`operator-dashboard/src/services/removal.ts`).

### 1.5 Payment timing is decided

> **Note (Payments), Q2** — *"THE TIMING of charge is still open ended"*

Decided: the **deposit** is the last must-have of onboarding, charged as they
join; the **balance** carries a deadline the operator sets on the Pricing step
(one value, written to both the requirement and
`group_trips.offline_payment_due_days_before`). Travelers can also pay the
balance in parts (`PayAmountSheet.tsx`, "Pay part of it").

### 1.6 A missed deadline does much more than raise a red flag

> **Note (Payments), Q5** — *"TBD - msut check with the design partners but
> probably just a big red flag for the operator in the dashboard"*

Shipped well past that:
- `operator_requirement_deadline_owed()` — daily scan, per trip
  (`supabase/migrations/20260820000000_requirement_deadline_scan.sql`)
- notifications to the traveler (`operator_requirement_due_soon`,
  `operator_requirement_overdue`) **and** to the operator
  (`operator_requirement_overdue_operator`)
- stalled-onboarding nudges at 4h / 24h / then daily
- the red flag as well — overdue states in the dashboard work list

### 1.7 Desktop is no longer read-only

> **Note 4** — *"communication with customers (chat, admin updates, gear lists)
> … both only on mobile"*

Chat, admin updates and gear are still mobile-only ✓. But the desktop dashboard
has grown past "review and export": it now sets the trip price and deposit, edits
deadlines, manages crew, issues refunds, and **removes travelers**
(`operator-dashboard/src/services/{payments,requirements,staff,refunds,removal}.ts`).
`operator-dashboard/docs/SPEC.md` §1 still says it "cannot … remove travelers" —
that line is stale.

---

## 2. Answers that match what is built

| Note | Claim | Evidence |
|---|---|---|
| Payments Q1 | In-app for most, outside for some | `group_trips.payment_mode` = `managed` \| `offline` |
| Payments Q3 | The **system** confirms payment | Stripe webhook → `organized_trip_payment_events`; no manual mark-as-paid |
| Payments Q4 | No proof-of-payment upload | No such requirement kind exists |
| Note 1 | Set tasks + deadlines at creation | Requirements step (timing only — see §1.1) |
| Note 2 | Medical form = allergies, dietary, injuries, medication | `organized_trip_medical_forms`, 4 fields + 4 `_none` flags |
| Note 2 | Skippable-till-a-date: insurance, visa, flights | `skip_at_onboarding = 'skippable'` + `deadline_days_before` |
| Note 3 | Paid-in-full / deposit / open counts | `buildTripMoney`, `paidCountByKind` |
| Note 3 | Docs uploaded "14/15" per requirement, view all | `RequirementPage.tsx` (web), per-requirement page |
| Note 3 | Medical flags with counts | `fetchMedicalFlags` — forms, injuries, allergies, dietary, medications |
| Note 3 | Surf level / board / age range / nationalities | `buildSurfStats` |
| Note 3 | "a page for itself, view + export for all" | `RequirementPage` / `TravelerPage`, "Export all (n)" → zip |
| Note 4 | Chat, admin updates, gear lists mobile-only | No such route in `operator-dashboard/src/routes` |
| Note 6 | Per document: view, export, delete + reclaim | `DocumentViewer` `allowExport`; reject **is** delete + reclaim |
| Note 6 | Medical: view only | `TravelerExtras.tsx` reads the form, no write path |
| Note 6 | Actions: message, remove, remind | `TravelerExtras.tsx`, `RemoveTravelerSheet`, `remindRequirement` |
| Note 7 | Overview: staff highlighting, what's included | `CrewSection`, `priceInclusions` |
| Note 7 | Plan: open tasks, view what was uploaded, edit medical card | `plan/PlanSections.tsx`, `MedicalFormSheet` |
| Note 8 Q1 | No custom tasks in V1 | `kind='custom'` exists in the CHECK but has **no creation UI**, and the onboarding runner skips it |
| Note 8 Q2 | Task types: upload / form / pay / sign | `req_type` CHECK = `upload`, `acknowledge`, `pay` |
| Note 8 Q3 | Only uploads need approval | Only `organized_trip_travelers_documents` carries `approved_at` / `rejected_at` |
| Note 8 Q6 | Documents are never reused — new every trip | Every evidence table is keyed on `trip_id`; nothing reads a previous trip |
| Note 8 Q7 | No expiry notification | `expiry_date` is captured; no producer anywhere fires on it |
| Note 9 Q1 | Onboarding starts after approval | `20260820000500_join_request_decided_onboarding.sql` |
| Note 9 Q2 | An official participant before the documents are approved | `activate_trip_membership` waits for the must-haves to be *done*, never for an operator to approve anything — `submitted` counts as settled |
| Note 9 Q4 | Reclaim a file | Reject and reclaim are one button; file deleted, row + note survive |
| Note 10 Q1 | Medical is per trip, not saved to the profile | `organized_trip_medical_forms` keys on `(trip_id, user_id)` |
| Note 11 Q1/Q2/Q4 | Admins and members, nothing assigned per person | `organized_trip_staff_roles` names five rungs of that same split — tiers 1–3 are the member side, 4–5 the admin side; a staff member picks a rung, not a checklist |
| Note 13 Q2 | No per-event notification choice in V1 | No preferences table, no UI |
| Note 13 Q3 | Automatic reminders before deadlines | The daily scan in §1.6 |
| Note 13 Q4 | Updates go to all travelers | `TripUpdatesScreen` / `AdminUpdateUI`; 1-to-1 is a normal DM |
| Note 13 Q5 | No read receipts on updates | Not built |

---

## 3. Still open — in the notes *and* in the code

1. **Templates and recurring trips (Note 12).** All four questions unanswered,
   and nothing is built: no duplicate-trip path, no template. The Figma board
   itself shows a "Copy an existing trip as a starting point" card in the
   create-trip sheet, so the design is ahead of both the decision and the code.
2. **Consent to sharing medical information (Note 10, Q3 — "TBD").** Still
   genuinely open. The only consent we record is the **cancellation policy**
   (`organized_trip_policy_consents` / `record_trip_policy_consent`). Nothing
   asks a traveler to agree that their allergies and medication go to the
   operator. This one has legal weight — it should not stay open.
3. **Which events notify the operator (Note 13, Q1 — "TBD").** Partly answered
   by what shipped (overdue, stuck payment, disputes, Stripe breakage, join
   requests) but never written down as a list, and there is no way for an
   operator to change it.
4. **Money in more than one currency (Note 3, "dollars / shekels").** Everything
   is USD: `amount_usd` on events, `cost_per_person` unqualified. The
   display-currency work exists in the repo but its migration is **not applied**
   — `group_trips` has no display-currency column today.
5. **"Helpful links" (Note 7).** Listed twice in the note. Nothing in the code.
6. **Staff highlighting during trip creation (Note 1).** The wizard has no crew
   step at all — crew are added after publish via `TripStaffSheet`. Whether that
   is a gap or a deliberate simplification was never recorded.
7. **Per-trip notification setup, "self + customers" (Note 1, "nice to").** Not
   built, and consistent with Note 13 Q2 saying not-in-V1.

---

## 4. What to do with this

Two of the overrules are worth taking back to the design partners rather than
just noting, because they were *their* answers and we changed them:

- the operator no longer chooses the document set (§1.1)
- a Manager, not only the trip creator, can read a Medical Card (§1.2)

And item 2 in §3 — medical consent — is the one open question with a real
downside if it stays open.
