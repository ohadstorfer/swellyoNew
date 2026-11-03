/**
 * Moments where asking for notification permission makes sense, because the
 * user just did something they will want to hear back about. The popup lives
 * in AppContent (useNotificationPermissionPrompt); anything else in the app
 * only says "this moment happened" through askForNotifications().
 *
 * Whether the popup actually shows (permission state, cooldowns, daily cap) is
 * decided by the hook, never by the caller — so it is safe to call this on
 * every occurrence.
 */
export type NotificationAskContext =
  /** The automatic ask a few seconds after reaching the main app. */
  | 'arrival'
  /** Sent a request to join a trip — the host's answer is coming. */
  | 'trip_request'
  /** A host approved their request — the trip chat is now theirs. */
  | 'trip_approved'
  /** Sent a chat message — a reply is coming. */
  | 'message_sent';

type Listener = (context: NotificationAskContext) => void;

let listener: Listener | null = null;

export function askForNotifications(context: Exclude<NotificationAskContext, 'arrival'>): void {
  // No listener means the main app is not mounted (onboarding, signed out):
  // dropping the ask is correct, there is nowhere to show it.
  listener?.(context);
}

/** One subscriber — the hook in AppContent. Returns the unsubscribe. */
export function subscribeToNotificationAsks(fn: Listener): () => void {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}
