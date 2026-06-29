/**
 * Apple "Notification Service Extension" — intercepts each incoming push that is
 * flagged `mutable-content` and rebuilds it as an iOS Communication Notification
 * (big avatar + the Swellyo app icon stamped in the corner by iOS).
 *
 * The big image is the sender's photo (DM) or the group hero image (group);
 * both are sent in the push payload by the `send-push-notification` edge fn.
 *
 * @type {import('@bacons/apple-targets').Config}
 */
module.exports = {
  type: 'notification-service',
  name: 'SwellyoNotifyService',
  // Match the main app (15.1). Without this the target defaults to iOS 18, and
  // the extension silently won't load on any device below iOS 18 — the push
  // then falls back to the plain app-icon notification. The Communication
  // Notification APIs used here all exist since iOS 15.
  deploymentTarget: '15.1',
  // Communication Notifications require this entitlement on BOTH the app target
  // (set in app.json) and this extension target.
  entitlements: {
    'com.apple.developer.usernotifications.communication': true,
  },
};
