/**
 * "Has this operator finished setting up?" — one answer, shared by the banner
 * (on every page) and anything else that asks.
 *
 * ── Fails CLOSED ────────────────────────────────────────────────────────────
 * Any read that throws leaves `ready` false, and the banner renders nothing
 * while not ready. A missing prompt is a smaller problem than a permanent
 * "finish your setup" shown to an operator who already has.
 *
 * There is no react-query in this project, so this is a plain hook. It runs
 * once per mount of `Shell`, which is once per page load — the same cost the
 * Settings page already pays, on a site an operator keeps open rather than
 * navigates hard.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  EMPTY_SETTINGS,
  fetchOperatorSettings,
  fetchPayoutState,
  NO_PAYOUT,
  type OperatorSettings,
  type PayoutState,
} from './settings';
import {
  isOperatorSetupComplete,
  operatorSetupSteps,
  setupSummary,
} from '../domain/operatorSetup';

export interface UseOperatorSetup {
  /** False until BOTH reads have settled — nothing should render before then. */
  ready: boolean;
  complete: boolean;
  /** Names the next outstanding step. */
  summary: string;
  done: number;
  total: number;
  reload: () => void;
}

export function useOperatorSetup(userId: string | null): UseOperatorSetup {
  const [settings, setSettings] = useState<OperatorSettings>(EMPTY_SETTINGS);
  const [payout, setPayout] = useState<PayoutState>(NO_PAYOUT);
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const [s, p] = await Promise.all([
        fetchOperatorSettings(userId),
        fetchPayoutState(userId).catch(() => null),
      ]);
      setSettings(s);
      setPayout(p ?? NO_PAYOUT);
      setReady(true);
    } catch {
      // Stays not-ready. See "fails closed" above.
      setReady(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const input = { payout, settings };
  const steps = operatorSetupSteps(input);

  return {
    ready,
    complete: isOperatorSetupComplete(input),
    summary: setupSummary(input),
    done: steps.filter(s => s.done).length,
    total: steps.length,
    reload: () => void load(),
  };
}
