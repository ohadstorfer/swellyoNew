import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type TutorialStep = 0 | 1 | 2 | 3 | 4;

export const WELCOME_GUIDE_COMPLETED_KEY = '@swellyo_welcome_guide_completed';
export const WELCOME_LINEUP_DISMISSED_AT_KEY = '@swellyo_welcome_lineup_dismissed_at';

interface TutorialContextValue {
  currentStep: TutorialStep;
  isActive: boolean;
  isHydrated: boolean;
  isCompleted: boolean;
  welcomeLineupDismissedAt: string | null;
  markWelcomeLineupDismissed: () => Promise<void>;
  start: () => void;
  advance: () => void;
  goTo: (step: TutorialStep) => void;
  complete: () => Promise<void>;
  skip: () => Promise<void>;
}

const TutorialContext = createContext<TutorialContextValue | undefined>(undefined);

export const TutorialProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentStep, setCurrentStep] = useState<TutorialStep>(0);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [welcomeLineupDismissedAt, setWelcomeLineupDismissedAt] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [completed, dismissedAt] = await Promise.all([
          AsyncStorage.getItem(WELCOME_GUIDE_COMPLETED_KEY),
          AsyncStorage.getItem(WELCOME_LINEUP_DISMISSED_AT_KEY),
        ]);
        setIsCompleted(completed === 'true');
        setWelcomeLineupDismissedAt(dismissedAt);
      } catch (err) {
        console.warn('[TutorialContext] Hydration failed', err);
      } finally {
        setIsHydrated(true);
      }
    })();
  }, []);

  const markWelcomeLineupDismissed = useCallback(async () => {
    const ts = new Date().toISOString();
    setWelcomeLineupDismissedAt(ts);
    try {
      await AsyncStorage.setItem(WELCOME_LINEUP_DISMISSED_AT_KEY, ts);
    } catch (err) {
      console.warn('[TutorialContext] Failed to persist welcome-lineup dismissed timestamp', err);
    }
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

  const complete = useCallback(async () => {
    setCurrentStep(0);
    setIsCompleted(true);
    try {
      await AsyncStorage.setItem(WELCOME_GUIDE_COMPLETED_KEY, 'true');
    } catch (err) {
      console.warn('[TutorialContext] Failed to persist welcome-guide completion', err);
    }
  }, []);

  const skip = complete;

  const value = useMemo<TutorialContextValue>(() => ({
    currentStep,
    isActive: currentStep > 0,
    isHydrated,
    isCompleted,
    welcomeLineupDismissedAt,
    markWelcomeLineupDismissed,
    start,
    advance,
    goTo,
    complete,
    skip,
  }), [currentStep, isHydrated, isCompleted, welcomeLineupDismissedAt, markWelcomeLineupDismissed, start, advance, goTo, complete, skip]);

  return <TutorialContext.Provider value={value}>{children}</TutorialContext.Provider>;
};

export function useTutorial(): TutorialContextValue {
  const ctx = useContext(TutorialContext);
  if (!ctx) {
    throw new Error('useTutorial must be used within TutorialProvider');
  }
  return ctx;
}
