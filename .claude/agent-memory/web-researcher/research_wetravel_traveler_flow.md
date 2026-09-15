---
name: research_wetravel_traveler_flow
description: WeTravel traveler-facing help center — booking checkout steps, payment/installments, traveler portal, emails, cancellation. For UX/copy reference when building Swellyo's operator-trips traveler flow.
metadata:
  type: project
---

Researched 2026-08-25 from help.wetravel.com (traveler-facing articles). Complements [[research_wetravel_pricing]] (margins) and [[research_wetravel_integration]] (partner API). This memory is about traveler UX/copy, not economics.

## 1. Booking / checkout flow
- Two entry paths: **guest checkout** (no account) or full WeTravel account. Guest checkout collects buyer first/last name + email at minimum.
- Checkout order (per Trawick insurance article): package selection → personal info / questionnaire → **Insurance tab** (optional, USD trips only, Trawick partner) → payment.
- Custom questions live in "Participant Info" section of trip builder; question types include Checkboxes, Text Answer, File Upload; can be marked required.
- Waiver/liability: no dedicated waiver widget — orgs bolt it onto the questionnaire as a required Checkbox ("I hereby sign this waiver") or Text Answer ("I hereby electronically sign this waiver with my initials"), OR use the separate **eSignature** feature (own tab in trip builder, upload PDF, participant types full name + checks consent box). eSignature can be mandatory-before-payment (blocks checkout) or optional (popup right after purchase, reminder email 2h then 2 days later if unsigned).
- Adding companions: from Booking Summary → "Add participants", or from trip page's green "Book Now"/menu → "Add Another Participant" → normal checkout flow again. Same email address must be reused to keep bookings linked.
- Post-booking follow-up questions (dietary, emergency contact, passport, room prefs) are handled via separate "**Participant Tasks**" feature (Pro), distinct from checkout questionnaire — shown as a blue "Complete your info" banner on the traveler's dashboard, with due dates and optional field-locking after a deadline.
- Pre-registration/waitlist: "Join Waitlist" button captures phone+email before a package opens; separate from real checkout.

## 2. Payment
- Methods: card, ACH (US)/SEPA(EU)/BACS(UK)/BECS(AU)/PAD(CA) local bank debit, Apple Pay & Google Pay (USD/GBP/EUR/MXN/AUD, auto-appear on supported device/browser, same rate as card). Bank/ACH transfers marketed as fee-free at checkout but take 5-7 business days to clear vs instant for card.
- Fees: WeTravel platform fee per transaction (min $1.50 USD equiv) + card processing fee (3.9% card fee if currency unsupported for local rails). Organizer chooses to **absorb** or **pass on** both the WeTravel fee and card/wire fees to the traveler — if passed on, fee only appears at checkout when traveler chooses card/wire (paying via local bank account avoids it).
- Payment plans: 1-24 installments, dates set by organizer; optional "Allow partial payment" (traveler can pay any amount anytime) and optional **auto-billing** (auto-charges saved card each due date). Money applied in order: deposit → installment 1 → installment 2, etc.
- Traveler payment paths: (a) click "Make Payment" button in reminder email → sign in → payment page, or (b) wetravel.com → My Trips → Trips I Joined → trip → "Manage Booking" → "Make a payment" → popup lets you pick "next installment only" or "all remaining installments" → pick saved method or add new → "Confirm Payment".
- Receipt: "Manage Booking" page has a "Download Receipt" button → opens PDF instantly, amounts shown in trip's original currency, fees excluded from totals, always reflects current booking state (regenerated, not a static file).

## 3. Traveler portal / account
- URL: wetravel.com, log in with **the same email used at booking**. Nav: "My Trips" → "Trips I Joined" → click trip → "Manage Booking".
- Guest-checkout users authenticate via **6-digit email code** (not a clickable magic link) valid 10 minutes — either self-initiated via Sign In, or auto-filled by clicking an organizer's emailed booking link.
- Manage Booking page can: make/schedule payments, download receipt, "Edit participant information" (edit any questionnaire field incl. name/email — useful when booking was made for someone else), add participants, view/download signed eSignature doc under "Buyer information", see "Document Not Signed" status button, message the organizer.
- Default payment method changed only via username (bottom-left) → Personal settings → Payment settings — NOT by picking a different saved card at checkout (that's a one-time override only).
- Mobile app "**My Trips by WeTravel**" (iOS/Android): view-only itinerary viewer — daily activities/times/locations/notes, real-time flight status, real-time updates when organizer edits itinerary, offline caching. Explicitly CANNOT manage booking or pay — must drop to wetravel.com in-app browser or web for that. Discovered via QR code on shared itinerary or any WeTravel link auto-opening the app if installed.

## 4. Traveler emails (from "Which automatic emails are sent" article)
- Booking confirmation (immediate, includes organizer's welcome message).
- Welcome to WeTravel + Verify your account (on account creation).
- Payment plan reminders: 7 days before, 3 days before, day-of, + late notice 2 days after due date.
- Auto-billing: notice 3 days before charge, then success/fail receipt after attempt.
- Wire transfer instructions + reminder 1 day before expiration.
- Insurance reminder (USD trips only): 48h after booking, then again 3 weeks pre-departure if unpurchased.
- Participant Task reminders: same 7/3/day-of/+2-day-late cadence as payments.
- eSignature request + reminder 2 days later if unsigned.
- Abandoned cart follow-up 24h after incomplete checkout.
- Waitlist confirmation + invite email when a spot opens.
- Review request 2 days post-trip, reminder at day 9.

## 5. Cancellation / refund
- **No self-serve cancel button for travelers.** Must message the organizer: either via organizer's public profile contact info, or from Manage Booking page's bottom "Contact, Cancellation & Support" section → "Message organizer" button.
- WeTravel support explicitly will not process cancellations/refunds on the traveler's behalf — only the organizer can. Cancellation/refund policy terms are set per-trip by the organizer (traveler told to check trip page + waiver before booking).
- On the organizer side (for context): issuing a full refund auto-cancels the booking; canceling alone does NOT auto-refund — two separate actions. Refunds land in 5-10 business days.

## Applies to Swellyo
Swellyo's operator-trips already diverges intentionally in several places researched elsewhere ([[project_operator_becomes_merchant_of_record]], [[project_cancel_trip_refunds_all]] — Swellyo force-refunds on operator cancel, unlike WeTravel's manual two-step). Useful as copy/UX reference for: Manage Booking-style single traveler hub, "Message organizer" cancellation pattern if self-serve cancel isn't wanted, and the fee-pass-through toggle language ("absorb" vs "pass on to participants") if Swellyo ever exposes that choice to operators.

Sources: see URLs cited in the research brief delivered 2026-08-25 (help.wetravel.com articles — ids 253921, 11165352, 176778 collection, 2015969, 1270486, 2734851, 7053111, 1551676(404), 11508773, 2251567, 8770633, 2065908, 6306735, 2221958, 1720779, 434422, 1217663, 11099019, 4605160, 415008).
