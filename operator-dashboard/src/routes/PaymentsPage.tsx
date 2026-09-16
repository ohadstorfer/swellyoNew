import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { fetchTrip } from '../services/trips';
import { fetchProfiles } from '../services/travelers';
import { fetchPaySteps, fetchPaymentEvents, STRIPE_LIVEMODE } from '../services/payments';
import { useTripAccess } from '../services/access';
import { saveBlob, safeFileName } from '../services/files';
import { ErrorBox, Loading, Avatar } from '../components/StateBits';
import { PageHead } from '../components/Shell';
import { formatDateTime, formatUsd, plural } from '../lib/format';
import type { PaymentEvent } from '../domain/money';

/**
 * Every payment on one trip, newest first.
 *
 * Product Specs §"Trip operator view": "Payments page — view all transactions,
 * amounts, profiles, times, export options."
 *
 * ── This page computes no totals ───────────────────────────────────────────
 * `buildTripMoney` is the one place a figure is derived, and it feeds the
 * summary tiles and the Money page. A second derivation here is how two screens
 * come to disagree about the same trip. Everything below is a list, a filter
 * and an export.
 *
 * ── Failed attempts and the other Stripe mode are HERE ─────────────────────
 * `buildTripMoney` drops both, correctly: a failed charge moved no money, and
 * test rows must never be added to live ones. But "she says she paid and it
 * did not work" is the single most common thing an operator brings to a
 * payments screen, and the answer is a failed row with a timestamp. So the
 * ledger holds everything, a toggle reveals it, and nothing here is ever
 * summed.
 *
 * ── Rule 1 ─────────────────────────────────────────────────────────────────
 * No new table, no new function, no migration. `fetchPaymentEvents` already
 * returned every row unfiltered — it was the caller that narrowed them.
 */
export function PaymentsPage() {
  const { tripId = '' } = useParams();
  const access = useTripAccess(tripId);
  const [showAll, setShowAll] = useState(false);

  const trip = useQuery({ queryKey: ['trip', tripId], queryFn: () => fetchTrip(tripId) });
  const events = useQuery({
    queryKey: ['payEvents', tripId],
    queryFn: () => fetchPaymentEvents(tripId),
  });
  const steps = useQuery({ queryKey: ['paySteps', tripId], queryFn: () => fetchPaySteps(tripId) });

  const userIds = useMemo(
    () => [...new Set((events.data ?? []).map(e => e.userId))],
    [events.data],
  );
  const profiles = useQuery({
    queryKey: ['profiles', userIds],
    queryFn: () => fetchProfiles(userIds),
    enabled: userIds.length > 0,
  });

  const stepTitles = useMemo(() => {
    const m = new Map<string, string>();
    (steps.data ?? []).forEach(s => m.set(s.requirementId, s.title));
    return m;
  }, [steps.data]);

  if (trip.isError) return <ErrorBox what="This trip" error={trip.error} onRetry={() => void trip.refetch()} />;
  if (events.isError)
    return <ErrorBox what="The payments" error={events.error} onRetry={() => void events.refetch()} />;
  if (trip.isPending || events.isPending) return <Loading what="Loading payments" />;

  if (access.ready && !access.can('payments.view_status')) {
    return (
      <>
        <PageHead back={`/trips/${tripId}`} backLabel="Back to the trip" title="Payments" />
        <div className="card">
          <div className="card-body">
            <p>You're on this trip's crew, but not for the money.</p>
            <p className="muted small" style={{ marginTop: 8 }}>
              Seeing what people paid needs the Manager tier or above.
            </p>
          </div>
        </div>
      </>
    );
  }

  const rows = events.data ?? [];
  const counted = (e: PaymentEvent) => e.isLivemode === STRIPE_LIVEMODE;
  const alwaysVisible = (e: PaymentEvent) => counted(e) && e.eventType !== 'failed';
  const hidden = rows.filter(e => !alwaysVisible(e)).length;
  const shown = showAll ? rows : rows.filter(alwaysVisible);

  const nameOf = (userId: string) => profiles.data?.get(userId)?.name ?? 'Traveler';
  const whatOf = (e: PaymentEvent) =>
    (e.requirementId ? stepTitles.get(e.requirementId) : null) ?? 'Payment';

  const exportCsv = () => {
    // The EXPORT always carries everything, whatever the toggle says. A
    // filtered spreadsheet is one that quietly lies to whoever opens it next,
    // and the mode column is right there to filter on.
    const csv = toCsv(rows, nameOf, whatOf);
    saveBlob(
      new Blob([csv], { type: 'text/csv;charset=utf-8' }),
      `${safeFileName(`payments-${trip.data.title}`)}.csv`,
    );
  };

  return (
    <>
      <PageHead
        back={`/trips/${tripId}`}
        backLabel="Back to the trip"
        title="Payments"
        sub={`${trip.data.title} · ${plural(rows.length, 'transaction')}`}
        right={
          access.can('data.export') && rows.length > 0 ? (
            <button className="btn btn-sm" onClick={exportCsv}>
              Export CSV
            </button>
          ) : undefined
        }
      />

      {rows.length === 0 ? (
        <div className="card">
          <div className="card-body">
            <p className="muted small">Nobody has paid for this trip yet.</p>
          </div>
        </div>
      ) : (
        <div className="stack">
          {hidden > 0 && (
            <button
              className="banner"
              style={{
                background: 'var(--wait-bg)',
                color: 'var(--wait)',
                border: 0,
                textAlign: 'left',
                cursor: 'pointer',
                width: '100%',
              }}
              onClick={() => setShowAll(v => !v)}
            >
              <span>
                {showAll
                  ? 'Hide failed attempts and rows from the other Stripe mode'
                  : `Show ${hidden} failed ${plural(hidden, 'attempt').replace(/^\d+ /, '')} and other-mode rows`}
              </span>
              <span aria-hidden>{showAll ? '−' : '+'}</span>
            </button>
          )}

          <div className="card">
            <div className="tscroll">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <Th>When</Th>
                    <Th>Traveler</Th>
                    <Th>What</Th>
                    <Th align="right">Amount</Th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map(e => (
                    <tr key={e.id} style={{ borderTop: '1px solid var(--line)' }}>
                      <Td>
                        <span className="small">{formatDateTime(e.createdAt)}</span>
                      </Td>
                      <Td>
                        <Link
                          to={`/trips/${tripId}/t/${e.userId}`}
                          className="row"
                          style={{ gap: 8, color: 'inherit' }}
                        >
                          <Avatar
                            url={profiles.data?.get(e.userId)?.photoUrl ?? null}
                            name={nameOf(e.userId)}
                            size={26}
                          />
                          <span className="small">{nameOf(e.userId)}</span>
                        </Link>
                      </Td>
                      <Td>
                        <span className="small">{whatOf(e)}</span>
                        {!counted(e) && (
                          <span className="tag tag-warn" style={{ marginLeft: 8 }}>
                            {e.isLivemode ? 'live' : 'test'} mode
                          </span>
                        )}
                      </Td>
                      <Td align="right">
                        {e.eventType === 'failed' ? (
                          <span className="tag tag-danger">Failed</span>
                        ) : (
                          <span
                            className="small"
                            style={{
                              fontVariantNumeric: 'tabular-nums',
                              color: e.eventType === 'refunded' ? 'var(--warn)' : 'inherit',
                            }}
                          >
                            {formatUsd(e.amountUsd)}
                          </span>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="muted small">
            Refunds are negative, so this column adds up to what the trip actually holds. Nothing
            on this page is totalled — the figures on the trip page are the ones to quote.
          </p>
        </div>
      )}
    </>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <th
      className="muted small"
      style={{ textAlign: align ?? 'left', padding: '12px 12px', fontWeight: 600 }}
    >
      {children}
    </th>
  );
}

function Td({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return <td style={{ textAlign: align ?? 'left', padding: '12px 12px' }}>{children}</td>;
}

/**
 * The ledger as CSV.
 *
 * Deliberately not "the table you see": it carries the Stripe mode and the raw
 * ISO timestamp, because a spreadsheet is opened months later by somebody who
 * was not looking at the screen. Amounts stay signed, so the column sums to the
 * trip's balance without anyone re-deriving signs.
 *
 * ⚠️ Mirrors `ledgerToCsv` in the app's operatorDashboardService — same columns,
 * same order, so two exports of the same trip can be diffed.
 */
function toCsv(
  rows: PaymentEvent[],
  nameOf: (userId: string) => string,
  whatOf: (e: PaymentEvent) => string,
): string {
  const head = ['Date (UTC)', 'Traveler', 'What', 'Type', 'Amount USD', 'Stripe mode', 'Event ID'];
  // Quote whenever the value could break a column, and double any quote inside
  // it — a traveler called O'Brien is fine, one called `A, B` is not.
  const cell = (v: string | number) => {
    const t = String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const lines = [head.join(',')];
  for (const e of rows) {
    lines.push(
      [
        cell(e.createdAt ?? ''),
        cell(nameOf(e.userId)),
        cell(whatOf(e)),
        cell(e.eventType),
        cell(e.amountUsd.toFixed(2)),
        cell(e.isLivemode ? 'live' : 'test'),
        cell(e.id),
      ].join(','),
    );
  }
  return lines.join('\n');
}
