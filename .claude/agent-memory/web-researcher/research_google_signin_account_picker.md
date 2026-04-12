---
name: Google Sign-In Account Picker — react-native-google-signin
description: How to force the Google account picker to show in React Native; signOut vs revokeAccess; v13+ API changes; Supabase integration gotcha
type: reference
---

## Core Problem
Calling `GoogleSignin.signOut()` then `GoogleSignin.signIn()` on Android clears the Google session BUT also triggers Supabase's `onAuthStateChange` listener (since Supabase has no session), which fires the app's logout flow and navigates to the welcome screen — before the Google picker has a chance to open.

## The Fundamental Limitation
The library (Original API) has no first-class "show account picker without logging out" method. You must sign out of Google to force the picker. The challenge is preventing the app from reacting to the Supabase signOut during the "switch account" flow.

## Recommended Pattern for Account Switcher (Supabase + RN)
1. Set a flag: `isSwitchingAccount = true`
2. Call `GoogleSignin.signOut()` (only clears Google cache, NOT Supabase yet)
3. Call `GoogleSignin.signIn()` — picker appears
4. On success: call `supabase.auth.signInWithIdToken(...)` with the new idToken
5. Clear the flag — only NOW let auth listeners react to session changes
- The key: do NOT call `supabase.auth.signOut()` before the new sign-in; just replace the Supabase session inline.

## Method Reference

### Original API (GoogleSignin)
- `signIn()` — shows the modal picker. On Android, if the device has cached the last-used account, it may skip the picker. Must call `signOut()` first to bust this cache.
- `signInSilently()` — attempts no-UI restoration. Throws `SIGN_IN_REQUIRED` if no cached session. Use on app start.
- `signOut()` — clears the local Google credential cache only. Does NOT revoke app permissions. After this, `signIn()` shows the picker again.
- `revokeAccess()` — revokes app permissions from Google's servers + signs out. Use only for account deletion. Forces full re-authorization on next `signIn()`. Do NOT call on every logout.
- `addScopes()` — requests extra OAuth scopes after initial sign-in (iOS: shows re-consent; Android: shows permission modal).

### Universal API (GoogleOneTapSignIn) — v13+
- `signIn()` — tries automatic (no UI) sign-in. Returns `{ type: 'noSavedCredentialFound' }` when no session.
- `createAccount()` — shows account list for first-time sign-in.
- `presentExplicitSignIn()` — explicitly shows a sign-in dialog (useful as fallback after rate-limiting or when both above return nothing).
- `requestAuthorization()` — replaces `addScopes`.

## Configure Options Relevant to Account Picker
- `accountName` (Android, Original API) — prioritizes a specific account by email. Does NOT guarantee the picker is skipped; it just pre-selects.
- `loginHint` (iOS only, Original API) — pre-fills the email field in the sign-in UI.
- `forceCodeForRefreshToken` (Android, Original API) — set true only if backend lost refresh tokens and needs recovery. Not related to picker.

## v13+ API Changes
- Response shape changed: `userInfo.name` → `userInfo.data.name`, `userInfo.idToken` → `userInfo.data.idToken`
- Error handling: discriminated union `{ type: 'success' | 'cancelled' | 'noSavedCredentialFound' }` instead of thrown error codes
- `signInSilently` → renamed `signIn` in Universal API

## Key Gotchas
- On Android, after `signOut()`, the native Google SDK sometimes still skips the picker and re-authenticates silently. This is a known bug (issue #997). Calling `await GoogleSignin.signOut()` right before `signIn()` usually fixes it but not 100% reliably.
- `revokeAccess()` is NOT needed for regular logout. Calling it breaks subsequent sign-ins until user re-authorizes. Many devs mistakenly call it on logout.
- The Credential Manager API (Android, newer devices) is used by the Universal/OneTap path and has different account-picker behavior than the legacy Sign-In SDK.

## Sources
- https://react-native-google-signin.github.io/docs/original
- https://react-native-google-signin.github.io/docs/one-tap
- https://react-native-google-signin.github.io/docs/api
- https://react-native-google-signin.github.io/docs/migrating
- https://github.com/react-native-google-signin/google-signin/issues/997
- https://github.com/react-native-google-signin/google-signin/issues/843
- https://github.com/react-native-google-signin/google-signin/issues/882
- https://github.com/react-native-google-signin/google-signin/issues/675
