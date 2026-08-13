import { Platform } from 'react-native';

/**
 * Singular MMP (Mobile Measurement Partner) integration.
 *
 * WHY: Meta (and later TikTok) app-install ad campaigns need a measurement
 * partner to attribute installs to ad clicks and to receive post-install
 * conversion events (e.g. registration) so the ad networks can optimize
 * delivery. Singular is that partner. It:
 *   - attributes the install (IDFA/IDFV on iOS via ATT, GAID on Android),
 *   - forwards conversion events server-to-server to Meta / TikTok
 *     (those connectors are configured in the Singular dashboard, NOT here),
 *   - drives Apple SKAdNetwork (SKAN) conversion-value updates on iOS.
 *
 * This module is intentionally self-contained and fail-open: if the native
 * module is missing (web, Expo Go, or a build without the pod/gradle dep) or
 * the keys are absent, every function no-ops. It never throws into the app.
 *
 * The native `singular-react-native` module is loaded lazily via require() so
 * that importing this file on web / Expo Go does not crash on a missing
 * native module.
 */

const SDK_KEY = process.env.EXPO_PUBLIC_SINGULAR_SDK_KEY || '';
const SDK_SECRET = process.env.EXPO_PUBLIC_SINGULAR_SECRET || '';

// iOS ATT: how long Singular should hold the first session while we resolve the
// App Tracking Transparency prompt, so the IDFA (if granted) is attached to the
// very first session. Apple allows the prompt to be answered later; 300s is
// Singular's recommended ceiling.
const ATT_WAIT_SECONDS = 300;

let initialized = false;
let singularModule: any = null;

/** Lazy-load the native SDK. Returns null when unavailable (web / Expo Go). */
function getSingular(): any | null {
  if (Platform.OS === 'web') return null;
  if (singularModule) return singularModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    singularModule = require('singular-react-native');
  } catch {
    singularModule = null;
  }
  return singularModule;
}

/**
 * Initialize Singular exactly once, at app startup.
 *
 * On iOS this also requests App Tracking Transparency (ATT). We request ATT
 * BEFORE (or concurrently with) init and tell the SDK to wait for the ATT
 * result so the first session carries the correct tracking state. Whatever the
 * user chooses, we relay it to Singular via the advertiser-tracking / opt-in
 * APIs and enable SKAdNetwork so attribution still works when ATT is denied.
 */
export async function initSingular(): Promise<void> {
  if (initialized) return;

  const mod = getSingular();
  if (!mod) return; // web / Expo Go / dep not linked — no-op

  const { Singular, SingularConfig } = mod;
  if (!Singular || !SingularConfig) return;

  if (!SDK_KEY || !SDK_SECRET) {
    if (__DEV__) {
      console.warn(
        '[singular] Missing EXPO_PUBLIC_SINGULAR_SDK_KEY / EXPO_PUBLIC_SINGULAR_SECRET — skipping init.'
      );
    }
    return;
  }

  try {
    const config = new SingularConfig(SDK_KEY, SDK_SECRET);

    // --- iOS SKAdNetwork (SKAN) ---
    // Enable managed SKAN so Singular auto-registers the app for ad-network
    // attribution and manages the conversion-value model. Feature-detected
    // because the exact builder name has varied across SDK versions.
    if (Platform.OS === 'ios') {
      if (typeof config.withSkAdNetworkEnabled === 'function') {
        config.withSkAdNetworkEnabled(true);
      }
      // Ask the SDK to hold the first session until ATT is resolved (or timeout)
      // so a granted IDFA is attached to the install.
      if (typeof config.withWaitForTrackingAuthorizationWithTimeoutInterval === 'function') {
        config.withWaitForTrackingAuthorizationWithTimeoutInterval(ATT_WAIT_SECONDS);
      }
    }

    // Request ATT on iOS and relay the decision to Singular.
    if (Platform.OS === 'ios') {
      await requestAttAndRelay(Singular);
    }

    Singular.init(config);
    initialized = true;

    if (__DEV__) console.log('[singular] initialized');
  } catch (err) {
    if (__DEV__) console.warn('[singular] init failed:', err);
  }
}

/**
 * iOS only. Present the ATT prompt (via expo-tracking-transparency if present)
 * and tell Singular whether the advertiser can use the device identifier.
 *
 * Fail-open: if expo-tracking-transparency isn't installed we still relay a
 * sane default and let Singular's own ATT wait/SKAN path proceed.
 */
async function requestAttAndRelay(Singular: any): Promise<void> {
  let granted = false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const att = require('expo-tracking-transparency');
    if (att?.requestTrackingPermissionsAsync) {
      const { status } = await att.requestTrackingPermissionsAsync();
      granted = status === 'granted';
    }
  } catch {
    // expo-tracking-transparency not installed — Singular's SKAN + IDFV path
    // still works; leave `granted` false so we don't over-claim consent.
  }

  try {
    // Tell Singular whether IDFA-based advertiser tracking is allowed.
    // `trackingOptIn()` and `limitDataSharing(bool)` are the real SDK methods
    // (confirmed against singular-react-native@4.2.0 source). Feature-detected
    // so a future SDK rename can't crash the app.
    if (granted) {
      if (typeof Singular.trackingOptIn === 'function') Singular.trackingOptIn();
      if (typeof Singular.limitDataSharing === 'function') Singular.limitDataSharing(false);
    } else {
      // Denied/undetermined: keep SKAN working but don't share device-level data.
      if (typeof Singular.limitDataSharing === 'function') Singular.limitDataSharing(true);
    }
  } catch (err) {
    if (__DEV__) console.warn('[singular] ATT relay failed:', err);
  }
}

/**
 * Report a conversion event to Singular. Optionally pass structured args.
 * No-op until initSingular() has run and the native module is present.
 */
export function singularEvent(name: string, args?: Record<string, unknown>): void {
  if (!initialized) return;
  const mod = getSingular();
  if (!mod?.Singular) return;
  try {
    if (args && Object.keys(args).length > 0 && typeof mod.Singular.eventWithArgs === 'function') {
      mod.Singular.eventWithArgs(name, args);
    } else {
      mod.Singular.event(name);
    }
  } catch (err) {
    if (__DEV__) console.warn(`[singular] event(${name}) failed:`, err);
  }
}

/**
 * Resolve Singular's standard event constants from the SDK's `Events` export
 * when available, falling back to the documented literal string values. The
 * Meta connector (configured in the Singular dashboard) maps
 * `sng_complete_registration` -> Meta's `CompleteRegistration` standard event.
 */
function singularStd(constName: string, fallback: string): string {
  const mod = getSingular();
  const value = mod?.Events?.[constName];
  return typeof value === 'string' ? value : fallback;
}

/**
 * Map the app's internal one-shot analytics event names to the Singular /
 * ad-network standard event names Meta & TikTok optimize toward. Only the
 * events in this map are mirrored to Singular; everything else is ignored so
 * we never leak high-frequency internal telemetry to the ad networks.
 *
 * Resolved lazily (function values) so `Events` is read from the native module
 * only after it has loaded.
 */
const SINGULAR_EVENT_MAP: Record<string, () => string> = {
  // Primary registration signal Meta optimizes toward. This is the ONE event
  // mapped to CompleteRegistration — mapping user_signed_up here too would
  // double-count registrations in Meta.
  onboarding_finalized: () => singularStd('sngCompleteRegistration', 'sng_complete_registration'),
  // Earlier signup signal (surfers row created). Kept as a DISTINCT custom
  // event so it is visible in Singular without inflating registration counts.
  user_signed_up: () => 'user_signed_up',
  // Engagement signal. NOTE: first_message_sent is written by a DB trigger,
  // not the client, so this mapping only fires if a client call site is added
  // later (see report). Harmless until then.
  first_message_sent: () => singularStd('sngContentView', 'sng_content_view'),
};

/**
 * Called from the shared analytics logEvent() path. If the given internal
 * event maps to a Singular conversion event, mirror it. Safe to call for every
 * event — unmapped names are ignored.
 */
export function mirrorEventToSingular(eventName: string): void {
  const resolve = SINGULAR_EVENT_MAP[eventName];
  if (!resolve) return;
  singularEvent(resolve());
}
