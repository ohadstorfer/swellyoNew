import { useEffect, useState } from 'react';
import { signedUrl, downloadOne, safeFileName } from '../services/files';
import { fileNameFor, formatDate } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { Spinner, StateTag } from './StateBits';
import type { ReviewItem } from '../services/review';

type Props = {
  item: ReviewItem;
  travelerName: string;
  onClose: () => void;
  onApprove: () => void;
  onReject: () => void;
  busy?: boolean;
};

/**
 * Look at one document and decide.
 *
 * Approve lives here rather than in a separate queue on purpose. A queue of 60
 * deliberate approvals with no consequence for skipping them decays — operators
 * stop grinding it, approved counts stay low, and the number we added to make
 * the dashboard trustworthy becomes the one nobody trusts. One click, while
 * looking at the thing, is the whole design.
 */
export function DocumentViewer({
  item,
  travelerName,
  onClose,
  onApprove,
  onReject,
  busy,
}: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setUrl(null);
    setError(null);

    if (!item.storagePath || item.fileDeleted) return;

    // A fresh link every time the viewer opens — they expire in a minute.
    signedUrl(item.storagePath, 120)
      .then(u => alive && setUrl(u))
      .catch(e => alive && setError(friendlyError(e)));

    return () => {
      alive = false;
    };
  }, [item.storagePath, item.fileDeleted]);

  // Escape closes. Expected of anything that covers the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isPdf = (item.storagePath ?? '').toLowerCase().endsWith('.pdf');

  return (
    <div className="scrim" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal modal-wide" onClick={e => e.stopPropagation()}>
        <div className="card-head">
          <div>
            <strong>{travelerName}</strong>
            <span className="muted small"> · {item.title}</span>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <StateTag state={item.state} />
            <button className="btn btn-sm" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <div
          style={{
            flex: 1,
            overflow: 'auto',
            background: 'var(--panel-2)',
            display: 'grid',
            placeItems: 'center',
            minHeight: 320,
            padding: 16,
          }}
        >
          {item.fileDeleted && (
            <p className="muted small" style={{ textAlign: 'center' }}>
              File deleted after 30 days.
              <br />
              The record stays, the file does not.
            </p>
          )}
          {!item.fileDeleted && !item.storagePath && (
            <p className="muted small">Nothing uploaded yet.</p>
          )}
          {!item.fileDeleted && item.storagePath && !url && !error && <Spinner />}
          {error && (
            <p className="small" style={{ color: 'var(--danger)' }}>
              {error}
            </p>
          )}
          {url && isPdf && (
            <iframe
              src={url}
              title={`${travelerName} — ${item.title}`}
              style={{ width: '100%', height: '62vh', border: 0, background: '#fff' }}
            />
          )}
          {url && !isPdf && (
            <img
              src={url}
              alt={`${travelerName} — ${item.title}`}
              style={{ maxWidth: '100%', maxHeight: '62vh', borderRadius: 6 }}
            />
          )}
        </div>

        {/* Passport typed fields survive the 30-day purge, so show them even
            when the file itself is gone. */}
        {(item.fullName || item.nationality || item.expiryDate) && (
          <div className="card-body" style={{ borderTop: '1px solid var(--line)' }}>
            <p className="small">
              {item.fullName && <>Name: <strong>{item.fullName}</strong></>}
              {item.nationality && <> · Nationality: <strong>{item.nationality}</strong></>}
              {item.expiryDate && <> · Expires: <strong>{formatDate(item.expiryDate)}</strong></>}
            </p>
          </div>
        )}

        {item.note && (
          <div className="card-body" style={{ borderTop: '1px solid var(--line)' }}>
            <p className="small muted">Note: {item.note}</p>
          </div>
        )}

        <div
          className="row-between"
          style={{ borderTop: '1px solid var(--line)', padding: '12px 16px' }}
        >
          <span className="muted small">
            {item.submittedAt ? `Uploaded ${formatDate(item.submittedAt)}` : 'Not uploaded'}
          </span>
          <div className="row" style={{ gap: 8 }}>
            {item.storagePath && !item.fileDeleted && (
              <button
                className="btn btn-sm"
                onClick={() =>
                  void downloadOne(
                    item.storagePath!,
                    fileNameFor(item.storagePath, safeFileName(`${travelerName} - ${item.title}`)),
                  )
                }
              >
                Download
              </button>
            )}
            {item.documentId && item.state !== 'rejected' && (
              <button className="btn btn-sm btn-danger" onClick={onReject} disabled={busy}>
                Reject
              </button>
            )}
            {item.documentId && item.state === 'submitted' && (
              <button className="btn btn-sm btn-primary" onClick={onApprove} disabled={busy}>
                {busy ? 'Approving…' : 'Approve'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
