# WeTravel — how it actually looks (research lane 5)

**Dated finding:** WeTravel replaced its horizontal top bar with a **left sidebar
on 17 Aug 2026**. Every video demo from 2016–2026 shows the old chrome; only the
help-centre screenshots show the current product. Build the sidebar.

## Palette, sampled from live CSS

| Role | Hex |
|---|---|
| Brand cyan | `#19bed3` — counts, active nav, links, avatars, tab underline |
| **Action green** | `#33ae3f` — the real primary CTA in-app: Manage Trip, Publish, Export, Save Plan |
| Dark teal | `#207e93` — the `+ Create new` button only |
| Charcoal | `#4f5758` — body text, bulk-action buttons, checkout modal header |
| Near-black | `#30313d` — headings |
| Sidebar rail | `#eef0f3` |
| Active nav pill | `#e9f8fb` |
| Table header | `#f8f8f8` |
| Success pill | `#e5f1e6` |
| Danger | `#e61b1b` |
| AI purple | purple→magenta gradient, the only gradient in the system |

Green and cyan never sit adjacent as equals — **green always takes the primary
slot in-app**. Typography is **Poppins** throughout the product; traveller
booking pages use **Montserrat**. Density is spacious: 77–87% of every screen is
white, table rows 48–56px, radius 5–8px, shadows soft and rare.

> Our mockup deliberately diverges here: Swellyo's accent is cyan `#05bcd3`, so
> cyan takes the primary slot and green is reserved for semantic "paid / ok".
> That is the Swellyo-branded brief, not a mistake.

## Sidebar, exact (current)

```
[WT]                        [collapse]
[ + Create new           ⌄ ]     ← #207e93
🗺 Trips                    ⌄
   Upcoming Trips        (3)
   Past Trips
   Draft Trips           (2)
   Deactivated Trips
   Archived Trips        (1)
   Trips I Joined
⧉ Itineraries              ›
👥 CRM                     ›
💳 Payments                ›
📊 Reports                 ›
▣ Inventory                ›
🤝 Network                 ›
⚙ Business settings        ›
─────────────────────────────
(W) Anna Mizina          🔔
```

Sub-navs:
- **Itineraries** → Overview · Library · Archived
- **CRM** → Opportunities · Contacts · Fields · Email Templates · Email Settings
- **Payments** → Balance · Business Payments · In-Person QR Payments · Recipients · Payout Accounts · WeTravel Cards
- **Reports** → *Performance*: Trips · Bookings · Travelers · Packages & Add-Ons — *Payment*: Payments · Transactions · Transfers · Top-ups · Cash Flow · Upcoming Payments
- **Inventory** → Resource List · Resource Calendar
- **Business settings** → General · Partner Hub · Verification · Reviews · Team · Discounts · Website Widgets

`+ Create new` opens: *Sell to travelers* → Full Trip, Payment Link; *Collect from
business partners* → Payment request.

## Screens

**Upcoming Trips** — H1, then a `[List | Calendar]` segmented toggle top-right.
Row of search + `Filters ⌄` + `Date Created: Latest ⌄`. Then `Filter by tags` with
a gear and coloured dot chips. Trip cards are **full-width horizontal rows** ~200px
tall: cover photo 185×195 flush left, title + tag pill, date, owner avatar,
`Amount available: $0.00`, `0/25 Going`, three icon buttons top-right
(pencil / eye / kebab) and a green **Manage Trip** button bottom-right.

**Manage Trip** — back chevron + H1. Three-column header band: thumbnail /
title + dates + Trip ID + `3/10 Going` + View & Edit / a vertical rule then the
stat block `Expected amount (?) · Amount paid (?) · Amount pending (?)` and a
bold `Go to Payments` link. Tab bar with cyan count pills and a 3px cyan
underline on the active tab: **Bookings · Participants · Rooming Lists ·
Waitlist · Messages · Promote · Opportunities**, with `Download ⌄` far right.

**Booking Details modal** — big 95px cyan avatar, name at 30px, balance due, a
note field, and on the right **a vertical stack of plain cyan text links** (not
buttons): Send Message · Add Payment · Add Option · Issue Refund · Cancel
Booking · Add Payment Plan · Set Custom Price · Download Signed Document. Below:
Booking Summary, then an Activity Log with `24/07 08:44` timestamps.

**Add Payment Plan modal** — 6-across number grid 1–24, selected cell filled
cyan; rows Deposit / 1st / 2nd / Final with a date field and an amount field;
footer checkboxes `Allow partial payment (?)` and `Enable auto-billing (?)`;
`Total:` bold right; green **Save Plan**.

**Trip Builder** — left step rail ~250px, green ✓ circles, seven steps, footer
`Preview` then green `Publish`. Main pane has a `✨ Smart Import` promo card in
purple, then collapsible rich-text sections.

**Upcoming Payments** — four KPI tiles split by vertical rules (`Past Due` in
red · Upcoming Today · This Week · This Month), a removable date chip, then a
**stacked bar chart by month**, red for past due and light blue for upcoming.

## Traveller booking page

Next.js + Tailwind + shadcn, Phosphor icons, Montserrat. **Fully white-labeled —
the WeTravel logo appears nowhere and the footer reads © 2026 <Organizer>.**

Sticky header (organizer logo, language, burger) → anchor nav → hero carousel
`aspect-[5/2]` desktop, square on mobile → **booking widget floating up over the
hero** (`top:-54px`, white, rounded-xl, shadow `0 2px 10px rgba(0,0,0,.25)`):
organizer avatar, price at `text-2xl`, `Deposit: $500`, green **See Availability**
(label configurable), then outline Download Brochure and Ask a Question. On
mobile the widget goes full-width with no shadow or radius and the secondary
buttons switch from a column to a row.

Then: About this trip · What's included / not included · day blocks · Location ·
About your organizer · Reviews · Photo gallery · footer.

**Checkout** opens as a modal over the page. Dark `#4f5758` header band with a
circular trip photo half-protruding above the modal's top edge. Breadcrumb seen
live: `Package › Participant info › Add-ons › Payment`. Right rail `Your Booking`
on `#f8f8f8` with a currency pill, line items, `Trip Total`, `Service Fee`, and a
bold `Amount Due (i)`.

> The i18n bundle from lane 6 gives the order as Package → Add-ons →
> Participant info → Insurance → Payment. Steps are operator-configurable, so
> both are real; the bundle is the better guide to the current maximal path.

## Micro-details worth copying

- **Three date formats coexist**: `2026/08/11` in tables, `Jan 3, 2027` on cards,
  `Apr 03` on payment-plan rows, `24/07 08:44` in activity logs.
- Money always shows 2 decimals in tables; balance tiles render the decimals in
  smaller type; the ISO code trails the amount.
- Avatars are solid cyan circles with white initials — 28px in tables, 95px in
  the booking modal.
- Counts are filled cyan pills inline right of a tab or nav label.
- Row actions are always a `⋮` kebab in the last column.
- Every money stat carries a small grey `(?)` tooltip.
- **No pie or donut charts anywhere** — stacked bar, plain bar, line, kanban.
- Empty states are plain centred grey text, no illustration.
