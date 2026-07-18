# UX Audit 05 — Profile, Settings & Safety

Scope: profile view/edit, settings, privacy, blocking, reporting, account deletion.
Bar: WhatsApp / Instagram-level polish.
Date: 2026-07-17. Reviewer: senior product designer (code-level).

Severity key: 🔴 Critical · 🟠 High · 🟡 Medium · 🔵 Low

---

## Top 5 most impactful fixes

1. 🔴 **Delete-account request silently fails but always shows "Request received."** If the notification fetch throws, the error is swallowed and the success overlay + logout still fire. The user believes their account is being deleted; nothing was ever requested. `DeleteAccountScreen.tsx:109-125`.
2. 🔴 **Report always shows "Report received" even when the report failed**, and the "Block this user too" checkbox can silently fail while the flow still reports success and navigates away as if blocked. `ReportUserScreen.tsx:212-234`.
3. 🟠 **Block failures are invisible.** In both the block overlay and the unblock sheet, a failed operation just resets a spinner with no message — the user taps, nothing happens, no explanation. `BlockUserOverlay.tsx:40-50`, `BlockedUsersScreen.tsx:74-84`.
4. 🟠 **Other-user profile loading shows a blank screen** (header only, no spinner/skeleton) and network-failure gives only "Go Back" with no retry — a transient blip forces the user to fully re-navigate. `ProfileScreen.tsx:2045-2061`, `2090-2104`.
5. 🟡 **Inconsistent safety-consequence copy + no haptics on destructive actions.** Block is described two different ways; delete/block/report confirmations lack the haptic feedback that approve/decline already use. `BlockUserOverlay.tsx:73-75` vs `ReportUserScreen.tsx:324-326`.

---

## Safety flows (highest priority)

### DeleteAccountScreen.tsx

- 🔴 **Failed deletion request reported as success.** `handleConfirmDelete` (`109-112`) wraps `sendDeleteNotification` in try/catch that only `console.error`s, then unconditionally advances to the "Request received" overlay (`115-125`) and logs the user out (`128-133`). If the network/edge function failed, no deletion request exists but the user is told "It will be permanently removed within 30 days." This is the worst kind of silent failure — a user who wants to leave thinks they have. **Fix:** on catch, keep the "Are you sure" dialog open and show an inline error ("Couldn't submit your request. Check your connection and try again."). Only show the confirmation overlay on a successful response.
- 🟡 **Deletion is not actually verifiable to the user.** The flow is a notification email to admins, not a real delete. Copy says "we'll start deleting your account" — acceptable, but there's no in-app record/status of the pending request and no in-app "cancel deletion" other than the buried "just log back in." **Fix:** consider a persisted "deletion pending" banner on next login with an explicit Cancel button.
- 🟡 **Back-button text is clipped.** `backButtonText` is `fontSize: 16` with `lineHeight: 15` (`325-328`) — line height smaller than font size clips descenders. Every other back pill in this stack is `fontSize:12 / lineHeight:15`. **Fix:** set lineHeight ≥ fontSize (e.g. 20) or match the 12/15 pattern.
- 🔵 Reason option "No reason" (`24`) reads oddly next to "Something else." Minor copy.
- 🔵 Double confirmation (dropdown → Delete → "Are you sure?" modal) is good, Instagram-level care. Keep it.

### ReportUserScreen.tsx

- 🔴 **Success shown regardless of outcome.** `handleReport` (`212-225`): the try/catch only logs, then `setShowConfirmation(true)` runs unconditionally. A failed report (offline, edge fn down) still shows "Report received. We'll review this case shortly." **Fix:** only show confirmation on success; on failure show a retryable inline error and keep the form state.
- 🔴 **"Block user" checkbox can silently no-op.** When `blockUser` is checked, `blockingService.blockUser` (`217-219`) is awaited inside the same swallowing try/catch; if it fails, the user is told they reported AND `handleDone`→`onBlocked` navigates away (`227-234`) as though blocked — but the user is not blocked and can still be contacted. **Fix:** surface block failure explicitly; do not treat a failed block as `onBlocked`.
- 🟡 **"Other" reason has no free-text field.** Instagram/WhatsApp let the reporter add detail. Selecting "Other" sends only the literal word "Other" to reviewers (`105`). **Fix:** reveal an optional text input when "Other" (or any reason) is selected.
- 🔵 Dropdown doesn't close on outside tap (only toggles via its own row) — minor. `265-278`.
- 🔵 No guard against repeat reports of the same user/message — a user can spam-submit. Low.

### BlockUserOverlay.tsx

- 🟠 **Block failure is invisible.** `handleBlock` (`40-50`): on `!success` it just clears `isBlocking` and leaves the modal open with no message. User taps Block, spinner flashes, nothing changes. **Fix:** show an inline error row ("Couldn't block. Try again.") and keep the CTA enabled.
- 🟡 **No haptic on a destructive confirm.** Approve/Decline in ProfileScreen use `hapticSuccess/hapticLight`; block/unblock/report/delete do not. **Fix:** add `hapticWarning`/`hapticSuccess` on confirm for parity.
- 🔵 **Consequence copy differs from the report screen.** Here: "won't be able to message you or appear in your matches. You can unblock them later from settings." (`73-75`). Report screen: "won't be able to contact you or see your profile anymore." (`324-326`). Same action, two descriptions. **Fix:** unify into one canonical sentence.
- 🔵 No post-block confirmation toast — the modal fades and the screen pops back. A brief "Blocked {name}" toast would confirm success (WhatsApp does this). Low.

### BlockedUsersScreen.tsx

- 🟠 **Unblock failure gives no feedback.** `handleUnblock` (`74-84`): closes the sheet, awaits `unblockUser`, and only removes the row `if (success)`. On failure the row silently stays and the user gets nothing. **Fix:** show an error toast/inline message and re-open affordance on failure.
- 🟡 **No error state for the list load.** `loadBlockedUsers` (`44-57`) only `console.error`s; on RPC failure the screen shows the empty "No blocked users" text (`102-103`), which is indistinguishable from genuinely having none — a user who blocked people would think their blocks vanished. **Fix:** track an error flag and render a distinct "Couldn't load blocked accounts — Retry" state.
- 🟡 **Loading is a bare centered spinner; empty state is bare text.** No skeleton, no icon/illustration for empty. `100-103`, `230-238`. Fine functionally but below the Instagram bar. **Fix:** small illustration + one-line subtitle for empty; optional row skeletons for load.
- 🔵 The unblock sheet lacks a drag handle gesture (handle is decorative; only the backdrop tap / buttons dismiss). Low.
- 🔵 No pull-to-refresh. Low.

---

## ProfileScreen.tsx (view — own & other)

- 🟠 **Loading = blank screen under the header.** The `loading || authChecking` branch (`2045-2061`) renders only `renderProfileHeader()` over an empty container — no spinner, no skeleton. For an other-user profile fetched over the network (`1461`), a slow connection is a black header on blank. **Fix:** add a centered ActivityIndicator or a lightweight skeleton of the avatar/cards.
- 🟠 **"Unable to Load Profile" has no retry.** `2090-2104` offers only "Go Back." A transient fetch error (`1492-1496`) forces the user to fully back out and re-open. **Fix:** add a "Try Again" button that re-runs `loadProfileData()`.
- 🟡 **Own-profile-not-found is unhandled.** When `refreshMyProfile()` returns null (`1451-1454`) it only logs; `setLoading(false)` then falls to the generic `!profileData` → "Unable to Load Profile" screen for your OWN profile, with no retry and no explanation. **Fix:** distinct copy + retry for the own-profile case.
- 🟡 **Avatar upload has no visible progress.** `isUploadingImage` (`1079`, set at `1614`/`1642`) is never used in render. The optimistic local image is shown immediately (good), but on a slow connection there's zero indication an upload is in flight; if the user navigates away mid-upload there's no cue. **Fix:** a subtle ring/spinner over the avatar while `isUploadingImage`, matching the chat upload-ring pattern already in the codebase.
- 🟡 **Header/title treatment is inconsistent with the rest of the settings stack.** ProfileScreen now uses the standard #212121 bar + chevron + bell (`1916-1970`), while Settings/Privacy/Blocked/Report/Delete all use a floating white "Back" pill at a hardcoded `top: 54`. Navigating profile → settings visibly changes the header paradigm. **Fix:** align the settings stack to the same header component, or at least a consistent back affordance.
- 🟡 **Home Break "unset" card dims itself with a dark overlay even on OTHER users' profiles** (`2890-2892`). On someone else's profile a dimmed "nudge to set your break" is meaningless — it just looks like a broken/greyed card. **Fix:** only apply the unset overlay/nudge when `isViewingOwnProfile`.
- 🟡 **Empty-profile sections vanish with no placeholder.** Lifestyle (`2930`) and Top Destinations (`3008`) render nothing when empty. On a sparse other-user profile the page can be near-empty below the cards with no "No destinations yet" cue. **Fix:** minimal empty hints (at least on own profile, to prompt completion).
- 🔵 **Board-image container kept at `opacity:0` with a comment "REMOVED"** (`2706-2708`) — dead layout scaffolding shipping to users. Low, but worth cleaning.
- 🔵 **Travel Experience card is tappable only when `topDestinations.length > 0`** (`2774`) yet always shows the chevron-forward affordance (`2778`). Tapping a chevron that does nothing is a dead affordance. **Fix:** hide the chevron when not tappable.
- 🔵 Name uses `adjustsFontSizeToFit minimumFontScale={0.4}` (`2716-2717`) — a very long name can shrink to 40% and look tiny/ransom-note. Consider `numberOfLines={2}` instead for very long names.
- 🔵 Block/Report from a profile opened via a chat calls only `onBack()` (`3216-3219`); it doesn't proactively refresh the conversation list, so a just-blocked user's thread may linger until the next reload. Edge case — verify downstream.

---

## Avatar crop (AvatarCropModal.tsx / .native.tsx)

- 🟡 **Web crop has no busy state.** The native modal disables buttons + shows "Saving…" (`.native.tsx:263-266`); the web `handleConfirm` (`.tsx:100-111`) has no busy guard — double-tapping "Choose" while the canvas encodes can fire `onConfirm` twice → double upload. **Fix:** mirror the native `busy` flag on web.
- 🟡 **Crop image-load failure is silent.** `RNImage.getSize` error only warns (`.native.tsx:86-88`); if it never resolves, the cropper never appears and the modal shows a black screen with only Cancel/Choose, Choose being a no-op (`178-179` early-returns). **Fix:** timeout + inline "Couldn't load image" with a dismiss.
- 🔵 Native crop overlay has no scrim/handles/grid guidance beyond the crop square; "Move and scale" title is the only hint. Acceptable, but Instagram shows a grid. Low.

---

## SettingsScreen.tsx

- 🟠 **Switch-account errors are swallowed.** `handleSwitchAccount` catch (`128-137`) only `console.error`s (except the cancel case). A real failure (no ID token, Supabase error) leaves the user on Settings with no feedback — they don't know the switch failed. Contrast logout, which does `Alert.alert` on failure (`78-80`). **Fix:** friendly error alert on non-cancel failures.
- 🟡 **No loading/disabled state on Switch account.** Unlike logout (`isLoggingOut` disables the row + shows a spinner, `244-256`), Switch account (`239-242`) has no in-flight state — it awaits Google sign-in + Supabase with the row still tappable, so a double-tap can fire two sign-in attempts. **Fix:** add an in-flight flag mirroring `isLoggingOut`.
- 🟡 **Destructive/less-common actions aren't grouped or visually distinguished.** "Delete account" sits in the same neutral list as "About us" / "Report bug" (`224-227`) with no danger styling, while Log out is red (`255`). Delete account is the most destructive item and looks like a benign menu row. **Fix:** move Delete account to its own section and/or give it danger affordance.
- 🟡 **No confirmation before Switch account.** One tap immediately launches the Google account picker and signs out on web (`123-126`); a mis-tap disrupts the session. **Fix:** lightweight confirm, or at least ensure the web path can recover.
- 🔵 Hardcoded `top: 54` back button (`282-284`) ignores `insets.top`; on devices with unusual safe areas it can sit too high/low. (Same pattern across the whole settings stack.) Low.
- 🔵 Title fonts differ across the stack: Settings section title is Inter-700 (`358-365`), Privacy/Blocked/Report titles are Montserrat-700. Inconsistent. Low.

---

## PrivacyPreferencesScreen.tsx

- 🟡 **Analytics toggle has no failure handling / no revert.** `toggle` (`85-93`) optimistically flips state, then `analyticsService.setOptOut(...).catch(console.error)`. If the opt-out call fails, the UI shows the new state but the setting didn't persist correctly — a privacy setting that lies is worse than most. **Fix:** on failure, revert the toggle and inform the user.
- 🟡 **"Contacts → Blocked accounts" is a mislabeled, undiscoverable entry point.** A row titled "Contacts" with subtitle "Blocked accounts" (`135-138`) is the only way to reach the block list — users looking for "Blocked users" won't recognize "Contacts." **Fix:** rename to "Blocked accounts" (or "Blocked users") as the primary label; drop "Contacts."
- 🟡 **Toggle has no accessibility role/state.** `ToggleSwitch` (`30-61`) is a plain TouchableOpacity — no `accessibilityRole="switch"`, no `accessibilityState={{checked}}`. Screen readers announce nothing. **Fix:** add switch role + state (applies to the Report checkbox too).
- 🔵 `if (!loaded) return null` (`95`) flashes a blank screen while a single AsyncStorage read completes. Negligible but a spinner-less null-return is a pattern worth avoiding. Low.
- 🔵 Only one real setting (Analytics). Thin screen — fine for MVP, but "Privacy preferences" implies more (block list is hidden under Contacts, no data-download/visibility options). Low / future.

---

## HomeBreakSearchSheet.tsx / HomeBreakViewSheet.tsx

(Used by profile/edit for the home-break spot.)

- 🟡 **Search errors are terse and dead-end.** On HTTP/network failure the sheet shows a bare red "Search failed" / "Network error" line (`426`, `269`, `290`) with no retry — the user must edit the query to re-trigger. **Fix:** a retry affordance or auto-retry on reconnect.
- 🟡 **Missing Places API key surfaces raw dev copy.** `setError('Places API key missing')` (`234`) is developer-facing text shown to end users if the env var is absent. **Fix:** friendly fallback ("Search is temporarily unavailable").
- 🔵 Place-details resolve failure (`311-313`) sets `error` but the ScrollView is only shown in the non-`pending` branch; the error is fine here, but there's no spinner state distinction between "resolving" and "idle" beyond the per-row spinner. Low.
- 🔵 View sheet map fallback ("Map unavailable for this place") is good; no issues of note.

---

## Cross-cutting observations

- 🟡 **Swallowed-error anti-pattern is systemic across safety flows.** Delete, Report, Block, Unblock, and the analytics toggle all catch errors and either proceed as success or do nothing. This is the single biggest theme. The codebase already has `friendlyErrorMessage`/`showErrorAlert` (per project memory) — these flows should use it instead of `console.error`-and-continue.
- 🟡 **Optimistic-success without rollback on the two irreversible-feeling actions (delete, block-via-report)** is the most dangerous instance of the above — those must be gated on a real success response.
- 🔵 **Haptics are inconsistent.** Present on join-request approve/decline (`ProfileScreen 1264/1287`) and avatar upload failure (`hapticError`, `1633`), absent on block/unblock/report/delete confirmations.
- 🔵 **Header/back affordance and title fonts are not standardized** across ProfileScreen vs the Settings stack (see Settings + Profile notes). A shared header component would fix the whole family at once.
