import { useEffect, useRef, useState } from 'react';
import { destinationConfirmMessage, destinationLabel, type DestinationGeo } from '../../domain/editTrip';
import { setTripDestination, type EditableTrip } from '../../services/editTrip';
import {
  PLACES_API_KEY,
  autocompletePlaces,
  newSessionToken,
  resolvePlace,
  type PlaceSuggestion,
} from '../../services/places';
import { EditDialog } from './EditDialog';
import { useSaver, type EditorProps } from './useSaver';

/**
 * "Where" — owner only. Twin of the app's OperatorEditDestinationScreen.
 *
 * `group_trip_destinations` is its own table and all four of its policies are
 * `auth.uid() = host_id`, so a Manager is refused by the database as well as
 * by the page.
 *
 * Save stays dead until a NEW place is picked: seeding the pick from the
 * current destination would light it up on open and invite a no-op write that
 * still asks the confirm question.
 */
export function DestinationEditor({ trip, onSaved, onClose }: EditorProps<EditableTrip>) {
  const s = useSaver(onSaved);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);
  const [picked, setPicked] = useState<DestinationGeo | null>(null);
  const token = useRef(newSessionToken());

  // Debounced search, newest request wins.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    const ctrl = new AbortController();
    const t = window.setTimeout(async () => {
      setSearching(true);
      try {
        setSuggestions(await autocompletePlaces(q, token.current, ctrl.signal));
        s.setError(null);
      } catch (e) {
        if (!ctrl.signal.aborted) s.setError(e instanceof Error ? e.message : 'Search failed.');
      } finally {
        if (!ctrl.signal.aborted) setSearching(false);
      }
    }, 250);
    return () => {
      ctrl.abort();
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const pick = async (sug: PlaceSuggestion) => {
    setResolving(sug.placeId);
    try {
      setPicked(await resolvePlace(sug, token.current));
      token.current = newSessionToken();
      setSuggestions([]);
      setQuery('');
      s.setError(null);
    } catch (e) {
      s.setError(e instanceof Error ? e.message : 'Could not open that place.');
    } finally {
      setResolving(null);
    }
  };

  // participant_count includes the host — same number the app uses here.
  const joined = Math.max(0, trip.participantCount - 1);
  const message = destinationConfirmMessage(joined);
  const current = destinationLabel(trip.destination);

  return (
    <EditDialog
      title="Where"
      sub={current ? `Now: ${current}` : 'No destination set yet.'}
      dirty={picked !== null}
      busy={s.busy}
      error={s.error}
      confirm={message ? { title: 'Change where the trip goes?', message, confirmLabel: 'Change it' } : null}
      onClose={onClose}
      onSave={() => picked && s.run(() => setTripDestination(trip.id, picked))}
    >
      {!PLACES_API_KEY ? (
        <p className="muted">Place search is not set up on this site yet. Change the destination in the app.</p>
      ) : (
        <>
          {picked && (
            <div className="et-picked" style={{ marginBottom: 12 }}>
              <strong>{picked.name ?? picked.short_label}</strong>
              {picked.formatted_address && <p className="muted small">{picked.formatted_address}</p>}
            </div>
          )}
          <label className="et-label" htmlFor="et-place">
            <span>{picked ? 'Pick a different place' : 'Search beaches, towns, breaks…'}</span>
            {searching && <span>Searching…</span>}
          </label>
          <input
            id="et-place"
            className="et-input"
            type="text"
            autoFocus
            autoComplete="off"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="e.g. Uluwatu"
          />
          {suggestions.length > 0 && (
            <div className="et-suggest" role="listbox" aria-label="Places">
              {suggestions.map(sug => (
                <button
                  key={sug.placeId}
                  type="button"
                  role="option"
                  aria-selected={false}
                  className="row-link"
                  disabled={resolving !== null}
                  onClick={() => pick(sug)}
                >
                  <span>
                    <strong className="small" style={{ display: 'block' }}>{sug.mainText}</strong>
                    <span className="muted small">{sug.secondaryText}</span>
                  </span>
                  {resolving === sug.placeId && <span className="muted small">…</span>}
                </button>
              ))}
            </div>
          )}
          {query.trim().length >= 2 && !searching && suggestions.length === 0 && (
            <p className="muted small et-hint">No places found.</p>
          )}
        </>
      )}
    </EditDialog>
  );
}
