import { useMemo, useState } from 'react';
import {
  ACTIVITIES_OPTIONS,
  CATEGORY_ORDER,
  CATEGORY_TITLE,
  FLAT_INCLUDE_OPTIONS,
  SURF_FILM_MEDIA_OPTIONS,
  SURF_FILM_TYPE_OPTIONS,
  WELLNESS_OPTIONS,
  inclusionsForSave,
  isFlatIncludeKey,
  readPriceInclusions,
  summarizeCategory,
  type IncludeOption,
  type PriceInclusions,
} from '../../domain/priceInclusions';
import { parseWhole } from '../../domain/editTrip';
import { updateTripFields, type EditableTrip } from '../../services/editTrip';
import { EditDialog } from './EditDialog';
import { useSaver, type EditorProps } from './useSaver';

const toggle = (list: string[] | undefined, slug: string): string[] => {
  const l = list ?? [];
  return l.includes(slug) ? l.filter(s => s !== slug) : [...l, slug];
};

function Chips({ options, selected, onToggle, label }: { options: IncludeOption[]; selected: string[]; onToggle: (s: string) => void; label: string }) {
  return (
    <div className="et-chips" role="group" aria-label={label}>
      {options.map(o => (
        <button key={o.slug} type="button" className="chip" aria-pressed={selected.includes(o.slug)} onClick={() => onToggle(o.slug)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function CountInput({ id, label, value, onChange }: { id: string; label: string; value: number | null | undefined; onChange: (n: number | null) => void }) {
  return (
    <div className="et-sub-row">
      <label className="small" htmlFor={id} style={{ minWidth: 120 }}>{label}</label>
      <input
        id={id}
        className="et-input"
        style={{ maxWidth: 120, flex: 'none' }}
        inputMode="numeric"
        placeholder="Optional"
        value={value == null ? '' : String(value)}
        onChange={e => onChange(parseWhole(e.target.value.replace(/[^\d]/g, '').slice(0, 3)))}
      />
    </div>
  );
}

/**
 * "What's included" — `price_inclusions`, one jsonb column. The app's edit
 * screen expands each category in place (an accordion inside one sheet); this
 * does the same. Owner only, with the rest of the Price section.
 *
 * Nothing here is the price number, so it is a plain write — never through the
 * freeze path.
 */
export function IncludesEditor({ trip, onSaved, onClose }: EditorProps<EditableTrip>) {
  const s = useSaver(onSaved);
  const initial = useMemo(() => readPriceInclusions(trip.priceInclusions), [trip.priceInclusions]);
  const [v, setV] = useState<PriceInclusions>(initial);
  const [open, setOpen] = useState<keyof PriceInclusions | null>(null);
  const set = <K extends keyof PriceInclusions>(k: K, next: PriceInclusions[K]) => setV(prev => ({ ...prev, [k]: next }));
  const custom = v.custom ?? [];

  const dirty = JSON.stringify(inclusionsForSave(v)) !== JSON.stringify(inclusionsForSave(initial));

  const body = (key: keyof PriceInclusions) => {
    if (isFlatIncludeKey(key)) {
      return (
        <Chips label={CATEGORY_TITLE[key]} options={FLAT_INCLUDE_OPTIONS[key]} selected={v[key] ?? []} onToggle={slug => set(key, toggle(v[key], slug))} />
      );
    }
    if (key === 'surfFilm') {
      const f = v.surfFilm ?? {};
      return (
        <div className="et-sub">
          <Chips label="Media" options={SURF_FILM_MEDIA_OPTIONS} selected={f.media ?? []} onToggle={slug => set('surfFilm', { ...f, media: toggle(f.media, slug) })} />
          <CountInput id="et-film-count" label="How many sessions" value={f.count} onChange={count => set('surfFilm', { ...f, count })} />
          <Chips label="Filmed how" options={SURF_FILM_TYPE_OPTIONS} selected={f.filmTypes ?? []} onToggle={slug => set('surfFilm', { ...f, filmTypes: toggle(f.filmTypes, slug) })} />
        </div>
      );
    }
    if (key === 'videoAnalysis') {
      const a = v.videoAnalysis ?? {};
      return (
        <div className="et-sub">
          <div className="seg" style={{ marginTop: 0 }}>
            <button type="button" className="seg-btn" aria-pressed={!!a.included} onClick={() => set('videoAnalysis', { ...a, included: true })}>Included</button>
            <button type="button" className="seg-btn" aria-pressed={!a.included} onClick={() => set('videoAnalysis', { ...a, included: false })}>Not included</button>
          </div>
          {a.included && <CountInput id="et-va-count" label="How many sessions" value={a.count} onChange={count => set('videoAnalysis', { ...a, count })} />}
        </div>
      );
    }
    if (key === 'activities') {
      const acts = v.activities ?? [];
      const keys = acts.map(x => x.key);
      return (
        <div className="et-sub" style={{ marginTop: 0 }}>
          <Chips
            label="Activities"
            options={ACTIVITIES_OPTIONS}
            selected={keys}
            onToggle={slug =>
              set('activities', keys.includes(slug) ? acts.filter(x => x.key !== slug) : [...acts, { key: slug, note: '' }])
            }
          />
          {acts.map(x => (
            <div className="et-sub-row" key={x.key}>
              <strong>{ACTIVITIES_OPTIONS.find(o => o.slug === x.key)?.label ?? x.key}</strong>
              <input
                className="et-input"
                aria-label="Note"
                placeholder="Where, how long, why (optional)"
                value={x.note ?? ''}
                onChange={e => set('activities', acts.map(y => (y.key === x.key ? { ...y, note: e.target.value } : y)))}
              />
            </div>
          ))}
        </div>
      );
    }
    if (key === 'wellness') {
      const w = v.wellness ?? [];
      const keys = w.map(x => x.key);
      return (
        <div className="et-sub" style={{ marginTop: 0 }}>
          <Chips
            label="Wellness"
            options={WELLNESS_OPTIONS}
            selected={keys}
            onToggle={slug =>
              set('wellness', keys.includes(slug) ? w.filter(x => x.key !== slug) : [...w, { key: slug, payment: 'included' }])
            }
          />
          {w.map(x => (
            <div className="et-sub-row" key={x.key}>
              <strong>{WELLNESS_OPTIONS.find(o => o.slug === x.key)?.label ?? x.key}</strong>
              <div className="seg" style={{ marginTop: 0 }}>
                <button type="button" className="seg-btn" aria-pressed={x.payment === 'included'} onClick={() => set('wellness', w.map(y => (y.key === x.key ? { ...y, payment: 'included' } : y)))}>In the price</button>
                <button type="button" className="seg-btn" aria-pressed={x.payment === 'extra'} onClick={() => set('wellness', w.map(y => (y.key === x.key ? { ...y, payment: 'extra' } : y)))}>Extra pay</button>
              </div>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <EditDialog
      title="What's included"
      wide
      dirty={dirty}
      busy={s.busy}
      error={s.error}
      onClose={onClose}
      onSave={() => s.run(() => updateTripFields(trip.id, { price_inclusions: inclusionsForSave(v) }))}
    >
      {CATEGORY_ORDER.map(key => {
        const isOpen = open === key;
        const summary = summarizeCategory(v, key);
        return (
          <div className="et-acc" key={key}>
            <button type="button" className="et-acc-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : key)}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <strong className="small" style={{ display: 'block', fontSize: 'var(--fs-md)' }}>{CATEGORY_TITLE[key]}</strong>
                {summary && <span className="muted small" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary}</span>}
              </span>
              <Chevron />
            </button>
            {isOpen && <div className="et-acc-body">{body(key)}</div>}
          </div>
        );
      })}

      <p className="et-label" style={{ marginTop: 20 }}>Add your own</p>
      {custom.map((c, i) => (
        <div className="et-acc" key={i} style={{ padding: 12 }}>
          <div className="et-sub-row">
            <input className="et-input" aria-label="Title" placeholder="Title" value={c.title} onChange={e => set('custom', custom.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
            <button type="button" className="et-icon-btn" aria-label="Remove" onClick={() => set('custom', custom.filter((_, j) => j !== i))}>×</button>
          </div>
          <input
            className="et-input"
            style={{ marginTop: 8 }}
            aria-label="Description"
            placeholder="Description (optional)"
            value={c.description ?? ''}
            onChange={e => set('custom', custom.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))}
          />
        </div>
      ))}
      <button type="button" className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => set('custom', [...custom, { title: '', description: '' }])}>
        + {custom.length ? 'Add another' : 'Add an inclusion'}
      </button>
    </EditDialog>
  );
}

export function Chevron() {
  return (
    <svg className="et-chev" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
