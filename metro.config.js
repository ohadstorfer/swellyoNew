const { getSentryExpoConfig } = require("@sentry/react-native/metro");
const path = require("path");

const config = getSentryExpoConfig(__dirname);

// --- Web-only: swap the native bottom-tab bar for a JS one ------------------
// @bottom-tabs/react-navigation (native tab bar) imports react-native internals
// (`codegenNativeComponent`) that cannot bundle for web, which otherwise breaks
// `expo start --web` for the whole app. On web ONLY, redirect that module
// specifier to a small JS shim backed by @react-navigation/bottom-tabs so the
// app runs on localhost. Native (ios/android) is untouched — the guard is
// `platform === 'web'`, so those builds resolve the real native library.
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === "web" && moduleName === "@bottom-tabs/react-navigation") {
    return {
      type: "sourceFile",
      filePath: path.resolve(__dirname, "src/navigation/bottomTabsWebShim.tsx"),
    };
  }
  const next = defaultResolveRequest || context.resolveRequest;
  return next(context, moduleName, platform);
};

// --- Keep the operator dashboard out of Metro entirely ---------------------
// `operator-dashboard/` is a separate Vite + React web app that happens to
// live in this repo so Eyal can get at it. It is NOT part of the Expo app and
// nothing here imports it.
//
// Metro watches the whole project root, so once anyone runs `npm install`
// inside that folder its node_modules appears with its own react and
// react-dom — and Metro's haste map fails with a naming collision that has
// nothing to do with the app. Blocking the path is what prevents that.
// Its node_modules is git-ignored, so this only bites on a machine where
// someone has actually worked on the dashboard.
const dashboardBlock = /(^|[\/\\])operator-dashboard[\/\\].*/;
const existingBlockList = config.resolver.blockList;
config.resolver.blockList = Array.isArray(existingBlockList)
  ? [...existingBlockList, dashboardBlock]
  : existingBlockList
    ? [existingBlockList, dashboardBlock]
    : [dashboardBlock];

module.exports = config;
