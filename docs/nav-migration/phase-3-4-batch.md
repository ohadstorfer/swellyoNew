# Phase 3+4 batch — chats, people, Swelly, wizard (one build, one Eyal regression at the end)

KEYBOARD SPIKE PASSED (2026-06-11, commit 114bb0c): chat keyboard system works inside
native-stack cards on iOS. All chat/profile screens go native-card. No JS-stack fallback needed.

## Build order (z-order constraint drives it!)
Swelly keep-alive layers + WelcomeToLineupOverlay + ProfileEditPanel render ABOVE the
navigator — cards render BELOW them. Therefore anything that must appear over Swelly
chat can only become a card AFTER Swelly itself is a card. Order: B1 → B2 → B3 → B4.

### B1 — Chat unification (all DM paths → ChatCard) + SurftripCard
- ConversationsStack.navigateToDM → pushRootCard('ChatCard') (lineup list path)
- ConversationsStack SurftripDetail route + AppContent activeSurftripDetailId overlay →
  new 'SurftripCard' route { groupId } (dual-render dies)
- AppContent selectedConversation overlay paths → pushRootCard('ChatCard'):
  handleConversationLoadingComplete, handleStartConversation direct path,
  handleOpenSurftripChat (→ chat card with surftripId)
- selectedConversation state + overlay render + handleBackFromChat DIE.
  fromTripPlanning back-to-Swelly behavior: deferred to B2 (Swelly card makes it natural
  stacking); until B2 lands in the same batch, trip-planning-origin chats keep overlay? NO —
  batch ships together, so B2 covers it. fromTripPlanning chats during B1 dev: temporary
  acceptance that back lands on root (fixed by B2 in same batch).
- ConversationLoadingScreen stays an overlay for now; on complete it pushes ChatCard.
- lineupInnerScreenOpen mechanism becomes dead (no inner pushes left) — delete with
  ConversationsStack DM/Surftrip routes; bar handled by cards naturally.
- ChatCard back: plain goBack (stack remembers origin: lineup root, trip card, profile card).

### B2 — Swelly chat → card
- Merge TripPlanningChatScreenCopy → TripPlanningChatScreen.tsx (Eyal-approved; repo
  convention). Delete dead original. Update ConversationsStack/ConversationsScreen Swelly
  card press handlers (handleSwellyPress/Copy) → pushRootCard('SwellyChat').
- Conversation state ALREADY lifted (persistedChatId/MatchedUsers/Destination props from
  AppContent + onChatStateChange) → card reopens warm for free.
- Display:none keep-alive layers + everShown flags + pointerEvents conditions DIE.
  Profile-over-chat no-remount problem disappears (stack keeps covered cards mounted).
- Remove the screen's custom right-swipe dismiss (native swipe-back replaces; R6 conflict).
- activeCopyService copy/copy-copy dev switch → route param { service?: 'copy'|'copy-copy' }.
- onboardingMatches flow (pendingOnboardingMatches, onChatComplete clearing) preserved via
  context/props through the card wrapper.

### B3 — People cards: ProfileCard (other users) + Settings
- 'ProfileCard' route { userId } for OTHER-user profiles: replaces showProfile+viewingUserId
  overlay for: handleViewUserProfile (chat/swelly origins), handleViewUserProfileFromTrip,
  WelcomeToLineupOverlay view-profile (push card + hide overlay; pop → un-hide — keep the
  existing hidden-by-profile state), swelly-shaper path (dead code anyway).
- OWN profile stays the tab root. profileFrom* flags + handleProfileBack branches DIE except
  the welcome-overlay hide/show pair and fromOnboardingChat (own-profile overlay for
  onboarding step 7 stays AS-IS — it's pre-main-app, out of scope).
- ProfileScreen custom Gesture.Pan swipe-dismiss: disabled for card usage too
  (swipeBackDisabled stays for tab; card wrapper passes noTransition+swipeBackDisabled?
  NO — cards should slide natively: pass noTransition=true (nav animates) + swipeBackDisabled=true
  (nav owns the gesture)).
- SettingsScreen → 'Settings' card; NEW gear icon on own-profile header (next to pencil);
  remove Lineup hamburger-menu Settings entry (menu's Profile entry → requestTab? decide:
  remove too — bottom nav covers it). Settings internal render-swaps stay internal (lower risk).
- handleStartConversation from ProfileCard: pops profile? No — push ChatCard on top (chain).

### B4 — Create wizard → fullScreenModal route
- 'CreateTripWizardModal' route { hostingStyle, resumeDraft } presentation fullScreenModal.
- TripsScreen create-tab chooser pushes it; RN Modal + createModalVisible/pendingStyle die.
- Exit guard: beforeRemove listener → if wizardStarted, preventDefault + Alert (save-draft
  message) → on confirm, dispatch the blocked action. onStartedChange wiring preserved.
- TripPublishedScreen stays inline within the wizard (unchanged).
- handleCreated: invalidate + pop + goToTab('my') — via callback in context or param.

### Gates before Eyal regression
- tsc baseline 268; iOS export; code-reviewer agent over the full batch diff;
  grep sweep: selectedConversation/showProfile/viewingUserId/profileFrom* usages all dead
  or intentionally retained (document each retained one).

## Eyal end-of-batch regression (15 min, will write a numbered list like Phase 2's)
Chats from everywhere, profile chains, Swelly warm reopen, wizard guard, plus the Phase-2
checklist re-run (regression).
