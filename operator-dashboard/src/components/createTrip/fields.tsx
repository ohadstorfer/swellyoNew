import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { DestinationGeo } from '../../domain/createTrip';
import { autocomplete, newSessionToken, placeDetails, PLACES_KEY, type PlaceSuggestion } from '../../services/places';

export function Section({
  title,
  body,
  error,
  right,
  children,
  id,
}: {
  title: string;
  body?: ReactNode;
  error?: string;
  right?: ReactNode;
  children?: ReactNode;
  id?: string;
}) {
  return (
    <section className="ct-section" data-error={!!error} id={id}>
      <div className="ct-section-head">
        <h3>{title}</h3>
        {right}
      </div>
      {body && <p className="muted small">{body}</p>}
      {children}
      {error && (
        <p className="ct-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="ct-field">
      <span className="ct-label">{label}</span>
      {children}
      {hint && <span className="ct-hint" style={{ display: 'block' }}>{hint}</span>}
      {error && (
        <span className="ct-error" role="alert" style={{ display: 'block' }}>
          {error}
        </span>
      )}
    </label>
  );
}

export function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className="chip" aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  );
}

export function Choice({
  on,
  onClick,
  title,
  desc,
}: {
  on: boolean;
  onClick: () => void;
  title: ReactNode;
  desc?: ReactNode;
}) {
  return (
    <button type="button" className="choice" aria-pressed={on} onClick={onClick}>
      <span className="ct-choice-title">{title}</span>
      {desc && <span className="muted small">{desc}</span>}
    </button>
  );
}

export function Stepper({
  value,
  onDec,
  onInc,
  decDisabled,
  incDisabled,
  label,
}: {
  value: ReactNode;
  onDec: () => void;
  onInc: () => void;
  decDisabled?: boolean;
  incDisabled?: boolean;
  label: string;
}) {
  return (
    <div className="ct-stepper" role="group" aria-label={label}>
      <button type="button" onClick={onDec} disabled={decDisabled} aria-label={`Decrease ${label}`}>
        −
      </button>
      <output>{value}</output>
      <button type="button" onClick={onInc} disabled={incDisabled} aria-label={`Increase ${label}`}>
        +
      </button>
    </div>
  );
}

/** Picks images; each becomes one `onPick` call with the File. */
export function PhotoDrop({
  label,
  hero,
  multiple,
  onPick,
}: {
  label: string;
  hero?: boolean;
  multiple?: boolean;
  onPick: (files: File[]) => void;
}) {
  return (
    <label className={`ct-drop${hero ? ' ct-hero' : ''}`}>
      <span aria-hidden style={{ fontSize: 20 }}>＋</span>
      {label}
      <input
        type="file"
        accept="image/*"
        multiple={multiple}
        onChange={e => {
          const files = Array.from(e.target.files ?? []).filter(f => f.type.startsWith('image/'));
          e.target.value = '';
          if (files.length) onPick(files);
        }}
      />
    </label>
  );
}

export function PhotoTile({
  src,
  hero,
  onRemove,
  alt,
}: {
  src: string;
  hero?: boolean;
  onRemove: () => void;
  alt: string;
}) {
  return (
    <div className={`ct-photo${hero ? ' ct-hero' : ''}`}>
      <img src={src} alt={alt} />
      <button type="button" onClick={onRemove} aria-label={`Remove ${alt}`}>
        ✕
      </button>
    </div>
  );
}

/** Google Places destination search — HomeBreakSearchSheet on the web. */
export function DestinationSearch({
  value,
  geo,
  onSelect,
  error,
}: {
  value: string;
  geo: DestinationGeo | null;
  onSelect: (sel: DestinationGeo) => void;
  error?: string;
}) {
  const [query, setQuery] = useState('');
  const [list, setList] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const token = useRef(newSessionToken());
  const [editing, setEditing] = useState(!value);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setList([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      autocomplete(q, token.current, ctrl.signal)
        .then(r => {
          setList(r);
          setActive(0);
          setProblem(null);
          setOpen(true);
        })
        .catch(e => {
          if ((e as Error).name !== 'AbortError') setProblem((e as Error).message);
        });
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  const pick = async (s: PlaceSuggestion) => {
    setBusy(true);
    try {
      const sel = await placeDetails(s, token.current);
      token.current = newSessionToken();
      onSelect(sel);
      setOpen(false);
      setQuery('');
      setEditing(false);
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!editing && value) {
    return (
      <div className="row-between" style={{ gap: 12 }}>
        <div>
          <strong>{value}</strong>
          {geo?.full && <div className="muted small">{geo.full}</div>}
        </div>
        <button type="button" className="btn btn-sm" onClick={() => setEditing(true)}>
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="ct-search">
      <input
        type="search"
        placeholder="Search beaches, towns, breaks…"
        value={query}
        disabled={busy}
        aria-invalid={!!error}
        aria-label="Destination"
        autoComplete="off"
        onChange={e => setQuery(e.target.value)}
        onFocus={() => list.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={e => {
          if (!open || list.length === 0) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive(a => Math.min(a + 1, list.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive(a => Math.max(a - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            void pick(list[active]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {!PLACES_KEY && <p className="ct-error">Place search is not set up on this site.</p>}
      {problem && <p className="ct-error">{problem}</p>}
      {open && list.length > 0 && (
        <div className="ct-suggest" role="listbox">
          {list.map((s, i) => (
            <button
              key={s.placeId}
              type="button"
              role="option"
              aria-selected={i === active}
              data-active={i === active}
              onMouseDown={e => e.preventDefault()}
              onClick={() => void pick(s)}
            >
              <strong>{s.mainText}</strong>
              {s.secondaryText && <span className="muted small"> · {s.secondaryText}</span>}
            </button>
          ))}
        </div>
      )}
      {value && (
        <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 6 }} onClick={() => setEditing(false)}>
          Keep {value}
        </button>
      )}
    </div>
  );
}
