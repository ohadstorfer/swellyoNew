---
name: eas-build-asc-api-key-credentials
description: EAS build iOS credentials with ASC API key — exact env var names, non-interactive behavior for new extension targets, Windows-safe command sequence, error diagnosis
metadata:
  type: reference
---

## Env var names (confirmed from official CI docs — docs.expo.dev/build/building-on-ci)

For `eas build` credential repair/validation on CI:
- `EXPO_ASC_API_KEY_PATH` — absolute path to the .p8 file
- `EXPO_ASC_KEY_ID` — the Key ID (10-char string)
- `EXPO_ASC_ISSUER_ID` — the UUID issuer ID
- `EXPO_APPLE_TEAM_ID` — Apple Team ID
- `EXPO_APPLE_TEAM_TYPE` — `IN_HOUSE`, `COMPANY_OR_ORGANIZATION`, or `INDIVIDUAL`

The eas.json `submit` section fields `ascApiKeyPath`/`ascApiKeyIssuerId`/`ascApiKeyId` are SUBMIT-ONLY. They do NOT appear in the build section and are not read during `eas build`.

## What EXPO_ASC_* vars actually enable during `eas build --non-interactive`

They allow EAS to REPAIR or RE-SIGN an already-existing provisioning profile on Expo servers.
They do NOT create a brand-new profile for a bundle ID that has never been set up before.
If the extension's bundle ID has no credentials on Expo servers yet, `--non-interactive` FAILS regardless of whether EXPO_ASC_* are set.

## Diagnosing the exact error

"Distribution Certificate is not validated for non-interactive builds. Skipping Provisioning Profile validation on Apple Servers because we aren't authenticated. Failed to set up credentials. Credentials are not set up. Run this command again in interactive mode."

Means one of:
1. EXPO_ASC_* env vars were NOT picked up (path wrong, not exported in shell, Windows path separator issue)
2. Vars were set but the specific extension bundle ID has NEVER had credentials stored on Expo servers

The "Credentials are not set up" line is the giveaway for case 2 — the profile doesn't exist on Expo servers yet.

## Role requirement

ASC API key must have **Admin** role. App Manager works only if "Access to Certificates, Identifiers, and Profiles" is explicitly enabled in App Store Connect.

## Windows-safe path to create a new extension target's provisioning profile

### Option A: Local credentials (fully non-interactive, no 2FA ever needed)
1. In Apple Developer Portal (web browser): create App ID for the extension bundle ID
2. Create Distribution Provisioning Profile for that App ID
3. Download the `.mobileprovision` file
4. Download the existing Distribution Certificate from Expo: run `eas credentials -p ios` → select "Download existing Distribution Certificate" → saves as .p12
5. Add to `credentials.json`:
   ```json
   {
     "ios": {
       "mainapp": { "provisioningProfilePath": "...", "distributionCertificate": { "path": "...", "password": "..." } },
       "NotifyService": { "provisioningProfilePath": "ios/certs/notify-service.mobileprovision", "distributionCertificate": { "path": "ios/certs/dist.p12", "password": "..." } }
     }
   }
   ```
6. In eas.json build profile: `"credentialsSource": "local"`

### Option B: Managed credentials, one-time interactive setup (ASC key bypasses 2FA)
1. Set EXPO_ASC_API_KEY_PATH, EXPO_ASC_KEY_ID, EXPO_ASC_ISSUER_ID in your shell
2. Run `eas credentials -p ios` interactively — the CLI will use ASC key instead of Apple ID/2FA
3. Navigate to the extension bundle ID, select "Set up Distribution Certificate" and "Set up Provisioning Profile"
4. After this one-time run, all future `eas build --non-interactive` builds work because credentials are on Expo servers

## eas-cli v9.0.0 (May 2024): `--freeze-credentials` flag

Added to prevent `eas build` from modifying credentials in non-interactive mode. Useful for CI when you know credentials are already correct.

## eas-cli v20.1.0 (June 2025): stored ASC key for non-interactive repair

ASC API key stored in EAS credentials (via `eas credentials`) can now be used to validate/repair provisioning profiles for non-interactive App Store/Enterprise builds, without requiring EXPO_ASC_* env vars. The stored key is used automatically.

## Known issue (expo/expo #22673)

The EAS docs imply non-interactive mode can repair expired provisioning profiles automatically. In practice, if the profile has expired or been revoked and needs to be fully recreated, it STILL prompts for interactive mode. The repair only works for profiles that need minor re-signing, not full recreation.
