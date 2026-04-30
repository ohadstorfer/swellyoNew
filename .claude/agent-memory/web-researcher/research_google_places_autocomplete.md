---
name: Google Places Autocomplete — React Native / Expo
description: Library options, API setup, pricing, and store-policy gotchas for Places autocomplete in Expo SDK 54 (web + iOS + Android)
type: reference
---

## Recommended approach

Use `react-native-google-places-textinput` (HTTP/REST-based, uses Places API New) for a pure-JS, Expo-managed-workflow solution. For web, route autocomplete calls through a lightweight Supabase Edge Function proxy to avoid CORS.

## Library landscape (2026)

| Library | API used | Web | Expo managed | Notes |
|---|---|---|---|---|
| `react-native-google-places-autocomplete` (FaridSafi) | Legacy Places API | Via proxy | Yes | v2.6.4 Jan 2026, 2.1k stars, still maintained, uses legacy API |
| `react-native-google-places-textinput` (amitpdev) | Places API (New) | Via proxyUrl prop | Yes | Newer, auto session token management, TypeScript |
| `expo-google-places-autocomplete` (alanjhughes) | Native iOS/Android SDK | No | Requires dev build | Uses native SDKs, not managed workflow |
| `expo-google-places` (devpgcs) | Native SDK | No | Requires dev build | Same constraint |
| Raw fetch + custom UI | Places API (New) | Yes (needs proxy on web) | Yes | Most control, most work |

## Web support reality

Google Places API has CORS restrictions. On web, ALL library approaches need a proxy. Options:
- A lightweight Supabase Edge Function that forwards the call (best for this project — already have Edge Functions)
- cors-anywhere (bad for prod)
- A dedicated proxy server

Neither FaridSafi nor amitpdev handle CORS themselves — the proxy requirement is the same for both.

## Raw fetch approach — when it makes sense

Pros: Full styling control, no library dependency, works the same across all platforms, easy to proxy through Supabase Edge Function.
Cons: You build the debounce, session token logic, dropdown UI, keyboard handling yourself (~150-200 lines).

For a field that appears in one onboarding step, raw fetch is viable and actually cleaner than wiring up a library that needs a proxy anyway.

## API key setup

- Cannot use one restricted key for iOS + Android + web simultaneously
- Create 3 separate keys:
  - iOS: restrict by bundle ID
  - Android: restrict by package name + SHA-1 fingerprint (same SHA-1 issue as Google Sign-In — dev keystore vs prod)
  - Web: restrict by HTTP referrer (or IP) — or use unrestricted key only on the server-side proxy
- Enable "Places API (New)" in GCP Library (not legacy "Places API")

## Pricing (post March 2025 changes)

- $200/month credit REMOVED as of March 1, 2025
- New model: free usage caps per SKU
  - Autocomplete requests (individual, no session): $2.83/1K, 10K free/month
  - Place Details Essentials: $5/1K, 10K free/month
  - Place Details Pro: $17/1K, 5K free/month
  - Place Details Enterprise: $20/1K, 1K free/month
- Session token trick: If you pass a session token with autocomplete AND terminate with a Place Details (Pro/Enterprise) call, the autocomplete keystrokes are FREE — only the Place Details call is billed
- Abandoned sessions (user types but doesn't pick) revert to per-request billing at $2.83/1K

For a small app (thousands of searches/month), cost is effectively $0 with session tokens and staying within free caps.

## Privacy / store-policy gotchas

- Autocomplete itself does NOT require location permission — uses IP biasing by default
- Do NOT request location permission just for autocomplete (Apple will reject if the permission isn't clearly needed)
- Must include Google's attribution ("Powered by Google") wherever results are displayed — this is a ToS requirement
- Privacy policy must reference Google's Terms and Privacy Policy

## Applies to Swellyo stack

- Best approach: raw fetch through a Supabase Edge Function proxy (consistent with existing architecture)
- Session tokens are easy to implement with `crypto.randomUUID()` — generate one per input focus, pass it to both autocomplete and place details calls
- For iOS/Android: API key can go in EXPO_PUBLIC_ env var, but should be an unrestricted key (since you're routing through Edge Function) OR platform-restricted appropriately
- The SHA-1 gotcha from EAS dev builds applies here too — if you restrict the Android key by SHA-1, dev builds won't work with it
