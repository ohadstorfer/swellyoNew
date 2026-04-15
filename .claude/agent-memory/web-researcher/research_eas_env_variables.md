---
name: EAS Build — .env Files, Gitignore, and EAS Secrets
description: How EAS handles local .env files during builds, gitignore behavior, and EXPO_PUBLIC_ vs EAS Secrets distinction
type: reference
---

## .env Upload Behavior

EAS CLI creates a project archive before uploading to build servers. It copies all files from the repo root EXCEPT: `.git`, `node_modules`, and any files matched by `.gitignore` (or `.easignore` if present).

**If `.env` is in `.gitignore` → it is NOT uploaded to EAS build servers.** The build proceeds without it.

**If `.env` is NOT in `.gitignore` → it IS uploaded as part of the archive** and available during the build.

The recommended approach per Expo docs: always add `.env` to `.gitignore` and use EAS Environment Variables instead.

## Workaround to include gitignored files

Use `.easignore` with a `!` prefix for the file:
```
# contents of .easignore — include everything from .gitignore plus override for one file
node_modules
.env.local
!.env.production   # this overrides gitignore and WILL be uploaded
```

## EXPO_PUBLIC_ Variables on EAS Servers

All variables with `EXPO_PUBLIC_` prefix must be defined via EAS Environment Variables (dashboard or `eas env:set`). During build, Expo CLI substitutes `process.env.EXPO_PUBLIC_VARNAME` at Metro bundle time with the values from the EAS environment specified via `--environment` flag.

These are **not secret** — they are embedded in the JS bundle and readable by anyone who runs the app.

## EAS Secrets (secret visibility)

Secret-visibility EAS variables are NOT available during Metro bundling (the JS bundle step). They are only available to the build infrastructure (native compile, EAS hooks, `eas.json` scripts). Use cases: NPM tokens, Sentry upload keys, signing credentials.

If you set `EXPO_PUBLIC_*` as a secret-visibility variable, it will NOT be substituted into the bundle — this will cause silent failures or undefined values at runtime.

## Correct setup for Swellyo

All vars in the project use `EXPO_PUBLIC_*` prefix → they must all be "plain text" or "sensitive" visibility in EAS Environment Variables, NOT "secret". Define them per environment (development/preview/production) in the EAS dashboard or via `eas env:set --environment production --name EXPO_PUBLIC_SUPABASE_URL --value ...`.

## Key Sources

- https://docs.expo.dev/eas/environment-variables/
- https://docs.expo.dev/eas/environment-variables/faq/
- https://docs.expo.dev/eas/environment-variables/usage/
- https://github.com/expo/fyi/blob/master/eas-build-archive.md
- https://docs.expo.dev/build-reference/easignore/
