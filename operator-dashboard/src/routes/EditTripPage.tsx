import { useCallback, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import '../styles/editTrip.css';
import { useAuth } from '../lib/auth';
import { friendlyError } from '../lib/errors';
import { formatRange, formatUsd } from '../lib/format';
import { PageHead } from '../components/Shell';
import { ErrorBox, Loading } from '../components/StateBits';
import { TripPolicyCard } from '../components/TripPolicyCard';
import { TripPriceDialog } from '../components/TripPriceDialog';
import { useTripAccess } from '../services/access';
import { updateTripPrice } from '../services/actions';
import { fetchDatesNotifyCount, fetchEditableTrip, type EditableTrip } from '../services/editTrip';
import { fetchTrip } from '../services/trips';
import {
  BOARD_OPTIONS,
  JOIN_MODE_OPTIONS,
  LEVEL_OPTIONS,
  STAY_KIND_OPTIONS,
  TRIP_STRUCTURE_OPTIONS,
  TRIP_VIBE_OPTIONS,
  WAVE_SHAPE_OPTIONS,
  ageLabel,
  destinationLabel,
  labelOf,
  offlineDeadlineLabel,
  selectableBoards,
  selectableLevels,
  waveSizeLabel,
} from '../domain/editTrip';
import { normalizeItinerary, cleanItinerary } from '../domain/itinerary';
import { CATEGORY_ORDER, hasCategoryValue, readPriceInclusions } from '../domain/priceInclusions';
import {
  AboutYouEditor,
  AgeEditor,
  BoardsEditor,
  CoverEditor,
  DatesEditor,
  DescriptionEditor,
  GettingPaidEditor,
  JoinModeEditor,
  LevelsEditor,
  PayDeadlineEditor,
  SpotsEditor,
  StayEditor,
  StayTypeEditor,
  StructureEditor,
  TitleEditor,
  VibeEditor,
  VisibilityEditor,
  WaveEditor,
} from '../components/edit/editors';
import { DestinationEditor } from '../components/edit/DestinationEditor';
import { IncludesEditor, Chevron } from '../components/edit/IncludesEditor';
import { ItineraryEditor } from '../components/edit/ItineraryEditor';
import type { EditorProps } from '../components/edit/useSaver';

type Editor = ComponentType<EditorProps<EditableTrip>>;

/**
 * Edit trip — the web twin of the app's `OperatorTripEditScreen`, section by
 * section, with the same permissions.
 *
 * WHO MAY DO WHAT. Two questions, asked the way the rest of this site asks
 * them:
 *  - `trip.edit` (from `my_trip_capabilities`, the app's RPC) opens the page
 *    and every non-money row. A Manager holds it.
 *  - The operator OF RECORD (`group_trips.host_id`) additionally owns WHERE,
 *    WHEN and the whole Price section. A Manager sees Where and When disabled
 *    with "Operator only" — the app's choice: a row that is missing reads as a
 *    bug, a row that says who can is an answer. Price is hidden, as in the app.
 *
 * Both are UX. The walls are in the database: `trg_guard_operator_trip_money`,
 * `trg_guard_operator_trip_dates`, and `auth.uid() = host_id` on
 * `group_trip_destinations`.
 *
 * One dialog per row, one write per Save, as in the app. Nothing autosaves.
 */
export function EditTripPage() {
  const { tripId = '' } = useParams();
  const { user } = useAuth();
  const access = useTripAccess(tripId);
  const qc = useQueryClient();

  const trip = useQuery({ queryKey: ['editTrip', tripId], queryFn: () => fetchEditableTrip(tripId) });
  const isOwner = !!user && trip.data?.hostId === user.id;

  // The cancellation card reads the dashboard's own trip shape, from the cache
  // the trip page already fills.
  const opTrip = useQuery({ queryKey: ['trip', tripId], queryFn: () => fetchTrip(tripId), enabled: isOwner });
  // Same count the app hides the policy row on: every non-host participant,
  // onboarding included.
  const signedUp = useQuery({
    queryKey: ['datesNotify', tripId],
    queryFn: () => fetchDatesNotifyCount(tripId),
    enabled: isOwner,
  });

  const [open, setOpen] = useState<Editor | null>(null);
  const [priceOpen, setPriceOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 1800);
    return () => window.clearTimeout(t);
  }, [toast]);

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['editTrip', tripId] });
    void qc.invalidateQueries({ queryKey: ['trip', tripId] });
    void qc.invalidateQueries({ queryKey: ['operator-trips'] });
    void qc.invalidateQueries({ queryKey: ['members', tripId] });
    void qc.invalidateQueries({ queryKey: ['paySteps', tripId] });
    void qc.invalidateQueries({ queryKey: ['editableRequirements', tripId] });
  }, [qc, tripId]);

  const onSaved = useCallback(
    (message?: string) => {
      refresh();
      setOpen(null);
      setToast(message ?? 'Saved');
    },
    [refresh],
  );

  const savePrice = useMutation({
    mutationFn: (a: { cost: number; deposit: number | null; room: number | null | undefined }) =>
      updateTripPrice({
        tripId,
        costPerPerson: a.cost,
        depositAmount: a.deposit,
        privateRoomPriceUsd: a.room,
        paymentMode: trip.data?.paymentMode ?? null,
      }),
    onSuccess: () => {
      setPriceOpen(false);
      onSaved();
    },
  });

  if (trip.isPending) return <Loading />;
  if (trip.isError) return <ErrorBox error={trip.error} what="This trip" onRetry={() => trip.refetch()} />;

  const t = trip.data;
  const back = `/trips/${tripId}`;

  if (access.ready && !access.can('trip.edit') && !isOwner) {
    return (
      <>
        <PageHead back={back} backLabel={t.title} title="Edit trip" />
        <div className="card card-body">
          <p>Your role on this trip does not include editing it. The operator can change that on the crew page.</p>
        </div>
      </>
    );
  }

  const row = (label: string, value: ReactNode, editor: Editor | null, opts: { ownerOnly?: boolean } = {}) => {
    const locked = opts.ownerOnly && !isOwner;
    const empty = value === null || value === undefined || value === '';
    return (
      <button
        type="button"
        className="row-link et-row"
        disabled={locked || !editor}
        onClick={() => editor && setOpen(() => editor)}
      >
        <span className="et-row-label">{label}</span>
        {locked ? (
          <span className="et-row-value" style={{ textAlign: 'right' }}>
            <span className="et-lock">Operator only</span>
          </span>
        ) : (
          <span className="et-row-value" data-empty={empty}>
            {empty ? 'Add' : value}
          </span>
        )}
        {!locked && <Chevron />}
      </button>
    );
  };

  const levels = selectableLevels(t.levels).map(k => labelOf(LEVEL_OPTIONS, k)).join(', ');
  const boards = selectableBoards(t.boards).map(k => labelOf(BOARD_OPTIONS, k)).join(', ') || (t.boards.includes('all') ? 'Any board' : '');
  const wave = t.waveShape
    ? `${labelOf(WAVE_SHAPE_OPTIONS, t.waveShape)} · ${waveSizeLabel(t.waveSizeMin ?? 4)} – ${waveSizeLabel(t.waveSizeMax ?? 8)}`
    : '';
  const structure = t.structure.length
    ? t.structure.length === 1
      ? labelOf(TRIP_STRUCTURE_OPTIONS, t.structure[0])
      : `${t.structure.length} picked`
    : '';
  const plannedDays = cleanItinerary(normalizeItinerary(t.itinerary)).length;
  const inclusions = readPriceInclusions(t.priceInclusions);
  const includedCount =
    CATEGORY_ORDER.filter(k => hasCategoryValue(inclusions, k)).length + (inclusions.custom?.length ?? 0);
  const certs = [t.stokeCertified ? 'STOKE' : null, t.ciSurfConservation ? 'CI' : null].filter(Boolean).join(' · ');
  const isOperatorTrip = t.hostingStyle === 'C';

  const Open = open;

  return (
    <>
      <PageHead
        back={back}
        backLabel={t.title}
        title="Edit trip"
        sub={
          isOwner
            ? 'Changes save one at a time. Travelers see them the next time they open the trip.'
            : 'You can edit everything except where, when and the price — those are the operator’s.'
        }
      />

      <div className="stack">
        {/* ── Photos ───────────────────────────────────────────────── */}
        <section className="card enter" aria-labelledby="et-photos">
          <div className="card-head">
            <h2 id="et-photos">Photos</h2>
          </div>
          <div className="et-cover">
            {t.heroImageUrl && <img src={t.heroImageUrl} alt="" />}
            <button type="button" className="btn btn-sm et-cover-btn" onClick={() => setOpen(() => CoverEditor)}>
              {t.heroImageUrl ? 'Edit cover' : 'Add a cover'}
            </button>
          </div>
        </section>

        {/* ── The basics ───────────────────────────────────────────── */}
        <Section id="et-basics" title="The basics">
          {row('Trip name', t.title, TitleEditor)}
          {row('Description', t.description, DescriptionEditor)}
          {row('Where', destinationLabel(t.destination), DestinationEditor, { ownerOnly: true })}
          {row('When', t.startDate ? formatRange(t.startDate, t.endDate) : null, DatesEditor, { ownerOnly: true })}
          {row('Spots', t.maxParticipants == null ? null : `${t.maxParticipants} · ${t.participantCount} taken`, SpotsEditor)}
        </Section>

        {/* ── Who it's for ─────────────────────────────────────────── */}
        <Section id="et-who" title="Who it’s for">
          {row('Surf level', levels, LevelsEditor)}
          {row('Boards', boards, BoardsEditor)}
          {row('The wave', wave, WaveEditor)}
          {row('Age', ageLabel(t.ageMin, t.ageMax), AgeEditor)}
        </Section>

        {/* ── The trip ─────────────────────────────────────────────── */}
        <Section id="et-trip" title="The trip">
          {row('How it works', structure, StructureEditor)}
          {row('Vibe', labelOf(TRIP_VIBE_OPTIONS, t.vibes[0]), VibeEditor)}
          {row('Stay type', labelOf(STAY_KIND_OPTIONS, t.stayKind), StayTypeEditor)}
          {row('Your stay', t.stayName, StayEditor)}
          {/* Its own row so a skipped STOKE / CI answer is findable later. */}
          {row('Certifications', certs, StayEditor)}
          {row('About you', t.aboutYou, AboutYouEditor)}
          {row('Itinerary', plannedDays ? `${plannedDays} ${plannedDays === 1 ? 'day' : 'days'} planned` : null, ItineraryEditor)}
        </Section>

        {/* ── Price — operator of record only ──────────────────────── */}
        {isOwner && (
          <Section id="et-price" title="Price" note="Only you see this section.">
            <button type="button" className="row-link et-row" onClick={() => setPriceOpen(true)}>
              <span className="et-row-label">Price & deposit</span>
              <span className="et-row-value">
                {t.costPerPerson == null ? 'Add' : formatUsd(t.costPerPerson)}
                {' · '}
                {t.depositAmount ? `${formatUsd(t.depositAmount)} deposit` : 'No deposit'}
                {t.privateRoomPrice ? ` · private ${formatUsd(t.privateRoomPrice)}` : ''}
              </span>
              <Chevron />
            </button>
            {row("What's included", includedCount ? `${includedCount} ${includedCount === 1 ? 'item' : 'items'}` : null, IncludesEditor)}
            {row('Who can join', labelOf(JOIN_MODE_OPTIONS, t.joinMode), JoinModeEditor)}
            {row('Getting paid', t.paymentMode === 'managed' ? 'In Swellyo' : 'Myself', GettingPaidEditor)}
            {t.paymentMode === 'offline' && isOperatorTrip &&
              row('Payment deadline', offlineDeadlineLabel(t.offlineDueDaysBefore), PayDeadlineEditor)}
          </Section>
        )}

        {/* Refund terms + waiver: the dashboard's existing card, editable by
            the owner while nobody has signed up (its own rule, and the
            database's). The app hides the row once anyone joins; this card
            stays and shows the frozen terms read-only, as on the trip page. */}
        {isOwner && isOperatorTrip && opTrip.data && signedUp.data !== undefined && (
          <TripPolicyCard trip={opTrip.data} canEdit travelersJoined={signedUp.data} />
        )}

        {/* ── Visibility ───────────────────────────────────────────── */}
        <Section id="et-vis" title="Visibility">
          {row('Where it shows', t.visibility === 'link_only' ? 'Link only' : 'Listed in explore', VisibilityEditor)}
        </Section>

        {/* ── Manage — these already live on the trip page here ────── */}
        <Section id="et-manage" title="Manage">
          <Link to={back} className="row-link et-row">
            <span className="et-row-label">Requirements, packing suggestions, admin updates</span>
            <span className="et-row-value">On the trip page</span>
            <Chevron />
          </Link>
        </Section>
      </div>

      {Open && (
        <Open trip={t} userId={user?.id ?? ''} onSaved={onSaved} onClose={() => setOpen(null)} />
      )}

      {priceOpen && (
        <TripPriceDialog
          currentCostPerPerson={t.costPerPerson}
          currentDepositAmount={t.depositAmount}
          currentPrivateRoomPrice={t.privateRoomPrice}
          isManaged={t.paymentMode === 'managed'}
          busy={savePrice.isPending}
          error={savePrice.error ? friendlyError(savePrice.error) : null}
          onCancel={() => {
            setPriceOpen(false);
            savePrice.reset();
          }}
          onSave={(cost, deposit, room) => savePrice.mutate({ cost, deposit, room })}
        />
      )}

      {toast && (
        <div className="et-toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </>
  );
}

function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section className="card enter" aria-labelledby={id}>
      <div className="card-head">
        <h2 id={id}>{title}</h2>
        {note && <span className="muted small">{note}</span>}
      </div>
      {children}
    </section>
  );
}
