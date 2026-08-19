# Swellyo Operator Dashboard — Spec

The desktop website operators use to run one trip: see who uploaded what, review documents, and export files.

**Status:** built. Written 2 August 2026, money section added 4 August 2026. Not yet tested against a real trip by an operator.

---

## 1. What this is

A small, separate website. It is **not** part of the mobile app and does not share its code.

- Operators log in with Google, the same account they use in the Swellyo app.
- They pick a trip and see how it is going.
- They can review documents and download files.
- They can see the money, set the trip's price and deposit, and set one traveler's price.
- They cannot otherwise edit the trip, message anyone, or remove travelers. That stays on mobile.

**Why it exists:** reviewing 60 documents and sending passports to a hotel is painful on a phone. Those two jobs earn a desktop screen. Everything else does not.

### Where it comes from

| Document | What it gave us |
|---|---|
| `swellyoNative/SPEC.md` (Eyal) | "Desktop — Read/review only. All real management happens on mobile." |
| `swellyoNative/docs/operator-trips-dashboard-spec.html` | The tiles, the pages, and the 2 August decisions |
| `swellyoNative/docs/operator-trips-workbench.html` | "Document review and exports earn the desktop view" |

### Two open decisions for Eyal

**1. Approve and reject.** Eyal's spec says desktop is read-only. But his spec has **no approval step at all** — approving a document did not exist when he wrote it. So it cannot have an opinion on it.

This site **includes approve and reject**, because that is the review the workbench says earns desktop.

**2. Setting prices.** Decided by Ohad on 4 August, when the money section was built. Prices are per traveler and frozen at join, so an operator quoting one person a different rate has nowhere else to do it on a desktop — and a price is the one number they most often need to fix while on a call.

On 13 August Ohad extended this to the trip's own price and deposit — the quote for whoever joins next. Same reasoning, and the freeze-first rule (§4.6) means it cannot change what anyone already aboard owes.

Everything else Eyal called "real management" (editing the rest of the trip, messaging, removing people) stays off desktop.

If Eyal wants desktop strictly read-only, remove three buttons. It is a subtraction, not a redesign.

---

## 2. Rules

1. **This project invents no schema.** No tables, no functions, no migrations from here. Every table it writes and every capability it relies on was created and enforced by the app's migration set. What this site may do is exactly what RLS already lets the signed-in operator or crew member do — no more, and never through a path the app does not also have.

   **Rewritten 2026-08-19, by Ohad's ruling.** This rule used to read "no write anywhere else, ever — if a feature needs to change a trip, a traveler, a document or money, it belongs in the app". It had been amended three times (operator settings, the setup waiver PDF, the trip price) and was, by then, simply false: the site writes trip prices, traveler prices, refunds, document rejections and crew rows. A rule the code has already overtaken protects nothing and misleads whoever reads it next, so it was deleted rather than amended a fourth time for deadline editing.

   What the original rule was protecting is kept above, and it is the part that was always doing the work: **the boundary is RLS, not this project's restraint.** A site that can only do what the database already permits cannot break the product, no matter how many buttons it grows.

   What that means in practice:

   - **Never invent a table, a function, a policy or a migration here.** If a feature needs one, it goes in the app's migration set and this site consumes it. That is how `operator_settings`, the `defaults/<user_id>/` storage policies and the staff capability functions all arrived.
   - **Never route around a check the app respects.** Where the app calls an RPC, call the same RPC. Where the app writes in a particular order because a trigger demands it, copy the order (see §4.6 for the price freeze).
   - **Traveler documents stay behind their policies.** The site can read and approve what `docs.view` / `docs.approve` allow, and can upload only to `defaults/<user_id>/` — never into `<trip_id>/`, which is where every sensitive file lives.

   **Stripe is the exception and stays one.** Connect onboarding needs the secret key and lives behind an edge function the app calls. Step 1 of setup reports the state and points at the app. Do not build a second onboarding path here.

2. **The database is the security boundary.** Row Level Security decides what an operator can see. The website cannot see a trip it does not host, even if the code asks for it.
3. **No backend.** The browser talks to Supabase directly. Netlify serves static files only.
4. **Files are private.** Every view or download uses a short-lived signed link. There are no public file URLs.

---

## 3. Who can get in

- Login is **Google OAuth** through Supabase. It is the only provider enabled on the project, and operators already have accounts from the mobile app.
- After login, the site looks for two things: trips where the person is a **host** on a `hosting_style = 'C'` trip, and trips where they are live **crew** (`organized_trip_staff`, accepted and not revoked).
- Neither → a plain message, not an error. They are logged in, they just have nothing to manage.

### Crew, added 2026-08-13

The line above used to read *"There are no roles or staff accounts. Only the operator sees this."* Asked for by Ohad: **a Manager should be able to run their trip's dashboard.**

The reasoning is the same one that justifies the site at all. Reviewing sixty passports is painful on a phone, and it is often the Manager doing it — telling them to use their phone while the person who hired them has a desktop screen is an oversight, not a rule.

What that means concretely:

- **Ask "can I?", never "what tier am I?"** The five tiers are labels; what each can do is an editable row in `organized_trip_staff_roles`. Nothing on this site branches on `'manager'` — it reads `my_trip_capabilities(trip_id)`, the same RPC the app uses. Today `docs.view` happens to mean *Manager and up*; that is the answer, not the question.
- **`docs.view` is the door to a trip.** Document review is the product. A Crew or Guide tier — roster and profiles, no documents — gets one sentence instead of a page of empty cards, because a shell of a site reads as a broken one.
- **`payments.view_status` shows the money; `money.manage` moves it.** A Manager sees who has paid. Prices and refunds stay with the operator of record, guarded on `group_trips.host_id` in the database as before (§7).
- **`/settings` and `/setup` are operator-only.** They are that account's own defaults — Stripe, waiver, cancellation policy. Crew have no such row, so the routes redirect to `/trips` and the header link is hidden.
- **Nothing new in the database.** Every capability was already enforced by RLS or inside an RPC before this change; the site just stopped assuming the only person holding them was the host. Rule 1 is intact — no tables, no functions, no migrations from this project.
- **Still UX, not security.** Forcing a capability check to true in the browser changes nothing: Postgres refuses the read.

#### What a Manager gets, exactly

Decided by Ohad, 13 August: **a Manager sees everything on this site except `money.manage`, `staff.manage` and `trip.cancel`.** Audited page by page against the seeded Manager set:

| Page / action | Needs | Manager |
|---|---|:-:|
| Trip list, trip snapshot, counts | `docs.view` | ✓ |
| Documents: view, open, download, export | `docs.view`, `data.export` | ✓ |
| Approve / reject a document | `docs.approve` | ✓ |
| "Remind N people" | `docs.view` | ✓ |
| Medical flags | `medical.view` | ✓ |
| Traveler pages, profiles, emergency contact | `travelers.view_profiles` | ✓ |
| Money: totals, who paid, the ledger, refund history | `payments.view_status` | ✓ |
| Set a trip or traveler price · issue a refund | `money.manage` **+ `host_id`** | ✗ |
| Invite or edit crew | `staff.manage` | ✗ (not on this site at all) |
| Cancel the trip | `trip.cancel` | ✗ (not on this site at all) |

Two of those three do not exist here anyway — crew and cancellation are app-only — so in practice the single difference a Manager sees is the price and refund buttons. The Money page says so in a line, rather than showing every number with no buttons and letting it read as half-loaded.

#### The two pages that are not about a trip

`/setup` and `/settings` stay operator-only, and this is **not** a fourth exclusion — they are not trip data at all. Both read rows keyed to the signed-in *person*: `operator_payout_accounts` (their Stripe Connect account), `operator_settings` (their currency, cancellation default, terms confirmations), and their default waiver at `defaults/<user_id>/`. All three are `user_id = auth.uid()` in RLS, so a capability cannot reach them — there is no trip in the check.

Shown to a Manager they would be worse than empty: the Connect button would open Stripe onboarding **for the Manager**, creating a merchant account for someone who is not the merchant, while the trip's payouts stayed exactly where they were. Same family as `money.manage`, so it follows the same rule.

The setup banner is hidden for the same reason: it names a step only the operator can take.

---

## 4. Screens

```
/login                        Google sign-in
/trips                        the operator's trips
/trips/:id                    trip snapshot
/trips/:id/money              every traveler's price, what they paid, the ledger
/trips/:id/crew               who runs the trip — tiers, titles, paperwork (operator only)
/trips/:id/d/:requirementId   one requirement, everyone, with export
/trips/:id/t/:userId          one traveler
/settings                     defaults: currency, cancellation policy, payments
/setup                        operator onboarding — the four things, once
```

### 4.0 Setup

The four things an operator settles before they can sell a trip: Stripe, price currency, cancellation policy, default waiver. Added 11 August 2026, mirroring the app's `OperatorSetupScreen`.

- **A checklist, not a wizard.** The steps are independent, Stripe review can take days, and people leave and come back. A checklist reopens showing what is left.
- **Three of four can be finished here.** Stripe cannot — see the exception in Rule 1. That step reports its state and points at the app.
- **Confirming counts as doing.** Currency and policy both have working defaults, so an operator can finish those without changing anything. What setup asks is that they *looked* — recorded in `currency_confirmed_at` / `policy_confirmed_at`. A null-check on the values would call an untouched operator finished, which is the whole reason those columns exist.
- **A banner sits above every page** until setup is done, naming the next step with a 4-segment progress bar. Not dismissable: while it shows, the operator cannot sell a trip, and burying it would hide the only explanation. It renders nothing until both reads settle, so a finished operator never sees it flash.

The shared rule lives in `src/domain/operatorSetup.ts`. It is **not** a byte copy of the app's, because the two learn about Stripe differently — the app reads Stripe's live `requirements` arrays through an edge function, this site reads the same fields off `operator_payout_accounts`, kept current by the Connect webhook and the daily sweep. Both then run the SAME six-state rule: the app's `connectStatus.ts` and this project's `domain/connect.ts` twin. The steps and their meaning are shared; only where the fields come from differs. Anything else that drifts is a bug.

**Six states, not four booleans — corrected 2026-08-19.** This site used to read `charges_enabled`, `payouts_enabled` and `details_submitted` and show four states, which meant an account Stripe had **refused** read as "Not finished — Stripe still needs information from you". The operator was sent to fill in a form that could not help them while no trip of theirs could take a cent. `requirements_due`, `requirements_past_due` and `disabled_reason` had been on the table since 2026-08-05; this site simply never selected them. Two rules come with them:

- ⚠️ **`disabled_reason` is not a rejection flag.** Stripe reuses it for `under_review`, `pending_verification` and `past_due` — ordinary stages. Only `rejected.*`, `platform_paused` and `listed` are unrecoverable.
- ⚠️ **`action_needed` is gated on charges already being enabled.** A failed SSN match leaves `past_due` on an account that was never live, and `action_needed` is a state that permits selling.

`blocked` is no longer "done" on the checklist, either. It used to satisfy `details_submitted` and tick the step.

### 4.1 Trips list

Trips the person hosts, `hosting_style = 'C'` only. Each row: name, dates, how many travelers, and how many documents are waiting for review.

### 4.2 Trip snapshot

Top to bottom:

0. **Are you on track** — one line under the title: `12 days to go · 2 documents late`, or `Trip ended`. Added 2026-08-19; before it, "7/15 in" read exactly the same three months out and three days out, and nothing anywhere on the site was ever marked late. It renders nothing while the review is loading — a line that says "nothing late" and flips to "2 late" a second later is worse than a beat of nothing.

   **What counts as late is NOT `state === 'overdue'`.** That state is only ever reached when the traveler sent NOTHING. Someone whose passport was rejected and never resent reads `'rejected'` for ever, months past the deadline, and they are the likeliest to miss the flight. The rule is `overdue || (rejected && dueDate < today)` and it lives in `domain/late.ts`, shared with the requirement rows and the traveler rows so all three agree. Same rule as the app's `dashboardWork.isLate`. `pay` rows can never be late — `fetchTripReview` has no ledger, so it hardcodes them to `not_started`.

1. **Needs review** — "12 documents waiting for you". Opens the review list, oldest first. It is a shortcut, not a queue that must be cleared. Nothing happens automatically.
2. **Money** — collected against expected, and how many have paid each step:
   `$1,000 collected of $6,000 · 1 of 2 paid the deposit`
   Travelers with no price set are counted in the denominator and named in a second line — someone with no price is not paid, and leaving them out would make the trip look further along than it is. Opens the money page.
   The card is hidden only when the trip has no payment steps and no price anywhere. A trip that never charged for anything has no money story.
   Since 19 August it also names **when** the rest is due — `Final payment due 11 Dec 2026` — read-only, pointing at the Documents card where it is changed. It sits with the amounts it governs, but there is only ever one editor for it. A managed trip reads that date off its `balance` requirement row; an offline trip off `offline_payment_due_days_before`, because the database refuses pay rows on an offline trip and it has nowhere else to keep it.
   Full design: `docs/superpowers/specs/2026-08-04-operator-dashboard-money-design.md`.
2b. **Travelers can't pay yet** — added 2026-08-19, the twin of the app's `StripeBanner`. On a `managed` trip whose operator cannot take charges yet: *"Stripe is still checking your details"*, *"Finish connecting Stripe"*, or, in red, *"Stripe turned down your payout account"*. Silent when the state is unknown, when money already works, and on offline trips, which have no Stripe account to wait on. **Only the operator of record sees it** — `operator_payout_accounts` is readable by its owner alone, which is also the right product answer: a Manager cannot fix somebody else's Stripe account.

3. **Documents** — one line per requirement, showing **received** and **approved**:
   `Passports 15/15 in · 3/15 approved · 2 late`
   Both numbers always, and the late count when there is one — never `0 late`, which is not information. The gap is the operator's own backlog, and hiding it would make it look like a traveler problem.
   Waiver and medical are not uploads, so they get a short line: `Waiver signed 13/15 · Medical form 11/15`.
   Custom requirements go in a separate **Other requirements** list, one line each.
   Each line also carries its own deadline — `Due 11 Dec 2026`, or `Needed to join` on a must-have — so the thing an operator came to change is visible before they press anything.

#### Editing deadlines — added 2026-08-19

Spec: `docs/specs/operator-trips/deadline-editing.md`. Until this, deadlines could only be changed from the phone; the editor there (`ManageRequirementsSheet`) had existed since publish and Ohad had not found it.

**Edit** in the Documents card head swaps the card into the editor — inline, same card, no dialog and no route. Gated on `trip.edit`, the exact capability `organized_trip_req_write` checks, so the button and the database cannot disagree. Per requirement: the **When they join / They can skip** pair, and a stepper over the fixed scale (1, 3, 7, 14, 21, 30, 60, 90, 120, 180, 365 days before departure) printing the date it resolves to. Requirements that are switched off are listed under **Not asked for** with an Add button; pay rows sit under **Payments** and can only be re-timed, never added or removed.

Three rules are load-bearing:

- **A deadline may not be SET to a date that has already gone.** Not a warning — the `+` button is dead. (`+` means MORE days before departure, which is an EARLIER date; the scale runs backwards against the calendar.) `−` is never blocked, even when one notch is not enough to escape the past, or a row already in the past would have both buttons dead and be unfixable. The same rule was backported to the app the same day, so the two agree on what is legal.
- **Card-level save, never autosave.** One press writes one diff, because one of the things a save can do is un-overdue four people — and that gets said out loud in a confirm first. Overdue is derived from the date, not stored, so pushing a deadline later genuinely forgives the miss.
- **Nobody is notified.** Travelers see the new date next time they open the trip. Deliberate: a push for a date moving is noise.

Moving the trip's own start date is untouched by all this — it still warns and still saves. Deadlines are relative to departure, so they follow it; refusing a real-world date change because paperwork would go overdue traps the operator in something worse.

4. **Medical flags** — counts only, no names: "3 injuries", "2 allergies", "5 diet notes".
5. **Surf stats** — levels, board types, age range, nationalities. Background awareness, not a to-do list.
6. **Travelers** — everyone on the trip, one row each, alphabetical: photo, name, `3/5 approved · $500 of $1,200 paid`, a `2 late` tag when they are past a deadline, and a `2 waiting` tag when they have documents to review. Late comes first: chasing somebody takes days, saying yes to a file takes five seconds. Opens their traveler page (§4.4).
   This is the only per-person way into the site — every other card is per-requirement, so before this a traveler who had submitted nothing could not be opened at all.
   The roster comes from the member list, never from the review read: a slow or failed review must not make the trip look empty.

### 4.2b Crew page — added 2026-08-14

The people who **run** the trip, as opposed to the travelers who go on it. Full design: `docs/superpowers/specs/2026-08-14-crew-page.md`.

- **The operator of record only.** Gated on `staff.manage`, which `my_trip_capabilities()` hands out with the rest of the operator set to `group_trips.host_id` and which no assignable tier carries. So the question the page asks is the same one every other page asks — "can I?" — and the answer happens to mean "am I the operator". A Manager never sees the card on the trip snapshot, and typing the URL gets a sentence. This is invariant I2 of the staff spec: if a Manager could edit the crew, a Manager could grant themselves the operator's permissions.
- **A card on the trip snapshot** sits above Travelers, naming who is on the crew and how many invites are still unaccepted.
- **Editing one person** opens a dialog. Their tier (the five cards, capabilities drawn from `organized_trip_staff_roles`, never hardcoded), their title, their bio, and the paperwork tick list. Removing is a soft revoke behind a confirm that names them.
- **Name and photo are not editable for anyone with an account** — those come from `surfers`, so a person renames themselves once and every trip they crew follows. What the operator owns is how this trip *introduces* them. A Listed credit (no account) has no profile to read from, so its name is editable here; its photo stays in the app, which is the only place with an upload path.
- **Adding** is search-by-name and an in-app invite. Invite links and Listed credits stay in the app — a link is shared over WhatsApp anyway, and a Listed credit wants that photo upload.
- **Paperwork is a catalog, not a list of what exists.** Ticking Passport creates the staff-audience requirement row if the trip has none. Status is binary, **Sent / Not sent**: there is no approve or reject for crew paperwork, so a third state would be a queue nobody can clear. No deadline and no overdue — crew paperwork is flagged, never gated.

Rule 1 holds: no table, no function, no migration from this project. Two bugs were fixed on the way, both older than this page:

- `fetchProfiles` read `surfers.profile_photo_url`. Both columns exist; only `profile_image_url` is ever written, so 684 of 685 people showed a letter instead of a face.
- `fetchTripReview` read every active requirement on the trip. `organized_trip_requirements_resolved` does not carry `audience` (it was created `select r.*` before the column existed), so a crew passport would have appeared in the traveler review and every traveler would have shown as missing it. Fixed the same way migration 20260813190000 fixed it in SQL — by reading the base table for the audience.

### 4.3 Requirement detail page

Every tile opens a full page: all travelers, their state, and **export**.

- Export downloads the **real files**, not a summary. Operators forward passports to hotels and visa agents.
- Accepted cost: our 30-day delete only limits Swellyo. A downloaded copy belongs to the operator and outlives it.
- **Exports are not logged.** No download history (decided 2 August).
- Medical has export too (decided 2 August). This overrides `SPEC.md` §7, which said medical was view-only.

### 4.4 Traveler page

| Block | Shows | Can do |
|---|---|---|
| Profile | Name, photo, age, nationality, surf level, board | Read |
| Waiver | Signed yes/no, which version, date | Read |
| Passport | File + name, nationality, expiry | View · export · reject |
| Insurance / Visa / Flights | File | View · export · reject |
| Medical | Allergies, injuries, diet, medication | View · export |
| Money | Total, each payment step, their payments | Read · set price (owner only) · refund |
| Remove | — | Remove from trip (added 2026-08-19) |

Message and editing the trip are **not here**. They stay on mobile.

#### Removing a traveler — added 2026-08-19

Spec: `docs/specs/operator-trips/dashboard-web-parity.md`. The twin of the app's `RemoveTravelerSheet`, last on the page, under Medical — this page exists to review someone, and the destructive action should be the one you travel to.

- **Refund first, then remove.** The operator decides the money while looking at the person. A refund that fails does not trap them: the dialog says what happened and still offers **Remove anyway**, carrying whatever actually went back.
- **Three options** when they have paid: everything, what the frozen policy gives at today's date, or a typed amount. ⚠️ A trip with no policy gets no policy option — null means "never stated terms", and `$0, per the policy` would invent one.
- **Gated on `travelers.remove`**, the exact capability the participant DELETE policy checks. A Manager who holds it without `money.manage` gets a dialog that refuses and names who can: only the operator can remove someone who paid, because only they can refund.
- **A failed ledger read blocks the button.** `money` is null on failure, which reads as "paid nothing" — and removing a traveler who had paid $2,000 with no refund step is the one mistake this must not make.
- **Two calls, then a best-effort tail.** `trip-cancel` in single-traveler mode (it spreads the amount across their payments newest-first — `payments-refund` takes one payment, and a traveler is several), then the participant DELETE. Afterwards, never blocking and never able to fail the removal: the `X removed Y` line in the group chat, the join-request row, their `conversation_members` row, and `send-trip-removed-notification` carrying what actually went back. ⚠️ `refund_usd` is omitted, never zeroed.

### 4.6 Money page

One row per traveler: total, each payment step with what is still owed, and paid so far. Then a totals line, then **the payment rows themselves** — date, traveler, payment or refund, amount.

The raw rows are the point. Operators reconcile against their Stripe dashboard, and a single total cannot be checked against anything.

**The trip's own price is edited here too** (added 13 August). A "Trip price" card shows `cost_per_person` and `deposit_amount` with an owner-only edit, saved through the app's order exactly — the only safe one:

1. `operator_freeze_trip_prices` — everyone already aboard is pinned to the price they have today. If this throws, nothing is written; a half-done reprice is worse than none.
2. The two columns are written on `group_trips`.
3. On a managed trip, the `pay` requirement rows follow the deposit: adding a deposit creates or reactivates its row, dropping it retires the row. `is_active` only, never delete — the ledger's `requirement_id` points at these rows.

So changing the trip price never changes what anyone already aboard owes — it is the quote for whoever joins next. Changing one existing traveler happens through their own price button, where the paid-amount rules below apply.

**Setting a price is owner-only.** The database guards it on `group_trips.host_id` — the operator of record — while this site finds trips through `role = 'host'`, which includes every admin promoted with "Set as admin". Those admins see the money; they do not see the button.

Changing a price after money has arrived follows three rules, and only one interrupts:

| Situation | What happens |
|---|---|
| Nothing paid | Saves, no confirmation |
| Paid, new total at or above it | Confirm, with the numbers spelled out |
| New total below what they paid | **Blocked** |

The block exists because lowering a total below what someone paid leaves them overpaid, and only a refund resolves that state — since 11 August one can be issued from their traveler page, and the block's message points there. Stripe refuses the same move for the same reason. **The server does not check this**, so a direct API call still gets through; that gap is logged for the next payments migration.

### 4.5 Review actions

- **Approve** — one click inside the document viewer. Not a separate queue to grind through.
- **Bulk approve** — select several, approve together. Sixty one-by-one clicks is the difference between review happening and not.
- **Reject** — deletes the file, keeps the row with the date and a note, and re-opens the task for the traveler with a notification. Reject and "delete + reclaim" are the same single action. A reason is optional.

---

## 5. After the 30-day purge

The purge deletes the file and leaves the row.

- Counts do not change. `15/15 received` still reads 15/15 afterwards. History does not rewrite itself.
- The row shows **"File deleted after 30 days"** instead of a preview. View and export are gone for that row.
- Passport typed fields (name, nationality, expiry) survive the purge.
- Nothing is re-requested. A purged file is **done**, not missing.

---

## 6. Data

Everything below is already live. **This project invents no schema (Rule 1). Every write it makes goes through a policy or an RPC the app already uses:** `operator_settings` and the setup waiver PDF (own data), the trip and traveler price paths, refunds, document approve/reject, crew rows, and — since 19 August — the trip's requirement rows and their deadlines.

| What | Where it comes from |
|---|---|
| Operator defaults (currency, cancellation policy) | `operator_settings` — **read and write**, owner's row only |
| Stripe payout state | `operator_payout_accounts` (read only; onboarding runs in the app) |
| Trips list | `group_trips` + `group_trip_participants` (role `host`) |
| Received / approved counts | `organized_trip_document_counts(trip_id)` |
| Requirements | `organized_trip_requirements_resolved` |
| Uploaded documents | `organized_trip_travelers_documents` |
| Waiver agreements | `group_trip_acknowledgements` |
| Medical answers | `organized_trip_medical_forms` |
| Medical counts | `organized_trip_medical_flags` |
| Approve | `operator_approve_documents(...)` |
| Reject | `operator_reject_document(...)` |
| Files | private bucket `group-trip-documents`, signed links |
| Payments | `organized_trip_payment_events` |
| Traveler prices | `group_trip_participants.price_total_usd`, `.deposit_usd` |
| Trip default price | `group_trips.cost_per_person`, `.deposit_amount`, `.payment_mode` |
| Payment steps | `organized_trip_requirements_resolved` where `req_type = 'pay'` |
| Set a traveler's price | `operator_set_traveler_price(...)` |
| Set the trip's price | `operator_freeze_trip_prices(...)`, then `group_trips` **update** (two columns), then a `pay`-row sync on `organized_trip_requirements` — see §4.6 |

Verified against production on 2 August: every function above grants `EXECUTE` to `authenticated`, every table has RLS on, and both views are `security_invoker` so table policies still apply.

> **Naming trap.** The tables were renamed in July. It is `organized_trip_*` now, and the counts function is `organized_trip_document_counts` — the old `group_trip_document_counts` was **dropped**. But `group_trip_acknowledgements` was deliberately **not** renamed, because it is the waiver's only legal record. Do not "fix" that name.

### Requirement state

"Done" is never stored. It is worked out from the evidence: a document row, an agreement row, a completed medical form.

That logic already exists twice in the mobile app — in the `operator_trip_my_requirements` function and again in `fetchTripReview()`. This site is the third copy, ported from the working version.

**The branch order is load-bearing.** `acknowledge` is checked *before* `medical`, exactly as the database does it, or the two sides disagree about what "done" means. This is why the ported function has unit tests.

### Money state

Same story, same reason. `operator_traveler_amount_due` and `operator_requirement_pay_state` grant EXECUTE to `postgres` and `service_role` only, so the browser cannot call them. Granting them would not help either: both return one value for one traveler and one step, so a 15-person trip would need 30 round trips to draw one page.

`src/domain/money.ts` is the **fourth** copy, and it is tested for the same reason the third one is.

Two traps live in that file on purpose. Money is added in whole **cents**, because `0.1 + 0.2` is not `0.3`. And every amount goes through `toNumber()` first, because a Postgres `numeric` reaches the browser as a **string** — without it, adding two payments concatenates them into a plausible, wrong total.

> **Known debt.** Four copies of one rule is a smell. The proper fix is the `operator_trip_requirement_matrix` function, which was specced but never applied. Do it next time someone is working in the database. Not now — it would mean a migration, and this project is meant to add nothing.

Every amount here is US dollars, and the currency is baked into column names rather than stored. Before adding a payment method that settles in anything else, read `docs/superpowers/specs/2026-08-13-other-currencies-note.md` — one thing in it cannot be fixed after the fact.

---

## 7. Not building

- **Payout status** — whether Stripe has paid the operator out. A different question from "did the traveler pay", on a different Stripe object, and mixing the two on one screen is how people misread their own balance.
- Bulk price setting. One traveler at a time.
- Invoices and receipts. Stripe already emails them.
- Export logging or download history.
- Staff accounts or roles.
- A view across several trips at once.
- Charts. Counts and lists only.
- Editing trips beyond their price and deposit; messaging. (Removing a traveler moved out of this list on 2026-08-19 — see §4.4.)
- Changing `payment_mode`. Turning payment collection on or off reorders more than two columns (pay rows, freeze, revert on failure) and stays in the app's "Getting paid" sheet.

---

## 8. Still open

1. **Custom requirements.** Operators can invent their own items, and the tiles are built around passport, visa, insurance and flights. For now they go in an "Other requirements" list with their own counts. How they should properly be counted and exported — **needs Eyal and Ohad**.
2. ~~**Removing a traveler who already paid.**~~ **Answered 2026-08-19** — it is a desktop action now, and the money is decided before they leave the roster (§4.4). The old worry stands in one narrower form: the ledger is append-only, so their payment rows survive, but the per-traveler view of them disappears with their membership. The trip's Money page still lists every counted event, including from people who have left.

3. **The price columns are world-readable.** `group_trip_participants` has a SELECT policy of `using(true)` for every logged-in user, and the payments work added `price_total_usd` and `deposit_usd` to that table. So any Swellyo user can read what any traveler paid for any trip. This site needs that read and did not create the hole, but it is real. Fixing it is a migration in the main project.

---

## 9. Technology

| Choice | Why |
|---|---|
| Vite + React + TypeScript | Static files, no server to run or pay for |
| TanStack Query | Already used for trips in the mobile app |
| React Router | Five routes, nothing exotic |
| `@supabase/supabase-js` | Same client the app uses |
| Plain CSS with tokens | Small site. A CSS framework would weigh more than the app |
| Vitest | Tests for state derivation and count maths — the only real logic |
| Netlify | Static hosting, same as the main site |

**Environment variables** (`.env`, never committed):

```
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_STRIPE_LIVEMODE          which Stripe payments count as real
VITE_ALLOW_ALL_HOSTED_TRIPS   testing only — show non-operator trips too
```

The anon key is public by design. RLS is what protects the data.

> **`VITE_STRIPE_LIVEMODE` must match the database.** The database decides which payments are real through `app.stripe_livemode`, which reads as **false when unset** — so today, test payments count as real and the app already tells travelers their sandbox deposit is paid. If this site disagreed it would show "$0 collected" for a settled deposit.
>
> It is the **third** flag that has to flip with the live Stripe key, alongside the database setting and the app's `EXPO_PUBLIC_STRIPE_LIVEMODE`. It is recorded in `swellyoNative/PRE_BUILD_CHECKLIST.md` beside the other two. When the money page finds payments in the mode it is not counting, it says so — that warning is usually a flag mismatch.

---

## 10. Errors

- Never show a raw error message. Use friendly text, matching the app's `friendlyErrorMessage` habit.
- Expired signed link → mint a new one when clicked.
- Expired session → back to login, no scary message.
- A failed read shows what failed and a retry button. It does not blank the page.
