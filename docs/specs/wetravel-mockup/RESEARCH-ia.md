# WeTravel — dashboard information architecture (research lane 1)

Sourced from WeTravel's own help-centre screenshots, re-shot 10–24 Aug 2026 for
their navigation relaunch. `www.wetravel.com` and `product.wetravel.com` both
return Cloudflare 403 to fetchers, so nothing here comes from the live DOM —
but their own annotated screenshots are the better source anyway.

## The structural finding

**WeTravel has no booking-status enum.** Nothing in the product models a booking
as Pending / Confirmed / Cancelled. It models **payment state only** — `paid`,
`past due`, `pending`, `failed` — plus a derived *Payment Plan Status*
(Fully Paid / Past Due / Upcoming / Upcoming + Past Due), and separate
cancel and reinstate *actions*.

Booking-status pills exist in exactly one place in the whole product: Business
Payment Requests (`Open`, `In progress`, `Paid`, `Past due`, `Cancelled`).

> Our mockup follows this: `bookingStatus()` is a pure function of the payment
> schedule, not a stored field. A booking is never "confirmed" — it is paid in
> full, on plan, due now, past due, or failed.

## Sub-navigation, confirmed

- **Payments** → Balance · Business Payments · In-Person QR Payments (gated) ·
  **Recipients** · Payout Accounts · WeTravel Cards.
  `Recipients` was called `Suppliers` until mid-August 2026; both appear in
  screenshots from the same day.
- **Network** → WeTravel Partner Hub · Partner Marketplace · Connection Requests.
  Partner Marketplace has tabs All · Requested Services · Offered Services ·
  Networking Opportunities.
- **Business settings** → General · Partner Hub · Verification · Reviews · Team ·
  Discounts · Website Widgets · **Tax Lines**.
- A **Website** item appears between Network and Business settings in exactly one
  screenshot and is absent from four others — plan- or beta-gated.

## Account menu, bottom-left

```
[RS] Ricardo Schneider
  Personal settings  ›   → Profile / Notifications / Payment settings
  Help center
  Support & legal    ›
  Sign out               (red)
```

## Sizing note

Real folder counts on a live account: Upcoming 90 · Past 1,067 · **Draft 1,808** ·
Deactivated 40 · Archived 1 · Trips I Joined 716. The count pills have to hold
four digits — worth knowing before designing them as circles.

## Correction to the Messages composer

The `Send To` options carry **live counts**, and there is one more than the other
lane found:

```
Everyone on this trip (1)
Everyone with a specific package or add-on
Everyone with payments past due (1)        ← missed elsewhere
Everyone with incomplete required questions (0)
Everyone with missing signatures (0)
Specific recipients
```
Composer buttons: `Attach` · `Templates` · `Save as Draft` · `Send Now`.

## Still unknown
Business-settings items below `Website Widgets` are cut off in every screenshot.
There is also a Wistia video knowledge base (60+ product walkthroughs) that
neither pass mined.
