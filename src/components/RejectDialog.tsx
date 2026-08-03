import { useState } from 'react';

type Props = {
  travelerName: string;
  requirementTitle: string;
  onCancel: () => void;
  onConfirm: (note: string | undefined) => void;
  busy?: boolean;
};

/**
 * Rejecting is not undoable, so it says so plainly.
 *
 * The reason is optional on purpose — forcing a field makes operators type
 * "bad" sixty times. But rejecting without a word leaves the traveler guessing,
 * which is why the box is right here and pre-focused rather than buried behind
 * a separate "message" action.
 */
export function RejectDialog({
  travelerName,
  requirementTitle,
  onCancel,
  onConfirm,
  busy,
}: Props) {
  const [note, setNote] = useState('');

  return (
    <div className="scrim" onClick={onCancel} role="dialog" aria-modal="true">
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="card-head">
          <strong>Reject this {requirementTitle.toLowerCase()}?</strong>
        </div>

        <div className="card-body">
          <p className="small" style={{ marginBottom: 12 }}>
            This deletes {travelerName}'s file and asks them to upload a new one. They get a
            notification. <strong>It cannot be undone.</strong>
          </p>

          <label className="small muted" htmlFor="reject-note">
            Reason (optional — they will see it)
          </label>
          <textarea
            id="reject-note"
            rows={3}
            autoFocus
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="e.g. The photo is too blurry to read the number"
            style={{ marginTop: 6 }}
          />
        </div>

        <div
          className="row"
          style={{ borderTop: '1px solid var(--line)', padding: '12px 16px', justifyContent: 'flex-end', gap: 8 }}
        >
          <button className="btn btn-sm" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn btn-sm btn-danger"
            onClick={() => onConfirm(note.trim() || undefined)}
            disabled={busy}
          >
            {busy ? 'Rejecting…' : 'Delete and ask again'}
          </button>
        </div>
      </div>
    </div>
  );
}
