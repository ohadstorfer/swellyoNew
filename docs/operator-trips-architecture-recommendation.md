# Operator Trips — Architecture Recommendation

**Decision: Option C — a separate model (`operator_trips` + booking tables), bridged to the existing chat system, everything else net-new.**

Do not touch `group_trips`, `group_trip_participants`, `group_trip_join_requests`, or the `is_trip_host()` RLS layer. Zero schema changes, zero new RLS policies, zero migration risk on the live table.

---

## Why not A or B

**Grounding in the actual repo:**
- `group_trips` / `group_trip_participants` / `group_trip_join_requests` are live, actively evolving (multi-host migration landed 2026-07-08, hand-applied to prod, comment: *"Do NOT db push"* — this table is handled with real caution already).
- Permission logic is centralized in one `SECURITY DEFINER` function, `is_trip_host(trip_id)`, which gates **six** tables today: `group_trips`, `group_trip_participants`, `group_trip_join_requests`, `group_trip_commitment_requests`, `group_trip_gear_items`/`gear_requests`, `group_trip_admin_updates`. Any change to host/participant semantics has a wide, hard-to-fully-test blast radius across all six.
- `participant_count` is trigger-maintained; join-request approval auto-inserts into `group_trip_participants` via trigger. This is a simple, well-tuned **request-to-join state machine** (pending/approved/declined/withdrawn) — not a booking/inventory system. There is no concept of holding a spot, partial payment, or money anywhere in this schema.
- Chat is already **loosely coupled**: `messagingService.createGroupConversation(..., { trip_id })` stores `trip_id` inside `conversations.metadata` (JSONB), not as an FK to `group_trips.id`. This is an existing, working precedent for "shared infra keyed by an opaque trip id" — it's the template for how operator trips should plug into chat.

**Community/industry consensus (cross-referenced):**
- Single-table-with-type-flag ("polymorphic association") is a well-documented antipattern: no FK integrity across divergent row shapes, no CASCADE guarantees, application-level enforcement of what should be DB-level constraints (GitLab engineering docs, SQL Antipatterns book summary, multiple Rails STI writeups all converge on this).
- Marketplace booking flows are architecturally distinct from RSVP/join-request flows on three axes — time (calendar/slot-based vs freeform), price formation (real payment + commission), and **inventory** (a booking system must "own the transaction" and prevent double-booking/overselling; an RSVP system just tracks attendance) (Sharetribe Academy). Capacity-as-inventory (spot secured at deposit) needs atomic hold semantics — fundamentally different consistency requirements than a soft `max_participants` cap.
- Supabase RLS handles multiple access models on one table, but the community's own best-practice guidance (Supabase docs, makerkit.dev, agilesoftlabs) is: keep policies simple, use `SECURITY DEFINER` helper functions for recursive checks, and complexity/perf cost scales with how many divergent policies stack on one table. Layering a second, entirely different lifecycle (payments, documents, deadlines) onto `group_trip_participants`'s existing six-table-wide policy web is exactly the case this guidance warns against.
- "Blast radius" framing from progressive-delivery literature applies directly: the smallest blast radius you can operate in while still shipping the feature is the right default — and for Swellyo that means a new table, not a flag on a table six other live features already depend on.

**Option A (flag on `group_trips`)** fails immediately: it forces `is_trip_host()`, the approval trigger, `participant_count`, and every downstream RLS policy to grow conditional branches for a payment+document+deadline lifecycle they were never designed for. One bug in that shared logic risks the live peer product.

**Option B (shared tables, hard UX split)** is marginally safer than A but still means one `group_trip_participants` row has to represent both "casual join, no money" and "traveler with a payment state, document set, and deadlines" — the same divergent-row-shape problem, just hidden behind screen-level routing instead of a flag. It doesn't reduce blast radius on writes/migrations, only on what the user sees.

**Option C** costs a small amount of duplicated "trip shell" boilerplate (dates, destination, hero image, description) but buys full isolation for a product surface that is materially riskier (real money, PII documents, deadlines) than the one it sits next to.

---

## Table-by-table: shared vs. separate

| Concern | Decision | Notes |
|---|---|---|
| **Trips** | Separate — new `operator_trips` table | Own shell fields; can reuse the same TS types/validation for destination/dates/hero image to avoid drift, but no shared table. |
| **Participants / bookings** | Separate — new `operator_trip_bookings` (traveler state machine: invited → onboarding → deposit_paid *(spot secured)* → paid_full → completed / removed / refunded) | Nothing like this state machine exists today; forcing it into `group_trip_participants.role` would be the antipattern. |
| **Chat** | **Shared** — reuse `messagingService` group conversations, same `metadata.trip_id` pattern already used for group trips | Already decoupled from FK to `group_trips.id` today — this is the one piece of infra genuinely safe and cheap to reuse as-is. |
| **Gear** | Separate (deferred) — do not reuse `group_trip_gear_items`/`gear_requests` v1 | Those tables are gated by `is_trip_host()`, which you'd have to extend to understand operator staff. Skip for v1; operator trips don't need peer-style gear splitting yet. |
| **Updates/announcements** | Separate — new `operator_trip_updates` (or fold into the new "tasks" concept) | Operator's "open tasks with deadlines" is richer than `group_trip_admin_updates` (per-traveler completion + deadline tracking); don't force-fit. |
| **Payments** | Entirely new — `operator_trip_bookings` (status) + an **immutable** `operator_trip_payment_events` ledger + `operator_stripe_accounts` / IL-gateway equivalent | Webhook-driven; never let a webhook handler mutate booking status directly — write an event row, derive status from the event log. Idempotency keys on every write. |
| **Documents** | Entirely new — `operator_trip_traveler_documents` (type enum: passport/waiver/medical/insurance/visa/flight, status, deadline) + a **private** storage bucket (`operator-trip-docs`), signed-URL access only | PII-heavy; do not reuse the public `trip-images` bucket pattern. |
| **Tasks** | Entirely new — `operator_trip_tasks` + `operator_trip_traveler_task_status` | Operator-defined, per-traveler, deadline-bearing — no existing analog. |
| **Capacity** | New, real inventory field on `operator_trips` (`spots_total`, `spots_secured`) incremented via a `SECURITY DEFINER` function triggered specifically off the deposit-paid transition | Must be atomic/race-safe (`SELECT ... FOR UPDATE` or a guarded increment), unlike the soft `max_participants` count on group trips. |
| **Operator flag** | Add `is_operator boolean` (or a thin `operator_profiles` row) on the existing user/profile — no new auth system | Matches "manually-flagged existing accounts" requirement; used in `operator_trips` INSERT policy. |

---

## Top 3 risks and mitigations

1. **Discovery/feed fragmentation** — Explore/TripsScreen must show both trip types in one list, and that's the one place code naturally wants to reach for a shared table.
   *Mitigation:* a read-only Postgres `VIEW` that `UNION ALL`s a reduced, common column set from `group_trips` and `operator_trips` for feed/search queries only. Never write through it. Zero risk to either base table.

2. **Two parallel permission systems** (`is_trip_host()` for group trips, a new `is_operator_staff()` for operator trips) risk drifting apart or being called on the wrong table by mistake.
   *Mitigation:* give the new function the same signature shape and name it explicitly (`is_operator_trip_staff(trip_id)`), and only let genuinely shared infra (chat) accept either — via the existing metadata/trip_id soft-reference pattern, not a shared FK. Document the split once in code comments near both functions, cross-referencing each other.

3. **Payment correctness under webhook retries/failures** — real money, held funds, refunds; a naive "webhook updates booking row" design will double-charge or double-secure spots on retry.
   *Mitigation:* immutable `operator_trip_payment_events` ledger keyed by Stripe/gateway idempotency key; booking status is a derived read, recomputed from the ledger, never written directly by a webhook handler. Mirrors the "event-sourced-lite" pattern most mature Stripe Connect marketplace integrations converge on.

4. *(bonus, lower severity)* **Duplicated trip-shell logic** between `CreateTripFlowA.tsx`-style peer flow and a new operator creation flow increases long-term maintenance surface.
   *Mitigation:* extract shared TS types/validators for destination/date/hero-image fields now, even though the tables stay separate — cheap insurance against drift, no DB coupling required.

---

## RLS / migration implications on the live `group_trips` table

**None.** Option C requires zero `ALTER TABLE` on `group_trips`, `group_trip_participants`, `group_trip_join_requests`, or any of the six tables gated by `is_trip_host()`. All new tables (`operator_trips`, `operator_trip_bookings`, `operator_trip_payment_events`, `operator_trip_traveler_documents`, `operator_trip_tasks`, `operator_trip_updates`) are purely additive, with their own RLS built from scratch, following the same pattern already proven in this codebase (`SECURITY DEFINER` permission function + per-table policies referencing it) but scoped to a new function name so it can never accidentally touch peer-trip permissions.

The only touch point on existing infra is chat, and it's additive there too — `messagingService.createGroupConversation` already accepts an arbitrary `trip_id` in metadata with no FK constraint, so operator trips slot into the same call with no migration at all.

---

## Future path: peer hosts getting operator features

Because operator trips are structurally separate, "give some peer hosts a subset of operator features" (e.g., let a peer host collect a deposit) becomes an additive question — either (a) let a `group_trips` row optionally link to a *subset* of the new payment tables (a nullable `operator_trip_bookings`-style row keyed by `group_trip_id` instead of `operator_trip_id`), or (b) eventually promote a peer trip into a real `operator_trips` row via an explicit conversion flow. Both are tractable later; neither requires today's decision to touch the live table now. This optionality would have been foreclosed by Option A (the flag would already be baked into the row) but stays open under Option C.
