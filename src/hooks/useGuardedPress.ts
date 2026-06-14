import { useCallback, useRef } from 'react';

/**
 * Wraps a press handler so accidental repeat taps can't fire it multiple times.
 *
 * Two protections in one:
 *  - Leading-edge throttle: the first tap runs immediately; repeats within
 *    `gapMs` are dropped (covers double-taps AND taps that queue during a
 *    JS-thread stall and all fire at once when it unblocks).
 *  - In-flight lock: if the handler returns a Promise, further taps are ignored
 *    until it settles — so a slow network action (open chat, join trip, approve)
 *    can never be fired twice.
 *
 * Use on any button that navigates or hits the network:
 *   const onPress = useGuardedPress(handleJoinTrip);
 *   <TouchableOpacity onPress={onPress} ... />
 *
 * The guard state lives in refs, so it survives re-renders even if you pass an
 * inline (non-memoized) handler.
 */
export function useGuardedPress<A extends unknown[]>(
  handler: (...args: A) => void | Promise<unknown>,
  gapMs = 700,
): (...args: A) => void {
  const lastTsRef = useRef(0);
  const lockedRef = useRef(false);
  const handlerRef = useRef(handler);
  handlerRef.current = handler; // always call the freshest handler

  return useCallback(
    (...args: A) => {
      if (lockedRef.current) return;
      const now = Date.now();
      if (now - lastTsRef.current < gapMs) return;
      lastTsRef.current = now;

      const result = handlerRef.current(...args);
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        lockedRef.current = true;
        (result as Promise<unknown>).finally(() => {
          lockedRef.current = false;
        });
      }
    },
    [gapMs],
  );
}
