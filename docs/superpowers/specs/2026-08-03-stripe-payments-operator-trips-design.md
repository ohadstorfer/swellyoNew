# Stripe payments for operator trips (hosting_style C)

**Status:** Design, written 2026-08-03 with Ohad. Nothing built yet.
**Replaces:** `SPEC.md` §6 (Payments). SPEC.md §5's separate `operator_trips` data model was abandoned — this design builds on the live `group_trips` cluster instead.

---

## 1. What this adds

Operators who run paid trips can collect money inside Swellyo, in two steps
(a deposit and a final balance), each with a due date the operator chooses.

Every operator also gets the opposite choice: **do not collect money in the app
at all**. That mode is the app exactly as it is today.

**Success criterion:** one real operator runs one real trip where travelers pay
a deposit and a balance through Swellyo, and the operator never opens a
spreadsheet to track who owes what.

---

## 2. The key idea — payment steps are requirement rows

The plan tab already shows a list of things a traveler must do: passport,
waiver, insurance. Payment becomes two more rows in that same list.

This is not a new invention. The socket was left open on purpose:

- `organized_trip_requirements.req_type` already allows `'pay'`
- `operator_requirement_pay_state(trip_id, user_id, requirement_id)` already
  exists as a stub returning `'not_started'`, with the comment *"the payments
  spec replaces the body with a read of the ledger. The signature never
  changes."*
- The traveler's plan card already filters `pay` rows out while it waits

What we gain for free by filling the socket instead of building beside it:

| Already built, reused as-is |
|---|
| Due dates (`skip_at_onboarding` + `deadline_days_before`) |
| The operator's timing UI in the create wizard and in `ManageRequirementsSheet` |
| Deadline reminders (`scan-trip-reminders`) |
| Overdue state |
| The traveler's plan list rendering |

"The admin decides both timings" therefore costs almost nothing to build.

The unique index `uq_organized_trip_req_kind_per_trip` on `(trip_id, kind)`
guarantees at most one deposit row and one balance row per trip.

---

## 3. Two modes

One new column on `group_trips`: `payment_mode`. Text, not boolean, so a third
mode (an Israeli gateway) can be added later without a migration.

### `'offline'` — the default

No payment rows are created. The traveler sees no money in the app. The
operator charges however they already charge, and Swellyo invoices its
commission by hand outside the app.

Nothing is built for this mode. It is the current app.

**Switching a live trip from `'managed'` back to `'offline'`** hides the pay
rows but must never delete the ledger. The rows are deactivated
(`is_active = false`), exactly as `removeRequirement()` already does when a
requirement has evidence against it. Money history survives a mode change.

### `'managed'`

The deposit and balance rows appear on the plan. The traveler pays with a card.

This mode cannot be selected until Stripe confirms the operator's account can
accept charges. A trip can never be published asking for money it has no way to
receive.

---

## 4. Money flow — Stripe Connect Express

Travelers pay the **operator's** Stripe account. Swellyo's commission is split
off automatically at the moment of the charge.

**Why Connect and not "everything into Swellyo's account, pay operators by
hand":** the compliance research already settled it — *"Stripe holds the license
in all US states. Swellyo using Stripe Connect Express/Custom does NOT need its
own MTL. NY and CA are covered by Stripe's own license."* That protection only
exists on Connect. Taking money in and wiring it onward under Swellyo's own name
is money transmission, unlicensed. Connect also collects W-9 / W-8BEN and files
1099s, which otherwise becomes annual manual work — including Form 1042-S and
30% withholding for an Israeli operator.

**Commission:** 12% by default, stored per operator as `commission_bps` (1200)
so a design partner can be set to 0.

**Currency:** USD only. Charging in USD and settling in USD avoids the 1% FX
conversion fee identified in the hidden-costs research.

### Not Stripe-shaped

Tranzila and other gateways are expected later. Nothing in the database may
assume Stripe:

- `payment_mode` is text, not a boolean
- every ledger row carries a `provider` column
- the checkout edge function is named `payments-checkout`, and picks a provider
  inside

Only the webhook is provider-specific, which is correct — signature
verification differs per provider, so each gets its own function.

---

## 5. Prices — three layers

Each traveler has **their own price**. The trip price is only the default.

This is the standard order-line pattern, and it is what tour operator software
does (RESMARK and PEAK 15 both list per-booking price override as a core
feature). The rule from the e-commerce literature: store the amount on the order
line, so changing the catalog price never rewrites an existing order.

| Layer | Where | What it means |
|---|---|---|
| Catalog | `group_trips.cost_per_person` (exists), `group_trips.deposit_amount` (new) | The trip's default price |
| Order line | `group_trip_participants.price_total_usd`, `.deposit_usd` (new) | **This traveler's own price** |
| Ledger | `organized_trip_payment_events` (new) | What they actually paid |

**Requirement rows hold no amounts.** They are the schedule only: which step,
and when it is due.

### Working out what a traveler owes

```
deposit due  =  participant.deposit_usd
balance due  =  participant.price_total_usd  −  participant.deposit_usd
paid so far  =  sum(amount_usd) in the ledger for that traveler + step
```

A step is done when `paid so far >= amount due`.

### Freezing

A traveler's price is **copied from the trip when they join**. After that the
operator can change the trip price freely and nobody already on the trip
changes.

For participant rows that existed before this feature, both columns are null,
and reads fall back with `coalesce(participant.price_total_usd,
trip.cost_per_person)`. No backfill migration is needed.

### Editing one traveler's price

The operator opens a traveler and edits Total and Deposit. Balance follows
automatically. No other traveler is affected.

Both real cases work:

- **Agreed a lower price privately** → set their total to $1,700, their balance
  drops.
- **Agreed more services for more money** → set their total to $2,400, their
  balance row reopens for the extra $400 and they are asked to pay it.

Raising the price of someone who already paid deliberately reopens their
balance. That is the intended behaviour, not a bug.

---

## 6. Database changes

All additive. No existing column or policy is modified.

### `users`

| Column | Type | Notes |
|---|---|---|
| `stripe_account_id` | text | the operator's connected account |
| `stripe_charges_enabled` | boolean, default false | refreshed from Stripe |
| `commission_bps` | int, default 1200 | 1200 = 12%, per-operator override |

### `group_trips`

| Column | Type | Notes |
|---|---|---|
| `payment_mode` | text not null default `'offline'` | CHECK in (`'offline'`, `'managed'`) |
| `deposit_amount` | numeric | canonical USD, default deposit for new joiners |

Currency follows the existing convention: amounts are canonical USD, displayed
through `budget_currency` + the frozen `budget_fx_rate`. There is no separate
deposit currency.

### `group_trip_participants`

| Column | Type | Notes |
|---|---|---|
| `price_total_usd` | numeric, nullable | this traveler's total; null = fall back to trip |
| `deposit_usd` | numeric, nullable | this traveler's deposit; null = fall back to trip |

### `organized_trip_requirements`

- `'deposit'` and `'balance'` added to the `kind` CHECK constraint
- No amount column. Schedule only.
- New trigger, mirroring `trg_passport_requires_operator_trip`: a `pay` row is
  refused unless the trip is `hosting_style = 'C'` **and**
  `payment_mode = 'managed'`.

### `organized_trip_payment_events` — the ledger

Append-only. Never updated, never deleted.

```
id                    uuid pk
trip_id               uuid  → group_trips(id) on delete cascade
user_id               uuid  → auth.users(id)
requirement_id        uuid  → organized_trip_requirements(id) ON DELETE SET NULL
provider              text  not null default 'stripe'
provider_event_id     text  not null
provider_object_id    text
event_type            text  CHECK in ('paid','refunded','failed')
amount_usd            numeric not null      -- negative for a refund
amount_charged        numeric
currency_charged      text
application_fee_usd   numeric
created_at            timestamptz default now()

UNIQUE (provider, provider_event_id)
```

Two decisions here carry weight:

1. **`requirement_id` is `ON DELETE SET NULL`, not cascade.** Every other child
   table of requirements cascades. Payment history must not — deleting a
   requirement cannot erase the record that someone paid money.
2. **No client may INSERT.** RLS grants `SELECT` only: a traveler sees their own
   rows, the trip's host sees all of their trip's. The webhook writes with the
   service role. Nothing sent from a phone can invent a payment.

The `UNIQUE (provider, provider_event_id)` is what makes the webhook safe to
retry. Stripe redelivers events; a duplicate insert fails harmlessly.

### `operator_requirement_pay_state()`

The stub body is replaced with a read of the ledger against the traveler's
amount. **The signature does not change**, so nothing that calls it is touched.

Returns `'approved'` when fully paid, otherwise `'not_started'`.

---

## 7. Edge functions

### `stripe-connect-onboard`
Authenticated. Creates the operator's Express account if they have none, returns
a Stripe onboarding link, and refreshes `stripe_charges_enabled` from Stripe.

### `payments-checkout`
Authenticated. Takes a requirement id. Checks the caller is on the trip and the
row is a `pay` row, works out what is still owed from the ledger, and creates a
Stripe Checkout Session with `transfer_data.destination` set to the operator and
`application_fee_amount` set from their `commission_bps`. Returns the URL.

The amount is **always computed server-side**. The client never sends an amount.

### `stripe-webhook`
`verify_jwt = false`. Verifies the Stripe signature, then appends ledger rows.
Handles `checkout.session.completed` and `charge.refunded`.

Deployment note: this function must be deployed with `--no-verify-jwt`, the same
constraint that already applies to `send-push-notification`.

---

## 8. The return trip is not trustworthy

Stripe rejects custom URL schemes, so there is no reliable `swellyo://` redirect
back into the app after Checkout.

**The webhook is the only source of truth.** When the browser sheet closes, the
app simply refetches the requirement list. If the webhook has not landed yet the
row shows a brief "checking your payment…" state and polls for a few seconds.

The app never marks anything paid because the browser came back.

---

## 9. What people see

### Traveler
Two more rows on the Plan tab, looking like every other row, showing the amount
and the due date. Tap → Stripe's hosted page opens in a browser sheet → back →
the row turns green.

Card entry is **Stripe Checkout**, not the native Payment Sheet. No native
module, so it works in Expo Go, on web, and on both stores with no rebuild.
Apple Pay and Google Pay come free, and card data never touches Swellyo.

### Operator — creating a trip
In the wizard's existing **budget** step, where `cost_per_person` already lives.
No new step.

- A choice: *"I'll handle payment myself"* or *"Collect payment in Swellyo"*
- Choosing the second opens Stripe onboarding inline, and stays locked until
  Stripe confirms
- Then: the deposit amount. Balance fills in as price − deposit.
- Leave the deposit blank → **only the balance row is created, for the full
  price**. There is no deposit row at all, not a deposit row worth zero.

Timing for both steps is set one step later, on the Requirements step, using the
UI that already exists.

### Operator — after publishing
- `ManageRequirementsSheet` shows the two pay rows with their timing controls
- The member view gains a small **Price** sheet: Total, Deposit, and what they
  have paid so far. Editing affects only that traveler.

---

## 10. Files

**New**
- `supabase/migrations/` — one migration
- `supabase/functions/stripe-connect-onboard/`
- `supabase/functions/payments-checkout/`
- `supabase/functions/stripe-webhook/`
- `src/services/trips/tripPaymentsService.ts`
- `src/components/trips/TravelerPriceSheet.tsx`
- `src/components/trips/ConnectStripeCard.tsx`

**Modified**
- `src/services/trips/tripDocumentsService.ts` — `'deposit'` and `'balance'` in
  the catalog, `RequirementKind`, and `REQUIREMENT_ORDER`
- `src/screens/trips/CreateTripFlowA.tsx` — payment mode + deposit in the budget
  step
- `src/components/trips/ManageRequirementsSheet.tsx` — pay rows
- `src/components/trips/plan/PlanSections.tsx` — render pay rows, Pay button
- `src/components/trips/TripMemberSheet.tsx` — open the price sheet
- `src/hooks/trips/useTripQueries.ts` — payment state query

**Untouched**
- The join flow, capacity, and all their RLS
- Every A and B trip

---

## 11. Not building

| Left out | Why it is safe to leave out |
|---|---|
| Israeli gateway (Tranzila) | `provider` column and generic function name are already there |
| Refund button in the app | The ledger already records refunds arriving by webhook |
| Deposit secures the spot | The ledger is shaped so this can be added later |
| Tashlumim (Israeli installments) | Impossible on Stripe for a US entity — SPEC.md §3 |
| Desktop dashboard | Later |
| Per-traveler add-on line items | Covered for now by editing the traveler's total |

Refunds today: the operator refunds in their own Stripe dashboard. The webhook
hears it, writes a negative ledger row, and the traveler's row goes back to
unpaid on its own. No refund UI is built.

---

## 12. Risks

1. **Chargebacks land on Swellyo, not the operator.** With destination charges
   the platform carries dispute liability. Connect does not change this. The
   research puts it near $750/month at $50k GMV. The real mitigations are a
   non-refundable deposit policy and 3DS — **neither is in this scope**, and
   both should be decided before large money moves.
2. **Stripe onboarding is a wall.** The operator must hand over ID, bank
   details, and business documents before they can take a cent. Offline mode is
   the escape hatch, which is a strong reason both modes ship together.
3. **Webhook correctness is the whole system.** If the webhook is wrong, the
   money numbers are wrong. Mitigated by the append-only ledger, derived state,
   and the unique constraint on `provider_event_id`.
4. **Editing a paid traveler's price reopens their balance.** Intended, but it
   will surprise an operator the first time. The price sheet should say so
   plainly before saving.

---

## 13. Open, not blocking

- Whether the deposit should be stated as non-refundable to travelers. This is a
  policy promise made on the operator's behalf, so it needs the design partner's
  agreement, not a code decision.
- 3DS / Stripe Radar tuning — worth turning on before real volume, but it is a
  dashboard setting, not part of this build.
- Whether the operator should get a push when a traveler pays. Easy to add
  later; the notification types table already has room.
