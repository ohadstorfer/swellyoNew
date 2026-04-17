# 06 — Push Notifications

Reliable push delivery, platform quirks, E2EE notification decryption, and what applies to React Native + Expo.

---

## The Push Delivery Stack

```
Your server
  └─ sends to APNs (Apple) or FCM (Google/Android)
       └─ routes to device OS
            └─ wakes app (or shows notification)
```

There are two hops with different failure modes:
1. **Server → APNs/FCM:** Can fail with 4xx (bad token, app uninstalled) or 5xx (temporary outage). Requires retry logic.
2. **APNs/FCM → device:** Subject to OS-level throttling, battery optimization, do-not-disturb, and network availability. You have zero visibility into this hop — even if APNs/FCM accepts your message, the device might not show it for minutes or ever.

---

## APNs (Apple Push Notification service)

**Protocol:** HTTP/2 with TLS client certificates or JWT authentication. Connection to `api.push.apple.com:443`. APNs supports HTTP/2 multiplexing — one connection can send thousands of concurrent pushes.

**Token types:**
- **Device token:** Per-device, per-app identifier. Tokens change when the app is reinstalled, restored from backup, or the OS token rotation policy kicks in. You must handle `410 Gone` responses from APNs and purge stale tokens from your database.
- **Push type:** Must declare `alert` (visible notification), `background` (silent wake), `voip`, etc. Background pushes are severely throttled by iOS (Apple does not guarantee delivery timing or frequency).

**Notification categories (critical for messaging):**
- `alert`: Shows banner, plays sound. User can dismiss. Goes through Do Not Disturb.
- `background`: Silent — wakes app for 30 seconds of background execution. No visual. Heavily throttled by iOS.
- `mutable-content: 1`: Tells iOS to invoke the app's Notification Service Extension before display. Required for E2EE decryption on device.

**iOS low-power / background restrictions:** iOS aggressively throttles background delivery for battery-constrained devices. Apps that receive too many background pushes may be deprioritized. "Silent" push is not a reliable real-time mechanism — it is only suitable for prefetching and cache warming.

---

## FCM (Firebase Cloud Messaging)

**Protocol:** HTTP v1 API (`https://fcm.googleapis.com/v1/projects/{project}/messages:send`). Older XMPP-based FCM API was deprecated in 2023. All production systems should use HTTP v1.

**Token management:** FCM registration tokens change on app reinstall, cache clear, or OS-triggered refresh. Apps must call `getToken()` on launch and compare with the stored token. Handle `messaging/registration-token-not-registered` errors by deleting the stale token.

**Android battery optimization:** Android Doze mode (6.0+) restricts background activity during idle periods. FCM High Priority messages bypass Doze and are delivered with low latency. Low Priority messages are deferred until the device exits Doze. For chat notifications, always send as High Priority (`priority: high` in the FCM payload).

**Android notification channels (8.0+):** Apps must create `NotificationChannel` objects that users can configure individually in system settings. If a user mutes your "Messages" channel, that is their choice — you cannot override it programmatically.

---

## Deduplication: Realtime + Push

In a Supabase-backed app, a message received via Supabase Realtime while the app is foregrounded should not also show a push notification banner. The standard approach:

1. **Client tracks "is foreground":** On notification receipt in foreground, suppress the local notification display (or show a quiet in-app indicator instead).
2. **Server-side dedup:** The push is sent unconditionally, but the notification payload includes the message ID. The client checks if it already has that message (from the Realtime subscription) and dismisses the pending notification if so.
3. **Expo's approach:** `expo-notifications` has a `setNotificationHandler` where you can return `{ shouldShowAlert: false }` when the app is in foreground, then display the message via your in-app UI instead.

**Important:** Do not rely on Supabase Realtime as the sole delivery mechanism. The WebSocket may drop, the app may be backgrounded, or the device may be offline. Push is the fallback that ensures the user sees the message even without an active WebSocket.

---

## E2EE Notification Decryption on Device

When messages are E2EE, your server cannot send message content in the push notification payload (it doesn't have the plaintext). Two approaches:

### Option A: Server-sent push with ciphertext
The push payload contains the encrypted message ciphertext. The app's Notification Service Extension (iOS) or a background service (Android) decrypts it on-device and constructs the visible notification.

**iOS Notification Service Extension:**
- A separate app extension declared in your app bundle.
- iOS invokes it when a notification with `mutable-content: 1` arrives.
- Has 30 seconds to modify the `UNNotificationContent` before display.
- Has access to the shared Keychain (using a shared Keychain group configured in both the main app and the extension).
- Typical flow: read decryption key from Keychain → decrypt ciphertext from notification payload → set `content.body` to the decrypted text.

Signal uses this mechanism on iOS. The push payload says "you have a new message" (no content), the extension fetches the encrypted message from Signal's server, decrypts it using the locally-held Double Ratchet session key, and shows the plaintext.

**Android:** You can do notification decryption in a background `BroadcastReceiver` or `MessagingService` (FirebaseMessagingService). Access to the app's local SQLite/encrypted key store is straightforward since Android doesn't isolate extension processes the same way iOS does.

### Option B: "New message from X" without content
Send a push that only says "New message from [name]" (if name is not sensitive). The app decrypts content in-band when the user opens the conversation. This is simpler but less usable.

---

## Token Rotation and Lifecycle

```
App installs → register device with APNs/FCM → store token in Supabase
User reinstalls → token changes → old token becomes stale
User uninstalls → APNs/FCM returns 410/UNREGISTERED → delete token from Supabase
User background refreshes token → app calls getToken() → upsert new token
```

Database design:
```sql
CREATE TABLE push_tokens (
  user_id         UUID REFERENCES users(id),
  token           TEXT NOT NULL,
  platform        TEXT NOT NULL, -- 'ios', 'android'
  last_seen_at    TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, token)
);
```

When sending, handle errors: delete `410`/`UNREGISTERED` tokens immediately. Retry `5xx` errors with exponential backoff.

---

## Expo Push Service vs. Direct APNs/FCM

**Expo Push Service:** Expo provides a unified endpoint (`https://exp.host/--/api/v2/push/send`) that accepts Expo Push Tokens and routes to APNs or FCM. Advantages: one API for both platforms, Expo handles credential management for you.

**Limitations of the Expo Push Service:**
- You must check "push receipts" separately to find delivery failures — Expo does not call your server back.
- Receipt polling introduces latency in detecting stale tokens.
- Expo adds one more external dependency and hop to the delivery path.
- Expo Push Tokens are specific to Expo managed builds. Bare workflow or custom native modules may need direct APNs/FCM.

**For production Swellyo:** The Expo Push Service is fine for early scale. At the point where you need delivery guarantees, receipt monitoring, and fast token rotation, consider adding direct APNs/FCM calls from a Supabase Edge Function, with Expo Push Tokens stored alongside native FCM tokens as a fallback.

---

## Reliability Checklist

- [ ] Store push tokens per user per device in Supabase
- [ ] Upsert token on app launch (token may have changed)
- [ ] Delete tokens on `410 Gone` (APNs) or `UNREGISTERED` (FCM) response
- [ ] Send High Priority on FCM for chat messages
- [ ] Set `mutable-content: 1` on APNs if you want a Notification Service Extension
- [ ] Implement deduplication: suppress push notification when app is foreground
- [ ] Check Expo push receipts asynchronously (poll or webhook if available)
- [ ] Never rely solely on Supabase Realtime for delivery — always send a push too

---

## Sources

- [Expo — Push Notifications Setup](https://docs.expo.dev/push-notifications/push-notifications-setup/)
- [Expo — Send Notifications with FCM and APNs](https://docs.expo.dev/push-notifications/sending-notifications-custom/)
- [Apple Developer — UNNotificationServiceExtension](https://developer.apple.com/documentation/usernotifications/unnotificationserviceextension)
- [ConnectyCube — E2EE Push Notifications in React Native](https://connectycube.com/2024/07/10/encrypted-push-notifications-in-react-native/)
- [Courier — React Native Push Notifications: FCM, Expo & Production Guide](https://www.courier.com/blog/react-native-push-notifications-fcm-expo-guide)
- [Building Facebook Messenger — Engineering at Meta](https://engineering.fb.com/2011/08/12/android/building-facebook-messenger/)
