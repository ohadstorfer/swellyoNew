# Swellyo — Full UX Audit

**Goal:** get the app to WhatsApp / Instagram-level polish.
**Method:** six senior-designer passes over the whole app (onboarding/auth, messaging, trips, matching/Swelly AI, profile/settings/safety, and global cross-cutting), reading the actual screen code. Every finding cites `file:line` and a fix.
**Date:** 2026-07-17

Severity legend: 🔴 Critical (breaks flow / looks broken / silent data loss) · 🟠 High (clearly below the WA/IG bar) · 🟡 Medium (polish) · 🔵 Low (nitpick)

> Per-domain deep-dives with every finding live in `docs/ux-audit/audit-01…06.md`. This file is the consolidated, prioritized master.

---

## The 6 systemic themes (fix these once, help everywhere)

These patterns repeat across every domain. Fixing the *pattern* is higher-leverage than fixing individual screens.

1. **Silent failure / "success on failure."** The single biggest theme. Errors are `catch`-and-`console.error`-and-continue: delete-account, report, block, unblock, avatar upload, onboarding step 7, matching, privacy toggle, share. Users are told things worked when they didn't. → Gate every success UI on a real success response; on failure show a friendly, retryable error. The codebase already has `friendlyErrorMessage`/`showErrorAlert` — use them.
2. **Loading = a text swap or nothing, never a proper indicator.** Primary CTAs say "Signing in…" instead of a spinner; awaited host/trip actions sit dead; chats/profiles/blocked-list open blank; cold react-query caches render false empty states. → A spinner-in-button convention + skeletons for cold loads + distinguish "empty" from "loading" from "error."
3. **No offline / connection feedback.** DM, group, provider, and matching all *track* realtime health and run reconnect logic but never surface it; no global offline banner. On a dead socket, messages silently stop and optimistic sends look sent. → A "Connecting…" pill in chat + a global NetInfo offline strip.
4. **No global crash boundary.** `PostHogErrorBoundary` re-throws everything else, so any render crash = permanent white screen (Sentry logs it, user sees nothing). → A top-level branded "Something went wrong — Reload" boundary.
5. **Font weights render wrong on iOS at ~700 call sites** (728 bare `fontFamily`+`fontWeight` vs 316 `ff()`). iOS ignores weight for custom fonts, so headings/buttons ship thinner than Figma app-wide. → Sweep bare font styles to `ff()`, starting with buttons/headlines.
6. **Theming & primitive drift.** `Button`/`Input` are effectively unused; "dark" is spelled 4+ ways (`#212121`/`#333333`/`#222B30`/`#090909`); two destructive-reds and two success-greens; ad-hoc `TouchableOpacity` everywhere; 282 blocking `Alert.alert` and no toast primitive. → Real `<Button variant>` + design tokens + a lightweight toast.

---

## 🔴 Critical — fix first (silent data loss, dead-ends, blank screens)

| # | Area | Issue | Location |
|---|------|-------|----------|
| 1 | Safety | **Delete-account** shows "Request received" + logs the user out even when the request threw. They think they're leaving; nothing was sent. | `DeleteAccountScreen.tsx:109-125` |
| 2 | Safety | **Report** shows "Report received" even on failure; the "also block this user" checkbox can silently no-op while the flow navigates away as if blocked. | `ReportUserScreen.tsx:212-234` |
| 3 | Onboarding | Final **"Create Profile"** step marks onboarding complete + enters the app even when the profile save fails — user lands with a possibly-missing `surfers` row and no error. | `AppContent.tsx:1045-1054` |
| 4 | Auth | **Developer error copy ships to users** on sign-in failure ("A database trigger is failing", "check the Supabase dashboard settings"). | `WelcomeScreen.tsx:683-728` |
| 5 | Global | **No crash boundary** — any render error = permanent white screen. | `PostHogErrorBoundary.tsx:34` |
| 6 | Chat | **No day/date separators** in DM or group; only HH:MM. Can't tell when anything was sent in a multi-day thread — the #1 missing WhatsApp affordance. | `DirectMessageScreen.tsx:4721`, `DirectGroupChat.tsx:4605` |
| 7 | Chat | **No offline / "Connecting…" feedback** despite full health tracking; dead socket = messages silently stop, queued sends look sent. | `DirectMessageScreen.tsx:1006`, `DirectGroupChat.tsx:992`, `MessagingProvider.tsx:1392` |
| 8 | Chat | **Blank chat on cold/cache-miss open** — `listEmptyComponent` returns `null` while fetching (an unused skeleton style already exists). | `DirectMessageScreen.tsx:4690`, `DirectGroupChat.tsx:4574` |
| 9 | Chat | **Multi-photo OS share drops all but the first image** while previewing "N photos." | `ShareToChatScreen.tsx:111-120` |
| 10 | Chat | **Swelly AI chat send-failure has no recovery** — optimistic bubble stays looking sent, no retry. | `ChatScreen.tsx:553-555` |
| 11 | Matching | **Network/timeout errors are dressed up as "no surfers found"** (blames the user's filters); service layer has no timeout and no retry. | `TripPlanningChatScreen.tsx:1191-1196` |
| 12 | Matching | **Zero-match state has no CTA** — the most important screen in a hard-filter search is one gray sentence; the action row only renders when matches > 0. | `TripPlanningChatScreen.tsx:1164`, `:1906` |
| 13 | Matching | **Silent 30s loading timeout** kills the spinner with no message and never aborts the request → dead end. | `TripPlanningChatScreen.tsx:1059-1066` |
| 14 | Trips | **Trip-detail load failure = infinite skeleton, no retry** (`isError`/`refetch` never checked). | `TripDetailScreen.tsx:1298-1305` |
| 15 | Trips | **Leave-trip & Remove-participant** await the round-trip but their loading states (`leaving`, `removingUserId`) are never rendered → app sits silent. | `TripDetailScreen.tsx:861-890`, `:770-799` |
| 16 | Trips | **Non-members can "Request to join" a past/ended trip** (`showJoinCta` checks `!isCancelled` but not `isLocked`). | `TripDetailScreen.tsx:1319-1321` |
| 17 | Trips | **Create wizard has no progress indicator and no Android hardware-back guard** — back bypasses the exit-confirm + draft flush; 5-6 steps with no sense of length. | `CreateTripFlowA.tsx:1237`, `CreateTripWizardChrome.tsx:98-99` |
| 18 | Trips | **Hung publish traps the user** — sequential upload→create→destination awaits with no timeout, exit buttons disabled during submit. | `CreateTripFlowA.tsx:1745-1935` |
| 19 | Trips | **Legacy surftrips: every action awaits + full refetch, zero optimism** — the exact slow-CTA pattern group trips already fixed. | `SurftripDetailScreen.tsx:254-391` |
| 20 | Onboarding | **Create-Profile looks like a dead button** — CTAs never spin (text-swap only) and Step-4 required-field errors are border-only, no message, no scroll-to-error. | `OnboardingStep4Screen.tsx:925-927` |

---

## 🟠 High — clearly below the WhatsApp/Instagram bar

### Messaging & chat
- **Groups are anonymous:** delivery/read ticks hard-disabled (a group sender gets *no* "sent" confirmation), typing shows anonymous dots even though per-typer identities are tracked, no member roster / member-count subtitle (header opens trip detail instead). `DirectGroupChat.tsx:114`, `:4178`, `:5456`
- **Failed voice message is a dead bubble** — alert icon, disabled play, no tap-to-retry (image/album paths do retry). `AudioMessageBubble.tsx:173`
- **Hardcoded Spanish** in the DM failed-text menu inside an English app ("Mensaje sin enviar", "Reenviar", …). `DirectMessageScreen.tsx:4156`
- **Android list jumps** on prepend/trim — `maintainVisibleContentPosition` is iOS-only; loading older messages visibly jumps the viewport. `DirectMessageScreen.tsx:5792`, `DirectGroupChat.tsx:5702`
- **List-wide re-renders + un-memoized bubbles** — opening the menu / a read receipt / editing re-renders every visible cell; each row re-runs link regex, text-align char-loop, emoji detection. `DirectMessageScreen.tsx:4665`, `:4728`
- **Red "Sending…" spinner reads as an error** for a normal in-flight group text (red is the error color everywhere else). `DirectGroupChat.tsx:5363-5367`
- **Swelly AI init failure = dead screen** (one-shot Alert, empty chat, no retry). `ChatScreen.tsx:323-330`

### Trips
- **No pull-to-refresh** on trip detail / members / surftrips; detail relies solely on realtime. `TripDetailScreen.tsx:1471`
- **Cold-cache false empties** on six sub-screens (gear, updates, members) — render "No items yet" instead of a skeleton when deep-linked from a push. `PackingAndGearScreen.tsx:154`, `TripUpdatesScreen.tsx:171`, `TripMembersScreen.tsx:304`, `YourGearScreen.tsx:225`
- **My Trips has no error state** — a failed cold load renders the "you haven't joined any trips" empty state. `TripsScreen.tsx:1150-1160`
- **Cancel / Complete trip awaited** (highest-stakes host actions hold the UI on the round-trip). `TripDetailScreen.tsx:801-859`
- **All member-management (promote/demote/remove) awaited with no per-row feedback and re-tappable rows.** `TripMembersScreen.tsx:135-198`
- **Trip-not-found is a dead-end** — bare text, no icon/CTA, doesn't distinguish 404 from network error. `TripDetailScreen.tsx:1286-1295`
- **No image-upload progress** in the create wizard; **zero haptics** in the entire wizard. `CreateTripFlowA.tsx:494-524`, `:1745`
- **Two destructive-reds + two success-greens + `#0788B0` hardcoded ~15×.** `TripDetailScreen.tsx:321/2041/2643/2661`
- **CTA buttons lack accessibility labels/roles.** `TripDetailScreen.tsx:2090-2115`, `:1813`

### Matching & Swelly AI
- **Match cards are anonymous & generic** — name + "age | country" only, one shared cover image, can render literally "User", no image placeholder/fade/onError, and **no "Message" button** (the handler exists). Show *why* they matched. `MatchedUserCard.tsx:21-59`, `TripPlanningChatScreen.tsx:1456`
- **Everything is free-text; yes/no parsed by substring** — "not now" contains "now" → read as YES. No quick-reply chips anywhere. `TripPlanningChatScreen.tsx:1220-1289`
- **Carousel auto-jumps to the middle card** on layout, hiding the top matches. `MatchedUsersCarousel.tsx:33-39`
- **Destination pickers fail silently** — Places autocomplete (no-results / error / missing-key all → "nothing appears"), decorative map that covers the form, cleared duration desyncs data from UI. `DestinationMapPickerCard.tsx:450-609`, `MapPickerModal.tsx:77-368`, `DestinationInputCard.tsx:170-174`
- **SwellyShaper has no loading timeout** — a hung request spins forever with input disabled. `SwellyShaperScreen.tsx:190-252`
- **sendMessage failure uses a native Alert** and loses the turn (violates the project's own in-chat convention). `TripPlanningChatScreen.tsx:1447`

### Profile, settings & safety
- **Block / unblock failures are invisible** (spinner resets, no message); a failed blocked-list load shows the same "No blocked users" as genuinely empty. `BlockUserOverlay.tsx:40-50`, `BlockedUsersScreen.tsx:44-84`
- **Other-user profile loads to a blank screen** (header only) and load-failure offers only "Go Back," no retry. `ProfileScreen.tsx:2045-2104`
- **Switch-account errors swallowed; no loading/disabled state** → double-tap fires two sign-in attempts. `SettingsScreen.tsx:123-137`, `:239-242`
- **Delete-account sits in the neutral list** with no danger styling (Log out is red, but the most destructive item looks benign). `SettingsScreen.tsx:224-227`

### Global / cross-cutting
- **Global `StatusBar style="light"`** paints white icons on every light screen (onboarding/welcome/loading/permission are white). `App.tsx:130`
- **No global network-offline indicator.** (See theme #3.)
- **Raw error text leaked in logout alerts** + 49 generic "Error" titles + no success/confirmation toast primitive. `ConversationsScreen.tsx:600`, `SettingsScreen.tsx:79`
- **Fullscreen image viewer has no pinch-to-zoom, no share/save, no web gestures.** `FullscreenImageViewer.tsx`
- **53 raw `<Modal>` usages** vs the excellent `BottomSheetShell` (18) → backdrop/dismiss/Android-nav-bar behavior drifts sheet-to-sheet. `AppContent.tsx:1999`, viewers, permission overlays
- **No React Navigation `linking` config** — all deep links hand-parsed in a 2353-line `AppContent`; a killed app never restores its nav stack. `App.tsx:141`
- **`LoadingScreen` fakes safe-area with a magic `90`** instead of `useSafeAreaInsets()`. `LoadingScreen.tsx:609`

---

## 🟡 Medium — polish that adds up

### Messaging
- No conversation-row actions (mute / delete / archive / mark read-unread / pin); no pull-to-refresh on the list. `ConversationsScreen.tsx:973-977`, `:1279`
- Fake "Swellyo Team" row shows a permanent unread "1" every launch. `ConversationsScreen.tsx:475`
- No single-tick "sent" vs double-tick; no haptic on send / reaction-apply; copy has no "Copied" confirmation. `DirectMessageScreen.tsx:126`, `:4146`, `:3914`
- Video signing round-trip has no loading/error state (frozen poster, failure just closes the viewer). `DirectMessageScreen.tsx:5016-5031`
- No Forward / mark-as-unread / @mentions / pinned; 500-char hard cap silently truncates a pasted paragraph. `DirectMessageScreen.tsx:5862`, `:6293`
- Received group message can show the **group name** as the author on missing sender enrichment. `DirectGroupChat.tsx:4655`
- Group empty chat renders nothing; no "say hi" / member-count intro. `DirectGroupChat.tsx:4578`
- Heavy un-gated `console.log` in hot message paths (per-message metadata to logs). `MessagingProvider.tsx:1091-1314`

### Onboarding
- Age-verification sheet is a **trap**: no Cancel button, backdrop-tap only closes in the error state, no Android back. `WelcomeScreen.tsx:991`
- Silent avatar upload fallback persists a base64 blob as the profile image. `OnboardingStep4Screen.tsx:961-985`
- Surf-video upload is fire-and-forget (`console.error` only), no progress/retry. `OnboardingVideoUploadScreen.tsx:424-430`
- Restore can take ~20s on bad network showing only a spinning logo; step-2 video has no error/fallback if it never loads; Step-6 "Select 3 or more!" is never enforced; pronoun defaults to "sis" for everyone. `OnboardingContext.tsx:39-48`, `OnboardingStep2Screen.tsx:108`, `OnboardingStep6LifestyleScreen.tsx:194`, `OnboardingStep4Screen.tsx:773`
- `allowFontScaling={false}` across onboarding breaks Dynamic Type. `OnboardingWelcomeScreen.tsx:83-98`

### Trips
- No section-level loading in trip detail (participants/gear/updates pop in as empty→filled). `TripDetailScreen.tsx:341-376`
- Gear claim awaited in two screens but optimistic in `YourGearScreen` — inconsistent. `PackingAndGearScreen.tsx:85`, `TripDetailScreen.tsx:1099`
- My Trips card hides capacity that Explore shows; gear-request pops a blocking Alert while join succeeds silently (two paradigms). `TripsScreen.tsx:203-322`, `TripDetailScreen.tsx:1113`
- Draft can't restore images (local URIs go stale); `void firstErrorField` → no scroll-to-first-error; budget allows a `$0–$0` range. `CreateTripFlowA.tsx:314-329`, `:3152`, `:1651`
- Reorder failure swallowed to console in `ManageGearScreen` (list snaps back unexplained). `ManageGearScreen.tsx:110-112`
- No bookmark/save anywhere in the Trips domain; three copies of `formatRelativeTime`. `TripUpdatesScreen.tsx`, `TripMembersScreen.tsx`

### Matching
- No suggested-reply chips; no tap-to-edit a filter; filter removal is immediate with no undo. `TripPlanningChatScreen.tsx:1593`, `:1709`
- Input disables globally on an unresolved action row even when it's scrolled off-screen. `TripPlanningChatScreen.tsx:2300`
- Rich "closest matches + reason" logic exists in legacy `matchingService.ts` but the live server path throws it away (dead best-in-codebase empty state).
- Three bespoke infinite carousels + duplicated `TypingIndicator`; `BudgetButtonSelector` fakes a 300ms "Submitting…" delay with no real work. `BoardCarousel.tsx`, `BudgetCardsCarousel.tsx`, `BudgetButtonSelector.tsx:37`

### Profile / settings
- Avatar upload has no visible progress ring (`isUploadingImage` never rendered). `ProfileScreen.tsx:1079`
- Home-break "unset" dim overlay shows on *other* users' profiles; empty lifestyle/destinations sections vanish with no placeholder. `ProfileScreen.tsx:2890`, `:2930`, `:3008`
- Privacy analytics toggle never reverts on failure (a privacy setting that lies); "Blocked accounts" buried under a mislabeled "Contacts" row; toggles have no `accessibilityRole="switch"`. `PrivacyPreferencesScreen.tsx:85-138`
- Report "Other" reason has no free-text field; web avatar-crop has no busy guard (double-tap → double upload). `ReportUserScreen.tsx:105`, `AvatarCropModal.tsx:100-111`
- Header/back affordance + title fonts differ across ProfileScreen vs the whole Settings stack. `SettingsScreen.tsx:282`, `ProfileScreen.tsx:1916`

### Global
- `allowFontScaling=false` set globally (accessibility) — prefer a capped `maxFontSizeMultiplier`. `App.tsx:84-87`
- `BottomSheetShell` `avoidKeyboard` uses `behavior="height"` on Android (clips inputs on fixed-height sheets). `BottomSheetShell.tsx:144`
- `AppContent.tsx` (2353 lines) documents multiple past freezes from its re-render fan-out — decompose into providers/hooks. `AppContent.tsx:1801-1849`
- Color-token drift (266 `#FFFFFF`, 246 `#333333`, "dark" in 4 hexes); shared `Button`/`Input` near-dead.

---

## 🔵 Low — nitpicks & cleanup (full list in per-domain files)

Representative sample: aggressive `activeOpacity={0.2}` on conversation rows; near-limit character counter missing; hardcoded "10:45" timestamp in the team-welcome chat; "3 More" button label hardcoded regardless of count; dead styles shipping (`opacity:0` "REMOVED" board container, `skipButton opacity:0`); clipped Delete-account back button (`fontSize:16 / lineHeight:15`); `GoogleSignInTest.tsx` / `handleLogin` dead stubs; hardcoded dimensions on match cards; duplicate `TripPublished` share-cancel string matching.

---

## Suggested sequencing

1. **Stop lying to users (1 day):** the 🔴 silent-failure set — delete-account, report+block, onboarding step-7, matching-error-vs-empty. Pure `catch` → gate-on-success + friendly retry. Highest trust impact, lowest effort.
2. **Stop blank/dead screens (1–2 days):** global crash boundary (#5), chat cold-load skeletons (#8), trip-detail error/retry (#14), "Create Profile" spinner + inline errors (#20).
3. **WhatsApp table-stakes in chat (2–3 days):** day/date separators (#6), offline/"Connecting…" pill (#7), group send-ticks + who's-typing, failed-voice retry, drop the Spanish strings.
4. **Trip CTA latency (1–2 days):** make leave / remove / cancel / complete / member-mgmt / surftrips optimistic (the join/withdraw handlers are the working template).
5. **Matching payoff (1–2 days):** real zero-match CTA, quick-reply chips, richer match cards + Message button, kill the silent 30s timeout.
6. **Systemic polish (ongoing):** font sweep to `ff()`, per-screen StatusBar, toast primitive, `<Button>`/tokens, pinch-zoom viewer, NetInfo offline banner, `linking` config.

---

*Generated from six parallel domain audits. For every finding's full rationale and fix, see `docs/ux-audit/audit-01-onboarding-auth.md` … `audit-06-global-crosscutting.md`.*
