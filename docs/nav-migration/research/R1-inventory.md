# R1 — Global Screen Census
_Navigation migration inventory. Generated 2026-06-11._

---

## 1. Master Screen List

### 1.1 Files in `src/screens/`

| File | Live/Exp | Classification | Trigger open | Back/close | Must-stay-mounted | Gestures / Animations | Platform branches | Notes |
|---|---|---|---|---|---|---|---|---|
| `WelcomeScreen.tsx` | LIVE | OUTSIDE-DECK (auth gate) | AppContent: no user + step=STEP_WELCOME | N/A (root) | No | BackgroundVideo fullscreen; Google sign-in | All — has native SVG Google logo + web iframe Google IdS | Also used as loading spinner host while `isCheckingAuth=true` |
| `OnboardingWelcomeScreen.tsx` | LIVE | OUTSIDE-DECK (onboarding) | AppContent: step=0 | `handleWelcomeBack` → logout | No | Slide in via OnboardingScaffold | All | First screen after Google sign-in |
| `OnboardingStep1Screen.tsx` | LIVE | OUTSIDE-DECK (onboarding) | step=1 | `handleStep1Back` | No | Slides inside OnboardingScaffold | All | Board type selector |
| `OnboardingStep2Screen.tsx` | LIVE | OUTSIDE-DECK (onboarding) | step=2 | `handleStep2Back` | No | Uses `VideoCarousel`; no navigation gesture | All | Surf level selector with video |
| `OnboardingVideoUploadScreen.tsx` | LIVE | OUTSIDE-DECK (onboarding) | `showVideoUploadStep=true` within step=2 | `handleVideoUploadBack` | No | None notable | All | Video upload sub-step between step 2 and 3 |
| `OnboardingStep3Screen.tsx` | LIVE | OUTSIDE-DECK (onboarding) | step=3 | `handleStep3Back` | No | None | All | Travel experience slider |
| `OnboardingStep4DestinationsScreen.tsx` | LIVE | OUTSIDE-DECK (onboarding) | step=4 | `handleStep4Back` | No | Has `<Modal animationType="none">` for CountryPicker inline | All | Destinations picker |
| `OnboardingStep5BudgetScreen.tsx` | LIVE | OUTSIDE-DECK (onboarding) | step=5 | `handleStep5Back` | No | None | All | Budget tier selection |
| `OnboardingStep6LifestyleScreen.tsx` | LIVE | OUTSIDE-DECK (onboarding) | step=6 | `handleStep6Back` | No | None | All | Lifestyle keywords |
| `OnboardingStep4Screen.tsx` | LIVE | OUTSIDE-DECK (onboarding) | step=7 (confusingly named) | `handleStep7Back` | No | Has `<Modal animationType="fade">` for DatePicker + inline HomeBreakSearchSheet | All | Profile details step — nickname, age, avatar, home break |
| `LoadingScreen.tsx` | LIVE (dead path) | OUTSIDE-DECK | Previously: after onboarding chat complete | N/A | No | Background video + spinner | All | **DEAD PATH**: AppContent comment says "Skip LoadingScreen + Swelly onboarding chat — go straight to profile" (line 847). File exists and has a consent Modal but is never rendered by AppContent. Investigate before removing. |
| `MVPThankYouScreen.tsx` | LIVE | OUTSIDE-DECK | ConversationsScreen: `isMVPMode=true` after onboarding | `onBackToHomepage` | No | None | All | Shown when `EXPO_PUBLIC_MVP_MODE=true`; blocks main app |
| `SwellyoTeamWelcome.tsx` | LIVE | CARD (full-replace early-return) | ConversationsScreen: tapping team-member conversation | `onBack` → `setShowSwellyoTeamWelcome(false)` | No | None notable | All | Special team-member welcome screen. Rendered as early-return full-replace inside ConversationsScreen, not AppContent |
| `ProfileScreen.tsx` | LIVE | CARD (above deck) | AppContent: `showProfile=true`; multiple entry points | `handleProfileBack` (complex — checks `profileFromTripDetail`, `profileFromTripPlanningChat`, `profileFromWelcomeOverlay`) | No | Reanimated swipe-back gesture; `PanResponder` for destinations sheet; `GestureDetector` (RNGH) scroll on iOS, fallback RN ScrollView on Android | All — Platform.OS branches for scroll composition | Internal sub-screens: ReportUserScreen (full-replace early-return), AvatarCropModal (native.tsx variant), BlockUserOverlay (Modal), HomeBreakViewSheet (Modal), DestinationsSheet (hand-rolled Modal), GalleryPermissionOverlay (Modal) |
| `ReportUserScreen.tsx` | LIVE | CARD (full-replace inside ProfileScreen) | ProfileScreen: `showReportOverlay=true` | `onBack` → `setShowReportOverlay(false)` | No | None | All | Replaces ProfileScreen's full render tree |
| `ConversationsScreen.tsx` | LIVE | ROOT (Lineup) | AppContent: `shouldShowConversations && isListFrontmost` | N/A (root) | YES — always mounted, hidden when overlay active | Scroll-driven bottom nav; `TutorialOverlay` (Modal) | All — `Platform.OS === 'web'` skips ConversationsStack inner navigator | Has its own early-return for `SwellyoTeamWelcome`, `SwellyShaperScreen`, `DirectMessageScreen`/`DirectGroupChat` — **these are the WEB-only paths; native uses ConversationsStack navigator** |
| `DirectMessageScreen.tsx` | LIVE | CARD | AppContent: `selectedConversation.isDirect !== false`; ConversationsStack: `DirectMessage` screen | `handleBackFromChat` / `navigation.goBack()` | YES (Supabase Realtime subscription) | Swipe-to-reply per bubble; PanResponder gesture on message rows; FullscreenImageViewer (Modal), FullscreenVideoPlayer (Modal), ImagePreviewModal (Modal), VideoPreviewModal (Modal), MessageActionsMenu (Modal) | All — web has no voice messages | DUAL-RENDERED: AppContent renders it as overlay; ConversationsStack renders it as navigator screen on native |
| `DirectGroupChat.tsx` | LIVE | CARD | Same as DirectMessageScreen but for `isDirect === false` | Same | YES | Same as DirectMessageScreen | Same | DUAL-RENDERED same as above |
| `ChatScreen.tsx` | LIVE (export re-used) | NOT-NAVIGATION | — | — | — | — | — | Exports `OnboardingChatScreen`. The screen itself (`OnboardingChatScreen`) is imported by `src/screens/OnboardingChatScreen.tsx` as a re-export. **AppContent never renders it directly** — the onboarding chat path was removed (step 8 skipped, see line 847). Dead render path but not dead file. |
| `OnboardingChatScreen.tsx` | LIVE (re-export only) | NOT-NAVIGATION | Never rendered by AppContent | — | — | — | — | One-liner re-export: `export { OnboardingChatScreen as ChatScreen } from './ChatScreen'`. The named export itself exists for potential future use. |
| `TripPlanningChatScreen.tsx` | LIVE | CARD (persistent absoluteFill layer) | AppContent: `showTripPlanningChat=true` via `handleSwellyPress`; lazily mounted first time, then kept alive | `handleTripPlanningChatBack` → `setShowTripPlanningChat(false)` | YES — explicitly kept mounted with `display:'none'` to preserve chat state, scroll, Supabase subscription | `GestureDetector` (RNGH) swipe gestures; `useReanimatedKeyboardAnimation`; SwellyTopicOverlay (Modal), ReportAISheet (Modal), TutorialOverlay (Modal) | All — web uses same path | Rendered at root level of AppContent as `StyleSheet.absoluteFill` View, toggled via `display:'none'`. `pointerEvents` set to `'none'` when not frontmost. |
| `TripPlanningChatScreenCopy.tsx` | EXPERIMENTAL | CARD (persistent absoluteFill layer) | AppContent: `showTripPlanningChatCopy=true` via `handleSwellyPress` (production) or `handleSwellyPressCopy` (dev) | `setShowTripPlanningChatCopy(false)` | YES — same lazy-mount + display:none pattern | Same as above + `visible` prop gates inner animations | All | **PRODUCTION** path (Swelly button routes to this, not the non-copy). The "Copy" name is misleading — see note below. Has `visible` prop that non-copy lacks. Accepts `service` prop (copy vs copy-copy) and `onboardingMatches` prop. |
| `SwellyShaperScreen.tsx` | LIVE | CARD (above deck) | AppContent: `showSwellyShaper=true`; also ConversationsScreen early-return on web | `handleSwellyShaperBack` → returns to ProfileScreen | No | None notable; uses ReportAISheet (Modal) | All | Profile improver AI chat. Two entry paths: AppContent overlay + ConversationsScreen early-return (web only). |
| `SettingsScreen.tsx` | LIVE | CARD (above deck) | AppContent: `showSettings=true` via `onSettingsPress` | `setShowSettings(false)` | No | Slide-in animation on mount (spring) | All | Internal routing: `showDeleteAccount`, `showPrivacyPreferences`, `showAnalytics` — each replaces full render (early-return pattern). ReportBugOverlay (Modal). |
| `DeleteAccountScreen.tsx` | LIVE | CARD (inside SettingsScreen) | SettingsScreen: `showDeleteAccount=true` | `setShowDeleteAccount(false)` | No | None; has two confirmation Modals | All | |
| `PrivacyPreferencesScreen.tsx` | LIVE | CARD (inside SettingsScreen) | SettingsScreen: `showPrivacyPreferences=true` | `setShowPrivacyPreferences(false)` | No | None | All | Contains BlockedUsersScreen inline |
| `BlockedUsersScreen.tsx` | LIVE | CARD (inside PrivacyPreferencesScreen) | PrivacyPreferencesScreen: `showBlockedUsers=true` | `setShowBlockedUsers(false)` (implied) | No | None | All | |
| `AnalyticsDashboardScreen.tsx` | LIVE (admin only) | CARD (inside SettingsScreen) | SettingsScreen: `showAnalytics=true`, admin flag required | `setShowAnalytics(false)` | No | None; uses Modal for filter sheet | All | Hidden from non-admins |
| `ReportUserScreen.tsx` | LIVE | CARD (inside ProfileScreen) | ProfileScreen: `showReportOverlay && userId` | `setShowReportOverlay(false)` | No | None | All | |
| `trips/TripsScreen.tsx` | LIVE | ROOT (Trips tab) | AppContent: `showTrips=true`; tab pager contains Explore/My/Create sub-tabs | `setShowTrips(false)` | No (AppContent unmounts it when `showTrips=false`) | Reanimated pager (3-tab slide); `SlideInRight`/`SlideOutRight` for detail overlay; NotificationCenter (right-drawer Modal); `<Modal animationType="slide">` for create wizard | All — Platform branches for font names only | Internal overlays: `selectedTripId` → TripDetailScreen (Reanimated absoluteFill), `editingTrip` → CreateTripWizard (absoluteFill View), `pendingStyle` → CreateTripWizard (Modal fullScreen). Calls `onInnerOverlayChange` to hide bottom nav. |
| `trips/TripDetailScreen.tsx` | LIVE | CARD (inside TripsScreen) | TripsScreen: `selectedTripId != null` — rendered as Reanimated `SlideInRight` overlay | `setSelectedTripId(null)` | No | Reanimated `SlideInRight`/`SlideOutRight`; multiple WizardBottomSheet Modals inside; NotificationCenter | All | Has Supabase realtime subscription via `useTripRealtime`. Internal sheets: CommitmentSheet, RequestToJoinSheet, RequestGearSheet, PersonalGearSheet, ManageGearSheet, GearRequestsSheet, AdminUpdateSheet, GearItemSheet, EditSuggestedGearSheet, AddPersonalGearSheet, EditTextSheet, EditCoverSheet, EditDatesSheet, EditAccommodationSheet — all `<Modal>`. |
| `trips/CreateTripWizard.tsx` | LIVE | MODAL (fullscreen) | TripsScreen: `pendingStyle != null` (new) or `editingTrip != null` (edit) | `onCancel` + discard guard | No | Edit mode: absoluteFill View (no animation). New mode: `<Modal animationType="slide" presentationStyle="fullScreen">` | All | Thin router; all logic in CreateTripFlowA. |
| `trips/CreateTripFlowA.tsx` | LIVE (+ experimental) | MODAL (fullscreen content) | Via CreateTripWizard | `onCancel` | No | WizardBottomSheet Modals for all input steps; HomeBreakSearchSheet (Modal); WizardInfoOverlay (Modal); `MapPickerModal` (Modal, native-only); TripPublishedScreen replaces content inline | All | **EXPERIMENTAL NOTE**: the file itself is the production path. No -copy variant at this path. Hosting styles A/B/C all share this file, branching internally. |
| `trips/TripPublishedScreen.tsx` | LIVE | CARD (replaces wizard content) | CreateTripFlowA: after successful publish | `onCreated` callback → closes wizard Modal | No | None | All | |
| `surftrips/SurftripDetailScreen.tsx` | LIVE | CARD | AppContent: `activeSurftripDetailId != null`; ConversationsStack: `SurftripDetail` screen (native nav) | `setActiveSurftripDetailId(null)` / `navigation.goBack()` | No | `<Modal animationType="slide">` for CreateSurftripModal; ParticipantMenuSheet, AddMembersSheet (Modals) | All | DUAL-RENDERED: AppContent overlay + ConversationsStack navigator (native). |

---

### 1.2 Screen-like Components in `src/components/`

| File | Classification | Trigger open | Back/close | Must-stay-mounted | Gestures / Animations | Notes |
|---|---|---|---|---|---|---|
| `AppContent.tsx` | OUTSIDE-DECK (shell) | App root | — | YES — is the root | — | The boolean router being replaced |
| `ConversationLoadingScreen.tsx` | CARD (above deck) | AppContent: `showConversationLoading=true` + `pendingConversation != null` | `handleConversationLoadingComplete` (auto on animation end) | No | SVG path-draw animation; timed auto-close | No navigation gesture; pure animation then auto-advances |
| `WelcomeToLineupOverlay.tsx` | SHEET (root-level) | AppContent: `showWelcomeToLineupOverlay=true` after onboarding match | `onClose` → `markWelcomeLineupDismissed` | No | Slide-in animation (Animated.Value, not Modal); position:absolute backdrop | **NOT a Modal** — rendered as absolute-positioned View inside the main tree. Hides when profile opened over it via `welcomeOverlayHiddenByProfile`. |
| `ProfileEditPanel/ProfileEditPanel.tsx` | SHEET (root-level) | AppContent: `showProfileEditor=true` | `setShowProfileEditor(false)` | No | `<Modal animationType="none">` + Reanimated spring slide-up from bottom; swipe-down gesture (GestureDetector) | Contains sub-screens: ProfileEditSurfStyleScreen, ProfileEditSurfSkillScreen, ProfileEditTravelExperienceScreen, ProfileEditSurfVideoScreen, ProfileEditDestinationScreen, ProfileEditLifestyleScreen — all rendered inline as replacements, not Modals. Inner CountrySearchModal (Modal). Inner `<Modal animationType="fade">` for discard confirm. |
| `trips/joinRequest/JoinDecisionOverlay.tsx` | SHEET (root-level) | AppContent: `activeJoinDecision != null` | `onDismiss` / `onPrimaryAction` | No | `<Modal transparent animationType="fade">` | Queued — multiple unseen decisions shown one at a time |
| `notifications/NotificationCenter.tsx` | SHEET (root-level, right drawer) | Bell tap in TripsScreen header or ConversationsScreen header | Pan-right swipe or back button | No | `<Modal animationType="none">` + Animated.Value translateX slide; PanResponder swipe-out | Full-width panel (=window width). Owns fetch + realtime subscription. Used in both TripsScreen and TripDetailScreen headers. |
| `ConversationLoadingScreen.tsx` | (see above) | | | | | |
| `surftrips/CreateSurftripModal.tsx` | MODAL | SurftripDetailScreen; ConversationsScreen | onClose | No | `<Modal animationType="slide">` | |
| `surftrips/AddMembersSheet.tsx` | SHEET | SurftripDetailScreen | onClose | No | `<Modal animationType="slide">` | |
| `surftrips/ParticipantMenuSheet.tsx` | SHEET | SurftripDetailScreen | onClose | No | `<Modal transparent animationType="fade">` | |
| `trips/WizardBottomSheet.tsx` | SHEET (wizard input) | CreateTripFlowA / TripEditSheets | onClose | No | `<Modal animationType="none">` + Animated.Value spring-up from bottom; PanResponder drag-to-dismiss | Generic sheet shell used for all wizard input steps |
| `trips/TripBottomSheet.tsx` | SHEET | TripDetailView / TripDetailViewRedesigned | onClose | No | `<Modal transparent animationType="slide">` | |
| `trips/commitment/CommitmentSheet.tsx` | SHEET | TripDetailScreen | close() | No | `<Modal transparent animationType="slide">` | |
| `trips/commitment/CommitmentConfirmModal.tsx` | MODAL | CommitmentSheet | onCancel | No | `<Modal transparent animationType="fade">` | Confirm dialog inside CommitmentSheet |
| `trips/joinRequest/RequestToJoinSheet.tsx` | SHEET | TripDetailScreen | close() | No | `<Modal transparent animationType="slide">` | |
| `trips/gear/GearItemSheet.tsx` | SHEET | TripDetailScreen | onClose | No | `<Modal>`  | |
| `trips/gear/RequestGearSheet.tsx` | SHEET | TripDetailScreen | onClose | No | `<Modal>` | |
| `trips/gear/ManageGearSheet.tsx` | SHEET | TripDetailScreen | onClose | No | `<Modal>` | |
| `trips/gear/GearRequestsSheet.tsx` | SHEET | TripDetailScreen | onClose | No | `<Modal>` | |
| `trips/gear/PersonalGearSheet.tsx` | SHEET | TripDetailScreen | onClose | No | `<Modal>` | |
| `trips/gear/AddPersonalGearSheet.tsx` | SHEET | TripDetailScreen | onClose | No | `<Modal>` | |
| `trips/gear/EditSuggestedGearSheet.tsx` | SHEET | TripDetailScreen | onClose | No | `<Modal>` | |
| `trips/updates/AdminUpdateSheet.tsx` | SHEET | TripDetailScreen | onClose | No | `<Modal>` (WizardBottomSheet) | |
| `trips/TripEditSheets.tsx` | SHEET | TripDetailViewRedesigned | onClose | No | `<Modal>` (WizardBottomSheet) | Exports EditTextSheet, EditCoverSheet, EditDatesSheet, EditAccommodationSheet |
| `trips/WizardInfoOverlay.tsx` | MODAL (info overlay) | CreateTripFlowA | onClose | No | `<Modal transparent animationType="fade">` | Info overlay inside wizard |
| `HomeBreakSearchSheet.tsx` | SHEET | OnboardingStep4Screen, CreateTripFlowA, ProfileEditPanel | onClose | No | `<Modal transparent animationType="none">` + Animated.Value slide | |
| `HomeBreakViewSheet.tsx` | SHEET | ProfileScreen | onClose | No | `<Modal transparent animationType="none">` + Animated.Value slide | |
| `DateOfBirthSheet.tsx` | SHEET | OnboardingStep4Screen (via modal inside it) | onClose | No | `<Modal transparent animationType="none">` | |
| `MapPickerModal.tsx` | MODAL | CreateTripFlowA | onCancel | No | `<Modal animationType="slide">` native; iframe on web | Uses WebView (native-only). InlineMapView export used inline (not a modal). |
| `CountrySearchModal.tsx` | MODAL | ProfileEditPanel, OnboardingStep4DestinationsScreen | onClose | No | `<Modal transparent animationType="none">` + Animated slide | |
| `UserSearchModal.tsx` | MODAL | ConversationsScreen (legacy) | onClose | No | `<Modal animationType="slide">` | |
| `BlockUserOverlay.tsx` | MODAL | ProfileScreen | onClose | No | `<Modal transparent animationType="none">` | |
| `ReportBugOverlay.tsx` | MODAL | SettingsScreen | onClose | No | `<Modal transparent animationType="none">` | |
| `GalleryPermissionOverlay.tsx` | MODAL | ProfileScreen, OnboardingStep4Screen | onDismiss | No | `<Modal transparent animationType="none">` | |
| `AvatarCropModal.tsx` | MODAL | ProfileScreen | onClose | No | `<Modal transparent animationType="fade">` | Platform split: `.native.tsx` has `animationType="fade"` + `statusBarTranslucent`; `.tsx` (web) has basic Modal |
| `FullscreenImageViewer.tsx` | MODAL | DirectMessageScreen, DirectGroupChat | onClose | No | `<Modal animationType="fade">` | |
| `FullscreenVideoPlayer.tsx` | MODAL | DirectMessageScreen, DirectGroupChat | onClose | No | `<Modal animationType="fade">` | |
| `ImagePreviewModal.tsx` | MODAL | DirectMessageScreen, DirectGroupChat | onClose | No | `<Modal animationType="fade">` | Send-preview before upload |
| `VideoPreviewModal.tsx` | MODAL | DirectMessageScreen, DirectGroupChat | onClose | No | `<Modal animationType="fade">` | Send-preview before upload |
| `MessageActionsMenu.tsx` | MODAL | DirectMessageScreen, DirectGroupChat (long-press message) | onClose | No | `<Modal transparent animationType="fade">` | |
| `TutorialOverlay/TutorialOverlay.tsx` | NOT-NAVIGATION (coach-mark) | ConversationsScreen, TripPlanningChatScreen/Copy | onPressCta | No | `<Modal animationType="none">` + Animated.Value fade + SVG cutout backdrop | Render-anchored: needs AnchorRect from screen layout |
| `SwellyTopicOverlay/SwellyTopicOverlay.tsx` | NOT-NAVIGATION (topic picker) | TripPlanningChatScreen/Copy | onClose | No | `<Modal animationType="none">` + Animated.Value slide | |
| `ReportAISheet.tsx` | SHEET | TripPlanningChatScreen/Copy, SwellyShaperScreen, ChatScreen/OnboardingChatScreen | onClose | No | Uses WizardBottomSheet (Modal) | |
| `onboarding/SkipDisclaimerModal.tsx` | MODAL | OnboardingStep screens | onClose | No | `<Modal animationType="fade">` | |
| `ProfileEditPanel/ProfileEditSurfStyleScreen.tsx` | NOT-NAVIGATION (inline panel page) | ProfileEditPanel internal routing | internal back | No | Slide inside ProfileEditPanel Modal | |
| `ProfileEditPanel/ProfileEditSurfSkillScreen.tsx` | NOT-NAVIGATION (inline panel page) | ProfileEditPanel | internal back | No | Same | |
| `ProfileEditPanel/ProfileEditTravelExperienceScreen.tsx` | NOT-NAVIGATION (inline panel page) | ProfileEditPanel | internal back | No | Same | |
| `ProfileEditPanel/ProfileEditSurfVideoScreen.tsx` | NOT-NAVIGATION (inline panel page) | ProfileEditPanel | internal back | No | Same | |
| `ProfileEditPanel/ProfileEditDestinationScreen.tsx` | NOT-NAVIGATION (inline panel page) | ProfileEditPanel | internal back | No | Same | |
| `ProfileEditPanel/ProfileEditLifestyleScreen.tsx` | NOT-NAVIGATION (inline panel page) | ProfileEditPanel | internal back | No | Same | |
| `onboarding/OnboardingContentHost.tsx` | NOT-NAVIGATION (wrapper) | AppContent via OnboardingScaffold | — | — | — | Internal onboarding layout host |
| `onboarding/OnboardingScaffold.tsx` | NOT-NAVIGATION (wrapper) | AppContent | — | — | — | Shared header+footer frame for onboarding steps |

---

## 2. Cross-check: Known List vs. Discovered

| Item from known-incomplete list | Found? | Classification | Location |
|---|---|---|---|
| Trip overview (trip detail) | YES | CARD inside TripsScreen | `src/screens/trips/TripDetailScreen.tsx` |
| Surftrip detail | YES | CARD (dual-rendered) | `src/screens/surftrips/SurftripDetailScreen.tsx` |
| User profile | YES | CARD above deck | `src/screens/ProfileScreen.tsx` |
| DM chat | YES | CARD (dual-rendered) | `src/screens/DirectMessageScreen.tsx` |
| Group chat | YES | CARD (dual-rendered) | `src/screens/DirectGroupChat.tsx` |
| Conversation loading | YES | CARD above deck | `src/components/ConversationLoadingScreen.tsx` |
| Edit trip | YES | CARD inside TripsScreen | CreateTripWizard (edit mode) as absoluteFill View |
| Settings | YES | CARD above deck | `src/screens/SettingsScreen.tsx` |
| Swelly shaper | YES | CARD above deck | `src/screens/SwellyShaperScreen.tsx` |
| Swelly trip-planning chat | YES | CARD (persistent absoluteFill) | `src/screens/TripPlanningChatScreen.tsx` |
| Swelly trip-planning chat copy | YES (EXPERIMENTAL) | CARD (persistent absoluteFill) | `src/screens/TripPlanningChatScreenCopy.tsx` |
| Notifications panel | YES | SHEET (right drawer) | `src/components/notifications/NotificationCenter.tsx` |
| Trips filters | PARTIAL | NOT-NAVIGATION (inline) | Month/budget filters are in-line chips within TripsScreen, not a separate navigation layer |
| When-picker/calendar | YES | SHEET (inside WizardBottomSheet) | `src/components/trips/sheets/WhenSheetContent.tsx` + `src/components/trips/CalendarRangePicker.tsx` |
| Map picker | YES | MODAL | `src/components/MapPickerModal.tsx` |
| Profile editor | YES | SHEET (root-level Modal) | `src/components/ProfileEditPanel/ProfileEditPanel.tsx` |
| Join decision | YES | MODAL (root-level) | `src/components/trips/joinRequest/JoinDecisionOverlay.tsx` |
| Welcome-to-lineup | YES | SHEET (absoluteFill View, NOT Modal) | `src/components/WelcomeToLineupOverlay.tsx` |
| Create-trip wizard | YES | MODAL (fullscreen) | `src/screens/trips/CreateTripWizard.tsx` → `CreateTripFlowA.tsx` |
| Onboarding | YES | OUTSIDE-DECK | OnboardingStep1–7 + Welcome screens in AppContent |
| Age-block | YES | OUTSIDE-DECK (inline JSX) | Inline JSX in AppContent render, no separate file |
| **MISSING from known list** | | | |
| ConversationsScreen (Lineup root) | — | ROOT | `src/screens/ConversationsScreen.tsx` |
| MVPThankYouScreen | — | OUTSIDE-DECK | `src/screens/MVPThankYouScreen.tsx` |
| SwellyoTeamWelcome | — | CARD (early-return inside ConversationsScreen) | `src/screens/SwellyoTeamWelcome.tsx` |
| DeleteAccountScreen | — | CARD inside SettingsScreen | `src/screens/DeleteAccountScreen.tsx` |
| PrivacyPreferencesScreen | — | CARD inside SettingsScreen | `src/screens/PrivacyPreferencesScreen.tsx` |
| BlockedUsersScreen | — | CARD inside PrivacyPreferencesScreen | `src/screens/BlockedUsersScreen.tsx` |
| AnalyticsDashboardScreen (admin) | — | CARD inside SettingsScreen | `src/screens/AnalyticsDashboardScreen.tsx` |
| ReportUserScreen | — | CARD inside ProfileScreen | `src/screens/ReportUserScreen.tsx` |
| TripPublishedScreen | — | CARD inside wizard | `src/screens/trips/TripPublishedScreen.tsx` |
| LoadingScreen | — | OUTSIDE-DECK (dead path) | `src/screens/LoadingScreen.tsx` |
| ProfileEditPanel sub-screens (6) | — | NOT-NAVIGATION (inline panel pages) | `src/components/ProfileEditPanel/` |
| All gear sheets (7 files) | — | SHEET inside TripDetailScreen | `src/components/trips/gear/` |
| TripEditSheets (4 exports) | — | SHEET inside TripDetailScreen | `src/components/trips/TripEditSheets.tsx` |
| CommitmentSheet + ConfirmModal | — | SHEET inside TripDetailScreen | `src/components/trips/commitment/` |
| AdminUpdateSheet | — | SHEET inside TripDetailScreen | `src/components/trips/updates/AdminUpdateSheet.tsx` |
| RequestToJoinSheet | — | SHEET inside TripDetailScreen | `src/components/trips/joinRequest/RequestToJoinSheet.tsx` |
| ConversationsStack navigator | — | Navigation infrastructure | `src/navigation/ConversationsStack.tsx` |

---

## 3. Key Architectural Facts

### 3.1 The Existing Navigation Architecture

AppContent is a single-component boolean router. Priority cascade (first truthy wins):
1. `showAgeBlockOverlay` → inline JSX age block
2. `isRestoringSession` → WelcomeScreen (as spinner)
3. `shouldShowConversations` (post-onboarding main app) → main app tree
4. `currentStep >= 0 && <= 7` → OnboardingScaffold
5. Default → WelcomeScreen (auth gate)

Inside the main app tree (`shouldShowConversations` branch), layers stack bottom-to-top:
```
ConversationsStack (always mounted, never unmounts)
TripPlanningChatScreen (absoluteFill, display:none when not active)
TripPlanningChatScreenCopy (absoluteFill, display:none when not active)
activeOverlay (absoluteFill when truthy — one of: SurftripDetail, Trips, Settings, SwellyShaper, Profile, ConversationLoading, DM/GroupChat)
TripsBottomNav (floating, z-index above all, conditional)
WelcomeToLineupOverlay (position:absolute, NOT a Modal)
ProfileEditPanel (Modal, bottom-sheet)
JoinDecisionOverlay (Modal, transparent)
```

### 3.2 ConversationsStack — Existing React Navigation Usage

`src/navigation/ConversationsStack.tsx` already uses react-navigation via `react-native-screen-transitions/blank-stack` (a custom stack navigator). It has three screens:
- `ConversationsList` → ConversationsScreen
- `DirectMessage` → DirectMessageScreen or DirectGroupChat
- `SurftripDetail` → SurftripDetailScreen

**Platform branch**: On web (`Platform.OS === 'web'`), the stack is bypassed entirely — ConversationsScreen is rendered directly with `stackScreenFocused=true`. The stack is native-only.

### 3.3 DUAL-RENDERED Screens (Migration Landmine)

Three screens render in two different navigation contexts simultaneously:
- **DirectMessageScreen**: AppContent overlay (via `selectedConversation` state) + ConversationsStack navigator (`DirectMessage` screen)
- **DirectGroupChat**: Same dual-render pattern as above
- **SurftripDetailScreen**: AppContent overlay (via `activeSurftripDetailId`) + ConversationsStack navigator (`SurftripDetail` screen) + TripsScreen internal (from notification deep-link via ConversationsStack push)

These must be reconciled in the migration. The AppContent path is the legacy path; the ConversationsStack path is newer. The migration must pick one canonical path.

### 3.4 TripPlanningChatScreenCopy is PRODUCTION

Despite the "Copy" name, `TripPlanningChatScreenCopy.tsx` is what the Swelly button actually opens (`handleSwellyPress` → `setActiveCopyService('copy')` → `setShowTripPlanningChatCopy(true)`). The non-copy `TripPlanningChatScreen.tsx` is not triggered by any user action in the current production wiring — it remains mounted-but-invisible if it was ever opened. Verify before migrating whether to keep both.

### 3.5 Persistent Mount Strategy (Critical for Migration)

AppContent uses an explicit "ever shown" flag + `display:'none'` pattern for both Swelly chat screens to preserve:
- Chat messages and scroll position (in-memory state)
- Supabase websocket subscription (remount would replay enter animation + re-subscribe)
- `pointerEvents` set to `'none'` when not frontmost (not `display:'none'` alone — they work together)

In react-navigation, this maps to keeping these as non-focusable mounted screens or using a custom `tabBarStyle: { display: 'none' }` approach. A standard stack push/pop will break this — the screens must remain mounted.

### 3.6 ConversationsScreen Subscription State

ConversationsScreen must stay mounted at all times once in the main app (by design). It holds Supabase Realtime conversation subscriptions. The `isListFrontmost` prop gates tutorial triggers and some UI behavior, but the screen itself never unmounts.

### 3.7 TripsBottomNav — One Instance, Three Roots

The bottom nav is a single persistent component rendered at the AppContent level, shared by three "roots": Lineup (ConversationsScreen), Trips (TripsScreen), Profile (ProfileScreen/own profile). It has an animated pill that slides between items. It uses a `TripsBottomNavControl` shared value object passed down via props. Any migration that splits these three into separate navigator screens must pass or hoist this shared control — it cannot be per-screen.

### 3.8 Platform Split — web vs native navigation

- **Web**: ConversationsStack renders ConversationsScreen directly; DirectMessage/SurftripDetail use AppContent's `selectedConversation` / `activeSurftripDetailId` state.
- **Native**: ConversationsStack uses the blank-stack navigator with slide-from-right transitions and edge swipe-back.
- Both platforms share AppContent's overlay layers (Profile, Settings, Trips, etc.).

### 3.9 Settings Sub-Tree (Early-Return Pattern)

SettingsScreen, ProfileScreen, ConversationsScreen all use early-return patterns to render sub-screens (DeleteAccount, PrivacyPreferences, ReportUser, SwellyoTeamWelcome). These are currently not accessible via back-stack — the parent re-renders the whole tree. In the target architecture these would likely become `transparentModal` or card routes.

### 3.10 Back Navigation Is Fully Hand-Rolled

There is no navigation.goBack() call at AppContent level. Every back action is a callback prop that flips a boolean. The origin-tracking (profileFromTripDetail, profileFromTripPlanningChat, profileFromWelcomeOverlay, profileFromOnboardingChat, profileFromSwellyShaper) is a state machine in AppContent that determines where `handleProfileBack` returns to. This logic must be encoded as proper navigation history in the migration.

---

## 4. Experimental / Copy Files Inventory

| File | Status | Shadows | Notes |
|---|---|---|---|
| `src/screens/TripPlanningChatScreenCopy.tsx` | **PRODUCTION (misleading name)** | `TripPlanningChatScreen.tsx` | Actually what the Swelly button opens. Has extra `visible` prop and `service`/`onboardingMatches` props the non-copy lacks. |
| `src/components/DestinationInputCardCopy.tsx` | EXPERIMENTAL | `DestinationInputCard.tsx` | Used by `TripPlanningChatScreenCopy`; not in production flow if non-copy is used |
| `src/components/DestinationCardsCarouselCopy.tsx` | EXPERIMENTAL | `DestinationCardsCarousel.tsx` | Unknown usage — needs grep to confirm live consumers |
| `src/services/swelly/swellyServiceCopy.ts` | LIVE (used by copy screen) | `swellyService.ts` | Imported in AppContent for `swellyServiceCopy` and `swellyServiceCopyCopy` instances |

---

## 5. Summary Counts

| Category | Count |
|---|---|
| Screens in `src/screens/` | 33 files (including 1 re-export, 2 experimental variants) |
| OUTSIDE-DECK (auth/onboarding) | 13 |
| ROOT (tab anchors) | 1 explicit (ConversationsScreen/Lineup); TripsScreen and ProfileScreen are tabs but rendered as overlays |
| CARD (pushes above deck) | ~15 |
| SHEET (bottom/side drawers via Modal) | ~25 Modals across components |
| NOT-NAVIGATION (overlays/inline/toasts) | ~10 |
| `<Modal>` usage sites | 45 files |
| absoluteFill fullscreen containers | 52 files (includes non-modal fullscreen elements) |
| Platform-split files (.web.tsx / .native.tsx) | 3 (CountryPickerWrapper.web, CountryPickerWrapper.native, AvatarCropModal.native) |

---

## 6. Landmines for Migration Plan

1. **Dual-render deduplication required**: DirectMessageScreen, DirectGroupChat, SurftripDetailScreen each render via two separate code paths (AppContent overlay + ConversationsStack navigator). These must be unified to one canonical route before migrating.

2. **TripPlanningChatScreenCopy is the live Swelly screen**: Migrating only the non-copy would silently break the Swelly feature. Both screens must be handled; the "copy" naming must be cleaned up.

3. **WelcomeToLineupOverlay is NOT a Modal**: It is a position:absolute View rendered inline. Its visibility is controlled by `visible` prop + Animated.Value. It must co-exist with other overlays and supports a "hidden by profile" state. Cannot be a transparentModal route without significant rework.

4. **ProfileScreen origin tracking = back-stack history**: The six `profileFrom*` flags encode "where to return after closing Profile." In react-navigation this becomes natural history, BUT the ProfileFromTripDetail path re-opens TripsScreen with `pendingTripDetailId` restored — this is not a simple goBack(). The migration must encode this as params on the Trips route.

5. **ConversationsScreen must never unmount** after first mount. Any navigator that would unmount/remount it on tab switch (e.g., a basic createBottomTabNavigator with `unmountOnBlur`) will break real-time subscriptions.

6. **TripsBottomNav animated pill is one shared Reanimated SharedValue instance**. It must remain a single component instance across Lineup/Trips/Profile. Tab navigators that re-mount the nav bar on each tab will break its cross-tab animation.

7. **Age-block overlay has no file** — it is inline JSX in AppContent (lines 1713–1732). Migration must extract it.

8. **LoadingScreen.tsx exists but is unreachable** — AppContent explicitly comments that it skips LoadingScreen (line 847). Confirm before discarding — it has a consent Modal that may be needed for App Store compliance.

9. **ConversationsStack already uses react-navigation** (`react-native-screen-transitions/blank-stack`). The migration must decide whether to keep this inner navigator or absorb it into the top-level navigator. The web branch bypasses it entirely.

10. **ProfileEditPanel uses `animationType="none"` Modal with custom Reanimated spring** — it drives its own enter/exit animation via JS-thread. In react-navigation `transparentModal` this would conflict unless the default screen animation is suppressed.
