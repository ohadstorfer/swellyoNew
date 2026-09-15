# WeTravel Mockup — Spec

> Status: **built**. The mockup is `mockup.html` in this folder, published as an
> Artifact. Research is in the `RESEARCH-*.md` files beside it.

## What this is

A clickable, Swellyo-branded mockup of the **WeTravel** product — the booking
and payments platform for multi-day group-travel organizers. It exists as a
**design reference for Swellyo's operator trips**: a way to see the whole
category laid out as a working product, so we can judge what to take.

It is not a pitch deck, not a sales asset, and not code we intend to ship.

## Decisions from the interview

| Question | Decision |
|---|---|
| Purpose | Design reference for Swellyo |
| Surfaces | Organizer dashboard, traveler booking page, payments & money, forms & documents — **plus** reporting/analytics, marketing/growth, CRM/contacts, team & operations |
| Format | Clickable HTML artifact, published |
| Fidelity | WeTravel's structure and feature set, in Swellyo's visual language |
| Research | Real research first — their docs, videos, live pages, reviews |
| Scope | Broad map, medium depth (~12–18 real screens) |
| Annotation | None. Pure product, no "Swellyo has this" badges |
| Demo data | Swellyo surf trips — Bali, Portugal, board types, surf levels, waivers, passports |
| Navigation | Fake app shell: sidebar + topbar, clicking swaps the main pane; a toggle to the traveler side |
| Traveler view | Rendered inside a phone frame |
| Styling | Swellyo's real tokens, pulled from the repo |
| Interactivity | **Working demo model** — a real in-page data store; changing a payment plan recalculates the schedule, approving a document moves the counts |
| Sharpest cut | All four: money, operator workflow, traveler conversion, paperwork |

## Design tokens (pulled from the repo)

From `operator-dashboard/src/styles/tokens.css` — the desktop dashboard chrome:

```
--bg #ffffff   --panel #f7f7f5   --panel-2 #f0f0ec
--line #e3e3de --line-strong #d4d4cd
--text #1c1c1a --text-2 #3a3a36  --muted #6b6b66
--cyan #05bcd3 --cyan-dark #066b8c --cyan-tint #e6f4f8
--ok #1f7a4d / #e8f5ee    --warn #b8532b / #fdf0e9
--danger #b3261e / #fdecea --wait #5b5bb0 / #eeeefb
radii 6 / 10 / 14
ease cubic-bezier(0.23, 1, 0.32, 1)  press 140ms / fast 160ms / panel 200ms
shadow-sm 0 1px 2px rgba(28,28,26,.06)
shadow    0 4px 16px rgba(28,28,26,.08)
```

From `src/components/trips/dashboard/dashboardTheme.ts` and `src/styles/theme.ts`
— the mobile side, used inside the phone frame:

```
accent #05BCD3   brandTeal #0788B0   ink #222B30   muted #7B7B7B
hairline #EEEEEE  border #E4E4E4
ok #1F8A4C / #EAF7EF   warn #8A6100 / #FDF3DC
danger #C4361E / #FCEEF0  wait #066B8C / #E4F8FB
```

Type: **Inter** for body, **Montserrat** for headings — the app's two
typefaces, loaded from Google Fonts in the artifact.

Note the two palettes have genuinely drifted (documented in `dashboardTheme.ts`).
The mockup keeps them apart on purpose: desktop chrome uses `tokens.css`, the
phone frame uses the app values, exactly as the two real products do.

## Demo data — the world the mockup lives in

Operator: **Uluwatu Surf Collective**, a surf-camp operator running trips in
Bali and Portugal. Trips carry real Swellyo domain shape — surf level, board
type, waiver, passport, deposits, staff roles.

(Full fixture list is written alongside the implementation.)

## What was built

`mockup.html` — one self-contained file, no external requests beyond Google
Fonts. Roughly 3,200 lines: tokens, a demo data model, derivation functions,
views, and the actions that mutate the model.

**Organizer, 20 screens.** Trips list (six folders, currency-scoped roll-up) ·
Manage Trip with all seven tabs · the seven-step Trip Builder including the
payment-plan modal and the form builder · CRM (kanban pipeline, contacts,
contact 360, fields, templates) · Payments (balance, payout accounts,
recipients, requests) · Reports (upcoming payments, payments, transactions,
cash flow) · Inventory · Network · Business settings (fees, discounts, team,
branding, integrations).

**Traveller, in a phone frame.** The trip page, a five-step checkout, and the
Manage Booking portal.

## The model is live

Every figure on screen is derived, never stored twice. What actually propagates:

- **Record a payment** → the trip header, the portfolio roll-up, the ledger, the
  cash-flow report, the upcoming-payments chart and the traveller's own booking
  page all move together.
- **Edit a payment plan** → pick 1–24 installments and the schedule regenerates,
  validates against the package price, and shows the shortfall if it doesn't
  balance. The rounding remainder lands in the final payment.
- **Switch who pays the fees** → the traveller's checkout total and the ledger's
  fee columns both rewrite. Choosing bank transfer at checkout drops the service
  fee from $20.50 to $6.00, because bank rails genuinely cost nothing to process.
- **Book from the phone** → writes a real booking and a real contact, consumes
  spots, and appears in the organizer's Bookings tab. This closes the loop.
- **Sign a waiver, add or delete a form question, move an opportunity** → counts
  and audiences update everywhere they are referenced.

Two behaviours worth calling out because they are easy to get wrong:

1. **Installment status is derived from its own date**, never stored. A row can
   never claim to be "due now" while its date sits ten days in the past.
2. **Auto-adjust for late bookings** is implemented properly. Book today against
   a plan whose dates have passed and the missed amounts spread across the dates
   that remain; if every date is gone, the balance falls due at checkout. With
   the setting off, they land as past due — which is what the real product does.

## Deliberate divergences from WeTravel

- **Cyan is the primary action colour, not green.** WeTravel uses green `#33ae3f`
  for every commit action and cyan for navigation. Swellyo's accent is cyan, so
  cyan takes the primary slot here and green is reserved for semantic *paid /
  ok*. That is the Swellyo-branded brief.
- **No booking-status field.** Research confirmed WeTravel has no booking-status
  enum at all — it models payment state only. `bookingStatus()` here is a pure
  function of the schedule, so the mockup matches that structure rather than
  inventing a Confirmed/Pending model.
- **Light mode only**, following `operator-dashboard/src/styles/tokens.css`,
  which commits to bright mode on purpose ("a work tool used in daylight") and
  defines no dark values to borrow.
- The platform fee is **editable and labelled as unpublished**, because in the
  real product only the $1.50 minimum is public.

## Verification

- Every JS chunk passes `node --check`.
- A headless harness renders all 56+ view/tab/step combinations, in both
  currencies, including the draft and past trips — no throws, and no `NaN`,
  `undefined` or `[object Object]` leaking into any rendered output.
- A mutation harness asserts that payments, plans, fee settings, bookings,
  signatures and the pipeline all propagate correctly, and that the chart totals
  reconcile against the underlying schedules.
- Walked through in Chrome: no console errors.
