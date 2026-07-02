// friendlyError — keeps raw technical error text (Postgres constraints, SQL,
// stack traces, edge-function internals) away from users' eyes.
//
// Services intentionally throw `new Error(supabaseError.message)` so logs and
// Sentry keep the real cause. The leak happens at the DISPLAY layer, where
// screens do `Alert.alert(title, e.message)`. Route every user-facing error
// popup through `showErrorAlert` (or `friendlyErrorMessage` for inline text)
// instead of passing `e.message` straight to Alert.
//
// Policy: hand-written, human-readable messages pass through untouched;
// anything that smells technical is replaced by the caller's fallback copy.
// Network failures get a dedicated, actionable message.

import { Alert } from 'react-native';

// Signals that a message is raw internals rather than copy written for users.
// Postgres/PostgREST, Supabase storage/auth, JS runtime errors, JSON dumps.
const TECHNICAL_PATTERNS: RegExp[] = [
  /violates .*constraint/i,
  /constraint "/i,
  /relation "/i,
  /column .* does not exist/i,
  /duplicate key/i,
  /syntax error/i,
  /permission denied/i,
  /row-level security/i,
  /invalid input syntax/i,
  /null value in column/i,
  /foreign key/i,
  /PGRST\d+/i,
  /JWT/,
  /JSON object requested/i,
  /(Type|Reference|Range)Error/,
  /undefined is not/i,
  /null is not an object/i,
  /cannot read propert/i,
  /is not a function/i,
  /unexpected token/i,
  /^\s*[[{]/, // JSON / object dump
  /https?:\/\//i, // internal URLs
  /\b(select|insert|update|delete)\b.*\b(from|into|set|where)\b/i, // SQL text
  /edge function returned/i,
  /non-2xx status code/i,
  /status code \d{3}/i,
];

const NETWORK_PATTERNS: RegExp[] = [
  /network request failed/i,
  /failed to fetch/i,
  /fetch failed/i,
  /timeout/i,
  /timed out/i,
  /socket/i,
  /ECONN/,
  /abort/i,
];

export const NETWORK_ERROR_MESSAGE =
  'Please check your internet connection and try again.';

const rawMessage = (e: unknown): string => {
  if (e == null) return '';
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message || '';
  const m = (e as { message?: unknown }).message;
  return typeof m === 'string' ? m : '';
};

export function isNetworkError(e: unknown): boolean {
  const msg = rawMessage(e);
  return NETWORK_PATTERNS.some(p => p.test(msg));
}

/**
 * Returns a message safe to show a user. Hand-written service messages
 * ("Failed to upload photo") pass through; raw internals are replaced by
 * `fallback`; network failures become an actionable connection message.
 */
export function friendlyErrorMessage(e: unknown, fallback: string): string {
  const msg = rawMessage(e).trim();
  if (!msg) return fallback;
  if (isNetworkError(e)) return NETWORK_ERROR_MESSAGE;
  // Long or multi-line text is never copy we wrote for users.
  if (msg.length > 140 || msg.includes('\n')) return fallback;
  if (TECHNICAL_PATTERNS.some(p => p.test(msg))) return fallback;
  return msg;
}

/**
 * Drop-in replacement for `Alert.alert(title, e?.message || fallback)`.
 * Same native popup, but the body is guaranteed user-readable.
 */
export function showErrorAlert(title: string, e: unknown, fallback: string): void {
  Alert.alert(title, friendlyErrorMessage(e, fallback));
}
