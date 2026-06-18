import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabaseDatabaseService } from '../services/database/supabaseDatabaseService';

export type TutorialStep = 0 | 1 | 2 | 3 | 4;

// Legacy completion flag — kept around so `complete()` continues to persist
// a "user finished the guide" signal. The TRIGGER no longer reads this; it
// reads `isSeen` instead (see WELCOME_GUIDE_SEEN_KEY).
export const WELCOME_GUIDE_COMPLETED_KEY = '@swellyo_welcome_guide_completed';
// New "seen" flag. Persisted to AsyncStorage as a fast-path cache so the
// first render after app launch has a non-flickering value. The source of
// truth lives in surfers.welcome_guide_seen_at (DB) and is reconciled via
// setSeenFromProfile when the user profile loads.
export const WELCOME_GUIDE_SEEN_KEY = '@swellyo_welcome_guide_seen_v2';
// One-time "Surf Trips tab" coach-mark seen flag. Same pattern as
// WELCOME_GUIDE_SEEN_KEY — AsyncStorage is a fast-path cache, the DB column
// surfers.surftrips_tip_seen_at is the source of truth.
export const SURFTRIPS_TIP_SEEN_KEY = '@swellyo_surftrips_tip_seen_v1';

interface TutorialContextValue {
  currentStep: TutorialStep;
  isActive: boolean;
  isHydrated: boolean;
  /** True if the guide has been shown to this user at least once. Gates the auto-trigger. */
  isSeen: boolean;
  /** True if the user explicitly completed/skipped the guide. Kept for UI parity; not used by the trigger. */
  isCompleted: boolean;
  start: () => void;
  advance: () => void;
  goTo: (step: TutorialStep) => void;
  complete: () => Promise<void>;
  skip: () => Promise<void>;
  /** Marks the guide as seen — called by the chat trigger the moment goTo(3) fires. Best-effort DB write. Idempotent. */
  markSeen: () => Promise<void>;
  /** Reconciliation hook: AppContent calls this when the user profile loads so the DB state wins over AsyncStorage cache. */
  setSeenFromProfile: (seen: boolean) => void;
  /** Dev button — clears AsyncStorage cache, completion flag, AND nullifies the DB column. */
  resetForReplay: () => Promise<void>;
  /** True once the one-time "Surf Trips tab" coach-mark has been shown to this user. */
  surftripsTipSeen: boolean;
  /** Marks the Surf Trips tip as shown — called the moment the coach-mark appears. Idempotent. */
  markSurftripsTipSeen: () => Promise<void>;
  /** Reconciliation hook: AppContent calls this when the user profile loads. */
  setSurftripsTipSeenFromProfile: (seen: boolean) => void;
  /** Dev button — clears the Surf Trips tip flag (AsyncStorage + DB) so it shows again. */
  resetSurftripsTip: () => Promise<void>;
}

const TutorialContext = createContext<TutorialContextValue | undefined>(undefined);

export const TutorialProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentStep, setCurrentStep] = useState<TutorialStep>(0);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isSeen, setIsSeen] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [surftripsTipSeen, setSurftripsTipSeen] = useState(false);
  // Tracks whether the DB has been reconciled at least once. Until then, the
  // value of `isSeen` comes from AsyncStorage and may be stale.
  const reconciledFromProfileRef = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const [completed, seen, surftripsTip] = await Promise.all([
          AsyncStorage.getItem(WELCOME_GUIDE_COMPLETED_KEY),
          AsyncStorage.getItem(WELCOME_GUIDE_SEEN_KEY),
          AsyncStorage.getItem(SURFTRIPS_TIP_SEEN_KEY),
        ]);
        console.log('[Tutorial hydrate]', { completed, seen, surftripsTip });
        setIsCompleted(completed === 'true');
        setIsSeen(seen === 'true');
        setSurftripsTipSeen(surftripsTip === 'true');
      } catch (err) {
        console.warn('[TutorialContext] Hydration failed', err);
      } finally {
        setIsHydrated(true);
      }
    })();
  }, []);

  const start = useCallback(() => {
    setCurrentStep(prev => (prev === 0 ? 1 : prev));
  }, []);

  const advance = useCallback(() => {
    setCurrentStep(prev => {
      if (prev === 0 || prev >= 4) return prev;
      return (prev + 1) as TutorialStep;
    });
  }, []);

  const goTo = useCallback((step: TutorialStep) => {
    setCurrentStep(step);
  }, []);

  const markSeen = useCallback(async () => {
    // Idempotent: skip both AS and DB writes if already marked.
    setIsSeen(prev => {
      if (prev) return prev;
      return true;
    });
    try {
      await AsyncStorage.setItem(WELCOME_GUIDE_SEEN_KEY, 'true');
    } catch (err) {
      console.warn('[TutorialContext] AS cache write failed:', err);
    }
    // Best-effort DB write — fire and forget. The .is('welcome_guide_seen_at', null)
    // guard in the service makes this idempotent even if it runs twice.
    supabaseDatabaseService.markWelcomeGuideSeen().catch(err =>
      console.warn('[TutorialContext] DB markSeen failed:', err),
    );
  }, []);

  const setSeenFromProfile = useCallback((seen: boolean) => {
    reconciledFromProfileRef.current = true;
    setIsSeen(prev => {
      if (prev === seen) return prev;
      return seen;
    });
    // Reconcile AsyncStorage cache so next launch matches DB without waiting
    // for another profile load.
    AsyncStorage.setItem(WELCOME_GUIDE_SEEN_KEY, seen ? 'true' : 'false').catch(err =>
      console.warn('[TutorialContext] AS cache reconcile failed:', err),
    );
  }, []);

  const complete = useCallback(async () => {
    setCurrentStep(0);
    setIsCompleted(true);
    try {
      await AsyncStorage.setItem(WELCOME_GUIDE_COMPLETED_KEY, 'true');
    } catch (err) {
      console.warn('[TutorialContext] Failed to persist welcome-guide completion', err);
    }
    // Idempotency: completing the tutorial implies it was seen. markSeen()
    // self-guards if already seen.
    markSeen();
  }, [markSeen]);

  const skip = complete;

  const resetForReplay = useCallback(async () => {
    console.log('[Tutorial resetForReplay] called');
    setCurrentStep(0);
    setIsCompleted(false);
    setIsSeen(false);
    reconciledFromProfileRef.current = false;
    try {
      await Promise.all([
        AsyncStorage.removeItem(WELCOME_GUIDE_COMPLETED_KEY),
        AsyncStorage.removeItem(WELCOME_GUIDE_SEEN_KEY),
      ]);
      console.log('[Tutorial resetForReplay] AS cleared');
    } catch (err) {
      console.warn('[TutorialContext] Failed to clear AS flags', err);
    }
    // DB clear is awaited (not fire-and-forget) — the caller is a dev button,
    // and we need the DB to be cleared BEFORE the caller refreshes the
    // profile / opens the chat. Otherwise the reconciliation effect re-reads
    // the still-set timestamp and flips isSeen back to true, blocking the
    // trigger.
    try {
      const dbResult = await supabaseDatabaseService.clearWelcomeGuideSeen();
      console.log('[Tutorial resetForReplay] DB clear result:', dbResult);
    } catch (err) {
      console.warn('[TutorialContext] DB clear failed:', err);
    }
  }, []);

  // ── One-time "Surf Trips tab" coach-mark ──────────────────────────────
  // Independent of the welcome guide; same DB-backed seen-flag pattern.
  const markSurftripsTipSeen = useCallback(async () => {
    setSurftripsTipSeen(true);
    try {
      await AsyncStorage.setItem(SURFTRIPS_TIP_SEEN_KEY, 'true');
    } catch (err) {
      console.warn('[TutorialContext] surftrips tip AS write failed:', err);
    }
    // Best-effort DB write — fire and forget. The .is(..., null) guard in the
    // service keeps it idempotent.
    supabaseDatabaseService.markSurftripsTipSeen().catch(err =>
      console.warn('[TutorialContext] DB markSurftripsTipSeen failed:', err),
    );
  }, []);

  const setSurftripsTipSeenFromProfile = useCallback((seen: boolean) => {
    setSurftripsTipSeen(prev => (prev === seen ? prev : seen));
    AsyncStorage.setItem(SURFTRIPS_TIP_SEEN_KEY, seen ? 'true' : 'false').catch(err =>
      console.warn('[TutorialContext] surftrips tip AS reconcile failed:', err),
    );
  }, []);

  const resetSurftripsTip = useCallback(async () => {
    setSurftripsTipSeen(false);
    try {
      await AsyncStorage.removeItem(SURFTRIPS_TIP_SEEN_KEY);
    } catch (err) {
      console.warn('[TutorialContext] Failed to clear surftrips tip AS flag', err);
    }
    // Awaited so the DB column is verified NULL before the caller refreshes
    // the profile — otherwise reconciliation re-flips the flag back to true.
    try {
      await supabaseDatabaseService.clearSurftripsTipSeen();
    } catch (err) {
      console.warn('[TutorialContext] DB clear surftrips tip failed:', err);
    }
  }, []);

  const value = useMemo<TutorialContextValue>(() => ({
    currentStep,
    isActive: currentStep > 0,
    isHydrated,
    isSeen,
    isCompleted,
    start,
    advance,
    goTo,
    complete,
    skip,
    markSeen,
    setSeenFromProfile,
    resetForReplay,
    surftripsTipSeen,
    markSurftripsTipSeen,
    setSurftripsTipSeenFromProfile,
    resetSurftripsTip,
  }), [currentStep, isHydrated, isSeen, isCompleted, start, advance, goTo, complete, skip, markSeen, setSeenFromProfile, resetForReplay, surftripsTipSeen, markSurftripsTipSeen, setSurftripsTipSeenFromProfile, resetSurftripsTip]);

  return <TutorialContext.Provider value={value}>{children}</TutorialContext.Provider>;
};

export function useTutorial(): TutorialContextValue {
  const ctx = useContext(TutorialContext);
  if (!ctx) {
    throw new Error('useTutorial must be used within TutorialProvider');
  }
  return ctx;
}
