# Swellyo Operator Dashboard — Spec

The desktop website operators use to run one trip: see who uploaded what, review documents, and export files.

**Status:** built. Written 2 August 2026, money section added 4 August 2026. Not yet tested against a real trip by an operator.

---

## 1. What this is

A small, separate website. It is **not** part of the mobile app and does not share its code.

- Operators log in with Google, the same account they use in the Swellyo app.
- They pick a trip and see how it is going.
- They can review documents and download files.
- They can see the money, and set one traveler's price.
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

**2. Setting a traveler's price.** Decided by Ohad on 4 August, when the money section was built. Prices are per traveler and frozen at join, so an operator quoting one person a different rate has nowhere else to do it on a desktop — and a price is the one number they most often need to fix while on a call.

Everything else Eyal called "real management" (editing the trip, messaging, removing people) stays off desktop.

If Eyal wants desktop strictly read-only, remove three buttons. It is a subtraction, not a redesign.

---

## 2. Rules

1. **Use what already exists.** No new database tables, no new functions, no migrations. Every read this site does is already live and already permitted.
2. **The database is the security boundary.** Row Level Security decides what an operator can see. The website cannot see a trip it does not host, even if the code asks for it.
3. **No backend.** The browser talks to Supabase directly. Netlify serves static files only.
4. **Files are private.** Every view or download uses a short-lived signed link. There are no public file URLs.

---

## 3. Who can get in

- Login is **Google OAuth** through Supabase. It is the only provider enabled on the project, and operators already have accounts from the mobile app.
- After login, the site looks for trips where the person is a **host** and the trip is `hosting_style = 'C'` (an operator trip).
- No operator trips → a plain message, not an error. They are logged in, they just have nothing to manage.
- There are no roles or staff accounts. Only the operator sees this.

---

## 4. Screens

```
/login                        Google sign-in
/trips                        the operator's trips
/trips/:id                    trip snapshot
/trips/:id/money              every traveler's price, what they paid, the ledger
/trips/:id/d/:requirementId   one requirement, everyone, with export
/trips/:id/t/:userId          one traveler
```

### 4.1 Trips list

Trips the person hosts, `hosting_style = 'C'` only. Each row: name, dates, how many travelers, and how many documents are waiting for review.

### 4.2 Trip snapshot

Top to bottom:

1. **Needs review** — "12 documents waiting for you". Opens the review list, oldest first. It is a shortcut, not a queue that must be cleared. Nothing happens automatically.
2. **Money** — collected against expected, and how many have paid each step:
   `$1,000 collected of $6,000 · 1 of 2 paid the deposit`
   Travelers with no price set are counted in the denominator and named in a second line — someone with no price is not paid, and leaving them out would make the trip look further along than it is. Opens the money page.
   The card is hidden only when the trip has no payment steps and no price anywhere. A trip that never charged for anything has no money story.
   Full design: `docs/superpowers/specs/2026-08-04-operator-dashboard-money-design.md`.
3. **Documents** — one line per requirement, showing **received** and **approved**:
   `Passports 15/15 in · 3/15 approved`
   Both numbers always. The gap is the operator's own backlog, and hiding it would make it look like a traveler problem.
   Waiver and medical are not uploads, so they get a short line: `Waiver signed 13/15 · Medical form 11/15`.
   Custom requirements go in a separate **Other requirements** list, one line each.
4. **Medical flags** — counts only, no names: "3 injuries", "2 allergies", "5 diet notes".
5. **Surf stats** — levels, board types, age range, nationalities. Background awareness, not a to-do list.
6. **Travelers** — everyone on the trip, one row each, alphabetical: photo, name, `3/5 approved · $500 of $1,200 paid`, and a `2 waiting` tag when they have documents to review. Opens their traveler page (§4.4).
   This is the only per-person way into the site — every other card is per-requirement, so before this a traveler who had submitted nothing could not be opened at all.
   The roster comes from the member list, never from the review read: a slow or failed review must not make the trip look empty.

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
| Money | Total, each payment step, their payments | Read · set price (owner only) |

Message, remove from trip, and editing the trip are **not here**. They stay on mobile.

### 4.6 Money page

One row per traveler: total, each payment step with what is still owed, and paid so far. Then a totals line, then **the payment rows themselves** — date, traveler, payment or refund, amount.

The raw rows are the point. Operators reconcile against their Stripe dashboard, and a single total cannot be checked against anything.

**Setting a price is owner-only.** The database guards it on `group_trips.host_id` — the operator of record — while this site finds trips through `role = 'host'`, which includes every admin promoted with "Set as admin". Those admins see the money; they do not see the button.

Changing a price after money has arrived follows three rules, and only one interrupts:

| Situation | What happens |
|---|---|
| Nothing paid | Saves, no confirmation |
| Paid, new total at or above it | Confirm, with the numbers spelled out |
| New total below what they paid | **Blocked** |

The block exists because an overpaid traveler cannot be put right from here — there is no refund on this site. Stripe refuses the same move for the same reason. **The server does not check this**, so a direct API call still gets through; that gap is logged for the next payments migration.

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

Everything below is already live. **This project adds nothing to the database.**

| What | Where it comes from |
|---|---|
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
| Set a price | `operator_set_traveler_price(...)` |

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

---

## 7. Not building

- **Refunds.** They are read and shown. Issuing one happens in the Stripe dashboard.
- **Payout status** — whether Stripe has paid the operator out. A different question from "did the traveler pay", on a different Stripe object, and mixing the two on one screen is how people misread their own balance.
- Bulk price setting. One traveler at a time.
- Invoices and receipts. Stripe already emails them.
- Export logging or download history.
- Staff accounts or roles.
- A view across several trips at once.
- Charts. Counts and lists only.
- Editing trips, messaging, removing travelers.

---

## 8. Still open

1. **Custom requirements.** Operators can invent their own items, and the tiles are built around passport, visa, insurance and flights. For now they go in an "Other requirements" list with their own counts. How they should properly be counted and exported — **needs Eyal and Ohad**.
2. **Removing a traveler who already paid.** Not a desktop action, so it does not block this site. The ledger is append-only, so their payment rows survive being removed from the trip — but nothing refunds them, and this site would stop showing the rows once they are no longer a member. Needs Eyal.

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
