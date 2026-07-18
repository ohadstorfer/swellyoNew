# UX Audit — TRIPS domain (Swellyo)

Senior product-designer review of the group-surf-trips experience: browse/explore, create wizard, trip detail, membership, gear/packing, commitments, updates, and the legacy surftrips detail screen. Bar = WhatsApp / Instagram polish.

Legend: 🔴 Critical · 🟠 High · 🟡 Medium · 🔵 Low

---

## Top 5 most impactful fixes

1. 🔴 **Network failure on trip-detail load = infinite skeleton, no retry.** `TripDetailScreen.tsx:1298-1305` shows `TripDetailSkeleton` for BOTH "loading" and "failed with no cached data"; `coreQuery.isError`/`refetch` are never consulted. A user who taps a trip on a flaky connection is stuck on a shimmer forever. Add an error branch with a "Try again" button. (Explore's cold-load error state at `TripsScreen.tsx:981-991` is the pattern to copy.)

2. 🔴 **Create wizard has no progress indicator and no Android hardware-back handling.** 5–6 steps (`CreateTripFlowA.tsx:1237-1241`) but the chrome renders no step counter — it's an explicit no-op (`CreateTripWizardChrome.tsx:98-99`). And there's no `BackHandler`, so Android system-back bypasses the "exit?" confirm and the draft flush. Users can't tell how long the flow is and can lose the last edit.

3. 🔴 **"Leave trip" and "Remove participant" are awaited with dead loading states.** `TripDetailScreen.tsx:861-890` / `:770-799` `await` the REST round-trip, but the `leaving` and `removingUserId` states they set are never read in render — so the app sits silently through the network call with zero feedback. Make both optimistic (the join/withdraw handlers on the same screen already do this correctly).

4. 🔴 **Non-members can "Request to join" a past/ended trip.** `showJoinCta` (`TripDetailScreen.tsx:1319-1321`) checks `!isCancelled` but not `isLocked`/`isTripPast`, so a trip that ended by date still shows the black join button. Add `&& !isLocked`.

5. 🟠 **No pull-to-refresh on trip detail, and the gear/updates/members "view all" screens show false empty states on a cold cache.** Trip detail (`TripDetailScreen.tsx:1471`) relies solely on realtime; if it drops there's no manual refresh. The sub-screens (`PackingAndGearScreen`, `TripUpdatesScreen`, `TripMembersScreen`, `YourGearScreen`) read react-query cache seeded by TripDetail but none check `isLoading` — deep-linked from a notification they'd briefly render "No items yet" / "No updates yet" / "No members yet" instead of a skeleton.

---

## TripsScreen — Explore / My Trips / Create tabs (`TripsScreen.tsx`)

### Loading states
- 🟢 **Good — deliberate skeleton vs. spinner separation.** Explore renders `ExploreDeckSkeleton` only for the deck while the static title/chips show immediately (`:1028-1032`); My Trips uses `MyTripsSkeleton` (`:1146-1148`). Cached/stale-while-revalidate means re-entry is instant (`refetchOnMount:false`, `useTripQueries.ts:95-96,143-144`).
- 🟢 **Good — pagination footer.** The deck shows `ExploreDeckSkeleton` in `ListFooterComponent` while fetching the next page (`:766-768`).

### Error & failure handling
- 🟢 **Good — Explore cold-load error state with retry** (`:981-991`): offline icon + "Couldn't load trips. Check your connection." + Retry button. This is the model the trip-detail screen is missing.
- 🟠 **My Trips has no error state.** `useMyTrips` exposes no error handling in `MyTripsView`; on a failed cold load it falls through to `isLoading` false + empty `tagged` and renders the "You haven't joined or created any trips yet" empty state (`:1150-1160`) — misleading the user into thinking they have no trips when the fetch actually failed. Fix: branch on the query's `isError` like Explore does.

### Empty states
- 🟢 **Good, and correctly differentiated.** Explore distinguishes true-empty catalogue ("No group trips yet. Be the first to create one!", `:996-1003`) from filtered-empty ("No trips match these filters.", `:1036-1039`) which keeps the chips visible. My Trips empty has a "Create your first trip" CTA (`:1150-1160`).

### Feedback
- 🟡 **My Trips pull-to-refresh spinner flashes on background refetches.** `refreshing={isFetching && !isLoading}` (`:1204-1205`) shows the spinner for ANY background refetch (realtime invalidation, post-create), not just a user pull. Explore deliberately avoided this with a separate `pullRefreshing` state (`:952-956`). Fix: mirror Explore's dedicated pull-refresh flag.
- 🔵 **No haptic on tab / filter-pill switches.** The header tabs and filter pills are pure `TouchableOpacity` (`:113-125`, `:345-361`) with no selection haptic — a small polish gap vs. the tactile feel of IG/WhatsApp tab bars.

### Create flow (chooser)
- 🟢 **Good — Android overflow handling.** The 3 hosting-style cards compact themselves when they'd overflow (`:1348-1352`, `chooserCompact`), and there's a draft-resume prompt ("Continue your trip?", `:1363-1396`).
- 🟡 **Draft-resume uses `window.confirm` on web** (`:1371-1378`) — functional but jarring vs. the native Alert used on mobile; acceptable given web is secondary.

### Cards / UI polish
- 🟢 **Strong card design** — glass panel + noise texture, host row, participant cluster with `+N` overflow, per-hosting-style gradient pills, occupancy `count/max`, spots-left. Currency is viewer-aware (₪ for Israel via frozen FX, `formatTripPrice` `:381-386`).
- 🟡 **Explore card exposes capacity ("2 spots left") but My Trips card does not.** `TripCard` (`:203-322`) shows only a status badge + date, no spots-left/occupancy, so a user browsing their joined trips gets no capacity signal. Minor inconsistency.
- 🔵 **`formatTripDates` "(flexible)" suffix** is concatenated into the same string (`:138-139`) with no visual distinction — reads as part of the date.

### Performance-perceived
- 🟢 **Good — genuinely careful deck.** Native-driver scroll transforms so the tilt never freezes when JS is busy (`:747-759`); viewport-window prefetch of hero + avatar thumbnails for neighbours (`:622-633`, `deckPrefetch.ts`); blur-up hero placeholder from a 24px transform (`:409-412`); windowing (`initialNumToRender:2`) to avoid the Yoga layout spike on tab activation (`:727-730`). This is above the bar.
- 🔵 The `scrollEventThrottle={16}` JS listener on the deck only re-fires the prefetch every 24px (`:753`) — already optimized; noted for completeness.

---

## TripDetailScreen (`TripDetailScreen.tsx`)

### Loading states
- 🟢 **Good — skeleton + header always visible** (`:1275-1282`); header seeded from list cache and `membershipKnown` gates member-only chrome so there's no "Request to Join" flash on placeholder data (`:363`).
- 🟡 **No section-level loading for participants / gear / updates / requests.** These default to `[]` while their secondary queries resolve (`:341,370,373,376`), so on a placeholder-seeded open the Plan tab and Members render as empty/zero, then pop in. Add inline shimmer rows per section.
- 🔵 **`buildTripDetailVM` runs unmemoized every render** (`:1506-1510`, `:2002`) — rebuilds a large VM + participant map on every state change (menu open, scroll `toggleStuck`). Wrap in `useMemo`.

### Error & failure
- 🔴 **Network failure on initial load → infinite skeleton, no retry** (`:1298-1305`). See Top-5 #1.
- 🟠 **Trip-not-found fallback is a dead end** (`:1286-1295`): bare "This trip is no longer available." text, no icon/illustration/CTA beyond header back. Add an icon + "Go back" button and distinguish 404 from network error.
- 🟢 **Good — CTA failures roll back + Alert.** Every mutation snapshots the cache and restores on `catch` with `hapticError()` + `friendlyErrorMessage`: request-to-join `:606-614`, withdraw `:640-651`, approve `:700-707`, decline `:761-767`, gear toggles `:995-998,1009-1012`.

### Optimistic vs awaited (the known pain point)
- 🟢 **Good — Request-to-join, Withdraw, Approve, Decline are all optimistic** with rollback (`:570-615`, `:617-652`, `:654-708`, `:736-768`). The withdraw comment (`:623-629`) documents the exact 6–8s spinner this replaced.
- 🔴 **Leave trip — AWAITED with a dead `leaving` spinner** (`:861-890`; `leaving` set at `:872/:884` but never read; kebab spinner `:1447` only covers cancel/complete/chat). See Top-5 #3.
- 🔴 **Remove participant (host) — AWAITED, `removingUserId` never consumed** (`:770-799`; state at `:782/:793` unused). No row spinner/disable during the await. See Top-5 #3.
- 🟠 **Cancel / Complete trip — AWAITED** (`:801-829` / `:831-859`). Feedback exists (kebab spinner via `cancelling`/`completing`), but these highest-stakes host actions hold the UI on the round-trip. The cache patch already flips `trip.status`; move it before the await with rollback.
- 🟡 **Gear claim — AWAITED, no optimism** (`handleSetGearClaim` `:1099-1107`) — inconsistent with the gear checkbox toggles on the same screen which ARE optimistic (`:986-999`).

### Empty states
- 🟢 Admin-updates empty is handled in the child card (`:1636-1648`, style `:2816`).
- 🟡 No-participants / no-description / no-gear empty states are delegated to children (`TripDetailViewRedesigned`, `GroupGearCard`, `YourGearCard`) and rendered unconditionally here — confirm those children have real empty copy rather than blank cards.

### Feedback
- 🟢 **Good — haptics + confirmations.** `hapticMedium` on request/withdraw, `hapticSuccess` on approve, `hapticLight` on decline, `hapticError` on every failure; all destructive actions confirm (remove/cancel/complete/leave/delete-update).
- 🟠 **No pull-to-refresh** (`Animated.ScrollView` `:1471-1483`, no `RefreshControl`) — relies solely on `useTripRealtime`. See Top-5 #5.
- 🟡 **Inconsistent success feedback.** Join request succeeds silently (good), but gear request pops a blocking `Alert.alert('Request sent', …)` (`:1113`) — two paradigms for the same "request" mental model. Use a lightweight toast for both.

### Capacity / full trip
- 🟢 **Good — "Trip full" state** from denormalized `participant_count >= max_participants` (`:1325-1327`); non-pressable "Trip full" pill (`:2078-2084`) that still lets a pending requester withdraw.
- 🟡 **No spots-left urgency near the join CTA.** Non-members on Overview get a binary "Trip full" vs "Request to join" — surface "2 spots left" (the count exists, passed to `TripMemberSection` at `:1612`).

### Host vs member vs non-member
- 🟢 **Good — thorough role gating** (`showJoinCta` `:1319-1321`, `showChatCta` `:1330`, menu items `:1371-1426`, host edit affordances `:1552`).
- 🟡 Host pending-request approval moved to the full Members view (`:1717-1718`); only a count badge remains here (`:1616`). Verify approving a request is still one tap from the trip.

### Cancelled / past
- 🟢 Cancelled (red) + ended (grey) banners (`:1484-1500`); `isLocked` correctly hides Plan tab + host edits (`:1312,1354`).
- 🔴 **Non-member can request a past (ended-by-date) trip** — `showJoinCta` missing `!isLocked` (`:1319-1321`). See Top-5 #4.

### Share / bookmark
- 🟢 **Good — share** with deep link in both `message` and `url`, analytics logged (`:950-966`), reachable from kebab + hero float; IG-story share native-gated (`:1388-1397`).
- 🔵 **No bookmark / save-for-later** anywhere in the Trips domain (confirmed by grep across `src/screens/trips` + `src/services/trips`). A non-member not ready to request has no "save" action — a gap vs. IG-level social.

### UI polish
- 🟠 **Two different "destructive" reds and two "success" greens.** `#C0392B` (`:321,2354,2423`) vs `#FF5367` (`:2041,2182`) for destructive; `#34C759` (commit `:2643`) vs `#16A34A` (approved `:2661`) for success. Plus brand `#0788B0` hardcoded ~15×. Centralize + unify in theme tokens.
- 🟡 Magic layout numbers throughout (`paddingBottom … + 100` `:1475`, overlay `height:215` `:2364`, `ctaFloat` `left/right:56` `:2379`, deep-link retry cap `attempts < 30` `:512`).
- 🟡 The overflow menu is a hand-rolled dropdown anchored at `insets.top + 56` (`:2026`) — a magic offset assuming a fixed header height; misaligns under the kebab on differing header heights. Anchor via measured layout or use ActionSheet.
- 🟠 **CTA buttons lack accessibility labels/roles** (`CtaButton` Pressables `:2090,2104,2115`; floating Chat `:1813`). Add `accessibilityRole="button"` + labels for VoiceOver.
- 🟡 Entering animations (`FadeInUp`/`FadeInDown` `:1794,1810,2025`) aren't reduce-motion aware.

### Perceived performance
- 🟢 Story-share hero prefetch when the menu opens (`:353-357`).
- 🟡 Confirm the main hero uses a low-res blur-up placeholder — none is wired at this layer (only the story-share prefetch uses `toWidthThumbUrl` `:355`).

---

## Create wizard (`CreateTripFlowA.tsx`, `CreateTripWizard.tsx`, `CreateTripWizardChrome.tsx`)

### Progress indication
- 🔴 **No step counter / progress bar at all.** 5 (A/C) or 6 (B) steps (`:1237-1241`); chrome renders none — explicit no-op (`CreateTripWizardChrome.tsx:80,98-99`). `stepCount`/`hideProgress` are passed (`:3248,3257`) but discarded. See Top-5 #2. Render "Step X of N" or a segment indicator using the already-passed `stepIndex`/`stepCount`.
- 🟡 On the preview step the header title is replaced by the trip name (`:3249`), so the final step loses its "Preview" label once a title is set.

### Back navigation
- 🟠 **No footer Back button.** Footer renders only the primary button (`CreateTripWizardChrome.tsx:394-410`); the passed `secondaryLabel` ("Back"/"Cancel", `:3252`) is never rendered. The header chevron silently changes meaning: `onSecondary` → `guardedCancel` on step 0, else `handleBack` (`:1995-2001`). Render Back in the footer or visually distinguish the step-1 exit.
- 🔴 **No Android hardware-back handling** (no `BackHandler` in file or chrome). System-back bypasses `guardedCancel` (no exit confirm) and the `saveNow()` flush of the debounced last edit. See Top-5 #2.
- 🟢 **Good** — back never loses data (single persisted `state`, `:1708-1712`); X/exit guarded with confirm + draft flush (`:1717-1727`, `useDiscardConfirm.ts:39-59`).
- 🟠 During submit both header buttons are disabled (`CreateTripWizardChrome.tsx:308`); combined with no cancelable network call (see slow-network), a hung publish traps the user.

### Validation
- 🟡 **"Next" is never disabled.** `validateStep()` (`:1552-1684`) runs on-press inside `handleNext`/`handleSubmit`; `primaryDisabled` defaults `false` and is never passed — user only discovers what's missing after tapping. Errors are inline per field (good: `:2212,2175,2092`). Consider disabling Next when the step is known-invalid.
- 🟡 **`firstErrorField` computed then thrown away** (`void firstErrorField;` `:3152`). On a failed Next, an off-screen error (e.g. hero photo at the bottom of Basics) isn't scrolled into view. Wire the auto-scroll.
- 🟡 **Silent geo failure on publish.** `setTripDestination` has its own try/catch that only `console.warn`s (`:1936-1938`) — the trip publishes but the destination pin can silently fail with no feedback.

### Draft saving
- 🟢 **Good** — debounced 300ms autosave of the whole `WizardState` to AsyncStorage (`useTripWizardDraft.ts:9,142-157`), armed on first field change or first Next (`:1403-1408,1692-1697`), cleared only on successful publish (`:1941`), version-gated resume (`WIZARD_STATE_VERSION=6`), edit mode bypasses the draft.
- 🟡 **Draft can't restore images.** Hero/accommodation stored as local device URIs (`:314,329`); a `file://`/`ph://` URI may be invalid after restart/cache-eviction, so a resumed draft can silently lose its cover photo with no warning.

### Image upload
- 🟠 **No upload progress/spinner for images.** `pickImage` only returns a local URI (`:494-524`); the real upload runs inside `handleSubmit` via `uploadTripImage` (`:1745,1773`) with no progress callback. During publish the user sees only the generic button spinner with no "Uploading photo…" context.
- 🟢 **Good** — can't publish before upload (upload IS publish, awaited `:1741-1783`); upload failure aborts create cleanly and keeps the draft for retry (`:1746-1748,1955`).
- 🟡 **`pickImage` swallows errors silently** (`console.error` + return null, `:520-523`) — tap "Add cover photo", nothing happens, no toast.

### Publish / submit
- 🟢 **Good** — awaited (not optimistic), loading state + button-disable double-submit guard (`:1738`, `CreateTripWizardChrome.tsx:399-403`), Alert on failure with create/edit-specific copy, draft kept on failure (`:1955-1961`).
- 🟠 **Partial-write risk in create.** If `createGroupTrip` succeeds but the app dies before `clearDraft`, or `setTripDestination` fails (only warned), the trip exists without a destination and the draft may linger. No transaction/rollback.
- 🟡 `handleSubmit` has no defensive `if (submitting) return` at the top (`:1732`) — low-risk given the button disables synchronously, but add it.

### Slow network mid-create
- 🔴 **Hung publish traps the user** — sequential upload → create → destination awaits with no timeout (`:1745-1935`); exit buttons disabled while submitting. Only feedback is an indefinite spinner. Add a request timeout with retry/cancel, and/or keep close enabled during submit.

### Date / budget / capacity inputs
- 🟢 **Good** — end-before-start guarded (`:1599-1606`); capacity is a stepper capped 2–50 so `max_participants = 0` is unreachable (`:2271-2298`); budget min/max digits-only, `mn > mx` rejected (`:1644-1655`); Flow C price must be > 0 (`:1637-1640`); sensible defaults (`:357-364`).
- 🟡 Budget allows `0` (`mn < 0 || mx < 0` rejected but `0` accepted, `:1651-1653`) → a "$0–$0" range can publish.
- 🟡 **`AGE_WINDOW_BY_STYLE = {A:4,B:4,C:4}` (`:163`) is hand-coupled to a DB CHECK constraint** (comment `:158-163`) — a documented prior drift caused raw Postgres errors on publish. Fragile.

### Edit mode
- 🟢 **Good** — destination locked (`:2126-2131`), specific-stay gate handling, audience pre-marked, budget preloaded with the trip's frozen FX rate so an untouched edit doesn't drift canonical USD (`:1513,1796`); edit skips the published screen and calls `onCreated()` directly (`:1868`).
- 🟡 Edit still requires hero image + description even when only changing budget (`:1610-1612`) — no edit-specific relaxation (in practice hero is remote, so usually fine).
- 🟡 In create, `hosting_style: hostingStyle` uses the prop (`:1871`) while everything else uses `effectiveStyle` (`:1220`) — equal today, latent bug if create is ever entered with an `initialTrip`.

### Feedback / polish
- 🔴 **Zero haptics** in the entire wizard (no `Haptic`/`impactAsync`/`selectionAsync`). No tactile feedback on selection, step transition, publish success, or validation failure — below the native bar.
- 🟢 Good — disabled states visible; thorough keyboard handling (sheet-open dismisses keyboard, measure-based scroll-into-view, steppers dismiss keyboard `:2272,2295`).
- 🟡 No field auto-focus / jump-to-first-error (ties to `void firstErrorField`).
- 🟠 **Data-as-label truncation in "About you."** `SummaryRow label={destLabel/stayLabel}` uses raw destination/stay names (`:2895-2896,2966,2979`); `rowStyles.label` is `flexShrink:0` with `marginRight:44` (`:737-744`), so a long destination squeezes/clips the `numberOfLines={1}` value (`:667`).
- 🟡 Hardcoded cyan bypasses `COLORS.cyan` token (`:774,927,2581,2732`); missing `accessibilityLabel` on several `TextInput`s (name `:2192`, description `:2235`, budget `:2770,2786`, price `:2652`); two near-identical sheet-footer button styles used interchangeably (`sheetSelectBtn` vs `sheetSetBtn`).
- 🟡 `TRIP_TITLE_MAX_LENGTH = 20` with a stale "bump 20-char limit per spec" comment (`:138`) — tight cap, possible unfinished change.

---

## TripPublishedScreen (`TripPublishedScreen.tsx`)
- 🟢 **Good** — success illustration + check badge, LIVE trip card, share CTA (deep link in both `message` + `url`, analytics logged `:87-108`), "Maybe later" secondary. Share has a `sharing` re-entry guard.
- 🟡 **Share failure/cancel detection is string-based** (`/cancel/i.test(e.message)` `:102`) — fragile across OS locales/versions; a non-English cancel message would surface a spurious "Could not share" Alert.
- 🔵 Info pill renders an empty `<View />` when dates are absent (`:213`) — leaves a small gap; render just the count row instead.

---

## Commitment flow (`CommitmentScreen.tsx`)
- 🟢 **Good — optimistic + well-crafted.** Step 1 multi-select → step 2 note sheet; on Send it optimistically flips the member's cached participant row to `pending`, haptic-success, pops back immediately, and rolls back + `hapticError` + Alert on failure (`:95-136`). Note sheet auto-focuses with keyboard (`:74-78`), `Select`/`Send` disabled states + `Send` spinner (`:238-243`).
- 🟡 The `submitting` guard blocks re-entry but since `onClose()` fires before the await resolves (`:125`), if the write fails the user is already back on the trip and only sees an Alert — the optimistic rollback correctly restores the pill, but there's no re-open of the commitment sheet to retry. Acceptable, but a "retry" affordance on the Alert would be better.

---

## Gear & packing screens

### PackingAndGearScreen (`PackingAndGearScreen.tsx`)
- 🟡 **No loading state — cold cache shows a false empty.** Reads `useTripGear` cache seeded by TripDetail; if cold (deep-link), `gearItems.length === 0` renders "No items yet." (`:154-155`) instead of a skeleton. Check `gearQuery.isLoading`.
- 🟡 **Gear claim is awaited, not optimistic** (`:85-93`) — a checkbox tap in the sheet waits on the round-trip before the count updates; Alert on failure. (`YourGearScreen` does this optimistically — inconsistent.)
- 🟢 Good role-gated sticky CTA (host "+ Add item" vs member "Suggest item"); gear-request success Alert (`:99`).

### YourGearScreen (`YourGearScreen.tsx`)
- 🟢 **Good — fully optimistic** checklist toggles / add / remove with per-op rollback + Alert (`:106-161`, `patchMe`), packed/"Don't forget" split, admin-suggested tag, strike-through on done.
- 🟡 No loading state — cold cache shows "No gear yet." (`:225-226`). Same fix as above.
- 🔵 Header title says "Packing & Gear" (`:202`) — same title as `PackingAndGearScreen`, so two different screens share one header label; minor wayfinding ambiguity.

### ManageGearScreen (host, `ManageGearScreen.tsx`)
- 🟢 Good — DraggableFlatList reorder is optimistic (local set → persist → invalidate); add/edit/delete via sheet.
- 🟠 **Reorder failure is swallowed to console only** (`:110-112`, `console.error` + invalidate). The list snaps back to server order via invalidation but the user gets NO explanation for why their drag "undid itself." (`ManageSuggestedGearScreen` correctly Alerts on reorder failure `:114-117`.) Add an Alert.
- 🟡 "Save" button is purely decorative — edits persist immediately via the sheet, so Save just calls `onBack` (`:200-206`); a user expecting Save to be the commit point might exit via back thinking nothing saved. The reverse is safe but the mental model is off.

### ManageSuggestedGearScreen (host, `ManageSuggestedGearScreen.tsx`)
- 🟢 **Good** — staged local draft, reorder + delete persist optimistically with rollback + Alert (`:108-143`), Save spinner + disabled (`:224-234`), delete confirm.
- 🟡 No loading/empty distinction — if `trip` is null (cold cache) the draft seeds from `[]` and there's no skeleton; the list just shows the "+ Add Item" footer. Minor.

---

## TripMembersScreen (`TripMembersScreen.tsx`)
- 🟢 **Good — three clean permission layers** (host / member / outsider), pending-requests block (host), committed badges (insiders), count row "9/12 members · 5 committed".
- 🟠 **All host actions (promote/demote/remove) are awaited with no per-row feedback and no optimism.** `confirmSetAdmin`/`confirmRemoveAdmin`/`confirmRemove` (`:135-198`) `await` then `invalidateQueries` — during the round-trip the row shows no spinner and stays interactive (re-tappable). Add a per-row pending state or optimistic removal.
- 🟡 **No loading state** — `participants.length === 0` renders "No members yet." (`:304-305`); on a cold cache this is a false empty. Every trip has at least a host, so this only bites on deep-link before the cache warms — still worth a skeleton.
- 🔵 No pull-to-refresh; relies on invalidation after actions.

---

## TripUpdatesScreen (`TripUpdatesScreen.tsx`)
- 🟢 Good — host per-card Edit → shared `AdminUpdateSheet` with optimistic cache patch, delete confirm ("removed for everyone"), relative-time formatting.
- 🟡 **No loading state** — cold cache shows "No updates yet." (`:171-172`) instead of a skeleton (`useTripAdminUpdates` has no `isLoading` check).
- 🔵 `formatRelativeTime` is re-implemented locally here AND in `TripMembersScreen` (`timeAgo`) AND (per comments) in TripDetail — three copies. Extract a shared date util.

---

## SurftripDetailScreen — legacy surftrips (`SurftripDetailScreen.tsx`)
Note: this is the older "surftrips" feature, distinct from group trips; still shipped.
- 🟠 **Loading is a bare centered `ActivityIndicator`, no skeleton** (`:441-449`) — inconsistent with the group-trip skeleton polish; feels a tier lower.
- 🟢 Good — "Not found" state ("This surftrip is no longer available." `:451-459`) — the very thing TripDetailScreen lacks.
- 🔴 **Every action is awaited + full `load()` refetch, zero optimism.** `handleRequestToJoin` (`:254-268`), `handleWithdraw` (`:270-281`), `handleLeave` (`:283-307`), approve/decline (`:373-391`) all `setSubmitting(true)` → await → `await load()` (a full re-fetch of group + members + requests). This is exactly the slow-CTA pattern the group-trip screen fixed; the entire screen refetches after every action. Migrate to the react-query + optimistic pattern, or at minimum patch local state instead of full reload.
- 🟡 **No pull-to-refresh** — the ScrollView (`:466-469`) has no `RefreshControl` despite being a manual-`load()` screen (where it would matter most).
- 🟡 Share failure is only `console.warn`'d (`:343-346`) — a genuine share error (non-cancel) is silent to the user.

---

## Cross-cutting themes

1. **Awaited CTAs without feedback are the dominant issue.** Group-trip *join/withdraw/approve/decline/commit* are optimistic (great), but *leave, remove-participant, cancel, complete, gear-claim, all member-management, and the entire legacy surftrips screen* still await REST with dead or missing loading states. This is the "trip CTAs feel slow" complaint, and it's concentrated in the host-management and destructive paths.
2. **Cold-cache false empty states.** Six sub-screens (PackingAndGear, YourGear, TripUpdates, TripMembers, ManageSuggestedGear, and TripDetail sections) render empty copy while their react-query cache is cold instead of a skeleton — invisible when navigated from TripDetail, but wrong when deep-linked from a push notification.
3. **No error/retry on the two primary read screens** — TripDetail (infinite skeleton) and My Trips (false "no trips"). Only Explore got the treatment.
4. **Missing native-feel details:** no haptics in the create wizard, no step indicator, no Android hardware-back guard, no pull-to-refresh on detail/members/surftrips, no bookmark/save anywhere.
5. **Theming drift:** duplicated destructive reds / success greens and pervasive hardcoded hex bypassing token maps — a consistency risk as the app grows.
