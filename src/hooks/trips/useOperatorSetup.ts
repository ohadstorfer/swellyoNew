/**
 * "Is this an operator, and have they finished setting up?"
 *
 * One cached answer, for the same reason `useConnectStatus` exists: three
 * surfaces ask it — the card on the Trips tab, the gate on the Create chooser,
 * and the setup screen itself — and three separate fetches would ask the server
 * three times and then disagree with each other for the rest of the session.
 *
 * Stripe is read through `useConnectStatus` rather than re-fetched, so this
 * hook and the setup checklist can never differ about step 1.
 *
 * ── Fails CLOSED on the operator flag, OPEN on the rest ─────────────────────
 * `fetchIsOperator` already returns false on any error, so a failed read hides
 * the operator UI rather than showing it to everyone. But if we know they ARE
 * an operator and merely could not read their settings, `complete` stays false
 * — a nudge shown once too often is a far smaller problem than an operator who
 * publishes a trip with no waiver because a fetch timed out.
 */
import { useQuery } from '@tanstack/react-query';
import {
  fetchIsOperator,
  fetchOperatorSettings,
  EMPTY_OPERATOR_SETTINGS,
  type OperatorSettings,
} from '../../services/trips/operatorSettingsService';
import {
  isOperatorSetupComplete,
  operatorSetupSteps,
  setupSummary,
  outstandingSteps,
  type SetupStep,
} from '../../services/trips/operatorSetup';
import { useConnectStatus } from './useConnectStatus';

export const operatorSetupKey = ['operator', 'setup'] as const;

export interface UseOperatorSetup {
  isOperator: boolean;
  /** False while loading, so nothing operator-only flashes on screen first. */
  isReady: boolean;
  complete: boolean;
  /** True only when we know they are an operator AND setup is unfinished. */
  needsSetup: boolean;
  /** All four, with their done flags — the banner draws one segment each. */
  steps: SetupStep[];
  outstanding: SetupStep[];
  summary: string;
  settings: OperatorSettings;
  loading: boolean;
  refresh: () => void;
}

export function useOperatorSetup(): UseOperatorSetup {
  const { state: connect, loading: connectLoading } = useConnectStatus();

  const { data, isPending, refetch } = useQuery({
    queryKey: operatorSetupKey,
    queryFn: async () => {
      const isOperator = await fetchIsOperator();
      // Skipped for everyone else — operator_settings is RLS'd to the owner, so
      // a non-operator's read is a guaranteed empty round trip on app start.
      if (!isOperator) return { isOperator, settings: EMPTY_OPERATOR_SETTINGS };
      return { isOperator, settings: await fetchOperatorSettings() };
    },
    staleTime: 60_000,
  });

  const isOperator = data?.isOperator ?? false;
  const settings = data?.settings ?? EMPTY_OPERATOR_SETTINGS;
  const loading = isPending || connectLoading;
  const input = { connect, settings };

  const complete = isOperator && !loading && isOperatorSetupComplete(input);

  return {
    isOperator,
    isReady: !loading,
    complete,
    // Gated on `!loading` so the Create tab does not flash a "finish setup"
    // wall at an operator who is already done, on every cold start.
    needsSetup: isOperator && !loading && !complete,
    steps: operatorSetupSteps(input),
    outstanding: outstandingSteps(input),
    summary: setupSummary(input),
    settings,
    loading,
    refresh: () => void refetch(),
  };
}
