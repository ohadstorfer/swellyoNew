/**
 * Bridge between the persistent onboarding chrome (header + Next button, owned by
 * OnboardingScaffold) and the active step's content screen.
 *
 * The chrome is rendered once and never unmounts. Each step screen renders only its
 * middle content and calls `useRegisterOnboardingStep(...)` to tell the chrome what
 * the Next button should say, whether it's enabled, and what to run on Next/Back.
 *
 * Handlers are kept in a ref (so the button always calls the latest closure without
 * forcing chrome re-renders); the render-affecting bits (label, canProceed) live in
 * state. During a slide both the outgoing and incoming screens are briefly mounted —
 * the incoming registration wins, and the outgoing's unmount cleanup is a no-op once
 * ownership has moved on (token check), so it never wipes the incoming descriptor.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { OnboardingStepKey } from '../components/onboarding/onboardingStepConfig';

export interface StepChromeDescriptor {
  /** Next button label, e.g. "Next" | "Skip" | "Create Profile". */
  nextLabel: string;
  /** When false the Next button is disabled (in addition to the scaffold's isLoading). */
  canProceed: boolean;
  /** Runs when Next is pressed. May be async (saves, validation, age-gate, modals). */
  onNext: () => void | Promise<void>;
  /** Runs when Back is pressed. */
  onBack: () => void;
  /** Optional label override for the header (e.g. video-upload borrows step 2's label). */
  labelKeyOverride?: OnboardingStepKey;
  /** Optional text shown on the button while the scaffold's isLoading is true. */
  loadingLabel?: string;
}

/** Render-affecting slice exposed to the chrome. */
interface ChromeView {
  nextLabel: string;
  canProceed: boolean;
  labelKeyOverride?: OnboardingStepKey;
  loadingLabel?: string;
}

const DEFAULT_VIEW: ChromeView = {
  nextLabel: 'Next',
  canProceed: false,
};

interface OnboardingStepContextValue {
  /** Read by the chrome to render the Next button. */
  view: ChromeView;
  /** Invoked by the chrome's Next button. */
  callNext: () => void | Promise<void>;
  /** Invoked by the chrome's Back button. */
  callBack: () => void;
  /** Internal: register/update the active step's descriptor. Returns an owner token. */
  __register: (token: number, d: StepChromeDescriptor) => void;
  /** Internal: release a registration (no-op unless still the owner). */
  __release: (token: number) => void;
}

const OnboardingStepContext = createContext<OnboardingStepContextValue | null>(null);

export const OnboardingStepProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [view, setView] = useState<ChromeView>(DEFAULT_VIEW);
  // Latest handlers + current owner token, kept off the render path.
  const handlersRef = useRef<{ onNext: StepChromeDescriptor['onNext']; onBack: StepChromeDescriptor['onBack'] }>({
    onNext: () => {},
    onBack: () => {},
  });
  const ownerRef = useRef<number>(-1);

  const __register = useCallback((token: number, d: StepChromeDescriptor) => {
    ownerRef.current = token;
    handlersRef.current = { onNext: d.onNext, onBack: d.onBack };
    setView((prev) => {
      // Avoid redundant state updates that would re-render the chrome.
      if (
        prev.nextLabel === d.nextLabel &&
        prev.canProceed === d.canProceed &&
        prev.labelKeyOverride === d.labelKeyOverride &&
        prev.loadingLabel === d.loadingLabel
      ) {
        return prev;
      }
      return {
        nextLabel: d.nextLabel,
        canProceed: d.canProceed,
        labelKeyOverride: d.labelKeyOverride,
        loadingLabel: d.loadingLabel,
      };
    });
  }, []);

  const __release = useCallback((token: number) => {
    // Only the current owner may release; a stale outgoing screen unmounting after
    // the incoming has registered must not clear the new descriptor.
    if (ownerRef.current === token) {
      ownerRef.current = -1;
    }
  }, []);

  const callNext = useCallback(() => handlersRef.current.onNext(), []);
  const callBack = useCallback(() => handlersRef.current.onBack(), []);

  const value = useMemo<OnboardingStepContextValue>(
    () => ({ view, callNext, callBack, __register, __release }),
    [view, callNext, callBack, __register, __release],
  );

  return (
    <OnboardingStepContext.Provider value={value}>
      {children}
    </OnboardingStepContext.Provider>
  );
};

/** Used by the scaffold/chrome to read the active step's button state + handlers. */
export function useOnboardingStepChrome(): OnboardingStepContextValue {
  const ctx = useContext(OnboardingStepContext);
  if (!ctx) {
    throw new Error('useOnboardingStepChrome must be used inside OnboardingStepProvider');
  }
  return ctx;
}

let __tokenSeq = 0;

/**
 * Called by each step screen to register its Next/Back behavior with the persistent
 * chrome. Re-registers whenever the descriptor's render-affecting fields change.
 */
export function useRegisterOnboardingStep(descriptor: StepChromeDescriptor): void {
  const ctx = useContext(OnboardingStepContext);
  if (!ctx) {
    throw new Error('useRegisterOnboardingStep must be used inside OnboardingStepProvider');
  }
  const tokenRef = useRef<number>(0);
  if (tokenRef.current === 0) {
    tokenRef.current = ++__tokenSeq;
  }
  const { __register, __release } = ctx;

  // Store the latest descriptor in a ref (handlers close over current state).
  const descriptorRef = useRef(descriptor);
  descriptorRef.current = descriptor;

  // Register after commit (never during render, to avoid cross-component setState).
  // Runs every render so handlers stay fresh; setView is equality-guarded.
  useEffect(() => {
    __register(tokenRef.current, descriptorRef.current);
  });

  // Release only on unmount; no-op if the incoming screen already took ownership.
  useEffect(() => {
    const token = tokenRef.current;
    return () => __release(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
