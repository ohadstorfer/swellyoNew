import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { remindRequirement, remindTravelerRequirement } from '../services/tripActions';
import { friendlyError } from '../lib/errors';
import { plural } from '../lib/format';
import { ConfirmDialog } from './ConfirmDialog';
import '../styles/tripActions.css';

/**
 * "Send reminder" — one traveler, or everyone who still owes a requirement.
 *
 * The web twin of the app's per-row pill (DocumentReviewScreen `remindOne`) and
 * of the "Remind N people" button the SPEC lists under `docs.view`.
 *
 * Confirmed first: it is a real push to real phones, with no undo. Afterwards
 * the button says what actually happened, never what was asked for — the RPC
 * skips anyone reminded about this in the last 24 hours, and "Reminded 8" when
 * five went out is how an operator ends up waiting on three people who were
 * never told.
 *
 * The caller decides who is remindable (`isRemindable`), so the N on the
 * button is counted off the same rows the operator is looking at.
 */
export function RemindButton(
  props: {
    tripId: string;
    requirementId: string;
    requirementTitle: string;
  } & (
    | { mode: 'one'; userId: string; travelerName: string }
    | { mode: 'all'; owed: number }
  ),
) {
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState<number | null>(null);

  const run = useMutation({
    mutationFn: () =>
      props.mode === 'one'
        ? remindTravelerRequirement(props.tripId, props.requirementId, props.userId)
        : remindRequirement(props.tripId, props.requirementId),
    onSuccess: n => {
      setResult(n);
      setAsking(false);
    },
  });

  if (props.mode === 'all' && props.owed === 0) return null;

  if (result !== null) {
    const text =
      props.mode === 'one'
        ? result > 0
          ? 'Reminded'
          : 'Reminded today'
        : result === props.owed
          ? `Reminded ${result}`
          : result === 0
            ? 'All reminded today'
            : `Reminded ${result} · ${props.owed - result} already today`;
    return (
      <span className="tag tag-idle ta-reminded" role="status">
        {text}
      </span>
    );
  }

  const label = props.mode === 'one' ? 'Remind' : `Remind ${props.owed}`;

  return (
    <>
      <button
        className="btn btn-sm"
        onClick={e => {
          // The rows this sits in open a document on click.
          e.stopPropagation();
          run.reset();
          setAsking(true);
        }}
        aria-label={
          props.mode === 'one'
            ? `Send ${props.travelerName} a reminder`
            : `Remind ${plural(props.owed, 'person', 'people')}`
        }
      >
        {label}
      </button>

      {asking && (
        <ConfirmDialog
          title={
            props.mode === 'one'
              ? `Remind ${props.travelerName}?`
              : `Remind ${plural(props.owed, 'person', 'people')}?`
          }
          confirmLabel="Send"
          busyLabel="Sending…"
          busy={run.isPending}
          error={run.isError ? friendlyError(run.error) : null}
          onConfirm={() => run.mutate()}
          onCancel={() => setAsking(false)}
        >
          {props.mode === 'one' ? (
            <p>They get a notification to send “{props.requirementTitle}”.</p>
          ) : (
            <p>
              Everyone who still owes “{props.requirementTitle}” gets a notification. Anyone
              already reminded about it in the last 24 hours is skipped.
            </p>
          )}
        </ConfirmDialog>
      )}
    </>
  );
}
