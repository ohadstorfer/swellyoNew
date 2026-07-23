# Operator Trips — Master Spec (living doc)

**Status:** planning / ideation. No code yet. Eyal's rule for this phase:
> "First planning and systemic decisions, DB ordering etc. Then a step-by-step action plan.
> Today I mainly want to plan, play with everything, take decisions, do research — and only
> after everything is ideationally closed (not detail-level) start touching development."

**Purpose of this file:** the single bigger-picture reference. When we start building any
individual feature, this doc is what tells us where that feature sits and what it must not break.

**Sources:** Eyal's WhatsApp brief (2026-07-21/22) + the planning board image + existing docs:
- `docs/operator-trips-architecture-recommendation.md` — DB/arch recommendation (⚠️ see Decision 0)
- `docs/operator-conversation-guide.md` — what to tell/ask Israeli operators (money, KYC, fees)
- `docs/trip-vocabulary-spec.md` — Crew / Captain / Operator naming
- `docs/payments-questions-gateways.md`, `docs/payments-questions-accountant.md`

---

## 0. The one-liner

Turn the existing "Operator" trip type into a real product for **professional trip organizers
who charge money** — so they can plan, publish, sell, and operate a paid surf trip end to end
inside Swellyo, and so their travelers get a guided onboarding + document wallet + task system.

Four surfaces:

| # | Surface | Who | Platform |
|---|---|---|---|
| 1 | **Trip creation** (extended) | Operator | Mobile |
| 2 | **Traveler onboarding + in-trip experience** (extended) | Traveler | Mobile |
| 3 | **Simple trip management** (edit info + comms) | Operator | **Mobile only** |
| 4 | **Dashboard** (snapshot, per-traveler files, exports) | Operator | **Mobile + Desktop** |

---

## ⚠️ Decision 0 — the architecture contradiction (BLOCKS EVERYTHING)

This must be resolved before any schema work.

**What's in the repo today:** "Operator" is `hosting_style = 'C'` — a **flag on the live
`group_trips` table**. Flow C already exists in `CreateTripFlowA.tsx`, has fixed pricing,
and has its own `price_inclusions` JSONB column. `tripVocabulary.ts` maps `C → 'Operator'`.

**What `operator-trips-architecture-recommendation.md` recommends:** *Option C* — a
**fully separate** `operator_trips` + `operator_trip_bookings` + payment-ledger + documents +
tasks model, explicitly rejecting "flag on `group_trips`" (called Option A) as an antipattern
because it forces `is_trip_host()` and six dependent tables to grow payment/document/deadline
branches.

**Reality check:** `grep -rln "operator_trips" src/ supabase/` → **no matches.** The
recommendation was never implemented. We shipped the thing the doc argues against.

**So the real question is not "which option" — it's:**
- **(a)** Keep `hosting_style='C'` as the trip shell, and hang all the NEW heavy stuff
  (bookings, payments, documents, tasks) off **new separate tables** keyed by `group_trip_id`.
  A hybrid: no migration on the live table, no duplicated trip shell, but `is_trip_host()`
  and the participants state machine stay shared.
- **(b)** Do the full split now — new `operator_trips`, migrate/abandon existing Flow C trips,
  duplicate the trip shell. Maximum isolation, real migration cost, and Flow C trips already
  exist in prod.

**My read:** (a) is almost certainly right *now*. The arch doc's core argument is about
**divergent row shapes on `group_trip_participants`** and **payment/document lifecycles** —
and (a) keeps all of that in new tables anyway. The doc's Option A strawman was "put payments
and documents *inside* the existing tables", which (a) does not do. The trip **shell**
(dates, destination, hero image, price) genuinely is the same shape across A/B/C — that part
was never the risk.

The one thing (a) must answer: does `operator_trip_bookings` **replace** or **sit alongside**
`group_trip_participants` for Flow C trips? Sitting alongside means two sources of truth for
"who is on this trip" — that's the actual trap. Proposal: participants stays the roster,
bookings is a **1:1 side-table** on top of it holding money/document/task state.

→ **NEEDS A DECISION FROM EYAL + OHAD BEFORE ANY SQL.**

---

## 1. Trip creation (operator) — "same as now +"

Operator does the current creation flow, plus:

### 1.1 Set onboarding requirements — DECIDED (concept)
Operator chooses **what travelers must provide**, and for each one whether it's
**mandatory** or **skippable-until-a-date**.

Candidate items (Ohad's list — "things we need to collect from travelers that we don't collect today"):

| Item | Likely bucket | Notes |
|---|---|---|
| Passport upload | Onboarding (mandatory) | PII |
| Waiver signature | Onboarding (mandatory) | legal — see Open Q |
| Medical status | Onboarding (mandatory) | allergies, dietary prefs, injuries, regularly-taken prescribed medicine |
| Payment | Onboarding — "before someone *joins*" | timing set by operator |
| Insurance (screenshot/file) | More likely Open Task | often bought later |
| Visa (if applicable) | More likely Open Task | |
| Flight tickets (if applicable) | More likely Open Task | |

**DECIDED — the skip rule:** onboarding shows both `must` and `skippable` items, with a
literal **Skip** button on the skippable ones. *Anything skipped automatically becomes an
Open Task.* (Ohad proposed, Eyal: "very likely", Ohad: "yes.")

**NOT DECIDED:** the exact must/skippable split per item. Eyal: *"we'll figure out along the
way what exactly is part of onboarding and what is open tasks — but treat them as one for now."*
This is a design-partner question, not an engineering one.

### 1.2 Open tasks + deadlines — DECIDED (concept)
At creation (and **also outside the flow, added later** — Eyal expects this), the operator
defines tasks travelers must complete by a deadline. Example: upload visa by DD/MM.

**We (the system) do the chasing:**
- remind the traveler as the deadline approaches / passes
- notify the operator when there's something they need to know

→ Reuse the existing notifications push queue (`docs/superpowers/HANDOFF-notifications.md`).
Do **not** build a second notification system.

### 1.3 Payment requirement timing — NOT DECIDED
Lives either in onboarding or in open tasks. Eyal: *"need to talk to the design partners to
see what they'd want — at what stage, deposit (mikdama) or full amount."*
Board implies: probably onboarding, **before someone "joins" the trip**.

Ties directly into `docs/operator-conversation-guide.md` — the deposit/balance split exists
precisely because operators need cash before the trip to pay suppliers.

### 1.4 Staff highlighting — PARKED (deliberately)
Ohad asked: normal user the admin adds to the group and gets shown as staff, or a different
staff profile type?

Eyal's answer — **start basic**:
- everyone keeps a **normal Swellyo profile**
- a staff member can join the group, get admin, whatever — nothing special
- the operator, **during trip creation**, just fills in a **display section for staff** —
  photo, a few words, a highlight — *like what exists today for Captain*
- "but let's wait on this part, let it mature a bit"

**Ohad's related idea, also parked:** if we're building a custom profile anyway, the higher
priority might be an **operator/organizer profile page** — their past trips, photos, etc.
→ not rejected, just not now. Worth revisiting when we do the marketing/trust story.

### 1.5 Notifications setup — "nice to have"
Operator sets notifications on things, for themselves + for customers. Explicitly marked
nice-to-have on the board.

---

## 2. Traveler onboarding — "normal onboarding +"

After the operator publishes, people can start signing up.

**Mandatory block:** passport upload · waiver signing · medical status (allergies, dietary
prefs, injuries, regularly-taken prescribed medicine).

**Skippable-until-date block:** insurance screenshot/file · visa (if applicable) ·
flight tickets (if applicable). Skipping → the item lands in Open Tasks.

**Payment:** somewhere in onboarding, timing per operator (see 1.3).

---

## 3. After onboarding — the traveler's in-trip experience

"All that users see today, plus:"

### In **Overview**
- **Staff highlighting** — see the staff, not only the captain
- **"What's included"** — improved, more precise breakdown
  (today: `src/services/trips/priceInclusions.ts`, one JSONB column, already extensible)

### In **Plan** — the biggest, most substantial change
- **Open tasks** with the notification system — passport, insurance, visa, due payment, etc.
- **Travel wallet** — view everything already uploaded: insurance, passport, visa, flight
  tickets, and a **"my medical card"** the traveler can edit
- **Helpful links** section (nice-to-have)

### One step later (monetization)
If certain areas are empty, we surface **suggestions**, and take a cut:
- "close your insurance with our agent"
- "go to Google Flights through us"

### Full list of traveler-facing value (board, right column)
chat · gear · admin updates · view profiles · notifications system · pay ·
accessible personal info to view (maybe) · edit some personal info · helpful links · open tasks

---

## 4. Simple trip management (operator) — **mobile only**

Two parts:

### 4.1 Edit trip info — DECIDED, with a real policy change
A dedicated, **simpler, more straightforward** editing screen for operators.

**Scope, clarified explicitly by Eyal:** this is editing the **trip Overview only** — i.e.
*everything you fill in during the trip creation flow*. Photos, dates, levels, boards, etc.
> Ohad: "does the edit window also cover things we edit today via Plan, like gear items?"
> Eyal: **"No. Plan is plan.** I'm talking about editing only the trip's overview."

**Entry point (Eyal's exact picture):** operator is in the trip → Overview → taps the
**3 dots** → **Edit trip** → screen where they can edit the details.

**⚠️ Policy change:** Ohad flagged that most of these fields are currently **defined as
non-editable** — deliberately, because people already joined the trip based on those details.
(Confirmed in code: `CreateTripFlowA.tsx` renders `'Locked'` placeholders and blocks sheets
when `editMode`.)

Eyal's ruling:
> "Correct, but **operators is different**. These are businesses, our partners… we can trust
> them, at least at the start, when there's a more limited number of them."

Ohad: "but I support [it]".

→ **DECIDED: operators get edit rights that peer hosts don't.** Explicitly a
*trust-at-small-scale* decision — flag it for revisit once operator count grows.
→ **OPEN:** do already-joined travelers get notified when a material field changes
(dates, price, destination)? Not discussed. Should be.

### 4.2 Communication with customers — existing, unchanged
The regular, already-built stuff: chat · admin updates · private DMs · gear lists.

---

## 5. Dashboard — **mobile + desktop**

> Management (4.1 + 4.2) is mobile only. The **dashboard is mobile AND desktop.**

**Entry model — explicitly App Store Connect:** you enter and see a list of "apps" (trips)
to choose from, and from there a **space per app (trip)**. Plus "create new".

### 5.1 Trip snapshot
"Start with something cute, keep upgrading it." Current thinking:

**1. Money**
- total number of people who paid in full
- total amount paid (₪ / $)
- open payments (still owed)
- total people who paid only a deposit (mikdama)
- total paid in installments (tashlumim)

**2. Open-tasks snapshot** — per document type: "14/15 uploaded passports", same for visas,
insurance, flights. + **View all**.

**3. Medical flags** — anything not smooth gets flagged small for the operator: allergies,
food prefs, injuries. e.g. "3 reported injuries" → **View all** action.

**4. Surf stuff** (general awareness) — how many beginners / intermediate / advanced, how many
shortboarders etc., age ranges, nationalities.

> **Note, board, load-bearing:** *every one of these (money, passports, visas… all of them)
> gets its own dedicated page*, where you can see everything in full detail and **export**
> some of it.

### 5.2 Viewing an individual traveler

**1. Their normal surfer/traveler profile** — as everyone sees it: surf level, travel
experience, name, photo, age, nationality, home break, board type, places they've been,
lifestyle prefs.

**2. Personal info** — the full file:

| Field | Operator capabilities |
|---|---|
| Waiver signed | yes / no |
| Passport | view · export · delete + reclaim |
| Insurance | view · export · delete + reclaim |
| Flight info | view · export · delete + reclaim |
| Visa | view · export · delete + reclaim |
| **Medical status** | **view only** — allergies, injuries, dietary prefs, regular medication |

**"Delete + reclaim"** = the operator rejects a bad upload and asks for a new one.
Examples given: wrong insurance, blurry passport, wrong visa.

**3. Actions from a traveler's profile**
- remove from trip
- **send a message — mobile only**
- delete + reclaim a document
- send a reminder for something — *nice to have*

---

## 6. Open questions / decisions still missing

Grouped by who can answer them.

### 6.1 Blocking, needs Eyal + Ohad
1. **Decision 0** — the `operator_trips` vs `hosting_style='C'` architecture split. Nothing
   else can start.
2. **Bookings vs participants** — is there one roster or two? (see Decision 0)
3. **Desktop dashboard viability.** Our own memory says *mobile is the primary live product,
   web is basically unused*. A desktop dashboard means reviving and maintaining the web
   build as a real surface. Confirm we're committing to that, or ship dashboard mobile-first
   and treat desktop as phase 2.
4. **Trip-edit notifications** — do joined travelers get told when dates/price/destination change?

### 6.2 Needs design partners (operators)
5. **Payment stage** — onboarding or open task? Before or after "joining"?
6. **Deposit vs full amount** — and what the split looks like.
7. **The must/skippable split** per document type.
8. **Cancellation & refund policy** — free window, fees, who eats the processing cost.
9. **Do they need money before the trip** to pay suppliers? (`operator-conversation-guide.md`
   calls this "the important one" — ask EVERY operator.) This directly conflicts with
   hold-until-after-trip.
10. **Staff model** — display-only section vs. real staff roles. Parked pending operator input.

### 6.3 Money / legal / commercial — still `[X]`
11. **Swellyo commission %** — undecided, appears as `[X]%` in the operator guide.
12. **Payment gateway** — Tranzila is the lead, not final.
13. **Who pays the card fee** — traveler (common) or operator absorbs it.
14. **Payout timing** — "~X days after the trip ends".
15. **Operator KYC / onboarding** — bank account, ID, business registration. Mentioned in the
    operator guide but **completely absent from the feature brief**. Someone has to build the
    operator-side signup. Not scoped anywhere yet.

### 6.4 Not discussed at all — I'm raising these
16. **PII / privacy law.** We're about to store passports, visas and **medical data** for
    Israeli and international travelers. That's special-category data under GDPR and sensitive
    under Israeli privacy law. Needed: private bucket + signed URLs only (the arch doc already
    proposes `operator-trip-docs`), retention policy, deletion-after-trip, an access audit log,
    and probably a DPA with each operator. **This is the highest-risk unscoped item in the doc.**
17. **Waiver mechanics.** Is it a PDF the operator uploads per trip? Is a tap-to-sign
    legally binding? Do we store a signed copy, IP, timestamp? Nothing specified.
18. **Export format & channel** — CSV? PDF? Emailed? Downloaded? Does "export" of a passport
    scan leave our controlled storage (see #16)? Medical is view-only in the profile — is it
    also export-forbidden in the aggregate "view all" pages? The board is ambiguous.
19. **"Delete + reclaim" semantics** — does it notify the traveler, reopen the task, reset the
    deadline? Can the operator write a reason?
20. **Capacity as real inventory** — the arch doc argues a spot must be *secured* at
    deposit-paid, atomically, unlike today's soft `max_participants`. Not mentioned in the
    brief at all. Overselling a paid trip is a much worse failure than overfilling a peer trip.
21. **Refund on removal** — operator can "remove from trip". What happens to money already paid?
22. **Who besides the operator sees the dashboard** — staff members? Is dashboard access a role?
23. **Currency** — group trips already do frozen-FX ₪/$ (`project_group_trip_multi_currency`).
    Operator payments are ₪ with tashlumim. Confirm they use the same model.
24. **Helpful links** — operator-authored per trip, or a Swellyo-curated list per destination?

---

## 7. Existing infra we should reuse (do not rebuild)

| Need | Already exists |
|---|---|
| Notifications + push queue | `docs/superpowers/HANDOFF-notifications.md` — LIVE on prod |
| Chat / group conversation | `messagingService.createGroupConversation(..., { trip_id })` — soft-keyed by metadata, no FK. The one genuinely safe shared surface. |
| Admin updates | `group_trip_admin_updates` + `TripUpdatesScreen.tsx` |
| Gear | `ManageGearScreen` / `YourGearScreen` / `PackingAndGearScreen` |
| "What's included" | `src/services/trips/priceInclusions.ts` — JSONB, grows without migration |
| Trip type naming | `src/services/trips/tripVocabulary.ts` (`C → Operator`) |
| Trips caching | react-query v5 (`project_trips_react_query`) |
| Bottom sheets | `BottomSheetShell` — never hand-roll a Modal |
| Feed | `explore_feed` / `my_trips_feed` RPCs — any new operator display column must be added to these |

---

## 8. Suggested build order (proposal, not decided)

0. **Resolve Decision 0.** Write the schema. Nothing before this.
1. **Documents + tasks, no money.** Onboarding requirements → uploads → open tasks →
   reminders → traveler travel-wallet → operator per-traveler file view. This is the whole
   product minus payments, and it's independently useful. It also forces us to solve #16
   (PII) early, which is the right order.
2. **Operator trip editing** (4.1) — small, isolated, unblocks operator self-service.
3. **Dashboard, mobile, read-only.** Snapshot + per-item detail pages + exports.
4. **Payments.** Gateway, ledger, deposits, capacity-as-inventory, refunds, operator KYC.
   Biggest risk, most external dependencies, most undecided — last, not first.
5. **Desktop dashboard**, staff model, operator profile, monetized suggestions.

Rationale: everything before step 4 is buildable with decisions we can make ourselves;
step 4 is gated on design partners, an accountant, and a gateway.
