# SPEC — Operator Trips ("Join a Trip" for professional trip operators)

**Status:** Draft v1, written 2026-07-20 from an interview with Eyal.
**Companion docs:** `docs/operator-trips-architecture-recommendation.md` (architecture deep-dive), `docs/operator-conversation-guide.md` (operator sales pitch), `docs/payments-questions-gateways.md`, `docs/payments-questions-accountant.md`, `.claude/agent-memory/web-researcher/research_stripe_connect_*.md`.

---

## 1. Summary

Swellyo today is a free, peer-to-peer group-trips product: any user hosts a trip, others request to join, no money moves. This spec adds a **second, parallel product**: professional surf-trip operators run their commercial trips inside Swellyo — real payments, a structured traveler onboarding (passport, waivers, medical, insurance, visa, flights), operator-defined tasks with deadlines, and a management dashboard.

**Success criterion for v1:** one design-partner operator runs one real trip end-to-end inside Swellyo — creates the trip, their travelers onboard and pay and upload documents, and the operator manages the whole thing to trip completion without falling back to spreadsheets and WhatsApp. Depth over breadth.

---

## 2. Decisions locked in this interview

| Topic | Decision |
|---|---|
| Operator identity | Manually flagged existing user accounts (`is_operator` on profile). No self-serve signup, no application/review UI in v1. Eyal onboards each operator personally. |
| Payments | **Real money collection**, both rails at launch: Stripe Connect for US/international operators, per-operator gateway integration for Israeli operators. |
| IL commission | Operator remits manually (we track amounts, we don't take a cut at source). |
| Traveler entry | Operator shares a link. Trip visibility is a **per-trip toggle**: private (link-only) or listed in explore. |
| New-user path | Full existing Swellyo onboarding first, then trip onboarding. |
| Capacity | Real spot count. **A spot is secured only when the deposit is paid.** |
| Waivers | Operator uploads waiver text/PDF → traveler reads → taps "I agree" → we record name + timestamp + waiver version. |
| Staff | Display-only profiles (name, photo, role, bio). No accounts, no access. |
| Comms | Reuse existing group chat + admin updates, **plus** automated deadline reminders and a 1:1 operator↔traveler DM. |
| Desktop | Read/review only — view payments, view info, exports. All real management happens on mobile. |
| Architecture | Separate data model, bridged to existing chat. See §5. |

## 3. Open questions — must be answered before building the relevant part

These are deliberately unresolved. Do not invent answers.

1. **🔴 Pricing model** — flat per-person, or room types (shared/private), or options + add-ons? **Ask the design-partner operators.** Blocks: payment amounts, booking table shape, capacity semantics.
2. **🔴 Payment timing** — where in onboarding does payment sit? Deposit during onboarding + balance as an open task later, or full payment upfront, or operator-configurable? **Ask the design-partner operators.** Blocks: onboarding step order, booking state machine.
3. **🔴 Refund & chargeback liability** — we charge the card, so Stripe disputes land on us. Needs research + a conversation with design partners (and likely a lawyer). Candidate structure to validate: operator is contractually liable for delivery and refunds, chargebacks debited from the operator's connected account (`debit_negative_balances: true`), refunds only ever executed on operator instruction, deposit explicitly non-refundable. **Do not finalize the money-holding design until this is settled.**
4. **🟡 Document retention** — either (a) private bucket + auto-delete N days after trip ends, or (b) private bucket, kept, so returning travelers don't re-upload ("my documents" wallet). Leaning between these two; decide before building document storage. Access control is the same either way (see §7).
5. **🟡 Israeli gateway choice** — which gateway(s) to integrate first (Tranzila leads on prior research; PayPlus, Grow/Meshulam, PayMe also surveyed). Depends on what the first Israeli operators actually use. See `.claude/agent-memory/web-researcher/research_il_payment_gateways_smaller.md`.

### Correction to a stated assumption
**Stripe can do deposits, but Stripe cannot do tashlumim.** A deposit + balance is straightforward on Stripe (two separate charges, or auth-then-capture). Israeli interest-free installments (תשלומים) are a property of Israeli domestic acquiring over SHVA and are unavailable to a US entity on Stripe — this was confirmed across several prior research passes. Tashlumim therefore only exist on the **Israeli gateway rail**, which is precisely why both rails are in v1. Splitit can stack installments onto Stripe but adds cost rather than reducing it, and is not a substitute.

---

## 4. Product scope

### 4.1 Traveler's side

**Extended trip onboarding** (after joining an operator trip, on top of normal Swellyo onboarding):
- Passport upload
- Waiver signing (read → agree; records name, timestamp, waiver version)
- Medical form: allergies, dietary preferences, injuries, regularly-taken prescribed medication
- Payment (position in the flow = open question #2)
- **Deadline-gated, skippable until a date the operator sets:** insurance document/screenshot, visa (if applicable), flight tickets (if applicable)

**Trip experience after onboarding** — everything travelers see today, plus:
- Overview: staff highlighting, improved "what's included" breakdown
- Plan: **open tasks** (passport, insurance, visa, payment due…), view/edit already-uploaded items including a "my medical card", helpful links
- Carried over unchanged: chat, gear, admin updates, view profiles, notifications

### 4.2 Operator's side

**Trip creation** — the current wizard plus:
- Set onboarding requirements (which documents are required for this trip)
- Set open tasks + deadlines
- Set payment requirement timing
- Staff highlighting (fill in staff info)
- Set notifications for both self and customers
- Set trip visibility (private link-only vs listed in explore)
- Set capacity (number of spots)

**Simple trip management (mobile):**
- Edit trip info via a dedicated, simpler space than the creation wizard
- Communicate with customers: chat, admin updates, gear lists

### 4.3 Dashboard (mobile + read-only desktop)

Entry: trips list → select trip or create new.

**Trip snapshot:**
- **Pay status:** number who paid in full, total collected (in $ and ₪), open payments outstanding, number who paid deposit (mikdama), total paid via tashlumim
- **Document completion:** counts like "14/15 passports", plus visas, insurance, flights — each with view-all
- **Medical flags:** allergies, food preferences, injuries (e.g. "3 reported injuries" → view all)
- **Surf demographics:** beginner/intermediate/advanced counts, board types, age ranges, nationalities

Each of these gets its own drill-in page with view + export for all.

**Per-traveler view:**
- Profile: surf level, travel experience, name, photo, age, nationality, home break, places been, board type, lifestyle preferences
- Personal info: waiver signed yes/no; passport, insurance, flight info, visa — each with view / export / **delete + reclaim**; medical status **view-only** (allergies, injuries, dietary, medication)
- Actions: message, remove from trip, delete + reclaim a document, send a reminder

> **"Delete + reclaim"** = the operator deletes a traveler's uploaded document and the system automatically re-opens it as a task for that traveler (with a notification), e.g. because the scan was unreadable.

---

## 5. Architecture

**Decision: a separate operator-trip data model, bridged to the existing chat system. Existing live tables are not modified.**

Rationale (full version in `docs/operator-trips-architecture-recommendation.md`): the live `group_trips` cluster is tightly wired — a single `SECURITY DEFINER` function `is_trip_host()` gates six tables (participants, join_requests, commitment_requests, gear_items, gear_requests, admin_updates) and was hand-patched to production as recently as 2026-07-08. Bolting an `is_operator_trip` flag onto it would force a payment/document/deadline lifecycle through row shapes and RLS logic that six unrelated live features depend on. Bookings are also structurally different from join-requests: real inventory holds, payment-gated state, double-booking prevention. This is not an incremental extension of request-to-join.

**The free win:** chat is already loosely coupled — `messagingService.createGroupConversation` stores `trip_id` in `conversations.metadata` (JSONB), not as a foreign key to `group_trips.id`. Operator trips can create group conversations through the same path with zero migration.

### Shared vs separate

| Concern | Treatment |
|---|---|
| Trips | **Separate** — new `operator_trips` |
| Participants | **Separate** — `operator_trip_bookings` (real state machine, not join-requests) |
| Chat | **Shared** — reuse messaging via `conversations.metadata.trip_id` |
| Gear | **Shared or duplicated** — decide at build time; gear is loosely coupled and low-risk either way |
| Admin updates | **Separate** (mirror the existing pattern rather than widening the live table) |
| Payments, documents, tasks | **New, no equivalent exists** |
| Explore feed | **Read-only UNION view** over both trip types — never a shared write table |

### New tables (sketch — shapes firm up once open questions #1 and #2 are answered)

- `operator_trips` — operator_id, all trip content, capacity, visibility (private/listed), payment config, onboarding requirements config, waiver (text/file + version), staff (JSONB), status
- `operator_trip_bookings` — trip_id, traveler_id, explicit state machine (e.g. `onboarding_started → deposit_paid (spot secured) → fully_paid → completed / cancelled`), chosen price option, amounts
- `operator_trip_payment_events` — **immutable ledger.** Webhooks and manual marks append events; booking payment status is *derived* from the ledger, never mutated directly by a webhook. This is what makes the dashboard's money numbers trustworthy and replayable.
- `operator_trip_traveler_documents` — type (passport/insurance/visa/flights), storage path, uploaded_at, deleted/reclaimed state
- `operator_trip_tasks` — per-trip task definitions + per-traveler completion state + deadlines

### Top risks and mitigations
1. **Feed fragmentation** (two trip types, one feed) → mitigate with the UNION view.
2. **Two parallel permission systems** → mitigate with strict naming/documentation discipline and no shared foreign keys.
3. **Payment webhook correctness** → mitigate with the immutable ledger + derived status.

---

## 6. Payments

### 6.1 US / international rail — Stripe Connect
Per prior research (`research_stripe_connect_setup.md`, memory `stripe_connect_state`): Stripe live account is approved, Connect is enabled, a test connected account exists. Direction already agreed: **Express** accounts, destination charges, ~12% commission, funds held until after the trip. Three build-time decisions remain open there (account type confirmation, charge type, loss liability) and now interlock with open question #3.

Deposits: implement as deposit charge + later balance charge. Tashlumim: not possible on this rail — see the correction in §3.

### 6.2 Israeli rail — per-operator gateway integration
The Israeli operator connects **their own** gateway account (API key / webhooks) so payments report amount + payer back into Swellyo automatically. This is what makes the ₪ / mikdama / tashlumim numbers in the dashboard real rather than trust-based. Swellyo is not in the money flow; commission is remitted manually by the operator against the tracked totals.

Consequence to accept: this only works for operators on gateways we've integrated. Gateway choice is open question #5. Expect the first integration to be one gateway, not all of them.

### 6.3 Dashboard money view
The dashboard shows **all money moving through Swellyo**, both rails together, in $ and ₪ — total collected, paid in full, deposits paid, outstanding, tashlumim totals.

---

## 7. Sensitive data handling

Passports, medical information, and insurance documents are the most sensitive data Swellyo will ever hold. Baseline regardless of the retention decision (open question #4):

- Private Supabase Storage bucket — never public URLs
- RLS: only the traveler and that trip's operator can access a document
- Signed, short-lived URLs for viewing and export
- Medical information is **view-only** for the operator — no export
- Whatever retention policy is chosen must be shown to travelers before they upload

---

## 8. Blending with the live product

- Existing peer trips and their users are **unaffected** — no schema, RLS, or behavior change to live tables.
- Operator trips appear in the explore feed only when the operator sets visibility to listed; they need a distinguishing signal (operator/verified badge, price) so users can tell a commercial trip from a peer trip.
- Peer hosts do not get operator features in v1. The separate model leaves the door open to later promoting selected features (e.g. tasks) to peer trips deliberately, rather than by accident.
- New travelers arriving from an operator link go through full Swellyo onboarding first. **Watch this closely** — an operator's paying customer did not ask for a social surf app, and this is the most likely place in the whole funnel to lose them. Instrument it and be ready to revisit.

---

## 9. Suggested build order

1. Operator flag + operator trip creation (no payments) + trip visibility + capacity
2. Traveler onboarding: documents, waiver, medical form, tasks with deadlines
3. Dashboard: trip snapshot + per-traveler view + exports (mobile)
4. Payment rail #1 (whichever the first design partner needs) + the payment ledger
5. Automated deadline reminders + 1:1 operator↔traveler DM
6. Payment rail #2
7. Desktop read-only dashboard

---

## 10. Files likely touched

- **New:** `supabase/migrations/` (operator tables), `src/screens/operator/` (dashboard, trip management), `src/screens/trips/operator-onboarding/` (traveler onboarding flow), `src/services/operator/` (operatorTripsService, bookingsService, documentsService, paymentsService), `supabase/functions/` (Stripe checkout/webhook, Israeli gateway webhook receiver)
- **Modified:** explore feed query (UNION view), `src/services/messaging` (bridge operator trips to group conversations), profile model (`is_operator`), navigation
- **Untouched:** `group_trips` and all existing `group_trip_*` tables and their RLS

---

## 11. Before building — required inputs

1. Design-partner operator conversation covering: pricing model, payment timing, refund/cancellation expectations, which gateway they use, what they currently do in spreadsheets. Use `docs/operator-conversation-guide.md`.
2. A decision on document retention (open question #4).
3. Legal/research pass on refund and chargeback liability (open question #3).
