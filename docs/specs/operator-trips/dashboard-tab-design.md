# Dashboard tab — making it look like the rest of the app

**Status:** ✅ **All three phases BUILT 2026-08-05, uncommitted. Not yet seen on a device.**
Written 2026-08-05. D1 answered the same day (Ohad): keep `ok` / `warn`, delete the
"must match the web dashboard" claim. One deviation from the spec as first written — `wait` is
`#066B8C`, not `#05BCD3`; the reason is in §3 and it is a contrast fix, not a change of mind.
**Why:** the Dashboard tab is the only part of Trips our designer never drew. It was built by
reading the web dashboard's layout and guessing the app's values. The guesses are close but
almost never exact, so the tab reads as "nearly right" — which is the worst kind of wrong.
**Scope:** visual only. No data, no queries, no navigation, no copy changes.
**Files:** `src/components/trips/dashboard/` — three files, nothing else.
**Related:** `operator-dashboard/docs/SPEC.md` §4.2 (the web tab this mirrors),
`documents-storage.md`, `payment-pending-state.md`.

---

## 1. Summary

The Dashboard tab (`hosting_style = 'C'`, hosts only) sits between Overview and Plan in
`TripDetailScreen`. Its structure is fine — sections, order, hierarchy all read well. Its
**values** are the problem:

- It **mixes two different type scales** that both exist in Trips, and belongs to neither.
- Its **8 state colours match nothing** — not the app, and not the web dashboard they claim
  to copy. Six of them appear in exactly one file in the whole repo.
- Its **rows do not match** the screen they open into, which shows the same people.
- Its **press feedback is a static transform** with no animation.

None of this is broken. All of it is visible when you put the tabs side by side.

---

## 2. The real finding: Trips has TWO type scales

This is the thing to understand before changing any number.

### Scale A — the Figma scale (designed)

Used by the Plan tab (`PlanSections.tsx`) and the Overview tab
(`TripDetailViewRedesigned.tsx`). Comes from Figma variables read with `get_variable_defs`:

```
10 (Size/xs) · 12 (Size/s) · 14 (Size/md) · 16 · 18 (Size/xl) · 20 · 24
```

13px exists in Overview, but **only for tags, captions and meta** — `chipFooter`,
`typeTagText`, `stayMeta`, `addOnsHint`, `leaderMeta`. Never a row title. Never a link.

### Scale B — the operator-documents scale (not designed)

Used by everything we built for operator trips: `DocumentReviewScreen`,
`RequirementUploadFlow`, `ManageRequirementsSheet`, `DocumentViewer`, `RejectDocumentSheet`.
Counted across those five files:

| Size | Uses | Role |
| --- | --- | --- |
| 12 | 12 | sub-text |
| **13** | **9** | body |
| 14 | 8 | row title |
| **15** | **5** | button label |
| 17 | 1 | screen title |

### The Dashboard is a hybrid of both

| Element | Value | Comes from |
| --- | --- | --- |
| `sectionTitle` 16 / 700 `#333333` | ✅ | Scale A (`ygTitle`, exact match) |
| `sectionSub` 12 / 400 `#6a7282` | ✅ | Scale A (`ygSub`, exact match) |
| `rowSub` 12 / 400 `#7B7B7B` | ✅ | both agree |
| `rowTitle` **13** / 600 | ❌ | Scale B, but Scale B uses **14** for a row title |
| `link` **13** / 400 | ❌ | neither — Scale A uses 14, Scale B has no link token |
| `bannerText` **13** / 600 | ❌ | neither |
| `body` **13** / 400 | ⚠️ | Scale B (correct there) |
| `figure` **28** / 700 | ❌ | neither — largest text in all of Trips |

So it borrows Scale A's **headers** and Scale B's **body**, and gets the row title wrong in
both.

### The rule this spec adopts

> **The Dashboard is a TAB, so it follows Scale A (Figma).**
> `DocumentReviewScreen` and its sheets are a separate full-screen flow and keep Scale B.
> They converge later, or never — not in this spec.

The Dashboard renders inside `TripDetailScreen`, scrolls under the same sticky Overview/Plan
toggle, and sits 12px from a Plan section. It is a peer of Plan, not a peer of a modal sheet.

**One deliberate exception:** `TravelerExtras` renders *inside* `DocumentReviewScreen`, not in
the tab. It stays on Scale B. See §6.

---

## 3. Colours — the drift

`dashboardTheme.ts` says in its own header comment:

> *"If these ever drift from the web dashboard's `tokens.css`, the two products stop looking
> like the same product. They are meant to match."*

They already drifted. **All 8 state values differ.** Verified against
`operator-dashboard/src/styles/tokens.css`:

| Token | App `dashboardTheme.ts` | Web `tokens.css` | Same hue? |
| --- | --- | --- | --- |
| `ok` | `#1F8A4C` | `#1f7a4d` | yes, different shade |
| `okBg` | `#EAF7EF` | `#e8f5ee` | yes, different shade |
| `warn` | `#8A6100` brown | `#b8532b` orange | **no** |
| `warnBg` | `#FDF3DC` | `#fdf0e9` | **no** |
| `danger` | `#C4361E` | `#b3261e` | yes, different shade |
| `dangerBg` | `#FCEEF0` | `#fdecea` | yes, different shade |
| `wait` | `#0E6FA8` blue | `#5b5bb0` purple | **no** |
| `waitBg` | `#E7F2FA` | `#eeeefb` | **no** |

And they match the **app** even less. Reach of each colour across `src/`:

| Colour | Files in `src/` using it |
| --- | --- |
| `#0E6FA8` / `#E7F2FA` (`wait`) | **1** — only `dashboardTheme.ts` itself |
| `#1F8A4C` / `#EAF7EF` (`ok`) | **1** — only `dashboardTheme.ts` itself |
| `#8A6100` / `#FDF3DC` (`warn`) | **1** — only `dashboardTheme.ts` itself |
| `#C4361E` (`danger`) | 8 — genuinely shared ✅ |
| `#E4F8FB` (accent tint) | 2 — `DocumentReviewScreen.pillAccent` |

The app's own state palette is `#34C759` (done), `#FFB443` (pending), `#2BCCBD` (approved),
`#05BCD3` + `#E4F8FB` (accent + tint).

### The worst one: `tagWait`

The "**N waiting**" tag on a traveler row uses a blue that appears **nowhere else in the app**.
Tapping that exact row opens `DocumentReviewScreen`, which already has a pill for exactly the
same idea — `pillAccent`, `#05BCD3` on `#E4F8FB`. Two colours, one concept, one tap apart.

### Decision

| Token | Keep or change | Reason |
| --- | --- | --- |
| `accent` `#05BCD3` | keep | app-wide |
| `ink` `#222B30`, `muted` `#7B7B7B`, `border` `#E4E4E4`, `cardBorder` `#EEEEEE` | keep | match Plan exactly |
| `danger` `#C4361E` / `dangerBg` `#FCEEF0` | keep | shared with `DocumentReviewScreen` |
| `hairline` `#EFEFEF` | **change → `#EEEEEE`** | same job as `cardBorder`, two greys |
| `wait` / `waitBg` | **change → `#066B8C` / `#E4F8FB`** | teal family, kills the foreign blue, stays readable — see below |
| `ok` / `okBg` | **keep** (D1) | dark green is legible; it is just not our green |
| `warn` / `warnBg` | **keep** (D1) | dark brown is legible; the app's yellow is `#FFB443` |

`ok` and `warn` are only ever used as **text on a tint**. A straight swap to `#34C759` /
`#FFB443` fails contrast. **D1 resolved 2026-08-05: keep them, and delete the "must match the
web dashboard" claim instead** — it was already false in all 8 values, and a comment nobody
can act on is worse than no comment.

### Why `wait` is `#066B8C` and not `#05BCD3`

The first draft of this spec said "reuse `pillAccent`" — `#05BCD3` on `#E4F8FB`, exactly what
`DocumentReviewScreen` uses. Measured before building, that pair is **2.1:1**. It fails WCAG
for any text size.

`pillAccent` gets away with it because it is a 12/600 pill with two words in it. `bannerWait`
carries a **full sentence** ("Stripe is still checking your details…"), and shipping a
paragraph at 2.1:1 to fix a consistency problem is a bad trade.

`#066B8C` is the web dashboard's own `--cyan-dark`. On `#E4F8FB` it measures **5.5:1**. It is
the same hue family as the accent, so the tag still reads as "the teal one" beside
`pillAccent` — which was the whole point — and it is a value that already exists in the other
product, so this change *reduces* drift rather than inventing a ninth colour.

> **Not fixed here:** `DocumentReviewScreen.pillAccent` is still 2.1:1. That is a pre-existing
> issue on a screen this spec does not touch (§10). Worth its own pass.

### And the web dashboard

The two products claim to match and do not. Whichever way this goes, **one of them has to
move**. That is a separate decision and a separate diff — see §9.

---

## 4. Spacing, gaps, rhythm

Reference values, all verified:

| | Overview `section` | Plan `ygBlock` | Review screen | **Dashboard** |
| --- | --- | --- | --- | --- |
| Section top pad | 36 | 20 | — | 20 ✅ |
| Section bottom pad | — | 20 | — | 20 ✅ |
| Top border | 1 `C.border` | 1 `#EEEEEE` | — | 1 **`#EFEFEF`** ❌ |
| Header → body gap | 22 | **16** | — | **14** ❌ |
| First-block top pad | 36 | 20 (`planSection`) | 16 (`body`) | **8** ❌ |

`marginBottom: 14` and `paddingTop: 8` are used by **nothing else in Trips**.

---

## 5. Rows — three conventions, one tap apart

The **Travelers** list opens `DocumentReviewScreen`, which shows **the same people** with
different measurements:

| | Plan `ygRow` | Review `row` | **Dashboard `row`** |
| --- | --- | --- | --- |
| Height | 54 fixed | `minHeight: 64` | `paddingVertical: 12` |
| Padding H | **16** | 14 | 14 |
| Gap | 8 | **12** | **10** |
| Avatar | — | **36** | **34** |
| Card radius | **16** | 12 | **16** |
| Card border | `#EEEEEE` | `#EDEDEB` | `#EEEEEE` |
| Title | 12 / 400 | **14 / 600** | **13 / 600** |

`gap: 10` and `avatar: 34` are used by neither neighbour.

Radius is also inconsistent **inside the tab**: `list` is 16, but `banner` and `emptyCta` are
12 — and `emptyCta` renders in the same section slot the 16-radius `list` would occupy. In
Plan, radius 12 is reserved for the `commitPill`, which is a **button**. Banners are surfaces.

---

## 6. Motion and press

| Element | Now | Problem |
| --- | --- | --- |
| `ReviewBanner`, `emptyCta`, `TravelerExtras.action` | `pressed: { transform: [{ scale: 0.97 }] }` | **Static.** No transition — it snaps. The comment says *"Instant feedback. 0.97 is the app-wide press scale"*: the number is right, the animation is missing. |
| `row`, traveler rows | `rowPressed: { backgroundColor: '#F4F4F2' }` | Fine, and correct for a list row. |
| Whole tab | nothing | Plan uses `FadeInDown` + `LinearTransition`. Not required — noted, not fixed. |

Plan animates the same 0.97 with `PressableScale`: `Animated.spring`, `speed: 50`,
`bounciness: 0`, `useNativeDriver: true`. **`PressableScale` is not exported** from
`PlanSections.tsx`.

**Decision:** create `src/components/trips/PressableScale.tsx` as a new shared file with the
same implementation. Do **not** edit `PlanSections.tsx` to re-point its copy — that file is
designed, reviewed and shipped, and a duplicate primitive is cheaper than a regression in the
Plan tab. Someone can de-duplicate the day they next open it.

---

## 7. What is already correct — do not touch

Verified against the neighbours, exact matches:

- `sectionTitle` 16 / 700 `#333333` — identical to `ygTitle`
- `sectionSub` 12 / 400 `#6a7282` — identical to `ygSub`
- `rowSub` 12 / 400 `#7B7B7B` — identical to `DocumentReviewScreen.rowSub`
- `list` radius 16, border `#EEEEEE` — identical to `ygCard`
- `accent` `#05BCD3`, `muted` `#7B7B7B`, `border` `#E4E4E4`, `cardBorder` `#EEEEEE`
- `danger` `#C4361E` — shared with `DocumentReviewScreen.rowSubBad`
- `rowPressed` `#F4F4F2` — identical to `DocumentReviewScreen.rowPressed`
- **`TravelerExtras.action`: `height: 48`, `borderRadius: 24`, `fontSize: 15 / 600`** — this
  is the operator-documents button convention, used identically by `RejectDocumentSheet`,
  `RequirementUploadFlow`, `DocumentViewer`, `ManageRequirementsSheet` and `ParticipantCard`.
  It looks off-scale next to Scale A. It is not. **Leave it.**

---

## 8. The changes

Every row below is `file` → `before` → `after`. Nothing else changes.

### Phase 1 — spacing and geometry (no judgment calls)

| File | Style | Before | After | Why |
| --- | --- | --- | --- | --- |
| `dashboardTheme.ts` | `hairline` | `#EFEFEF` | `#EEEEEE` | same job as `cardBorder`; Plan uses `#EEEEEE` |
| `TripDashboardTab.tsx` | `root.paddingTop` | `8` | `20` | `planSection` is 20 |
| | `sectionHead.marginBottom` | `14` | `16` | Plan header gap is 16 in all three places |
| | `row.paddingHorizontal` | `14` | `16` | `ygRow` is 16 |
| | `row.gap` | `10` | `12` | review screen is 12 |
| | `avatar` | `34×34`, radius 17 | `36×36`, radius 18 | same faces, next screen, 36 |
| | `banner.borderRadius` | `12` | `16` | banners are surfaces, not buttons |
| | `banner.paddingHorizontal` | `14` | `16` | matches rows after this change |
| | `emptyCta.borderRadius` | `12` | `16` | sits where the 16-radius `list` sits |
| | `emptyCta.paddingHorizontal` | `14` | `16` | same |
| `TravelerExtras.tsx` | `blockHead.marginBottom` | `10` | `12` | third value for one role; 12 keeps it a sub-block under the tab's 16 |
| | `block.paddingHorizontal` / `Vertical` | `14` | `14` | **no change** — matches `PlanSections.card` |

### Phase 2 — type scale (adopt Scale A in the tab)

| File | Style | Before | After |
| --- | --- | --- | --- |
| `TripDashboardTab.tsx` | `rowTitle` | `13 / 600` | `14 / 600`, lineHeight `20` |
| | `link` | `13 / 400`, lh 18 | `14 / 400`, lh 18 |
| | `bannerText` | `13 / 600`, lh 18 | `14 / 600`, lh 20 |
| | `emptyCtaText` | `13 / 600` | `14 / 600`, lh 20 |
| | `body` | `13 / 400`, lh 19 | `14 / 400`, lh 20 |
| | `figureSub` | `13 / 400`, lh 18 | `14 / 400`, lh 20 |
| | `figure` | `28 / 700`, lh 34 | `24 / 700`, lh 30 |
| | `counts` | `12 / 400`, lh 17 | `12 / 400`, lh 18 |
| | `rowSub` | `12 / 400`, lh 17 | `12 / 400`, lh 18 |
| | `tagWaitText` | `11 / 600`, lh 15 | `12 / 600`, lh 16 |
| `TravelerExtras.tsx` | — | — | **no change** — stays Scale B (§2) |

`figure` at 24 caps it at the trip title's size (`TripDetailScreen.title` = 24), which is the
largest text anywhere in Trips. It is still by far the biggest thing on the tab.

`counts`, `rowSub`, `tagWaitText`: `lineHeight` 17 and 15 are not on the scale; 18 and 16 are.

### Phase 3 — colour and motion (needs §9 answered first)

| File | Change |
| --- | --- |
| `dashboardTheme.ts` | `wait` `#0E6FA8` → `#066B8C`; `waitBg` `#E7F2FA` → `#E4F8FB` |
| | `ok` / `warn` unchanged (D1); delete the "must match the web dashboard" comment |
| new `PressableScale.tsx` | copy of the `PlanSections` primitive, exported |
| `TripDashboardTab.tsx` | `ReviewBanner` + `emptyCta` use `PressableScale`; drop `styles.pressed` |
| `TravelerExtras.tsx` | `action` uses `PressableScale`; drop `styles.pressed` |

---

## 9. Open decisions

| # | Question | Options | Blocks |
| --- | --- | --- | --- |
| ~~**D1**~~ | ~~`ok` and `warn` — what colour?~~ | ✅ **Resolved 2026-08-05 (Ohad): leave `#1F8A4C` / `#8A6100`, delete the "must match web" comment.** | — |
| **D2** | The web dashboard and the app claim to match and do not. Which one moves? | (a) app moves to `tokens.css` · (b) `tokens.css` moves to the app · (c) drop the claim, they are different products | nothing — separate diff |
| **D3** | Should Scale B (operator-documents: 13 / 15 / 17) ever converge on Scale A? | (a) never · (b) later, own spec | nothing |
| **D4** | `DocumentReviewScreen.pillAccent` is `#05BCD3` on `#E4F8FB` = **2.1:1**. Fix it? | (a) darken to `#066B8C` · (b) leave, it is two words in a pill | nothing — separate diff, out of scope here |

D2, D3 and D4 block nothing. All three phases can ship.

---

## 10. Non-goals

- No changes to **what** the tab shows, in what order, or with what words.
- No changes to queries, `operatorDashboardService`, or navigation.
- No changes to `PlanSections.tsx`, `TripDetailViewRedesigned.tsx`, or `DocumentReviewScreen`.
- No changes to `operator-dashboard/` (that is D2).
- No entry animations for the tab. Noted in §6, deliberately not done.
- **No database work.** Nothing here touches Supabase.

---

## 11. Verification

There is no snapshot test for this tab, and per house rules we do not run simulators.

| Step | How | Result 2026-08-05 |
| --- | --- | --- |
| Types | `npx tsc --noEmit \| grep -E "trips/(dashboard/\|PressableScale)"` — the repo has a long tail of pre-existing errors, so grep these paths rather than expecting a clean run | ✅ zero |
| Unit | `npx jest src/services/trips src/screens/trips` | ⚠️ 211/212. The one failure is `tripInvitesService.test.ts` — a mock that does not chain `.eq`. **Pre-existing:** neither that service nor its test is in this diff. |
| No stray sizes | `grep -n "fontSize: 13\|fontSize: 11" src/components/trips/dashboard/TripDashboardTab.tsx` | ✅ zero |
| Dead colours gone | `grep -rn "0E6FA8\|E7F2FA" src/` — the comment explaining the change is an expected hit | ✅ only that comment |
| Untouched neighbours | `git status --short src/components/trips/plan/` — this work must not have edited `PlanSections.tsx` | ✅ not in this diff |
| Device | **PENDING — Ohad.** Open an operator trip as host in Expo Go, switch Overview → Dashboard → Plan, check the three read as one page | ⏳ |

**Device check list:**

1. Section dividers line up in colour and weight across all three tabs.
2. A traveler row and the review screen row it opens look like the same row.
3. The "N waiting" tag and the review screen's pill are the same colour.
4. Tapping the review banner scales smoothly, not in one snap.
5. The money figure no longer dominates the screen.

---

## 12. Risk

Low. Every change is a style value in three files that nothing else imports.

| Risk | Reality |
| --- | --- |
| Text wraps differently at 14 vs 13 | `rowTitle` is `numberOfLines={1}` and already ellipsizes. Banner text has `flex: 1` and wraps freely. |
| Rows get taller | Yes, ~2px per row from the line-height fixes. Intended — it matches the neighbours. |
| `PressableScale` duplicate | Deliberate (§6). Documented in the new file's header. |
| Breaks the web dashboard | Cannot. Separate app, no shared code (`CLAUDE.md`). |
