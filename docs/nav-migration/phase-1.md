# Phase 1 — Skeleton: roots + bottom nav into the navigator

## Goal
Inside AppContent's main-app branch (`shouldShowConversations === true`), the base layer becomes a
real navigator: RootStack → HomeTabs (Lineup / Trips / Profile) with TripsBottomNav as the custom
tabBar. EVERYTHING else (all overlays, Swelly keep-alive layers, modals) keeps rendering above it
exactly as today. Onboarding / auth / age-block gates untouched.

## Target tree
```
AppContent (gates unchanged)
 └─ main-app branch
     RootStack (native-stack, headerShown:false, ref=navigationRef)
       └─ 'HomeTabs' (bottom-tabs)
            options: backBehavior:'none', lazy:true, freezeOnBlur:false,
                     detachInactiveScreens:false   // Trips realtime + Lineup subscriptions
            tabBar: TripsBottomNav adapter (emits tabPress, reads nav state for active)
            ├─ 'Lineup'  → ConversationsStack (UNCHANGED — still blank-stack inside)
            ├─ 'Trips'   → TripsScreen (still owns its inner detail/edit overlays for now)
            └─ 'Profile' → ProfileScreen own-profile mode (viewingUserId profile stays an overlay)
     [boolean overlays render above RootStack — unchanged this phase]
```

## New files
- `src/navigation/RootNavigator.tsx` — RootStack + HomeTabs + screen wrappers (stable component refs,
  NO inline component definitions — react-navigation remount trap)
- `src/navigation/navigationRef.ts` — createNavigationContainerRef + isReady-guarded helpers
- `src/navigation/NavControlContext.tsx` — provides bottomNavControl (SharedValue) + inner-overlay
  setter to tabBar and screens (replaces prop threading navControl/onInnerOverlayChange)

## Wiring changes in AppContent (the careful part)
1. `showTrips` / `showProfile`(own) booleans DIE as overlay-slots; their ~setters become tab switches:
   - every `setShowTrips(true)` call site → `navigationRef HomeTabs→Trips` (grep all; includes
     bottom-nav handlers, group-chat-exit path, profile-back paths)
   - own-profile opens → tab switch; OTHER-user profile (`viewingUserId`) keeps old overlay path
2. Keep a mirror `activeTab` state in AppContent (navigator `state` listener) ONLY where the old
   overlay-priority logic reads showTrips/showProfile (e.g. showBottomNav calc, profile-press origin
   logic). Mark each mirror-read with `// TODO Phase-5: delete`.
3. TripsBottomNav adapter: receives tabBar props; emits `tabPress` with canPreventDefault (never calls
   popToTop manually — landmine #9424); active pill driven by tab index; collapse/expand still via
   bottomNavControl SharedValue from context. Visibility conditions (hide while trip detail open etc.)
   unchanged via control.
4. `onInnerOverlayChange` prop (TripsScreen→AppContent) moves into NavControlContext.
5. NavigationContainer: stays the single one in App.tsx; RootNavigator mounts INSIDE AppContent's
   main-app branch (conditional mount of a navigator under one container is fine — it's the
   old-navigator-between-new-navigators pattern that's forbidden).

## Explicitly NOT in this phase
- No card pushes. Trip detail, DM, settings, edit, surftrip detail: all still boolean overlays.
- No deep-link changes (pendingTripDetailId flow untouched — still works via TripsScreen props).
- Swelly chat display:none layers untouched.
- No deletion of any flag (mirror only).

## Test matrix (iPhone dev client)
1. Tab switching all 6 directions; pill animation plays across switches; hide-on-scroll still works
2. Each root keeps state when switching away/back (Lineup scroll, Trips toggle+pane scrolls, Profile)
3. Trip detail open/close from both My Trips + Explore (old overlay path must still work)
4. DM open from Lineup list + back (ConversationsStack inner push unchanged)
5. Notification → trip deep-link still works (old pending-id path)
6. Swelly chat open/close — still warm on reopen
7. Logout → login → main app (logout choreography must reset navigator cleanly — watch for #9436-style
   state corruption: logout unmounts RootNavigator with the main-app branch; verify re-login lands on Lineup)
8. Android (if device available): hardware back at root does NOT jump tabs (backBehavior none)

## Rollback
Single revert of the phase commit(s) — no data/schema involvement.
