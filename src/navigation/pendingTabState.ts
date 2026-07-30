import { useSyncExternalStore } from 'react';
import type { NavKey } from '../components/trips/TripsBottomNav';

/**
 * The tab the user just tapped, before React Navigation's state has caught up.
 *
 * `@bottom-tabs` emits `tabPress` from the native `onIndexChange` and only then
 * dispatches the navigate action, so a listener here runs a full state update +
 * selector recompute earlier than `useNavigationState`. That matters for the
 * floating Swelly avatar: reading only the nav state left it painted on top of
 * the Trips tab for the whole cross-fade, because its unmount render queued
 * behind the incoming tab's (heavy) mount work.
 *
 * Consumers should prefer this over the nav state while it is set, and clear it
 * once the nav state agrees — programmatic switches (deep links, overlays) never
 * go through `tabPress`, so the nav state has to stay the fallback.
 */
let pending: NavKey | null = null;
const listeners = new Set<() => void>();

export const setPendingTab = (value: NavKey | null) => {
  if (pending === value) return;
  pending = value;
  listeners.forEach(l => l());
};

export const usePendingTab = (): NavKey | null =>
  useSyncExternalStore(
    cb => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => pending
  );
