/**
 * Apple "Share Extension" — "Share to Swellyo".
 *
 * Shows a SwiftUI recents picker inside the system share sheet. Contacts, links
 * and text insert straight into `messages` via PostgREST, using an access token
 * the app publishes to a shared Keychain access group (src/services/sessionBridge.ts)
 * and a recents/config blob the app writes into the App Group container
 * (src/services/shareRecentsCache.ts). Media, an expired token, an empty recents
 * cache or an unparseable vCard all stage a payload and open the app instead
 * (swellyo://share?staged=<uuid> → src/services/shareIntake.ts).
 *
 * The UI here is hand-written SwiftUI, NOT React Native: share extensions are
 * jetsammed around ~120 MB and an RN runtime plus a conversation list has been
 * measured at ~85 MB peak. There is no room for Hermes here.
 *
 * @type {import('@bacons/apple-targets').Config}
 */
module.exports = {
  type: 'share',
  name: 'SwellyoShare',
  // Match the main app (15.1). Without this the target defaults to iOS 18 and
  // the extension silently won't load on older devices — the same trap
  // notify-service documents.
  deploymentTarget: '15.1',
  // `share` sets appGroupsByDefault, but be explicit: the container is the only
  // channel between the app and this process.
  entitlements: {
    'com.apple.security.application-groups': ['group.com.swellyo.app'],
  },
  frameworks: ['SwiftUI', 'Contacts'],
};
