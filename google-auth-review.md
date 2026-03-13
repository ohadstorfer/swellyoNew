# Google Authentication Flow - Deep Review

**Date:** 2026-03-12
**Scope:** All files related to Google sign-in/sign-up via Supabase OAuth in this React Native Expo app.

---

## Files Reviewed

| File | Role |
|------|------|
| `src/config/supabase.ts` | Supabase client creation and configuration |
| `src/services/auth/supabaseAuthService.ts` | Core Google OAuth logic (web + mobile) |
| `src/services/auth/authService.ts` | Wrapper/legacy auth service, delegates to supabaseAuthService |
| `src/screens/WelcomeScreen.tsx` | Entry point UI, triggers sign-in, handles OAuth return on web |
| `src/components/AppContent.tsx` | Root component, renders screens, runs useAuthGuard |
| `src/hooks/useAuthGuard.ts` | Auth state listener, session verification, logout on expiry |
| `src/context/OnboardingContext.tsx` | Session restoration on app mount, user context |
| `src/utils/userConversion.ts` | Converts Supabase user to legacy app User type |
| `src/utils/logout.ts` | Centralized logout logic |
| `src/utils/registerLogoutHandlers.ts` | Logout cleanup handlers |
| `App.tsx` | Root component, providers |
| `app.json` | Expo config, URL scheme |
| `src/integrations/supabase/client.ts` | Secondary Supabase client (not used in main flow) |

---

## ISSUE 1 (CRITICAL): PKCE Flow Type Configured but Implicit Flow Token Parsing Used

**Files:**
- `src/config/supabase.ts` (line 54)
- `src/services/auth/supabaseAuthService.ts` (lines 171-173, 227-256, 392-394)
- `src/screens/WelcomeScreen.tsx` (lines 115-117)
- `src/hooks/useAuthGuard.ts` (lines 86-87)
- `src/components/AppContent.tsx` (lines 172-174)

**What is configured:**
```typescript
// src/config/supabase.ts:54
flowType: 'pkce', // Recommended for mobile apps
```

**What the code does:**
Throughout the entire codebase, the OAuth return is detected and handled by manually parsing `access_token` and `refresh_token` from the URL **hash fragment** (`window.location.hash`):

```typescript
// supabaseAuthService.ts:171-173
const hashParams = new URLSearchParams(window.location.hash.substring(1));
const accessToken = hashParams.get('access_token');
const refreshToken = hashParams.get('refresh_token');
```

```typescript
// WelcomeScreen.tsx:115-117
const hashParams = new URLSearchParams(window.location.hash.substring(1));
const accessToken = hashParams.get('access_token');
```

**Why this is a problem:**

With `flowType: 'pkce'`, Supabase does NOT return `access_token` in the URL hash fragment. Instead, it returns a `code` in the **query parameters** (`?code=...`). The Supabase JS client's `detectSessionInUrl: true` setting is designed to automatically intercept this code, exchange it for tokens using the stored PKCE code verifier, and establish the session.

Because the manual code looks for `access_token` in the hash but PKCE never puts it there, one of two things is happening:

1. **If `detectSessionInUrl: true` is working correctly on web:** The Supabase client itself handles the code exchange before the manual parsing runs, and the manual hash-parsing code is dead code that never finds tokens. The session is established by `detectSessionInUrl`, and `getSession()` returns it. The flow only works by accident because `getSession()` call at line 244 picks up the session that `detectSessionInUrl` already established.

2. **If `detectSessionInUrl` fails or runs after the manual code:** The sign-in breaks entirely because the manual code never finds the `access_token` it expects.

**The real danger:** The mobile flow at lines 389-410 does the same thing -- it parses the hash for `access_token` after `WebBrowser.openAuthSessionAsync`. With PKCE configured, the redirect URL from Supabase will contain a `code` parameter, not tokens in the hash. The mobile `signInWithGoogleMobile()` will **always fall through to `throw new Error('Failed to complete OAuth flow')` on line 413** because `accessToken` is always null.

**Best practice fix:**

For **web**: Remove all manual token/hash parsing. Let `detectSessionInUrl: true` handle the PKCE code exchange automatically. After redirect, simply call `supabase.auth.getSession()` or listen to `onAuthStateChange` for `SIGNED_IN` event.

For **mobile**: After `WebBrowser.openAuthSessionAsync` returns, parse the `code` from the URL query parameters and call `supabase.auth.exchangeCodeForSession(code)` instead of trying to extract tokens from the hash. Alternatively, switch to `flowType: 'implicit'` if the PKCE exchange cannot be performed on mobile (though PKCE is more secure).

---

## ISSUE 2 (CRITICAL): Forced Sign-Out Before Sign-In Causes Race Condition with Auth Guard

**Files:**
- `src/services/auth/supabaseAuthService.ts` (lines 60-72)
- `src/hooks/useAuthGuard.ts` (lines 371-396)

**What happens:**

Before initiating Google OAuth, `signInWithGoogle()` explicitly calls `supabase.auth.signOut()` to "invalidate the existing session" (line 62). This fires a `SIGNED_OUT` event on the `onAuthStateChange` listener in `useAuthGuard`.

The code attempts to prevent this from causing a logout by:
1. Setting `oauth_redirecting` flags in sessionStorage/localStorage (line 50-53)
2. Having `useAuthGuard` check these flags before processing `SIGNED_OUT` events (lines 376-393)

**Why this is a problem:**

- The flag-setting and the `signOut()` call are **not atomic**. There is a window where the `SIGNED_OUT` event fires and `useAuthGuard` processes it before or concurrently with the flag check.
- The flags are timestamp-based and only trusted for 30 seconds. If the OAuth redirect takes longer than 30 seconds (e.g., slow network, user takes time on Google's consent screen), the flags expire. When the user returns, the auth guard may have already logged them out and cleared all state.
- The entire complexity of sessionStorage/localStorage flags with timestamps, staleness checks, and multiple detection methods exists solely because of this unnecessary pre-login signOut. **This signOut before login is not a Supabase best practice and creates the majority of the complexity in the auth flow.**

**Best practice fix:**

Remove the `supabase.auth.signOut()` call before initiating a new OAuth flow. Supabase handles session replacement automatically when a user signs in -- the new session replaces the old one. There is no need to manually invalidate the session first. This would eliminate the entire `oauth_redirecting` flag system and dramatically simplify the auth guard.

---

## ISSUE 3 (HIGH): User ID Collision Risk from UUID-to-Number Conversion

**File:** `src/utils/userConversion.ts` (lines 17)

**What the code does:**
```typescript
const numericId = parseInt(supabaseUser.id.replace(/-/g, '').substring(0, 15), 16) || Date.now();
```

Supabase UUIDs are 128-bit identifiers (32 hex chars). This code takes the first 15 hex characters and converts them to a JavaScript number. JavaScript's `Number.MAX_SAFE_INTEGER` is `2^53 - 1`, which is about 16 hex digits, so 15 hex digits fits. However:

**Why this is a problem:**

- **Collision probability:** By truncating 32 hex chars to 15, you are discarding 17 hex digits (68 bits) of entropy. Two different Supabase users whose UUIDs share the same first 15 hex characters will get the **same numeric ID**. With UUID v4, the first 15 characters contain about 60 bits of entropy (some bits are version/variant), making collision increasingly likely as user count grows.
- **Data integrity:** If this numeric ID is used as a key in localStorage, AsyncStorage, or any local data structure, two different Supabase users could share data, see each other's cached content, or overwrite each other's state.
- **The `|| Date.now()` fallback** makes it even worse: if `parseInt` returns `NaN` (unlikely but possible with edge cases), `Date.now()` is used, which is not stable across calls and would give the same user different IDs on different devices.

**Best practice fix:**

Use the Supabase UUID string directly as the user ID throughout the app. If a numeric ID is needed for some legacy component, use a proper hash function or store a mapping. Never truncate UUIDs for use as identifiers.

---

## ISSUE 4 (HIGH): `prompt: 'consent'` Forces Re-consent on Every Sign-In

**Files:**
- `src/services/auth/supabaseAuthService.ts` (lines 271-272, 365-366)

**What the code does:**
```typescript
queryParams: {
  access_type: 'offline',
  prompt: 'consent',
},
```

**Why this is a problem:**

`prompt: 'consent'` forces Google to show the consent screen on **every single sign-in**, even for returning users. This:

1. Creates a poor user experience -- returning users must click through the permission screen every time instead of being automatically signed in.
2. Revokes and re-issues the Google refresh token each time (Google only issues a new refresh token when consent is granted). This can cause issues if the app relies on a stable refresh token.
3. Is inconsistent with standard "sign in with Google" behavior that users expect.

**Best practice fix:**

Remove `prompt: 'consent'` entirely, or use `prompt: 'select_account'` if you want users to pick which Google account to use. The `access_type: 'offline'` parameter is also unnecessary for client-side OAuth where Supabase manages tokens -- Supabase's server already handles the token exchange. These parameters should only be set if you have specific server-side requirements for Google refresh tokens.

---

## ISSUE 5 (HIGH): Session Restoration Uses `getSession()` Instead of `getUser()` for Auth Verification

**Files:**
- `src/context/OnboardingContext.tsx` (lines 91-92)
- `src/hooks/useAuthGuard.ts` (lines 271)
- `src/services/auth/supabaseAuthService.ts` (lines 139, 244, 585)

**What the code does:**

Session restoration and auth checks primarily use `supabase.auth.getSession()`:

```typescript
// OnboardingContext.tsx:91-92
const { data: { session }, error: sessionError } = await supabase.auth.getSession();
```

**Why this is a problem:**

Per Supabase documentation, `getSession()` reads the session from local storage and does **not** validate the JWT with the Supabase server. A session could be expired, revoked, or tampered with, and `getSession()` would still return it as valid. The Supabase docs explicitly state:

> "Use `getUser()` to validate the session. `getSession()` reads from storage and is not guaranteed to return a valid session."

The auth guard does call `getUser()` in some paths (lines 295, 328), but the primary session restoration in `OnboardingContext.restoreSession()` -- which runs on every app start -- only uses `getSession()`. This means a user with an expired or revoked session will be auto-logged-in with stale credentials, and API calls will fail until the auth guard eventually catches up.

**Best practice fix:**

For session restoration on app start and for critical auth checks, use `supabase.auth.getUser()` which makes a server call to validate the JWT. Use `getSession()` only for non-critical reads where you need the tokens locally and the auth guard will verify later.

---

## ISSUE 6 (HIGH): Two Supabase Client Instances

**Files:**
- `src/config/supabase.ts` (primary, used everywhere)
- `src/integrations/supabase/client.ts` (secondary)

**What the code does:**

There are two separate Supabase client instances:

```typescript
// src/config/supabase.ts - Primary client
supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { storage: AsyncStorage, flowType: 'pkce', ... }
});

// src/integrations/supabase/client.ts - Secondary client
export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { storage: localStorage, ... }
});
```

**Why this is a problem:**

1. **Different auth storage backends:** The primary uses `AsyncStorage`, the secondary uses `localStorage`. On web, `AsyncStorage` uses `localStorage` under the hood but with a different key prefix. These two clients maintain **separate session states** -- signing in with one does not update the other.
2. **Different configuration:** The secondary client does not have `flowType: 'pkce'` or `detectSessionInUrl` configured.
3. **Both export `supabase`:** If any file accidentally imports from `src/integrations/supabase/client` instead of `src/config/supabase`, it will operate with a completely different session context.
4. **The secondary uses `VITE_` env vars** (`import.meta.env.VITE_SUPABASE_URL`), suggesting it was copied from a Vite project and may have undefined config in Expo.

**Best practice fix:**

Remove `src/integrations/supabase/client.ts` entirely or ensure it re-exports from `src/config/supabase.ts`. There should be exactly one Supabase client instance in the entire application.

---

## ISSUE 7 (MEDIUM-HIGH): Multiple Redundant OAuth Return Handlers Create Race Conditions

**Files:**
- `src/screens/WelcomeScreen.tsx` (lines 112-173, `checkAuthState` effect)
- `src/context/OnboardingContext.tsx` (lines 68-168, `restoreSession`)
- `src/hooks/useAuthGuard.ts` (lines 356-462, `onAuthStateChange` listener)
- `src/services/auth/supabaseAuthService.ts` (lines 169-256, `signInWithGoogleWeb`)
- `src/components/AppContent.tsx` (lines 161-194, OAuth return check)

**What happens:**

When the user returns from Google OAuth, **five different pieces of code** all independently try to detect and handle the OAuth return:

1. **Supabase client** (`detectSessionInUrl: true`) -- automatically detects URL params and exchanges the code/tokens.
2. **WelcomeScreen effect** -- checks for `access_token` in hash, calls `getUser()`, converts user, sets context.
3. **OnboardingContext.restoreSession** -- calls `getSession()`, converts user, sets context.
4. **useAuthGuard.onAuthStateChange** -- receives `SIGNED_IN` event, potentially restores user.
5. **AppContent effect** -- checks for `access_token`/`code` in URL, sets `isCheckingAuth` state.

**Why this is a problem:**

- User state may be set multiple times from different sources with slightly different conversion logic (e.g., `convertSupabaseUserToAppUser` in `userConversion.ts` vs. `convertSupabaseUserToAppUser` in `supabaseAuthService.ts` -- these are **different functions with different logic**). The one in `userConversion.ts` produces numeric IDs; the one in `supabaseAuthService.ts` uses string UUIDs.
- Analytics `identify()` may be called multiple times with different user ID formats.
- `checkOnboardingStatus()` may be called multiple times concurrently, causing redundant database queries.
- Navigation decisions (`onGetStarted()` vs. `setCurrentStep()`) may conflict.

**Best practice fix:**

Consolidate OAuth return handling into a single location. The recommended approach is:
1. Let `detectSessionInUrl` handle the token/code exchange.
2. Use a single `onAuthStateChange` listener to react to `SIGNED_IN` events.
3. Remove all manual URL hash/query parsing for OAuth returns.

---

## ISSUE 8 (MEDIUM-HIGH): Two Different `convertSupabaseUserToAppUser` Functions with Incompatible Output

**Files:**
- `src/utils/userConversion.ts` (lines 11-34) -- produces `User` with numeric `id`
- `src/services/auth/supabaseAuthService.ts` (lines 423-478) -- produces `User` with string UUID `id`

**What the code does:**

```typescript
// userConversion.ts -- returns numeric id
return {
  id: numericId,  // parseInt(...) of UUID substring
  email: ...,
};

// supabaseAuthService.ts -- returns string UUID
return {
  id: supabaseUser.id,  // UUID string like "a1b2c3d4-..."
  email: ...,
};
```

**Why this is a problem:**

- `WelcomeScreen` uses `convertSupabaseUserToAppUser` from `userConversion.ts` (numeric ID).
- `supabaseAuthService.signInWithGoogle()` returns user with string UUID from its own converter.
- `authService.signInWithGoogle()` calls `supabaseAuthService.signInWithGoogle()` (which returns string UUID) and then immediately re-converts using `userConversion.ts` (numeric ID).
- The `useAuthGuard` uses `userConversion.ts` (numeric ID).
- This means the same user gets different IDs depending on which code path set the context.
- PostHog analytics `identify()` calls use `user.id.toString()`, which would be a completely different string depending on which converter was used.
- Any local storage keyed by user ID would be unreachable across sessions if the conversion path changes.

**Best practice fix:**

Use a single user conversion function throughout the app. Standardize on either string UUIDs (preferred, since that's what Supabase uses) or numeric IDs (if legacy compatibility demands it), but never both.

---

## ISSUE 9 (MEDIUM): No Deep Link Configuration for Mobile OAuth Callback

**Files:**
- `app.json` (line 6)
- `src/services/auth/supabaseAuthService.ts` (line 355)

**What the code does:**

```json
// app.json:6
"scheme": "swellyo",
```

```typescript
// supabaseAuthService.ts:355
const redirectUri = AuthSession.makeRedirectUri({});
```

**Why this is a problem:**

`AuthSession.makeRedirectUri({})` without specifying `scheme` will generate a redirect URI using the Expo development server URL in development and the `scheme` from `app.json` in production. However:

1. The redirect URI generated by `makeRedirectUri` must be registered in both the **Supabase dashboard** (Authentication > URL Configuration > Redirect URLs) and the **Google Cloud Console** (OAuth 2.0 Client ID > Authorized redirect URIs). If it is not registered in both, the OAuth flow will fail silently or with a redirect_uri_mismatch error.
2. With the Expo Go development client, the redirect URI format is `exp://...` which is completely different from the production format `swellyo://...`. Both need to be registered.
3. There is no `intentFilters` (Android) or `associatedDomains` (iOS) configuration in `app.json` for handling the deep link return, which means the OS may not know to route the redirect back to the app.

**Best practice fix:**

- Explicitly pass `scheme: 'swellyo'` to `makeRedirectUri` for consistency.
- Document and register all possible redirect URIs in both Supabase and Google Cloud Console.
- Add `intentFilters` for Android and `associatedDomains` for iOS in `app.json` if using universal links.
- Consider using `expo-linking` for more reliable deep link handling.

---

## ISSUE 10 (MEDIUM): `onAuthStateChange` Listener Has Stale Closure Over `user` State

**File:** `src/hooks/useAuthGuard.ts` (lines 356-476)

**What the code does:**

```typescript
useEffect(() => {
  const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
    // ... uses `user`, `isDemoUser`, etc. from closure
    if (session && user === null && !isDemoUser && !isRestoringSession) {
      // ...
    }
  });
  // ...
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []); // Only run on mount
```

**Why this is a problem:**

The `onAuthStateChange` callback is created once on mount with `[]` dependencies, but it references `user`, `isDemoUser`, and `isRestoringSession` from the closure. These values are **captured at mount time** and never update. The `// eslint-disable-next-line` comment suppresses the warning.

While the `handleUnauthenticated` and `checkAuthState` callbacks use `useCallback` with proper dependencies, the direct checks inside the listener (e.g., `user === null` on line 458) will always see the initial value of `user`.

This means:
- The `session && user === null` check on line 458 could incorrectly trigger `checkAuthState` after the user has already been set, because the listener still sees `user` as `null`.
- The `isDemoUser` check could be wrong if the user switched to demo mode after mount.

**Best practice fix:**

Use refs to hold the latest values of `user`, `isDemoUser`, and `isRestoringSession`, and read from the refs inside the `onAuthStateChange` callback. Alternatively, include the proper dependencies and re-subscribe when they change (with appropriate cleanup).

---

## ISSUE 11 (MEDIUM): Redundant Pre-login Sign-Out in WelcomeScreen

**File:** `src/screens/WelcomeScreen.tsx` (lines 245-275)

**What the code does:**

Before calling `authService.signInWithGoogle()`, the WelcomeScreen checks if there is an existing user and performs a full `performLogout()`:

```typescript
if (hasExistingSession) {
  const { performLogout } = await import('../utils/logout');
  const logoutResult = await performLogout({ ... });
}
```

And then `supabaseAuthService.signInWithGoogle()` ALSO calls `supabase.auth.signOut()` (Issue 2).

**Why this is a problem:**

This means there are **two sign-out operations** before a new sign-in:
1. `performLogout()` in WelcomeScreen (which calls `authService.signOut()` which calls `supabase.auth.signOut()`)
2. `supabase.auth.signOut()` again inside `supabaseAuthService.signInWithGoogle()`

Each fires a `SIGNED_OUT` event, doubling the chance of the auth guard race condition. The `performLogout()` also resets the entire onboarding context, analytics, and navigation state -- all of which is unnecessary before a new login.

**Best practice fix:**

Remove both pre-login sign-out calls. Supabase replaces the session automatically when a new user signs in. If you need to handle the case of switching Google accounts, `prompt: 'select_account'` (not `prompt: 'consent'`) lets the user choose an account.

---

## ISSUE 12 (MEDIUM): `isLoading` State Referenced Inside setTimeout Closure

**File:** `src/screens/WelcomeScreen.tsx` (lines 288-317)

**What the code does:**

```typescript
redirectTimeout = setTimeout(() => {
  if (isLoading && currentUrlBeforeRedirect && typeof window !== 'undefined') {
    // ...
    if (!isOAuthReturn && isStillOnSamePage && isLoading) {
      setIsLoading(false);
      Alert.alert('Redirect Blocked', ...);
    }
  }
}, 3000);
```

**Why this is a problem:**

`isLoading` is React state. Inside the `setTimeout` callback, `isLoading` is a **stale closure** -- it captures the value at the time the timeout was set (which is `true`, since `setIsLoading(true)` was just called). It will always be `true` inside the timeout, making the `if (isLoading)` check meaningless. If the redirect succeeds but the page hasn't navigated away yet, the alert could still fire.

**Best practice fix:**

Use a ref for `isLoading` when reading inside timeouts, or restructure the timeout logic to not depend on React state.

---

## ISSUE 13 (MEDIUM): No AppState Handling for Mobile Session Refresh

**File:** `src/hooks/useAuthGuard.ts` (lines 542-545)

**What the code does:**

```typescript
} else {
  // For mobile, we'd use AppState from react-native
  // This is handled by the auth state listener which is always active
}
```

**Why this is a problem:**

On mobile, when the app goes to the background and comes back, the auth state listener does NOT automatically re-check the session. Supabase's `autoRefreshToken` works on a timer, but if the app was backgrounded for longer than the token lifetime (typically 1 hour), the token may have expired. Without an `AppState` listener that triggers `supabase.auth.getSession()` or `getUser()` on foreground, the user may see auth errors until the next auto-refresh cycle kicks in.

The web flow handles this with `window.addEventListener('focus', handleFocus)` but mobile has no equivalent.

**Best practice fix:**

Add an `AppState` listener from `react-native` that calls `checkAuthState()` when the app returns to the foreground (`AppState.addEventListener('change', ...)`).

---

## ISSUE 14 (LOW-MEDIUM): Sensitive Data in Console Logs

**Files:**
- `src/services/auth/supabaseAuthService.ts` (lines 287, 291, 357)
- `src/services/auth/authService.ts` (lines 119, 123, 127, 265, 274)
- `src/screens/WelcomeScreen.tsx` (line 132)

**What the code does:**

```typescript
// authService.ts:119
console.log('Google Sign-In response received:', response);
// authService.ts:123
console.log('Decoded payload:', payload);

// supabaseAuthService.ts:287
console.log('OAuth URL received:', data.url.substring(0, 100) + '...');

// supabaseAuthService.ts:357
console.log('Redirect URI:', redirectUri);
```

**Why this is a problem:**

- The legacy `authService` logs the full Google Sign-In response object (which includes the JWT credential) and the decoded payload (which includes email, name, Google ID).
- OAuth URLs contain sensitive parameters.
- While some logs are truncated, they still leak information in production. These logs are not guarded by `__DEV__`.

**Best practice fix:**

Remove or guard all auth-related console.log statements with `if (__DEV__)`. Never log tokens, credentials, or OAuth URLs in production.

---

## ISSUE 15 (LOW-MEDIUM): Legacy Auth Flow (Non-Supabase) Is Still Active and Reachable

**Files:**
- `src/services/auth/authService.ts` (lines 71-104, 106-174, 176-288)
- `src/screens/WelcomeScreen.tsx` (lines 176-217)

**What the code does:**

If `isSupabaseConfigured()` returns false, the app falls back to a completely separate Google OAuth flow:
- On web: Loads Google Identity Services script, handles JWT token directly
- On mobile: Uses `expo-auth-session` to get an auth code, exchanges it with Google's token endpoint, and fetches user info

**Why this is a problem:**

1. The legacy web flow decodes the Google JWT **without verification** (line 122: `JSON.parse(atob(response.credential.split('.')[1]))`). The JWT signature is never validated, meaning a tampered token would be accepted.
2. The legacy mobile flow exchanges the auth code on the client side without a client secret (line 234), which will fail for most Google OAuth configurations.
3. The legacy flow saves users to a local `databaseService` instead of Supabase, creating a completely disconnected user store.
4. Having two parallel auth systems increases the attack surface and maintenance burden.

**Best practice fix:**

If Supabase is always configured in production, remove the legacy auth flow entirely. If it must be kept as a fallback, add JWT signature verification for the web flow.

---

## Summary of Issues by Severity

| Severity | # | Issue |
|----------|---|-------|
| CRITICAL | 1 | PKCE flow type configured but implicit flow token parsing used -- mobile sign-in is likely broken |
| CRITICAL | 2 | Forced sign-out before sign-in creates race conditions with auth guard |
| HIGH | 3 | UUID-to-number conversion causes ID collision risk |
| HIGH | 4 | `prompt: 'consent'` forces re-consent on every sign-in |
| HIGH | 5 | Session restoration uses `getSession()` instead of `getUser()` |
| HIGH | 6 | Two separate Supabase client instances with different configs |
| MEDIUM-HIGH | 7 | Five redundant OAuth return handlers create race conditions |
| MEDIUM-HIGH | 8 | Two different user conversion functions produce incompatible IDs |
| MEDIUM | 9 | No deep link configuration for mobile OAuth callback |
| MEDIUM | 10 | `onAuthStateChange` listener has stale closure over state |
| MEDIUM | 11 | Redundant double sign-out before new sign-in |
| MEDIUM | 12 | `isLoading` state stale in setTimeout closure |
| MEDIUM | 13 | No AppState handling for mobile session refresh |
| LOW-MEDIUM | 14 | Sensitive data in console logs (not guarded by __DEV__) |
| LOW-MEDIUM | 15 | Legacy auth flow still active with unverified JWT parsing |

---

## Recommended Priority Order for Fixes

1. **Fix Issue 1 (PKCE/Implicit mismatch)** -- This is potentially preventing mobile sign-in from working at all. Either switch to `flowType: 'implicit'` or update all token handling to use PKCE code exchange.

2. **Fix Issues 2 + 11 (Remove pre-login signOut)** -- This eliminates the largest source of complexity and race conditions. Removing the forced sign-out removes the need for the entire `oauth_redirecting` flag system.

3. **Fix Issue 7 (Consolidate OAuth return handling)** -- Choose one handler (preferably `onAuthStateChange`), remove the rest.

4. **Fix Issues 3 + 8 (Standardize user ID format)** -- Pick one conversion function, use string UUIDs everywhere.

5. **Fix Issue 4 (Remove `prompt: 'consent'`)** -- Simple one-line change, big UX improvement.

6. **Fix Issue 5 (Use `getUser()` for auth verification)** -- Important for security.

7. **Fix Issue 6 (Remove duplicate Supabase client)** -- Prevents accidental use of wrong client.

8. **Fix remaining medium/low issues** as time permits.
