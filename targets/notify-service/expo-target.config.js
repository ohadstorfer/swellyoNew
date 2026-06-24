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
  // Communication Notifications require this entitlement on BOTH the app target
  // (set in app.json) and this extension target.
  entitlements: {
    'com.apple.developer.usernotifications.communication': true,
  },
};
