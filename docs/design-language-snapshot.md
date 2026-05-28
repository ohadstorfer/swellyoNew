# Swellyo Design Language Snapshot

> Source of truth for the redesign of `src/screens/trips/CreateTripFlowA.tsx`.
> Every token below is cited to at least one production-quality screen.
> "Polished screens" = Onboarding steps 1–6+Welcome, ProfileScreen, TripsScreen,
> TripDetailScreen, DirectMessageScreen / ChatScreen, WelcomeScreen.
> Ignored: files with "Copy" in the name.

---

## 1. Color Palette

Token definitions live in `src/styles/theme.ts`.

### Brand / Primary

| Hex | Name in theme | Role | Where used |
|-----|--------------|------|-----------|
| `#0788B0` | `brandTeal` | Primary brand teal — interactive CTAs, links, progress fill (Swelly chat), loading spinners, empty-state CTAs | `TripsScreen.tsx:174,174`, `TripDetailScreen.tsx:1806`, `OnboardingStep1Screen.tsx:342` |
| `#00A2B6` | `brandTealLight` | Lighter teal variant — check icons, `CardSelected` border highlight on lifestyle grid | `OnboardingStep4Screen.tsx:79` (CheckIcon stroke), `OnboardingWelcomeScreen.tsx:314` |
| `#05BCD3` | (inline) | Cyan / celeste — **outbound DM bubbles**, onboarding accent text (Step 3 "Travel Experience" heading), selected lifestyle card border | `DirectMessageScreen.tsx:4559`, `OnboardingStep3Screen.tsx:117`, `OnboardingStep6LifestyleScreen.tsx:614` |
| `#B72DF2` | (inline) | Purple — Swelly AI chat: outbound user bubbles, progress fill on onboarding chat, send-button default | `ChatScreen.tsx:1253`, `ChatScreen.tsx:1205`, `ChatTextInput.tsx:137` |

### Accent

| Hex | Role | Where used |
|-----|------|-----------|
| `#212121` | Near-black — primary "Next" button background in onboarding scaffold | `OnboardingStep1Screen.tsx:405`, `OnboardingStep2Screen.tsx:364` |
| `#222B30` | Dark charcoal — header titles, back arrows, body text on dark headers | `TripsScreen.tsx:462`, `TripDetailScreen.tsx:1699`, `DirectMessageScreen.tsx:4231` |
| `#333333` | Dark text — body copy, message text, bot bubbles | `ChatScreen.tsx:1286`, `DirectMessageScreen.tsx:4623` |

### Neutrals (grays)

| Hex | Role | Where used |
|-----|------|-----------|
| `#FAFAFA` | backgroundGray — default screen bg | `theme.ts:12`, `OnboardingStep1Screen.tsx:252` |
| `#F2F2F2` | Segment bar bg, placeholder image bg, card image placeholder, empty shimmer bg | `TripsScreen.tsx:469`, `TripDetailScreen.tsx:1687` |
| `#F0F2F5` | TripDetail root background (WhatsApp pattern of light gray between white cards) | `TripDetailScreen.tsx:1660` |
| `#FFFFFF` | `white` — card surfaces, bot message bubbles, sheet backgrounds, input backgrounds | `theme.ts:31`, ubiquitous |
| `#EEEEEE` / `#EEE` | Card border in TripsScreen | `TripsScreen.tsx:509` |
| `#E0E0E0` / `#E3E3E3` | Sheet header dividers, picker highlight borders | `HomeBreakViewSheet.tsx:205`, `WelcomeScreen.tsx:1156` |
| `#D0D0D0` / `#D9D9D9` | Sheet drag handle | `HomeBreakViewSheet.tsx:193`, `WelcomeScreen.tsx:1129` |
| `#CFCFCF` | Field border (unfilled), profile picture placeholder border | `OnboardingStep4Screen.tsx:1416`, `OnboardingStep4Screen.tsx:1450` |
| `#BDBDBD` | `progressBackground` — progress bar track | `theme.ts:27` |
| `#B0B0B0` | Empty state icons, placeholder text | `TripsScreen.tsx:122`, `TripsScreen.tsx:196` |
| `#A7B8C2` | Search bar placeholder text | `OnboardingStep6LifestyleScreen.tsx:289` |
| `#7B7B7B` | `textSecondary` — helper text, dates, muted labels | `theme.ts:22`, ubiquitous |
| `#4A5565` | Section headers (uppercase ALL CAPS labels) | `TripsScreen.tsx:496` |

### State Colors

| Hex | Role | Where used |
|-----|------|-----------|
| `#34C759` | Success / checkbox done (green tick) | `TripDetailScreen.tsx:1263` |
| `#4CAF50` | Online presence dot | `DirectMessageScreen.tsx:4332` |
| `#C0392B` | Error / destructive — danger rows, cancelled banner text | `TripDetailScreen.tsx:1188`, `TripDetailScreen.tsx:1788` |
| `#FDECEA` | Error banner background (light red tint) | `TripDetailScreen.tsx:1820` |
| `#E53935` | Error: uploading / failed state text | `DirectMessageScreen.tsx:3588`, `WelcomeScreen.tsx:1144` |
| `#FF6B6B` / `#FF0000` | Input validation error border, required asterisk | `Input.tsx:54`, `OnboardingStep4Screen.tsx:1519` |

### Surfaces (backgrounds / cards)

| Hex | Role | Where used |
|-----|------|-----------|
| `#000000` | WelcomeScreen container bg (behind video), Apple sign-in button | `WelcomeScreen.tsx:1227`, `WelcomeScreen.tsx:1367` |
| `#FFFFFF` | Card surfaces, sheets, modals, input fields | ubiquitous |
| `#F5F5F5` | Chat screen container bg | `ChatScreen.tsx:1073`, `DirectMessageScreen.tsx:4227` |
| `rgba(0,0,0,0.4–0.55)` | Sheet/modal overlay | `HomeBreakViewSheet.tsx:176`, `WelcomeScreen.tsx:1108` |
| `rgba(255,255,255,0.15)` | Terms card (frosted over video) | `WelcomeScreen.tsx:1401` |
| `#E6F4F8` | Brand-tinted icon circle bg (action row in TripDetail), selected chip bg | `TripDetailScreen.tsx:1732` |

---

## 2. Typography Scale

Two font families in use: **Montserrat** (headings) and **Inter** (body). Both loaded via Google Fonts on web; referenced by family name on native.

### Display

| Size | Weight | Family | Role | File:line |
|------|--------|--------|------|----------|
| 32px / lh 38 | 700 | Montserrat | Onboarding accent label (e.g. "Travel Experience") | `OnboardingStep3Screen.tsx:115` |
| 32px / lh 40 | bold | — | `title` token (legacy `Button.tsx` usage) | `theme.ts:62` |

### Heading

| Size | Weight | Family | Role | File:line |
|------|--------|--------|------|----------|
| 28px / lh 36 | 600 | — | `headline` token | `theme.ts:50` |
| 24px / lh 28.8 | 700 | Montserrat | Screen titles (brand-teal color) | `OnboardingStep1Screen.tsx:335` |
| 24px / lh — | 700 | Montserrat | TripDetail title, WelcomeScreen "What are you here for?" | `TripDetailScreen.tsx:1699`, `OnboardingWelcomeScreen.tsx:279` |

### Subheading

| Size | Weight | Family | Role | File:line |
|------|--------|--------|------|----------|
| 22px / lh 32 | 700 | Montserrat | OnboardingWelcome "What are you here for?" | `OnboardingWelcomeScreen.tsx:278` |
| 22px / lh 24 | 700 | Montserrat | Step 3 sub-question | `OnboardingStep3Screen.tsx:124` |
| 21px / lh 28 | 700 | Montserrat | Lifestyle screen title | `OnboardingStep6LifestyleScreen.tsx:506` |
| 20px / lh 24 | 700 | Montserrat | Sheet titles (HomeBreakViewSheet) | `HomeBreakViewSheet.tsx:209` |
| 20px / lh 28 | 700 | Inter | DM chat: other user's name in header | `DirectMessageScreen.tsx:4313` |

### Body

| Size | Weight | Family | Role | File:line |
|------|--------|--------|------|----------|
| 18px / lh 24 | 700 | Montserrat | Board name label, "Add a Picture" heading | `OnboardingStep4Screen.tsx:1383` |
| 18px / lh 22 | 400 | Inter | Chat message text (both Swelly and DM bubbles) | `ChatScreen.tsx:1282`, `DirectMessageScreen.tsx:4616` |
| 18px / lh 24 | 700 | Montserrat | Profile name in chat header | `ChatScreen.tsx:1177` |
| 18px / lh 24 | 400 | Inter | Auth buttons (Apple/Google text on WelcomeScreen) | `WelcomeScreen.tsx:1377` |
| 18px — | 600 | — | Header titles (TripsScreen, TripDetailScreen) | `TripsScreen.tsx:462`, `TripDetailScreen.tsx:1672` |
| 17px / lh 22 | 400 | Inter | DM message text | `DirectMessageScreen.tsx:4616` |
| 16px / lh 22 | 400 | Inter | `body` token, field filled value, standard body | `theme.ts:69` |
| 16px / lh 24 | 700 | Montserrat | "Next" button text in onboarding | `OnboardingStep1Screen.tsx:409` |

### Caption / Label / Small

| Size | Weight | Family | Role | File:line |
|------|--------|--------|------|----------|
| 15px / lh 20 | 400 | Inter | Field placeholder (unfilled) | `OnboardingStep4Screen.tsx:1465` |
| 14px / lh — | 400 | Inter | Step counter ("1 / 6"), dates on cards, muted metadata | `TripsScreen.tsx:532`, `OnboardingStep1Screen.tsx:286` |
| 14px / lh 18 | 400 | Inter | Lifestyle subtitle, "bodySmall" | `theme.ts:77` |
| 13px / lh 15 | 300 | Inter | Timestamp in DM | `DirectMessageScreen.tsx:4638` |
| 12px / lh 15 | 400 | Inter | Profile tagline in chat header | `ChatScreen.tsx:1185` |
| 12px / lh — | 700 | — | Section headers (uppercase) in TripDetail, TripsScreen segment labels | `TripDetailScreen.tsx:1752`, `TripsScreen.tsx:485` |
| 11px | 700 | — | Badge text, tag text | `TripsScreen.tsx:524`, `TripsScreen.tsx:542` |

---

## 3. Spacing & Radius Tokens

Spacing scale lives in `src/styles/theme.ts:37`.

```
xs:   4px
sm:   8px
md:  16px
lg:  24px
xl:  32px
xxl: 40px
xxxl: 60px
xxxxl: 80px
```

### Recurrent padding / margin values (inline, not in token)

| Value | Context | File:line |
|-------|---------|----------|
| 4px | Card body padding-vertical for badge, `hitSlop` common value | `TripsScreen.tsx:515` |
| 6px | Dot gap, tag padding-vertical | `OnboardingStep1Screen.tsx:430`, `TripsScreen.tsx:537` |
| 8px | Tag/chip padding-horizontal, card body padding | `TripsScreen.tsx:515,529` |
| 10px | Card body padding, message bubble padding-horizontal | `TripsScreen.tsx:529`, `DirectMessageScreen.tsx:4554` |
| 12px | Card body padding in TripsScreen, sheet header gap, field gap in form | `TripsScreen.tsx:529`, `TripDetailScreen.tsx:1744` |
| 14px | Action button padding-vertical in TripDetail | `TripDetailScreen.tsx:1802` |
| 16px | `md` = standard screen gutter; also chat bubble padding-horizontal | ubiquitous |
| 18px | Form field gap in OnboardingStep4 | `OnboardingStep4Screen.tsx:1435` |
| 24px | `lg` = standard section gap; bottom padding on sheets | ubiquitous |

### Border radius scale

| Value | Role | File:line |
|-------|------|----------|
| `borderRadius.small = 8` | Input borders, small chips, section dividers | `theme.ts:96` |
| `borderRadius.medium = 16` | Cards (TripsScreen), message bubbles, sheets, image borders | `theme.ts:97`, `TripsScreen.tsx:504`, `TripDetailScreen.tsx:1803` |
| `borderRadius.large = 25` | Legacy `Button.tsx` | `theme.ts:98` |
| 10px | Small card badges, cancel banner, segment btn | `TripsScreen.tsx:520`, `TripDetailScreen.tsx:1820` |
| 12px | Auth button (Apple/Google), field container in onboarding step 4, modals | `WelcomeScreen.tsx:1369`, `OnboardingStep4Screen.tsx:1449` |
| 14px | CTA button in TripDetail | `TripDetailScreen.tsx:1803` |
| 16px | Lifestyle card outer radius, sheet bottom-sheet corner | `OnboardingStep6LifestyleScreen.tsx:596`, `HomeBreakViewSheet.tsx:180` |
| 18px | Create landing card in TripsScreen | `TripsScreen.tsx:565` |
| 24px | Age sheet border-top-radius | `WelcomeScreen.tsx:1119` |
| 28px | Onboarding "Next" button (height 56 / radius 28 = pill) | `OnboardingStep1Screen.tsx:403` |
| 32px | Search bar in lifestyle grid (full pill) | `OnboardingStep6LifestyleScreen.tsx:539` |

### Container widths (fixed / max)

| Value | Role | File:line |
|-------|------|----------|
| 237px | Progress bar width (all onboarding steps) | `OnboardingStep1Screen.tsx:322`, `theme` progress usage |
| 300px | Progress bar desktop | `OnboardingStep2Screen.tsx:45` |
| 330–357px | Form container max-width (step 4) | `OnboardingStep4Screen.tsx:1546`, `OnboardingStep4Screen.tsx:1361` |
| 345px | Welcome journey cards grid max-width | `OnboardingWelcomeScreen.tsx:296` |
| 346px | WelcomeScreen auth buttons container | `WelcomeScreen.tsx:1362` |
| 400px | Desktop button container max-width | `OnboardingStep1Screen.tsx:113` |
| 800px | Desktop content max-width | `OnboardingStep1Screen.tsx:264` |

### Gap values (Flexbox gap)

| Value | Context | File:line |
|-------|---------|----------|
| 4px | Header copy stack gap | `OnboardingStep6LifestyleScreen.tsx:504` |
| 6px | Search bar icon gap, action row | `OnboardingStep6LifestyleScreen.tsx:536` |
| 8px | Lifestyle grid gap (`GRID_GAP`), card grid, checkbox row | `OnboardingStep6LifestyleScreen.tsx:24` |
| 10px | TripDetail action row | `TripDetailScreen.tsx:1808` |
| 12px | DM header left | `DirectMessageScreen.tsx:4256` |
| 14px | Step 3 title block | `OnboardingStep3Screen.tsx:113` |
| 16px | Welcome journey cards grid, auth buttons | `OnboardingWelcomeScreen.tsx:295`, `WelcomeScreen.tsx:1365` |
| 18px | Step 4 form fields | `OnboardingStep4Screen.tsx:1435` |

---

## 4. Component Catalog

### Primary Button (filled, brand dark)

**Visual:** Full-width pill (radius 28, height 56), `#212121` background, white bold text 16px/700/Montserrat. Active opacity 0.8. Disabled at 0.6 opacity. Lives in a sticky footer below scrollable content.

**Canonical:** `src/screens/OnboardingStep1Screen.tsx:398–414` (`gradientButton` style) — used across all onboarding steps via the shared scaffold (`OnboardingScaffold` / `OnboardingStepContext`).

**Props/variants:**
- Default label: "Next"
- Final step: "Create Profile"
- Loading: label changes to "Loading..."
- Disabled: `opacity: 0.6` (via `canProceed` flag in context)
- Legacy generic button: `src/components/Button.tsx` — use `colors.buttonBackground` (#FFE4E1) which is the old brown palette; NOT the current design.

---

### Auth Buttons (WelcomeScreen only)

**Visual:** Full-width (346px container), height 54, radius 12. Apple = black bg + white text. Google = white bg + #7B7B7B text. Icon 24px left-aligned with 15px margin-right. Font: Inter 400 20px.

**Canonical:** `src/screens/WelcomeScreen.tsx:1360–1396`.

---

### Secondary Button (outlined / ghost)

**Visual:** In TripDetail: `ctaWithdraw` — white bg, `border: 1px solid #DDD`, same height/radius as primary CTA. Text `#555` 14px/600.

**Canonical:** `src/screens/trips/TripDetailScreen.tsx:1811`.

---

### Tertiary / Text Button

**Visual:** Plain `TouchableOpacity` with colored text only. Used as "Skip" (hidden in most steps with `opacity: 0`), section "Manage" link buttons, and "Missing something? Request item" link rows in TripDetail.

**Canonical:** "Manage" button in TripDetail: `src/screens/trips/TripDetailScreen.tsx:1134`. "Request item" link: line 1162.

---

### Text Input (single line)

**Visual:** Height 56, radius 12, border 1px `#CFCFCF`, white bg. Left: pencil SVG icon. Right: cyan checkmark SVG when filled. Placeholder text: `#7B7B7B` / 15px/400. Filled text: `#333` / 18px/400. Font Inter. Padding-horizontal 16.

**Canonical:** `Field` component in `src/screens/OnboardingStep4Screen.tsx:99–202`. This uses `react-native-paper` `TextInput` with `mode="flat"` + transparent bg.

**Variants:**
- Error state: border turns `#FF0000`
- Filled state: larger font (18px), dark `#333`
- Country picker: same container but renders `Text` instead of `TextInput` (tap opens modal)

---

### Multi-line Input / Textarea

**Visual:** Same border style. Used in TripDetail for packing list and admin updates: `borderWidth: 1`, `borderColor: '#DDD'`, `borderRadius: 8`, `padding: 10` all sides, `fontSize: 14`, `color: '#222B30'`, `backgroundColor: '#FFFFFF'`.

**Canonical:** `src/screens/trips/TripDetailScreen.tsx:1857–1866` (`groupEditInput` / `packingTextarea` styles), `TripDetailScreen.tsx:1203–1210` (packing textarea).

---

### Picker-style Input (tap to open sheet)

**Visual:** Identical to `Field` single-line container (height 56, radius 12, border `#CFCFCF`). Shows a label/placeholder when empty; tapping opens a full-screen or bottom-sheet picker.

**Examples:**
- Country field → `CountrySearchModal` (full-screen): `OnboardingStep4Screen.tsx:264–286`
- Home break → `HomeBreakSearchSheet` (bottom sheet): `OnboardingStep4Screen.tsx:1126–1148`
- DOB → scroll-wheel picker sheet: `OnboardingStep4Screen.tsx:304+`

---

### Card (content card — trip list)

**Visual:** White bg, `borderRadius: 14`, `borderWidth: 1`, `borderColor: '#EEE'`, `marginBottom: 14`, `overflow: 'hidden'`. Image 160px tall at top (16:10 ratio). Body: `padding: 12`, badge row, title 16/600, destination 14/regular, dates 13/regular, tag row at bottom.

**Canonical:** `TripCard` in `src/screens/trips/TripsScreen.tsx:106–149`. Styles: `TripsScreen.tsx:502–542`.

**Variants:**
- Past trips: `opacity: 0.6` (`cardPast` style)
- Badge: small filled pill top-left of body — black bg for "Approved", `#D1D5DC` bg for "Completed"

---

### Card (selection card — onboarding journey / lifestyle)

**Visual:** White bg, `borderRadius: 16`, `padding: 6–8px`, `borderWidth: 2`, `borderColor: transparent` (becomes `brandTeal`/`#05BCD3` when selected). Shadow: `{ color: '#596E7C', offset: {0,2}, opacity: 0.15, radius: 16 }`. Checkbox (20×20 circle) top-right of image. Image section fills ~108–104px height with `borderRadius: 8`.

**Canonical:**
- Journey cards: `OnboardingWelcomeScreen.tsx:297–348`
- Lifestyle grid cards: `OnboardingStep6LifestyleScreen.tsx:593–629`

---

### Bottom Sheet

**Visual:** `borderTopLeftRadius: 16`, `borderTopRightRadius: 16`, white bg, `paddingBottom: 24`. Drag handle: 40×4px, `backgroundColor: '#D0D0D0'`, `borderRadius: 2`, centered, `marginTop: 8`. Backdrop: `rgba(0,0,0,0.5)`. Shadow on sheet: `{ color: '#000', offset: {0,-4}, opacity: 0.15, radius: 20, elevation: 10 }`.

**Animation:** `Animated.spring` up (tension 65, friction 11). Dismisses via: (a) swipe-down > 100px or velocity > 0.5, (b) backdrop tap. Drag-distance directly controls `translateY` via `sheetAnim.setValue`.

**Canonical:** `HomeBreakViewSheet.tsx:76–236`. Age verification sheet: `WelcomeScreen.tsx:1106–1222` (borderTopRadius 24, no drag handle interaction — close-only on error).

---

### Modal (full-screen slide)

**Visual:** `Modal` with `animationType="slide"`, `presentationStyle="fullScreen"`. `SafeAreaView` with `edges={['top']}` and `backgroundColor: '#FFFFFF'`. Header row: close (×) icon left, optional title center, spacer right.

**Canonical:** Create trip modal in `TripsScreen.tsx:423–447`. Styles: `TripsScreen.tsx:587–596`.

**Discard guard:** Uses `Alert.alert` with "Discard / Keep editing" when user presses close mid-flow (`TripsScreen.tsx:322–332`).

---

### Header Bar (back arrow + title)

**Visual:** `flexDirection: 'row'`, `alignItems: 'center'`, `justifyContent: 'space-between'`. Back button: `<Ionicons name="chevron-back" size={28} color="#222B30" />` with `padding: 4`, `hitSlop: {10,10,10,10}`. Title: `fontSize: 18, fontWeight: '600', color: '#222B30'`. Placeholder `View` width 28 on the right to center the title. `paddingHorizontal: 16`, `paddingBottom: 12`.

**Canonical:** `TripsScreen.tsx:383–390`. `TripDetailScreen.tsx:1597–1604`.

**Dark variant (DM chat):** Same back arrow but header container `backgroundColor: '#212121'`, avatar row 52px, name 20/700 `#FFFFFF`, tagline 14/400 `#A0A0A0`. Bottom border: 4px teal `#05BCD3` stripe. `src/screens/DirectMessageScreen.tsx:4230–4346`.

---

### List Item (trip participant / gear row)

**Visual:** `flexDirection: 'row'`, `alignItems: 'center'`, `paddingVertical: 6` (infoRow). Hairline divider `StyleSheet.hairlineWidth` `#ECECEC` with left indent (`marginLeft: 60`).

**Canonical:** `InfoRow` in `TripDetailScreen.tsx:138–143`. Packing row: `TripDetailScreen.tsx:1252–1270`.

---

### Chip / Tag

**Visual:** `backgroundColor: '#F2F2F2'`, `paddingHorizontal: 8`, `paddingVertical: 4`, `borderRadius: 8`, `marginRight: 6`, text `fontSize: 11, color: '#555', fontWeight: '500'`.

**Active/selected chip (TripDetail packing toggle):** `borderWidth: 1, borderColor: '#0788B0', backgroundColor: '#E6F4F8'`. Text `color: '#0788B0'`.

**Canonical:** `TripCard` tags: `TripsScreen.tsx:533–542`. Toggle chips: `TripDetailScreen.tsx:1838–1850`.

---

### Segmented Control / Tab Bar

**Visual:** `backgroundColor: '#F2F2F2'`, `borderRadius: 10`, `padding: 4`, `marginHorizontal: 16`. Each segment: `flex: 1`, `paddingVertical: 10`, `borderRadius: 8`. Active segment: white bg + shadow `{opacity: 0.08, radius: 4, offset: {0,2}, elevation: 2}`. Label: `fontSize: 12, fontWeight: '600', letterSpacing: 0.5`. Inactive label: `#7B7B7B`. Active label: `#222B30`.

**Canonical:** `TripsSegmentBar` in `TripsScreen.tsx:40–68`. Styles: `TripsScreen.tsx:464–487`.

---

### Progress Bar (onboarding)

**Visual:** `height: 4`, `width: 237px`, `backgroundColor: '#BDBDBD'`, `borderRadius: 8`, `overflow: 'hidden'`. Fill: `backgroundColor: colors.progressFill` (`#333333`) for onboarding steps; `#B72DF2` for Swelly chat; `#0788B0` for TripDetail indicator.

**Canonical:** Inline style block in every onboarding step + `ProgressBar.tsx` component (legacy). Active in `ChatScreen.tsx:1196–1211`. Token definition: `theme.ts:26–29`.

---

### Progress Dots (carousel)

**Visual:** Active dot: `width: 24, height: 8, borderRadius: 4, backgroundColor: '#0788B0'`. Inactive dot: `width: 8, height: 8, borderRadius: 4, backgroundColor: '#CFCFCF'`. Gap between dots: `gap: 6`. Row: `flexDirection: 'row'`, centered.

**Canonical:** `OnboardingStep1Screen.tsx:426–444`.

---

### Hero Image / Banner

**Visual:** `width: '100%'`, `height: 160` on cards, `height: 220` on TripDetail top card. `backgroundColor: '#F2F2F2'` as placeholder. Placeholder shows `<Ionicons name="image-outline" size={32/40} color="#B0B0B0" />` centered.

**Canonical:** TripCard: `TripsScreen.tsx:527`. TripDetail: `TripDetailScreen.tsx:1687`.

---

### Empty State

**Visual:** `alignItems: 'center'`, `justifyContent: 'center'`, `paddingVertical: 64`. Icon: `<Ionicons size={48} color="#B0B0B0" />`. Text: `fontSize: 14, color: '#7B7B7B', marginTop: 12, textAlign: 'center'`. Optional CTA: `backgroundColor: '#0788B0'`, `borderRadius: 10`, `paddingHorizontal: 20, paddingVertical: 10`. CTA text: white/600.

**Canonical:** `TripsScreen.tsx:193–201` (Explore), `TripsScreen.tsx:252–261` (My Trips).

---

### Loading State

**Visual:** `<ActivityIndicator color="#0788B0" />` centered in `flex: 1` container.

**Canonical:** `TripsScreen.tsx:170–176`. TripDetail: `TripDetailScreen.tsx:840–850`.

Skeleton / shimmer loader also available:
- `src/components/skeletons/Shimmer.tsx` — horizontal sweep (1500ms loop) or opacity pulse (reduced-motion).
- Skeleton primitives: `src/components/skeletons/SkeletonPrimitives.tsx`.
- Used in: `ProfileSkeleton`, `MessageSkeleton`, `ConversationSkeleton`.

---

### Error State / Alert

**Visual:** In-screen error banner (TripDetail cancelled): horizontal row, `borderRadius: 10`, `backgroundColor: '#FDECEA'`, icon + text `color: '#C0392B'`, `fontSize: 13/500`.

For form errors: red border (`#FF0000`) on field + small red text 12px below field.

`Alert.alert` (RN native) for destructive confirmations.

**Canonical:** Cancelled banner: `TripDetailScreen.tsx:1816–1828`. Field error: `OnboardingStep4Screen.tsx:1519–1529`.

---

### Typing Indicator (chat)

**Visual:** 3 dots, each `width: 8, height: 8, borderRadius: 4, backgroundColor: '#333333'`, `gap: 4`. Each dot animates `opacity` 0.3→1 in staggered 200ms steps, looping at 400ms per phase.

**Canonical:** `ChatScreen.tsx:60–119`. Identical implementation in `DirectMessageScreen.tsx:2810–2877`.

---

### Message Bubble

**DM outbound (own):** `backgroundColor: '#05BCD3'`, border-radius: `16 2 16 16` (top-right pointy). Text: white 17px/400/Inter.

**DM inbound (other):** `backgroundColor: '#FFFFFF'`, border-radius: `16 16 2 16` (bottom-left pointy). Text: `#333333` 17px/400/Inter.

**Swelly chat outbound:** `backgroundColor: '#B72DF2'`, same corner pattern. Text: white 18px/400/Inter.

**Swelly chat inbound:** White bg, `16 2 16 16` (top-left pointy). Text: `#333333` 18px/400/Inter.

Timestamp inside bubble: 13px/300/Inter. `Reanimated` `LinearTransition.duration(240)` for inline-layout adjustments.

**Canonical:** `DirectMessageScreen.tsx:4550–4593` (styles). `ChatScreen.tsx:1252–1273`.

---

### Search Bar

**Visual:** `height: 48`, `paddingHorizontal: 16`, `borderRadius: 32` (full pill), `borderWidth: 1`, `borderColor: '#D5D7DA'`, `backgroundColor: '#FFFFFF'`. Left: `<Ionicons name="search" size={20} color="#A7B8C2" />`. Right: clear icon when text present. Input: 14px/400/Inter.

**Canonical:** `OnboardingStep6LifestyleScreen.tsx:282–300`. Style: lines 533–553.

---

### Chat Input (composer)

**Visual:** Auto-expanding textarea, min 1 line / max 5 lines. Container: no explicit border, sits above keyboard. Send button: circle in `primaryColor` with white arrow SVG. Mic replaces send when text empty (native only). Left accessory slot (file picker / attach icon).

**Canonical:** `src/components/ChatTextInput.tsx`. Default `primaryColor = '#B72DF2'` (Swelly). DM uses `composerPrimaryColor` which adapts to user's role.

---

## 5. Interaction Patterns

### Keyboard Handling

- **Swelly chat + DM:** `useReanimatedKeyboardAnimation` (react-native-keyboard-controller) animates a Reanimated `paddingBottom` on the chat content. This is NOT `KeyboardAvoidingView`. `keyboardShouldPersistTaps="handled"` on FlatList so bubbles/chips can be tapped while keyboard is open. `ChatScreen.tsx:1014`, `DirectMessageScreen.tsx:3947`.
- **Onboarding Step 4 (form):** `KeyboardAwareScrollView` from `react-native-keyboard-aware-scroll-view`, `extraHeight: 180`, `keyboardShouldPersistTaps="handled"`. `OnboardingStep4Screen.tsx:1032–1048`.
- **DM (Android):** `KeyboardGestureArea` wraps the inner chat so dragging from inside the composer moves the keyboard 1:1 (like WhatsApp). iOS uses native interactive dismiss. `DirectMessageScreen.tsx:3811`.
- **Dismiss on backdrop:** `Keyboard.dismiss()` is called explicitly in Next/back handlers and field selection. No `TouchableWithoutFeedback` wrapper on full screen.
- **keyboardDismissMode:** `"interactive"` on iOS, `"on-drag"` on Android Expo Go, `"interactive"` on Android with `KeyboardGestureArea`.

### Sheet Dismissal

- **Drag-down:** All bottom sheets use `PanResponder`; threshold 100px vertical or velocity > 0.5. `HomeBreakViewSheet.tsx:86–100`.
- **Backdrop tap:** `TouchableWithoutFeedback` over the overlay calls `onClose`. `HomeBreakViewSheet.tsx:133`.
- **Spring animation:** Sheet appears with `Animated.spring` (tension 65, friction 11). Dismisses with `Animated.timing` (200ms). `HomeBreakViewSheet.tsx:106–114`.

### Sticky Footer with Scrollable Content

All onboarding steps use this pattern: content is `flex: 1` in a `View` that fills available space (after header + progress bar). The sticky "Next" button is rendered outside the scroll area in the scaffold at a fixed bottom position, not inside a `ScrollView`. `OnboardingStep4Screen.tsx:1530–1548`.

### Modal Discard Guard

`Alert.alert` with "Keep editing" (cancel) and "Discard" (destructive) before closing a modal that has received user input. `TripsScreen.tsx:324–332`.

### Transitions / Animations

- **New message enter:** `Reanimated` `entering` animation — own sends "slide up from composer", received slide up from typing-indicator height. `DirectMessageScreen.tsx:2927–2937`.
- **Read receipts:** `FadeIn.duration(220)` on the double-tick icon. `DirectMessageScreen.tsx:94`.
- **Layout adjustments:** `LinearTransition.duration(240)` on bubble content when edit/delete states toggle. `DirectMessageScreen.tsx:3443`.
- **Welcome screen logo:** Spinning `Animated.Value` during auth-check (`rotate` transform). `WelcomeScreen.tsx:856`.
- **Sheet entrance:** `Animated.spring` with `Animated.parallel` (overlay fade + sheet translate). `HomeBreakViewSheet.tsx:106`.
- **Onboarding progress bar:** CSS `transition: 'width 0.3s ease'` on web only. `ChatScreen.tsx:1207`.

### Haptic Feedback

No explicit haptic calls found in polished screens. Not part of the current language.

---

## 6. Copy / Voice Patterns

### Case
- **Screen titles** (header): Sentence case — "Trips", "Trip" (not "TRIPS"). `TripsScreen.tsx:387`.
- **Tab labels** (segment bar): ALL CAPS — "MY TRIPS", "EXPLORE", "CREATE". `TripsScreen.tsx:44–47`.
- **Section headers** (within card): ALL CAPS, `letterSpacing: 0.5` — "APPROVED", "PENDING APPROVAL", "MEMBERS", "YOUR GEAR". `TripsScreen.tsx:494`, `TripDetailScreen.tsx:1752`.
- **Button labels**: Sentence case, verb-first — "Next", "Create Profile", "Request to join", "Create your first trip", "Request pending". `TripDetailScreen.tsx:1652`.
- **Onboarding questions**: Sentence case, direct question — "What is your style?", "How many surf trips have you taken?". `OnboardingStep1Screen.tsx:203`.

### Helper Text
- Short, lowercase sentence: "Pick at least 3!", "Sharing the board you ride creates more aligned connections." — friendly, informal. `OnboardingStep1Screen.tsx:207`, `OnboardingStep6LifestyleScreen.tsx:279`.
- Positioned directly below the title, `color: '#7B7B7B'`, 14–16px Inter/400.

### Error Tone
- Direct, no blame: "Please select at least two options for your surf journey." `OnboardingWelcomeScreen.tsx:93`.
- Terse inline: Field border turns red, small text "You need to add..." — shown only after submit attempt.
- Network errors: `Alert.alert('Error', 'Failed to send message. Please try again.')` — short, actionable. `ChatScreen.tsx:574`.

### Swelly AI Greeting
- Informal first-person: "Yo {name}!" — name-first, casual, surf culture voice. `OnboardingWelcomeScreen.tsx:143`.
- Bot tagline: "Let's grow your surf travel community!" — present tense, action-forward. `ChatScreen.tsx:994`.

### Empty State Messages
- First sentence explains the state: "No group trips yet. Be the first to create one!" `TripsScreen.tsx:197`.
- If there's an action available, a CTA follows: "Create your first trip". `TripsScreen.tsx:258`.

---

## 7. Polish Moments

### OnboardingWelcomeScreen — "Yo {name}!" greeting
The screen addresses the user by name in 24px bold teal Montserrat. The greeting responds to the user's actual nickname (fetched from context), making the flow feel personal on step 0 (pre-profile). The 2×2 image-card grid with checkmark selection and brandTeal border glow on selection is visually tight and satisfying. `OnboardingWelcomeScreen.tsx:143,154–183`.

### DirectMessageScreen — Inline timestamp / spacer technique
The DM bubble uses an invisible "spacer" span at the same font size as the timestamp to reserve space at the end of the last line of text, so the absolute-positioned timestamp always sits flush at the bottom-right of the bubble without ever clipping over body text — exactly the Telegram / WhatsApp approach, hand-implemented in RN. The `LinearTransition.duration(240)` makes edits and deletes animate the layout instead of jumping. `DirectMessageScreen.tsx:3487–3545`.

### TripDetailScreen — WhatsApp-style layout pattern
The screen intentionally mirrors WhatsApp group-info UX: a light-gray root (`#F0F2F5`), white sectioned cards with 12px vertical margin between them, hairline dividers inside lists, and circular icon buttons (48px, `#E6F4F8` bg, `#0788B0` icon) for actions. This familiar information architecture requires zero learning curve. `TripDetailScreen.tsx:1660,1717–1748`.

### TripsScreen — Create landing card
The "CREATE" tab's landing state shows a single full-width teal card (`#0788B0`, `borderRadius: 18`, large shadow) with a centered `add-circle` icon and two-line headline. This is intentionally sparse — one clear CTA, no noise — and the brand-colored card makes it feel like a premium action. `TripsScreen.tsx:407–420`.

### ChatScreen — Typing indicator timing
After the AI responds with UI hints (destination cards, budget buttons), a deliberate 3-second delay shows the typing indicator before the interactive carousel appears. This makes the AI feel like it's "thinking" and adds anticipation before the interactive element drops in. `ChatScreen.tsx:598–619`.

### OnboardingStep6 — Lifestyle card grid performance
The 75+ card grid uses `React.memo` with a custom comparator (checking 6 props explicitly) so toggling one card causes exactly 1 re-render, not 75. The search debounce (150ms) keeps the input instant while the grid computation is deferred. `OnboardingStep6LifestyleScreen.tsx:374–386, 111`.

---

## Key Files Reference

| File | Role |
|------|------|
| `src/styles/theme.ts` | Color, spacing, typography, radius, shadow tokens |
| `src/components/Button.tsx` | Legacy button (not current design — uses old brown palette) |
| `src/components/Input.tsx` | Legacy input (not current design — uses old palette) |
| `src/components/ChatTextInput.tsx` | Canonical chat composer |
| `src/components/HomeBreakViewSheet.tsx` | Canonical bottom sheet pattern |
| `src/components/ProgressBar.tsx` | Legacy progress bar (not used in active screens — inline styles preferred) |
| `src/components/skeletons/Shimmer.tsx` | Loading shimmer primitive |
| `src/screens/OnboardingStep1Screen.tsx` | Board carousel, dots, canonical "Next" button pill |
| `src/screens/OnboardingStep4Screen.tsx` | Form fields (pencil icon + check icon pattern) |
| `src/screens/OnboardingStep6LifestyleScreen.tsx` | Selection card grid + search bar |
| `src/screens/OnboardingWelcomeScreen.tsx` | 2×2 journey selection cards |
| `src/screens/WelcomeScreen.tsx` | Auth buttons, age-verification sheet, background-video layout |
| `src/screens/trips/TripsScreen.tsx` | Segmented tab bar, trip cards, empty state, create CTA |
| `src/screens/trips/TripDetailScreen.tsx` | WhatsApp-style section layout, action row, sticky CTA |
| `src/screens/ChatScreen.tsx` | Swelly AI chat bubbles, typing indicator, progress bar |
| `src/screens/DirectMessageScreen.tsx` | DM bubbles, inline timestamp, dark header, keyboard handling |

---

## Gotchas

1. **Two color stacks co-exist.** `theme.ts` has an old brown/peach palette (`primary: '#8B4513'`, `buttonBackground: '#FFE4E1'`) used by `Button.tsx` and `Input.tsx`. Those components are NOT used in any polished screen. The new design uses inline hex values in each screen. The redesign should follow the inline hex values, not the legacy token names.

2. **Progress bar fill varies by context.** Onboarding steps use `#333333`. Swelly AI chat uses `#B72DF2`. TripDetail uses `#0788B0`. Pick `#0788B0` for any new trip flow.

3. **Font family references are platform-conditional everywhere.** `Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat'`. Don't reference `System` for display text — it falls through to the native default.

4. **The `ProgressBar` component (`src/components/ProgressBar.tsx`) is unused in polished screens.** Onboarding steps render progress bars inline with custom styles. For the trip flow, replicate the inline pattern.

5. **`colors.buttonBackground` (`#FFE4E1`) is the old design.** Never use it in new screens. Use `#212121` for primary or `#0788B0` for brand-teal CTA.

6. **Bottom sheet drag handle is 40×4px, NOT 36×4 or 48×4.** Multiple sheets use 40×4 consistently. Keep this.

7. **`SafeAreaView edges={['top']}` is preferred** over `edges={['top', 'bottom']}` — bottom insets are handled by padding on the sticky footer. `TripsScreen.tsx:382`.
