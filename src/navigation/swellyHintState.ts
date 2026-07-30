import { useSyncExternalStore } from 'react';

/**
 * Whether the "Tap to get started" hint (handwritten label + curved arrow that
 * points at the floating Swelly avatar) should be shown on the Lineup tab.
 *
 * Same reasoning as `searchOverlayState`: the hint has to be anchored to the
 * Swelly avatar, which HomeTabsExtras renders in RootNavigator — outside
 * ConversationsScreen, the only place that knows the list is empty. A module
 * store keeps that out of MainNavContext, which would otherwise rebuild and
 * re-render all three tab roots whenever the conversation list empties or fills.
 */
let visible = false;
const listeners = new Set<() => void>();

export const setSwellyHintVisible = (value: boolean) => {
  if (visible === value) return;
  visible = value;
  listeners.forEach(l => l());
};

export const useSwellyHintVisible = (): boolean =>
  useSyncExternalStore(
    cb => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => visible
  );
