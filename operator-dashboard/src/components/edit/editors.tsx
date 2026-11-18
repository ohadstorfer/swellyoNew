import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ABOUT_YOU_MAX,
  AGE_WINDOW,
  BOARD_OPTIONS,
  DESCRIPTION_MAX,
  JOIN_MODE_OPTIONS,
  LEVEL_OPTIONS,
  MAX_AGE,
  MAX_SPOTS,
  MIN_AGE,
  MIN_SPOTS,
  PAYMENT_MODE_OPTIONS,
  STAY_GALLERY_MAX,
  STAY_KIND_OPTIONS,
  STAY_NAME_MAX,
  TITLE_MAX,
  TRIP_STRUCTURE_MUTEX,
  TRIP_STRUCTURE_OPTIONS,
  TRIP_VIBE_OPTIONS,
  VISIBILITY_OPTIONS,
  WAVE_SHAPE_OPTIONS,
  WAVE_SIZE_MAX,
  WAVE_SIZE_MIN,
  boardsForSave,
  datesConfirmMessage,
  datesPatch,
  datesRule,
  describeDeadlineShift,
  optionalArrayForSave,
  parseWhole,
  paymentModeConfirm,
  paymentModeBlocker,
  sameStringSet,
  selectableBoards,
  selectableLevels,
  stayPatch,
  toggleSingle,
  toggleWithMutex,
  validateAgeRange,
  validateDates,
  validateSpots,
  validateStay,
  validateTitle,
  validateWave,
  waveSizeLabel,
  type JoinMode,
  type PaymentMode,
  type StayKind,
  type SurfLevel,
  type SurfStyle,
  type TripStructureSlug,
  type TripVibeSlug,
  type Visibility,
  type WaveShape,
} from '../../domain/editTrip';
import { DEADLINE_STEPS, isDeadlineAtEnd, resolveDeadlineISO, stepDeadline } from '../../domain/requirements';
import { formatDate, formatUsd } from '../../lib/format';
import {
  fetchDatesNotifyCount,
  setTripPaymentMode,
  syncOperatorCrewBio,
  updateTripFields,
  type EditableTrip,
} from '../../services/editTrip';
import { fetchEditableRequirements } from '../../services/requirements';
import { fetchConnectState } from '../../services/settings';
import { uploadTripImage, uploadTripImages } from '../../services/tripImages';
import { ChoiceList, EditDialog, MultiList, PhotoPicker, TextField } from './EditDialog';
import { useSaver, type EditorProps } from './useSaver';

type P = EditorProps<EditableTrip>;

// ─── Photos ──────────────────────────────────────────────────────────────────

export function CoverEditor({ trip, userId, onSaved, onClose }: P) {
  const s = useSaver(onSaved);
  const [url, setUrl] = useState(trip.heroImageUrl);
  const [uploading, setUploading] = useState(false);

  const pick = async (files: File[]) => {
    setUploading(true);
    s.setError(null);
    try {
      // Uploaded on pick so the preview is the real file. If Save never comes
      // the object is orphaned in S3 — harmless, the app accepts the same.
      setUrl(await uploadTripImage(files[0], userId, 'hero'));
    } catch (e) {
      s.setError(e instanceof Error ? e.message : 'The photo did not upload. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <EditDialog
      title="Cover photo"
      sub="The first thing travelers see on the trip."
      dirty={url !== trip.heroImageUrl}
      busy={s.busy || uploading}
      error={s.error}
      problem={url ? null : 'Add a cover photo.'}
      onClose={onClose}
      onSave={() => s.run(() => updateTripFields(trip.id, { hero_image_url: url }))}
    >
      <div className="et-thumb et-stay-photo" style={{ marginBottom: 12 }}>
        {url && <img src={url} alt="" />}
      </div>
      <PhotoPicker label={url ? 'Choose another photo' : 'Add a photo'} busy={uploading} onFiles={pick} className="et-stay-photo" />
    </EditDialog>
  );
}

// ─── Text ────────────────────────────────────────────────────────────────────

export function TitleEditor({ trip, onSaved, onClose }: P) {
  const s = useSaver(onSaved);
  const [v, setV] = useState(trip.title);
  return (
    <EditDialog
      title="Trip name"
      dirty={v.trim() !== trip.title.trim()}
      problem={validateTitle(v)}
      busy={s.busy}
      error={s.error}
      onClose={onClose}
      onSave={() => s.run(() => updateTripFields(trip.id, { title: v.trim() }))}
    >
      <TextField id="et-title" label="Trip name" value={v} onChange={setV} max={TITLE_MAX} autoFocus placeholder="e.g. Bali and Barrels" />
    </EditDialog>
  );
}

export function DescriptionEditor({ trip, onSaved, onClose }: P) {
  const s = useSaver(onSaved);
  const initial = trip.description ?? '';
  const [v, setV] = useState(initial);
  return (
    <EditDialog
      title="Description"
      dirty={v.trim() !== initial.trim()}
      busy={s.busy}
      error={s.error}
      onClose={onClose}
      onSave={() => s.run(() => updateTripFields(trip.id, { description: v.trim() }))}
    >
      <TextField
        id="et-desc"
        label="Description"
        value={v}
        onChange={setV}
        max={DESCRIPTION_MAX}
        multiline
        autoFocus
        placeholder="e.g. A week of reef breaks around Uluwatu with a small crew."
      />
    </EditDialog>
  );
}

/**
 * Two rows carry this text: the trip's own note and the operator's crew card,
 * which is where travelers read it now. The trip write must land; the crew
 * card is best-effort (it does nothing on a trip published before the operator
 * was put on their own crew).
 */
export function AboutYouEditor({ trip, userId, onSaved, onClose }: P) {
  const s = useSaver(onSaved);
  const initial = trip.aboutYou ?? '';
  const [v, setV] = useState(initial);
  return (
    <EditDialog
      title="About you"
      sub="Shown on your crew card on the trip."
      dirty={v.trim() !== initial.trim()}
      busy={s.busy}
      error={s.error}
      onClose={onClose}
      onSave={() =>
        s.run(async () => {
          const next = v.trim() || null;
          await updateTripFields(trip.id, { host_lead_note: next });
          try {
            await syncOperatorCrewBio(trip.id, userId, next);
          } catch (e) {
            console.warn('[edit] crew bio sync failed:', e);
          }
        })
      }
    >
      <TextField
        id="et-about"
        label="About you"
        value={v}
        onChange={setV}
        max={ABOUT_YOU_MAX}
        multiline
        autoFocus
        placeholder="e.g. 12 years guiding surfers in Bali, ISA Level 2 coach, lifeguard certified."
      />
    </EditDialog>
  );
}

// ─── Basics ──────────────────────────────────────────────────────────────────

export function SpotsEditor({ trip, onSaved, onClose }: P) {
  const s = useSaver(onSaved);
  const [text, setText] = useState(trip.maxParticipants == null ? '' : String(trip.maxParticipants));
  const n = parseWhole(text);
  const problem = text.trim() === '' ? 'Set the number of spots.' : n === null ? 'Use a whole number.' : validateSpots(n, trip.participantCount);
  const bump = (d: 1 | -1) => setText(String(Math.min(MAX_SPOTS, Math.max(MIN_SPOTS, (n ?? MIN_SPOTS) + d))));
  return (
    <EditDialog
      title="Spots"
      sub={`Between ${MIN_SPOTS} and ${MAX_SPOTS}, host included. ${trip.participantCount} taken now.`}
      dirty={n !== trip.maxParticipants}
      problem={problem}
      busy={s.busy}
      error={s.error}
      onClose={onClose}
      // max_participants alone — trg_group_trips_capacity_floor refuses a value
      // under who is aboard, and a wider patch would re-check fields nobody moved.
      onSave={() => s.run(() => updateTripFields(trip.id, { max_participants: n }))}
    >
      <div className="stepper" style={{ justifyContent: 'center', gap: 20 }}>
        <button type="button" className="stepper-btn" aria-label="Fewer spots" onClick={() => bump(-1)} disabled={(n ?? 0) <= MIN_SPOTS}>
          −
        </button>
        <input
          className="et-input et-big-num"
          style={{ width: 96 }}
          inputMode="numeric"
          aria-label="Spots"
          value={text}
          onChange={e => setText(e.target.value.replace(/[^\d]/g, '').slice(0, 2))}
        />
        <button type="button" className="stepper-btn" aria-label="More spots" onClick={() => bump(1)} disabled={(n ?? 0) >= MAX_SPOTS}>
          +
        </button>
      </div>
    </EditDialog>
  );
}

/**
 * Owner only — `trg_guard_operator_trip_dates` refuses anyone else. A date
 * change notifies every traveler through `trg_notify_trip_dates_changed`, so
 * Save asks first and says who will hear about it and what moves with it.
 */
export function DatesEditor({ trip, onSaved, onClose }: P) {
  const s = useSaver(onSaved);
  const initial = useMemo(
    () => ({
      startDate: trip.startDate,
      endDate: trip.endDate,
      dateMonths: trip.dateMonths,
      durationDays: trip.durationDays,
    }),
    [trip],
  );
  const [start, setStart] = useState(trip.startDate ?? '');
  const [end, setEnd] = useState(trip.endDate ?? '');
  const rule = datesRule(initial);

  const notify = useQuery({ queryKey: ['datesNotify', trip.id], queryFn: () => fetchDatesNotifyCount(trip.id) });
  const reqs = useQuery({ queryKey: ['editableRequirements', trip.id], queryFn: () => fetchEditableRequirements(trip.id) });

  const problem = validateDates(start || null, end || null, initial);
  const shift = describeDeadlineShift({
    currentStart: trip.startDate,
    nextStart: start || null,
    paymentMode: trip.paymentMode,
    offlineDaysBefore: trip.offlineDueDaysBefore,
    requirements: reqs.data,
  });
  // Unknown is not zero: while the count is loading, still ask.
  const count = notify.data ?? (notify.isError ? 1 : null);
  const message = count == null ? 'Checking who is on this trip…' : datesConfirmMessage(count, shift);

  const rangeHint = [
    rule.minDays && rule.maxDays ? `${rule.minDays}-${rule.maxDays} days` : null,
    rule.minStart || rule.maxEnd
      ? `between ${formatDate(rule.minStart ?? start)} and ${formatDate(rule.maxEnd ?? end)}`
      : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <EditDialog
      title="When"
      sub={rangeHint ? `Pick ${rangeHint}.` : 'Pick the trip dates.'}
      dirty={start !== (trip.startDate ?? '') || end !== (trip.endDate ?? '')}
      problem={problem}
      busy={s.busy}
      error={s.error}
      confirm={message ? { title: 'Change the dates?', message, confirmLabel: 'Change it' } : null}
      footNote={shift || undefined}
      onClose={onClose}
      onSave={() => s.run(() => updateTripFields(trip.id, datesPatch(start, end, initial)))}
    >
      <div className="et-two">
        <div>
          <label className="et-label" htmlFor="et-start">Starts</label>
          <input
            id="et-start"
            className="et-input"
            type="date"
            value={start}
            min={rule.minStart ?? undefined}
            max={rule.maxEnd ?? undefined}
            onChange={e => setStart(e.target.value)}
          />
        </div>
        <div>
          <label className="et-label" htmlFor="et-end">Ends</label>
          <input
            id="et-end"
            className="et-input"
            type="date"
            value={end}
            min={start || rule.minStart || undefined}
            max={rule.maxEnd ?? undefined}
            onChange={e => setEnd(e.target.value)}
          />
        </div>
      </div>
      <p className="muted small et-hint">
        Travelers who signed up hear about new dates automatically. Deadlines are counted back from
        the start date, so they move with it.
      </p>
    </EditDialog>
  );
}

// ─── Who it's for ────────────────────────────────────────────────────────────

export function LevelsEditor({ trip, onSaved, onClose }: P) {
  const s = useSaver(onSaved);
  const initial = selectableLevels(trip.levels);
  const [v, setV] = useState<SurfLevel[]>(initial);
  return (
    <EditDialog
      title="Surf level"
      dirty={!sameStringSet(v, initial)}
      problem={v.length === 0 ? 'Pick at least one surf level.' : null}
      busy={s.busy}
      error={s.error}
      onClose={onClose}
      onSave={() => s.run(() => updateTripFields(trip.id, { target_surf_levels: v }))}
    >
      <MultiList label="Surf level" options={LEVEL_OPTIONS} selected={v} onToggle={k => setV(toggleWithMutex(v, k))} />
    </EditDialog>
  );
}

export function BoardsEditor({ trip, onSaved, onClose }: P) {
  const s = useSaver(onSaved);
  const initial = selectableBoards(trip.boards);
  const [v, setV] = useState<SurfStyle[]>(initial);
  return (
    <EditDialog
      title="Boards"
      sub="Leave all off for any board."
      dirty={!sameStringSet(v, initial)}
      busy={s.busy}
      error={s.error}
      onClose={onClose}
      onSave={() => s.run(() => updateTripFields(trip.id, { target_surf_styles: boardsForSave(v) }))}
    >
      <MultiList label="Boards" options={BOARD_OPTIONS} selected={v} onToggle={k => setV(toggleWithMutex(v, k))} columns />
    </EditDialog>
  );
}

const SIZE_STEPS = Array.from({ length: WAVE_SIZE_MAX - WAVE_SIZE_MIN + 1 }, (_, i) => WAVE_SIZE_MIN + i);

export function WaveEditor({ trip, onSaved, onClose }: P) {
  const s = useSaver(onSaved);
  // Same fallback the app uses: the slider needs concrete numbers.
  const init = {
    shape: (trip.waveShape as WaveShape | null) ?? null,
    min: trip.waveSizeMin ?? 4,
    max: trip.waveSizeMax ?? 8,
  };
  const [shape, setShape] = useState<WaveShape | null>(init.shape);
  const [min, setMin] = useState(init.min);
  const [max, setMax] = useState(init.max);
  return (
    <EditDialog
      title="The wave"
      dirty={shape !== init.shape || min !== init.min || max !== init.max}
      problem={validateWave(shape, min, max)}
      busy={s.busy}
      error={s.error}
      onClose={onClose}
      onSave={() =>
        s.run(() =>
          updateTripFields(trip.id, { wave_shapes: shape ? [shape] : null, wave_size_min: min, wave_size_max: max }),
        )
      }
    >
      <p className="et-label">Shape</p>
      <div className="seg" role="radiogroup" aria-label="Wave shape" style={{ marginTop: 0 }}>
        {WAVE_SHAPE_OPTIONS.map(o => (
          <button key={o.key} type="button" className="seg-btn" role="radio" aria-checked={shape === o.key} aria-pressed={shape === o.key} onClick={() => setShape(o.key)}>
            {o.label}
          </button>
        ))}
      </div>
      <div className="et-two" style={{ marginTop: 16 }}>
        <div>
          <label className="et-label" htmlFor="et-wmin">Smallest</label>
          <select id="et-wmin" className="et-select" value={min} onChange={e => { const n = Number(e.target.value); setMin(n); if (n > max) setMax(n); }}>
            {SIZE_STEPS.map(n => <option key={n} value={n}>{waveSizeLabel(n)}</option>)}
          </select>
        </div>
        <div>
          <label className="et-label" htmlFor="et-wmax">Biggest</label>
          <select id="et-wmax" className="et-select" value={max} onChange={e => { const n = Number(e.target.value); setMax(n); if (n < min) setMin(n); }}>
            {SIZE_STEPS.map(n => <option key={n} value={n}>{waveSizeLabel(n)}</option>)}
          </select>
        </div>
      </div>
    </EditDialog>
  );
}

export function AgeEditor({ trip, onSaved, onClose }: P) {
  const s = useSaver(onSaved);
  const [minT, setMinT] = useState(trip.ageMin == null ? '' : String(trip.ageMin));
  const [maxT, setMaxT] = useState(trip.ageMax == null ? '' : String(trip.ageMax));
  const min = parseWhole(minT);
  const max = parseWhole(maxT);
  return (
    <EditDialog
      title="Age"
      sub={`${MIN_AGE}-${MAX_AGE}, at least ${AGE_WINDOW} years apart. Leave one empty for no limit on that side.`}
      dirty={min !== trip.ageMin || max !== trip.ageMax}
      problem={validateAgeRange(min, max)}
      busy={s.busy}
      error={s.error}
      onClose={onClose}
      onSave={() => s.run(() => updateTripFields(trip.id, { age_min: min, age_max: max }))}
    >
      <div className="et-two">
        <div>
          <label className="et-label" htmlFor="et-amin">Youngest</label>
          <input id="et-amin" className="et-input" inputMode="numeric" value={minT} onChange={e => setMinT(e.target.value.replace(/[^\d]/g, '').slice(0, 2))} placeholder="Any" />
        </div>
        <div>
          <label className="et-label" htmlFor="et-amax">Oldest</label>
          <input id="et-amax" className="et-input" inputMode="numeric" value={maxT} onChange={e => setMaxT(e.target.value.replace(/[^\d]/g, '').slice(0, 2))} placeholder="Any" />
        </div>
      </div>
    </EditDialog>
  );
}

// ─── The trip ────────────────────────────────────────────────────────────────

export function StructureEditor({ trip, onSaved, onClose }: P) {
  const s = useSaver(onSaved);
  const initial = trip.structure as TripStructureSlug[];
  const [v, setV] = useState<TripStructureSlug[]>(initial);
  return (
    <EditDialog
      title="How it works"
      sub="Opposites cancel each other out."
      dirty={!sameStringSet(v, initial)}
      busy={s.busy}
      error={s.error}
      onClose={onClose}
      onSave={() => s.run(() => updateTripFields(trip.id, { trip_structure: optionalArrayForSave(v) }))}
    >
      <MultiList
        label="How it works"
        options={TRIP_STRUCTURE_OPTIONS}
        selected={v}
        chips
        onToggle={k => setV(toggleWithMutex(v, k, TRIP_STRUCTURE_MUTEX))}
      />
    </EditDialog>
  );
}

export function VibeEditor({ trip, onSaved, onClose }: P) {
  const s = useSaver(onSaved);
  const initial = trip.vibes as TripVibeSlug[];
  const [v, setV] = useState<TripVibeSlug[]>(initial);
  return (
    <EditDialog
      title="Vibe"
      dirty={!sameStringSet(v, initial)}
      busy={s.busy}
      error={s.error}
      onClose={onClose}
      onSave={() => s.run(() => updateTripFields(trip.id, { trip_vibes: optionalArrayForSave(v) }))}
    >
      <ChoiceList label="Vibe" options={TRIP_VIBE_OPTIONS} value={v[0] ?? null} onPick={k => setV(toggleSingle(v, k))} />
    </EditDialog>
  );
}

export function StayTypeEditor({ trip, onSaved, onClose }: P) {
  const s = useSaver(onSaved);
  const [v, setV] = useState<StayKind | null>(trip.stayKind as StayKind | null);
  return (
    <EditDialog
      title="Stay type"
      dirty={v !== trip.stayKind}
      problem={v ? null : 'Pick an accommodation type.'}
      busy={s.busy}
      error={s.error}
      onClose={onClose}
      onSave={() => s.run(() => updateTripFields(trip.id, { accommodation_type: v ? [v] : null }))}
    >
      <ChoiceList label="Stay type" options={STAY_KIND_OPTIONS} value={v} onPick={setV} columns />
    </EditDialog>
  );
}

/**
 * "Your stay" and "Certifications" open this same editor, as in the app: the
 * STOKE / CI answers live with the stay they describe.
 *
 * Photos upload on pick, one at a time (the S3 key is a timestamp).
 */
export function StayEditor({ trip, userId, onSaved, onClose }: P) {
  const s = useSaver(onSaved);
  const init = {
    kind: (trip.stayKind as StayKind | null) ?? null,
    name: trip.stayName ?? '',
    url: trip.stayUrl ?? '',
    imageUrl: trip.stayImageUrl,
    galleryUrls: trip.stayGallery,
    stokeCertified: trip.stokeCertified,
    ciSurfConservation: trip.ciSurfConservation,
  };
  const [d, setD] = useState(init);
  const [uploading, setUploading] = useState<'main' | 'gallery' | null>(null);

  const upload = async (which: 'main' | 'gallery', files: File[]) => {
    setUploading(which);
    s.setError(null);
    try {
      if (which === 'main') {
        const url = await uploadTripImage(files[0], userId, 'accommodation');
        setD(prev => ({ ...prev, imageUrl: url }));
      } else {
        const room = STAY_GALLERY_MAX - d.galleryUrls.length;
        const urls = await uploadTripImages(files.slice(0, room), userId, 'accommodation');
        setD(prev => ({ ...prev, galleryUrls: [...prev.galleryUrls, ...urls].slice(0, STAY_GALLERY_MAX) }));
      }
    } catch (e) {
      s.setError(e instanceof Error ? e.message : 'The photo did not upload. Please try again.');
    } finally {
      setUploading(null);
    }
  };

  return (
    <EditDialog
      title="Your stay"
      sub="Where will your guests be staying?"
      wide
      dirty={JSON.stringify(d) !== JSON.stringify(init)}
      problem={validateStay(d)}
      busy={s.busy || uploading !== null}
      error={s.error}
      onClose={onClose}
      onSave={() => s.run(() => updateTripFields(trip.id, stayPatch(d)))}
    >
      <p className="et-label">Type</p>
      <ChoiceList label="Stay type" options={STAY_KIND_OPTIONS} value={d.kind} onPick={k => setD({ ...d, kind: k })} columns />

      <div style={{ marginTop: 16 }}>
        <TextField id="et-stay-name" label="Name" value={d.name} onChange={name => setD({ ...d, name })} max={STAY_NAME_MAX} />
        <TextField id="et-stay-url" label="Link" type="url" value={d.url} onChange={url => setD({ ...d, url })} placeholder="https://" />
      </div>

      <p className="et-label" style={{ marginTop: 16 }}>Photo</p>
      {d.imageUrl ? (
        <div className="et-thumb et-stay-photo" style={{ maxWidth: 360 }}>
          <img src={d.imageUrl} alt="" />
          <button type="button" className="et-thumb-x" aria-label="Remove stay photo" onClick={() => setD({ ...d, imageUrl: null })}>
            ×
          </button>
        </div>
      ) : (
        <div style={{ maxWidth: 360 }}>
          <PhotoPicker label="Add a photo of the stay" className="et-stay-photo" busy={uploading === 'main'} onFiles={f => upload('main', f)} />
        </div>
      )}

      <p className="et-label" style={{ marginTop: 16 }}>
        <span>More photos</span>
        <span>{d.galleryUrls.length}/{STAY_GALLERY_MAX}</span>
      </p>
      <div className="et-thumbs">
        {d.galleryUrls.map((u, i) => (
          <div className="et-thumb" key={`${u}-${i}`}>
            <img src={u} alt="" />
            <button
              type="button"
              className="et-thumb-x"
              aria-label={`Remove photo ${i + 1}`}
              onClick={() => setD({ ...d, galleryUrls: d.galleryUrls.filter((_, k) => k !== i) })}
            >
              ×
            </button>
          </div>
        ))}
        {d.galleryUrls.length < STAY_GALLERY_MAX && (
          <PhotoPicker
            label={d.imageUrl ? 'Add photos' : 'Main photo first'}
            multiple
            disabled={!d.imageUrl}
            busy={uploading === 'gallery'}
            onFiles={f => upload('gallery', f)}
          />
        )}
      </div>

      <p className="et-label" style={{ marginTop: 20 }}>Certifications</p>
      <div className="et-choices">
        <button type="button" className="choice" aria-pressed={d.stokeCertified} onClick={() => setD({ ...d, stokeCertified: !d.stokeCertified })}>
          <span className="et-choice-title">Do you have a STOKE Certification?</span>
        </button>
        <button type="button" className="choice" aria-pressed={d.ciSurfConservation} onClick={() => setD({ ...d, ciSurfConservation: !d.ciSurfConservation })}>
          <span className="et-choice-title">Do they participate with CI Surf Conservation?</span>
        </button>
      </div>
      <p className="muted small et-hint">All good if not!</p>
    </EditDialog>
  );
}

// ─── Price (owner only) ──────────────────────────────────────────────────────

export function JoinModeEditor({ trip, onSaved, onClose }: P) {
  const s = useSaver(onSaved);
  const [v, setV] = useState<JoinMode>(trip.joinMode);
  return (
    <EditDialog
      title="Who can join"
      dirty={v !== trip.joinMode}
      busy={s.busy}
      error={s.error}
      footNote="Requests already waiting stay waiting."
      onClose={onClose}
      onSave={() => s.run(() => updateTripFields(trip.id, { join_mode: v }))}
    >
      <ChoiceList label="Who can join" options={JOIN_MODE_OPTIONS} value={v} onPick={setV} />
    </EditDialog>
  );
}

/**
 * Turning payment collection on or off after publish — the app's "Getting
 * paid" sheet. Gated on the same rule (`paymentModeBlocker`), confirmed with
 * the same words, and written through `setTripPaymentMode`, which freezes,
 * builds the pay rows and rolls back to offline if either fails.
 *
 * Stripe is read only while this is open, like the app's `enabled: sheet open`.
 */
export function GettingPaidEditor({ trip, userId, onSaved, onClose }: P) {
  const s = useSaver(onSaved);
  const [v, setV] = useState<PaymentMode>(trip.paymentMode);
  const connect = useQuery({ queryKey: ['connectState', userId], queryFn: () => fetchConnectState(userId) });
  const problem = paymentModeBlocker({
    next: v,
    costPerPerson: trip.costPerPerson,
    connectLoading: connect.isPending,
    connectState: connect.data?.state ?? (connect.isError ? 'not_started' : null),
  });
  return (
    <EditDialog
      title="Getting paid"
      dirty={v !== trip.paymentMode}
      problem={problem}
      busy={s.busy}
      error={s.error}
      confirm={paymentModeConfirm(v)}
      onClose={onClose}
      onSave={() => s.run(() => setTripPaymentMode(trip.id, v, trip.depositAmount))}
    >
      <ChoiceList label="Getting paid" options={PAYMENT_MODE_OPTIONS} value={v} onPick={setV} />
      {v === 'managed' && (
        <p className="muted small et-hint">
          {trip.depositAmount
            ? `Travelers pay a ${formatUsd(trip.depositAmount)} deposit, then the rest before the trip. Change it in Price & deposit.`
            : 'Travelers pay the whole price in one go. Add a deposit in Price & deposit to split it in two.'}
        </p>
      )}
      {v === 'managed' && connect.data && problem && !connect.isPending && (
        <p className="small et-hint">Stripe is set up in the Swellyo app, under Settings → Payments.</p>
      )}
    </EditDialog>
  );
}

/** Offline trips only. A managed trip's deadline is its balance row's. */
export function PayDeadlineEditor({ trip, onSaved, onClose }: P) {
  const s = useSaver(onSaved);
  // Null (a trip published before the column) seeds at the wizard's default.
  const init = trip.offlineDueDaysBefore ?? 30;
  const [days, setDays] = useState(init);
  const due = resolveDeadlineISO(trip.startDate, days);
  return (
    <EditDialog
      title="Payment deadline"
      sub="When travelers pay you the full price, counted back from the trip."
      dirty={days !== trip.offlineDueDaysBefore}
      busy={s.busy}
      error={s.error}
      onClose={onClose}
      onSave={() => s.run(() => updateTripFields(trip.id, { offline_payment_due_days_before: days }))}
    >
      <div className="stepper">
        <button type="button" className="stepper-btn" aria-label="Fewer days before" disabled={isDeadlineAtEnd(days, -1)} onClick={() => setDays(stepDeadline(days, -1))}>
          −
        </button>
        <span className="stepper-label">
          <strong>{days === 1 ? '1 day' : `${days} days`} before the trip</strong>
          {due && <span className="muted small">{formatDate(due)}</span>}
        </span>
        <button type="button" className="stepper-btn" aria-label="More days before" disabled={isDeadlineAtEnd(days, 1) || days >= DEADLINE_STEPS[DEADLINE_STEPS.length - 1]} onClick={() => setDays(stepDeadline(days, 1))}>
          +
        </button>
      </div>
    </EditDialog>
  );
}

export function VisibilityEditor({ trip, onSaved, onClose }: P) {
  const s = useSaver(onSaved);
  const init = (trip.visibility === 'link_only' ? 'link_only' : 'public') as Visibility;
  const [v, setV] = useState<Visibility>(init);
  return (
    <EditDialog
      title="Visibility"
      dirty={v !== init}
      busy={s.busy}
      error={s.error}
      onClose={onClose}
      onSave={() => s.run(() => updateTripFields(trip.id, { visibility: v }))}
    >
      <ChoiceList label="Visibility" options={VISIBILITY_OPTIONS} value={v} onPick={setV} />
    </EditDialog>
  );
}
