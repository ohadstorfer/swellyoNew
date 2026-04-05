# Push Notifications — To Do Before Testing

## Config / Setup
- [ ] Add `POST_NOTIFICATIONS` permission to `app.json` for Android 13+
- [ ] Make sure `EXPO_ACCESS_TOKEN` is set in Supabase Edge Function secrets (optional but improves delivery)
- [ ] Verify the Supabase Database Webhook is configured correctly in the dashboard (triggers `send-push-notification` on message insert)

## Build
- [ ] Create an EAS development build for Android (`eas build --profile development --platform android`)
- [ ] Create an EAS development build for iOS (`eas build --profile development --platform ios`)
- [ ] Install the build on a real device (push notifications don't work in Expo Go or simulators)

## Test Checklist
- [ ] Log in on the device, confirm no errors on token registration
- [ ] Send a DM from a second account — does the notification arrive?
- [ ] Tap the notification — does it open the right conversation?
- [ ] Open a conversation, send a DM to it from another account — notification should be silent
- [ ] Log out and send another DM — should NOT receive a notification
- [ ] Test with a blocked user — should NOT receive a notification

## Known Issues to Address Later
- [ ] Email + push both fire on every DM — need logic to skip email when push is active
- [ ] No user-facing settings to turn notifications on/off
- [ ] Email template still links to old domain (swellyomvp.netlify.app)
- [ ] Webhook config only lives in Supabase dashboard — not documented or saved in code
