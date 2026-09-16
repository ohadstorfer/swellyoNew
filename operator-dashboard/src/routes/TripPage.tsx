import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { fetchMembers, fetchTrip, type OperatorTrip } from '../services/trips';
import { useTripReview } from '../services/useTripReview';
import { fetchCounts, fetchMedicalFlags } from '../services/counts';
import { fetchProfiles, type SurferProfile } from '../services/travelers';
import { fetchCrew } from '../services/staff';
import { fetchStalledOnboarders, STALLED_TODO_DAYS } from '../services/onboarding';
import { fetchDeparted } from '../services/departed';
import { connectStatusOf, fetchPayoutState } from '../services/settings';
import { deriveConnectState, tripPaymentWarning } from '../domain/connect';
import { countLate, countLateItems, isLate, tripPhase } from '../domain/late';
import { useAuth } from '../lib/auth';
import type { TripReview } from '../services/review';
import { isKnownUploadKind, kindLabel } from '../domain/catalog';
import { isUploadRequirement } from '../domain/requirements';
import { useTripMoney } from '../services/useTripMoney';
import type { TravelerMoney } from '../domain/money';
import { formatDate, formatRange, formatUsd, plural } from '../lib/format';
import { Avatar, ErrorBox, Loading, CountPair, NoPaperworkAccess } from '../components/StateBits';
import { PageHead } from '../components/Shell';
import { RequirementsEditor } from '../components/RequirementsEditor';
import { resolveDeadlineISO } from '../domain/requirements';
import { ModeNotices } from './MoneyPage';
import { DASHBOARD_CAPABILITY, useTripAccess } from '../services/access';
import { SummaryTiles } from '../components/SummaryTiles';
import { JoinRequestsCard } from '../components/JoinRequestsCard';
import { AdminUpdatesCard } from '../components/AdminUpdatesCard';
import { TripPolicyCard } from '../components/TripPolicyCard';
import { ExportAllDocs } from '../components/ExportAllDocs';
import { CancelTripDialog } from '../components/CancelTripDialog';
import { MyCrewCard } from '../components/MyCrewCard';
import { GearCard } from '../components/GearCard';
import { MyPaperworkCard } from '../components/MyPaperworkCard';

export function TripPage() {
  const { tripId = '' } = useParams();
  const access = useTripAccess(tripId);
  const queryClient = useQueryClient();
  // The operator of record, for the refund-terms card. NOT `access.can(...)`:
  // money authorises on `group_trips.host_id` in the database, and every
  // promoted admin holds `trip.edit`.
  const { user } = useAuth();

  // Read and edit are two renders of the same card, never one render with
  // controls wedged into it. That is not only tidiness: the requirement rows
  // are whole-row links to the document page, and a stepper inside an anchor
  // is a nested interactive element — it swallows clicks and fails a11y. One
  // mode shows links, the other shows controls, and neither is inside the
  // other.
  const [editingReqs, setEditingReqs] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const trip = useQuery({ queryKey: ['trip', tripId], queryFn: () => fetchTrip(tripId) });
  const members = useQuery({ queryKey: ['members', tripId], queryFn: () => fetchMembers(tripId) });
  // For the summary tiles. Every query behind it is one this page or its cards
  // already run, so React Query serves the lot from cache.
  const { money, isOffline } = useTripMoney(tripId);

  const userIds = useMemo(() => (members.data ?? []).map(m => m.userId), [members.data]);

  // Travelers who paid and stopped. Independent of `members`/`review`, so a
  // slow document query never delays the one thing on this page that nothing
  // else in the product would ever have told the operator about.
  const stalled = useQuery({
    queryKey: ['stalled', tripId],
    queryFn: () => fetchStalledOnboarders(tripId),
  });

  // Through the hook, not a bare useQuery: it strips the medical form for
  // anyone without medical.view, so no count on this page can show the false
  // zero a Manager saw on 9 Sep 2026. See domain/visibleReview.
  const review = useTripReview(tripId, userIds, members.isSuccess);
  const counts = useQuery({ queryKey: ['counts', tripId], queryFn: () => fetchCounts(tripId) });
  // Counts, but still medical: `organized_trip_medical_flags` is a
  // security_invoker view over the answers, so a Manager gets zeroes rather
  // than an error — a card reading "0 injuries · 0 allergies" on a trip that
  // has both. Hide it on the same capability the app hides its copy of this
  // block on. See the medical gate in TravelerPage.
  const canViewMedical = access.can('medical.view');
  const flags = useQuery({
    queryKey: ['flags', tripId],
    queryFn: () => fetchMedicalFlags(tripId),
    enabled: canViewMedical,
  });
  const profiles = useQuery({
    queryKey: ['profiles', userIds],
    queryFn: () => fetchProfiles(userIds),
    enabled: userIds.length > 0,
  });

  /**
   * Travelers currently overdue, per requirement KIND.
   *
   * Feeds the editor's confirm. Overdue is DERIVED from the deadline — there
   * is no stored flag — so pushing a date later genuinely un-overdues people,
   * and the operator is told the count before it happens rather than after.
   *
   * Keyed on kind, not id: the editor works in kinds, because a kind that is
   * switched off has no row to key on.
   */
  const overdueByKind = useMemo(() => {
    const out: Record<string, number> = {};
    for (const t of review.data?.travelers ?? []) {
      for (const i of t.items) {
        if (i.state === 'overdue') out[i.kind] = (out[i.kind] ?? 0) + 1;
      }
    }
    return out;
  }, [review.data]);

  if (trip.isError) return <ErrorBox what="This trip" error={trip.error} onRetry={() => void trip.refetch()} />;
  if (members.isError)
    return <ErrorBox what="The travelers" error={members.error} onRetry={() => void members.refetch()} />;
  if (trip.isPending || members.isPending || access.isPending)
    return <Loading what="Loading the trip" />;

  // Crew below Manager have no documents to review, which is the whole reason
  // this site exists — so they get a sentence rather than a page of empty
  // cards. Nothing here is a security boundary: every read on this page is
  // already refused by the database for anyone without the capability. This
  // just says so in words.
  if (access.ready && !access.can(DASHBOARD_CAPABILITY)) {
    return (
      <>
        <PageHead back="/trips" backLabel="All trips" title={trip.data.title} />
        <NoPaperworkAccess />
      </>
    );
  }

  const memberCount = userIds.length;
  const countBy = new Map((counts.data ?? []).map(c => [c.requirementId, c]));
  const reqs = review.data?.requirements ?? [];

  /**
   * How many people are late on each requirement, and on the trip overall.
   *
   * NOT `state === 'overdue'`. That state is only ever reached when the
   * traveler sent NOTHING — someone whose passport was rejected and never
   * resent reads `'rejected'` months past the deadline, and they are the
   * likeliest to miss the flight. `isLate` is the shared rule; see domain/late.
   *
   * Derived from the review data this page already holds, so it costs no round
   * trip — and it deliberately does not come from `counts`, which is a
   * per-requirement tally with no deadline in it.
   */
  const lateByRequirement = new Map<string, number>();
  for (const t of review.data?.travelers ?? []) {
    for (const i of t.items) {
      if (isLate(i)) {
        lateByRequirement.set(i.requirementId, (lateByRequirement.get(i.requirementId) ?? 0) + 1);
      }
    }
  }
  const totalLate = countLate(review.data?.travelers ?? []);

  // isUploadRequirement, not `reqType === 'upload'`. A kind 'medical' row can
  // also be req_type 'upload'; without this it would show up twice — once as a
  // custom item and again in the medical line below.
  const uploads = reqs.filter(r => isUploadRequirement(r) && isKnownUploadKind(r.kind));
  const custom = reqs.filter(r => isUploadRequirement(r) && !isKnownUploadKind(r.kind));
  const waiver = reqs.find(r => r.kind === 'waiver');
  const medical = reqs.find(r => r.kind === 'medical');

  const agreedCount = (requirementId?: string) =>
    !requirementId || !review.data
      ? 0
      : review.data.travelers.filter(
          t => t.items.find(i => i.requirementId === requirementId)?.state === 'approved',
        ).length;

  return (
    <>
      <PageHead
        back="/trips"
        backLabel="All trips"
        title={trip.data.title}
        sub={
          <>
            {formatRange(trip.data.startDate, trip.data.endDate)} ·{' '}
            {plural(memberCount, 'traveler')}
            <TripStatusLine
              startDate={trip.data.startDate}
              endDate={trip.data.endDate}
              late={totalLate}
              loading={review.isPending}
            />
          </>
        }
      />

      <div className="stack">
        {/* ── Trip summary ──────────────────────────────────────────────── */}
        {/* Product Specs, Frame 39433. The three figures the page exists for,
            so they lead — above the banners, which are exceptions, not state. */}
        <SummaryTiles
          tripId={tripId}
          money={money}
          members={members.data}
          maxParticipants={trip.data.maxParticipants}
          isOffline={isOffline}
          canViewMoney={access.can('payments.view_status')}
        />

        {/* ── Wants to come ─────────────────────────────────────────────── */}
        {/* Above everything else that is work: an unanswered request is
            somebody waiting on a human, and it is the only thing on this page
            with a person on the other end of it right now. Silent when the
            list is empty. */}
        <JoinRequestsCard tripId={tripId} />

        {/* ── Paid, then stopped ────────────────────────────────────────── */}
        {/* Above the document queue on purpose. An unreviewed passport is work
            the operator knows about; a traveler who paid a week ago and is not
            on the trip is money and a person nobody was counting.

            Only after a day. The first four hours are the traveler's alone —
            they get a nudge, and someone who wandered off mid-form usually
            comes back before this would have been worth reading. Past 24 hours
            it is real, and this appears on the same mark the operator's daily
            digest fires on, so the banner and the notification always agree. */}
        {(() => {
          const stuck = (stalled.data ?? []).filter(s => s.stalledDays >= STALLED_TODO_DAYS);
          if (stuck.length === 0) return null;
          const worst = Math.max(...stuck.map(s => s.stalledDays));
          return (
            <div
              className="banner enter"
              style={{ background: 'var(--warn-bg)', color: 'var(--warn)' }}
            >
              <span>
                {plural(stuck.length, 'traveler')} paid but never finished joining
                {' — '}
                {worst === 1 ? 'stuck a day' : `stuck up to ${worst} days`}
              </span>
            </div>
          );
        })()}

        {/* ── Needs review ──────────────────────────────────────────────── */}
        {/* Straight to everything that needs a decision — not to the first
            requirement that happens to contain some of it. A banner counting
            three documents used to open a page showing one. */}
        {review.data && review.data.totalToReview > 0 && (
          <Link to={`/trips/${tripId}/waiting`} className="banner enter">
            <span>
              {plural(review.data.totalToReview, 'document')} waiting for you
            </span>
            <span aria-hidden>›</span>
          </Link>
        )}
        {review.data && review.data.totalToReview === 0 && (
          <div className="banner enter" style={{ background: 'var(--ok-bg)', color: 'var(--ok)' }}>
            <span>Nothing waiting for review</span>
          </div>
        )}

        {/* ── Travelers can't pay yet ───────────────────────────────────── */}
        <PaymentsNotLiveBanner trip={trip.data} />

        {/* ── Money ─────────────────────────────────────────────────────── */}
        {/* A Manager sees who has paid (payments.view_status); moving an amount
            is money.manage, which is the operator alone. A tier without even the
            read gets no card, rather than a card of dashes. */}
        {access.can('payments.view_status') && <MoneyCard tripId={tripId} />}

        {/* ── Documents ─────────────────────────────────────────────────── */}
        <div className="card enter">
          <div className="card-head">
            <h2>{editingReqs ? 'What this trip asks for' : 'Documents'}</h2>
            {/* `trip.edit` and nothing else. It is the exact capability
                `organized_trip_req_write` checks, so the button and the
                database can never disagree — a tier without it would get a
                raw Postgres refusal instead of a hidden control. */}
            {access.can('trip.edit') && !editingReqs && (
              <button className="btn btn-sm" onClick={() => setEditingReqs(true)}>
                Edit
              </button>
            )}
          </div>
          <div className="card-body">
            {review.isPending && <span className="muted small">Loading…</span>}
            {review.isError && <ErrorBox what="The documents" error={review.error} onRetry={() => void review.refetch()} />}

            {editingReqs && (
              <RequirementsEditor
                tripId={tripId}
                startDateISO={trip.data.startDate}
                paymentMode={trip.data.paymentMode}
                overdueByKind={overdueByKind}
                onClose={() => setEditingReqs(false)}
                onSaved={() => {
                  // Everything a deadline touches. `review` recomputes every
                  // traveler's overdue state, `counts` the tiles, `paySteps`
                  // the date on the Money card.
                  void queryClient.invalidateQueries({ queryKey: ['review', tripId] });
                  void queryClient.invalidateQueries({ queryKey: ['counts', tripId] });
                  void queryClient.invalidateQueries({ queryKey: ['paySteps', tripId] });
                }}
              />
            )}

            {!editingReqs && review.data && uploads.length === 0 && custom.length === 0 && (
              <p className="muted small">No document requirements on this trip.</p>
            )}

            {!editingReqs && uploads.map(r => {
              const c = countBy.get(r.id);
              return (
                <Link
                  key={r.id}
                  to={`/trips/${tripId}/d/${r.id}`}
                  className="row-between"
                  style={{
                    padding: '8px 0',
                    borderBottom: '1px solid var(--line)',
                    color: 'inherit',
                  }}
                >
                  <span className="stepper-label">
                    <span>{kindLabel(r.kind, r.title)}</span>
                    {/* The date the operator set, so the thing they came to
                        change is visible before they press Edit. Absent on a
                        must-have row, which carries no deadline at all. */}
                    <span className="muted small">
                      {r.dueDate ? `Due ${formatDate(r.dueDate)}` : 'Needed to join'}
                    </span>
                  </span>
                  <span className="row" style={{ gap: 12 }}>
                    <CountPair
                      received={c?.received ?? 0}
                      approved={c?.approved ?? 0}
                      expected={c?.expected ?? memberCount}
                      late={lateByRequirement.get(r.id) ?? 0}
                    />
                    <span className="muted" aria-hidden>
                      ›
                    </span>
                  </span>
                </Link>
              );
            })}

            {/* Waiver and medical are not uploads, so they get a short line
                rather than a row of their own. They still OPEN, though — the
                page behind them lists who has done it and who has not, which is
                the only question this line raises. It read as dead text while
                the app made the same two items tappable. */}
            {!editingReqs && (waiver || medical) && (
              <p className="small" style={{ paddingTop: 12 }}>
                {waiver && (
                  <Link className="muted" to={`/trips/${tripId}/d/${waiver.id}`}>
                    Waiver signed {agreedCount(waiver.id)}/{memberCount}
                  </Link>
                )}
                {waiver && medical && <span className="muted"> · </span>}
                {medical && (
                  <Link className="muted" to={`/trips/${tripId}/d/${medical.id}`}>
                    Medical form {agreedCount(medical.id)}/{memberCount}
                  </Link>
                )}
              </p>
            )}
          </div>
        </div>

        {/* ── Other requirements ────────────────────────────────────────── */}
        {custom.length > 0 && (
          <div className="card enter">
            <div className="card-head">
              <h2>Other requirements</h2>
            </div>
            <div className="card-body">
              {custom.map(r => {
                const c = countBy.get(r.id);
                return (
                  <Link
                    key={r.id}
                    to={`/trips/${tripId}/d/${r.id}`}
                    className="row-between"
                    style={{ padding: '8px 0', color: 'inherit' }}
                  >
                    <span>{r.title}</span>
                    <span className="row" style={{ gap: 12 }}>
                      <CountPair
                        received={c?.received ?? 0}
                        approved={c?.approved ?? 0}
                        expected={c?.expected ?? memberCount}
                        late={lateByRequirement.get(r.id) ?? 0}
                      />
                      <span className="muted" aria-hidden>
                        ›
                      </span>
                    </span>
                  </Link>
                );
              })}
              <p className="muted" style={{ fontSize: 'var(--fs-s)', lineHeight: '18px', marginTop: 8 }}>
                Items you created yourself. They are counted, but they do not get their own tile.
              </p>
            </div>
          </div>
        )}

        {/* ── Medical flags ─────────────────────────────────────────────── */}
        {canViewMedical && (
        <div className="card enter">
          <div className="card-head">
            <h2>Medical flags</h2>
            {medical && (
              <Link className="small" to={`/trips/${tripId}/d/${medical.id}`}>
                View all
              </Link>
            )}
          </div>
          <div className="card-body">
            {flags.isPending && <span className="muted small">Loading…</span>}
            {flags.data && (
              <p>
                {plural(flags.data.injuriesReported, 'injury', 'injuries')} ·{' '}
                {plural(flags.data.allergiesReported, 'allergy', 'allergies')} ·{' '}
                {flags.data.dietaryReported} diet{' '}
                {flags.data.dietaryReported === 1 ? 'note' : 'notes'} ·{' '}
                {plural(flags.data.medicationsReported, 'medication')}
              </p>
            )}
            <p className="muted" style={{ fontSize: 'var(--fs-s)', lineHeight: '18px', marginTop: 8 }}>
              Counts only. No names on this screen.
            </p>
          </div>
        </div>
        )}

        {/* ── Surf stats ────────────────────────────────────────────────── */}
        <div className="card enter">
          <div className="card-head">
            <h2>Surf stats</h2>
          </div>
          <div className="card-body">
            {profiles.isPending && <span className="muted small">Loading…</span>}
            {profiles.data && <SurfStats profiles={[...profiles.data.values()]} />}
          </div>
        </div>

        {/* ── Crew ──────────────────────────────────────────────────────── */}
        {/* Operator only. `staff.manage` is held by the operator of record and
            by no assignable tier, so this is "am I the operator" asked the way
            everything else on this site asks it. A Manager reviewing documents
            never sees the link. */}
        {access.can('staff.manage') && <CrewCard tripId={tripId} />}

        {/* ── Travelers ─────────────────────────────────────────────────── */}
        <TravelersCard
          tripId={tripId}
          userIds={userIds}
          review={review.data}
          reviewPending={review.isPending}
          profiles={profiles.data}
        />

        {/* ── No longer on the trip ─────────────────────────────────────── */}
        {/* Directly under the travelers, because it answers the question the
            roster raises: "wasn't there someone else?" Manager and up, the
            same tier that can open a traveler page at all. */}
        {access.can('travelers.view_profiles') && <DepartedCard tripId={tripId} />}

        {/* ── Gear ──────────────────────────────────────────────────────── */}
        {/* Read for anyone on the trip, edited on `trip.edit` — the same
            capability `group_trip_gear_items` checks, so the controls and the
            database can never disagree. */}
        <GearCard tripId={tripId} canEdit={access.can('trip.edit')} />

        {/* ── Your paperwork ────────────────────────────────────────────── */}
        {/* Whoever signs in here is running the trip AND on it. Silent for
            anyone with no crew row, which is most people. */}
        <MyPaperworkCard tripId={tripId} />

        {/* ── Your details ──────────────────────────────────────────────── */}
        {/* Product Specs §"Manage self". On the TRIP page rather than the crew
            page: /crew needs `staff.manage`, which is exactly who this is not
            for. Renders nothing for anyone without a crew row of their own —
            a traveler, or an operator on a trip published before
            `ensureOperatorOnCrew` ran. */}
        <MyCrewCard tripId={tripId} />

        {/* ── Updates ───────────────────────────────────────────────────── */}
        {/* Read for anyone on the trip, post behind `updates.send`. Below the
            roster because it is the thing you do AFTER looking at who is
            coming. See decision D5 — this is also the desktop's answer to
            "chat", for now. */}
        <AdminUpdatesCard tripId={tripId} canPost={access.can('updates.send')} />

        {/* ── Cancellation policy ───────────────────────────────────────── */}
        {/* Shown to everyone who can open the trip: an operator answering "what
            happens if I pull out" needs to read the frozen terms, not just edit
            them. Editing is the operator of record, and only while nobody has
            joined — decision D2 and 20260904000100. */}
        <TripPolicyCard
          trip={trip.data}
          canEdit={!!user && trip.data.hostId === user.id}
          travelersJoined={userIds.length}
        />

        {/* ── Export ────────────────────────────────────────────────────── */}
        {access.can('data.export') && (
          <ExportAllDocs
            tripTitle={trip.data.title}
            review={review.data}
            profiles={profiles.data}
          />
        )}

        {/* ── Calling it off ────────────────────────────────────────────── */}
        {/* Last on the page, and the only thing on this site that cannot be
            undone. `trip.cancel` is the operator of record's alone — the same
            capability the edge function checks, so the button and the server
            can never disagree. */}
        {access.can('trip.cancel') && trip.data.status !== 'cancelled' && (
          <div className="card enter" style={{ borderColor: 'var(--line-strong)' }}>
            <div className="card-body row-between" style={{ gap: 12 }}>
              <span className="muted small">
                Cancel this trip and refund everyone in full. This cannot be undone.
              </span>
              <button
                className="btn btn-sm btn-danger"
                style={{ flexShrink: 0 }}
                onClick={() => setCancelling(true)}
              >
                Cancel the trip
              </button>
            </div>
          </div>
        )}
      </div>

      {cancelling && (
        <CancelTripDialog
          tripId={tripId}
          tripTitle={trip.data.title}
          onClose={() => setCancelling(false)}
        />
      )}
    </>
  );
}

/**
 * The crew, in one line, linking to the page that manages them.
 *
 * Always shown to the operator, even with nobody on it — an empty crew is not
 * an empty state, it is the thing this card exists to fix. A failed read is
 * silent rather than red: the crew is not why anyone opened this page.
 */
function CrewCard({ tripId }: { tripId: string }) {
  const crew = useQuery({ queryKey: ['crew', tripId], queryFn: () => fetchCrew(tripId) });

  if (crew.isError) return null;

  const pending = (crew.data ?? []).filter(m => m.pending).length;

  return (
    <Link to={`/trips/${tripId}/crew`} className="card card-link enter">
      <div className="card-head">
        <h2>Crew</h2>
        <span className="muted small">
          {crew.isPending ? 'Loading…' : plural(crew.data?.length ?? 0, 'person', 'people')}
        </span>
      </div>
      <div className="card-body row-between">
        <span className="muted small">
          {crew.isPending
            ? ' '
            : (crew.data?.length ?? 0) === 0
              ? 'Nobody yet. Add the people who help you run this trip.'
              : [
                  crew.data
                    ?.filter(m => !m.pending)
                    .map(m => m.name)
                    .join(', '),
                  pending > 0 ? `${pending} not accepted yet` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
        </span>
        <span className="muted" aria-hidden>
          ›
        </span>
      </div>
    </Link>
  );
}

/**
 * Everyone on the trip, one row each, opening that person's own page.
 *
 * Every other card on this screen is per-requirement — one document read
 * across all travelers. This is the other axis: one person, everything about
 * them. The page it opens already existed; the only way in was through a
 * document, so a traveler with nothing submitted was unreachable.
 *
 * The roster comes from `userIds` (the member query), never from the review —
 * a failed or slow review must not make the trip look empty. Document counts
 * and money are drawn from queries this page already ran, so the card costs
 * no extra round trip.
 */
/**
 * Travelers who are no longer on this trip.
 *
 * Two kinds of person, one list, because to the operator they are the same
 * question — "where did they go, and what about their money?"
 *
 *   · a kept row marked 'left' or 'removed' (migration 20260906000300), which
 *     carries when, who, and why;
 *   · somebody deleted before rows survived departures, found only because
 *     their payments are still on file. No date, and none can be invented.
 *
 * Renders nothing when both are empty, which is every trip nobody has left.
 * Quiet styling on purpose: a person leaving is ordinary. What would be
 * alarming — and what this fixes — is not being able to find them at all.
 *
 * The row links to their traveler page, which already carries the refund flow,
 * the ledger and the frozen terms. A second, thinner copy of all three here
 * would be one more place for them to disagree.
 */
function DepartedCard({ tripId }: { tripId: string }) {
  const departed = useQuery({ queryKey: ['departed', tripId], queryFn: () => fetchDeparted(tripId) });
  const ids = useMemo(() => (departed.data ?? []).map(d => d.userId), [departed.data]);
  const profiles = useQuery({
    queryKey: ['profiles', ids],
    queryFn: () => fetchProfiles(ids),
    enabled: ids.length > 0,
  });
  const names = useQuery({
    queryKey: ['profiles', (departed.data ?? []).map(d => d.leftBy).filter(Boolean) as string[]],
    queryFn: () =>
      fetchProfiles((departed.data ?? []).map(d => d.leftBy).filter(Boolean) as string[]),
    enabled: (departed.data ?? []).some(d => d.leftBy),
  });

  if (!departed.data || departed.data.length === 0) return null;

  const nameOf = (userId: string) => profiles.data?.get(userId)?.name?.trim() || 'Someone';

  const line = (d: (typeof departed.data)[number]) => {
    const when = d.leftAt ? formatDate(d.leftAt) : null;
    if (d.kind === 'ledger') return 'Removed before we kept a record';
    const who = d.leftBy ? names.data?.get(d.leftBy)?.name?.trim() : null;
    const verb = d.kind === 'removed' ? 'Removed' : 'Left';
    const by = d.kind === 'removed' && who ? ` by ${who}` : '';
    return `${verb}${when ? ` ${when}` : ''}${by}`;
  };

  return (
    <div className="card enter">
      <div className="card-head">
        <h2>No longer on the trip</h2>
        <span className="muted small">{departed.data.length}</span>
      </div>
      <div className="card-body">
        <p className="muted small" style={{ marginTop: 0 }}>
          They are in no count on this page. Their payments are still on file and can still be
          refunded.
        </p>
        <div className="stack" style={{ gap: 12, marginTop: 12 }}>
          {departed.data.map(d => (
            <Link
              key={d.userId}
              to={`/trips/${tripId}/t/${d.userId}`}
              className="row-between"
              style={{ gap: 12, alignItems: 'flex-start', color: 'inherit' }}
            >
              <div>
                <div className="small">
                  <strong>{nameOf(d.userId)}</strong>
                </div>
                <div className="muted small" style={{ marginTop: 2 }}>
                  {line(d)}
                  {d.leftReason && ` · ${d.leftReason}`}
                </div>
              </div>
              <div className="small" style={{ textAlign: 'right', flexShrink: 0 }}>
                {/* Both figures, always, when either is non-zero. "Paid $1,000"
                    with no second line reads as money still owed to them; the
                    refunded line is what closes the question. */}
                {d.netPaidUsd > 0 || d.refundedUsd > 0 ? (
                  <>
                    <div>{formatUsd(d.netPaidUsd)} paid</div>
                    <div className="muted">
                      {d.refundedUsd > 0 ? `${formatUsd(d.refundedUsd)} refunded` : 'no refund'}
                    </div>
                  </>
                ) : (
                  <span className="muted">paid nothing</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function TravelersCard({
  tripId,
  userIds,
  review,
  reviewPending,
  profiles,
}: {
  tripId: string;
  userIds: string[];
  review: TripReview | undefined;
  reviewPending: boolean;
  profiles: Map<string, SurferProfile> | undefined;
}) {
  // React Query serves this from the cache the Money card already filled.
  const { money, isOffline, hasMoney } = useTripMoney(tripId);

  const nameOf = (userId: string) => profiles?.get(userId)?.name ?? 'Traveler';

  // Alphabetical. This is the card you open to find one named person, not to
  // see who joined first. Names arrive with the profile query, so the order
  // settles once — everything else on the page loads in the same breath.
  const rows = [...userIds].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));

  return (
    <div className="card enter">
      <div className="card-head">
        <h2>Travelers</h2>
        <span className="muted small">{userIds.length}</span>
      </div>

      {rows.length === 0 ? (
        <div className="card-body">
          <p className="muted small">Nobody has joined this trip yet.</p>
        </div>
      ) : (
        rows.map(userId => {
          const profile = profiles?.get(userId);
          const docs = review?.travelers.find(t => t.userId === userId) ?? null;
          const paid = money?.travelers.find(t => t.userId === userId) ?? null;
          const late = countLateItems(docs?.items ?? []);

          const detail =
            [
              docs ? `${docs.done}/${docs.total} approved` : reviewPending ? 'Loading…' : null,
              hasMoney && paid ? moneyLine(paid, isOffline) : null,
            ]
              .filter(Boolean)
              .join(' · ') || 'No details yet';

          return (
            <Link key={userId} to={`/trips/${tripId}/t/${userId}`} className="row-link">
              <span className="row" style={{ gap: 12, minWidth: 0 }}>
                <Avatar url={profile?.photoUrl ?? null} name={nameOf(userId)} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block' }}>{nameOf(userId)}</span>
                  <span className="muted small" style={{ display: 'block', marginTop: 2 }}>
                    {detail}
                  </span>
                </span>
              </span>
              <span className="row" style={{ gap: 12 }}>
                {/* Late first: chasing somebody takes days, saying yes to a
                    file takes five seconds. */}
                {late > 0 && <span className="tag tag-danger">{late} late</span>}
                {docs && docs.toReview > 0 && (
                  <span className="tag tag-wait">{docs.toReview} waiting</span>
                )}
                <span className="muted" aria-hidden>
                  ›
                </span>
              </span>
            </Link>
          );
        })
      )}
    </div>
  );
}

/**
 * One traveler's money, short enough to sit on a list row.
 *
 * Both numbers, always — "paid in full" would need a threshold rule, and this
 * file is not where money rules get invented. On an offline trip Swellyo has
 * no idea what arrived, so quoting a paid figure there would be a lie.
 */
function moneyLine(m: TravelerMoney, isOffline: boolean): string {
  if (m.totalUsd === null) return 'no price set';
  if (isOffline) return `${formatUsd(m.totalUsd)} · paid outside Swellyo`;
  return `${formatUsd(m.paidUsd)} of ${formatUsd(m.totalUsd)} paid`;
}

/**
 * Money, in one line, linking to the full page.
 *
 * Hidden entirely when the trip has no payment steps and no price anywhere —
 * a peer trip that never charged for anything has no money story, and an
 * empty card is worse than no card.
 *
 * Every number comes from useTripMoney, the same source the money page reads,
 * so the two cannot disagree.
 */
function MoneyCard({ tripId }: { tripId: string }) {
  const { money, steps, trip, isOffline, hasMoney, isPending, isError } = useTripMoney(tripId);

  /**
   * When the rest of the money is due.
   *
   * Read-only here, on purpose. It sits with the amounts it governs — an
   * operator reading "$2,000 collected of $6,000" should not have to go
   * looking for the date that number is measured against — but it is CHANGED
   * with the other deadlines, in one place, so there is never a second editor
   * that could disagree with the first.
   *
   * Two shapes, because the database stores them in two places: a managed
   * trip keeps its deadline on the `balance` requirement row, and an offline
   * trip on a plain trip column (the DB refuses pay rows on an offline trip,
   * so it has nowhere else to put it).
   */
  const dueISO = isOffline
    ? resolveDeadlineISO(trip?.startDate ?? null, trip?.offlinePaymentDueDaysBefore ?? 0)
    : (steps.find(s => s.kind === 'balance')?.dueDate ?? null);
  const showDue = isOffline ? trip?.offlinePaymentDueDaysBefore != null && !!dueISO : !!dueISO;

  // A failed money read must not take the rest of the snapshot down with it.
  if (isError) return null;
  if (isPending) {
    return (
      <div className="card enter">
        <div className="card-head">
          <h2>Money</h2>
        </div>
        <div className="card-body">
          <span className="muted small">Loading…</span>
        </div>
      </div>
    );
  }
  if (!money || !hasMoney) return null;

  return (
    <>
      <ModeNotices hiddenCount={money.hiddenCount} showTestMode={false} />
      <Link to={`/trips/${tripId}/money`} className="card enter card-link" style={{ display: 'block', color: 'inherit' }}>
        <div className="card-head">
          <h2>Money</h2>
          <span className="muted" aria-hidden>
            ›
          </span>
        </div>
        <div className="card-body">
          {isOffline ? (
            <>
              <p>
                <strong>{formatUsd(money.expectedUsd)}</strong> expected in total
              </p>
              <p className="muted small" style={{ marginTop: 8 }}>
                Paid outside Swellyo. Swellyo does not know what has arrived.
              </p>
            </>
          ) : (
            <>
              <p>
                <strong>{formatUsd(money.collectedUsd)}</strong> collected of{' '}
                {formatUsd(money.expectedUsd)}
              </p>
              <p className="muted small" style={{ marginTop: 8 }}>
                {steps
                  .map(
                    s =>
                      `${money.paidCountByKind[s.kind]} of ${money.travelers.length} paid the ${s.kind === 'deposit' ? 'deposit' : 'balance'}`,
                  )
                  .join(' · ') || 'No payment steps on this trip.'}
              </p>
            </>
          )}
          {showDue && (
            <p className="muted small" style={{ marginTop: 8 }}>
              Final payment due {formatDate(dueISO)}
              {!isOffline && ' · change the date under Documents'}
            </p>
          )}
          {money.noPriceCount > 0 && (
            <p className="muted small" style={{ marginTop: 8 }}>
              {plural(money.noPriceCount, 'traveler has', 'travelers have')} no price set.
            </p>
          )}
        </div>
      </Link>
    </>
  );
}

function SurfStats({ profiles }: { profiles: { surfLevel: string | null; boardType: string | null; age: number | null; countryFrom: string | null }[] }) {
  if (profiles.length === 0) return <p className="muted small">No travelers yet.</p>;

  const levels = tally(profiles.map(p => p.surfLevel));
  const boards = tally(profiles.map(p => p.boardType));
  const ages = profiles.map(p => p.age).filter((a): a is number => typeof a === 'number');
  const countries = new Set(profiles.map(p => p.countryFrom).filter(Boolean));

  return (
    <div className="stack" style={{ gap: 8 }}>
      <p>{levels.length ? levels.map(([k, n]) => `${n} ${pretty(k)}`).join(' · ') : 'Surf level not set'}</p>
      <p className="muted small">
        {boards.length ? boards.map(([k, n]) => `${n} ${pretty(k)}`).join(' · ') : 'Board type not set'}
      </p>
      <p className="muted small">
        {ages.length > 0 && `Ages ${Math.min(...ages)}–${Math.max(...ages)}`}
        {ages.length > 0 && countries.size > 0 && ' · '}
        {countries.size > 0 && plural(countries.size, 'country', 'countries')}
      </p>
    </div>
  );
}

function tally(values: (string | null)[]): [string, number][] {
  const m = new Map<string, number>();
  for (const v of values) {
    if (!v) continue;
    m.set(v, (m.get(v) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function pretty(s: string): string {
  return s.replace(/_/g, ' ');
}

/**
 * The one line that answers the question the operator came with.
 *
 * Before this the page had no idea when the trip was: "7/15 in" read exactly
 * the same three months out and three days out, and nothing was ever marked
 * late — so the operator held the trip date in their head and did the
 * arithmetic themselves, every time they opened the page.
 *
 * NOTHING RENDERS WHILE THE REVIEW IS LOADING. A line that says "nothing late"
 * and flips to "2 late" a second later is worse than a beat of nothing: the
 * operator reads the first one and relaxes.
 */
function TripStatusLine({
  startDate,
  endDate,
  late,
  loading,
}: {
  startDate: string | null;
  endDate: string | null;
  late: number;
  loading: boolean;
}) {
  if (loading) return null;

  const phase = tripPhase(startDate, endDate);

  // Chasing is over once the trip has ended, so the late count stops being
  // something to act on and starts being a reproach.
  if (phase.kind === 'ended') {
    return <span style={{ display: 'block', marginTop: 4 }}>Trip ended</span>;
  }

  const when =
    phase.kind === 'upcoming'
      ? plural(phase.days, 'day') + ' to go'
      : phase.kind === 'today'
        ? 'Leaves today'
        : phase.kind === 'under_way'
          ? 'Under way'
          : null; // no start date — a trip still being planned

  return (
    <span style={{ display: 'block', marginTop: 4 }}>
      {when && <>{when} · </>}
      {late > 0 ? (
        <strong style={{ color: 'var(--danger)' }}>{plural(late, 'document')} late</strong>
      ) : (
        'nothing late'
      )}
    </span>
  );
}

/**
 * "Travelers can't pay yet."
 *
 * The gap between "this trip collects payment" and "a traveler can pay today".
 * That gap exists on purpose — since 2026-08-05 an operator publishes while
 * Stripe reviews them — and this banner is what keeps it honest: the trip is
 * live, the money is not.
 *
 * ONLY THE OPERATOR OF RECORD SEES IT. `operator_payout_accounts` is readable
 * by its owner alone (`opa_read_own`), which is also the right product answer:
 * a Manager cannot fix somebody else's Stripe account.
 */
function PaymentsNotLiveBanner({ trip }: { trip: OperatorTrip }) {
  const { user } = useAuth();

  // Offline trips are paid outside Swellyo and have no Stripe account to wait
  // on. `enabled` also keeps every operator running one from making a payout
  // read just by opening a trip.
  const mine = !!user && !!trip.hostId && trip.hostId === user.id;
  // `=== 'managed'`, the same test `useTripMoney` makes. A null payment mode is
  // not a managed trip, and nagging one about Stripe would be noise.
  const managed = trip.paymentMode === 'managed';

  const payout = useQuery({
    queryKey: ['payout', user?.id],
    queryFn: () => fetchPayoutState(user!.id),
    enabled: mine && managed,
    staleTime: 60 * 1000,
  });

  if (!mine || !managed || !payout.data) return null;

  // Silence while we do not know yet, and once money works. `tripPaymentWarning`
  // owns both decisions so this page cannot disagree with the app's banner.
  const state = deriveConnectState(connectStatusOf(payout.data));
  const text = tripPaymentWarning(state);
  if (!text) return null;

  return (
    <div
      className="banner enter"
      style={
        // Red for a refusal only. A review in progress is the operator's own
        // backlog, not an error, and warning colours there tell them something
        // is wrong when nothing is.
        state === 'blocked'
          ? { background: 'var(--danger-bg)', color: 'var(--danger)' }
          : { background: 'var(--wait-bg)', color: 'var(--wait)' }
      }
    >
      <span>{text}</span>
    </div>
  );
}
