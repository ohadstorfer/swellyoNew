/**
 * Operator setup, one step at a time (Figma 15225-20972 … 15522-19229).
 *
 * Opened from the checklist (OperatorSetupScreen) — at the first unfinished
 * step, or at whichever row was tapped. Continue saves that step and moves on;
 * after the last step it returns to the checklist, which is where "done" is
 * shown. Steps are still independent: Exit or Save and Exit at any point, and
 * the checklist shows exactly what is left.
 *
 * Nothing is saved on the way IN to a step — only Continue and Save and Exit
 * write. A half-typed refund step must never reach the database.
 */
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import Animated, { Easing, FadeIn } from 'react-native-reanimated';
import { StyleSheet } from 'react-native';
import type { OperatorSettings } from '../../../services/trips/operatorSettingsService';
import { SETUP_STEP_ORDER, type SetupStepKey } from '../../../services/trips/operatorSetup';
import { SetupWizardChrome } from './setupUi';
import { StripeStep } from './steps/StripeStep';
import { CurrencyStep } from './steps/CurrencyStep';
import { PolicyStep } from './steps/PolicyStep';
import { WaiverStep } from './steps/WaiverStep';
import { InsuranceStep } from './steps/InsuranceStep';
import { AgreementStep } from './steps/AgreementStep';

export interface WizardApi {
  settings: OperatorSettings;
  /** Re-read settings after a save. Resolves with the fresh copy. */
  reload: () => Promise<OperatorSettings>;
  /** Move to the next step, or back to the checklist after the last. */
  next: () => void;
  country: string | null | undefined;
}

const WizardCtx = createContext<WizardApi | null>(null);

export function useWizard(): WizardApi {
  const ctx = useContext(WizardCtx);
  if (!ctx) throw new Error('useWizard outside OperatorSetupWizard');
  return ctx;
}

const STEP: Record<SetupStepKey, React.FC> = {
  stripe: StripeStep,
  currency: CurrencyStep,
  policy: PolicyStep,
  waiver: WaiverStep,
  insurance: InsuranceStep,
  terms: AgreementStep,
};

export const OperatorSetupWizard: React.FC<{
  initialStep: SetupStepKey;
  settings: OperatorSettings;
  reload: () => Promise<OperatorSettings>;
  country: string | null | undefined;
  onExit: () => void;
}> = ({ initialStep, settings, reload, country, onExit }) => {
  const [index, setIndex] = useState(() => Math.max(0, SETUP_STEP_ORDER.indexOf(initialStep)));
  // Read by next/back so they can stay stable AND see the current step, with
  // no side effect inside a state updater (which React may run twice).
  const indexRef = useRef(index);
  indexRef.current = index;

  const next = useCallback(() => {
    if (indexRef.current >= SETUP_STEP_ORDER.length - 1) onExit();
    else setIndex(indexRef.current + 1);
  }, [onExit]);

  const back = useCallback(() => {
    if (indexRef.current === 0) onExit();
    else setIndex(indexRef.current - 1);
  }, [onExit]);

  // A fresh copy of settings reaches every step through context, so a step
  // mounted after a save on the previous one reads the saved values.
  const api = useMemo<WizardApi>(
    () => ({ settings, reload, next, country }),
    [settings, reload, next, country],
  );

  const key = SETUP_STEP_ORDER[index];
  const Step = STEP[key];

  return (
    <WizardCtx.Provider value={api}>
      <SetupWizardChrome index={index} total={SETUP_STEP_ORDER.length} onBack={back} onExit={onExit}>
        {/* Keyed, so each step starts from its own saved values. A short fade
            only: steps swap often, and a slide would make Back feel slow. */}
        <Animated.View
          key={key}
          style={styles.fill}
          entering={FadeIn.duration(180).easing(Easing.bezier(0.23, 1, 0.32, 1))}
        >
          <Step />
        </Animated.View>
      </SetupWizardChrome>
    </WizardCtx.Provider>
  );
};

const styles = StyleSheet.create({ fill: { flex: 1 } });
