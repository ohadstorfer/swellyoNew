import { useCallback, useRef, useState } from 'react';
import { friendlyError } from '../../lib/errors';
import { editErrorMessage } from '../../services/sayError';

export type EditorProps<T> = {
  trip: T;
  userId: string;
  /** Called after a successful write: refresh, say "Saved", close. */
  onSaved: (message?: string) => void;
  onClose: () => void;
};

/**
 * Busy + error around one write. A ref guards the double-press: two clicks in
 * the same tick both read `busy` as false, and only the first may reach the
 * network.
 */
export function useSaver(onSaved: (message?: string) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const run = useCallback(
    async (write: () => Promise<void>, message?: string) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      setError(null);
      try {
        await write();
        onSaved(message);
      } catch (e) {
        setError(editErrorMessage(e, friendlyError));
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [onSaved],
  );

  return { busy, error, setError, run };
}
