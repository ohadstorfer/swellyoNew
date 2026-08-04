import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { fetchProfiles } from '../services/travelers';
import { setTravelerPrice } from '../services/actions';
import { useTripMoney } from '../services/useTripMoney';
import { STRIPE_LIVEMODE } from '../services/payments';
import { STEP_STATE_LABEL, type PayStepState, type TravelerMoney } from '../domain/money';
import { formatDate, formatUsd, plural } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { ErrorBox, Loading } from '../components/StateBits';
import { PageHead } from '../components/Shell';
import { TravelerPriceDialog } from '../components/TravelerPriceDialog';

export function MoneyPage() {
  const { tripId = '' } = useParams();
  const { user } = useAuth();
  const qc = useQueryClient();

  const { money, trip, steps, isOffline, hasDepositStep, isPending, isError, error, refetch } =
    useTripMoney(tripId);

  const userIds = useMemo(() => (money?.travelers ?? []).map(t => t.userId), [money]);
  const profiles = useQuery({
    queryKey: ['profiles', userIds],
    queryFn: () => fetchProfiles(userIds),
    enabled: userIds.length > 0,
  });

  const [pricing, setPricing] = useState<TravelerMoney | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (args: { userId: string; totalUsd: number; depositUsd: number | null }) =>
      setTravelerPrice({ tripId, ...args }),
    onSuccess: () => {
      setPricing(null);
      setSaveError(null);
      void qc.invalidateQueries({ queryKey: ['members', tripId] });
    },
    onError: e => setSaveError(friendlyError(e)),
  });

  if (isError) return <ErrorBox error={error} onRetry={refetch} />;
  if (isPending || !money || !trip) return <Loading what="Loading the money" />;

  const nameOf = (userId: string) => profiles.data?.get(userId)?.name ?? 'Traveler';

  // Only the operator of record may price anyone. `role = 'host'` includes
  // every promoted admin, and the database checks host_id — showing them the
  // button would hand them a raw "not your trip" error.
  const canSetPrice = !!user && trip.hostId === user.id;

  return (
    <>
      <PageHead
        back={`/trips/${tripId}`}
        backLabel={trip.title}
        title="Money"
        sub={`${plural(money.travelers.length, 'traveler')} · ${formatUsd(money.collectedUsd)} collected`}
      />

      <div className="stack">
        <ModeNotices hiddenCount={money.hiddenCount} />

        {/* ── Totals ────────────────────────────────────────────────────── */}
        <div className="card enter">
          <div className="card-head">
            <h2>Totals</h2>
          </div>
          <div className="card-body">
            {isOffline ? (
              <>
                <p>
                  <strong>{formatUsd(money.expectedUsd)}</strong> expected in total
                </p>
                <p className="muted small" style={{ marginTop: 8 }}>
                  Payments for this trip happen outside Swellyo. Swellyo does not know what has
                  been paid.
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
                    .join(' · ') || 'This trip has no payment steps.'}
                </p>
              </>
            )}
            {money.noPriceCount > 0 && (
              <p className="muted small" style={{ marginTop: 8 }}>
                {plural(money.noPriceCount, 'traveler has', 'travelers have')} no price set.
              </p>
            )}
          </div>
        </div>

        {/* ── Per traveler ──────────────────────────────────────────────── */}
        <div className="card enter">
          <div className="card-head">
            <h2>Travelers</h2>
          </div>
          <div className="tscroll">
            <table>
              <thead>
                <tr>
                  <th>Traveler</th>
                  <th>Total</th>
                  {steps.map(s => (
                    <th key={s.requirementId}>{s.title}</th>
                  ))}
                  <th>Paid so far</th>
                  {canSetPrice && <th style={{ textAlign: 'right' }}>Price</th>}
                </tr>
              </thead>
              <tbody>
                {money.travelers.map(t => (
                  <tr key={t.userId}>
                    <td>{nameOf(t.userId)}</td>
                    <td>{t.totalUsd === null ? <span className="muted">No price set</span> : formatUsd(t.totalUsd)}</td>
                    {steps.map(s => {
                      const step = t.steps.find(x => x.requirementId === s.requirementId);
                      return (
                        <td key={s.requirementId}>
                          {step ? <StepCell state={step.state} dueUsd={step.dueUsd} paidUsd={step.paidUsd} /> : '—'}
                        </td>
                      );
                    })}
                    <td>{formatUsd(t.paidUsd)}</td>
                    {canSetPrice && (
                      <td style={{ textAlign: 'right' }}>
                        <button
                          className="btn btn-sm"
                          onClick={() => {
                            setSaveError(null);
                            setPricing(t);
                          }}
                        >
                          Set price
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {money.travelers.length === 0 && (
                  <tr>
                    <td colSpan={3 + steps.length + (canSetPrice ? 1 : 0)} className="muted small">
                      Nobody has joined this trip yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── The ledger ────────────────────────────────────────────────── */}
        <PaymentList events={money.events} nameOf={nameOf} isOffline={isOffline} />
      </div>

      {pricing && (
        <TravelerPriceDialog
          travelerName={nameOf(pricing.userId)}
          currentTotalUsd={pricing.totalUsd}
          currentDepositUsd={pricing.steps.find(s => s.kind === 'deposit')?.dueUsd ?? null}
          hasDepositStep={hasDepositStep}
          paidUsd={pricing.paidUsd}
          busy={save.isPending}
          error={saveError}
          onCancel={() => {
            setPricing(null);
            setSaveError(null);
          }}
          onSave={(totalUsd, depositUsd) =>
            save.mutate({ userId: pricing.userId, totalUsd, depositUsd })
          }
        />
      )}
    </>
  );
}

const STEP_TAG: Record<PayStepState, string> = {
  paid: 'tag-ok',
  unpaid: 'tag-idle',
  no_price: 'tag-idle',
};

/**
 * One step for one traveler.
 *
 * An unpaid step shows what is still owed, and a part-paid one shows both
 * numbers. The database has no "part paid" state — it reads unpaid until the
 * whole amount lands — so the tag stays binary and only the detail line
 * carries the extra. More detail is not disagreement.
 */
function StepCell({
  state,
  dueUsd,
  paidUsd,
}: {
  state: PayStepState;
  dueUsd: number | null;
  paidUsd: number;
}) {
  const partial = state === 'unpaid' && paidUsd > 0 && dueUsd !== null;
  return (
    <span className="row" style={{ gap: 8 }}>
      <span className={`tag ${STEP_TAG[state]}`}>{STEP_STATE_LABEL[state]}</span>
      {state === 'unpaid' && dueUsd !== null && (
        <span className="muted small">
          {partial ? `${formatUsd(paidUsd)} of ${formatUsd(dueUsd)}` : formatUsd(dueUsd)}
        </span>
      )}
    </span>
  );
}

/**
 * The raw rows, not just a total.
 *
 * Operators reconcile this against their Stripe dashboard. A single number
 * cannot be checked against anything; rows can.
 */
function PaymentList({
  events,
  nameOf,
  isOffline,
  title = 'Payments',
}: {
  events: { userId: string; eventType: string; amountUsd: number; createdAt: string | null }[];
  nameOf: (userId: string) => string;
  isOffline: boolean;
  title?: string;
}) {
  return (
    <div className="card enter">
      <div className="card-head">
        <h2>{title}</h2>
      </div>
      {events.length === 0 ? (
        <div className="card-body">
          <p className="muted small">
            {isOffline
              ? 'Swellyo is not collecting payments for this trip, so there is nothing to list.'
              : 'No payments yet.'}
          </p>
        </div>
      ) : (
        <div className="tscroll">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Traveler</th>
                <th>What</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e, i) => (
                <tr key={`${e.createdAt}-${e.userId}-${i}`}>
                  <td className="muted small">{formatDate(e.createdAt)}</td>
                  <td>{nameOf(e.userId)}</td>
                  <td className="muted small">
                    {e.eventType === 'refunded' ? 'Refund' : 'Payment'}
                  </td>
                  <td
                    style={{
                      textAlign: 'right',
                      color: e.amountUsd < 0 ? 'var(--danger)' : undefined,
                    }}
                  >
                    {formatUsd(e.amountUsd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Test mode, and a mode mismatch.
 *
 * VITE_STRIPE_LIVEMODE has to flip together with the database setting and the
 * app's own flag. Three flags is three chances to forget one, and forgetting
 * is otherwise silent — the totals would simply be wrong with nothing on
 * screen to say so. Finding events in the mode we are NOT counting is the
 * only signal available without a migration, so it is shown loudly.
 */
export function ModeNotices({
  hiddenCount,
  showTestMode = true,
}: {
  hiddenCount: number;
  /**
   * The trip snapshot passes false. The routine "you are in test mode" strip
   * belongs beside the numbers it qualifies, not on top of every trip page —
   * a banner that is always there stops being read. The mismatch warning is
   * different: it means something is actually wrong, so it shows everywhere.
   */
  showTestMode?: boolean;
}) {
  return (
    <>
      {showTestMode && !STRIPE_LIVEMODE && (
        <div className="banner enter" style={{ background: 'var(--warn-bg)', color: 'var(--warn)' }}>
          <span>Test mode — these are sandbox payments, not real money.</span>
        </div>
      )}
      {hiddenCount > 0 && (
        <div
          className="banner enter"
          style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}
        >
          <span>
            {plural(hiddenCount, 'payment is', 'payments are')} hidden. They come from the other
            Stripe mode — this site's setting may not match the database.
          </span>
        </div>
      )}
    </>
  );
}
