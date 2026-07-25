/**
 * A drop-in `fetch` for the Supabase client that adds a time limit.
 *
 * WHY (2026-07-23 incident, corrected 2026-07-24): React Native's fetch has
 * NO default timeout and supabase-js adds none, so on bad signal a request
 * can wait forever — stranding anything awaiting it (a fresh user got a blank
 * profile and an inert Trips tab). auth-js 2.110.7 also routes every call
 * through a shared init promise + single-flight token refresh, so ONE stuck
 * request can stall unrelated calls app-wide. (An earlier version of this note
 * blamed an auth-js "lock"; that lock is disabled by default in 2.110.7 — the
 * init/refresh promises are the real app-wide choke points.) A time limit
 * turns "stuck forever" into a normal error: catch/finally run, app recovers.
 */
import * as Sentry from '@sentry/react-native';

export const DEFAULT_TIMEOUT_MS = 25_000;
// Big file transfers get 5 minutes so slow uploads aren't killed mid-flight.
export const STORAGE_TIMEOUT_MS = 300_000;

const REPORT_THROTTLE_MS = 60_000;
let lastReportAt = 0;

export function __resetReportThrottleForTests() {
  lastReportAt = 0;
}

export function timeoutForUrl(url: string): number {
  return url.includes('/storage/v1/') ? STORAGE_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return (input as Request).url ?? String(input);
}

function reportTimeout(url: string, ms: number) {
  const now = Date.now();
  if (now - lastReportAt < REPORT_THROTTLE_MS) return;
  lastReportAt = now;
  try {
    // Query strings can carry tokens — report the path only.
    Sentry.captureMessage(
      `[supabase-timeout] ${url.split('?')[0]} did not answer within ${ms}ms`,
      'warning',
    );
  } catch {
    // Sentry is dead in Expo Go / may throw — never break the request for it.
  }
}

export const supabaseFetchWithTimeout = async (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> => {
  const url = urlOf(input);
  const ms = timeoutForUrl(url);

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ms);

  // If the caller passed its own signal, mirror its abort into ours.
  const callerSignal = init?.signal;
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener('abort', () => controller.abort());
  }

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) {
      reportTimeout(url, ms);
      throw new Error(`Request timed out after ${ms}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};
