/**
 * Canonical display config for the onboarding scaffold (steps 1–7).
 *
 * Header label + progress fill used to live hardcoded inside each step screen and
 * had drifted (duplicate "Travel Deets 2/3" across 3/4/5, "Finish Up! 3/3" on 6/7).
 * This is now the single source of truth — the persistent chrome reads from here so
 * it knows both the "from" and "to" values when cross-fading the label and animating
 * the progress bar between steps.
 */

export type OnboardingStepKey =
  | 'step1'
  | 'step2'
  | 'videoUpload'
  | 'step3'
  | 'step4'
  | 'step5'
  | 'step6'
  | 'step7';

export interface StepDisplay {
  /** Header label, e.g. "Surf Juice 1/3". */
  label: string;
  /** Progress bar fill, 0..1. */
  progress: number;
}

export const ONBOARDING_STEP_DISPLAY: Record<OnboardingStepKey, StepDisplay> = {
  step1: { label: 'Surf Juice 1/3', progress: 1 / 3 },
  step2: { label: 'Surf Juice 1/3', progress: 1 / 3 },
  videoUpload: { label: 'Surf Juice 1/3', progress: 1 / 3 },
  step3: { label: 'Travel Deets 2/3', progress: 2 / 3 },
  step4: { label: 'Travel Deets 2/3', progress: 2 / 3 },
  step5: { label: 'Travel Deets 2/3', progress: 2 / 3 },
  step6: { label: 'Finish Up! 3/3', progress: 1 },
  step7: { label: 'Finish Up! 3/3', progress: 1 },
};

/**
 * Linear order of the steps as the user experiences them. Used to compute slide
 * direction (sign of the index delta) — this correctly handles the Soft Top skip
 * (step1 → step3, still forward) and the video-upload sub-state of step 2.
 */
export const ONBOARDING_STEP_ORDER: OnboardingStepKey[] = [
  'step1',
  'step2',
  'videoUpload',
  'step3',
  'step4',
  'step5',
  'step6',
  'step7',
];

/**
 * Maps the AppContent state (numeric currentStep + the step-2 video-upload sub-state)
 * to a logical step key. Returns null for steps outside the scaffold (0 / -1).
 */
export function resolveStepKey(
  currentStep: number,
  showVideoUploadStep: boolean,
): OnboardingStepKey | null {
  switch (currentStep) {
    case 1:
      return 'step1';
    case 2:
      return showVideoUploadStep ? 'videoUpload' : 'step2';
    case 3:
      return 'step3';
    case 4:
      return 'step4';
    case 5:
      return 'step5';
    case 6:
      return 'step6';
    case 7:
      return 'step7';
    default:
      return null;
  }
}

/** Index of a step key in the linear order (-1 if unknown). */
export function stepOrderIndex(key: OnboardingStepKey | null): number {
  if (!key) return -1;
  return ONBOARDING_STEP_ORDER.indexOf(key);
}
