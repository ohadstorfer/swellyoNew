---
name: research-alarm-capabilities-ios-android
description: Real alarm capabilities (loud, breaks silent/DND) on iOS AlarmKit/critical alerts and Android AlarmManager in 2026, for a pill-reminder app; Expo/RN module support
metadata:
  type: project
---

## Context
Researched for a solo dev converting a pill-reminder PWA to native (Expo/RN, dev builds acceptable).
Target UX: window 10pm-1am, alarm every 30 min (~7 alarms) until user taps "took the pill" in-app,
then cancel all remaining alarms.

## CORRECTION (verified against primary sources, July 2026)

**The original claim that "AlarmKit requires a special Apple-granted entitlement you must apply for
(like Critical Alerts)" was WRONG.** This was traced to a hallucinated entitlement string
(`com.apple.developer.alarmkit`) that does not exist — confirmed directly by an **Apple engineer on the
Apple Developer Forums**: "We are seeing an increase in LLMs making up non-existent entitlements causing
similar problems... LLMs don't seem to understand the difference between declared entitlements, special
entitlements that you need to apply for, and Info.plist entries." A developer had added the fake
`com.apple.developer.alarmkit` key to their entitlements.plist (itself LLM-suggested), got a provisioning
error, and removing it fixed the build.
(source: https://developer.apple.com/forums/thread/797950)

The same fabricated claim ("AlarmKit requires a special entitlement... apply through the Apple Developer
portal... Apple reviews these requests") appears verbatim across several "developer blog" sites
(bleepingswift.com, svpdigitalstudio.com) — near-identical phrasing across unrelated sites is itself a
signal this is copied/AI-generated SEO content propagating one error, not independently verified fact.

**Verified truth, from the actual WWDC25 session transcript ("Wake up to the AlarmKit API") and from real
shipped apps:**
- AlarmKit authorization = **`NSAlarmKitUsageDescription` in Info.plist + runtime `AlarmManager.requestAuthorization()`** — same self-service pattern as requesting notification/camera/location permission. Direct quote from the session: *"Setting up authorization is simple, you just need to add NSAlarmKitUsageDescription to your app's info plist explaining the use case for presenting alarms... To request authorization manually, you can use the AlarmManager requestAuthorization API."*
- **No managed/Apple-approved entitlement exists for AlarmKit.** No application process, no approval criteria, no rejection stories were found because there is nothing to apply for.
- Confirmed by production evidence: **AlarmK – Mission Alarm** (App Store id6772219821) ships today using
  AlarmKit, App Store description literally says "Powered by iOS 26 AlarmKit so it rings through Silent and
  Focus." **Alarmy** and **ToDo Alarm** have also shipped AlarmKit features. None of these required a special
  entitlement grant — they just ship, same as any other capability, subject to normal App Review.
- This is unlike Critical Alerts, Push-to-Talk, or the Network Extension "app push provider" entitlement,
  which genuinely ARE Apple-managed/reviewed entitlements (confirmed via a separate, real forum thread about
  Network Extension: DTS engineer explicitly describes a 3-tier model — unrestricted / restricted
  (self-service, any paid dev account) / **managed (Apple pre-approval required)**. AlarmKit is not in the
  managed tier.

**Confidence: high.** Based on the actual WWDC transcript, a direct Apple-engineer forum statement, and
three named apps shipping in production without any entitlement-approval step.

## iOS

**CAN DO (iOS 26+, via AlarmKit):**
- Real alarms that break through silent mode/mute switch AND Focus/DND — same system-level permission as
  the Clock app (full-screen alert, Lock Screen UI, Dynamic Island). Confirmed by MacRumors and multiple
  WWDC25 recap sources.
- Countdown alarms (preAlert/postAlert duration) and relative/weekly-recurring schedules.
- Custom action buttons on the alarm alert itself — `AlarmPresentation.Alert` supports a `stopButton` and a
  `secondaryButton` with behavior `.snooze` or `.custom` (custom runs an App Intent, e.g. "Took it").
- Programmatic cancellation: `AlarmManager.shared.stop(id:)` — app can only manage alarms it created.
- Permission model: `NSAlarmKitUsageDescription` in Info.plist + `alarmManager.requestAuthorization()`
  (same UX pattern as normal notification permission, NOT the heavy critical-alerts vetting).

**CAVEATS / open risk:**
- ~~AlarmKit requires a special Apple-approved entitlement~~ — **CORRECTED, this was false**, see the
  correction section above. No entitlement application process exists; only Info.plist + runtime permission.
- **iOS 26+ only.** No AlarmKit on iOS 25 and earlier. As of Apple's own official adoption numbers: **66% of
  all iPhones** on iOS 26 by mid-Feb 2026, rising to **79% of all iPhones** (86% of iPhones from the last 4
  years) by June 2026 (source: MacRumors/Apple App Store data, macdailynews.com, 9to5mac.com,
  appleinsider.com). This is a real but shrinking fragmentation cost — roughly 1 in 5 iPhone users still
  won't get the loud/silent-mode-breaking behavior without the fallback path.
- **Reliability track record is young.** A confirmed regression bug (Apple Developer Forums thread #809398,
  FB21273655): alarms scheduled with AlarmKit silently failed to ring after upgrading from iOS 26.1 to an
  iOS 26.2 beta (beta 3/RC cycle, question of whether fully resolved by GA — no official Apple confirmation
  in the thread, evidence suggests it self-resolved by the 26.2 RC). Also documented: AlarmKit "expects a
  widget extension if an app supports a countdown presentation, otherwise the system may unexpectedly
  dismiss alarms and fail to alert" (Jeremy Wenzel, Medium) — an extra implementation requirement, not just
  a simple API call. A real AlarmK app-store review (July 2026) also reported the app not appearing in the
  Focus-mode allow-list, which blocked the silent-mode-breakthrough feature until user reconfigured Focus
  settings manually — a real-world rollout gotcha, not a fundamental bug, but relevant UX/support-burden to plan for.
- No single "repeat every 30 min until dismissed" primitive — the practical pattern (confirmed across
  multiple code walkthroughs) is scheduling N discrete alarms (10:00, 10:30...1:00) and calling `.stop(id:)`
  on each remaining one when the user taps "took it." This works fine, just means storing all 7 alarm IDs.
- Docs/blogs did not surface any hard cap on concurrent AlarmKit alarms (unlike the 64-notification limit
  below) — no source confirms or denies a limit; 7 is trivially small either way.

**Fallback path (pre-iOS 26 or if AlarmKit entitlement is rejected/delayed): local notifications**
- `interruptionLevel: 'critical'` bypasses the mute switch and DND, but requires the **Critical Alerts
  entitlement**, which Apple hand-reviews per request. Only approved for genuine health/safety/security
  use cases where a normal or time-sensitive notification is provably insufficient — a medication-adherence
  app is a plausible candidate, but approval is not guaranteed and Apple frequently asks for stronger
  justification (days to weeks turnaround, per Newly.app and dev forum reports).
- `interruptionLevel: 'timeSensitive'` breaks through Focus/notification summary but does **NOT** bypass the
  mute switch/silent mode — insufficient for a "loud alarm" requirement on its own.
- iOS caps an app at **64 pending local notifications** — device keeps only the 64 that were scheduled most
  recently (confirmed via flutter_local_notifications and cordova-plugin issue threads referencing Apple's
  behavior). 7 alarms is far under this, not a practical constraint for this feature alone, but stacks if
  other reminders also use local notifications.
- Local notification custom sounds are capped at ~30 seconds duration unless using the critical-alert /
  `FLAG_INSISTENT`-equivalent path — default local notification sounds get truncated.
- Action buttons (`UNNotificationAction`) work on plain local notifications too — a "Took the pill" button
  can run in the background (no app launch) via `UNNotificationActionOptions` without the foreground option.
- Scheduled local notifications DO still fire after the app is force-quit/swiped away (OS-level scheduling,
  not app-dependent) — this is standard, confirmed behavior, not iOS-26-specific.

## Android

**CAN DO:**
- `AlarmManager.setExactAndAllowWhileIdle()` or `setAlarmClock()` fire at (near-)exact times even in Doze
  mode. `setAlarmClock()` is the strongest guarantee — system treats it like a real alarm clock, exits
  low-power modes to deliver it, and never lets the OS adjust its time. This is the correct primitive for
  "loud alarm at 10:00, 10:30, ... 1:00."
- A notification/alarm sound played on the `AudioAttributes.USAGE_ALARM` stream plays through the dedicated
  Alarm volume slider, independent of Ringer/notification volume and independent of Do Not Disturb (DND) —
  this is the mechanism that makes Android alarm apps loud even in silent mode. `NotificationChannel` also
  has `setBypassDnd(true)` (requires the user-granted `ACCESS_NOTIFICATION_POLICY`/"Do Not Disturb access"),
  and `NotificationCompat.CATEGORY_ALARM` is treated specially by DND policy.
- Full-screen intent (lock-screen takeover UI, exactly like an alarm clock ringing) is available to alarm
  apps by default. As of Android 14, Google Play auto-grants `USE_FULL_SCREEN_INTENT` **only to apps
  declared as having calling or alarm core functionality** (self-declared in Play Console, effective policy
  date Jan 22 2025). A pill-reminder-with-alarm app should qualify by declaring "alarm" functionality; if
  Play disagrees, the app must send users to Settings to grant it manually (`ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT`).
- Custom action buttons on a notification ("Took the pill") work normally and can run a broadcast receiver
  in the background without opening the app.
- Cancelling: call `AlarmManager.cancel(pendingIntent)` for each of the 7 alarms' PendingIntents (must be
  built with identical request codes/extras to the ones used to schedule) — trivial to loop over on "took it" tap.

**Permissions (version-gated, this is the trickiest part):**
- `SCHEDULE_EXACT_ALARM` is required for `setExact()`, `setExactAndAllowWhileIdle()`, and `setAlarmClock()`.
  On Android 13+ this is **no longer pre-granted** to most newly-installed apps — must be requested and the
  user must flip it on in system settings (special app access), or the app must direct the user there via
  `ACTION_REQUEST_SCHEDULE_EXACT_ALARM`.
- `USE_EXACT_ALARM` is a normal, install-time-granted permission but Google restricts it to apps whose *core
  function* is alarms/calendar-like scheduling — Play Store review enforces this; a general medication app
  bundling alarms as one feature likely doesn't qualify and should plan on `SCHEDULE_EXACT_ALARM` (user-granted) instead.

**CAVEATS:**
- **BOOT_COMPLETED re-registration required.** All `AlarmManager` alarms are wiped on device reboot. The
  standard pattern: declare a boot receiver `android:enabled="false"` in the manifest, flip it on
  programmatically (`setComponentEnabledSetting(... COMPONENT_ENABLED_STATE_ENABLED ...)`) whenever at least
  one alarm is pending, and use it to re-schedule all alarms after boot. Must remember to disable it again
  once no alarms are pending (battery/Play Store hygiene).
- **User "Force Stop" from Settings cancels all alarms and notifications** for that app — full kill. This is
  different from **swiping the app away from Recents**, which on stock Android generally does NOT cancel
  AlarmManager alarms (they're OS-scheduled, independent of the process), but several OEM skins (Xiaomi/MIUI,
  Huawei, some Samsung configs) aggressively kill + block background restart on swipe-away, which can in
  practice break alarm delivery on those devices. This is a known long-tail Android fragmentation problem
  (dontkillmyapp.com class of issues) — worth testing on a Xiaomi/Huawei device if targeting those markets.
- No official Android equivalent of iOS's 64-notification cap was found for `AlarmManager` alarms — 7 is a
  non-issue regardless.

**What's NOT possible on Android:**
- `Intent(AlarmClock.ACTION_SET_ALARM)` (with `EXTRA_SKIP_UI=true`) can silently insert an alarm into
  whatever the user's default Clock app is, using permission `com.android.alarm.permission.SET_ALARM`. BUT:
  (1) it hands control to the Clock app — no API exists to query, modify, or **cancel** an alarm your app
  created this way once it's set (there is no "list installed clock alarms" or "remove clock alarm" public
  API), so the "cancel all remaining alarms on tap" requirement is **not achievable** through this path; (2)
  it can visually foreground/switch to the Clock app depending on OEM; (3) there's no guaranteed custom
  action button ("took the pill") on a stock Clock-app alarm. **This path should not be used for this
  feature** — use `AlarmManager` + your own full-screen alarm UI instead, which supports full cancellation
  and custom actions.
- iOS has no equivalent intent at all — no way to inject an alarm into the system Clock app from a
  third-party iOS app, silently or otherwise.

## Scenario feasibility verdict

| Requirement | iOS (AlarmKit, 26+) | iOS (fallback, notifications) | Android (AlarmManager) |
|---|---|---|---|
| Loud, breaks silent/DND | Yes | Only with rejection-risk critical-alerts entitlement | Yes (USAGE_ALARM stream + full-screen intent) |
| ~7 alarms in a window | Yes (7 separate scheduled alarms) | Yes (well under 64 cap) | Yes (no known cap) |
| Cancel all on one tap | Yes (`stop(id:)` × 7) | Yes (`cancelScheduledNotificationAsync` × 7) | Yes (`cancel(pendingIntent)` × 7) |
| Action button on the alert itself | Yes (custom secondary button) | Yes (`UNNotificationAction`) | Yes (notification action) |
| Survives app force-quit | Yes (OS-scheduled) | Yes (OS-scheduled) | Mostly yes; OEM-dependent on Recents-swipe; explicit Force Stop kills it |
| Survives device reboot | Yes (OS persists AlarmKit state) — not explicitly confirmed in sources, treat as needing verification | Yes | No — requires app's own BOOT_COMPLETED re-registration |
| Fully shippable today without any Apple approval gate | **Yes** — corrected: no entitlement application needed for AlarmKit itself, only standard App Review (critical-alerts fallback path is the one that needs Apple approval) | — | Yes — Android permissions are user-grantable, no Google approval-per-app step for SCHEDULE_EXACT_ALARM (Play Console policy questionnaire only for full-screen-intent + USE_EXACT_ALARM) |

## App Store Review angle (Guideline 5.1.3 / medical classification)
- A simple pill-reminder-with-alarm app (schedule + local "took it" logging, no diagnosis/dosage calculation)
  does **not** clearly trigger the stricter medical-device review path. Guideline 5.1.3 concerns are about
  HealthKit/Clinical Health Records/Motion&Fitness data being used for advertising/marketing or non-health
  purposes, and about apps that function as medical devices needing regulatory clearance documentation.
- Risk trigger to avoid: **drug-dosage calculation** features specifically require the calculation to come
  from an approved source (manufacturer, hospital, university, FDA-cleared, etc.) — a pill reminder that
  only reminds/logs (no calculating doses) sits outside this requirement.
- If HealthKit is used to store medication data, Guideline 5.1.3 restricts using that data for ads/marketing
  and requires it not be dumped into iCloud as personal health info — a data-handling constraint, not a
  submission blocker.
- Bottom line: a pill-reminder-with-alarm app is standard "Health & Fitness" category, normal App Review, no
  special medical-device clearance needed unless it starts making dosage/diagnostic claims.
  (source: https://developer.apple.com/app-store/review/guidelines/)

## Recommended technical approach for the Expo app
- **Android:** Skip `expo-notifications` for this feature — it has no full-screen intent support and only
  basic `SCHEDULE_EXACT_ALARM` manifest permission handling. Use **Notifee** (free, actively maintained,
  the only RN lib with full-screen intent + AlarmManager-backed exact triggers + Android channel
  `bypassDnd`/alarm category support). Requires an Expo dev build (config plugin), which the project already uses.
- **iOS:** No mature, actively-maintained Expo/RN wrapper for AlarmKit was found as of this research (the
  ecosystem is still catching up to a fall-2025 API) — likely means writing a **thin native Swift module**
  wrapped as an Expo config plugin/dev-build module, exposing `schedule`/`stop`/authorization to JS. This is
  a real scoping cost (native Swift work + possibly a widget extension for countdown presentation, per the
  Wenzel gotcha above) but **not an Apple-approval scoping cost** — that part of the original research was
  wrong. Still plan a `timeSensitive` `expo-notifications` fallback for the ~1-in-5 users still on iOS <26;
  be upfront that on iOS <26, alarms won't break through hardware silent mode without the separately-gated
  Critical Alerts entitlement (which genuinely IS Apple-approved and uncertain).
- Do not use `expo-alarm-module`/`expo-alarm` npm packages found — they wrap Android's `ACTION_SET_ALARM`
  Clock-app intent, which (per above) cannot be cancelled programmatically and doesn't fit this feature.
- Persist the 7 alarm IDs (per platform) in local storage; on BOOT_COMPLETED (Android) and app cold start,
  re-derive/re-schedule any still-pending ones for today's window.

## Sources
- https://developer.apple.com/forums/thread/797950 (Apple engineer confirms com.apple.developer.alarmkit entitlement is an LLM hallucination, does not exist)
- https://developer.apple.com/forums/thread/735356 (real managed-entitlement example for contrast: Network Extension app-push-provider)
- https://developer.apple.com/forums/thread/809398 (AlarmKit iOS 26.1→26.2 beta alarm-silently-fails regression, FB21273655)
- https://medium.com/@wenzeljeremy/alertsounds-with-ios-simulators-88ee41871c44 (widget-extension requirement gotcha for countdown presentation)
- https://apps.apple.com/us/app/alarmk-mission-alarm/id6772219821 (shipped production app using AlarmKit, "Powered by iOS 26 AlarmKit so it rings through Silent and Focus", iOS 26.0+ required, user review re: Focus allow-list)
- https://www.macrumors.com/2026/02/13/apple-shares-ios-26-adoption-stats/ (66% of iPhones on iOS 26, Feb 2026)
- https://www.macrumors.com/2026/06/09/ios-26-adoption-stats-wwdc/ (79% of iPhones / 86% of last-4-years iPhones on iOS 26, June 2026)
- https://macdailynews.com/2026/02/13/74-percent-of-apple-iphones-introduced-in-the-last-four-years-are-running-ios-26/
- https://developer.apple.com/app-store/review/guidelines/ (Guideline 5.1.3 health data / medical device review)
- https://developer.apple.com/documentation/AlarmKit
- https://developer.apple.com/documentation/AlarmKit/scheduling-an-alarm-with-alarmkit
- https://wwdcnotes.com/documentation/wwdcnotes/wwdc25-230-wake-up-to-the-alarmkit-api/
- https://dev.to/arshtechpro/wwdc-2025-wake-up-to-the-alarmkit-api-ios-26-4e67
- https://www.svpdigitalstudio.com/blog/how-to-use-alarmkit-api-in-swift-ios-schedule-alarms-natively
- https://bleepingswift.com/blog/scheduling-alarms-with-alarmkit
- https://github.com/jacobsapps/ADHDAlarms
- https://medium.com/@manavmanuprakash/scheduling-alarms-in-ios-apps-with-alarmkit-a-complete-guide-88b727f1c523
- https://www.macrumors.com/2025/06/11/ios-26-third-party-alarm-apps/
- https://todo-alarm.com/blog/ios-26-alarmkit-apps/
- https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.usernotifications.critical-alerts
- https://newly.app/articles/critical-alerts-entitlement
- https://developer.android.com/about/versions/14/changes/schedule-exact-alarms
- https://developer.android.com/develop/background-work/services/alarms
- https://source.android.com/docs/core/permissions/fsi-limits
- https://support.google.com/googleplay/android-developer/answer/13392821
- https://developer.android.com/reference/android/provider/AlarmClock
- https://medium.com/@surendar1006/implementing-critical-alerts-on-android-aa49b4d75705
- https://notifee.app/react-native/reference/androidchannel/
- https://notifee.app/react-native/docs/triggers/
- https://www.pkgpulse.com/guides/notifee-vs-expo-notifications-vs-onesignal-react-native-2026
- https://docs.expo.dev/versions/latest/sdk/notifications/
- https://github.com/alperengozum/expo-alarm
- https://www.npmjs.com/package/expo-alarm-module
