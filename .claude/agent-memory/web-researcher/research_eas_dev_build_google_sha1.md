---
name: EAS Dev Build — Google OAuth + Maps SHA-1, google-services.json, and Places Autocomplete
description: SHA-1 fingerprints and API key restrictions for EAS dev builds; Places API (Web Service) architecture mismatch with Android-restricted keys; requestUrl headers workaround
type: reference
---

## Core answer

Yes — the EAS development build uses a DIFFERENT keystore (and therefore a different SHA-1) than the production build. Both must be registered in Google Cloud Console for their respective features to work.

## Google Sign-In (react-native-google-signin)

SHA-1 is required and must be registered as an Android OAuth client in Google Cloud Console (or in Firebase if using that approach). The SHA-1 is tied to the keystore that signed the APK — Google's servers reject any app whose signing SHA-1 is not in the authorized list. Error is `DEVELOPER_ERROR` (code 10).

EAS dev builds get their own keystore unless you explicitly configure `credentialsSource: "remote"` on the dev profile pointing to the same remote credentials as production. By default, a new managed keystore is generated per profile.

### Same package name — add SHA-1 via a new Android client entry

If the dev build uses the same package name as production, you do NOT modify the existing Android OAuth client. You create a SECOND Android OAuth client entry (same package name, dev SHA-1). Google Cloud Console only allows one SHA-1 per Android client entry, but accepts multiple Android clients with the same package name. The web client ID passed in JS code is unchanged — the Android clients are just validation entries, not values you reference in code.

### Different package name (e.g., com.swellyo.app.dev) — MUST create new client

If the dev build has a different Android package name (via APP_VARIANT suffix), you MUST create a new Android OAuth client with the dev package name + dev SHA-1. Package name must match exactly — there is no wildcard. A mismatch silently produces DEVELOPER_ERROR.

Steps to fix dev build:
1. Run `eas credentials` → select Android → select the development profile → copy the SHA-1
2. Go to Google Cloud Console → Credentials → Create Credentials → OAuth client ID → Android:
   - Same package name: create a second Android entry with same package + dev SHA-1
   - Different package name: create a new Android entry with dev package name + dev SHA-1
3. If using Firebase: add the dev SHA-1 (and dev package if different) to the Firebase Android app entry, re-download google-services.json

## Google Maps "Oops Something Went Wrong" — All Causes

### Cause 1: SHA-1 mismatch (key is restricted)
If the API key has "Android app" restrictions in GCC, it checks both the package name AND the SHA-1. The dev build's SHA-1 differs from production. Fix: add dev SHA-1 to the API key restriction in Google Cloud Console.

**Diagnosis shortcut**: Temporarily make the API key unrestricted (no app restriction). If maps loads, it was a SHA-1/package restriction issue.

### Cause 2: eas.json secret reference bug (literal string becomes the key)
If `eas.json` has `"EXPO_PUBLIC_GOOGLE_MAPS_KEY": "@MY_SECRET_NAME"`, EAS does NOT interpolate this. The literal string `@MY_SECRET_NAME` is injected as the API key value. Fix: remove the variable from eas.json `env` block entirely. EAS secrets auto-inject without needing to be listed.

### Cause 3: API key not injected into AndroidManifest at build time
The API key must reach `<meta-data android:name="com.google.android.geo.API_KEY">` in AndroidManifest.xml. Two valid approaches for Expo managed workflow:

**Option A — Config plugin (react-native-maps official):**
```js
// app.config.js
plugins: [
  ["react-native-maps", {
    androidGoogleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY
  }]
]
```

**Option B — android.config (alternative, confirmed working with Expo 53/54):**
```js
// app.config.js
android: {
  config: {
    googleMaps: {
      apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY
    }
  }
}
```
Note: With Expo SDK 53+, there were reports that Option A didn't propagate the key correctly. Option B was confirmed to fix it in those cases. Try Option B if Option A fails.

### Cause 4: provider not set to PROVIDER_GOOGLE
```jsx
import MapView, { PROVIDER_GOOGLE } from 'react-native-maps';
<MapView provider={PROVIDER_GOOGLE} ... />
```
Without this, Android may fall back to a non-Google provider, showing the error.

### Cause 5: Maps SDK for Android not enabled in GCC
The Google Cloud project must have "Maps SDK for Android" explicitly enabled.

### Cause 6: react-native-maps version incompatibility
With Expo 53/54, react-native-maps 1.24.2 had config plugin propagation issues. Run `npx expo-doctor` to check. Version 1.20.1 was confirmed stable in some reports.

## Google Maps / Places API

The API key SHA-1 restriction (under "Android apps") also needs the dev keystore SHA-1 added. If the key is unrestricted (no app restriction), it works for any keystore — so maps may work with an unrestricted key but Sign-In still won't (because Sign-In uses OAuth which is separate from API key restrictions).

Common cause of Maps breaking in EAS builds: `eas.json` has `"@SECRET_NAME"` in env — EAS does NOT interpolate that syntax; secrets auto-inject. The literal string `@EXPO_PUBLIC_GOOGLE_API_KEY_ANDROID` becomes the key value. Fix: remove the reference from eas.json env, let EAS auto-inject.

## google-services.json

google-services.json is required for the build if:
- Using `@react-native-google-signin/google-signin` with the Firebase config approach (specifying `googleServicesFile` in app.json)
- The file must be placed at the path specified in `android.googleServicesFile` in app.json (default: `./google-services.json`)

After adding the dev SHA-1 to Firebase, re-download the file and commit it (or re-upload to EAS secrets).

Note: If using the non-Firebase approach (webClientId only, no google-services.json), the SHA-1 must still be registered as an Android OAuth 2.0 client in Google Cloud Console directly.

## Getting the dev build SHA-1

```bash
eas credentials
# Select: Android → development profile → view Keystore → copy SHA-1
```

Or from the built APK:
```bash
keytool -printcert -jarfile your-dev-build.apk
```

## Google Places Autocomplete (react-native-google-places-autocomplete) — Android

This library makes HTTPS calls to the **Places Web Service API** (`maps.googleapis.com/maps/api`), NOT the Android SDK. This is the root cause of most Android dev build failures:

### Problem 1: Android-restricted API key breaks the autocomplete
If the API key in Google Cloud Console is restricted to "Android apps" (SHA-1 + package name), the library's HTTP calls are rejected with `REQUEST_DENIED` because Android app restrictions don't apply to web service calls. **Maps tiles can work with the same key if the Maps SDK reads it natively, but the Places component fails.**

Fix options:
- Use an unrestricted key (quick, insecure — fine for dev)
- Use the `requestUrl` prop with custom headers to simulate Android identity:
```javascript
requestUrl={{
  useOnPlatform: 'all',
  url: 'https://maps.googleapis.com/maps/api',
  headers: {
    "X-Android-Package": "com.your.package",
    "X-Android-Cert": "YOUR_SHA1_WITHOUT_COLONS"  // important: no colons
  }
}}
```
Get SHA-1 via `./gradlew signingReport` in the android/ directory.

### Problem 2: Dev build SHA-1 differs from production
If the API key has Android app restrictions, the dev build SHA-1 must also be added to the GCC key, same as for Maps. The same fix path as Google Sign-In: `eas credentials` → copy SHA-1 → add to GCC.

### Problem 3: Wrong API enabled in GCC
The library requires "Places API" (Web Service) to be enabled in Google Cloud Console — NOT "Places SDK for Android". Both may need to be enabled if using a mix of web and native approaches.

### Problem 4: Places API (New) vs Legacy
The legacy Places API is deprecated. The library currently works against the legacy endpoint. If "Places API (New)" is enabled but the legacy one is disabled, requests fail. Enable both or confirm which endpoint the library version targets.

## Sources

- https://react-native-google-signin.github.io/docs/setting-up/get-config-file
- https://docs.expo.dev/app-signing/app-credentials/
- https://mvolkanyurtseven.medium.com/sha1-key-hell-regarding-gmail-authentication-and-sign-in-e710baef5071
- https://naqeebali-shamsi.medium.com/expo-eas-build-google-maps-not-working-with-react-native-maps-52847ea5f79f
- https://github.com/orgs/supabase/discussions/27310
- https://github.com/FaridSafi/react-native-google-places-autocomplete/issues/911 (Android key restriction + requestUrl headers fix)
- https://github.com/FaridSafi/react-native-google-places-autocomplete/issues/652 (how to restrict key)
- https://github.com/FaridSafi/react-native-google-places-autocomplete/issues/938 (Places API vs Places API New)
