import { useState } from 'react';
import { checkPriceChange, parseUsdInput } from '../domain/money';
import { formatUsd } from '../lib/format';

type Props = {
  travelerName: string;
  /** What they are on today — their frozen price, or the trip default. */
  currentTotalUsd: number | null;
  currentDepositUsd: number | null;
  /**
   * Does the trip have a deposit step?
   *
   * When it does not, the deposit field is HIDDEN, not just disabled. A trip
   * created with a blank deposit publishes a `balance` row alone, so a deposit
   * written here could never be collected: the balance would shrink by it,
   * every step would read as paid, and the operator would be quietly short.
   * The server refuses it too — this is the half the operator can see.
   */
  hasDepositStep: boolean;
  /** Everything they have paid so far. Drives the confirm and the block. */
  paidUsd: number;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onSave: (totalUsd: number, depositUsd: number | null) => void;
};

/**
 * Set one traveler's price.
 *
 * Every rule below is also enforced by operator_set_traveler_price. They are
 * repeated here so the operator finds out before submitting, not after — the
 * server's errors are raw Postgres text.
 *
 * The one rule the server does NOT have is the overpayment block. See
 * checkPriceChange().
 */
export function TravelerPriceDialog({
  travelerName,
  currentTotalUsd,
  currentDepositUsd,
  hasDepositStep,
  paidUsd,
  busy,
  error,
  onCancel,
  onSave,
}: Props) {
  const [totalText, setTotalText] = useState(
    currentTotalUsd === null ? '' : String(currentTotalUsd),
  );
  const [depositText, setDepositText] = useState(
    currentDepositUsd === null ? '' : String(currentDepositUsd),
  );
  const [confirming, setConfirming] = useState<string | null>(null);

  const total = parseUsdInput(totalText);
  const deposit = hasDepositStep ? parseUsdInput(depositText) : null;

  const problem = validate(total, deposit, totalText, depositText);
  const change =
    problem || total === null
      ? null
      : checkPriceChange({ travelerName, newTotalUsd: total, paidUsd, currentTotalUsd });

  const blocked = change && !change.ok ? change.reason : null;
  const canSave = !problem && !blocked && !busy && total !== null;

  function submit() {
    if (!canSave || total === null) return;
    if (change && change.ok && change.confirm) {
      setConfirming(change.confirm);
      return;
    }
    onSave(total, deposit);
  }

  if (confirming && total !== null) {
    return (
      <div className="scrim" onClick={onCancel} role="dialog" aria-modal="true">
        <div className="modal" onClick={e => e.stopPropagation()}>
          <div className="card-head">
            <strong>Change what {travelerName} owes?</strong>
          </div>
          <div className="card-body">
            <p className="small">{confirming}</p>
            <p className="muted small" style={{ marginTop: 10 }}>
              Swellyo does not tell them. Let {travelerName} know yourself.
            </p>
            {error && (
              <p className="small" style={{ color: 'var(--danger)', marginTop: 10 }}>
                {error}
              </p>
            )}
          </div>
          <Footer
            onCancel={() => setConfirming(null)}
            cancelLabel="Back"
            confirmLabel={busy ? 'Saving…' : 'Change the price'}
            onConfirm={() => onSave(total, deposit)}
            busy={busy}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="scrim" onClick={onCancel} role="dialog" aria-modal="true">
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="card-head">
          <strong>{travelerName}'s price</strong>
        </div>

        <div className="card-body">
          <label className="small muted" htmlFor="price-total">
            Total price (USD)
          </label>
          <input
            id="price-total"
            type="text"
            inputMode="decimal"
            autoFocus
            value={totalText}
            onChange={e => setTotalText(e.target.value)}
            placeholder="3000"
            style={{ marginTop: 6, width: '100%' }}
          />

          {hasDepositStep && (
            <>
              <label
                className="small muted"
                htmlFor="price-deposit"
                style={{ display: 'block', marginTop: 14 }}
              >
                Deposit (USD) — leave empty to use the trip's deposit
              </label>
              <input
                id="price-deposit"
                type="text"
                inputMode="decimal"
                value={depositText}
                onChange={e => setDepositText(e.target.value)}
                placeholder="1000"
                style={{ marginTop: 6, width: '100%' }}
              />
            </>
          )}

          {!hasDepositStep && (
            <p className="muted small" style={{ marginTop: 12 }}>
              This trip takes one single payment, so there is no deposit to set.
            </p>
          )}

          {paidUsd > 0 && !blocked && (
            <p className="muted small" style={{ marginTop: 12 }}>
              Paid so far: {formatUsd(paidUsd)}
            </p>
          )}

          {(problem || blocked || error) && (
            <p className="small" style={{ color: 'var(--danger)', marginTop: 12 }}>
              {problem ?? blocked ?? error}
            </p>
          )}
        </div>

        <Footer
          onCancel={onCancel}
          cancelLabel="Cancel"
          confirmLabel={busy ? 'Saving…' : 'Save'}
          onConfirm={submit}
          busy={busy || !canSave}
        />
      </div>
    </div>
  );
}

function Footer({
  onCancel,
  cancelLabel,
  onConfirm,
  confirmLabel,
  busy,
}: {
  onCancel: () => void;
  cancelLabel: string;
  onConfirm: () => void;
  confirmLabel: string;
  busy?: boolean;
}) {
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
      <button className="btn btn-sm" onClick={onCancel}>
        {cancelLabel}
      </button>
      <button className="btn btn-sm btn-primary" onClick={onConfirm} disabled={busy}>
        {confirmLabel}
      </button>
    </div>
  );
}

/** The server's own rules, checked early so the operator is not surprised. */
function validate(
  total: number | null,
  deposit: number | null,
  totalText: string,
  depositText: string,
): string | null {
  if (totalText.trim() === '') return 'A total price is required.';
  if (total === null) return 'That total is not an amount. Use digits, like 3000.';
  if (total < 0) return 'A price cannot be negative.';

  if (depositText.trim() !== '') {
    if (deposit === null) return 'That deposit is not an amount. Use digits, like 1000.';
    if (deposit < 0) return 'A deposit cannot be negative.';
    if (deposit > total) return 'The deposit cannot be more than the total price.';
  }
  return null;
}
