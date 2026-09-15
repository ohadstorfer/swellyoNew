import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { cancelTripWithRefunds, type CancelTripResult } from '../services/cancel';
import { badRefunds, sentUsd } from '../services/removal';
import { formatUsd, plural } from '../lib/format';
import { friendlyError } from '../lib/errors';

/**
 * Calling off the trip, and giving everyone their money back.
 *
 * Product Specs §"Manage trip": "cancel trip + refund all."
 *
 * ── Two screens, because the second one is the important one ───────────────
 * Confirm, then RESULT. A cancellation is not one action; it is one status
 * change plus N refunds, and any of the refunds can be refused — most often
 * because the operator's Stripe balance does not cover them. Closing the dialog
 * on success would hide exactly the information the operator has to act on.
 *
 * The result screen names every refund that did not go out, and offers a retry.
 * `trip-cancel` re-asks Stripe what is left on each charge, so running it again
 * skips what already went back — which is what makes that button safe.
 *
 * ── Typing the word ────────────────────────────────────────────────────────
 * Not decoration. This is the only irreversible thing on the site, it emails
 * everyone on the trip, and it moves real money. A misclick on a `btn-danger`
 * is a plausible way to end somebody's season.
 */
export function CancelTripDialog({
  tripId,
  tripTitle,
  onClose,
}: {
  tripId: string;
  tripTitle: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CancelTripResult | null>(null);

  const run = useMutation({
    mutationFn: () => cancelTripWithRefunds({ tripId, reason }),
    onSuccess: r => {
      setResult(r);
      setError(null);
      void qc.invalidateQueries({ queryKey: ['trip', tripId] });
      void qc.invalidateQueries({ queryKey: ['trips'] });
      void qc.invalidateQueries({ queryKey: ['money', tripId] });
    },
    onError: e => setError(friendlyError(e)),
  });

  const armed = confirm.trim().toUpperCase() === 'CANCEL';
  const blocked = result ? badRefunds(result.refunds) : [];

  return (
    <div className="scrim" onClick={run.isPending ? undefined : onClose} role="dialog" aria-modal="true">
      <div className="modal" onClick={e => e.stopPropagation()}>
        {result ? (
          <>
            <h2 style={{ marginBottom: 8 }}>
              {result.cancelled ? 'Trip cancelled' : 'Not cancelled'}
            </h2>

            {result.offline ? (
              <p className="muted small">
                This trip was paid outside Swellyo, so there was nothing here to refund. Anything
                your travelers paid you directly is between you and them.
              </p>
            ) : (
              <p className="muted small">
                {formatUsd(sentUsd(result.refunds))} went back across{' '}
                {plural(result.refunds.filter(r => r.status === 'succeeded').length, 'payment')}.
              </p>
            )}

            {result.error && (
              <div
                className="banner"
                style={{ background: 'var(--warn-bg)', color: 'var(--warn)', marginTop: 12 }}
              >
                The trip is cancelled, but the refunds could not be worked out: {result.error}
              </div>
            )}

            {blocked.length > 0 && (
              <div className="stack" style={{ marginTop: 14 }}>
                <strong className="small">{plural(blocked.length, 'refund')} did not go out</strong>
                {blocked.map((b, i) => (
                  <div key={i} className="small muted">
                    {formatUsd(b.amountUsd)} —{' '}
                    {b.status === 'blocked_insufficient_balance'
                      ? 'your Stripe balance did not cover it'
                      : 'Stripe refused it'}
                  </div>
                ))}
                <p className="muted small">
                  Top up in Stripe, then retry. Refunds that already went out are skipped, so this
                  never sends anything twice.
                </p>
              </div>
            )}

            <div className="row" style={{ gap: 8, marginTop: 18, justifyContent: 'flex-end' }}>
              {blocked.length > 0 && (
                <button
                  className="btn btn-sm"
                  disabled={run.isPending}
                  onClick={() => run.mutate()}
                >
                  {run.isPending ? 'Retrying…' : 'Retry the blocked refunds'}
                </button>
              )}
              <button className="btn btn-sm btn-primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 style={{ marginBottom: 8 }}>Cancel {tripTitle}?</h2>
            <p className="muted small">
              Everyone on the trip is told, and everyone who paid through Swellyo is refunded in
              full. Your cancellation policy does not apply — that is for a traveler who pulls out,
              not for you calling the trip off.
            </p>
            <p className="muted small" style={{ marginTop: 8 }}>
              This cannot be undone.
            </p>

            <label className="small" style={{ display: 'block', marginTop: 16 }}>
              Why, in a line (optional — your travelers see this)
              <input
                value={reason}
                onChange={e => setReason(e.target.value.slice(0, 200))}
                placeholder="Cyclone forecast for the whole week"
                style={{ width: '100%', marginTop: 6 }}
              />
            </label>

            <label className="small" style={{ display: 'block', marginTop: 14 }}>
              Type CANCEL to confirm
              <input
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                autoComplete="off"
                style={{ width: '100%', marginTop: 6 }}
              />
            </label>

            {error && (
              <div
                className="banner"
                style={{ background: 'var(--danger-bg)', color: 'var(--danger)', marginTop: 12 }}
              >
                {error}
              </div>
            )}

            <div className="row" style={{ gap: 8, marginTop: 18, justifyContent: 'flex-end' }}>
              <button className="btn btn-sm" disabled={run.isPending} onClick={onClose}>
                Keep the trip
              </button>
              <button
                className="btn btn-sm btn-danger"
                disabled={!armed || run.isPending}
                onClick={() => run.mutate()}
              >
                {run.isPending ? 'Cancelling…' : 'Cancel and refund everyone'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
