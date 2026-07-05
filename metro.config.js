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

module.exports = config;
