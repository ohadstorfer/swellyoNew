# Phase 2 — Trips deck: trip detail + edit as cards, notifications in back history

## Goal
First REAL cards. TripDetail and EditTrip become root-stack pushes (native slide, edge-swipe
back, cover the bottom nav). NotificationCenter's panel becomes a transparentModal route so
back from a notification-opened trip returns TO the panel (the bug that started this project).
Deep links push cards directly — the pendingTripDetailId state machine dies.

## Routes added to RootStack
| Route | Params | Presentation |
|---|---|---|
| TripDetail | { tripId, focus?: TripDetailFocus } | card (default native slide; chains allowed via push) |
| EditTrip | { trip: GroupTrip } | card |
| NotificationsPanel | { userId } | transparentModal, animation none (panel animates itself) |

## Wiring (key decisions)
- Screen wrappers in RootNavigator read callbacks from MainNavContext (onOpenGroupChat,
  onViewUserProfile come from existing tripsProps; they're identical for screen + card).
- Pushes from inside screens: `navigation.dispatch(StackActions.push(...))` — bubbles from tab
  child to root stack. Helper `usePushCard` in src/navigation/usePushCard.ts.
- Deep links (push notif / invite / join decision / chat header): AppContent calls
  `openTripCard(tripId, focus)` = requestTab('trips') + setRequestedTripCard — consumed
  mount-safely in FloatingTabBar effect (same pattern as requestedTab), which pushes on the
  parent stack. pendingTripDetailId + pendingTripFocus state DELETED.
- TripsScreen: selectedTripId/selectedTripFocus/editingTrip state + both overlay renders
  DELETED; card opens via push. initialTripId/initialTripFocus props die. The
  onInnerOverlayChange effect dies (cards cover the bar natively now).
- Participant→profile: showProfile overlay renders ABOVE the card (legacy overlay above
  navigator) — handleViewUserProfileFromTrip stops touching pending state entirely.
- handleSavedEdit equivalents live in the EditTrip wrapper (invalidate ['trips','my'], goBack).
- NotificationCenter: panel content extracted so the same component serves (a) legacy Modal
  mode (other call sites, if any) and (b) route mode. Bell press in route mode pushes the panel
  route. Tapping a trip notification pushes TripDetail ON TOP of the transparent panel —
  back pops to the still-open panel. That's the fix.

## Explicitly NOT in this phase
- Create-trip wizard stays an RN Modal (Phase 4). Chat screens stay overlays (Phase 3).
- The ~26 in-screen sheets stay local Modals (forever, by design).
- PostHog screen tracking via navigator — deferred to Phase 5 (no shared client instance today).

## Landmines to respect (from R3/findings)
- Pager panes under the card stay mounted (native-stack keeps React tree; scroll survives).
  VERIFY on device — L2 fear in R3 contradicts the platform research; device test decides.
- useTripRealtime keyed by tripId — multiple TripDetail cards in a chain each subscribe own topic. OK.
- scrollEventThrottle={1} untouched. WIZARD_STATE_VERSION untouched.
- TripDetailScreen internal sheets unchanged — only its outer mounting changes.
- iOS edge-swipe vs deck horizontal scroll: deck lives on the ROOT (not a card) — no conflict.
  TripDetail hero/photo carousels: verify edge-swipe on device.

## Test matrix (iPhone)
1. Explore deck → tap trip → card slides in right-to-left; edge-swipe back slides out; deck
   scroll position INTACT (the L2 question — critical check)
2. My Trips → trip → edit → save → back on detail with fresh data; cancel → detail untouched
3. Bell → panel slides in; tap trip notification → trip card; back → PANEL STILL OPEN; close panel → root
4. Push notification (app open + cold start) → trip card opens with correct section focus; back → Trips root
5. Trip → participants → profile → back → trip card exactly as left (scroll intact now!)
6. Trip → group chat → back → trip card intact
7. Trip card → notification bell inside detail (if present) → another trip → chain of cards pops one by one
8. Join-decision overlay → approved → trip card on commit section
9. Bottom nav: hidden while any card is open, reappears on root, pill state correct
