---
name: Apple Sign In — Expo + Supabase Auth
description: Full overview of Apple Sign In implementation for Expo 54 + Supabase: Apple Developer Console, Supabase config, native vs OAuth, iOS/Android/web differences, gotchas
type: reference
---

## Recommended approach

Use `expo-apple-authentication` for native iOS (signInWithIdToken flow — no OAuth config needed). Use Supabase OAuth flow for web. Android cannot use Apple Sign In natively — must fall back to OAuth via browser, which is poor UX (most teams just omit Apple on Android).

## Apple Developer Console Setup

- **App ID**: `com.yourapp` — enable "Sign in with Apple" capability
- **Services ID**: `com.yourapp.web` — for web/OAuth only; set callback URL to `https://<project>.supabase.co/auth/v1/callback`
- **Team ID**: 10-char ID from top-right of Apple Developer portal
- **Signing Key** (.p8 file): Generated once, download immediately — cannot re-download
- For Expo development builds: also register your dev bundle ID (e.g. `com.yourapp.dev`) in Apple Developer under App IDs

## Supabase Dashboard Setup

**For native iOS flow (no OAuth):**
- Go to Auth > Providers > Apple
- Enable Apple
- Under "Client IDs", add your iOS bundle ID (e.g. `com.yourapp`)
- Also add `host.exp.Exponent` if you want Expo Go testing to work

**For web/OAuth flow:**
- Also fill in: Team ID, Services ID (as Client ID), Signing Key (.p8 content), Key ID

## Expo Package & Config

- Install: `npx expo install expo-apple-authentication`
- `app.json`: set `ios.usesAppleSignIn: true`
- Plugin: `"plugins": ["expo-apple-authentication"]` (handles entitlements automatically for EAS builds)
- Manual entitlement if not using EAS: add `com.apple.developer.applesignin` to `.entitlements` file

## Flow Differences by Platform

### iOS (native — preferred)
1. Call `AppleAuthentication.signInAsync({ requestedScopes: [FULL_NAME, EMAIL] })`
2. Get back `credential.identityToken`
3. Call `supabase.auth.signInWithIdToken({ provider: 'apple', token: credential.identityToken })`
4. No OAuth config needed, no secret rotation, no browser redirect

### Web
- Must use Supabase OAuth flow: `supabase.auth.signInWithOAuth({ provider: 'apple' })`
- Requires Services ID + Signing Key + callback URL configured in Apple Developer and Supabase
- OR use "Sign in with Apple JS" for websites — configure Services ID in Supabase "Client IDs" (no OAuth settings needed), get ID token, pass to `signInWithIdToken`

### Android
- `expo-apple-authentication` does NOT work on Android
- Only option: OAuth flow via browser (`supabase.auth.signInWithOAuth`)
- Poor UX (opens browser) — most apps just skip Apple Sign In on Android
- Apple does NOT require Apple Sign In on Android for App Store compliance — it's only required on iOS if you offer other social logins

## Critical Gotchas

1. **Full name is only returned on first sign-in.** After that Apple returns null. Immediately capture and save with `supabase.auth.updateUser({ data: { full_name: ... } })` after first sign-in.

2. **Secret key rotation every 6 months** for any OAuth flow (web, Android). The .p8-derived secret expires. Set a calendar reminder. Native iOS flow does NOT require rotation.

3. **Expo Go uses `host.exp.Exponent` as the bundle ID.** Must add this to Supabase "Client IDs" for Expo Go testing to work.

4. **Development builds need separate App ID registration.** If you use EAS dev builds with a different bundle ID (e.g. `com.yourapp.dev`), register that too.

5. **App Store requirement:** Apple mandates Sign in with Apple if your app offers ANY other third-party social sign-in (Google, Facebook, etc.) on iOS. Since Swellyo has Google Sign In, Apple Sign In is required before App Store submission.

6. **Do NOT use native button styling.** `AppleAuthenticationButton` must be used as-is per App Store guidelines — no custom background/border-radius.

7. **The "old" workaround approach** (decode JWT manually, create user with temp password, store in profiles table) is outdated and insecure. Use `signInWithIdToken` instead — Supabase supports it natively.

8. **Android OAuth discussion:** Supabase GitHub discussion #35827 notes Apple OAuth does not reliably work on Android with Expo — confirm before relying on it.

## Sources
- https://supabase.com/docs/guides/auth/social-login/auth-apple
- https://docs.expo.dev/versions/latest/sdk/apple-authentication/
- https://medium.com/@jevonmahoney/apple-auth-in-expo-supabase-f1adc2428e6a
- https://github.com/orgs/supabase/discussions/35827
