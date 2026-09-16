import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { tripSummary, travelerCounts, type TripMoney } from '../domain/money';
import type { TripMember } from '../services/trips';
import { formatUsd, plural } from '../lib/format';

/**
 * Payments collected · Fully paid · Travelers. Product Specs, Frame 39433.
 *
 * ── Why "collected" is wide and the other two share a row ──────────────────
 * The drawing does the same, and it is right: the money is one number the
 * operator watches move, while the other two are ratios they check. Three
 * equal tiles would say all three matter equally.
 *
 * ── The travelers tile is the one that fixes something ─────────────────────
 * `participant_count` cannot see anyone still onboarding, so a trip with eight
 * people actively paying has read as "2 going" everywhere in this product. The
 * tile names the seat count — the honest answer to "how full is this" — and
 * says the onboarding group out loud underneath rather than swallowing it.
 *
 * ── No spinner ─────────────────────────────────────────────────────────────
 * Three tiles that flash skeletons on every cache refresh are worse than three
 * tiles that briefly say "—". The page around them already has its own
 * loading state.
 */
export function SummaryTiles({
  tripId,
  money,
  members,
  maxParticipants,
  isOffline,
  canViewMoney,
}: {
  tripId: string;
  money: TripMoney | null;
  members: TripMember[] | undefined;
  maxParticipants: number | null;
  isOffline: boolean;
  canViewMoney: boolean;
}) {
  const summary = useMemo(() => (money ? tripSummary(money) : null), [money]);
  const counts = useMemo(
    () => travelerCounts({ travelers: members ?? [], maxParticipants }),
    [members, maxParticipants],
  );

  const pct =
    summary && summary.expectedUsd > 0
      ? Math.min(1, Math.max(0, summary.collectedUsd / summary.expectedUsd))
      : 0;
  const paidPct = summary && summary.priced > 0 ? summary.fullyPaid / summary.priced : 0;
  const seatPct =
    counts.capacity && counts.capacity > 0 ? Math.min(1, counts.going / counts.capacity) : 0;

  return (
    <div className="stack enter" style={{ gap: 12 }}>
      {canViewMoney && (
        <Link
          to={`/trips/${tripId}/payments`}
          className="card card-link"
          style={{ display: 'block', color: 'inherit' }}
        >
          <div className="card-body">
            <div className="row-between">
              <span className="muted small">
                {isOffline ? 'Expected in total' : 'Payments collected'}
              </span>
              <span className="muted" aria-hidden>
                ›
              </span>
            </div>
            <div className="row" style={{ gap: 12, alignItems: 'baseline', marginTop: 4 }}>
              <strong style={{ fontSize: 'var(--fs-3xl)', lineHeight: '32px', letterSpacing: '-0.02em' }}>
                {formatUsd(isOffline ? summary?.expectedUsd : summary?.collectedUsd)}
              </strong>
              {!isOffline && summary && (
                <span className="muted small">of {formatUsd(summary.expectedUsd)}</span>
              )}
            </div>
            {!isOffline && <Meter pct={pct} />}
          </div>
        </Link>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: canViewMoney ? '1fr 1fr' : '1fr',
          gap: 12,
        }}
      >
        {canViewMoney && (
          <div className="card">
            <div className="card-body">
              <span className="muted small">Fully paid</span>
              <div style={{ marginTop: 4 }}>
                <strong style={{ fontSize: 'var(--fs-lg)', lineHeight: '24px', fontWeight: 700, color: 'var(--text)' }}>
                  {summary ? `${summary.fullyPaid}/${summary.priced}` : '—'}
                </strong>
              </div>
              <span className="muted small">
                {summary && summary.fullyPaid > 0
                  ? `${formatUsd(summary.fullyPaidUsd)} settled`
                  : 'Nobody yet'}
              </span>
              <Meter pct={paidPct} />
            </div>
          </div>
        )}

        <div className="card">
          <div className="card-body">
            <span className="muted small">Travelers</span>
            <div style={{ marginTop: 4 }}>
              <strong style={{ fontSize: 'var(--fs-lg)', lineHeight: '24px', fontWeight: 700, color: 'var(--text)' }}>
                {counts.capacity ? `${counts.going}/${counts.capacity}` : counts.going}
              </strong>
            </div>
            <span className="muted small">
              {counts.onboarding > 0
                ? `+${counts.onboarding} still joining`
                : counts.capacity
                  ? 'Seats taken'
                  : plural(counts.going, 'traveler')}
            </span>
            {counts.capacity ? <Meter pct={seatPct} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The thin rule under a figure. Never animated: this is a status readout, and
 *  a bar that grows on every refetch reads as activity. */
function Meter({ pct }: { pct: number }) {
  return (
    <div
      style={{
        height: 6,
        borderRadius: 8,
        background: 'var(--line-strong)',
        overflow: 'hidden',
        marginTop: 8,
      }}
    >
      <div
        style={{
          height: 6,
          borderRadius: 8,
          background: 'var(--cyan)',
          width: `${Math.round(pct * 100)}%`,
        }}
      />
    </div>
  );
}
