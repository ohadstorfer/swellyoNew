---
name: wetravel-integrations-emails
description: WeTravel exact-field audit of integrations (Zapier/API/webhooks/GA4/Meta Pixel/QuickBooks) and every automated + manual email/messaging surface, for mockup rebuilding
metadata:
  type: project
---

Researched Aug 2026 for a pixel/field-accurate mockup rebuild. Complements [[wetravel-integration]] (feasibility of Swellyo integrating WITH WeTravel) and [[wetravel-pricing]] (revenue model). This memory is the opposite lens: cataloging WeTravel's OWN integrations + email/messaging UI at exact field/label level.

## A) INTEGRATIONS

### A1. Zapier
- Setup: Business settings → General → "WeTravel Pro Settings" → API key generated via "Generate API Key" button on profile, pasted into Zapier. Pro plan only. Main account holder only, team members blocked.
- Confirmed exact trigger names (from Zapier's own WeTravel app page): **"New Lead"**, **"Lead Updated"**, **"New Customer"**, **"New Transaction"**, **"Transaction Updated"** (fires on rebooking to another trip).
- New Booking trigger: exists separately, exposes "8 data points."
- Transaction trigger exposes 35 data points including: Transaction Created date, Transaction Initiated date/time, Transaction Updated date/time, Type (payment, refund, dispute, supplier transfer, payout, wire, card transfer, top-up, adjustment), Net Amount.
- UNCERTAIN: no WeTravel-side Zapier "Action" (write-into-WeTravel) names were found in any source — WeTravel Zapier only exposes it as a trigger/source app, not a destination. Multiple fetches of zapier.com/apps/wetravel and zapier.com/apps/wetravel/integrations only returned triggers, never actions.
- Confirmed downstream Zapier integration pages exist for: Mailchimp, QuickBooks Online, Xero, HubSpot, Salesforce, Keap, Slack, Google Calendar, Constant Contact, Webhooks-by-Zapier, Interfaces.
- Zapier is also positioned as the ONLY path to Mailchimp, HubSpot, Salesforce, Slack, Google Calendar, Google Sheets — WeTravel has no native/direct integration to any of these; it's all "Zapier is the connector" messaging (academy.wetravel.com/wetravel-zapier-integration example scenario: "a client registers → auto welcome email + add to Mailchimp + schedule follow-up email").

### A2. Direct Partner API (developer.wetravel.com)
Full verbatim endpoint list (via /llms.txt index):
- **Authentication**: Authentication, Rate Limits, Issue new access token
- **Payment Links**: List/Create/Get/Update/Delete/Publish payment link
- **Trips**: List/Create/Get/Update/Delete/Publish trip
- **Trip Content Components**: List/Create/Get/Update/Delete for: included items, images, paragraphs, not-included items
- **Itinerary**: List/Create/Get/Update/Delete overview event
- **Payment Plans**: Get/Create-or-update/Delete package payment plan; same trio for add-on payment plan
- **Questions**: List/Create/Get/Update/Delete question
- **Packages & Add-ons**: List/Create/Get/Update/Delete package; same for add-on
- **Discounts**: List/Create/Get/Update/Delete discount
- **Orders**: List orders, List a buyer's orders, Get an order, Set a custom price for an order, Set custom prices for multiple orders, Edit payment plan for an order, Edit payment plans for multiple orders
- **Transactions & More**: List/Get transaction, List/Get supplier, List/Get lead
- Also product.wetravel.com/api-overview names the 6 top-level categories as: Trip Builder API, Booking API, Transactions API, Payments API, Suppliers API, Leads API, with REST paths like `/draft_trips`, `/draft_trips/{trip_uuid}/packages/{package_id}/payment_plans`, `/trips/{trip_uuid}/bookings`, `/trips/{trip_uuid}/availability`, `/bookings/orders/{order_id}`, `/transactions/{uuid}`, `/suppliers/{supplier_id}`, `/lead/{id}`.

### A3. Webhooks — exact event names (developer.wetravel.com/docs/webhooks)
1. **booking.created** — new booking created
2. **booking.updated** — departure date change, refund, cancellation, payment update
3. **payment.created** — new payment made
4. **payment.updated** — pending→successful/failed transitions, refund processing
5. **transaction.created** — payments, refunds, disputes, payouts, balance adjustments
6. **transaction.updated** — rebooking scenarios
7. **trip.published** — trip published via Trip Builder or API
8. **lead.created** — brochure download or question asked
9. **lead.updated** — existing lead re-engages

Setup mechanics: Business settings → General → Partner API Integration → generate API key (refresh token, shown once, reusable indefinitely to mint access tokens) → a "Webhooks" section appears below it → toggle to "Yes" → "Manage Webhooks" button opens a **Svix** dashboard in a new tab (WeTravel white-labels Svix as its webhook infra). Main-account-only, same restriction as Zapier/API.

### A4. Analytics / tracking
- **Google Analytics 4**: Business settings → General → "WeTravel Pro Settings" section → "Add" next to Google Analytics → paste "Google Analytics 4 tag ID" → optional "Advanced Web Analytics" checkbox for cross-domain tracking on embedded booking widgets → "Confirm". Pro-only, main-account-only.
- **Meta Pixel** ("Advanced WeTravel Conversion Tracking with Meta Pixel", Pro-only): tracks 4 named events verbatim — **PageView**, **Book Now Button Click**, **Purchase**, **Inquiry Sent**. Two code snippets: header `<script>` with 15-digit Pixel ID placeholder `XXXXXXXXXXXXXXX`, and `<noscript>` fallback at top of `<body>`. Explicitly: "It will not be added to the WeTravel platform" — snippet must be pasted into the operator's OWN website (not a WeTravel setting screen), because tracking is for embedded "Book Now" buttons only. Validate via Meta Pixel Helper Chrome extension.
- No Google Tag Manager–specific integration found (GA4 + Meta Pixel are the only two named tracking integrations).

### A5. Accounting
- **QuickBooks**: NOT a live sync — it's a compatible CSV export. Path: Reports → Transactions Reporting → "QuickBooks CSV" button. Requires manual Chart-of-Accounts setup first: 3 new accounts (WeTravel Account under Cash-on-hand/bank, Sales Discounts under income for refunds, Disputed Sales as income sub-account). CSV columns map to QuickBooks import as: Date (dd/MM/yyyy) → Date, Description → Type field, Amount → Net field. 5 suggested classification rules: Payment→Sales income, Refund→Discounts/Refunds Given expense, Payout/International Wire Transfer→Transfer to Cash on Hand, Top-Up→Transfer to Cash on Hand, Dispute→Disputed Sales expense. Pro plan only.
- **Xero**: NO native export found — Xero only appears as a Zapier-connected app, no direct CSV/sync like QuickBooks.
- **General payment report**: Reports → Payments → "Export" button. Filters: Date, Payment Source (bank/wire/card/external), Status (successful/pending/refunded/failed/disputed), Currency, Trip (single or multi-select). Exact column headers: Date created (UTC), Date updated (UTC), Amount, Status, Currency, Source, Type, Last 4 Digits, Refunded, Disputed, Converted Amount, Participant Card Fee, Amount Paid by Participant, Organizer Card Fee, WeTravel fee, Net Amount Available, Buyer Name/Email, Participant Email/Name, Trip Name, Trip ID, Organizer Name/Email. Row-level "View payment details" link.

### A6. CRM (Pro feature, newer — 2025-era rollout)
- **Contacts** (CRM → Contacts): table of all leads/customers, sortable by creation date. Filters: Trip, Amount booked, Status, Name/email/phone search — filters are additive (don't cancel each other). Columns customizable via "Edit Columns" in a "More Actions" menu; drag-to-reorder; export via "More Actions."
- Per-contact detail tabs: **Overview** (contact info, status, trip count, last booking date, total amount booked, notes, tags — up to 25 tags/contact), **Activity** (timeline of bookings/payments/inquiries/internal updates), **Messages** (1:1 email via connected Gmail/Outlook, Pro only), **Trips** (booking history, links to Manage Trip/Manage Booking).
- **Email connection**: CRM → Email Settings (or the Emails tab inside Contacts/Opportunities) → choose Gmail or Outlook → OAuth. Only primary accounts, no aliases. Once connected: view/remove connected accounts (team members can only remove their own), see full email history per contact, configure shared-email settings + custom signature, "email templates" and link-click tracking (Pro). No evidence of scheduled send or saved-reply snippets at the CRM level (that exists at the trip-messaging level instead, see B3).
- UNCERTAIN whether CRM Contacts has a BULK email compose tool separate from the per-trip messaging tool below — the CRM Contacts article explicitly does not describe bulk messaging; bulk send lives in the trip-level Messages feature (B3).

### A7. Calendar / Sheets / Slack / other apps
No native (non-Zapier) integration found for any of Google Calendar, Google Sheets, or Slack. All three are Zapier-only connector pages (zapier.com/apps/wetravel/integrations/{slack,...}), same pattern as Mailchimp/HubSpot/Salesforce/QuickBooks/Xero — WeTravel is the trigger source, the other app is the destination app inside a user's own Zapier account.

### A8. "Integrations" as a concept in the product
There is no single dedicated "Integrations" settings page/tab by that name. Everything integration-related sits inside **Business settings → General**, under a subsection literally labeled **"WeTravel Pro Settings"** that contains: Google Analytics, (implicitly Meta Pixel via separate doc/manual code paste), Partner API Integration (+ nested Webhooks), and links out to Zapier setup. All of it gated to Pro plan + main account owner only — team members see a message asking them to contact the main organizer.

---

## B) EMAILS & MESSAGING

### B1. Full automated email inventory (trigger → email), verbatim where found

**To customers/travelers:**
- Booking completed → **Booking Confirmation** (includes organizer's custom welcome message)
- Booking creates new account → **Welcome to WeTravel** / **Welcome Email**
- Account signup → **Verify Your WeTravel Account**
- Insurance enabled (USD trips only) and not purchased 48h after booking → **Reminder to Purchase**
- Insurance still unpurchased, 3 weeks pre-departure → **Purchase Reminder**
- Insurance premium changes → **Premium Increased**, then **Premium Increased Reminder** (24h later if unpaid), or **Premium Reduced or Cancelled**
- Brochure download requested → **Brochure Delivery**
- Checkout started, not completed, 24h elapsed, not yet booked → **Abandoned Cart** follow-up email (Pro feature, ON by default, toggle in settings)
- Bank-transfer payment method chosen → **Wire Transfer Instructions**
- Payment link/window about to expire, 1 day before → **Payment Reminder**
- Payment succeeds → **Payment Processed Successfully**
- Underpaid amount received → **Underpayment Received**
- Payment fails → **Payment Failed or Not Completed**
- Installment payment plan due dates → 4-email cadence: **7 days before**, **3 days before**, **on due date**, **2 days after ("Late Notice")** — sent in a **19:00–20:30 UTC** daily batch window. Each includes "a direct personalized link" to pay next installment or pay off remaining balance at once.
- Auto-billing (stored card) charge → **Pre-Charge Notification** (3 days before charge), then **Successful Payment Receipt** or **Failed Payment Receipt**
- Per-installment → **Installment Payment Receipt**, or **Installment Payment Confirmation** if pending
- Final payment → **Balance Due Payment Receipt**
- Task/questionnaire (Participant Tasks feature) due dates → same 7d/3d/due-date/+2d cadence, sent to the **buyer only**, plus 2 extra reminders if the task is due "immediately after checkout" (on due date + 2 days later)
- eSignature requested at checkout, not mandatory → reminder **2 hours after booking** if unsigned; if still unsigned **2 days later** → second reminder; on signing → **confirmation email with the signed document attached**
- Contribution/crowdfunding page → **Contribution Page Created** notice; on a contribution → **Contribution Payment Receipt** (both contributor and organizer get one)
- Booking modified → separate emails per change type: **Payment Plan Added**, **Rebooking Confirmation** (date changed), **Add-on Added**, **Departure Date Changed**, **Package Switched**, **Custom Price Set**, **Custom Adjustments**
- Booking cancelled → **Booking Cancelled**; refund issued → **Refund Initiated** ("full or partial refund initiated")
- Waitlist joined → **Waitlist Confirmation**; spot opens → **Trip Invitation**
- Organizer manually messages (see B3) → **Direct Messages** email; organizer nudges specifically about overdue payment/answers/signature → **Payment Past Due Reminder**, **Missing Required Answers Reminder**, **Missing Signature Reminder** (these are organizer-triggered, not purely automatic)
- Trip ends → **Review Request** (2 days after), **Review Reminder** (9 days after if no review); organizer replies to a review → **Review Response**

**To organizers (in addition to CC'd copies of most customer emails):**
- Participant Task overdue by 3 days → **Overdue Participant Tasks Alert**
- eSignature overdue by 3 days → **Overdue eSignature Alert**
- Installment payment 3 days past due and still unpaid → organizer-only notice prompting them to personally follow up with the participant
- Auto-billing charge fails and stays unresolved ~2 days → organizer-only alert
- Participant updates a task response → **Task Update Notification**
- Payout confirmations — explicitly called out as **cannot be disabled**, unlike everything else

### B2. Notification Settings (organizer-facing toggle screen)
Path: Account → **Notification Settings** (left-hand nav). Exactly 4 toggleable categories:
1. **Booking updates** — "Sent when changes are made to the booking"
2. **Payments and Transactions** — "Sent for new payments and updates to payments"
3. **Account Updates** — "Sent when you update your account or send an email from WeTravel"
4. **Lead and Customer Outreach** — "Sent when a new lead or customer contacts you or downloads your trip brochure"
All 4 are ON by default and independently toggleable. Payout confirmations and unspecified "critical emails" are hardcoded ON regardless of toggle state.

### B3. Trip-level bulk messaging tool ("Messages")
Path: **Trips → Manage Trip → Messages → New Message**.
Compose fields, exact labels: **Subject** (line), **Sender**, **Message** (body), **reply address**. Buttons: **Templates** (insert a pre-made template), file **attach** (Pro-only, multi-file), **Schedule** vs **Send Now**.
**Send To** recipient selector — confirmed dropdown options:
- "Everyone on this trip" (default, used for the classic "message all clients at once" flow)
- "Everyone with a specific package or add-on" (separate help article: filter by package/add-on)
- For recurring trips: choose all participants OR only those on a specific future departure date
- Specific/individual participants — a dedicated help article exists ("How to message specific participants at once") but exact selection widget (checkbox list vs search) is UNCERTAIN — not described in the source article beyond "select the participants you wish to send your message to."
- Also confirmed: a separate bulk-send exists specifically targeting "customers who haven't completed required fields" (questionnaire at checkout, or post-booking Participant Tasks) — i.e., a "remind incomplete" filter, distinct from the general composer.
**Scheduling**: "Schedule" option at bottom of composer → pick timing via filter-box selectors → WeTravel shows computed send time → delivered in the same 19:00–20:30 UTC batch window as automated reminders. Scheduled (not-yet-sent) messages live in a **Scheduled** section where they can be edited/updated before send. For recurring trips, scheduling is only available when "future departure dates" is the selected audience (no confirmation popup shown in that case, per the source, because of multiple departure dates).
**Sent message management**: each sent message has a 3-dot menu with a **Copy** option to duplicate/reuse as a new draft.

### B4. eSignature setup UI (Trip Builder)
Location: last tab of Trip Builder, literally named **"eSignature"**. Toggle "Enable the feature" to Yes → **Upload Document** button (PDF only, 25MB max) → once uploaded, document row "turns green" and unlocks config: **Who should sign** (Everyone [buyer + participants] vs Buyer Only), and a checkbox to **make the signature mandatory at checkout**. Signing status surfaces on Manage Trip → **Bookings** tab as an **eSignature column** with a green icon (all signed) or grey icon (missing).

### B5. Payment Link (adjacent to messaging/checkout, dashboard-only, not API-only)
Confirmed this is BOTH a manual dashboard feature (Create new → Payment Link → build → Publish) AND an API resource (see A2). Dashboard fields: deposit amount, payment plan structure, partial payments toggle, auto-billing settings, "auto-adjust for late bookings," expiration date. Hard constraint: **single-use, single-buyer** — "each payment link can be used only once and is intended for a single buyer." Enabled by default; can be disabled in Business settings → General. Available on both Basic and Pro plans (unlike most integrations, which are Pro-only).

### B6. Participant Tasks (post-booking data collection, adjacent to messaging)
Built inside Trip Builder → **Participant Info** step (Pro only). Fields when adding a task: **Task name**, **Due date** (immediately after checkout, or N days before/after trip start/end), **Auto-reminder** toggle (default ON), optional **Lock date** (freezes editing after a point). Questions can be flagged required; a task with zero required questions auto-flips to "Completed." Responses land in the **Participant Table**. Organizer can hand-mark a task complete. Editable after publish: question text + required flag; NOT editable: question type once saved.

## Sources
- https://help.wetravel.com/en/articles/4787245-how-to-use-wetravel-zapier-api-integration
- https://zapier.com/apps/wetravel/integrations
- https://zapier.com/apps/wetravel
- https://academy.wetravel.com/wetravel-zapier-integration
- https://help.wetravel.com/en/articles/2734851-which-automatic-emails-are-sent-to-you-and-your-customers
- https://help.wetravel.com/en/articles/1270994-what-reminder-emails-does-wetravel-send-for-payment-plans
- https://help.wetravel.com/en/articles/6633299-managing-email-notifications
- https://help.wetravel.com/en/articles/11508773-participant-tasks
- https://help.wetravel.com/en/articles/5106412-how-to-connect-google-analytics-to-wetravel
- https://help.wetravel.com/en/articles/11874514-advanced-wetravel-conversion-tracking-with-meta-pixel
- https://help.wetravel.com/en/articles/4766091-how-to-connect-wetravel-to-quickbooks
- https://help.wetravel.com/en/articles/2301470-how-to-download-a-payment-report
- https://help.wetravel.com/en/articles/9886395-payment-link
- https://help.wetravel.com/en/articles/5783395-how-to-use-wetravel-s-apis
- https://help.wetravel.com/en/articles/14895549-wetravel-crm-contacts
- https://help.wetravel.com/en/articles/14895736-wetravel-crm-connecting-your-email-address
- https://help.wetravel.com/en/articles/2410740-how-to-message-all-of-your-clients-at-once
- https://help.wetravel.com/en/articles/6786902-how-can-i-schedule-messages-to-my-participants-on-wetravel
- https://help.wetravel.com/en/articles/6781247-how-to-message-specific-participants-at-once
- https://help.wetravel.com/en/articles/6829982-how-to-message-participants-who-booked-a-specific-package-or-an-add-on-at-once
- https://help.wetravel.com/en/articles/6306735-esignature-how-to-guide
- https://help.wetravel.com/en/articles/6601888-how-does-the-abandoned-cart-feature-work-on-wetravel
- https://developer.wetravel.com/docs
- https://developer.wetravel.com/llms.txt
- https://developer.wetravel.com/docs/webhooks
- https://product.wetravel.com/api-overview

**Why:** Ohad is rebuilding WeTravel's integrations + emails/messaging screens as an exact mockup, needs field-level accuracy not summaries.
**How to apply:** When building the mockup, use the verbatim labels/fields above rather than paraphrasing. Flag UNCERTAIN items (Zapier actions list, exact participant-selection widget, Xero native export, CRM bulk-compose) if the mockup needs those specific details — they were not confirmable from public docs and may need a live trial account to verify.
