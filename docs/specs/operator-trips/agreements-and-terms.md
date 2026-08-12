# Agreements — who has to accept what

**Status:** research note, 2026-08-11. **Not legal advice** — a checklist to hand a lawyer.
**Why:** operator trips (type C) now take real money from real travelers. Three parties are
involved — Swellyo, the operator, the traveler — and today only one of the three contracts
between them actually exists.
**Related:** `waiver-legal-record.md` (the waiver record we already keep well),
`traveler-onboarding.md`, `partial-payments.md`.

---

## 1. The fact that decides everything: **we are the merchant of record**

`payments-checkout/index.ts` builds a **destination charge**:

```
payment_intent_data[transfer_data][destination] = <operator's connected account>
payment_intent_data[application_fee_amount]     = commission (default 12%)
```

The charge is created on the **platform** account. `on_behalf_of` is **never set** —
zero hits in the file. Stripe's own documentation is blunt about what that means:

> With destination charges, **the platform is the merchant of record**. The platform's
> account balance gets debited for the cost of Stripe fees, refunds, and chargebacks.

> The customer-facing website, payment flow, **and terms of service must clearly identify
> the party that is the merchant of record**.

So, today:

| | Reality |
|---|---|
| Whose name is on the traveler's card statement | **Swellyo** |
| Who the card networks think sold the trip | **Swellyo** |
| Who pays a chargeback | **Swellyo**, out of our balance |
| Who pays a refund | **Swellyo**, out of our balance — and the operator has usually already been paid |
| Where our terms say any of this | **Nowhere. We have no terms about payments at all.** |

This is the single biggest finding in this note, and it is not a legal opinion — it is what
the code does.

**It also makes us different from every company below.** Booking, JoinMyTrip and WeTravel are
all careful to be an *intermediary* — the traveler's contract is with the supplier, and the
platform is "not a party". Our payment integration quietly put us in the opposite position.

### Two ways forward

**(a) Stay merchant of record.** Then we must write the terms for it: our own refund and
cancellation policy, our own dispute handling, our name disclosed at checkout. We carry the
risk, and we probably need the licences in §5.

**(b) Move merchant of record to the operator.** Add `on_behalf_of = <connected account>` to
the PaymentIntent. Chargeback liability and the statement descriptor move to the operator, and
we become the intermediary the comparables are. This is a small code change with a large legal
effect — and Stripe requires the connected account to have the **merchant** configuration, not
only **recipient**, so it is not a one-line edit.

> This is a decision for Ohad + a lawyer, not a build task. Everything else in this note
> depends on it.

---

## 2. Where we stand today — verified, not assumed

| Agreement | Who accepts | Where it is recorded | Status |
|---|---|---|---|
| Swellyo Terms + Privacy | every user at signup | `WelcomeScreen.tsx` checkbox → **`AsyncStorage` only** | ⚠️ **No server record.** Reinstall the app and the proof is gone. We cannot show who agreed to what, or when |
| Swellyo ↔ **operator** agreement | — | — | ❌ **Does not exist.** `operatorSetupSteps()` has 4 steps: Stripe, currency, cancellation policy, waiver. None of them is "agree to Swellyo's operator terms" |
| Operator ↔ **Stripe** | operator | Stripe Express onboarding | ✅ Stripe presents its Connected Account Agreement itself. This is the **only** signed operator contract we have — and it is not with us |
| Trip **waiver** | traveler | `group_trip_acknowledgements` | ✅ **Strong.** Versioned document, SHA-256 hash, server-captured IP + user-agent, `consent_electronic`, name typed at agree time. See `waiver-legal-record.md` |
| **Medical form** | traveler | `organized_trip_medical_forms` | ✅ Collected (a disclosure, not an agreement) |
| **Cancellation policy** | — | `operator_settings` **default only** | ⚠️ **Never reaches the traveler.** `group_trips` has no policy column. The only readers are `SettingsScreen`, `OperatorSetupScreen`, `CancellationPolicySheet` — all operator-side |
| **Staff role** | staff member | `organized_trip_staff_invites.accepted_at` | ✅ Recorded, but the invite carries no duties or confidentiality text — and staff can see passports |
| **Refunds** | — | `stripe-webhook` records `charge.refunded` | ⚠️ **Read-only.** There is no way to issue a refund from the product. It must be done by hand in the Stripe dashboard, and the money comes off our balance |

**Read that table as one sentence:** the traveler signs a well-built waiver for the operator,
and nothing else in the money chain is papered at all.

---

## 3. What each side should have to accept

There are **three** contracts, not one. Today we have half of one.

### A. Swellyo ↔ every user — *"platform terms"*

Exists as text on swellyo.com, but acceptance is not recorded server-side.

- Use of the app, account rules, age (18+ is already gated)
- Privacy and what we store — **including passports**, which is sensitive-category data
- **Who we are in a transaction** — required by Stripe today (§1)
- Content rules, suspension, governing law

**Fix:** one column. `surfers.terms_accepted_at` + `terms_version`, written server-side at
signup. The version matters — the same reason `group_trip_acknowledgements` stores
`agreed_version`.

### B. Swellyo ↔ operator — *the missing one*

The operator takes money from strangers through our checkout, sees their passports, and runs a
physical trip where people can get hurt. Right now they agree to nothing with us.

Clauses worth having, in rough priority:

1. **They are the seller.** The trip is theirs, they perform it, they set the price.
2. **Licences and permits** — they warrant they hold whatever their country requires
   (tour operator licence, surf-instruction certification, boat permits).
3. **Insurance** — public liability at a stated minimum, and proof on request. Airbnb makes
   this explicit for Experience hosts; it is the standard clause in this industry.
4. **Indemnity** — if a traveler sues us for something the operator did, they cover us.
5. **Cancellation and refund duty** — what happens when *they* cancel. Today nothing forces
   them to give money back, and the money already left our balance.
6. **Chargebacks** — while we are MoR (§1), say plainly who eats one. Without this clause a
   traveler chargeback is simply our loss.
7. **Traveler data** — passports and medical answers are for running the trip only. No
   marketing, no export, delete on request. Ties to the existing purge job.
8. **Commission** — 12% is in the database (`commission_bps default 1200`) and in no document.
9. **Suspension** — when we can pull a trip down.
10. **Sanctions / fraud / who they may not be.**

**Fix:** a 5th step in `operatorSetupSteps()` — "Agree to the operator terms" — recorded the
same way the waiver is: versioned text, hash, timestamp, IP. We already own that machinery;
it would be reuse, not new work.

### C. Operator ↔ traveler — *partly built*

| Piece | Today |
|---|---|
| Waiver | ✅ Built, and built well |
| Medical disclosure | ✅ Built |
| What the price includes | ⚠️ `price_inclusions` exists but is not part of anything the traveler agrees to |
| **Cancellation policy** | ❌ **The big hole.** The operator picks one in Settings and the traveler never sees it — not before paying, not after |
| Trip terms as a whole | ❌ There is no single "these are the terms of this trip" document the traveler accepts |

**Fix, in order:**

1. **Freeze the policy onto the trip at publish.** `group_trips.cancellation_preset` +
   `cancellation_rules`, copied at publish, never read live from `operator_settings`. The
   migration header already says this: *a default changed in March must not rewrite terms
   someone agreed to in January.*
2. **Show it before the money.** On `PayAmountSheet` and the Payment section, above the button.
3. **Record acceptance at first payment**, in the same shape as the waiver row.

---

## 4. How the others do it

| | Legal role | Traveler's contract is with | Who holds the money | Cancellation rules | What the supplier must warrant |
|---|---|---|---|---|---|
| **Booking.com** | Intermediary. *"When you make a booking, it's directly with the Service Provider — we're not a contractual party"* | The property / service provider | Varies; often the property charges directly | **Set by the provider.** Booking says it *"doesn't influence and isn't responsible for"* them | Partner agreement, separate from traveler terms |
| **JoinMyTrip** | Intermediary. *"serves solely as a platform connecting TripLeaders and TripMates"* and *"is not a party to the contractual relationship between them"* | The TripLeader | Stripe; JoinMyTrip support issues refunds | **Platform-set defaults**, accepted by both sides at booking: 7-day free window, nothing inside 30 days, TripLeader may keep up to 10% (max €200) | Pro TripLeader terms: publish within 5 weeks, no undercutting, no price gouging, 3% payment fee. **No licence or insurance clause** — a real weakness in their contract, not a model to copy |
| **WeTravel** | *"Agent of the Payee"* — deliberately the payee's agent, so they are not a money transmitter. *"any agreement between the organizer and traveler is between them alone and WeTravel is not a party"* | The organizer | **WeTravel holds it**, in segregated ledgered accounts, until the organizer requests payout | Organizer sets them | Organizer terms, plus their own KYC |
| **Airbnb Experiences** | Intermediary, but with the strongest traveler-side paper | The host | Airbnb | Airbnb-set, standardised | **The model to copy:** host must hold liability insurance *"with limits appropriate and customary"*, primary coverage, plus motor-vehicle cover where relevant, and must **prove it on request**. Airbnb also carries $1M Experiences Liability Insurance |
| **Swellyo today** | **Merchant of record** (by accident of the Stripe integration) | Unclear — nothing says | Stripe → straight to the operator, minus 12% | Operator picks one, **traveler never sees it** | **Nothing** |

**The pattern:** every one of them says in writing "we are not the seller", and every one of
them makes the supplier sign something. We do neither.

**Airbnb's guest waiver is also worth copying in shape** — it releases *both* the host **and**
Airbnb, covers assumption of risk and fitness to participate, has a minor/guardian clause, and
explicitly **does not apply to EEA, UK, Swiss or Australian residents** (because you cannot
waive those rights there). Our waiver releases the operator. It should probably release us too,
with the same geographic carve-out.

---

## 5. The regulated part we cannot wave away

**EU Package Travel Directive (2015/2302).** If a trip combines **two or more** travel services
— accommodation + transport, or accommodation + a surf course sold as a significant part — for
one price, it is a **package**. Then:

- The **organiser is liable for every service in the package**, whoever actually performs it.
- The organiser must hold **insolvency protection** — security to refund travelers and
  repatriate them if the organiser goes under.
- **Organisers not established in the EU who sell into the EU must provide that security under
  that member state's law.** An Israeli operator selling to a German traveler is in scope.

A surf trip with accommodation + lessons is a package under any reading. The open question is
**who counts as the organiser — the operator, or us**, given that we take the money and our
name is on the statement.

**US seller-of-travel laws.** California, Florida, Hawaii and Washington require registration
to sell travel **to residents of those states, regardless of where you are based**, usually
with a trust account or surety bond. We take traveler money weeks or months before departure.
That is exactly the behaviour these laws exist to regulate.

**Money handling.** WeTravel's "Agent of the Payee" wording is not decoration — it is how they
stay outside money-transmitter licensing. Our destination-charge setup does not hold funds
(Stripe transfers straight through), which helps, but it is worth confirming.

---

## 6. Gaps, ranked

| # | Gap | Why it is where it is on the list |
|---|---|---|
| 1 | **Merchant of record is us, and undisclosed** | Stripe requires the disclosure. Every chargeback is our money. Decide (a) or (b) in §1 before building anything else here |
| 2 | **No Swellyo ↔ operator agreement** | No insurance, no licence warranty, no indemnity, no refund duty. One bad trip and there is nothing between us and the claim |
| 3 | **Cancellation policy never reaches the traveler** | Money changes hands with no stated refund rule. This is the most likely first dispute, and the easiest to fix |
| 4 | **Terms acceptance is device-only** | `AsyncStorage`, so we cannot prove any user accepted anything. Reinstalling erases it |
| 5 | **No refund path in product** | Every refund is a manual Stripe dashboard action, off our balance, with the operator already paid |
| 6 | **Waiver does not release Swellyo** | It protects the operator. We are the one with the deep pockets and our name on the charge |
| 7 | **Staff see passports with no confidentiality terms** | Five staff tiers exist; none of them agrees to anything about the data they can open |
| 8 | **Package Travel / seller-of-travel exposure unassessed** | Not urgent at current volume. Becomes urgent with EU or California travelers |

---

## 7. Questions only a lawyer answers

1. Do we stay merchant of record, or move it to the operator with `on_behalf_of`?
2. Under the Package Travel Directive, is **Swellyo** an organiser, a retailer, or neither?
3. Which jurisdiction governs — we are in Israel, operators may be anywhere, travelers are
   often EU.
4. Can our waiver release Swellyo as well as the operator, and where does that fail (EEA, UK,
   Switzerland, Australia — Airbnb's own carve-out)?
5. Do we need seller-of-travel registration or a bond for US travelers?
6. What must the operator insurance minimum be, and do we verify it or just warrant it?
7. Is 18+ enough, or do we need a guardian clause for minors travelling with a parent?

---

## 8. What I would build first, once §1 is decided

Cheap, and none of it needs a lawyer to *start*:

1. **`surfers.terms_accepted_at` + `terms_version`**, written server-side at signup. One column,
   closes gap 4.
2. **Freeze the cancellation policy onto `group_trips` at publish**, and show it above the Pay
   button. Closes gap 3 — and the migration header already asked for it.
3. **A 5th operator setup step: "Agree to the operator terms."** Reuses the waiver machinery
   exactly — versioned text, hash, IP, timestamp. Closes gap 2 once the text exists.

Gaps 1, 6, 7 and 8 need the lawyer's answers first.
