import type { ReactNode } from 'react';
import { useEffect } from 'react';

/**
 * A yes/no question in the site's modal. The web twin of the app's
 * `Alert.alert` confirms, used for actions that reach a real person (a push)
 * or cannot be undone. Escape and the scrim cancel, except while busy.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  cancelLabel = 'Cancel',
  danger = false,
  busy = false,
  busyLabel,
  error,
  onConfirm,
  onCancel,
}: {
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  busyLabel?: string;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  return (
    <div
      className="scrim"
      onClick={busy ? undefined : onCancel}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="card-body">
          <h2 style={{ marginBottom: 8 }}>{title}</h2>
          {children && <div className="muted small">{children}</div>}
          {error && (
            <p className="small" style={{ color: 'var(--danger)', marginTop: 12 }}>
              {error}
            </p>
          )}
          <div
            className="row"
            style={{ gap: 8, marginTop: 20, justifyContent: 'flex-end', flexWrap: 'wrap' }}
          >
            <button className="btn btn-sm" onClick={onCancel} disabled={busy}>
              {cancelLabel}
            </button>
            <button
              className={`btn btn-sm ${danger ? 'btn-danger' : 'btn-primary'}`}
              onClick={onConfirm}
              disabled={busy}
              autoFocus
            >
              {busy ? (busyLabel ?? confirmLabel) : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
