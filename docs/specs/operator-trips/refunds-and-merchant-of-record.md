# Refunds & Cancellations — making the operator the seller

**Status:** Phases 1, 2, 4c and 4d built and applied to prod (2026-08-11 → 12). Phase 3 deferred,
Phase 4b waiting on a lawyer. Nothing left to apply; the client is uncommitted and untested on a
device.
**Decision it implements:** Eyal's "Refunds & Cancellations — bottom lines" (2026-08-11).
**Resolves:** §1 of [`agreements-and-terms.md`](./agreements-and-terms.md), which was written as an
open question with two options. The answer is **option B: move merchant of record to the operator.**

---

## 0. The decision in one paragraph

Swellyo is the payment rail. The operator is the merchant of record — legally the seller. He owns
every cancellation and refund decision and carries the money. We move funds and take 12%. This is
the Airbnb / WeTravel / Eventbrite model. It shifts liability to the operator; it never erases it
100%.

Today the code does the opposite. Everything below is the work to flip it.

---

## 1. Where we actually are (verified 2026-08-11)

| Thing | Today |
|---|---|
| Charge type | Destination charge on the **Swellyo platform account** — `payments-checkout/index.ts:638` |
| `on_behalf_of` | **Never set.** 0 hits in the repo (one comment only) |
| Merchant of record | **Swellyo.** Card statement says Swellyo; refunds and chargebacks hit our balance |
| Issuing a refund | **Impossible in the product.** No `refunds.create` anywhere. Manual Stripe-dashboard action |
| Recording a refund | `stripe-webhook/index.ts:267` handles `charge.refunded` (cumulative-delta safe) |
| Disputes | **Not handled at all.** No `charge.dispute.*` case in the webhook |
| `reverse_transfer` | 0 hits |
| `debit_negative_balances` | 0 hits |
| Operator Agreement | Screen + DB columns exist; **the document does not** (`OperatorTermsSheet.tsx` says so itself) |
| Per-trip refund policy | ✅ **Built.** Frozen on the trip at publish (`20260811000100`, applied); shown on the Stripe page |
| Traveler consent to that policy | ✅ **Built + applied 2026-08-12** — our own tick before the Stripe session (§4d) |
| Traveler ToS acceptance | ✅ **Built + applied 2026-08-12** — versioned server record with IP + user-agent (§4c) |

Of Eyal's four documents, **three are done** (per-trip policy, per-trip consent, traveler ToS
record). One is a shell waiting on a lawyer: the Operator Agreement.

---

## 2. Three corrections to the model, from Stripe's own docs

These are not objections — the model stands. But the implementation has to absorb them.

### 2.1 `on_behalf_of` works on Express. It is one parameter.

The gate is **capability, not account type**:

> The `on_behalf_of` parameter is supported only for connected accounts with a payments capability
> such as `card_payments`. Accounts under the **recipient** service agreement can't request
> `card_payments`.

We request `card_payments` at account creation (`stripe-connect-onboard/index.ts:154`), so our
Express accounts qualify. The "`merchant` configuration" requirement applies only to accounts made
with the **Accounts v2 API**; we use v1 (`type: 'express'`). No account migration is needed.

### 2.2 `reverse_transfer` does not protect chargebacks — it is a refund-only parameter

> For destination charges, **with or without `on_behalf_of`**, Stripe debits dispute amounts and
> fees from your **platform** account.

So a chargeback always lands on Swellyo first, even after this whole project. Recovery is something
**we have to build**: listen for the dispute, then create a transfer reversal against the operator.
That is Phase 3 below, and it is not optional — without it the operator carries refunds but Swellyo
still eats every chargeback.

Stripe also confirms Eyal's "never 100%": with `on_behalf_of`, *"if a connected account's balance
becomes negative, your platform is ultimately responsible for covering any losses."*

### 2.3 `debit_negative_balances` only auto-debits in some countries

Auto-debit of a negative balance works for banks in **Australia, Canada, Europe/SEPA (incl. UK),
New Zealand, United States**. An operator banking anywhere else → no auto-debit → the contract is
the only recovery. Worth knowing before we sign operators outside that list.

### 2.4 What the comparables do with the commission on a refund — researched 2026-08-11

There are **two different fee models**, and they follow opposite rules. Which one we are decides
the answer.

**Model A — a service fee the *traveler* pays. Usually kept.**

| Platform | On traveler cancellation |
|---|---|
| **Airbnb** (guest service fee ~14%) | **Non-refundable** — *except* inside the free-cancellation window, or if the **host** cancels, or if the host voluntarily refunds in full. Italy and some South Korean bookings are always refundable |
| **Eventbrite** (ticketing fee) | **Non-refundable** by default; automatically refunded when the **event is cancelled or postponed**. Organizers may choose to eat the fee to give a full refund |

**Model B — a commission the *operator* pays. Follows the money he keeps.**

| Platform | Rule |
|---|---|
| **Booking.com** (~15%) | Commission is owed **only on what the property actually collects**. Cancelled with no fee charged → **no commission**. Charged a £50 cancellation fee → commission on that £50. Waive the fee → no commission |
| **GetYourGuide** (20–30%) | Supplier cancels for force majeure → full refund to the customer, **no cancellation fee**. On a **chargeback or failed payment, GetYourGuide receives no commission at all** |
| **Viator** (~20%) | Traveler-facing refund tiers (100% / 50%); commission rides on what remains |
| **WeTravel** — *the closest comparable to us: multi-day trips, operator sets the policy* | On a partial refund the traveler gets back the partial amount **plus a proportional refund of the WeTravel fee**. WeTravel reimburses its own fee. The **card processing fee is deducted from the organizer's balance** |

**Swellyo's 12% is Model B.** It is taken out of the operator's share as an
`application_fee_amount` — the operator pays it, not the traveler. So Booking.com's rule is ours:
**commission follows the money the operator keeps.**

Stripe gives this to us for free. Their docs: *"The application fee refund amount is proportional
to the payment refund amount. For example, an original payment of 100 USD with a 5 USD application
fee that you refund 40 USD (40%) refunds 2 USD of the application fee."*

So `refund_application_fee=true` **is** the industry rule, implemented as one boolean. Decided.

> **⚠️ Second-order finding — the Stripe processing fee is nobody's yet.**
> Stripe does **not** return its processing fee (~2.9% + 30¢) on a refund, and with destination
> charges that fee already came out of the **platform** balance. So on a refunded booking Swellyo
> is out the processing fee even after `reverse_transfer` + `refund_application_fee`.
> WeTravel's answer: **deduct the card processing fee from the organizer's balance.**
> **Recommendation: absorb it for now** — it is small in absolute terms and recovering it is a
> second transfer reversal to build. But put the reimbursement right in the **Operator Agreement**
> (§4b) so we can start collecting it later without renegotiating. Cheap to write now, expensive
> to add later.

---

## 3. Side effects of `on_behalf_of` — plan for these, they are visible

All documented, all real:

- The charge **settles in the operator's country and settlement currency**, and **their country's
  Stripe fee structure applies**. We price and charge in USD today (see
  `project_trip_display_currency`) — the money math has to be re-checked per operator country.
- The **operator's** statement descriptor, address and phone appear on the traveler's card
  statement. *This is the point of the change.*
- **The Stripe Checkout page uses the operator's branding, not Swellyo's.**
- Payout timing follows the operator's `delay_days`, not ours.
- Cross-border disputes: Stripe says wait until a dispute is **lost** before reversing the transfer
  — if you win, you may not be able to transfer the money back.

**Decision — branding: accept it.** Do not push Swellyo branding onto connected accounts. Stripe's
MoR rules require the payment flow to identify the seller, and the seller is the operator. A Stripe
page carrying Swellyo's logo while the receipt names the operator is exactly the confusion the rules
exist to prevent.

---

## 4. Phases

Phases 1–3 are independent of the legal documents and can start immediately. Phase 4 is blocked on
a lawyer.

### Phase 1 — Make the operator the settlement merchant

**✅ SHIPPED 2026-08-11. Migration APPLIED to prod, both functions DEPLOYED. Client uncommitted.**

> Deployed against a system where **no real money has ever moved** — all 5 rows in
> `organized_trip_payment_events` are `is_livemode = false`, first 2026-08-04, last 2026-08-07.
> That is why this went straight to prod rather than waiting: there is no live traffic to break.
> **It stops being true the moment Stripe is switched to live mode.**
>
> - `payments-checkout` **v16 → v17** (`verify_jwt: true`, unchanged)
> - `stripe-webhook` **v7 → v8** (`verify_jwt: false`, unchanged)
> - Migration applied via `execute_sql`; verified after: column `text`, CHECK present, 5 rows
>   backfilled to `'platform'`, 0 left NULL.

1. ✅ `'payment_intent_data[on_behalf_of]': host!.stripe_account_id` added next to
   `transfer_data[destination]` — `payments-checkout/index.ts:676`.
2. ✅ **Idempotency key bumped `m3` → `m4`** (`index.ts:623`). The file demands this whenever the
   create call changes: a key reused with different params is a **400, not a replay** — that
   mistake took the whole payment flow down once.
3. ✅ Gating **needed no new code.** `routeToOperator` (`index.ts:327`) already requires
   `stripe_account_id && charges_enabled`, and a **live** key with `routeToOperator === false`
   already returns a 400 to the traveler (`index.ts:341-353`). The platform fallback is
   test-key-only and cannot be reached with `sk_live_`. So `on_behalf_of` sits inside the one
   branch where the capability is guaranteed live.
4. ✅ `organized_trip_payment_events.settlement_merchant` — migration
   `20260811000300_payment_settlement_merchant.sql`. `stripe-webhook` sets it from
   `pi.on_behalf_of` on the PaymentIntent **it already fetches** for `application_fee_usd`, so no
   extra API call. NULL means the fetch failed = **unknown**, deliberately not `'platform'`.
   Existing rows backfilled to `'platform'` — provable, since `on_behalf_of` has never been sent.

**Deploy order** (migration first — the webhook writes the column):
```
1. apply 20260811000300 by hand in the SQL editor
2. deploy stripe-webhook       (writes the column; harmless before checkout changes)
3. deploy payments-checkout    (starts sending on_behalf_of)
```
⚠️ `payments-checkout` is `verify_jwt: true`; `stripe-webhook` must stay `--no-verify-jwt`.

**Acceptance — none of this is verified yet**
- [ ] A test-mode checkout on a connected account produces a PaymentIntent with `on_behalf_of` set.
- [ ] The Stripe receipt and Checkout page name the **operator**, not Swellyo.
- [ ] `organized_trip_payment_events.settlement_merchant` reads `'operator'` on that row.
- [ ] An operator with `charges_enabled = false` still gets the existing "still setting up
      payments" message, not a platform charge.

**⚠️ Risk to watch on first deploy.** If Stripe rejects `on_behalf_of` for a given account —
cross-region restriction, or `card_payments` not truly active despite `charges_enabled` — the
create call 400s and the traveler sees "Could not start the payment". That is the intended
fail-loud behaviour, but it means **a bad account breaks payments for that operator rather than
quietly falling back**. Run one test-mode trip per operator country before this goes near live
traffic.

---

### Phase 2 — The refund system (largest build — nothing exists today)

**2a + 2b SHIPPED 2026-08-11** — table applied to prod, `payments-refund` deployed (`verify_jwt:
true`), boot-checked.

**2c OPERATOR SIDE BUILT 2026-08-11 in BOTH clients, uncommitted, never run on a device.**
- Dashboard: `services/refunds.ts`, `components/RefundDialog.tsx`, wired into `TravelerPage`.
  tsc clean, 86 tests pass.
- App: `services/trips/refundsService.ts`, `components/trips/RefundSheet.tsx`, wired into
  `TravelerExtras` ← `TripDetailScreen`. App tsc unchanged at its 179-error baseline (zero new).
- ⚠️ The app sheet is rendered **inside** `DocumentReviewScreen`'s `renderOverlay` with `inline` —
  a sheet mounted as a **sibling** of a presented Modal resolves to the root view controller,
  which UIKit refuses, so it would only appear after the operator backs out of the traveler.
- ✅ **Traveler side built 2026-08-12.** "Refunded $X on 12 Aug" on the Plan tab's Payment card
  (`fetchMyRefunds` → `PaymentSection`). No DB change — RLS already let them read their own rows.
  - Reads `organized_trip_refunds` with `status = 'succeeded'`, **not** the `refunded` rows in
    `organized_trip_payment_events`. Same money, but only this table knows about the attempts
    that never moved any: a refund the balance guardrail blocked is a row here, and rendering it
    as "Refunded $500" would be a promise nobody kept.
  - The line exists because `paidUsd` is already NET of refunds — the ledger carries them as
    negative rows. Without it "Paid so far" simply drops by $500 one day with no explanation.
  - ⚠️ **Known consequence, not fixed:** a refund puts money back on the clock, so `payTarget`
    returns and the traveler sees "Pay now" again. Correct for a partial goodwill refund, wrong
    for someone who cancelled — and nothing in the data distinguishes the two. Deciding that
    needs a "this traveler has left the trip" state, which is a separate piece of work.

Two things came out of the build that were not in the original plan:

- **Who may refund was already answered by the data, not by a new decision.** The capability is
  **`money.manage`**, and querying `organized_trip_staff_roles` shows only tier 5 (**Operator**)
  holds it. Manager (tier 4) has `payments.view_status` — see the money, don't move it. The
  function calls the existing `trip_staff_can(trip_id, 'money.manage')` rather than
  reimplementing tier logic.
- **⚠️ The guardrail had a currency trap, a direct consequence of Phase 1.** After `on_behalf_of`,
  a charge settles in the **operator's** settlement currency, which need not be the charge
  currency. Comparing USD cents against an ILS balance is arithmetic on two different units — a
  guardrail that silently passes. **Fixed properly in 2d below.**

#### 2d. Ask Stripe what the refund actually costs the operator

**The wrong question.** "Is the operator's USD balance ≥ the USD refund?" There may be no USD
balance at all, and then the only honest answers are *refuse every refund for that operator* or
*invent an exchange rate*. Both are bad.

**The right question.** "How much will Stripe take out of the operator's balance, in whatever
currency that balance is in?" Stripe already knows this number — we just have to ask.

**The chain.** For a destination charge, the money reaches the operator as a Charge **on their own
account**, and that charge's balance transaction is denominated in **their** currency:

```
charge.transfer            → Transfer          (platform side)
transfer.destination_payment → Charge          (ON the connected account)
  ?expand[]=balance_transaction                 (read with Stripe-Account: acct_…)
    → { amount, currency }  ← exactly what landed, in the operator's currency
```

Refunding R of a charge worth C reverses the fraction `R / C` of that transfer. So:

```
cost_to_operator = ceil(landed_amount × R / C)     // in the operator's currency
```

`ceil`, never `floor`: rounding down could let a refund through that leaves the balance a unit
short, which is the one outcome the guardrail exists to prevent.

Then compare against the `available` entry **in that same currency**. No FX invented, no refusal
needed, and it is correct for a US operator settling in USD as a special case rather than as the
only case it handles.

**Refuse only when the chain cannot be read** — a missing transfer, destination payment or balance
transaction means we genuinely do not know, and an unverifiable refund must not proceed.

**Money is formatted in the operator's own currency**, with the right number of decimals taken from
`Intl.NumberFormat(...).resolvedOptions().maximumFractionDigits`. Dividing by 100 is wrong for
zero-decimal currencies like JPY and KRW, and Stripe amounts are always in the smallest unit.

**⚠️ Known and intended:** the check reads `available`, not `pending`. A payment that has not
settled yet cannot fund a refund, so a same-week refund can legitimately be refused. That is Eyal's
rule working, not a bug — but it is the most likely support question, so the message says the
numbers out loud.

#### 2a. Schema

New table `organized_trip_refunds` — our own intent + audit record. `organized_trip_payment_events`
stays what it is: a mirror of Stripe. Do not overload it.

```
id                  uuid pk
trip_id             uuid not null → group_trips
user_id             uuid not null → auth.users     -- the traveler being refunded
requested_by        uuid not null → auth.users     -- who pressed the button
payment_event_id    uuid → organized_trip_payment_events  -- the 'paid' row being reversed
provider_charge_id  text not null
amount_usd          numeric not null
reason              text
policy_snapshot     jsonb    -- the frozen trip policy as it read at refund time
status              text check (status in ('pending','succeeded','failed','blocked_insufficient_balance'))
stripe_refund_id    text
created_at          timestamptz not null default now()
```

RLS: operator + permitted staff read/insert for their own trips; the traveler reads their own rows.

#### 2b. Edge function `payments-refund`

Order of operations matters — the balance check must come **before** the Stripe call.

1. **Auth.** Operator of the trip, or staff with the right permission (reuse the existing 5-tier
   permission data — see `project_operator_staff_permissions`). Never the traveler.
2. **Guardrail (Eyal's point 6).** `GET /v1/balance` with the `Stripe-Account` header for the
   connected account. If **available balance < refund amount**, write a
   `blocked_insufficient_balance` row and return a clear error. Do not call Stripe.
3. **Refund.**
   ```
   POST /v1/refunds
     charge={charge_id}
     amount={cents}                  -- omit for full
     reverse_transfer=true           -- Eyal's point 5: pulled from the operator
     refund_application_fee=true     -- see decision below
   ```
   Idempotency key per refund row id.
4. **Do not insert a `refunded` payment event here.** `stripe-webhook` already does it, with
   cumulative-delta handling (`index.ts:293-312`). Doing both double-counts. The refund function
   writes only to `organized_trip_refunds`.

> **✅ DECIDED 2026-08-11 — `refund_application_fee=true`, always.**
> Researched against the comparables (§2.4). The rule the industry uses is **commission follows
> the money the operator keeps**. Stripe implements it natively: with the flag on, a partial refund
> refunds a **proportional** share of the application fee. So:
> - Full refund → operator keeps $0 → Swellyo takes **$0**.
> - Policy keeps 50% → operator keeps 50% → Swellyo takes **12% of that 50%**.
>
> That is Booking.com's rule exactly, for one boolean. See §2.4 for why.

#### 2c. Client

- **Operator dashboard** (`operator-dashboard/`): refund button per paid traveler, amount +
  reason, a confirm step that shows the frozen policy, and refund history.
  ⚠️ Rule 1 of `operator-dashboard/docs/SPEC.md` — it adds nothing to the DB. The table and RLS
  above come from the app side; the dashboard only reads and calls the edge function.
- **App:** the same action for operators working from the phone, plus the traveler seeing
  "Refunded $X on <date>" on the Plan tab.
- **Blocked state:** when the guardrail trips, the operator must see *why* — "Your Stripe balance
  is $X, this refund needs $Y" — not a generic failure.

**Acceptance**
- Refund pulls from the operator's balance (verify the transfer reversal in the Stripe dashboard).
- A refund larger than the operator's available balance is refused with no Stripe call made.
- The webhook records exactly one `refunded` event.
- Two rapid clicks produce one refund (idempotency).

---

### Phase 3 — Chargeback recovery

> ## ⏸️ DEFERRED 2026-08-12 by Ohad. Read this box before going live with Stripe.
>
> **Deferring costs nothing today and everything later.** Right now no real money has moved
> (`is_livemode = false` on every payment row), so there are no chargebacks to lose. **The day
> Stripe switches to live mode, this becomes the single largest uncovered risk in the product.**
>
> **A refund and a chargeback are not the same thing.** A refund is the operator *choosing* to give
> money back — Phase 2 handles it, and `reverse_transfer` takes it from his balance. A chargeback is
> the traveler phoning **their own bank**, which takes the money back by force. Nobody asks the
> operator. Nobody asks us.
>
> **`on_behalf_of` did NOT fix this, and that is the counter-intuitive part.** Stripe, verbatim:
> *"For destination charges, **with or without `on_behalf_of`**, Stripe debits dispute amounts and
> fees from your platform account."* Phase 1 made the operator the legal seller — his name is on
> the card statement, he owns the refund decision — **but a chargeback still hits Swellyo's
> balance.** The flag moved the responsibility, not the money.
>
> On a $1,000 trip:
>
> | | Swellyo | Operator |
> |---|---|---|
> | Traveler pays $1,000 | +$120 (12%) | +$880 |
> | Traveler disputes it with their bank | **−$1,000**, plus Stripe's dispute fee | $880, untouched |
> | **Net** | **≈ −$895** | **+$880** |
>
> Today the webhook has **no `charge.dispute.*` case at all** — we would not even know it happened.

Without this, the operator carries refunds and Swellyo still carries every chargeback.

1. **Migration:** `organized_trip_payment_events.event_type` currently CHECKs
   `('paid','refunded','failed')`. Add `'disputed'` and `'dispute_lost'`.
2. **`stripe-webhook`:** handle `charge.dispute.created` (record + notify the operator, with the
   evidence they need to fight it) and `charge.dispute.closed`.
3. **On `dispute.closed` with status `lost`:** create a transfer reversal to pull the amount from
   the operator.
   ⚠️ **Wait for the loss — do not reverse on `created`** for cross-border charges. Stripe warns
   that if you win, cross-border restrictions may leave you unable to transfer it back.
4. **Set `debit_negative_balances = true`** on the connected account's balance settings, at account
   creation in `stripe-connect-onboard`. Note the country list in §2.3.
5. **Check `controller.losses.payments`** on a live connected account (`stripe` or `application`) —
   it says who Stripe holds responsible for a negative balance. We never set it. Read it before
   assuming.

**Acceptance:** a test-mode dispute lost → the amount is pulled from the operator, and the payment
events table shows the trail.

**⚠️ The hole that stays open even after Phase 3.** Auto-debit of a negative balance only works for
banks in **Australia, Canada, Europe/SEPA (incl. UK), New Zealand and the US**. An operator banking
anywhere else, with an empty Stripe balance, cannot be debited at all — the **Operator Agreement**
(§4b) is then the only claim we have. That is a concrete reason the reimbursement clause must be in
the contract before we sign an operator outside that list, not after.

**Go-live trigger.** Do not flip `app.stripe_livemode` / `EXPO_PUBLIC_STRIPE_LIVEMODE` /
`VITE_STRIPE_LIVEMODE` without either building this phase or making a deliberate, written decision
to accept the loss on early live trips.

---

### Phase 4 — The four documents

**Blocked on a lawyer for the wording. The plumbing can be built first.**

#### 4a. Stripe Connected Account Agreement
Already happens automatically during Connect onboarding. **Nothing to build.**

#### 4b. Swellyo Operator Agreement — the key one

The screen and columns exist (`OperatorTermsSheet.tsx`, `operator_settings.terms_accepted_at` +
`terms_version`, migration `20260811000200`, applied). What is missing is the text.

Must say, at minimum:
- The operator is the **seller and merchant of record**.
- He **reimburses Swellyo** for any refund or chargeback we end up funding.
- The **12% commission** — today it lives only as `commission_bps` in the database and in no
  document.
- Insurance and licence warranties; indemnity.

When the text exists: drop it into `TERMS_BODY`, bump `OPERATOR_TERMS_VERSION` — every operator on
the old version gets an unfinished setup step automatically. That mechanism is already built.

It also needs a **public URL**, because Phase 4d depends on one.

#### 4c. Traveler ToS — move acceptance to the server

**✅ BUILT 2026-08-12. Migration `20260812000100_consent_records.sql` APPLIED to prod (both
sections, verified). Client uncommitted, never run on a device.**

`WelcomeScreen.tsx` kept `agreedToTerms` in `AsyncStorage`. A reinstall erased the proof.

Built on the waiver's machinery, as this section asked: versioned, IP + user-agent captured
SERVER-side from `request.headers`, write only through a `security definer` RPC so the client
cannot forge either field.

- Table `user_terms_acceptances` (ledger) + RPC `record_terms_acceptance(version, url, agreed_at)`.
- Client: `services/terms/termsService.ts`. `setTermsAgreed(true|false)` on the tick,
  `syncPendingTermsAcceptance()` from `AppContent` once a session is validated. Unticking now
  clears the parked record — the old code only ever wrote `true`, and a withdrawn agreement must
  not survive as evidence.

Three decisions worth knowing:

1. **A ledger, not two columns on `surfers`.** §8 of `agreements-and-terms.md` proposed
   `terms_accepted_at` + `terms_version`, mirroring `operator_settings`. Two columns hold one
   acceptance; the question this data answers is *which versions has this person accepted, from
   where, when* — the history is the evidence.
2. **The tick happens before there is a user**, so it cannot be one call. It is parked on the
   device and sent once a session exists — on every boot until it lands, because sign-in on web is
   a full page redirect and the screen that took the tick is gone by then.
3. **The legacy `agreedToTerms` flag is NEVER converted into a row.** It is device-wide, and
   `WelcomeScreen` hides the checkbox entirely once it is set — so on a phone where somebody has
   already signed up, the next person through never sees the box. Turning that flag into a record
   would file a consent for a user who was never asked. Existing users get a row the next time
   `PLATFORM_TERMS_VERSION` changes and they are asked again for real.

⚠️ `agreed_at` (client-claimed, clamped to now()) is kept separate from `recorded_at`
(server-witnessed). NULL `agreed_at` means "we do not know when" and must stay NULL — note that
`least(null, now())` returns **now()** in Postgres, so the obvious one-liner would have silently
turned "unknown" into "just now".

#### 4d. Traveler consent at checkout — a real recorded tick

**✅ BUILT 2026-08-12. Same migration as 4c — APPLIED. Client uncommitted.**

- Table `organized_trip_policy_consents` + RPC `record_trip_policy_consent(trip_id, shown_text)`.
  The RPC re-reads the trip's frozen policy itself, snapshots it, and hashes the shown text
  server-side. A hash or an IP accepted from the party you may later be arguing with proves
  nothing.
- `services/trips/tripPolicyConsent.ts` — `consentCopy()` builds the words, `consentText()` joins
  the same fields. `TripPolicyConsentSheet` renders `consentCopy()`. That is the only reason the
  stored row can be trusted to be what was on screen.
- `hooks/useTripPolicyConsent.ts` — one `await consent.ensureConsent()` in front of **every**
  checkout entry point: `TravelerOnboardingScreen`'s deposit and `TripDetailScreen`'s task row,
  "Pay now" and partial-payment sheet. That was the trap this section flagged, and it is why the
  gate is a hook rather than a sheet each screen wires up its own way.
- **Asked once per trip per policy**, matched on the exact text — not on every payment. This is
  the step people abandon; asking twice for the same agreement buys no extra evidence.

> **⚠️ IT FAILS OPEN.** If the policy cannot be read, or the consent cannot be written, the
> payment proceeds. A missing audit row is our problem; a traveler who cannot pay because our
> evidence table is unreachable would be carrying it for us. It also means shipping this client
> before the migration is applied does not take payments down — which, with migrations applied by
> hand, is a real ordering.
>
> **The follow-up that closes it: refuse in `payments-checkout` when the trip has a policy and no
> consent row exists.** Deliberately NOT done now — older builds in the field record nothing, and
> a server gate today would break payments for every one of them. Turn it on once the shipped
> builds all carry this.

> **Design note that matters:** Stripe's `consent_collection[terms_of_service]` points at **one
> global terms URL** set in the Dashboard. It **cannot** show the per-trip policy, and it was
> already rejected once for lack of a hosted URL (see `project_trip_cancellation_freeze`).

So there are two different ticks, and they are not the same tick:

- **Per-trip policy → our own checkbox, in the app, before we create the Checkout Session.** The
  traveler sees the few sentences of the frozen trip policy and ticks. We record it — trip id,
  user id, the frozen policy text, its hash, timestamp, IP, user-agent — then create the session.
  This is the evidence that wins a chargeback, so it has to be ours, not Stripe's.
- **Standing traveler ToS → Stripe's `consent_collection`,** once 4c gives us a hosted URL.

⚠️ **Where the tick has to live:** a deposit **never** opens `PayAmountSheet` — the app goes
straight to Checkout (`project_trip_cancellation_freeze`). So the checkbox belongs on the screen
that starts the deposit, not only in the balance sheet, or the first and largest payment escapes it.

⚠️ **Settled 2026-08-12: no tick for a trip with no policy.** `cancellation_preset IS NULL` means
*not specified*, and the RPC refuses to record a consent against it — a row agreeing to an empty
policy would read like proof of terms that never existed. Of the 23 existing operator trips, **22
are still NULL and 1 now carries a policy** (checked live 2026-08-12), so the tick has exactly one
trip to appear on today.

---

## 5. Order of work

```
Phase 1 (on_behalf_of)  ─┐  ✅ shipped 2026-08-11
Phase 2 (refunds)       ─┼─ ✅ shipped 2026-08-11 (+ traveler refund line, 2026-08-12)
Phase 3 (chargebacks)   ─┘  ⏸️ deferred — read the box in §Phase 3 before going live
Phase 4c (server ToS)   ─┘  ✅ shipped 2026-08-12 (migration applied)
Phase 4d (per-trip tick)     ✅ shipped 2026-08-12 (migration applied)

lawyer writes Operator Agreement + Traveler ToS
        ↓
Phase 4b (terms text + version bump)
Stripe `consent_collection` for the STANDING ToS (needs the hosted URL)
Server-side enforcement of 4d in payments-checkout (needs the shipped builds first)
```

**Nothing is left to apply.** `20260812000100_consent_records.sql` went to prod on 2026-08-12,
verified after: both tables RLS-on with SELECT-only for `authenticated`, both RPCs
`security definer` with a pinned `search_path` and EXECUTE revoked from `anon`. Exercised
end-to-end inside a rolled-back transaction with a real member of the one policy-carrying trip —
IP and user-agent captured from headers, a device clock 3 days fast clamped to `now()`, a repeat
call returning the same row, an unknown `agreed_at` staying NULL, and the stored hash matching
`sha256(shown_text)`. All four refusals fire: stranger to the trip, trip with a NULL policy, empty
text, signed out. Both tables were empty again afterwards.

Phase 2 was the biggest and the one with the most product surface. Phase 1 was the smallest and
had the largest legal effect.

---

## 6. Decisions

1. ✅ **`refund_application_fee=true`** — commission follows the money the operator keeps. Decided
   2026-08-11 on the research in §2.4.
2. ✅ **Stripe Checkout will show the operator's branding**, not Swellyo's. Approved 2026-08-11.
3. ⏳ **Parked — raise before Phase 3.** Read `controller.losses.payments` from a live connected
   account to confirm who Stripe holds responsible for a negative balance. Ohad to pick the account.
4. ⏳ **Open — the Stripe processing fee on a refund.** Absorb it, or recover it from the operator
   like WeTravel does? Recommendation: absorb now, but write the right to recover into the Operator
   Agreement. §2.4.

Not decisions, they fall out during the build: who else may press Refund besides the operator, and
what the traveler is told when the guardrail blocks a refund the policy entitles them to.

---

## 7. Questions only a lawyer answers

Carried over from `agreements-and-terms.md` §7, still open and now more urgent because the operator
is being named as the seller:

- **EU Package Travel Directive 2015/2302** — accommodation + lessons sold for one price is a
  *package*. The organiser is liable for the whole trip and must carry insolvency protection.
  Naming the operator as seller may move this onto him — or may not, if we look like the organiser.
- **US seller-of-travel registration** (CA, FL, HI, WA) — triggered by where the *traveler* lives,
  not where we are.
- Whether the Operator Agreement's reimbursement clause is enforceable in the operator's own
  country, which is where we would have to chase him.
