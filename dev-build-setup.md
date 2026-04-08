# Development Build Setup (Android)

We switched from Expo Go to a **development build**. This is required because we added `react-native-keyboard-controller` which includes native code that Expo Go doesn't support.

**Expo Go will no longer work.** Use the development build instead.

---

## First Time Setup

### 1. Build the APK

Run this from the project root:

```
eas build --profile development --platform android
```

This uploads the project to Expo's servers and builds an APK. It takes ~10-15 minutes. When done, you'll get a download link.

You can also find the latest build at: https://expo.dev/accounts/swellyo/projects/swellyo/builds

### 2. Install the APK on your phone

- Open the build link on your Android phone
- Download and install the APK
- You may need to allow "Install from unknown sources" in your phone settings

### 3. Start the dev server

Instead of `npx expo start`, run:

```
npx expo start --dev-client
```

### 4. Open the app

Open the **Swellyo** app on your phone (not Expo Go). It will connect to the dev server automatically.

Make sure your phone and computer are on the **same WiFi network**.

---

## Day-to-Day Usage

You only need to rebuild the APK when **native dependencies change** (new packages with native code are added/removed). For normal code changes (JS/TS), just run:

```
npx expo start --dev-client
```

The app on your phone will hot-reload like Expo Go did.

---

## Troubleshooting

**App says "No development build found"**
- Make sure the APK is installed on your phone
- Make sure you're running `--dev-client`, not regular `npx expo start`

**Network request failed**
- Make sure phone and computer are on the same WiFi
- Try: `npx expo start --dev-client --host lan`

**App crashes on launch**
- You probably need a new build. Run `eas build --profile development --platform android` again
