# WeTravel — the traveler's side (research lane 6)

Sourced from four real, live surf-retreat trip pages plus WeTravel's own
extracted i18n bundles (537 checkout keys, 176 portal keys — dumps kept in the
session scratchpad as `wt_ck_i18n.txt` / `wt_mt_i18n.txt`). Microcopy below is
verbatim from those bundles.

Conveniently, every page found was a surf retreat: Costa Rica, San Clemente,
Nicaragua, Bali. The demo data can mirror real pages almost exactly.

## The trip page is an ordered array of typed sections

Section types in the real payloads: `general`, `inclusions_exclusions`,
`trip_options`, `package`, `map`, `organizer_details`, `image`, `warning`.
The operator drags them into order. Generalized:

1. **Sticky header** — organizer avatar/logo · Overview · Download brochure ·
   Ask a question · Download App · language switcher
2. **Hero** — one full-bleed photo (separate `desktop-` and `mobile-` variants)
3. **Title → destination → dates** (or `Duration: N days` for recurring trips)
4. **Floating booking widget** — price · `Deposit: $X` · **Book Now** (operator
   picks the button color and can rename it, e.g. "See Availability") ·
   Download Brochure · Ask a Question. On mobile it pins to the bottom.
5. **About your trip**
6. **What's included / What's not included** — paired title+description rows,
   operator-typed in caps: TRANSPORTATION, ACCOMMODATION, ALL MEALS, SURFING
   LESSONS, BOARD RENTAL, PHOTO AND VIDEO ANALYSIS, YOGA
7. **Packages** — room tiers, each with price, deposit, spots left
8. **Itinerary** — N free-form image + rich-text sections. **There is no
   structured day/time model** — "7:00 AM Breakfast" is typed prose.
9. **Location** — map + numbered pin list
10. **About your organizer** — avatar, bio, verified badge, star rating, review
    count. Reviews are organizer-level, never trip-level.
11. **Photo gallery** — carousel, 10–68 images
12. **Footer** — © operator · Terms · Privacy · "Powered by WeTravel" unless
    white-labeled

Scarcity strings, verbatim: `{{count}} left` · `Only {{count}} left` ·
`Sold out` · `Not available` · `Deadline passed` · `Past trip` ·
`Pre-registration` · `Join Waitlist` · `Available until {{date}}`.

**No FAQ section type, no structured cancellation policy, no structured terms.**
Operators type their cancellation tiers into a normal rich-text block.

## Checkout — a full-screen iframe over the trip page

Book Now does not navigate. It opens `/checkout_embed?uuid=…` in a fixed
full-screen iframe, so the traveler never leaves the operator's page.

Progress steps, verbatim: **Package → Add-ons → Participant info → Insurance →
Payment**. Steps vanish when unconfigured. The maximal path:

1. **Select Departure** (recurring only) — calendar, `Trip duration: {{count}} days`
2. **Select Package** — cards with name, description, price, `Deposit: $X`, spots badge
3. **Select add-ons** — split "trip add-ons" / "per person add-ons"
4. **Buyer information** — First Name · Last Name · Email · **Confirm Email**.
   Guest checkout is the default; no account required.
5. **Participant Information** — one block per person; the operator's custom
   questions live here. `Add Another Participant` repeats the whole block.
   File upload is blocked until a name is entered ("Name Required").
6. **e-signature** — "Please read and sign the document before proceeding to
   complete your booking" → **Sign Document** → badge "Document signed".
   **A hard gate before payment**, not a checkbox at the end.
7. **Protect your trip** — insurance. Forced choice: "Yes, add insurance"
   (badged *Recommended*) vs "No, I'll continue without insurance".
8. **Payment Options** — "Pay full amount" vs "Pay amount due". The installment
   schedule renders as rows: `Deposit, due at booking` · `{{position}} payment,
   due {{date}}` · `Final`. Then one of two notices:
   - "We will automatically charge your payment method on the dates above."
   - "You will receive an email with a link to pay when a payment is due."
9. **Payment Method** — accordion with "Show more payment methods". Card,
   Apple/Google Pay, SEPA, BECS, EFT/Plaid, Wire, SPEI, Pix, BLIK, iDEAL,
   Bancontact. Plus billing address and a **Discount code** field with Apply.
   Carbon offset checkbox. Multi-currency nudge: "You have entered a
   {{country}} credit card. Pay in your local currency ({{currency}}) to avoid
   conversion and hidden card fees."
10. **Order summary** ("Your Booking") — Trip Total · Deposit · Due at Booking ·
    Travel Insurance · Carbon Offset · Subtotal · Taxes · **Service Fee** ·
    Previous Payment · Balance Due · Total
11. **Terms** — implicit consent, **not a checkbox**: "By clicking {{buttonText}}
    you agree to WeTravel's Terms and the Cancellation Policy." Button:
    **Confirm Booking**. Above the form: "All transactions are secure and encrypted".
12. **Confirmation** — "You have booked your trip" / "Your receipt and booking
    details will be emailed to {{email}}", the organizer's welcome message, then
    nudge cards: Complete the remaining info · Sign required documents · Protect
    your trip · Pay outstanding balance.

Guard modals worth stealing: "Payment in progress — starting a new payment
cancels the previous attempt. You will not be charged twice." · "Existing
Payment Found — you just made a payment less than 5 minutes ago." ·
"Existing Booking Found" with Manage Booking / Add Another Participant.

**There is no save-and-resume.**

## Traveler portal — "Manage Booking"

Guest bookers get in with a **6-digit email code** (10-minute validity). Blocks:

- **Trip card** — `{{count}} Going`, `Due Now`, `Due In Later Installments`,
  `Past Due`
- **Trip highlight banner** — countdown ("{{distance}} until your trip starts")
  plus "Let's get you prepared:" with Make a payment · Sign your document ·
  Leave us a review, ending in **"You are all set!"**
- **Booking Summary** — packages, add-ons, [Add participants] [Buy add-ons]
- **Payment Status** — badges Paid · Pending · Due now · Due later · Past due ·
  Failed · Refunded · Disputed · Moved. [Make a payment] [View payment plan].
  Pay-installment modal offers: pay due at booking · pay installment due ·
  **pay all remaining installments** · pay a free amount.
- **Participant info** — tabs Buyer Details / Participant Details / Checkout
  Info, with edit buttons. Chips: Info complete · Incomplete · Info missing ·
  Info due today · Info due in {{count}} days · Info past due.
- **Booking History** — activity log with [Download receipt] per payment
- **Contact, Cancellation & Support** — [Message organizer]
- **Collect Contribution** — a crowdfunding page for the traveler's own trip:
  "Share a link with friends, family and anyone who might contribute to your trip."

**No self-serve cancel button exists anywhere.** Cancelling is a message to the
organizer.

The "My Trips by WeTravel" mobile app is **view-only** — itinerary, flight
status, offline cache. It cannot take a payment; it kicks out to the website.

## Friction and trust

- **Fees are the top traveler complaint.** 2.9% card / 3.9% AMEX / ~1% bank,
  $15–25 wire, $1.50 minimum. The Service Fee line only appears once the
  traveler picks card or wire — choosing local bank debit makes it vanish.
- Trust markers: organizer verified badge, star rating + review count, "All
  transactions are secure and encrypted", terms links above Confirm.
- **Cancellation policy is invisible to the platform** — prose, unenforced, no
  refund estimate at checkout.
- Refunds are entirely the organizer's call; travelers blame WeTravel because
  WeTravel is the brand on the checkout.
- Group booking friction: every guest's details must be entered individually.

Mobile is genuinely responsive — the DOM ships separate desktop and mobile
components, and the mobile widget puts price + Book Now in thumb reach. No
sourced complaints about mobile checkout.
