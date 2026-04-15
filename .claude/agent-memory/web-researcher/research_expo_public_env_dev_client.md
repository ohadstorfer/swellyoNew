---
name: EXPO_PUBLIC Env Variables — Dev Client vs EAS Build
description: How EXPO_PUBLIC_ vars are inlined (Metro bundle time, NOT EAS build time); local .env works with npx expo start --dev-client because JS is served over network, not baked into APK
type: reference
---

## Core mechanic

`EXPO_PUBLIC_*` variables are inlined by Metro at **bundle time** — specifically when Metro serializes the JS bundle. This is NOT frozen into the APK at EAS build time during dev client usage.

## Why local .env works with dev clients

A dev client (expo-dev-client) APK contains only the **native layer** — it has no JS bundle baked in. When you run `npx expo start --dev-client`, Metro starts a local server on port 8081 and the device fetches the JS bundle over the network (LAN or tunnel). Metro re-bundles your JS fresh on every start, reading `.env` at that time and inlining the values. So local `.env` changes are picked up immediately without rebuilding the APK.

## Production builds are different

For `eas build` producing a release APK/IPA, EAS builds the JS bundle on the server using `.env` files you've uploaded or EAS secrets, and that bundle IS baked into the APK. No local `.env` override is possible post-build.

## When you DO need EAS secrets

- Release builds (production APKs/IPAs) — EAS must have the values at build time
- EAS Updates (OTA) — same principle, bundle is built on EAS servers
- CI/CD pipelines where no local .env exists

## When local .env is sufficient

- `npx expo start` (Expo Go)
- `npx expo start --dev-client` (dev client, JS served over network)
- Local `npx expo run:android` / `npx expo run:ios` debug builds

## Pulling EAS env vars locally

Use `eas env:pull --environment development` to sync EAS env vars to `.env.local` for local dev parity.

## Visibility types (EAS)

- `plain text` — readable anywhere, fine for EXPO_PUBLIC vars
- `sensitive` — can be pulled locally but not displayed in dashboard
- `secret` — never leaves EAS servers; cannot be used in client JS (only Edge Functions / build scripts)

## Sources

- https://docs.expo.dev/guides/environment-variables/
- https://expo.dev/blog/what-are-environment-variables
- https://docs.expo.dev/develop/development-builds/use-development-builds/
- https://docs.expo.dev/eas/environment-variables/faq/
