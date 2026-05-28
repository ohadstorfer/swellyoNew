// AsyncStorage-backed draft autosave for the create-trip wizard.
// Spec: docs/create-trip-redesign-spec.md §3.5. Key is @swellyo/createTripDraft.
// In edit mode the draft is fully bypassed. Save is gated on startSaving() being
// called once (per spec: only persist after the first successful Next tap).

import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const TRIP_WIZARD_DRAFT_KEY = '@swellyo/createTripDraft';
const SAVE_DEBOUNCE_MS = 300;

export interface UseTripWizardDraftOptions {
  editMode?: boolean;
  tripId?: string | null;
}

export interface UseTripWizardDraftApi<TState> {
  state: TState;
  setState: React.Dispatch<React.SetStateAction<TState>>;
  hasRestoredDraft: boolean;
  clearDraft: () => Promise<void>;
  startSaving: () => void;
}

// Best-effort check that a parsed draft has at least the top-level keys of the
// initial shape. Defends against schema changes leaving stale drafts in storage.
function looksLikeShape<T extends Record<string, unknown>>(candidate: unknown, shape: T): candidate is T {
  if (!candidate || typeof candidate !== 'object') return false;
  const obj = candidate as Record<string, unknown>;
  for (const key of Object.keys(shape)) {
    if (!(key in obj)) return false;
  }
  return true;
}

export function useTripWizardDraft<TState extends Record<string, unknown>>(
  initial: TState,
  options?: UseTripWizardDraftOptions,
): UseTripWizardDraftApi<TState> {
  const editMode = options?.editMode ?? false;

  // We keep a ref-of-initial so callers can pass an object literal without
  // forcing this hook to react to its identity.
  const initialRef = useRef<TState>(initial);

  const [state, setState] = useState<TState>(initial);
  const [hasRestoredDraft, setHasRestoredDraft] = useState(false);
  const savingEnabledRef = useRef(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // On mount: in create mode try to restore the draft from AsyncStorage.
  useEffect(() => {
    mountedRef.current = true;
    if (editMode) {
      // Edit mode never reads the draft.
      return () => {
        mountedRef.current = false;
      };
    }

    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(TRIP_WIZARD_DRAFT_KEY);
        if (cancelled || !mountedRef.current) return;
        if (!raw) return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          // Corrupted draft — silently drop it.
          await AsyncStorage.removeItem(TRIP_WIZARD_DRAFT_KEY);
          return;
        }
        if (!looksLikeShape(parsed, initialRef.current)) return;
        setState(parsed as TState);
        setHasRestoredDraft(true);
      } catch (e) {
        // AsyncStorage read failures should not break the wizard.
        console.warn('[useTripWizardDraft] read failed:', e);
      }
    })();

    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
    // editMode is stable for the lifetime of the wizard; intentionally not in deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced save: only writes after startSaving() is invoked at least once.
  useEffect(() => {
    if (editMode) return;
    if (!savingEnabledRef.current) return;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      AsyncStorage.setItem(TRIP_WIZARD_DRAFT_KEY, JSON.stringify(state)).catch(e => {
        console.warn('[useTripWizardDraft] write failed:', e);
      });
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [state, editMode]);

  const clearDraft = useCallback(async () => {
    try {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      await AsyncStorage.removeItem(TRIP_WIZARD_DRAFT_KEY);
    } catch (e) {
      console.warn('[useTripWizardDraft] clear failed:', e);
    }
  }, []);

  const startSaving = useCallback(() => {
    savingEnabledRef.current = true;
  }, []);

  return { state, setState, hasRestoredDraft, clearDraft, startSaving };
}
