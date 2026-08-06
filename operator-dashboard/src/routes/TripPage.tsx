import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { fetchMembers, fetchTrip } from '../services/trips';
import { fetchTripReview } from '../services/review';
import { fetchCounts, fetchMedicalFlags } from '../services/counts';
import { fetchProfiles, type SurferProfile } from '../services/travelers';
import type { TripReview } from '../services/review';
import { isKnownUploadKind, kindLabel } from '../domain/catalog';
import { isUploadRequirement } from '../domain/requirements';
import { useTripMoney } from '../services/useTripMoney';
import type { TravelerMoney } from '../domain/money';
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

            {/* Waiver and medical are not uploads, so they get a short line
                rather than a row of their own. They still OPEN, though — the
                page behind them lists who has done it and who has not, which is
                the only question this line raises. It read as dead text while
                the app made the same two items tappable. */}
            {(waiver || medical) && (
              <p className="small" style={{ paddingTop: 10 }}>
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

        {/* ── Travelers ─────────────────────────────────────────────────── */}
        <TravelersCard
          tripId={tripId}
          userIds={userIds}
          review={review.data}
          reviewPending={review.isPending}
          profiles={profiles.data}
        />
      </div>
    </>
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

          const detail =
            [
              docs ? `${docs.done}/${docs.total} approved` : reviewPending ? 'Loading…' : null,
              hasMoney && paid ? moneyLine(paid, isOffline) : null,
            ]
              .filter(Boolean)
              .join(' · ') || 'No details yet';

          return (
            <Link key={userId} to={`/trips/${tripId}/t/${userId}`} className="row-link">
              <span className="row" style={{ gap: 11, minWidth: 0 }}>
                <Avatar url={profile?.photoUrl ?? null} name={nameOf(userId)} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block' }}>{nameOf(userId)}</span>
                  <span className="muted small" style={{ display: 'block', marginTop: 2 }}>
                    {detail}
                  </span>
                </span>
              </span>
              <span className="row" style={{ gap: 10 }}>
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

/** Profile photo, or the first letter when there is none. */
function Avatar({ url, name }: { url: string | null; name: string }) {
  const box = { width: 34, height: 34, borderRadius: 99, flexShrink: 0 } as const;

  if (url) return <img src={url} alt="" style={{ ...box, objectFit: 'cover' }} />;

  return (
    <span
      aria-hidden
      style={{
        ...box,
        display: 'grid',
        placeItems: 'center',
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        color: 'var(--muted)',
        fontSize: 13,
        fontWeight: 640,
      }}
    >
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
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
