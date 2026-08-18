import { useState } from 'react';
import { parseUsdInput, validateTripPrice, toCents, fromCents } from '../domain/money';
import { formatUsd } from '../lib/format';

type Props = {
  currentCostPerPerson: number | null;
  currentDepositAmount: number | null;
  /** 'managed' trips freeze everyone first; offline trips have nobody frozen. */
  isManaged: boolean;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onSave: (costPerPerson: number, depositAmount: number | null) => void;
};

/**
 * Change the trip's own price — the default for whoever joins next.
 *
 * The same two numbers the app's Edit-trip screen changes, validated by the
 * same rules (validateTripPrice). No confirmation step, deliberately: on a
 * managed trip everyone already aboard is frozen at their current price before
 * the new one lands (see updateTripPrice), so there is nothing here that can
 * change what an existing traveler owes — the situation the traveler dialog's
 * confirmation exists for.
 */
export function TripPriceDialog({
  currentCostPerPerson,
  currentDepositAmount,
  isManaged,
  busy,
  error,
  onCancel,
  onSave,
}: Props) {
  const [priceText, setPriceText] = useState(
    currentCostPerPerson === null ? '' : String(currentCostPerPerson),
  );
  const [depositText, setDepositText] = useState(
    currentDepositAmount === null ? '' : String(currentDepositAmount),
  );

  const price = parseUsdInput(priceText);
  const deposit = parseUsdInput(depositText);

  const problem = validate(price, deposit, priceText, depositText);
  const canSave = !problem && !busy && price !== null;

  return (
    <div className="scrim" onClick={onCancel} role="dialog" aria-modal="true">
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="card-head">
          <strong>Trip price</strong>
        </div>

        <div className="card-body">
          <label className="small muted" htmlFor="trip-price">
            Price per person (USD)
          </label>
          <input
            id="trip-price"
            type="text"
            inputMode="decimal"
            autoFocus
            value={priceText}
            onChange={e => setPriceText(e.target.value)}
            placeholder="3000"
            style={{ marginTop: 6, width: '100%' }}
          />

          <label
            className="small muted"
            htmlFor="trip-deposit"
            style={{ display: 'block', marginTop: 14 }}
          >
            Deposit (USD)
          </label>
          <input
            id="trip-deposit"
            type="text"
            inputMode="decimal"
            value={depositText}
            onChange={e => setDepositText(e.target.value)}
            placeholder="1000"
            style={{ marginTop: 6, width: '100%' }}
          />
          <p className="muted small" style={{ marginTop: 6 }}>
            {depositHint(price, deposit)}
          </p>

          <p className="muted small" style={{ marginTop: 12 }}>
            {isManaged
              ? 'Everyone already on the trip keeps the price they have now. This is the price for whoever joins next.'
              : 'Payments for this trip happen outside Swellyo. Travelers without their own price will show the new amounts.'}
          </p>

          {(problem || error) && (
            <p className="small" style={{ color: 'var(--danger)', marginTop: 12 }}>
              {problem ?? error}
            </p>
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
          <button className="btn btn-sm" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn btn-sm btn-primary"
            onClick={() => {
              if (canSave && price !== null) onSave(price, deposit);
            }}
            disabled={busy || !canSave}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The deposit field's helper line — the one thing on this dialog that shows a
 * deposit is PART of the price rather than a second, separate price. Same rule
 * as the app's PriceSheetContent: fall back to the static line whenever the
 * split is not computable or would contradict the error already showing.
 */
function depositHint(price: number | null, deposit: number | null): string {
  const NONE = 'Leave empty if travelers pay in one go.';
  if (deposit === null || deposit <= 0) return NONE;
  if (price === null || deposit > price) return NONE;
  // Subtract in cents: 1000.30 - 300.10 has a floating-point tail in dollars.
  const rest = fromCents(toCents(price) - toCents(deposit));
  if (rest === 0) return `Travelers pay the whole ${formatUsd(price)} up front.`;
  return `Travelers pay ${formatUsd(deposit)} now, ${formatUsd(rest)} before the trip.`;
}

/** Typo-shaped input caught before validateTripPrice sees a silent null. */
function validate(
  price: number | null,
  deposit: number | null,
  priceText: string,
  depositText: string,
): string | null {
  if (priceText.trim() !== '' && price === null) {
    return 'That price is not an amount. Use digits, like 3000.';
  }
  if (depositText.trim() !== '' && deposit === null) {
    return 'That deposit is not an amount. Use digits, like 1000.';
  }
  if (priceText.trim() === '') return 'Set the price per person.';
  return validateTripPrice(price, depositText.trim() === '' ? null : deposit);
}
