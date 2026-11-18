import { useState } from 'react';
import { parseUsdInput, validateTripPrice, toCents, fromCents } from '../domain/money';
import { formatUsd } from '../lib/format';

type Props = {
  currentCostPerPerson: number | null;
  currentDepositAmount: number | null;
  /** 'managed' trips freeze everyone first; offline trips have nobody frozen. */
  isManaged: boolean;
  /**
   * The Edit trip page passes this to show a third field. Left undefined (the
   * Money page), the field is not rendered and `onSave` never gets a third
   * argument — `updateTripPrice` then leaves the column alone.
   */
  currentPrivateRoomPrice?: number | null;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onSave: (
    costPerPerson: number,
    depositAmount: number | null,
    privateRoomPrice?: number | null,
  ) => void;
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
  currentPrivateRoomPrice,
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

  const withPrivateRoom = currentPrivateRoomPrice !== undefined;
  const [roomText, setRoomText] = useState(
    currentPrivateRoomPrice == null ? '' : String(currentPrivateRoomPrice),
  );

  const price = parseUsdInput(priceText);
  const deposit = parseUsdInput(depositText);
  const room = parseUsdInput(roomText);

  const problem =
    validate(price, deposit, priceText, depositText) ??
    (withPrivateRoom ? validateRoom(room, deposit, roomText) : null);
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
            style={{ marginTop: 8, width: '100%' }}
          />

          <label
            className="small muted"
            htmlFor="trip-deposit"
            style={{ display: 'block', marginTop: 16 }}
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
            style={{ marginTop: 8, width: '100%' }}
          />
          <p className="muted small" style={{ marginTop: 8 }}>
            {depositHint(price, deposit)}
          </p>

          {withPrivateRoom && (
            <>
              <label
                className="small muted"
                htmlFor="trip-private-room"
                style={{ display: 'block', marginTop: 16 }}
              >
                Private room price (USD)
              </label>
              <input
                id="trip-private-room"
                type="text"
                inputMode="decimal"
                value={roomText}
                onChange={e => setRoomText(e.target.value)}
                placeholder="Leave empty for no private room"
                style={{ marginTop: 8, width: '100%' }}
              />
              <p className="muted small" style={{ marginTop: 8 }}>
                Travelers who already picked a private room keep their own price.
              </p>
            </>
          )}

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
            padding: '16px 24px',
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
              if (!canSave || price === null) return;
              if (withPrivateRoom) {
                // 0 or blank = no private room (`group_trips_private_room_price_check`
                // refuses 0). A typed 0 deposit is likewise "no deposit".
                onSave(price, deposit, room !== null && room > 0 ? room : null);
              } else {
                onSave(price, deposit);
              }
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

/** `group_trips_private_room_price_check`: above 0, and the deposit no more
 *  than it. Blank or 0 means no private room. */
function validateRoom(room: number | null, deposit: number | null, roomText: string): string | null {
  if (roomText.trim() !== '' && room === null) {
    return 'That private room price is not an amount. Use digits, like 1500.';
  }
  if (room === null || room <= 0) return null;
  if (deposit !== null && deposit > room) return 'The deposit can’t be more than the private room price.';
  return null;
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
