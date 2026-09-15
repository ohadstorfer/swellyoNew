# WeTravel — forms, documents, CRM, email, growth (research lane 3)

Vocabulary: Trip Builder · Manage Trip · Participant Info · Checkout Info ·
Participant Tasks · eSignature · Opportunities (was "Leads") · Contacts ·
Fields · Buyer vs Participant · Add Participant · Messages.

Plans: **Basic $0 · Pro $79/mo per org · Enterprise custom.**

## Trip Builder tabs, in order
**Trip Basics · Trip Page · Packages · Add-ons · Participant Info · eSignature · Settings**

## Manage Trip tabs, in order
**Bookings · Participants · Messages · Opportunities · Waitlist · Rooming Lists (Pro) · Promote**
Global `Download ▾` menu: **Excel · Participant Uploads · Signed Documents**

## Forms

Two surfaces, both configured in the **Participant Info** step:
1. **Checkout Info** — asked during checkout, before payment. Basic.
2. **Participant Tasks** — post-booking, grouped into named tasks with due
   dates and auto-reminders. Pro.

Per-trip, never per-package. **No conditional logic anywhere** — a flat ordered
list. Duplicating a trip is the only templating.

**Only the buyer fills forms in.** Participants have no dashboard and no login.
The buyer answers for everyone on the booking. This single fact shapes every
screen they have.

Question types (API enum `question_type`): `text` Text Answer · `checkbox`
Checkboxes · `radio` Multiple Choice · `dropdown` Dropdown · `date` Date ·
`phone` Phone Number · `country` Country · `file` File Upload (Pro).
Fields: `question`, `required` (default true), `answer_options[]`,
`other_option`. **Question Type is locked once saved** — you must delete and
recreate. Text and required are editable; order is drag-and-drop.

Task due dates: immediately after checkout · N days before/after trip start ·
N days before/after trip end · N days after booking.
Tasks with no mandatory questions auto-mark **Completed**. Tasks can't be added
more than 14 days after trip end. `Set lock date (optional)` freezes answers.

Buyer-facing prompt on the booking dashboard: **"Complete your info."**

## Documents — three separate mechanisms, not one system

**A) eSignature (Pro).** One PDF per trip, 25 MB, security-scanned (grey while
scanning, **green when ready**). **No field placement.** Signing = scroll to
bottom, type full name, consent, **Sign**. Settings: *Who Should Sign The
Document* → `Everyone` | `Buyer Only`, plus a checkbox to make it mandatory at
checkout (binds the buyer only). Template immutable — delete and recreate.
Status is binary: **green icon = all signed, grey = missing**, shown in an
**eSignature** column. **No approval step exists — no pending/approved/rejected.**

**B) File Upload questions (Pro)** — passport/ID collection. 5 files per client,
10 MB each. Stored in S3, login-gated links. Filenames get the participant's
name prefixed. Downloaded via `Download ▸ Participant Uploads`.

**C) Waiver via a required question** — their own documented workaround for
Basic: a required single-option Checkbox ("I hereby sign this waiver") or a
required Text Answer ending "I hereby electronically sign this waiver with my
initials." Plus an account-level T&C URL agreed to on **Confirm Payment**.

## Participants table — columns in order
First name · Last name · Buyer · Email · Start date · End date · Package booked ·
Add-on booked · Custom items · Resource name · Resource configuration · Booking
note · **eSignature** · **Checkout Info** · **Participant tasks** · then one
column per survey question, then one per task question.
Filters: Start date · Package · Resource name · Resource configuration.
Buttons: **Edit Columns** · **Export**. Cancelled participants are excluded.

## Excel export — six tabs
Bookings · Participant Information · Canceled Information · Waitlist · Leads ·
Opportunities.
Bookings columns: Buyer First/Last Name · Number of Participants · Participant
Names · Currency · Trip Price · Successful Payments · Refunds · Pending Payments ·
Failed Payments · External Payments · **Balance Due** · **Due in Later
Installments** · **Past Due** · Discount Codes · Email · eSignature · Booking
Note · Booking Date · Trip start/end · Packages · Add-ons.

## CRM (shipped 2026) — nav: Opportunities · Contacts · Fields · Email Templates · Email Settings

**Contacts.** Auto-created from manual entry, form submissions, brochure
downloads, questions, booking confirmations, waitlist. Search by name/email/
phone. Filters are additive. `More Actions ▸ Edit Columns / Export`.
**Contact 360 View**, four tabs: **Overview** (status, trip count, last booking
date, total amount booked, notes, tags, interested trips, custom fields under
*Additional Information*) · **Activity** (timeline) · **Messages** (Pro) ·
**Trips**. Tags: 25 per contact, and they can never be deleted.

**Opportunities.** Kanban **Board view** / **List view**. Stages `New` and
`Booked` are locked; the rest are custom with colors and descriptions. Card
shows title, contact, last activity, creation date, assignee. Sources include
**Abandoned Checkout**, brochure download, trip inquiry, contact form, ask a
question. Active = activity within **90 days**.

**Fields.** Custom data layer. Types add **Paragraph Answer, Number, Email** on
top of the trip-questionnaire set. Forms are built by dragging fields in — you
cannot create a question from the form itself. Exactly **one Contact Form and
one Trip Inquiry Form per account.**

## Automated emails — organizers cannot edit wording or timing

Payment plan installments: **7 days before · 3 days before · on the due date ·
late notice 2 days after** · plus an organizer-only alert at 3 days.
Auto-billing: 3 days before the charge · success receipt · failure receipt ·
organizer-only alert 2 days after failure.
Participant Tasks: same 7/3/0/+2 cadence, **to the buyer only**, one email per
due date covering all tasks and participants; organizer alerted at +3 days.
eSignature: request at purchase · reminder at **2 hours** · reminder at **2
days** · confirmation with the signed PDF attached; organizer alerted at +3 days.
Abandoned checkout: **exactly one email at 24h**, never repeats.
Reviews: request 2 days after the trip, reminder at 9 days.
Also: booking confirmation, brochure delivery, wire-transfer instructions,
waitlist invite (**link valid 48 hours**), insurance reminders, and a copy to
the organizer on most of them.

Organizer notification settings: exactly four toggles, all on by default —
Booking updates · Payments and Transactions · Account Updates · Lead and
Customer Outreach. Payout confirmations cannot be disabled.

**Messages composer** (Manage Trip ▸ Messages ▸ New Message). Fields: subject,
sender name, message, reply address, Templates, attachments (Pro).
`Send To`: **Everyone on this trip · Specific recipients · Everyone with a
specific package or add-on · Everyone with incomplete required questions ·
Everyone with missing signatures** — the last two auto-append the right link.
**Send Now** or **Schedule** (scheduled sends go out 19:00–20:30 UTC).

## Growth

**Discount codes.** Trip-specific or account-wide; percentage or fixed. One per
booking. **Applies only to the balance due, never the deposit**, and never to
installments or add-ons. API: `quantity` cap max 99, duration relative to trip
start or absolute. No per-user limit, no minimum spend.

**No referral or affiliate program exists.** No agent portal, no commission
engine — agents just use `Add Participant`.

**Abandoned checkout** — on by default, one email at 24h, writes an Opportunity
with two activities (*Checkout Abandoned* recording the last checkout step
reached, and *Follow-up email*).

**Widgets** (free, all plans) — checkout renders as an iframe overlay. Trip-level
under a **Promote** tab: Book Now · Packages · Direct Link · Brochure Button ·
Trip Inquiry Form. Account-level: All Trips · Reviews · Contact Us Form.
Availability warnings render as **"Sold out"** / **"Only X spots left"**.

**White-label is a subdomain, not a custom domain**: `company.wetravel.com`.

**No consumer marketplace. No website builder. No SEO controls** beyond a
Public/Private toggle.

## Integrations
No "Integrations" page — it all lives under Business Settings ▸ General ▸
WeTravel Pro Settings. **Zapier is trigger-only.** Partner API v2 + Svix
webhooks (`booking.created`, `payment.created`, `trip.published`, `lead.*`).
GA4 tag ID, Meta Pixel snippet, **QuickBooks CSV export only** — no live sync.

## Rooming Lists (Pro)
`Create List` → rooms / flights / buses / other groups; one list per departure
date. Room fields: name · number of rooms · capacity · package · notes.
**Capacity is not enforced.** `Hide full rooms` toggle. `Lock` freezes a list
for everyone including the locker.

## Three things that matter most for the mockup
1. No conditional logic, no per-package forms, question type immutable.
2. eSignature has **no review workflow** — only signed/not-signed.
3. Only the buyer has a login. Participants are data, not users.
