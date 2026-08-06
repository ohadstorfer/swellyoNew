# Dashboard tab — turning a report into a workbench

**Status:** ⏳ **All four phases BUILT 2026-08-05, client uncommitted.**
✅ **Migration `20260805000300_operator_remind_requirement.sql` APPLIED TO PROD 2026-08-06.**
Verified: RPC is SECDEF with a pinned search_path, `authenticated` has EXECUTE, `anon`/`PUBLIC`
do not, `notification_push_priority` grants unchanged, `due_soon` priority `-1`→`1`, 0
notifications sent by applying. Nothing is on a device yet. Written 2026-08-05.
**Scope:** 9 changes to the operator Dashboard tab. Item 2 of the original ten (splitting the
review banner in two) was **dropped by Ohad** — see §4 for what that leaves behind.
**Follows:** `dashboard-tab-design.md` (the visual pass, built the same day). That one made the
tab look right. This one makes it work.
**Related:** `documents-storage.md`, `requirements-model.md`, `approval-review.md`,
`operator-dashboard/docs/SPEC.md` §4.2.

---

## 1. The problem in one line

**The tab is a report. Its user needs a workbench.**

It answers *"what are the numbers?"* The operator opens it to answer two other questions:

1. **Am I going to be ready in time?**
2. **What do I do next, and who do I chase?**

Nothing on the screen answers either. Everything below follows from that.

---

## 2. Two things I got wrong before writing this

Both make the work **smaller**, and both change the design. Recorded here so nobody plans off
the earlier review.

### 2a. "Late" is already computed. We just ignore it.

The first review said the tab would have to read `ReviewItem.dueDate` and work out lateness
itself. It does not. `fetchTripReview` already does it — `tripDocumentsService.ts:1203`, and
again at 1241, 1256 and 1271 — and hands the tab items already stamped `state: 'overdue'`.
The Plan tab already paints them red and writes *"was due 3 Aug"*
(`PlanSections.tsx:1281-1284`).

**The data is in the tab's hands today. It is thrown away.** No new query, no date maths, no
timezone work (that care is already taken — see the comment at `tripDocumentsService.ts:1323`).

### 2b. `'overdue'` is narrower than it sounds — and item 1 breaks without knowing that

Read the branches at 1241 / 1256 / 1270. `'overdue'` means exactly:

> **The traveler has sent nothing, and the due date has passed.**

Two things it does **not** cover:

| Case | What state it gets | Consequence for a naive "N late" line |
| --- | --- | --- |
| Sent a blurry passport → operator rejected it → never resent, due date passed | `'rejected'` | **Invisible.** The person most likely to miss the flight does not appear in the count. |
| A `pay` requirement past its due date | hardcoded `'not_started'` (line 1219) | Money deadlines can never be late on this screen. |

So the count this spec builds is **not** `state === 'overdue'`. It is:

```
late = state === 'overdue'
     || (state === 'rejected' && dueDate !== null && dueDate < today)
```

`dueDate` survives on every item via `base` (line 1209), so this is client-side arithmetic on
data already in hand. **No service change.**

Pay rows staying invisible is left alone here — see D3.

---

## 3. The nine changes

### Item 1 — Put time on the screen

**Now:** the tab has no idea when the trip is. `7/15 in · 3/15 ok` reads the same 90 days out
and 3 days out. Nothing is ever marked late.

**Build:** a status line as the **first thing in the tab**, above the mode notices.

```
14 days to go · 2 documents late
```

| Trip state | Line reads |
| --- | --- |
| Future trip, nothing late | `14 days to go · nothing late` |
| Future trip, things late | `14 days to go · 2 documents late` (late half in `D.danger`) |
| Departs today | `Leaves today · 2 documents late` |
| Under way | `Under way · 2 documents late` |
| Finished | `Trip ended` (no late count — chasing is over) |
| `start_date` is null | drop the countdown, keep the late count |
| `review` still loading | render nothing, not a skeleton — see below |

**Needs:** `startDateISO` passed down from `TripDetailScreen` (it already has it —
line 273). One new prop. `late` is computed in the tab per §2b.

**Do not render a placeholder while loading.** A status line that says "nothing late" and then
flips to "2 late" a second later is worse than a beat of nothing — the operator reads the first
one and relaxes. Same reasoning as `StripeBanner`'s `not_started` silence
(`TripDashboardTab.tsx:252-254`).

**Rows follow the line.** A traveler row with a late item gets the count in `D.danger`, and
`DocumentsCard` rows with late items show `2 late` after the in/ok counts.

---

### Item 3 — "Remind N people"

**The biggest item, and the only one that touches the database.**

**Now:** there is no way to chase a group. To remind four people the operator taps a person →
`TravelerExtras` → "Message Maya" → back → repeat, four times, having first worked out who the
four are by reading fifteen grey sub-lines. Verified: no remind or nudge anywhere in
`src/components/trips/` or `src/services/trips/`.

**The plumbing already exists and has no producer.** Migration
`20260724000000_operator_notification_types.sql` added `operator_requirement_due_soon` and
`operator_requirement_overdue`, and `20260724000500_operator_push_priority.sql` already maps
their push priority. Its own comment says:

> `operator_requirement_due_soon` — reminder cadence is not decided yet

**Nothing ever creates one.** A manual button dissolves that problem: the operator decides the
cadence by tapping. This is the producer that was deferred.

**Build:**

*Client* — on each `DocumentsCard` row where someone still owes, a second line:

```
Passport                    7/15 in · 3/15 ok   ›
                            Remind 8 people
```

Tapping asks for confirmation (it sends a real push), then sends, then shows
`Reminded 8 people` for a beat. If some were skipped by the cooldown:
`Reminded 5 · 3 already reminded today`.

*Database* — one new RPC. **Nothing else. No new table, no new column.**

```
operator_remind_requirement(p_trip_id uuid, p_requirement_id uuid) returns int
```

- `security definer`, `set search_path = public, extensions, pg_temp`
  (house rule — see `search_path pinned on 46 fns`)
- Rejects anyone failing `is_trip_host(p_trip_id, auth.uid())`
- Finds travelers with nothing recorded for that requirement, reusing the same branch order as
  `operator_trip_my_requirements` — acknowledge before medical, exactly as
  `fetchTripReview` mirrors it (`tripDocumentsService.ts:1228-1230`). **If these three ever
  disagree, the button reminds the wrong people.**
- Inserts into `public.notifications` with type `operator_requirement_due_soon`
- **Cooldown:** skips anyone who already has that type for that `entity_id` inside 24 hours.
  Read from `notifications` itself — no new state to store
- Returns how many were actually sent, so the client can report honestly
- `grant execute to authenticated`, `revoke execute from anon, public`
  — **a new client RPC without an explicit grant returns 403** (see the SECDEF revoke note)

**Two build-time checks that will bite otherwise:**

1. `notification_templates` was written 2026-06-11, the operator types on 2026-07-24. **There
   is almost certainly no template row for `operator_requirement_due_soon`.** Check what the
   bell renders without one before shipping; add the row if it falls back to something ugly.
2. This fires **real pushes to real people.** Test only on a trip whose members are all dev
   accounts (house rule). Do not "just try it" on a live trip.

---

### Item 4 — Sort travelers by who needs attention

**Now:** alphabetical, defended in a comment as *"the review queue is where work-first ordering
belongs."* That holds only while a review queue exists — and it vanishes the moment `toReview`
hits 0, which is exactly when six people have sent nothing.

**Build:** default sort, worst first:

| Rank | Group |
| --- | --- |
| 1 | Has something **late** (per §2b) |
| 2 | Has something **rejected** and not resent |
| 3 | Has **not started** anything |
| 4 | Has something **waiting on the operator** (`submitted`) |
| 5 | Everything approved |

Alphabetical inside each group. A small `A–Z ⇅` toggle in the section header keeps the
find-one-person-by-name case, which is real.

Pure client-side sorting. No data change.

---

### Item 5 — A failed fetch must not claim the trip is empty

**A live bug.** `profiles.isError` is never handled (`TripDashboardTab.tsx:150-153`). On error
`isPending` is false and `data` is undefined → `[]` → `SurfStatsBody` takes its
`profiles.length === 0` branch and renders **"No travelers yet."** on a trip with fifteen
travelers.

Three sections, three behaviours, one of them false:

| Section | On error today |
| --- | --- |
| Money | "That did not load." + **Try again** ✅ |
| Medical | "Could not load." — no retry ⚠️ |
| Surf stats | **"No travelers yet."** ❌ |

**Build:** one shared `SectionError` — *"That did not load."* + **Try again** wired to that
query's `refetch`. Use it in all three. `SurfStatsBody`'s empty branch then only ever runs on a
genuinely empty trip.

Smallest item here and the only one fixing something actively wrong. Ship it first.

---

### Item 6 — Let the screen refresh

**Now, both verified:**

- **No `RefreshControl` anywhere in `TripDetailScreen`.** Zero hits. The operator's operations
  screen has no pull-to-refresh.
- Of the tab's three queries, only `money` is ever invalidated — once, from the price sheet
  (`TripDetailScreen.tsx:2786`). **`operatorDashboard/medical` and `operatorDashboard/profiles`
  are invalidated by nothing, anywhere in the repo.**

So: approve a medical form, come back — the counts have not moved. Sit on the screen while a
payment lands — nothing. The only cure is a full remount, which no operator would guess.

**Build:**

1. `RefreshControl` on the `Animated.ScrollView` at `TripDetailScreen.tsx:2228`, refetching
   everything the visible tab shows.
2. Add `medical` and `profiles` to the invalidation that already fires for `money` after a
   review action.

---

### Item 7 — Open operators on the Dashboard

**Now:** `activeTab` starts at `'overview'` for everyone (`TripDetailScreen.tsx:706`).
Overview is the page the operator wrote themselves; Dashboard is the only tab with news. They
pay a tap every single time.

**Build:** when `canSeeDashboard` is true, start on `'dashboard'`.

**Two traps:**

1. `canSeeDashboard` is computed at line 796, ninety lines *after* the `useState`. It cannot
   seed the initial value. Use a one-shot effect guarded by a ref — **not** a plain effect,
   which would drag the operator back to Dashboard every time they chose Overview.
2. There is already a **notification deep-link effect** (line 812 onward) that picks the tab
   from `initialFocus`, guarded by `appliedFocusRef`. The new default must **stand down
   whenever `initialFocus` is set**, or tapping "your passport was approved" lands on the wrong
   tab.

---

### Item 8 — Say how many people answered

**Now:** `2 injuries · 1 allergy · 3 diet notes · 0 medications`.

`formsCompleted` **is fetched and never rendered** — used only as a `> 0` gate
(`TripDashboardTab.tsx:135`). So "1 allergy" might be 1 of 2 people who answered, or 1 of 15.
Those mean completely different things: one is a note, the other means the operator still does
not know what most of the group can eat.

**Build:**

```
9 of 15 filled in the medical form
2 injuries · 1 allergy · 3 diet notes
```

Denominator is `travelers.length`. **Drop every zero** — a count of nothing is noise crowding
out signal. If all counts are zero but forms are in: *"9 of 15 filled in. Nothing flagged."*

The number is already in hand. This is a display change only.

---

### Item 9 — Move Medical and Surf stats below the travelers

**Now:** two untappable, dead-end blocks sit **above** the traveler list. On a phone they push
the one working list below the fold.

**Build:** move both under Travelers, merged into one section: **"About this group"** —
medical counts first (they affect how the trip is run), surf stats second.

Ordering after every change in this spec:

| # | Section |
| --- | --- |
| 1 | **Status line** *(new — item 1)* |
| 2 | Mode notices (test mode, hidden payments) |
| 3 | Stripe banner |
| 4 | Review banner |
| 5 | Money *(+ outstanding — item 10)* |
| 6 | Documents *(+ Remind — item 3)* |
| 7 | **Travelers** *(sorted by work — item 4)* |
| 8 | **About this group** *(medical + surf, merged — items 8, 9)* |

---

### Item 10 — Show what is still owed

**Now:** *"$4,200 collected of $9,000."*

No operator thinks in "collected." They think in **who still owes me.** We make them do the
subtraction to reach the number they actually wanted.

**Build:** add one line under the figure: **`$4,800 still owed`**. `expectedUsd − collectedUsd`,
clamped at 0. Hide it entirely when the number is 0 — *"$0 still owed"* is worse than the
absence of the line, and "all paid" is already what a full collected figure says.

Not shown on `offline` trips: Swellyo does not know what arrived there, so an owed figure would
be invented. See D2.

---

## 4. What dropping item 2 leaves behind

Item 2 was: split the review banner into *"3 waiting for you"* **and** *"6 people haven't
started."* Ohad dropped it. Recording the consequence rather than quietly working around it:

> When `toReview` is 0 but six people have sent nothing, the banner is **green** and says
> **"Nothing waiting for review."** The operator gets a calm all-clear on a trip where nearly
> half the group has not started.

**Item 1 covers this only when due dates are set.** If the trip's requirements have no due
dates, nothing is ever late, the status line reads *"14 days to go · nothing late"*, and the
green banner still sits underneath saying everything is fine.

Two honest options, neither of which is item 2:

- **(a)** Let the status line count people, not just late things:
  *"14 days to go · 6 people haven't started · 2 late."* One line, no second banner.
- **(b)** Accept it, and make sure the Travelers list sorted by work (item 4) is the answer —
  the six are now the top six rows.

**This spec builds (b)**, because it is what item 4 already does and it adds nothing new. If
the green banner still reads wrong on a device, (a) is a one-line change inside item 1.

---

## 5. Database work

**Only item 3.** One `security definer` RPC, no new table, no new column.

Everything else in this spec is client-side: display, sorting, error handling, refresh wiring,
and one new prop.

House rules that apply:

- Migrations are **applied by hand in the SQL editor**. Never `db push`.
- A new client-callable RPC needs an explicit `grant execute to authenticated` or it 403s.
- Pin `search_path` to `public, extensions, pg_temp` on the new function.
- The Remind button sends **real pushes**. Test on an all-dev-member trip only.

---

## 6. Order to build

| Phase | Items | Why this order |
| --- | --- | --- |
| **A** ✅ | **5**, 7, 8, 10 | Small, independent, no design needed. **5 is a live bug.** Ship as one diff. **Built 2026-08-05** — see §7a. |
| **B** ✅ | 6, 9 | Refresh plumbing and the reorder. Touches `TripDetailScreen`, so it wants its own diff. **Built 2026-08-05** — see §7b. |
| **C** ✅ | 1, 4 | The two that change how the tab reads. Needs a device look before they are called done. **Built 2026-08-05** — see §7c. |
| **D** ⏳ | 3 | The migration + the button. Alone, because it is the only one that can send something to a real person. **Code built 2026-08-05; migration NOT applied** — see §7d. |

A and B are safe to run in parallel with other work. **C and D are not** — C changes the same
component tree twice, and D needs a migration applied before its client half means anything.

---

## 7a. Phase A as built — 2026-08-05

| Item | What landed | File |
| --- | --- | --- |
| **5** | New `SectionError` — "That did not load." + **Try again** — used by Money, Medical **and** Surf stats. `profiles.isError` is now checked **first**, so a failed fetch can no longer fall through to "No travelers yet." | `TripDashboardTab.tsx` |
| **7** | Operators start on Dashboard. One-shot `didPickDefaultTab` ref; stands down whenever `initialFocus` is set | `TripDetailScreen.tsx` |
| **8** | `MedicalBody`: *"9 of 15 filled in the medical form"* + flagged counts, zeros dropped, *"Nothing flagged."* when all zero | `TripDashboardTab.tsx` |
| **10** | *"$4,800 still owed"* under the collected figure, hidden at zero, never on offline trips | `TripDashboardTab.tsx` |

**One deviation, deliberate.** The zero-dropping and the subtraction were pulled out into
`medicalFlagLine()` and `outstandingUsd()` in `dashboardFormat.ts` rather than left inline.
Both have edge cases that are the entire reason they exist — an all-zero line must be
distinguishable from no-data, and an over-refund must not print a negative — and neither is
testable inside a component without a renderer. 14 tests in
`dashboard/__tests__/dashboardFormat.test.ts`.

| Check | Result |
| --- | --- |
| `tsc` on touched paths | ✅ zero |
| `jest` trips + dashboard | ✅ 225 passing, was 211. The one failure is still `tripInvitesService.test.ts`, unrelated and pre-existing |
| Device | ⏳ **PENDING** — the item-7 checks in §7 below need a real device |

---

## 7b. Phase B as built — 2026-08-05

| Item | What landed | File |
| --- | --- | --- |
| **6a** | `RefreshControl` on the scroll view. Refetches `type: 'active'` queries under the `trips` and `operatorDashboard` roots, so pulling on Overview does not fetch the whole Dashboard | `TripDetailScreen.tsx` |
| **6b** | `['operatorDashboard']` added to the focus catch-up | `useTripRealtime.ts` |
| **9** | Medical + Surf moved **below** Travelers and merged into one **"About this group"** section with 14/700 sub-headings | `TripDashboardTab.tsx` |

### The spec was wrong about item 6b, and this is what was built instead

§ Item 6 said: *"Add `medical` and `profiles` to the invalidation that already fires for `money`
after a review action."* **That would have been a no-op.**

An operator cannot change the medical counts. A medical item reads `approved` off
`m.completed_at` (`tripDocumentsService.ts:1254`) — the **traveler** completing the form, not
an operator decision. Nothing the operator does in the review screen moves those numbers, so
hanging an invalidation off a review action would refresh nothing and look like a fix.

The actual hole was wider: **the three `operatorDashboard` queries sat outside every automatic
refresh path in the repo.** Not `useTripRealtime`'s focus catch-up, not its broadcast handler,
nowhere. Their only invalidation anywhere was the one manual call from the traveler price
sheet. So an operator who backgrounded the app and came back read yesterday's money.

Fixed where that gap actually is — one entry in the focus catch-up in `useTripRealtime`.

**One prefix key, not three.** That file's header is explicit that each entry costs two
synchronous `O(total-cache)` scans, and that the unconditional burst there was a measured
contributor to the progressive-lag freeze. `['operatorDashboard']` prefix-matches all three for
the price of one.

| Check | Result |
| --- | --- |
| `tsc` on touched paths | ✅ zero |
| `jest` trips + dashboard | ✅ 225 passing, 1 failing — `tripInvitesService.test.ts`, pre-existing |
| `jest src/hooks` | ⚠️ `tripsListRealtime.test.ts` fails (4). **Pre-existing and not ours:** it tests `useTripsListRealtime`, a different file that never imports the one edited here, and it fails on its own mock harness (`no channel for topic trips-list`) |
| Device | ⏳ **PENDING** |

**Extra device checks for phase B:**

1. Pull down on Dashboard — numbers actually move.
2. Pull down on Overview — no Dashboard fetch fires.
3. Background the app on an operator trip, come back — money and medical are current.
4. "About this group" reads as one block below Travelers, not two orphaned headings.

---

## 7c. Phase C as built — 2026-08-05

New file **`dashboardWork.ts`** holds all the urgency logic — `isLate`, `countLate`,
`lateForTraveler`, `travelerWorkRank`, `sortTravelers`, `tripPhase`. 25 tests in
`__tests__/dashboardWork.test.ts`.

| Item | What landed |
| --- | --- |
| **1** | `TripStatusLine` as the first thing in the tab. `startDateISO` / `endDateISO` passed from `TripDetailScreen`. Renders nothing while the review loads |
| **1** | Rows follow: `DocumentsCard` rows gain `· 2 late` in `D.danger`; traveler rows get a red `2 late` tag |
| **4** | Default sort worst-first, alphabetical inside each rank. `A–Z` / `By urgency` toggle in the section header, hidden below 2 travelers |

### Status line copy

| Trip state | Line |
| --- | --- |
| Future, late | `14 days to go · 2 documents late` (late half bold, `D.danger`) |
| Future, clear | `14 days to go · nothing late` |
| Departure day | `Leaves today · …` |
| Under way | `Under way · …` |
| Ended | `Trip ended` — no late count; chasing is over |
| No `start_date` | countdown dropped, late count kept |
| Review loading | **nothing rendered** |

### Three decisions worth knowing

**`todayISO` is now exported from `tripDocumentsService`, not re-implemented.** It was private.
The client's "is this late?" test has to use the *same* today that stamped `state: 'overdue'`
in the first place — two definitions drifting by a day would make the tab's late count
disagree with the states it is counting. Its comment (local calendar date, never
`toISOString()`) is exactly the rule the tab needs.

**Dates are parsed to LOCAL midnight.** `new Date('2026-08-19')` parses as **UTC** midnight,
which is the previous evening west of Greenwich — it would report "0 days to go" for a trip
leaving tomorrow. Same bug class the service's comment warns about, opposite direction. Covered
by a test.

**One tag per traveler row, and late wins.** Two pills plus a chevron crowds a 36px row, and
"waiting" is already counted in the banner at the top of the tab.

### Not done, and deliberately

`pay` requirements still cannot read as late — they are hardcoded `'not_started'`
(`tripDocumentsService.ts:1216-1226`) because `fetchTripReview` never loads the ledger. That is
**D3**, unchanged and still open. A trip whose deposit deadline has passed shows nothing on this
line.

| Check | Result |
| --- | --- |
| `tsc` on touched paths | ✅ zero |
| `jest` trips + dashboard | ✅ 250 passing, was 225. 1 failing — `tripInvitesService.test.ts`, pre-existing |
| Device | ⏳ **PENDING** |

**Extra device checks for phase C:**

1. A traveler with a **rejected, never-resent** document past its deadline appears in the late
   count and at the top of the list. This is the case the obvious implementation misses.
2. The countdown is right — not off by one — on a trip leaving tomorrow.
3. `A–Z` toggles both ways and the list does not jump around.
4. A trip with no due dates set reads `14 days to go · nothing late`, not a crash.

---

## 7d. Phase D as built — 2026-08-05

> ✅ **APPLIED TO PROD 2026-08-06.** `supabase/migrations/20260805000300_operator_remind_requirement.sql`.
>
> **`public.notification_templates` DOES NOT EXIST in production** — migration
> `20260611000200` was never applied; only `notifications` and `notification_queue` are there.
> The template insert was guarded with `to_regclass` (unguarded it would have aborted the whole
> migration on a 42P01). Both readers already fall back to hardcoded copy, so this changes
> nothing except where the words come from.
>
> ✅ **Push copy FIXED 2026-08-06 — with no edge-function deploy.** See §7e.

| Piece | File |
| --- | --- |
| Migration: push priority, template row, the RPC | `20260805000300_operator_remind_requirement.sql` (**not applied**) |
| `remindRequirement(tripId, requirementId)` | `tripDocumentsService.ts` |
| `Remind N people` line under each Documents row, confirm → send → honest result | `TripDashboardTab.tsx` |
| New notification type: union, bell flags, nav → `documents`, render case | `notificationsService.ts` |
| Two tests, including the new type in the every-type render sweep | `notificationsService.test.ts` |

### D4 was answered wrong in this spec, and it would have shipped a silent no-op

§8 assumed *"(a) reuse `operator_requirement_due_soon` — no enum migration, priority already
mapped."* **The priority was mapped to `-1`.** From `20260724000500`:

> *"Deliberately left at -1 (feed only): `operator_requirement_due_soon` — reminder cadence is
> not decided yet"*

So the button would have written bell rows and **sent no pushes**, while telling the operator it
had reminded eight people. Worse than no button: they would stop chasing.

Fixed by moving it to `1` (normal push). Not `0` — this fires on things that are merely still
open, and `operator_requirement_overdue` keeps `0` for an actually missed deadline.

**The replacement body was read from PRODUCTION, not the repo.** The live
`notification_push_priority` has drifted ahead of every migration here — `operator_*` cases were
added straight to prod — so rebuilding it from a repo file would silently demote those types
back to feed-only. Read live 2026-08-05 via `pg_get_functiondef`; the only change is one line.
Grants restored to the exact `{postgres,service_role}` read beforehand.

### Other decisions

**No template row existed for any operator type** — `notification_templates` was seeded
2026-06-11, six weeks before them. Without one the bell renders the literal word
"Notification" with an empty body. The migration seeds one, and a hardcoded render case was
added as the no-template fallback. `{item}` resolves from `data.item_name`, so the RPC writes
the requirement title into both `item_name` (template) and `requirement_title` (fallback).

**Travelers are `role <> 'host'` — matching the client exactly.** `reviewTravelers` is
`participants.filter(p => p.role !== 'host')`. Excluding `'admin'` as well, which looked
tempting, would make the button say 8 and send 7, and nobody would ever work out which number
was lying.

**Branch order mirrors `operator_trip_my_requirements`** — acknowledge before medical, then
documents, including the waiver-version join. If the two ever disagree the button reminds the
wrong people, which is the worst way this can fail because it looks like it worked.

**Pay rows are refused on BOTH sides.** The RPC raises `0A000`; the client hides the button.
`fetchTripReview` hardcodes pay rows to `not_started`, so the client's count would read as
"everybody" including those who had paid. D3, unchanged.

**24h cooldown, read from `notifications` itself.** No new table, no new column. The RPC
returns what it *actually* sent, and the client reports the gap:
`Reminded 5 · 3 already reminded today`.

| Check | Result |
| --- | --- |
| `tsc` on touched paths | ✅ zero (repo baseline of 180 pre-existing errors unchanged) |
| `jest` services + trips + components | ✅ 440 passing. 2 failing suites, **both pre-existing and untouched by this diff**: `tripInvitesService` (known) and `getConversations.characterization` (messaging — not in the diff, verified with `git status`) |
| Migration applied | ❌ **NO — Ohad, by hand** |
| Device | ⏳ PENDING |

### Phase D device checks — dev-member trips ONLY

**This sends real pushes to real phones.** Do not try it on a trip with a real traveler on it.

1. Apply the migration. Confirm `operator_remind_requirement` exists and `authenticated` has
   EXECUTE, or every tap 403s.
2. Tap Remind → confirm dialog names the document and the count.
3. Send → the right people get it, and nobody else.
4. Tap again immediately → `Everyone was already reminded today`, and **no second push**.
5. The traveler's bell row says *"Passport still needed"*, not *"Notification"*.
6. Tapping that row lands on their Documents card.
7. A pay row shows **no** Remind button.

---

## 7e. Push copy — fixed 2026-08-06, no deploy

**Applied:** `20260806000000_notification_templates_table.sql`.

### What was NOT done, and why it matters

`20260611000200_notification_templates.sql` creates this table and seeds **24 rows**. The
obvious move was to apply it. **Do not.**

A template row does not just supply words — **it changes the layout.** `renderNotification`
returns `bodyParts: undefined` whenever a template exists, because one editable string cannot
express the actor/action split. The bell renders `bodyParts` when present
(`NotificationCenter.tsx:762`): the Figma name/action line with the actor and trip name bolded.

So seeding all 24 rows would flatten **every notification in the bell** — `member_joined`,
`member_committed`, `join_request_received`, all of them — from the bold two-part line down to
plain text. To fix the wording of one push.

### What was done instead

The table, with **one row**: `operator_requirement_due_soon`. Every other type has no row,
misses the lookup, and keeps the code default it has always used. Blast radius: zero.

**And it needed no edge-function deploy.** `renderPush` checks the template map first
(`render.ts:44-55`) and only falls through to its switch on a miss. That matters, because the
live `dispatch-notification-queue` is behind this repo (an undeployed batching refactor) —
deploying it to ship two lines of copy would have shipped considerably more than two lines of
copy.

| Before | After |
| --- | --- |
| **El Salvador 26** — "You have a new trip update" | **Still needed for El Salvador 26** — "Your organiser is waiting for Passport" |

A `case` was added to `render.ts` as well, closing the TODO that `20260724000500` left. It is
**not the live path** — the template row wins — but it is the fallback if that row is ever
deleted. 3 new tests, 29 passing.

| Check | Result |
| --- | --- |
| Table exists, RLS on, 1 policy | ✅ |
| Grants | ✅ `authenticated` = SELECT only; `anon` none |
| Rows | ✅ exactly 1 |
| `jest supabase/functions/dispatch-notification-queue` | ✅ 29 passing |

---

## 7. Verification

The repo has a long tail of pre-existing `tsc` errors, so grep for the touched paths rather
than expecting a clean run.

| Step | How |
| --- | --- |
| Types | `npx tsc --noEmit \| grep -E "trips/(dashboard/\|TripDetailScreen)"` — expect zero |
| Unit | `npx jest src/services/trips src/screens/trips` — 211/212 is the current baseline; `tripInvitesService.test.ts` is already red for an unrelated mock |
| New unit tests | `late` per §2b (rejected-past-due must count, `pay` must not); the item-4 sort order; `formsCompleted` display incl. all-zero |
| Item 5 | Force the profiles query to fail and confirm the section says "That did not load" with a working retry — **not** "No travelers yet" |
| Item 3 | On a dev-only trip: send, confirm exactly the right people got it, send again immediately, confirm the cooldown reports `already reminded today` |
| Item 7 | Open as operator → lands on Dashboard. Switch to Overview, scroll, come back — **must not** snap to Dashboard. Tap an operator push notification → lands where the deep link says, not Dashboard |
| Device | Ohad, on an operator trip in Expo Go |

**Device check list:**

1. The status line is right on a trip with a rejected-and-never-resent document.
2. The traveler who owes the most is the top row.
3. Pull to refresh actually moves the numbers.
4. Remind sends to the right people and to nobody twice.

---

## 8. Open decisions

| # | Question | Options |
| --- | --- | --- |
| **D1** | Does the status line count **people** as well as late things? (§4 option (a)) | (a) yes, one line covers the dropped item 2 · (b) no, item 4's sorting is the answer — **spec assumes (b)** |
| **D2** | `offline` trips: Money is read-only decoration — expected total, "Swellyo does not know what arrived," no way to record anything. Give operators a "mark as paid"? | (a) yes, own spec · (b) hide Money entirely on offline trips · (c) leave it |
| **D3** | `pay` requirements are hardcoded `'not_started'` and can never read as late (`tripDocumentsService.ts:1216-1226`). Should money deadlines be late too? | (a) yes, needs the ledger in `fetchTripReview` — own spec · (b) no |
| ~~**D4**~~ | ~~Remind: reuse `operator_requirement_due_soon`?~~ | ✅ **Resolved: reused, and its push priority moved `-1`→`1`.** The "priority already mapped" half of the assumption was wrong — see §7d. |
| ~~**D5**~~ | ~~Push copy says "You have a new trip update".~~ | ✅ **Resolved 2026-08-06 — §7e.** Created `notification_templates` with ONE row. No deploy needed; `20260611000200` deliberately still unapplied. |
| **D6** | `20260611000200`'s other 23 template rows are still unapplied, and applying them would flatten the bell's bold `bodyParts` layout on every type. | (a) leave unapplied (current) · (b) teach the bell to keep `bodyParts` when a template only changes wording, then apply · (c) delete the migration |

None block phase A or B.

---

## 9. Non-goals

- **Item 2 is not being built** (§4).
- No change to what documents mean, how they are approved, or who may see them.
- No change to `DocumentReviewScreen`, `PlanSections`, or `TripDetailViewRedesigned`.
- No change to `operator-dashboard/` — the web tab does not get any of this yet, which widens
  the gap the design spec's D2 is already about.
- No new tables, columns, or buckets. One RPC, in item 3, and nothing else.
- No bulk **approve**. Reminding is safe to do to eight people at once; approving eight
  passports without looking at them is not.

---

## 10. Risk

| Risk | Reality |
| --- | --- |
| Remind spams travelers | 24-hour cooldown in the RPC, confirmation before sending, and the count reported back is what was *actually* sent |
| The RPC's "who still owes" logic drifts from `fetchTripReview` and `operator_trip_my_requirements` | Real, and the worst failure here — it reminds the wrong people. The three already mirror each other branch for branch; the RPC must copy that order and say so in a comment |
| Item 7 fights the notification deep-link | Guard on `initialFocus`; covered in the item-7 checks |
| Item 1 reads reassuring on a trip with no due dates set | True by design — nothing is late if nothing was due. §4 is the same problem, and (a) is the escape hatch |
| Sorting hides someone the operator was looking for | The A–Z toggle is part of item 4, not a follow-up |
