# android/app/build.gradle — applicationId setup

The `applicationId` is set in two parts to satisfy both Expo CLI (local dev) and EAS dev/prod variant split:

```gradle
defaultConfig {
    applicationId 'com.swellyo.app'
    if (System.getenv("APP_VARIANT") == "development") {
        applicationIdSuffix '.dev'
    }
    ...
}
```

## Why it's split

- **Expo CLI** (`npm run android`, `npx expo start`) parses `build.gradle` with a regex that only matches a literal `applicationId 'string'`. A ternary like `System.getenv("APP_VARIANT") == "development" ? 'a' : 'b'` fails the regex and Expo CLI throws:
  ```
  CommandError: Failed to locate the android application identifier in the "android/" folder.
  ```
- **EAS dev profile** (`eas.json` → `build.development.env.APP_VARIANT = "development"`) needs the final `applicationId` to be `com.swellyo.app.dev` so dev + prod can coexist on the same device.

The literal `applicationId 'com.swellyo.app'` keeps Expo CLI happy. The conditional `applicationIdSuffix '.dev'` appends the suffix at Gradle config time only when `APP_VARIANT=development` is set — same effective behavior as the previous ternary, but no longer breaks local dev.

## What this replaces

Before, this file had a "TEMP HARDCODE — revert before committing" comment and the `applicationId` was swapped between `'com.swellyo.app'` (for local dev) and the ternary (for EAS builds) by hand every commit. That workflow is gone — the current setup is the permanent shape, do not change it.
