import { useMemo, useState } from 'react';
import {
  MAX_DAY_PHOTOS,
  MAX_DAY_TITLE_LENGTH,
  cleanDay,
  cleanItinerary,
  dayHighlights,
  dayLabel,
  dayNeedsTitle,
  dayNumbersToShow,
  emptyDay,
  isDayPlanned,
  normalizeItinerary,
  tripCalendarDays,
  upsertDay,
  type ItineraryDay,
} from '../../domain/itinerary';
import { updateTripFields, type EditableTrip } from '../../services/editTrip';
import { uploadTripImage } from '../../services/tripImages';
import { EditDialog, PhotoPicker, imageRatio } from './EditDialog';
import { Chevron } from './IncludesEditor';
import { useSaver, type EditorProps } from './useSaver';

/**
 * The day-by-day plan. Twin of the app's OperatorEditItineraryScreen: a list
 * of days, one day open at a time, and ONE save at the end for the whole plan,
 * because a plan is written across several days.
 *
 * Only titled days are stored (`cleanItinerary`). A day with photos or
 * activities and no title cannot be closed with Done — it would vanish on
 * Save, photos and all. Day photos upload on pick as `hero`, as the app does.
 */
export function ItineraryEditor({ trip, userId, onSaved, onClose }: EditorProps<EditableTrip>) {
  const s = useSaver(onSaved);
  const initial = useMemo(() => normalizeItinerary(trip.itinerary), [trip.itinerary]);
  const [days, setDays] = useState<ItineraryDay[]>(initial);
  const [editing, setEditing] = useState<ItineraryDay | null>(null);
  const [uploading, setUploading] = useState(false);

  const total = tripCalendarDays(trip.startDate, trip.endDate);
  const numbers = dayNumbersToShow(days, total);
  // A trip without exact dates has no calendar to lay days on: let the operator
  // add them one after another.
  const nextFree = (days.at(-1)?.day ?? 0) + 1;

  const dirty =
    editing !== null ||
    JSON.stringify(cleanItinerary(days)) !== JSON.stringify(cleanItinerary(initial));

  const addPhotos = async (files: File[]) => {
    if (!editing) return;
    setUploading(true);
    s.setError(null);
    try {
      let next = editing;
      for (const f of files.slice(0, MAX_DAY_PHOTOS - editing.photos.length)) {
        const ratio = await imageRatio(f);
        const url = await uploadTripImage(f, userId, 'hero');
        next = {
          ...next,
          photos: [...next.photos, url],
          ...(ratio ? { photoRatios: { ...(next.photoRatios ?? {}), [url]: ratio } } : {}),
        };
        setEditing(next);
      }
    } catch (e) {
      s.setError(e instanceof Error ? e.message : 'The photo did not upload. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  if (editing) {
    const cleaned = cleanDay(editing);
    const needsTitle = dayNeedsTitle(cleaned);
    const setAct = (i: number, patch: Partial<ItineraryDay['activities'][number]>) =>
      setEditing({ ...editing, activities: editing.activities.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
    return (
      <EditDialog
        title={dayLabel(trip.startDate, editing.day)}
        wide
        // "Done" closes the day back into the list; nothing is written yet.
        saveLabel="Done"
        dirty
        problem={needsTitle ? 'Give this day a title, or it will not be saved.' : null}
        busy={uploading}
        error={s.error}
        // Back keeps the day, as in the app — except an untitled day with
        // content, which would be dropped on Save: ask before losing it.
        onClose={() => {
          if (needsTitle) {
            if (!window.confirm('This day has no title, so it will not be saved. Leave it anyway?')) return;
            setEditing(null);
            return;
          }
          setDays(prev => upsertDay(prev, editing));
          setEditing(null);
        }}
        onSave={() => {
          setDays(prev => upsertDay(prev, editing));
          setEditing(null);
        }}
      >
        <div className="et-field">
          <label className="et-label" htmlFor="et-day-title">
            <span>Title</span>
            <span className="et-counter" data-full={editing.title.length >= MAX_DAY_TITLE_LENGTH}>
              {editing.title.length}/{MAX_DAY_TITLE_LENGTH}
            </span>
          </label>
          <input
            id="et-day-title"
            className="et-input"
            autoFocus
            maxLength={MAX_DAY_TITLE_LENGTH}
            placeholder="e.g. Reef day at Uluwatu"
            value={editing.title}
            onChange={e => setEditing({ ...editing, title: e.target.value.slice(0, MAX_DAY_TITLE_LENGTH) })}
          />
        </div>

        <p className="et-label" style={{ marginTop: 16 }}>
          <span>Photos</span>
          <span>{editing.photos.length}/{MAX_DAY_PHOTOS}</span>
        </p>
        <div className="et-thumbs">
          {editing.photos.map((u, i) => (
            <div className="et-thumb" key={`${u}-${i}`}>
              <img src={u} alt="" />
              <button
                type="button"
                className="et-thumb-x"
                aria-label={`Remove photo ${i + 1}`}
                onClick={() => setEditing({ ...editing, photos: editing.photos.filter((_, k) => k !== i) })}
              >
                ×
              </button>
            </div>
          ))}
          {editing.photos.length < MAX_DAY_PHOTOS && (
            <PhotoPicker label="Add photos" multiple busy={uploading} onFiles={addPhotos} />
          )}
        </div>
        <p className="muted small et-hint">The first photo is the day's cover.</p>

        <p className="et-label" style={{ marginTop: 16 }}>Activities</p>
        {editing.activities.map((a, i) => (
          <div className="et-act" key={i}>
            <input
              className="et-input et-act-time"
              type="time"
              aria-label="Time"
              value={a.time ?? ''}
              onChange={e => setAct(i, { time: e.target.value || null })}
            />
            <input className="et-input" aria-label="Activity" placeholder="What" value={a.name} onChange={e => setAct(i, { name: e.target.value })} />
            <input
              className="et-input et-act-place"
              aria-label="Place"
              placeholder="Where (optional)"
              value={a.place ?? ''}
              onChange={e => setAct(i, { place: e.target.value || null })}
            />
            <button
              type="button"
              className="et-icon-btn"
              aria-label="Remove activity"
              onClick={() => setEditing({ ...editing, activities: editing.activities.filter((_, j) => j !== i) })}
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn btn-sm"
          style={{ marginTop: 8 }}
          onClick={() => setEditing({ ...editing, activities: [...editing.activities, { time: null, name: '', place: null }] })}
        >
          + Add an activity
        </button>
      </EditDialog>
    );
  }

  return (
    <EditDialog
      title="Itinerary"
      sub={total ? `${total} days. Only days with a title are shown to travelers.` : 'Only days with a title are shown to travelers.'}
      wide
      dirty={dirty}
      busy={s.busy}
      error={s.error}
      onClose={() => {
        if (dirty && !window.confirm('Discard your itinerary changes? They have not been saved.')) return;
        onClose();
      }}
      onSave={() => s.run(() => updateTripFields(trip.id, { itinerary: cleanItinerary(days) }))}
    >
      <div className="card">
        {(total ? numbers : [...days.map(d => d.day), nextFree]).map(n => {
          const day = days.find(d => d.day === n);
          const past = total > 0 && n > total;
          return (
            <div key={n} className="et-day-row">
              <button
                type="button"
                className="row-link et-day"
                onClick={() => setEditing(day ? { ...day } : emptyDay(n))}
              >
                <span style={{ minWidth: 0 }}>
                  <span className="muted small" style={{ display: 'block' }}>
                    {dayLabel(trip.startDate, n)}
                    {past ? ' · after the trip ends, hidden from travelers' : ''}
                  </span>
                  <span className="et-day-title" style={{ display: 'block' }}>
                    {day && isDayPlanned(day) ? day.title : day ? 'Untitled' : 'Add a plan'}
                  </span>
                  {day && dayHighlights(day) && (
                    <span className="muted small" style={{ display: 'block' }}>{dayHighlights(day)}</span>
                  )}
                </span>
                <Chevron />
              </button>
              {day && (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  style={{ marginRight: 8 }}
                  aria-label={`Clear day ${n}`}
                  onClick={() => setDays(prev => prev.filter(d => d.day !== n))}
                >
                  Clear
                </button>
              )}
            </div>
          );
        })}
      </div>
    </EditDialog>
  );
}
