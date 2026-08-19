import { useState } from 'react';
import { formatUsd } from '../lib/format';
import { explain, refundPctFor, suggestedRefundUsd, type CancellationPolicy } from '../domain/cancellation';
import { badRefunds, refundTraveler, removeTraveler, sentUsd } from '../services/removal';

type Choice = 'everything' | 'policy' | 'custom';

type Props = {
  tripId: string;
  userId: string;
  travelerName: string;
  /** What this person has paid, NET of refunds already issued. */
  paidUsd: number;
  /** Paid outside Swellyo. `paidUsd` is then 0 because Swellyo has no ledger
   *  for this trip — which is NOT the same as "they paid nothing", and the
   *  dialog must not say that it is. */
  isOffline: boolean;
  /** The trip's own frozen terms, or null when it never stated any. */
  policy: CancellationPolicy | null;
  /** `group_trips.start_date`. Without it no refund window can be measured. */
  tripStartDate: string | null;
  /**
   * Does this viewer hold `money.manage`?
   *
   * A Manager can hold `travelers.remove` without it. They then cannot refund,
   * and removing a paid traveler would strand the money — so the dialog refuses
   * and names who can. `trip-cancel` enforces the same rule; this is the half
   * that explains it.
   */
  canRefund: boolean;
  onCancel: () => void;
  /** Removed. The page navigates away and refetches. */
  onDone: () => void;
};

/**
 * Remove one traveler, and decide their money first.
 *
 * The desktop twin of the app's `RemoveTravelerSheet` — same three options,
 * same order, same refusals.
 *
 * ── Why this asks, when cancelling does not ─────────────────────────────────
 * Cancelling a trip has one possible reason — the operator called it off — so
 * it refunds everyone in full and offers no choice. Removing one person has
 * several, and the money follows the reason: someone who backed out is governed
 * by the frozen policy, an operator clearing a spot owes it all back, someone
 * dropped for never sending their documents is a judgement call. Nothing can
 * tell those apart, so this asks for the AMOUNT — the only part of the reason
 * with consequences — and pre-computes the policy's answer.
 *
 * ⚠️ THE ORDER IS REFUND, THEN REMOVE. But a refund that fails must not trap
 * the operator: the dialog says what happened and still offers to remove,
 * carrying whatever actually went back into the removal push.
 */
export function RemoveTravelerDialog({
  tripId,
  userId,
  travelerName,
  paidUsd,
  isOffline,
  policy,
  tripStartDate,
  canRefund,
  onCancel,
  onDone,
}: Props) {
  const policyPct = refundPctFor(policy, tripStartDate);
  const policyUsd = suggestedRefundUsd({ policy, tripStartDate, paidUsd });

  /**
   * Show the policy option only when it says something "Everything" does not.
   *
   * At 100% the two rows are the same amount, and offering the same number
   * twice makes the operator stop and work out the difference — there isn't
   * one. ⚠️ Null suppresses it for a different reason: null means the trip
   * never stated terms (every trip published before the policy columns), and
   * rendering "$0, per the policy" would invent one.
   */
  const hasPolicy = policyUsd !== null && policyPct !== null && policyUsd !== paidUsd;

  const [choice, setChoice] = useState<Choice>(hasPolicy ? 'policy' : 'everything');
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState<'refunding' | 'removing' | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Set when the refund was refused but the removal is still on the table. */
  const [refundFailed, setRefundFailed] = useState<string | null>(null);
  /**
   * What DID go back when a refund only partly succeeded.
   *
   * A traveler whose deposit was refunded but whose balance was blocked has
   * still had money returned, and "Remove anyway" must tell them about it —
   * reporting 0 there would be a lie in the direction that costs us trust.
   */
  const [partialUsd, setPartialUsd] = useState(0);

  const typed = Number(custom);
  const typedValid =
    custom.trim() !== '' && Number.isFinite(typed) && typed >= 0 && typed <= paidUsd + 0.001;

  const amount: number | null =
    choice === 'everything' ? paidUsd : choice === 'policy' ? policyUsd : typedValid ? typed : null;

  async function finishRemoval(refundedUsd = 0) {
    setBusy('removing');
    try {
      await removeTraveler({ tripId, userId, refundedUsd });
      onDone();
    } catch (e: any) {
      setBusy(null);
      setError(e?.message ?? 'Could not remove them. Please try again.');
    }
  }

  async function submit() {
    if (busy || amount === null) return;
    setError(null);
    setRefundFailed(null);

    // Zero skips the refund call entirely — no rows, no Stripe, no audit noise.
    if (amount <= 0) {
      await finishRemoval();
      return;
    }

    setBusy('refunding');
    let result;
    try {
      result = await refundTraveler({ tripId, userId, amountUsd: amount });
    } catch (e: any) {
      setBusy(null);
      // The refund did not happen — but removing them may still be what the
      // operator needs today. Offer it rather than making them start over.
      setRefundFailed(e?.message ?? 'Could not issue the refund.');
      return;
    }

    // What actually went back, not what was asked for. The push quotes this.
    const sent = sentUsd(result.refunds);
    const bad = badRefunds(result.refunds);

    if (result.error || bad.length > 0) {
      setBusy(null);
      setPartialUsd(sent);
      setRefundFailed(result.error ?? bad[0]?.message ?? 'Part of the refund did not go through.');
      return;
    }

    await finishRemoval(sent);
  }

  // ── A Manager cannot do this ─────────────────────────────────────────────
  if (paidUsd > 0 && !canRefund) {
    return (
      <Scrim onCancel={onCancel}>
        <div className="card-head">
          <strong>Remove {travelerName}?</strong>
        </div>
        <div className="card-body">
          <p className="small" style={{ marginBottom: 12 }}>
            They have paid {formatUsd(paidUsd)}.
          </p>
          <div
            className="small"
            style={{
              background: 'var(--warn-bg)',
              color: 'var(--warn)',
              border: '1px solid var(--warn)',
              borderRadius: 'var(--r-sm)',
              padding: '9px 11px',
            }}
          >
            Only the trip's operator can remove a traveler who has paid, because only they can
            issue the refund. Ask them to do it, or message {travelerName} first.
          </div>
        </div>
        <Footer>
          <button className="btn btn-sm" onClick={onCancel}>
            Close
          </button>
        </Footer>
      </Scrim>
    );
  }

  const policyLines = policy ? explain(policy) : [];

  return (
    <Scrim onCancel={busy ? undefined : onCancel}>
      <div className="card-head">
        <strong>Remove {travelerName}?</strong>
      </div>

      <div className="card-body">
        <p className="small" style={{ marginBottom: 14 }}>
          {paidUsd > 0
            ? `They have paid ${formatUsd(paidUsd)}. `
            : isOffline
              ? 'This trip is paid outside Swellyo, so nothing is refunded here. '
              : 'They have not paid anything. '}
          They lose access to the plan and the group chat.{' '}
          <strong>This cannot be undone.</strong>
        </p>

        {paidUsd > 0 && (
          <>
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
                {policyPct !== null
                  ? `This trip's policy · ${policyPct}% at today's date`
                  : "This trip's cancellation policy"}
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
                  This trip never set a cancellation policy, so what you send back is entirely
                  your call.
                </div>
              )}
            </div>

            <div role="radiogroup" aria-label="How much to refund">
            <Option
              selected={choice === 'everything'}
              onSelect={() => setChoice('everything')}
              title={`Everything · ${formatUsd(paidUsd)}`}
              sub="You are removing them, not the other way round."
            />

            {hasPolicy && (
              <Option
                selected={choice === 'policy'}
                onSelect={() => setChoice('policy')}
                title={`What the policy gives · ${formatUsd(policyUsd!)}`}
                sub={`${policyPct}% at today's date.`}
              />
            )}

            <Option
              selected={choice === 'custom'}
              onSelect={() => setChoice('custom')}
              title="Something else"
              sub={`Anything from $0 to ${formatUsd(paidUsd)}.`}
            >
              {choice === 'custom' && (
                <>
                  <input
                    type="text"
                    inputMode="decimal"
                    autoFocus
                    value={custom}
                    onChange={e => setCustom(e.target.value)}
                    placeholder="0.00"
                    style={{ marginTop: 8 }}
                  />
                  {!typedValid && custom.trim() !== '' && (
                    <div className="small" style={{ color: 'var(--danger)', marginTop: 6 }}>
                      Enter an amount between $0 and {formatUsd(paidUsd)}.
                    </div>
                  )}
                </>
              )}
            </Option>
            </div>
          </>
        )}

        {refundFailed && (
          <div
            className="small"
            role="alert"
            style={{
              marginTop: 14,
              color: 'var(--warn)',
              background: 'var(--warn-bg)',
              border: '1px solid var(--warn)',
              borderRadius: 'var(--r-sm)',
              padding: '9px 11px',
            }}
          >
            {refundFailed}
            {partialUsd > 0 && ` ${formatUsd(partialUsd)} did go back.`} You can still remove
            them and sort the money out in Stripe.
          </div>
        )}

        {error && (
          <div
            className="small"
            role="alert"
            style={{
              marginTop: 14,
              color: 'var(--danger)',
              background: 'var(--danger-bg)',
              border: '1px solid var(--danger)',
              borderRadius: 'var(--r-sm)',
              padding: '9px 11px',
            }}
          >
            {error}
          </div>
        )}
      </div>

      <Footer>
        <button className="btn btn-sm" onClick={onCancel} disabled={!!busy}>
          Cancel
        </button>
        {refundFailed ? (
          // The refund is settled — it did not happen, or only partly did. The
          // remaining decision is whether they still come off the trip.
          <button
            className="btn btn-sm btn-danger"
            onClick={() => void finishRemoval(partialUsd)}
            disabled={busy === 'removing'}
          >
            {busy === 'removing' ? 'Removing…' : 'Remove anyway'}
          </button>
        ) : (
          <button
            className="btn btn-sm btn-danger"
            onClick={() => void submit()}
            disabled={!!busy || amount === null}
          >
            {busy === 'refunding'
              ? 'Refunding…'
              : busy === 'removing'
                ? 'Removing…'
                : paidUsd > 0 && amount
                  ? `Refund ${formatUsd(amount)} and remove`
                  : 'Remove from trip'}
          </button>
        )}
      </Footer>
    </Scrim>
  );
}

function Scrim({ children, onCancel }: { children: React.ReactNode; onCancel?: () => void }) {
  return (
    <div className="scrim" onClick={onCancel} role="dialog" aria-modal="true">
      <div className="modal" onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function Footer({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="row"
      style={{
        borderTop: '1px solid var(--line)',
        padding: '12px 16px',
        justifyContent: 'flex-end',
        gap: 8,
      }}
    >
      {children}
    </div>
  );
}

function Option({
  selected,
  onSelect,
  title,
  sub,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  sub: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      role="radio"
      aria-checked={selected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      style={{
        border: `1px solid ${selected ? 'var(--cyan)' : 'var(--line)'}`,
        background: selected ? 'var(--panel)' : 'transparent',
        borderRadius: 'var(--r-sm)',
        padding: '10px 12px',
        marginBottom: 8,
        cursor: 'pointer',
      }}
    >
      <div className="small">
        <strong>{title}</strong>
      </div>
      <div className="muted small" style={{ marginTop: 2 }}>
        {sub}
      </div>
      {children}
    </div>
  );
}
