# Phases 2–5 — Outlines (detailed spec written just-in-time before each phase)

## Phase 2 — Trips deck
- TripDetailScreen → root-stack card (`push`). Scroll preservation of panes underneath comes free
  (screens under a push stay mounted — verified by research).
- Edit-trip overlay → card above detail.
- NotificationCenter panel → transparentModal route (back-history — THE original bug fix).
  Dismiss-modal-before-deep-link guard (#12389).
- navigationRef deep-links: push tap → `Trips` tab + push TripDetail card (replaces pendingTripDetailId
  + pendingTripFocus); cold-start via isReady-guard. AsyncStorage invite key flows reviewed.
- iOS swipe-back vs Explore-deck horizontal swipe + WizardBottomSheet PanResponder: gesture
  coordination pass (failOffsetX / simultaneousWithExternalGesture / gestureEnabled per screen).
- In-screen sheets (12 in detail + 14 in wizard) STAY plain Modals — no conversion.
- Read R3 fully before spec.

## Phase 3 — People & chat cards  ⚠ starts with KEYBOARD SPIKE
- Spike (device): DM screen as native-stack card; keyboard open/close/type; if
  useReanimatedKeyboardAnimation breaks inside native screen transforms → fallback: chat cards in a
  JS-stack sub-navigator (or keep blank-stack for chat) — decision recorded before proceeding.
- Unify the THREE DM render paths into one ChatCard route (list tap, push/trip/profile origins, web-path dies).
- Preserve: setCurrentConversationId two-phase set; typing-indicator sync clear; ConversationLoadingScreen
  becomes in-route loading state.
- Other-user ProfileScreen → shared card (push); 5 origin flags die; `fromOnboardingChat` variant →
  gestureEnabled:false; custom right-swipe dismiss gestures removed (navigator owns it).
- SettingsScreen → card opened from NEW gear icon on own profile; its 3 internal render-swap
  sub-screens → cards (DeleteAccount, PrivacyPreferences, Analytics). Remove old Lineup-menu entry.
- SurftripDetailScreen → shared card (was dual-rendered).
- Read R4 + R5 fully before spec.

## Phase 4 — Modals & Swelly
- Create wizard → fullScreenModal route; hardware-back/save-draft guard via navigation events
  (beforeRemove); WIZARD_STATE_VERSION bump ONLY if state shape changes.
- Swelly chat: merge Copy → TripPlanningChatScreen.tsx (Eyal-approved); conversation state lifted to
  provider; becomes a normal card (drop display:'none' layers); delete dead original.
- ProfileEditPanel / JoinDecisionOverlay / WelcomeToLineupOverlay: stay Modals/views; 350ms
  choreography → transition-end callback.
- Read R5 fully before spec.

## Phase 5 — Cleanup & hardening
- Delete: boolean router branches, mirror activeTab reads, origin flags, dead code list in findings.md
  (EXCEPT SwellyShaperScreen — keep; LoadingScreen — keep until consent question verified).
- ConversationsStack → native-stack screens in root deck (pending Phase-3 spike verdict);
  react-native-screen-transitions package removed if clear.
- Android hardware-back sweep on device; fix TripsBottomNav JSDoc lie (says it renders in TripsScreen).
- Maestro (or manual matrix) for critical back-paths: notification→trip→back→panel;
  trip→participant→chat→back→back→trip; profile→settings→sub→back×2.
- enableFreeze decision: stays OFF (bug #2972 with realtime screens).
