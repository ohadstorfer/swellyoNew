import { useState } from 'react';
import { formatUsd } from '../lib/format';
import { issueRefund } from '../services/refunds';

type Props = {
  travelerName: string;
  /** The payment being reversed. A refund is always against ONE payment. */
  paymentEventId: string;
  /** How much that payment was, in USD. The refund cannot exceed it. */
  paidUsd: number;
  /** The trip's frozen terms, already rendered to lines. Empty = none set. */
  policyLines: string[];
  onCancel: () => void;
  /**
   * Called with the amount Stripe actually refunded, so the page can say so.
   * A refund is irreversible and takes seconds to show up in the ledger — the
   * dialog simply closing was, for that gap, indistinguishable from nothing
   * having happened.
   */
  onDone: (amountUsd: number) => void;
};

/**
 * Issue a refund.
 *
 * Three things this screen insists on, all of them because money is not undoable:
 *
 * 1. **The frozen policy is shown, not linked.** The operator is applying terms
 *    a traveler agreed to; making them click to read those terms means they
 *    won't. If the trip has no policy the box says so rather than going blank —
 *    "no terms were set" is information, not an empty state.
 * 2. **Partial is a first-class choice, not an edge case.** Most real refunds
 *    are partial (the policy keeps 50%), so the amount box is pre-filled with
 *    the full amount and editable, rather than hidden behind an "advanced"
 *    toggle.
 * 3. **A blocked refund is explained with both numbers.** "Refund failed" sends
 *    the operator to support. "Needs $600, you have $240" tells them to wait
 *    for a payout. That message comes back from the server, which is the only
 *    thing that knows the balance.
 */
export function RefundDialog({
  travelerName,
  paymentEventId,
  paidUsd,
  policyLines,
  onCancel,
  onDone,
}: Props) {
  const [amount, setAmount] = useState(paidUsd.toFixed(2));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = Number(amount);
  const valid = Number.isFinite(parsed) && parsed > 0 && parsed <= paidUsd + 0.001;

  async function confirm() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);

    const result = await issueRefund({
      paymentEventId,
      // Send nothing when it is the whole amount: the server then refunds
      // whatever is actually left, which stays correct even if a partial refund
      // was issued from the Stripe dashboard since this page loaded.
      ...(Math.abs(parsed - paidUsd) < 0.001 ? {} : { amountUsd: parsed }),
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    });

    setBusy(false);
    if (result.ok) {
      // The server's figure, not `parsed`: it refunds whatever is actually
      // left, which can be less than was asked for.
      onDone(result.amountUsd);
      return;
    }
    setError(result.error);
  }

  return (
    <div className="scrim" onClick={onCancel} role="dialog" aria-modal="true">
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="card-head">
          <strong>Refund {travelerName}</strong>
        </div>

        <div className="card-body">
          <p className="small" style={{ marginBottom: 14 }}>
            This sends money back to {travelerName} and takes it out of{' '}
            <strong>your Stripe balance</strong>. Swellyo's commission comes back to you in
            proportion. <strong>It cannot be undone.</strong>
          </p>

          <div
            style={{
              border: '1px solid var(--line)',
              background: 'var(--panel)',
              borderRadius: 'var(--r-sm)',
              padding: '10px 12px',
              marginBottom: 14,
            }}
          >
            <div className="small muted" style={{ marginBottom: policyLines.length ? 6 : 0 }}>
              This trip's cancellation policy
            </div>
            {policyLines.length ? (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {policyLines.map(line => (
                  <li key={line} className="small">
                    {line}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="small">
                No policy was set on this trip. Whatever you refund here is your call.
              </div>
            )}
          </div>

          <label className="small muted" htmlFor="refund-amount">
            Amount (up to {formatUsd(paidUsd)})
          </label>
          <input
            id="refund-amount"
            type="text"
            inputMode="decimal"
            autoFocus
            value={amount}
            onChange={e => setAmount(e.target.value)}
            style={{ marginTop: 6 }}
          />
          {!valid && amount.trim() !== '' && (
            <div className="small" style={{ color: 'var(--danger)', marginTop: 6 }}>
              Enter an amount between $0.01 and {formatUsd(paidUsd)}.
            </div>
          )}

          <label className="small muted" htmlFor="refund-reason" style={{ display: 'block', marginTop: 14 }}>
            Reason (optional — kept for your records)
          </label>
          <textarea
            id="refund-reason"
            rows={2}
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="e.g. Cancelled 70 days out — full refund per policy"
            style={{ marginTop: 6 }}
          />

          {error && (
            <div
              className="small"
              style={{
                marginTop: 14,
                color: 'var(--danger)',
                background: 'var(--danger-bg)',
                border: '1px solid var(--danger)',
                borderRadius: 'var(--r-sm)',
                padding: '9px 11px',
              }}
              role="alert"
            >
              {error}
            </div>
          )}
        </div>

        <div
          className="row"
          style={{
            borderTop: '1px solid var(--line)',
            padding: '12px 16px',
            justifyContent: 'flex-end',
            gap: 8,
          }}
        >
          <button className="btn btn-sm" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-sm btn-danger" onClick={confirm} disabled={busy || !valid}>
            {busy ? 'Refunding…' : `Refund ${valid ? formatUsd(parsed) : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
