import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PolicyFields } from './PolicyFields';
import { replaceTripWaiver, setTripCancellationPolicy } from '../services/actions';
import { policyFromTrip, validate, PRESET_LABEL, explain } from '../domain/cancellation';
import { friendlyError } from '../lib/errors';
import type { OperatorTrip } from '../services/trips';

/**
 * This trip's refund terms, editable while nobody has joined.
 *
 * Product Specs §"Manage trip": "Only before any traveler joined: replace
 * waiver (for this trip specifically), edit cancellation policy (for this trip
 * specifically)."
 *
 * ── The terms are frozen, and that is the feature ──────────────────────────
 * A trip's policy is copied at publish and never follows the operator's
 * default afterwards, because a traveler agreed to THESE words on the way to
 * Stripe. This card is the one crack in that: an operator who published with
 * the wrong terms can fix them until the first person joins.
 *
 * ── Read-only, not hidden, once somebody is on the trip ────────────────────
 * The opposite of the app, which hides the row. Here there is room to say what
 * the terms ARE — and on a page an operator opens to answer a traveler's
 * question, showing the frozen policy is more useful than showing nothing. The
 * editor is what goes away.
 *
 * ── The client's half of the rule ──────────────────────────────────────────
 * The wall is `trg_guard_operator_trip_cancellation_policy` (20260904000100),
 * which refuses on three tests. Two of them this card can make — the caller is
 * the operator of record, and nobody else has joined. The third it cannot: RLS
 * shows this client only its OWN consent rows, so "has anyone agreed to these
 * terms" is a count only the server can take. When that one fires, the message
 * comes back from Postgres and is shown as it is.
 */
export function TripPolicyCard({
  trip,
  canEdit,
  travelersJoined,
}: {
  trip: OperatorTrip;
  /** The operator of record. Refund terms are money, and money authorises on
   *  `host_id` everywhere else in this product — decision D2. */
  canEdit: boolean;
  travelersJoined: number;
}) {
  const qc = useQueryClient();
  // `policyFromTrip` takes the RAW column names — it is shared with code that
  // reads `group_trips` directly, and `OperatorTrip` is this project's camelCase
  // view of the same three columns.
  const stored = policyFromTrip({
    cancellation_preset: trip.cancellationPreset,
    cancellation_rules: trip.cancellationRules,
    cancellation_notes: trip.cancellationNotes,
  });
  const [draft, setDraft] = useState(stored ?? { preset: 'standard' as const, rules: [], notes: null });
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => setTripCancellationPolicy(trip.id, draft),
    onSuccess: () => {
      setOpen(false);
      setError(null);
      void qc.invalidateQueries({ queryKey: ['trip', trip.id] });
    },
    onError: e => setError(friendlyError(e)),
  });

  const editable = canEdit && travelersJoined === 0;
  const problems = validate(draft);

  return (
    <div className="card enter">
      <div className="card-head">
        <h2>Cancellation policy</h2>
        {editable && !open && (
          <button
            className="btn btn-sm"
            onClick={() => {
              setDraft(stored ?? { preset: 'standard', rules: [], notes: null });
              setOpen(true);
            }}
          >
            {stored ? 'Change' : 'Set it'}
          </button>
        )}
      </div>

      <div className="card-body">
        {open ? (
          <>
            <p className="muted small" style={{ marginBottom: 16 }}>
              These terms are frozen on this trip. You can change them until the first traveler
              joins — after that they are what somebody agreed to.
            </p>
            <PolicyFields value={draft} onChange={setDraft} disabled={save.isPending} />
            {error && (
              <p className="small" style={{ color: 'var(--danger)', marginTop: 8 }}>
                {error}
              </p>
            )}
            <div className="row" style={{ gap: 8, marginTop: 16 }}>
              <button
                className="btn btn-primary btn-sm"
                disabled={problems.length > 0 || save.isPending}
                onClick={() => save.mutate()}
              >
                {save.isPending ? 'Saving…' : 'Save these terms'}
              </button>
              <button
                className="btn btn-sm"
                disabled={save.isPending}
                onClick={() => {
                  setOpen(false);
                  setError(null);
                }}
              >
                Cancel
              </button>
            </div>
          </>
        ) : !stored ? (
          <p className="muted small">
            This trip states no refund terms. Travelers see nothing about what happens if they
            pull out.
          </p>
        ) : (
          <>
            <strong className="small">{PRESET_LABEL[stored.preset]}</strong>
            <div style={{ marginTop: 8 }}>
              {explain(stored).map((l, i) => (
                <div key={i} className="small muted" style={{ lineHeight: 1.6 }}>
                  • {l}
                </div>
              ))}
            </div>
            {stored.notes && (
              <p className="small muted" style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>
                {stored.notes}
              </p>
            )}
            {!editable && (
              <p className="muted small" style={{ marginTop: 12 }}>
                {travelersJoined > 0
                  ? 'Frozen — travelers have joined on these terms.'
                  : 'Only the operator of this trip can change the refund terms.'}
              </p>
            )}
          </>
        )}

        {/* ── The waiver ────────────────────────────────────────────────── */}
        {/* The other half of the same sentence in the spec — "replace waiver
            (for this trip specifically), edit cancellation policy (for this
            trip specifically)" — and it opens and closes at the same moment,
            so it belongs in the same card rather than a second one repeating
            the same caveat. */}
        {editable && (
          <div style={{ borderTop: '1px solid var(--line)', marginTop: 16, paddingTop: 16 }}>
            <WaiverSwap tripId={trip.id} />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Swap the trip's waiver PDF, while the trip is still empty.
 *
 * Deliberately quiet: it is the rarer of the two things in this card, and it
 * only exists for the operator who uploaded the wrong file at publish.
 */
function WaiverSwap({ tripId }: { tripId: string }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const swap = useMutation({
    mutationFn: (file: File) => replaceTripWaiver(tripId, file),
    onMutate: () => {
      setError(null);
      setDone(false);
    },
    onSuccess: () => {
      setDone(true);
      void qc.invalidateQueries({ queryKey: ['review', tripId] });
    },
    onError: e => setError(friendlyError(e)),
  });

  return (
    <div className="row-between" style={{ gap: 12 }}>
      <span className="muted small">
        {error ??
          (done
            ? 'Waiver replaced. Anyone joining from now on agrees to the new one.'
            : 'Uploaded the wrong waiver? Swap the PDF while the trip is empty.')}
      </span>
      <label className="btn btn-sm" style={{ cursor: 'pointer', flexShrink: 0 }}>
        {swap.isPending ? 'Uploading…' : 'Replace the waiver'}
        <input
          type="file"
          accept="application/pdf"
          hidden
          disabled={swap.isPending}
          onChange={e => {
            const f = e.target.files?.[0];
            // Cleared so picking the SAME file again still fires a change.
            e.target.value = '';
            if (f) swap.mutate(f);
          }}
        />
      </label>
    </div>
  );
}
