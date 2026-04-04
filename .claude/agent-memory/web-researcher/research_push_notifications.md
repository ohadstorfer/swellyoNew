---
name: Expo Push Notifications with Supabase
description: End-to-end setup for Expo SDK 54 push notifications (expo-notifications) with Supabase Edge Function delivery, iOS APNs, Android FCM v1, and WhatsApp-style DM notifications
type: project
---

## Recommended approach
Use Expo Push Notification Service (not direct APNs/FCM) — it abstracts both platforms. Store push tokens in the `profiles` table in Supabase. Trigger the Edge Function via a **Database Webhook** on INSERT to a `messages` table (or equivalent). The Edge Function POSTs to `https://exp.host/--/api/v2/push/send`.

## SDK 54 Breaking Change
Push notifications no longer work inside Expo Go as of SDK 54. A Development Build is required for testing.

## Key Steps (end-to-end)

### 1. Install packages
```bash
npx expo install expo-notifications expo-device expo-constants
```

### 2. app.json config
```json
{
  "expo": {
    "plugins": ["expo-notifications"],
    "android": {
      "googleServicesFile": "./google-services.json"
    }
  }
}
```

### 3. Get and store push token (client)
```ts
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';

async function registerForPushNotificationsAsync() {
  if (!Device.isDevice) return null; // emulators don't work
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return null;
  const projectId = Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  // Save token to Supabase profiles table
  await supabase.from('profiles').update({ expo_push_token: token }).eq('id', userId);
  return token;
}

// Required: set foreground handler
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});
```

### 4. Database — store token
```sql
ALTER TABLE public.profiles ADD COLUMN expo_push_token text;
```

### 5. Supabase Edge Function (Deno)
```ts
// supabase/functions/push-notification/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

Deno.serve(async (req) => {
  const payload = await req.json() // webhook payload
  const { data } = await supabase
    .from('profiles')
    .select('expo_push_token')
    .eq('id', payload.record.receiver_id)
    .single()

  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${Deno.env.get('EXPO_ACCESS_TOKEN')}`,
    },
    body: JSON.stringify({
      to: data?.expo_push_token,
      sound: 'default',
      title: payload.record.sender_name,
      body: payload.record.content,
      data: { conversationId: payload.record.conversation_id },
    }),
  }).then(r => r.json())

  return new Response(JSON.stringify(res), {
    headers: { 'Content-Type': 'application/json' },
  })
})
```

### 6. Database Webhook (Supabase Dashboard)
- Table: `messages` (or wherever DMs are stored)
- Event: `INSERT`
- Function: the push Edge Function
- Headers: `Authorization: Bearer <service_role_key>`, `Content-Type: application/json`

### 7. iOS credentials (EAS handles this)
- EAS Build auto-manages APNs keys via `eas build`
- Run `eas credentials` to verify/regenerate if expired

### 8. Android FCM v1 credentials
- Create Firebase project → download `google-services.json` → place at project root
- Firebase Console → Project Settings → Service Accounts → Generate Private Key (JSON)
- Run `eas credentials` → Android → upload the service account JSON
- Add `google-services.json` path to `app.json` (commit it; it's public identifiers only)
- DO NOT commit the service account private key JSON

### 9. EAS Build
```bash
eas build --profile development --platform all  # dev build for testing
eas build --profile production --platform all   # for stores
```

### 10. Foreground suppression for active conversation
Use `setNotificationHandler` to suppress visual alert when user is in the conversation:
```ts
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const isInActiveConversation = /* check current screen/context */;
    return {
      shouldShowAlert: !isInActiveConversation,
      shouldPlaySound: !isInActiveConversation,
      shouldSetBadge: false,
    };
  },
});
```

## Gotchas
- SDK 54: No Expo Go support — must use dev builds
- Emulators/simulators don't support push tokens — physical device required
- `DeviceNotRegistered` error from Expo = user uninstalled app → remove their token from DB
- Push tokens are stable but change if `applicationId` changes
- iOS: fetching a push token can be slow (system-level)
- EAS credentials can expire — regenerate with `eas credentials`
- Rate limit: 600 notifications/second per project
- Expo Access Token must be set as Edge Function secret (`EXPO_ACCESS_TOKEN`)
- The `EXPO_ACCESS_TOKEN` is created at expo.dev → Account Settings → Access Tokens. Enable "Enhanced Security for Push Notifications" in Expo dashboard

## Sources
- https://docs.expo.dev/push-notifications/push-notifications-setup/
- https://supabase.com/docs/guides/functions/examples/push-notifications
- https://docs.expo.dev/push-notifications/faq/
- https://github.com/supabase/supabase/blob/master/examples/user-management/expo-push-notifications/supabase/functions/push/index.ts
- https://gist.github.com/Xansiety/5e8d264c5391b7e287705efbca70b80f

**Why:** Researched April 2026 for Swellyo DM push notifications feature.
**How to apply:** WhatsApp-style notifications for new direct messages. Trigger via Supabase Database Webhook on message INSERT. Suppress notification if recipient is already viewing that conversation.
