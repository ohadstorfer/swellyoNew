import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { fetchMembers, fetchTrip } from '../services/trips';
import { fetchTripReview } from '../services/review';
import { fetchCounts, fetchMedicalFlags } from '../services/counts';
import { fetchProfiles } from '../services/travelers';
import { isKnownUploadKind, kindLabel } from '../domain/catalog';
import { isUploadRequirement } from '../domain/requirements';
import { useTripMoney } from '../services/useTripMoney';
import { formatRange, formatUsd, plural } from '../lib/format';
import { ErrorBox, Loading, CountPair } from '../components/StateBits';
import { PageHead } from '../components/Shell';
import { ModeNotices } from './MoneyPage';

export function TripPage() {
  const { tripId = '' } = useParams();

  const trip = useQuery({ queryKey: ['trip', tripId], queryFn: () => fetchTrip(tripId) });
  const members = useQuery({ queryKey: ['members', tripId], queryFn: () => fetchMembers(tripId) });

  const userIds = useMemo(() => (members.data ?? []).map(m => m.userId), [members.data]);

  const review = useQuery({
    queryKey: ['review', tripId, userIds],
    queryFn: () => fetchTripReview(tripId, userIds),
    enabled: members.isSuccess,
  });
  const counts = useQuery({ queryKey: ['counts', tripId], queryFn: () => fetchCounts(tripId) });
  const flags = useQuery({ queryKey: ['flags', tripId], queryFn: () => fetchMedicalFlags(tripId) });
  const profiles = useQuery({
    queryKey: ['profiles', userIds],
    queryFn: () => fetchProfiles(userIds),
    enabled: userIds.length > 0,
  });

  if (trip.isError) return <ErrorBox error={trip.error} onRetry={() => void trip.refetch()} />;
  if (members.isError)
    return <ErrorBox error={members.error} onRetry={() => void members.refetch()} />;
  if (trip.isPending || members.isPending) return <Loading what="Loading the trip" />;

  const memberCount = userIds.length;
  const countBy = new Map((counts.data ?? []).map(c => [c.requirementId, c]));
  const reqs = review.data?.requirements ?? [];

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
        sub={`${formatRange(trip.data.startDate, trip.data.endDate)} · ${plural(memberCount, 'traveler')}`}
      />

      <div className="stack">
        {/* ── Needs review ──────────────────────────────────────────────── */}
        {review.data && review.data.totalToReview > 0 && (
          <Link to={`/trips/${tripId}/d/${firstPendingRequirement(review.data) ?? ''}`} className="banner enter">
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

        {/* ── Money ─────────────────────────────────────────────────────── */}
        <MoneyCard tripId={tripId} />

        {/* ── Documents ─────────────────────────────────────────────────── */}
        <div className="card enter">
          <div className="card-head">
            <h2>Documents</h2>
          </div>
          <div className="card-body">
            {review.isPending && <span className="muted small">Loading…</span>}
            {review.isError && <ErrorBox error={review.error} onRetry={() => void review.refetch()} />}

            {review.data && uploads.length === 0 && custom.length === 0 && (
              <p className="muted small">No document requirements on this trip.</p>
            )}

            {uploads.map(r => {
              const c = countBy.get(r.id);
              return (
                <Link
                  key={r.id}
                  to={`/trips/${tripId}/d/${r.id}`}
                  className="row-between"
                  style={{
                    padding: '9px 0',
                    borderBottom: '1px solid var(--line)',
                    color: 'inherit',
                  }}
                >
                  <span>{kindLabel(r.kind, r.title)}</span>
                  <span className="row" style={{ gap: 10 }}>
                    <CountPair
                      received={c?.received ?? 0}
                      approved={c?.approved ?? 0}
                      expected={c?.expected ?? memberCount}
                    />
                    <span className="muted" aria-hidden>
                      ›
                    </span>
                  </span>
                </Link>
              );
            })}

            {/* Waiver and medical are not uploads, so they get a short line. */}
            {(waiver || medical) && (
              <p className="muted small" style={{ paddingTop: 10 }}>
                {waiver && `Waiver signed ${agreedCount(waiver.id)}/${memberCount}`}
                {waiver && medical && ' · '}
                {medical && `Medical form ${agreedCount(medical.id)}/${memberCount}`}
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
                    style={{ padding: '9px 0', color: 'inherit' }}
                  >
                    <span>{r.title}</span>
                    <span className="row" style={{ gap: 10 }}>
                      <CountPair
                        received={c?.received ?? 0}
                        approved={c?.approved ?? 0}
                        expected={c?.expected ?? memberCount}
                      />
                      <span className="muted" aria-hidden>
                        ›
                      </span>
                    </span>
                  </Link>
                );
              })}
              <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                Items you created yourself. They are counted, but they do not get their own tile.
              </p>
            </div>
          </div>
        )}

        {/* ── Medical flags ─────────────────────────────────────────────── */}
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
            <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
              Counts only. No names on this screen.
            </p>
          </div>
        </div>

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
      </div>
    </>
  );
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
  const { money, steps, isOffline, hasMoney, isPending, isError } = useTripMoney(tripId);

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
              <p className="muted small" style={{ marginTop: 6 }}>
                Paid outside Swellyo. Swellyo does not know what has arrived.
              </p>
            </>
          ) : (
            <>
              <p>
                <strong>{formatUsd(money.collectedUsd)}</strong> collected of{' '}
                {formatUsd(money.expectedUsd)}
              </p>
              <p className="muted small" style={{ marginTop: 6 }}>
                {steps
                  .map(
                    s =>
                      `${money.paidCountByKind[s.kind]} of ${money.travelers.length} paid the ${s.kind === 'deposit' ? 'deposit' : 'balance'}`,
                  )
                  .join(' · ') || 'No payment steps on this trip.'}
              </p>
            </>
          )}
          {money.noPriceCount > 0 && (
            <p className="muted small" style={{ marginTop: 6 }}>
              {plural(money.noPriceCount, 'traveler has', 'travelers have')} no price set.
            </p>
          )}
        </div>
      </Link>
    </>
  );
}

/** Jump target for the review banner: the first requirement with work waiting. */
function firstPendingRequirement(review: {
  requirements: { id: string }[];
  travelers: { items: { requirementId: string; state: string }[] }[];
}): string | null {
  for (const r of review.requirements) {
    const pending = review.travelers.some(
      t => t.items.find(i => i.requirementId === r.id)?.state === 'submitted',
    );
    if (pending) return r.id;
  }
  return null;
}

function SurfStats({ profiles }: { profiles: { surfLevel: string | null; boardType: string | null; age: number | null; countryFrom: string | null }[] }) {
  if (profiles.length === 0) return <p className="muted small">No travelers yet.</p>;

  const levels = tally(profiles.map(p => p.surfLevel));
  const boards = tally(profiles.map(p => p.boardType));
  const ages = profiles.map(p => p.age).filter((a): a is number => typeof a === 'number');
  const countries = new Set(profiles.map(p => p.countryFrom).filter(Boolean));

  return (
    <div className="stack" style={{ gap: 7 }}>
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
