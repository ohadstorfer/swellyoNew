import { useEffect, useRef, useState } from 'react';
import { groupTripInviteUrl, tripShareMessage } from '../domain/inviteLinks';
import '../styles/tripActions.css';

/**
 * "Share Trip" — the app's `handleShare`, on a desk.
 *
 * Same link (`getGroupTripInviteUrl` → the invite site, `?grouptrip=`), same
 * message. Tokenless: anyone with it opens the trip and asks to join, and the
 * operator still approves them.
 *
 * Copy is the main action because on a laptop the link goes into an email or
 * a WhatsApp Web tab. The system share sheet is offered only where the browser
 * has one, which in practice means a phone.
 */
export function ShareTripDialog({
  tripId,
  tripTitle,
  onClose,
}: {
  tripId: string;
  tripTitle: string;
  onClose: () => void;
}) {
  const url = groupTripInviteUrl(tripId);
  const message = tripShareMessage(tripTitle, url);
  const [copied, setCopied] = useState<'link' | 'message' | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const timer = useRef<number | undefined>(undefined);

  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(timer.current);
    };
  }, [onClose]);

  async function copy(what: 'link' | 'message') {
    try {
      await navigator.clipboard.writeText(what === 'link' ? url : message);
      setCopyFailed(false);
      setCopied(what);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard can be refused (insecure origin, permissions). Select the
      // text so a manual Cmd/Ctrl+C still works, and say so.
      setCopyFailed(true);
      field.current?.select();
    }
  }

  async function nativeShare() {
    try {
      // Text without the URL, plus `url`: share targets that read both would
      // otherwise paste the link twice.
      await navigator.share({
        title: tripTitle,
        text: message.slice(0, message.lastIndexOf('\n')),
        url,
      });
    } catch {
      // Cancelled, or the target refused — nothing to report, same as the app.
    }
  }

  return (
    <div className="scrim" onClick={onClose} role="dialog" aria-modal="true" aria-label="Share trip">
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="card-body">
          <h2 style={{ marginBottom: 8 }}>Share {tripTitle}</h2>
          <p className="muted small">
            Anyone with this link can open the trip in Swellyo and ask to join. You still approve
            every request.
          </p>

          <div className="row" style={{ gap: 8, marginTop: 16 }}>
            <input
              ref={field}
              type="text"
              readOnly
              value={url}
              className="ta-link"
              aria-label="Trip link"
              onFocus={e => e.currentTarget.select()}
            />
            <button className="btn btn-sm btn-primary" onClick={() => void copy('link')}>
              {copied === 'link' ? 'Copied' : 'Copy link'}
            </button>
          </div>

          {copyFailed && (
            <p className="small" style={{ color: 'var(--danger)', marginTop: 8 }}>
              Your browser blocked copying. The link is selected — press Ctrl+C (⌘C on a Mac).
            </p>
          )}

          <div className="row" style={{ gap: 8, marginTop: 20, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button className="btn btn-sm" onClick={() => void copy('message')}>
              {copied === 'message' ? 'Copied' : 'Copy with a message'}
            </button>
            {canNativeShare && (
              <button className="btn btn-sm" onClick={() => void nativeShare()}>
                Share…
              </button>
            )}
            <button className="btn btn-sm" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
