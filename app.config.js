const IS_DEV = process.env.APP_VARIANT === 'development';

module.exports = ({ config }) => ({
  ...config,
  name: IS_DEV ? 'Swellyo (Dev)' : config.name,
  ios: {
    ...config.ios,
    bundleIdentifier: IS_DEV ? 'com.swellyo.app.dev' : config.ios.bundleIdentifier,
  },
  android: {
    ...config.android,
    package: IS_DEV ? 'com.swellyo.app.dev' : config.android.package,
  },
});
