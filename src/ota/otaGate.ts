/**
 * OTA gate — makes some launches wait for the newest over-the-air update.
 *
 * Why: expo-updates (CHECK_ON_LAUNCH=ALWAYS, LAUNCH_WAIT_MS=0 in our native
 * config) always launches the code it already has and downloads a new OTA in
 * the background for the NEXT cold start. So:
 *   - a fresh install runs the store build's embedded JS, which can be weeks old;
 *   - an urgent fix takes two launches to reach people.
 *
 * What people see: a normal launch whose loading video stays up longer.
 * AppContent keeps WelcomeScreen in its loading state while the session
 * restores OR while this gate is not 'idle'; WelcomeScreen adds "Updating…"
 * while an update downloads. Then reloadAsync() restarts JS; the native reload
 * screen is a still of the loading screen's first frame
 * (assets/ota/reload-screen.jpg) and the new WelcomeScreen restarts the video
 * from that same frame.
 *
 * When a launch waits ("wait mode"):
 *   - it runs the store build's embedded JS (`Updates.isEmbeddedLaunch`): a
 *     fresh install, or the first launch after a store update. Decided
 *     synchronously, so every other launch is never held at all;
 *   - or `app_config.ota_critical` (read in the background, 3 s cap) is higher
 *     than CRITICAL_INDEX.
 *
 * How it waits: it FOLLOWS the native updater instead of asking it. With
 * CHECK_ON_LAUNCH=ALWAYS, native already checks and downloads at launch, and
 * any JS checkForUpdateAsync() call is queued behind that whole startup
 * procedure (download included) — so asking would only return once the
 * download is over. Instead we read `Updates.latestContext` and listen to
 * state changes:
 *   - downloading → 'waiting' ("Updating…");
 *   - update downloaded (isUpdatePending) → reload into it;
 *   - native done and found nothing → 'idle';
 *   - native done with an error or without having checked → one explicit
 *     check + fetch of our own.
 * Caps: nothing downloading within 8 s → give up; 25 s in total → give up.
 * Giving up means 'idle' on the current code; a download in flight still
 * lands on the next launch.
 *
 * JS only, no native changes, runtime version untouched.
 * Disabled in __DEV__, on web and wherever expo-updates is off (Expo Go).
 */
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import * as Updates from 'expo-updates';
import { CRITICAL_INDEX } from './criticalIndex';

/** 'checking' / 'waiting' hold the loading video; 'waiting' also shows "Updating…". */
export type OtaGatePhase = 'idle' | 'checking' | 'waiting';

const REMOTE_KEY = 'ota_critical';

/** No download started within this → nothing worth waiting for. */
const START_CAP_MS = 8_000;
/** Whole wait, download included. */
const WAIT_CAP_MS = 25_000;
const REMOTE_CAP_MS = 3_000;

const ENABLED =
  !__DEV__ && Platform.OS !== 'web' && Updates.isEnabled === true;

// An embedded launch that is NOT an emergency one. An emergency launch means
// expo-updates fell back to the embedded JS because a downloaded update kept
// crashing: never wait for (or reload into) updates then.
const EMBEDDED_WAIT = ENABLED && Updates.isEmbeddedLaunch && !Updates.isEmergencyLaunch;

// Decided synchronously: only an embedded launch starts out held.
let phase: OtaGatePhase = EMBEDDED_WAIT ? 'checking' : 'idle';
const listeners = new Set<() => void>();
let started = false;

function setPhase(next: OtaGatePhase) {
  if (next === phase) return;
  phase = next;
  listeners.forEach(l => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => phase;

/** Current phase, outside React (tests, logging). */
export const getOtaGatePhase = (): OtaGatePhase => phase;

export function useOtaGatePhase(): OtaGatePhase {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * What native shows while JS restarts after reloadAsync(): a still of the
 * loading screen's first frame (video frame 0 + gradient + logo + tagline,
 * drawn at 393×852 pt @3x with WelcomeScreen's geometry). It hides when the
 * new JS draws its first content — WelcomeScreen, whose video poster is the
 * same frame 0 — so it reads as the video pausing for a moment.
 * If WelcomeScreen's loading layout or the background video changes,
 * regenerate both images in assets/ota/ (see docs/OTA_CRITICAL_UPDATES.md).
 * Supported by the native EXUpdates 29.0.17 already in the store builds.
 */
const RELOAD_SCREEN: Updates.ReloadScreenOptions = {
  backgroundColor: '#000000',
  image: require('../../assets/ota/reload-screen.jpg'),
  imageResizeMode: 'cover',
  imageFullScreen: true,
  fade: true,
  spinner: { enabled: false },
};

/**
 * Follows the native updater until an update is downloaded (→ reload), or
 * there is nothing to wait for / a cap passes (→ 'idle'). See the header.
 */
function waitForUpdate(): void {
  let settled = false;
  let ownCheck = false;
  let sawDownload = false;

  const cleanup = () => {
    settled = true;
    clearTimeout(startTimer);
    clearTimeout(waitTimer);
    sub.remove();
  };
  const giveUp = () => {
    if (settled) return;
    cleanup();
    setPhase('idle');
  };
  const reload = () => {
    if (settled) return;
    cleanup();
    Updates.reloadAsync({ reloadScreenOptions: RELOAD_SCREEN }).catch(() => setPhase('idle'));
  };

  const runOwnCheck = async () => {
    try {
      const res = await Updates.checkForUpdateAsync();
      if (settled) return;
      if (!res.isAvailable) {
        giveUp();
        return;
      }
      sawDownload = true;
      setPhase('waiting');
      await Updates.fetchUpdateAsync();
      reload(); // also reached through the isUpdatePending event; reload() runs once
    } catch {
      giveUp();
    }
  };

  const evaluate = (ctx: Updates.UpdatesNativeStateMachineContext) => {
    if (settled) return;
    if (ctx.isUpdatePending) {
      reload();
      return;
    }
    if (ctx.isDownloading) {
      sawDownload = true;
      setPhase('waiting');
    }
    if (ownCheck || ctx.isStartupProcedureRunning || ctx.isChecking || ctx.isDownloading) return;
    // Native is idle and nothing is downloaded.
    if (ctx.lastCheckForUpdateTime && !ctx.checkError && !ctx.downloadError && !ctx.isUpdateAvailable) {
      giveUp(); // native checked this session and found nothing newer
      return;
    }
    // Native errored, or never checked: one check + fetch of our own.
    ownCheck = true;
    void runOwnCheck();
  };

  const startTimer = setTimeout(() => {
    if (!sawDownload) giveUp();
  }, START_CAP_MS);
  const waitTimer = setTimeout(giveUp, WAIT_CAP_MS);
  const sub = Updates.addUpdatesStateChangeListener(e => evaluate(e.context));
  evaluate(Updates.latestContext);
}

/**
 * Reads app_config.ota_critical with a plain REST call (anon key, 3 s cap).
 * Plain fetch on purpose: the supabase-js client can wait on auth session
 * restore at boot, and this must never hang on that. Any failure → 0.
 */
async function readRemoteCritical(): Promise<number> {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return 0;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REMOTE_CAP_MS);
  try {
    const res = await fetch(
      `${url}/rest/v1/app_config?key=eq.${REMOTE_KEY}&select=value`,
      {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        signal: controller.signal,
      },
    );
    if (!res.ok) return 0;
    const rows = (await res.json()) as Array<{ value: unknown }>;
    const n = Number(rows?.[0]?.value);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  } finally {
    clearTimeout(timer);
  }
}

/** Call once at module load (top of App.tsx). Safe to call again (no-op). */
export function startOtaGate() {
  if (started || !ENABLED || Updates.isEmergencyLaunch) return;
  started = true;
  if (EMBEDDED_WAIT) {
    waitForUpdate();
    return;
  }
  void readRemoteCritical()
    .then(remote => {
      if (remote <= CRITICAL_INDEX) return;
      // Hold the loading video from here (or bring it back if the session was
      // already restored), then follow the download.
      setPhase('checking');
      waitForUpdate();
    })
    .catch(() => setPhase('idle'));
}
