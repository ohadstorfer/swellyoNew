import { useSyncExternalStore } from 'react';

/**
 * Whether the global message-search overlay (Lineup tab) is open.
 *
 * Lives in a tiny module store because the consumer (HomeTabsExtras' floating
 * Swelly avatar, which must hide under the overlay) renders in RootNavigator,
 * outside ConversationsScreen — and threading this through MainNavContext
 * would rebuild the nav context (re-rendering all three tab roots) on every
 * search open/close.
 */
let open = false;
const listeners = new Set<() => void>();

export const setMessageSearchOpen = (value: boolean) => {
  if (open === value) return;
  open = value;
  listeners.forEach(l => l());
};

export const useMessageSearchOpen = (): boolean =>
  useSyncExternalStore(
    cb => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => open
  );
