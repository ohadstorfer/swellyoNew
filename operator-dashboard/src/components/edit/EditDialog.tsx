import { useEffect, useState, type ReactNode } from 'react';

export type ConfirmSpec = { title: string; message: string; confirmLabel: string };

/**
 * One editor, one dialog, one Save. The web twin of the app's EditFieldSheet:
 *
 *  - Save is dead until something changed (`dirty`) and the draft is valid
 *    (`problem` is null). The problem is shown, so a dead button explains itself.
 *  - `confirm` turns Save into a second step inside the same dialog — the
 *    app's Alert before a material change. Cancel there goes back to the draft,
 *    never discards it.
 *  - A failed save keeps the dialog open with the draft intact and says why.
 *  - Escape and the scrim close it, except while saving.
 *
 * Below 640px it is a bottom sheet (editTrip.css).
 */
export function EditDialog({
  title,
  sub,
  wide,
  children,
  problem,
  dirty,
  busy,
  error,
  confirm,
  saveLabel = 'Save',
  footNote,
  onSave,
  onClose,
}: {
  title: string;
  sub?: ReactNode;
  wide?: boolean;
  children: ReactNode;
  problem?: string | null;
  dirty: boolean;
  busy: boolean;
  error?: string | null;
  confirm?: ConfirmSpec | null;
  saveLabel?: string;
  footNote?: ReactNode;
  onSave: () => void;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || busy) return;
      if (confirming) setConfirming(false);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, confirming, onClose]);

  // The page behind must not scroll under a sheet on a phone.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const canSave = dirty && !problem && !busy;

  const press = () => {
    if (!canSave) return;
    if (confirm && !confirming) {
      setConfirming(true);
      return;
    }
    onSave();
  };

  return (
    <div
      className="scrim et-scrim"
      onClick={() => !busy && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label={confirming && confirm ? confirm.title : title}
    >
      <div className={`modal et-modal${wide ? ' modal-wide' : ''}`} onClick={e => e.stopPropagation()}>
        <div className="card-head">
          <div style={{ minWidth: 0 }}>
            <strong>{confirming && confirm ? confirm.title : title}</strong>
            {sub && !confirming && <p className="muted small" style={{ marginTop: 2 }}>{sub}</p>}
          </div>
          <button className="btn btn-sm btn-ghost" onClick={onClose} disabled={busy} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="card-body">
          {confirming && confirm ? (
            <p style={{ whiteSpace: 'pre-line' }}>{confirm.message}</p>
          ) : (
            children
          )}
          {(error || (dirty && problem)) && (
            <p className="small et-error" role="alert">
              {error ?? problem}
            </p>
          )}
        </div>

        <div className="et-foot">
          {footNote && !confirming && <span className="muted small et-foot-note">{footNote}</span>}
          <button
            className="btn btn-sm"
            onClick={() => (confirming ? setConfirming(false) : onClose())}
            disabled={busy}
          >
            {confirming ? 'Back' : 'Cancel'}
          </button>
          <button className="btn btn-sm btn-primary" onClick={press} disabled={!canSave}>
            {busy ? 'Saving…' : confirming && confirm ? confirm.confirmLabel : saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** A radio list of cards. */
export function ChoiceList<T extends string>({
  options,
  value,
  onPick,
  columns,
  label,
}: {
  options: { key: T; label: string; desc?: string }[];
  value: T | null;
  onPick: (key: T) => void;
  columns?: boolean;
  label: string;
}) {
  return (
    <div className={`et-choices${columns ? ' et-choices-2' : ''}`} role="radiogroup" aria-label={label}>
      {options.map(o => (
        <button
          key={o.key}
          type="button"
          className="choice"
          role="radio"
          aria-checked={value === o.key}
          aria-pressed={value === o.key}
          onClick={() => onPick(o.key)}
        >
          <span className="et-choice-title">{o.label}</span>
          {o.desc && <span className="et-choice-desc">{o.desc}</span>}
        </button>
      ))}
    </div>
  );
}

/** A multi-select list of cards (or chips, for long lists of short labels). */
export function MultiList<T extends string>({
  options,
  selected,
  onToggle,
  chips,
  columns,
  label,
}: {
  options: { key: T; label: string; desc?: string }[];
  selected: readonly T[];
  onToggle: (key: T) => void;
  chips?: boolean;
  columns?: boolean;
  label: string;
}) {
  if (chips) {
    return (
      <div className="et-chips" role="group" aria-label={label}>
        {options.map(o => (
          <button
            key={o.key}
            type="button"
            className="chip"
            aria-pressed={selected.includes(o.key)}
            onClick={() => onToggle(o.key)}
          >
            {o.label}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className={`et-choices${columns ? ' et-choices-2' : ''}`} role="group" aria-label={label}>
      {options.map(o => (
        <button
          key={o.key}
          type="button"
          className="choice"
          aria-pressed={selected.includes(o.key)}
          onClick={() => onToggle(o.key)}
        >
          <span className="et-choice-title">{o.label}</span>
          {o.desc && <span className="et-choice-desc">{o.desc}</span>}
        </button>
      ))}
    </div>
  );
}

/** Label + counter + input/textarea. */
export function TextField({
  id,
  label,
  value,
  onChange,
  max,
  multiline,
  placeholder,
  autoFocus,
  type = 'text',
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  max?: number;
  multiline?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  type?: 'text' | 'url';
}) {
  return (
    <div className="et-field">
      <label className="et-label" htmlFor={id}>
        <span>{label}</span>
        {max && (
          <span className="et-counter" data-full={value.length >= max}>
            {value.length}/{max}
          </span>
        )}
      </label>
      {multiline ? (
        <textarea
          id={id}
          rows={6}
          value={value}
          maxLength={max}
          placeholder={placeholder}
          autoFocus={autoFocus}
          onChange={e => onChange(max ? e.target.value.slice(0, max) : e.target.value)}
        />
      ) : (
        <input
          id={id}
          className="et-input"
          type={type}
          value={value}
          maxLength={max}
          placeholder={placeholder}
          autoFocus={autoFocus}
          onChange={e => onChange(max ? e.target.value.slice(0, max) : e.target.value)}
        />
      )}
    </div>
  );
}

/** A file picker that looks like the dashed "Add photo" tile. */
export function PhotoPicker({
  label,
  multiple,
  disabled,
  busy,
  className,
  onFiles,
}: {
  label: string;
  multiple?: boolean;
  disabled?: boolean;
  busy?: boolean;
  className?: string;
  onFiles: (files: File[]) => void;
}) {
  return (
    <label
      className={`et-add-photo${className ? ` ${className}` : ''}`}
      aria-disabled={disabled || busy}
      style={disabled || busy ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
    >
      {busy ? 'Uploading…' : label}
      <input
        type="file"
        accept="image/*"
        multiple={multiple}
        disabled={disabled || busy}
        style={{ display: 'none' }}
        onChange={e => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) onFiles(files);
        }}
      />
    </label>
  );
}

/** Width / height of a picked image, for the itinerary's photoRatios. */
export async function imageRatio(file: File): Promise<number | null> {
  try {
    const bmp = await createImageBitmap(file);
    const r = bmp.height > 0 ? bmp.width / bmp.height : null;
    bmp.close?.();
    return r;
  } catch {
    return null;
  }
}
