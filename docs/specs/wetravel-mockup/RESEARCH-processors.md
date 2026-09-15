# Who actually moves WeTravel's money

Read directly from `https://www.wetravel.com/terms` (Terms of Service, last
updated **1 December 2025**) in a browser. The page returns HTTP 403 to
automated fetchers but loads normally in Chrome, which is why second-hand
summaries of it circulate and are incomplete.

## Stripe is not the only processor

The clause everyone quotes is usually truncated. In full, WeTravel names
**three** payment providers plus a card issuer and a hotel vendor.

**1. Stripe** — general payment processing
> "Payment processing services for Wetravel are **among others** provided by
> Stripe, Inc. and Stripe Payments Europe, Ltd. ("Stripe") and are subject to
> the Stripe Connected Account Agreement, which includes the Stripe Terms of
> Service."

The words *"among others"* are load-bearing and are dropped by every summary I
found. They are there because of the next two.

**2. Airwallex** — also general payment processing
> "Payment processing services for WeTravel **may also be provided by Airwallex
> US, LLC and Airwallex (Netherlands) B.V.** ("Airwallex") and are subject to
> the applicable Airwallex Terms of Service."

**3. Corpay (a Fleetcor company)** — cross-border specifically
> "**Cross-border payments may further be provided by Corpay (a Fleetcor
> company)** … Corpay, as part of Fleetcor Technologies, specializes in
> facilitating international business payments, supplier settlements, and
> currency exchange. Cross-border transactions processed by Corpay may involve
> compliance with international payment regulations, foreign exchange
> adjustments, and banking network fees that vary by jurisdiction. **Such
> charges are assessed directly by Corpay (Fleetcor) and its** [partners]…"

**4. Celtic Bank** — issues the WeTravel Visa Commercial card, "powered by
Stripe" (`product.wetravel.com/wetravel-card`).

**5. Persona** — identity and business verification (KYC), named in
`help.wetravel.com/en/articles/1619345`.

**6. Nuitée Travel Limited** — powers hotel booking via
`hotels.wetravelsites.com`. Terms are explicit that the booking is with Nuitée,
**not** with WeTravel.

> **Negative finding:** the Privacy Policy at `wetravel.com/privacy` contains no
> sub-processor list and names none of these vendors. The Terms are the only
> vendor disclosure.

## The FX margin is discretionary by design

There is **no percentage anywhere in the Terms** — I searched the full 83,000
characters and found zero `%` figures. What the Terms do say about exchange
rates is the mechanism:

> "Wetravel updates the **base exchange rate** on a regular basis, but **not on
> a real-time basis**. In particular, Wetravel **does not always change the base
> exchange rate immediately when its costs of foreign exchange change.**
> Accordingly, the base exchange rate **may not be identical to the applicable
> market rate** in effect at the specific time a foreign currency conversion is
> processed."

In plain terms: WeTravel sets its own rate, refreshes it when it chooses, and
keeps the gap between that rate and its actual cost. The Terms reserve the right
to do this without ever quoting a spread. That is consistent with the operator
who measured **€250 of hidden FX cost on a transfer whose stated fee was €41**
(Trustpilot, Apr 2025).

Conversion is triggered in four situations, per the Terms: display currency ≠
listing currency; booking currency ≠ listing currency; **payout currency ≠
listing currency**; and when a booking that involved a conversion is modified or
cancelled.

## Holds — the thing operators actually fear, in WeTravel's own words

> "WeTravel reviews many factors before placing a hold on a payment, including:
> fraud warnings on recent payments, **account tenure**, overall transaction
> activity, **business type**, past customer disputes, and overall customer
> satisfaction."

> "Risk-based holds … generally remain in place for **up to 30 days** from the
> date the payment was received … The hold may last **longer than 30 days** if
> the payment is deemed fraudulent and/or results in a disputed transaction or
> chargeback. In this case, we'll hold the payment … **until the matter is
> resolved (but no longer than 180 days).**"

And on the downside risk:

> "**We reserve the right to debit your connected bank account** in the event
> that your WeTravel account balance becomes negative. This happens when
> disputes are more than the balance in your account."

> "The Trip Organizer is **fully liable to WeTravel for the full amount of all
> disputes or chargebacks** received from payments from Travellers (including
> any relevant costs and fines)."

Also: **"The Service Fee is always non-refundable."**

## The clause that matters most — verified 25 Aug 2026

Under **"Suspension, Termination and Wetravel Account Deletion"**, read directly
in Chrome:

> "We may, **in our discretion and without liability to you, with or without
> cause, with or without prior notice and at any time**, decide to limit,
> suspend, deactivate or delete your Wetravel Account. If we exercise our
> discretion … any or all of the following can occur **with or without prior
> notice or explanation to you**: (a) your Wetravel Account will be deactivated
> or suspended … (b) any pending or accepted future bookings … will be
> immediately terminated, **(c) we may temporarily place a hold on your account
> equivalent to total payments for upcoming and future trips, expected amount of
> refunds, or potential chargeback amounts** … (e) we may refund your Travelers
> in full for any and all confirmed reservations, **irrespective of preexisting
> cancellation policies** … (g) you will not be entitled to any compensation for
> reservations or bookings (even if confirmed) that were cancelled."

This is not a standing rolling reserve — it is a **discretionary hold triggered
by suspension**, and its size can equal *every payment collected for every
upcoming trip*. It is the contractual mechanism behind the "they froze €50,000
of our money with no explanation" reviews, and it is exactly what it says on the
tin: no cause required, no notice required, no explanation required.

Alongside it, on disputes:

> "When a Traveler files a dispute or chargeback with their bank, the Trip
> Organizer agrees that **the full amount of the Trip Cost** or the relevant
> disputed portion thereof **will be automatically deducted from the WeTravel
> account** … It typically takes **up to 60 to 80 business days** for the bank to
> come to a resolution … During this time, the funds are also temporarily
> returned to the Traveler."

Note: **60–80 *business* days** is three to four months.

## What this means

WeTravel is a routing layer over three processors, not a Stripe wrapper. Stripe
and Airwallex both do general processing; Corpay handles the cross-border leg
and charges its own fees "assessed directly by Corpay", which is how banking
network costs get passed through without appearing on WeTravel's published fee
table. The published percentages therefore do not describe the full cost of a
cross-border payment — the FX base rate and Corpay's own charges sit outside them.

---

# The full vendor map (from WeTravel's own sub-processor list)

`product.wetravel.com/about-us/sub-processors` — a page the site links but never
advertises, and the single richest source. The same legal documents are also
served at `product.wetravel.com/about-us/terms` and `/about-us/privacy`, which
return HTTP 200 to fetchers while `www.wetravel.com/*` returns 403. That is why
these vendors are missing from every second-hand summary.

## Money vendors

| Vendor (legal name as written) | Role | Where named |
|---|---|---|
| **Stripe, Inc.** | Payment processing, **card issuance**, payout, verification (USA) | sub-processors + Terms |
| **Stripe Payments Europe, Ltd.** | Processing, payout, verification (EU) | sub-processors + Terms |
| **Airwallex US, LLC** | Processing, payout, verification (USA) | sub-processors + Terms |
| **Airwallex (Netherlands) B.V.** | Processing, payout, verification (EU) | sub-processors + Terms |
| **Corpay Solutions Inc.** | "Processing, payout, and verification" (USA) | sub-processors |
| **Corpay / Fleetcor** | **Cross-border payments and FX** | Terms |
| **Mangopay S.A.** | Processing, payout, verification (EU) | **sub-processors ONLY** |
| **Celtic Bank** | Issues the WeTravel Visa card | product page |
| **Persona, Inc.** | KYC / KYB | sub-processors |
| **Nuitée Travel Limited** | Hotel bookings — *"Your booking is made with Nuitée… and not with WeTravel"* | Terms |
| **Wells Fargo / JPMorgan Chase** | Hold the client funds | help art. 415019 |
| **PayPal** | One of the payout methods to organizers | Terms |

**So "among others" covers three more processors, not one.** Note the asymmetry:
Stripe, Airwallex and Corpay each get their own Terms clause binding the user to
that vendor's ToS. **Mangopay does not appear in the Terms at all** — it exists
only on the sub-processor list, and its function is unconfirmed anywhere.

## WeTravel holds no payments licence of its own

Full-text search of the Terms and Privacy Policy returns **zero** occurrences of
"money transmitter", "merchant of record", "escrow", "custody", "commingled",
"pooled", "FBO" or "not a bank". It makes no licensing claim anywhere.

Instead it uses the **agent-of-payee** construction, which is the standard
exemption from US state money-transmitter licensing:

> "Each Trip Organizer hereby appoints Wetravel as the Trip Organizer's
> **limited payment collection agent** solely for the purpose of accepting the
> Trip Cost from Travelers… Upon receipt of a Traveler's payment, **the
> Traveler's payment obligation is extinguished**."

> "**WeTravel Inc. operates in most cases as the Agent of the Payee.** This
> means that WeTravel **relies on regulated third-party payment providers, such
> as Stripe and Airwallex**, to process payments on behalf of the Payee."

That "payment obligation is extinguished" sentence is the legal hallmark of the
exemption. **WeTravel operates under its vendors' licences, not its own** — a
conclusion read from its own drafting, not inferred.

Registry checks returned no WeTravel licence in NMLS (indirect), FCA, DNB, CBI,
or the Baltic/Malta EMI registers — and DNB *does* index Airwallex Netherlands,
so the absence is meaningful rather than an indexing gap. The vendors hold the
licences: Stripe Payments Company **NMLS #1280479**, Airwallex US **NMLS
#1928093**, Airwallex Netherlands **DNB EMI R179622**, Mangopay **CSSF EMI**,
Corpay **FCA FRN 900702**, Celtic Bank **FDIC cert 57056**.

> Discrepancy: the exact entity "Corpay Solutions Inc." does not appear in
> Corpay's own 14-entity licensing document. Unresolved.

## Custody: a ledger over pooled bank accounts

Two adjacent sentences in the Terms are in open tension:

> "**The Trip Organizer controls the funds** provided by the travelers. However,
> in case of suspected fraud or similar issues, Wetravel may block payouts… **The
> Trip Organizer is not entitled to any of the Trip Cost without Wetravel's
> consent.**"

Nominal control, actual custody. Liability is capped at *"the amount of the Trip
Cost collected by WeTravel from the Traveler."*

## Two fund flows, and what switching costs you

1. **WeTravel processing (default)** — money sits in WeTravel's holding accounts
   and your WeTravel wallet. WeTravel is in the flow of funds.
2. **Connect your own Stripe** — *"all funds collected on WeTravel go into your
   own Stripe account… WeTravel has no visibility or access."* But it **disables
   the international wire, the WeTravel Card, Supplier Transfers and
   multi-currency checkout** — which proves those four products run on
   WeTravel's own aggregate merchant accounts, not a pass-through.

## Corporate

**WeTravel, Inc.**, Delaware, SEC **CIK 0001655178**, 101 Mission Street Suite
1115, San Francisco. **Form D filed 24 Sep 2025: $52,204,843 raised, fully
sold** — which supersedes the widely-reported $27M Series B of Oct 2022.
A Dutch entity almost certainly exists ("WeTravel BV" appears as a SEPA
statement descriptor) but has no verifiable KVK registration — unconfirmed.
