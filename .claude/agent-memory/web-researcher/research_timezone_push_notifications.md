---
name: timezone-push-notifications
description: Timezone-aware local-time push notification scheduling — industry patterns, storage formats, scheduling architectures, quiet hours, STO, fallbacks
metadata:
  type: reference
---

## Topic
How large consumer apps implement timezone-aware push notifications (local daytime delivery, quiet hours 8am–9pm, deferred non-urgent pushes).

## Key conclusions

**Storage**: IANA string (e.g. `America/Sao_Paulo`) is universal consensus. Never UTC offset for recurring events — offsets are snapshots and break on DST. Store both: the IANA zone AND schedule in UTC (recalculate UTC from IANA at schedule time, not at event creation time).

**Scheduling pattern**: Two dominant patterns:
- (A) Hourly bucket: cron runs hourly, queries WHERE extract(hour from now() AT TIME ZONE user_tz) = target_hour. Handles DST automatically, no pre-computation. Used by OneSignal, rappasoft.com pattern, recommended by SuprSend.
- (C) Per-user `next_send_at` UTC precompute: compute send_after UTC per-user when enqueuing. Simple drain query (WHERE send_after <= now()). Pitfall: doesn't self-correct for DST or user travel — stale UTC stays wrong until recomputed. The current Swellyo design is this pattern.

For non-daily/recurring reminders (trip in 7 days, trip tomorrow) pattern C is fine because each reminder is enqueued once with a computed send_after. For daily nudges (daily quiet-hours gate) you need to compute send_after respecting the user's local 8am the next morning.

**Braze** "Local Time" = timezone bucket approach — processes users tz-by-tz over up to 48h window starting from earliest tz. Will not send to any user who missed their window by >1 hour (drops, doesn't defer). Requires campaign to be scheduled 24h in advance.

**OneSignal** "Optimize by User Time Zone" = sends at a particular hour in each user's local timezone, starts rolling 24h before target. "Intelligent Delivery" = per-user best-hour from 3-month engagement history (23% higher open rate vs immediate).

**Duolingo** = multi-armed bandit for message *content* selection. Architecture for high-volume burst (4M in 6 sec) = SQS + ECS autoscaling. Daily reminder timing: uses local-time targeting (no published deep dive found). Bandit paper focuses on what message, not when.

**Headspace** = uses Braze Intelligent Timing. Plans to build custom context-aware timing (send sleep content in evening, morning content in morning).

**MoEngage** = stores timezone as offset (+330, -330 etc) — the only major vendor found using offset, not IANA. Sequential sweep per-timezone.

**SuprSend** = stores IANA explicitly, defers messages to next window (does not drop), handles DST via IANA standard.

**Iterable** = quiet hours defer to next window (not drop). Example: message blocked at 8pm → sends at 9am next morning. Frequency cap period resets so the deferred message counts against the new day.

**Airship** = quiet time is device-side on iOS (push suppressed at OS level, not deferred by server). Android: push arrives silent. This is different from server-side quiet hours where the message is held.

**DST pitfalls**: 
- Cron itself (server-side UTC cron) is immune to DST if it runs every hour with a `WHERE extract(hour...)` check using IANA. 
- Pre-computed UTC timestamps go stale after DST transition — the stored UTC fires 1 hour off.
- Debian cron: fall-back = job may run twice; spring-forward = job may be skipped. Avoid scheduling non-hourly jobs in 1-3am window.
- IANA zones themselves change (country rule changes). Must keep tzdata updated on server.

**Quiet hours consensus**: 8am–9pm (or 9am–8pm) local is standard. Braze/Headspace use 8am-9pm window. TCPA for SMS = 8am–9pm. Non-urgent = defer to next window open. Transactional/urgent = bypass always. Industry note: "automated message blocked during quiet hours will be sent soon after that quiet hours window ends."

**STO (Send Time Optimization)**: Worth it only at scale with engagement history. Duolingo invests heavily (bandit); OneSignal sees 23% lift over immediate, 10% over tz-aware fixed hour. For small apps (hundreds–thousands users), fixed local hour + quiet hours is the 80/20 solution. STO requires 3+ months of engagement data to be meaningful.

**Fallback when tz unknown**: Industry order of preference: (1) device-reported IANA → (2) geolocation → (3) workspace/account default timezone → (4) UTC. Braze fallback = 5pm company timezone. Customer.io fallback = configured workspace timezone. Never silently use UTC as a delivery timezone (causes 3am sends).

**React Native timezone capture**: 
- `Intl.DateTimeFormat().resolvedOptions().timeZone` has a known bug in RN/Hermes where it returns a cached value and doesn't update after device tz change.
- `expo-localization`'s `getCalendars()[0].timeZone` is the recommended alternative. Returns IANA format. Re-read on AppState foreground resume. Can be null on web.
- Update the stored tz on the server on every app foreground event (or at minimum on login).

## Applies to Swellyo current design
Current design: event-triggered enqueue with `send_after = now()` (urgent) or `now() + 60s` (normal). No timezone awareness yet. When daily nudges (trip_reminder, uncommitted reminders) are added in Phase 2, they need quiet-hour enforcement.

Pattern C (precompute UTC per-user `send_after`) is the right architecture for Swellyo. It matches the existing queue drain pattern exactly. For daily nudges: enqueue with `send_after` = user's next 8am UTC (computed from their IANA tz). Recompute `send_after` if user's tz changes. DST is handled correctly as long as you recompute `send_after` from IANA (not from a stored offset) at enqueue time.

The hourly bucket (pattern A) adds operational complexity (needs a separate hourly cron and a `WHERE extract(hour from now() AT TIME ZONE user_tz) = 8` query) without benefit at low user counts. Pattern C with per-user precomputed `send_after` is simpler, uses the existing drain infrastructure, and handles DST correctly if enqueue logic uses IANA → UTC conversion.

## Sources
- Braze Scheduled Delivery docs: https://www.braze.com/docs/user_guide/engagement_tools/campaigns/building_campaigns/delivery_types/scheduled_delivery
- Braze Intelligent Timing: https://www.braze.com/docs/user_guide/brazeai/intelligence_suite/intelligent_timing
- OneSignal Timezone Delivery: https://onesignal.com/blog/deliver-by-timezone-push-notification/
- OneSignal Intelligent Delivery: https://onesignal.com/intelligent-delivery
- Customer.io timezone: https://docs.customer.io/journeys/timezone-match/
- SuprSend Time Window: https://docs.suprsend.com/docs/time-window
- Iterable Frequency Management: https://support.iterable.com/hc/en-us/articles/15342990564372-Frequency-Management
- Duolingo bandit: https://blog.duolingo.com/hi-its-duo-the-ai-behind-the-meme/
- Headspace engineering: https://medium.com/headspace-engineering/explainable-and-accessible-ai-using-push-notifications-to-broaden-the-reach-of-ml-at-headspace-a03c7c2bbf06
- MoEngage tz delivery: https://help.moengage.com/hc/en-us/articles/213902323-Send-campaign-in-recipient-s-time-zone
- Laravel hourly pattern: https://rappasoft.com/blog/sending-laravel-notifications-at-the-right-local-hour-using-timezones-a-command-and-cron
- IANA vs Offset: https://dev.to/kulikboxx/iana-vs-offset-based-time-zones-what-every-developer-should-know-53ih
- DST + cron: https://blog.healthchecks.io/2021/10/how-debian-cron-handles-dst-transitions/
- Insider timezone mgmt: https://medium.com/insiderengineering/how-should-we-manage-time-zones-f62d4c49c3ad
- RN Intl tz bug: https://github.com/facebook/react-native/issues/17958
