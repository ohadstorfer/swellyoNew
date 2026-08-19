import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchMembers, fetchTrip } from '../services/trips';
import { fetchTripReview, type ReviewItem } from '../services/review';
import { fetchMedicalForm, fetchProfiles } from '../services/travelers';
import { isUploadRequirement } from '../domain/requirements';
import { approveDocuments, rejectDocument, setTravelerPrice } from '../services/actions';
import { downloadAll, downloadOne, safeFileName } from '../services/files';
import { useTripMoney } from '../services/useTripMoney';
import { STEP_STATE_LABEL } from '../domain/money';
import { useAuth } from '../lib/auth';
import { fileNameFor, formatDate, formatDateTime, formatUsd, plural } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { ErrorBox, Loading, StateTag } from '../components/StateBits';
import { PageHead } from '../components/Shell';
import { DocumentViewer } from '../components/DocumentViewer';
import { RejectDialog } from '../components/RejectDialog';
import { RefundDialog } from '../components/RefundDialog';
import { TravelerPriceDialog } from '../components/TravelerPriceDialog';
import { fetchRefunds } from '../services/refunds';
import { RemoveTravelerDialog } from '../components/RemoveTravelerDialog';
import { useTripAccess } from '../services/access';
import { explain, policyFromTrip } from '../domain/cancellation';

export function TravelerPage() {
  const { tripId = '', userId = '' } = useParams();
  const qc = useQueryClient();

  const [viewing, setViewing] = useState<ReviewItem | null>(null);
  const [rejecting, setRejecting] = useState<ReviewItem | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [exportState, setExportState] = useState<string | null>(null);

  const trip = useQuery({ queryKey: ['trip', tripId], queryFn: () => fetchTrip(tripId) });
  const members = useQuery({ queryKey: ['members', tripId], queryFn: () => fetchMembers(tripId) });
  const userIds = useMemo(() => (members.data ?? []).map(m => m.userId), [members.data]);

  const review = useQuery({
    queryKey: ['review', tripId, userIds],
    queryFn: () => fetchTripReview(tripId, userIds),
    enabled: members.isSuccess,
  });
  const profiles = useQuery({
    queryKey: ['profiles', userIds],
    queryFn: () => fetchProfiles(userIds),
    enabled: userIds.length > 0,
  });
  const medical = useQuery({
    queryKey: ['medical', tripId, userId],
    queryFn: () => fetchMedicalForm(tripId, userId),
  });

  const refreshAll = () => {
    void qc.invalidateQueries({ queryKey: ['review', tripId] });
    void qc.invalidateQueries({ queryKey: ['counts', tripId] });
  };

  const approve = useMutation({
    mutationFn: (id: string) => approveDocuments([id]),
    onSuccess: () => {
      setViewing(null);
      setActionError(null);
      refreshAll();
    },
    onError: e => setActionError(friendlyError(e)),
  });

  const reject = useMutation({
    mutationFn: ({ item, note }: { item: ReviewItem; note?: string }) =>
      rejectDocument({ id: item.documentId!, storagePath: item.storagePath }, note),
    onSuccess: () => {
      setRejecting(null);
      setViewing(null);
      setActionError(null);
      refreshAll();
    },
    onError: e => setActionError(friendlyError(e)),
  });

  if (trip.isError) return <ErrorBox error={trip.error} onRetry={() => void trip.refetch()} />;
  if (review.isError) return <ErrorBox error={review.error} onRetry={() => void review.refetch()} />;
  if (trip.isPending || members.isPending || review.isPending)
    return <Loading what="Loading traveler" />;

  const traveler = review.data.travelers.find(t => t.userId === userId);
  const profile = profiles.data?.get(userId);
  const name = profile?.name ?? 'Traveler';

  if (!traveler) {
    return (
      <>
        <PageHead back={`/trips/${tripId}`} backLabel={trip.data.title} title="Not found" />
        <p className="muted">That person is not on this trip.</p>
      </>
    );
  }

  // Same rule as everywhere else — a kind 'medical' row never has a file to
  // export, whatever its req_type says.
  const uploads = traveler.items.filter(i => isUploadRequirement(i));
  const exportable = uploads.filter(i => i.storagePath && !i.fileDeleted);

  async function exportAll() {
    setExportState('Preparing…');
    const result = await downloadAll(
      exportable.map(i => ({
        storagePath: i.storagePath,
        fileName: fileNameFor(i.storagePath, safeFileName(`${name} - ${i.title}`)),
        fileDeleted: i.fileDeleted,
      })),
      safeFileName(`${name} - ${trip.data!.title}`),
      (done, total) => setExportState(`Downloading ${done} of ${total}…`),
    );
    setExportState(`Saved ${plural(result.saved, 'file')}.`);
    setTimeout(() => setExportState(null), 6000);
  }

  return (
    <>
      <PageHead
        back={`/trips/${tripId}`}
        backLabel={trip.data.title}
        title={name}
        sub={`${traveler.done}/${traveler.total} done · ${plural(traveler.toReview, 'document')} waiting for you`}
        right={
          exportable.length > 0 ? (
            <button className="btn" onClick={() => void exportAll()} disabled={!!exportState}>
              {exportState ?? `Export all (${exportable.length})`}
            </button>
          ) : undefined
        }
      />

      {actionError && (
        <div className="card enter" style={{ borderColor: 'var(--danger)', marginBottom: 14 }}>
          <div className="card-body small" style={{ color: 'var(--danger)' }}>
            {actionError}
          </div>
        </div>
      )}

      <div className="stack">
        {/* ── Profile ───────────────────────────────────────────────────── */}
        <div className="card enter">
          <div className="card-head">
            <h2>Profile</h2>
          </div>
          <div className="card-body row" style={{ gap: 16, alignItems: 'flex-start' }}>
            {profile?.photoUrl && (
              <img
                src={profile.photoUrl}
                alt=""
                style={{ width: 56, height: 56, borderRadius: 99, objectFit: 'cover' }}
              />
            )}
            <div>
              <h3>{name}</h3>
              <p className="muted small" style={{ marginTop: 3 }}>
                {[
                  profile?.age ? `${profile.age}` : null,
                  profile?.countryFrom,
                  profile?.surfLevel?.replace(/_/g, ' '),
                  profile?.boardType?.replace(/_/g, ' '),
                ]
                  .filter(Boolean)
                  .join(' · ') || 'No profile details'}
              </p>
            </div>
          </div>
        </div>

        {/* ── Requirements ──────────────────────────────────────────────── */}
        <div className="card enter">
          <div className="card-head">
            <h2>Documents and agreements</h2>
          </div>
          <div className="tscroll">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>State</th>
                  <th>When</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {traveler.items.map(item => (
                  <tr key={item.requirementId}>
                    <td>
                      {item.title}
                      {item.fileDeleted && (
                        <div className="muted" style={{ fontSize: 12 }}>
                          File deleted after 30 days
                        </div>
                      )}
                      {item.note && (
                        <div className="muted" style={{ fontSize: 12 }}>
                          Note: {item.note}
                        </div>
                      )}
                    </td>
                    <td>
                      <StateTag state={item.state} />
                    </td>
                    <td className="muted small">
                      {item.submittedAt ? formatDate(item.submittedAt) : '—'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {item.storagePath && !item.fileDeleted ? (
                        <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                          <button className="btn btn-sm" onClick={() => setViewing(item)}>
                            View
                          </button>
                          <button
                            className="btn btn-sm"
                            onClick={() =>
                              void downloadOne(
                                item.storagePath!,
                                fileNameFor(
                                  item.storagePath,
                                  safeFileName(`${name} - ${item.title}`),
                                ),
                              )
                            }
                          >
                            Export
                          </button>
                        </div>
                      ) : (
                        <span className="muted small">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Money ─────────────────────────────────────────────────────── */}
        <TravelerMoneyCard tripId={tripId} userId={userId} name={name} />

        {/* ── Medical ───────────────────────────────────────────────────── */}
        <MedicalCard
          name={name}
          form={medical.data ?? null}
          loading={medical.isPending}
        />

        {/* ── Remove ────────────────────────────────────────────────────── */}
        {/* Last on the page, and the only thing under Medical: this page exists
            to review someone, and the destructive action should be the one you
            travel to, not the one your cursor lands on. */}
        <RemoveCard tripId={tripId} userId={userId} name={name} />
      </div>

      {viewing && (
        <DocumentViewer
          item={viewing}
          travelerName={name}
          busy={approve.isPending}
          onClose={() => setViewing(null)}
          onApprove={() => approve.mutate(viewing.documentId!)}
          onReject={() => setRejecting(viewing)}
        />
      )}

      {rejecting && (
        <RejectDialog
          travelerName={name}
          requirementTitle={rejecting.title}
          busy={reject.isPending}
          onCancel={() => setRejecting(null)}
          onConfirm={note => reject.mutate({ item: rejecting, note })}
        />
      )}
    </>
  );
}

/**
 * What this one person owes and has paid.
 *
 * Reads the same useTripMoney the trip snapshot and the money page use, so
 * the three always agree. Setting a price is owner-only — the RPC checks
 * `group_trips.host_id`, and "host" on this site includes promoted admins.
 */
function TravelerMoneyCard({
  tripId,
  userId,
  name,
}: {
  tripId: string;
  userId: string;
  name: string;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { money, trip, isOffline, hasDepositStep, hasMoney, isPending, isError } =
    useTripMoney(tripId);

  const [pricing, setPricing] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** The payment currently being refunded, or null. */
  const [refunding, setRefunding] = useState<{ id: string; amountUsd: number } | null>(null);
  /**
   * The refund just issued, so the page can confirm it.
   *
   * `seenRefunds` is how many refund rows were on screen at that moment. The
   * ledger row is written by `stripe-webhook`, not by us, so it arrives a
   * second or two later — comparing the count tells us whether it has landed
   * without a timer that could lie in either direction.
   */
  const [justRefunded, setJustRefunded] = useState<
    { amountUsd: number; seenRefunds: number } | null
  >(null);

  // Refund attempts, including the ones that never moved money. Kept out of
  // useTripMoney on purpose: that hook feeds three pages' totals, and a blocked
  // attempt is not money — folding it in would make it look like one.
  const refunds = useQuery({
    queryKey: ['refunds', tripId],
    queryFn: () => fetchRefunds(tripId),
  });

  const save = useMutation({
    mutationFn: (args: { totalUsd: number; depositUsd: number | null }) =>
      setTravelerPrice({ tripId, userId, ...args }),
    onSuccess: () => {
      setPricing(false);
      setSaveError(null);
      void qc.invalidateQueries({ queryKey: ['members', tripId] });
    },
    onError: e => setSaveError(friendlyError(e)),
  });

  // A failed or empty money read must not blank the rest of the page.
  if (isError || (!isPending && (!money || !hasMoney))) return null;

  const me = money?.travelers.find(t => t.userId === userId) ?? null;
  const canSetPrice = !!user && !!trip && trip.hostId === user.id;
  // Same test as the price button, and for the same reason: the server gate is
  // `money.manage`, which the operator of record always holds. Hiding the
  // button is UX — `payments-refund` re-checks the capability, so a hidden
  // button is not the security boundary.
  const canRefund = canSetPrice && !isOffline;

  // The trip's own frozen terms. `policyFromTrip` returns null for a NULL or
  // legacy preset — "not specified", never a coerced default.
  const policy = policyFromTrip(
    trip
      ? {
          cancellation_preset: trip.cancellationPreset,
          cancellation_rules: trip.cancellationRules,
          cancellation_notes: trip.cancellationNotes,
        }
      : null,
  );
  const policyLines = policy ? explain(policy) : [];

  const refundedRows = (me?.events ?? []).filter(e => e.eventType === 'refunded').length;
  /** Issued, but Stripe's own row has not reached the ledger yet. */
  const refundLanding = !!justRefunded && refundedRows <= justRefunded.seenRefunds;

  const myRefunds = (refunds.data ?? []).filter(r => r.userId === userId);
  // Only the ones that did NOT move money. A succeeded refund already shows up
  // in the events list below as Stripe's own `refunded` row; printing it twice
  // would read as two refunds.
  const failedAttempts = myRefunds.filter(r => r.status !== 'succeeded');

  return (
    <>
      <div className="card enter">
        <div className="card-head">
          <h2>Money</h2>
          {canSetPrice && me && (
            <button
              className="btn btn-sm"
              onClick={() => {
                setSaveError(null);
                setPricing(true);
              }}
            >
              Set price
            </button>
          )}
        </div>
        <div className="card-body">
          {/* Money moved and cannot be taken back. Saying so is not a nicety:
              the ledger row below is written by Stripe's webhook a second or
              two later, and for that gap a dialog that simply closed was
              indistinguishable from a button that did nothing. */}
          {justRefunded && (
            <div
              className="enter"
              role="status"
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'flex-start',
                background: 'var(--ok-bg)',
                border: '1px solid var(--ok)',
                color: 'var(--ok)',
                borderRadius: 'var(--r-sm)',
                padding: '9px 11px',
                marginBottom: 12,
                fontSize: 13,
              }}
            >
              <span aria-hidden>✓</span>
              <span>
                Refunded {formatUsd(justRefunded.amountUsd)} to {name}.
                {refundLanding && ' Stripe is confirming it — the record appears below in a moment.'}
              </span>
            </div>
          )}

          {isPending && <span className="muted small">Loading…</span>}
          {!isPending && !me && <p className="muted small">Not on this trip.</p>}
          {me && (
            <div className="stack" style={{ gap: 8 }}>
              <p className="small">
                <span className="muted">Total: </span>
                {me.totalUsd === null ? 'No price set' : formatUsd(me.totalUsd)}
                <span className="muted"> · Paid: </span>
                {formatUsd(me.paidUsd)}
              </p>

              {me.steps.map(s => (
                <p key={s.requirementId} className="small">
                  <span className="muted">{s.title}: </span>
                  {STEP_STATE_LABEL[s.state]}
                  {s.state === 'unpaid' && s.dueUsd !== null && (
                    <span className="muted">
                      {' '}
                      — {s.paidUsd > 0
                        ? `${formatUsd(s.paidUsd)} of ${formatUsd(s.dueUsd)}`
                        : `${formatUsd(s.dueUsd)} owed`}
                    </span>
                  )}
                </p>
              ))}

              {isOffline && (
                <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  Paid outside Swellyo. Swellyo does not know what has arrived.
                </p>
              )}

              {me.events.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  {me.events.map((e, i) => (
                    <div
                      key={`${e.id}-${i}`}
                      className="row"
                      style={{ gap: 8, minHeight: 24 }}
                    >
                      {/* A refund is money going the other way, and it used to
                          render in the same muted grey as a payment — the one
                          line in the list that reverses the others was the
                          hardest to spot. It is marked structurally rather than
                          with a state colour: green would read "good" and red
                          "failed", and a completed refund is neither. The
                          orange lines below are refunds that did NOT happen,
                          so a warning colour here would collide with them. */}
                      {e.eventType === 'refunded' || e.eventType === 'dispute_lost' ? (
                        /* A chargeback reverses the list the same way a refund
                           does, so it gets the same structural chip — only the
                           word changes, because the operator did not choose it. */
                        <span
                          className="row"
                          style={{ gap: 6, fontSize: 12, color: 'var(--text)' }}
                        >
                          <span
                            style={{
                              background: 'var(--panel-2)',
                              border: '1px solid var(--line)',
                              borderRadius: 99,
                              padding: '1px 7px',
                              fontSize: 11,
                              color: 'var(--text-2)',
                            }}
                          >
                            {e.eventType === 'refunded' ? 'Refund' : 'Chargeback'}
                          </span>
                          <strong>{formatUsd(e.amountUsd)}</strong>
                          <span className="muted">{formatDateTime(e.createdAt)}</span>
                        </span>
                      ) : e.eventType === 'disputed' ? (
                        /* A marker, pinned to $0 by the DB — no amount shown,
                           because no money has finally moved yet. */
                        <span className="muted" style={{ fontSize: 12 }}>
                          {formatDateTime(e.createdAt)} · Dispute opened
                        </span>
                      ) : (
                        <span className="muted" style={{ fontSize: 12 }}>
                          {formatDateTime(e.createdAt)} · Payment {formatUsd(e.amountUsd)}
                        </span>
                      )}
                      {canRefund && e.eventType === 'paid' && (
                        <button
                          className="btn btn-sm btn-ghost"
                          style={{ padding: '2px 8px', fontSize: 12 }}
                          onClick={() => setRefunding({ id: e.id, amountUsd: e.amountUsd })}
                        >
                          Refund
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Attempts that did not move money. An operator who was blocked
                  and sees nothing will assume the refund went through. */}
              {failedAttempts.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  {failedAttempts.map(r => (
                    <p key={r.id} style={{ fontSize: 12, color: 'var(--warn)' }}>
                      {formatDate(r.createdAt)} · Refund of {formatUsd(r.amountUsd)}{' '}
                      {r.status === 'blocked_insufficient_balance'
                        ? 'was not sent — your balance did not cover it'
                        : r.status === 'pending'
                          ? 'is still in progress — check Stripe'
                          : 'failed'}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {pricing && me && (
        <TravelerPriceDialog
          travelerName={name}
          currentTotalUsd={me.totalUsd}
          currentDepositUsd={me.steps.find(s => s.kind === 'deposit')?.dueUsd ?? null}
          hasDepositStep={hasDepositStep}
          paidUsd={me.paidUsd}
          busy={save.isPending}
          error={saveError}
          onCancel={() => {
            setPricing(false);
            setSaveError(null);
          }}
          onSave={(totalUsd, depositUsd) => save.mutate({ totalUsd, depositUsd })}
        />
      )}

      {refunding && (
        <RefundDialog
          travelerName={name}
          paymentEventId={refunding.id}
          paidUsd={refunding.amountUsd}
          policyLines={policyLines}
          onCancel={() => setRefunding(null)}
          onDone={amountUsd => {
            setRefunding(null);
            setJustRefunded({
              amountUsd,
              seenRefunds: (me?.events ?? []).filter(e => e.eventType === 'refunded').length,
            });
            // Both, and in this order of importance: `refunds` shows the
            // attempt immediately, while `payEvents` only changes once Stripe's
            // webhook lands — so the refetch may legitimately return nothing new
            // for a second or two.
            void qc.invalidateQueries({ queryKey: ['refunds', tripId] });
            void qc.invalidateQueries({ queryKey: ['payEvents', tripId] });
          }}
        />
      )}
    </>
  );
}

/**
 * Medical answers.
 *
 * Export is here because Ohad decided on 2 August that medical gets export
 * like every other tile — an operator has to hand a diet and allergy list to a
 * cook or a hotel. That overrides SPEC.md §7, which said view-only.
 *
 * The operator has SELECT on this table and nothing else. There is no edit.
 */
function MedicalCard({
  name,
  form,
  loading,
}: {
  name: string;
  form: {
    allergies: string | null;
    allergiesNone: boolean;
    dietary: string | null;
    dietaryNone: boolean;
    injuries: string | null;
    injuriesNone: boolean;
    medications: string | null;
    medicationsNone: boolean;
    completedAt: string | null;
  } | null;
  loading: boolean;
}) {
  function exportText() {
    if (!form) return;
    const lines = [
      `Medical notes — ${name}`,
      `Completed: ${formatDate(form.completedAt)}`,
      '',
      `Allergies: ${answer(form.allergies, form.allergiesNone)}`,
      `Dietary: ${answer(form.dietary, form.dietaryNone)}`,
      `Injuries: ${answer(form.injuries, form.injuriesNone)}`,
      `Medications: ${answer(form.medications, form.medicationsNone)}`,
    ].join('\n');

    const blob = new Blob([lines], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeFileName(`${name} - medical`)}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  return (
    <div className="card enter">
      <div className="card-head">
        <h2>Medical</h2>
        {form?.completedAt && (
          <button className="btn btn-sm" onClick={exportText}>
            Export
          </button>
        )}
      </div>
      <div className="card-body">
        {loading && <span className="muted small">Loading…</span>}
        {!loading && !form?.completedAt && (
          <p className="muted small">Not filled in yet.</p>
        )}
        {form?.completedAt && (
          <div className="stack" style={{ gap: 8 }}>
            <Line label="Allergies" value={answer(form.allergies, form.allergiesNone)} />
            <Line label="Dietary" value={answer(form.dietary, form.dietaryNone)} />
            <Line label="Injuries" value={answer(form.injuries, form.injuriesNone)} />
            <Line label="Medications" value={answer(form.medications, form.medicationsNone)} />
            <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              Collected to run this trip. Never used for matching or anything else.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <p className="small">
      <span className="muted">{label}: </span>
      {value}
    </p>
  );
}

function answer(text: string | null, none: boolean): string {
  if (none) return 'None';
  return text?.trim() ? text : 'Not answered';
}

/**
 * Take this person off the trip.
 *
 * Hidden without `travelers.remove` — the same capability the participant
 * DELETE policy checks, so the button and the database can never disagree.
 * Everything about the money is decided inside the dialog, which is also where
 * a Manager who cannot refund is told why they may not do this.
 */
function RemoveCard({
  tripId,
  userId,
  name,
}: {
  tripId: string;
  userId: string;
  name: string;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const access = useTripAccess(tripId);
  const { user } = useAuth();
  const { money, trip, isOffline, isPending, isError } = useTripMoney(tripId);
  const [open, setOpen] = useState(false);

  // `ready`, not `can` alone: an unresolved query says no to everything, and a
  // destructive button that appears a beat late is better than one that
  // appears and vanishes.
  if (!access.ready || !access.can('travelers.remove')) return null;

  const me = money?.travelers.find(t => t.userId === userId) ?? null;
  // Net of refunds already issued — the figure the dialog offers to send back.
  const paidUsd = Math.max(0, me?.paidUsd ?? 0);

  /**
   * A failed ledger read must NEVER open this dialog.
   *
   * `money` is null on failure, which reads as "paid nothing" — and the dialog
   * would then remove someone who had paid $2,000 with no refund step and no
   * mention of money in their notification. Refusing until the read works is
   * the only safe direction to be wrong in.
   */
  const moneyUnknown = isError || (!isPending && !money);

  // Same test as the price and refund buttons: `money.manage` is the operator
  // of record, and `trip-cancel` re-checks it. This only decides which face of
  // the dialog opens.
  const canRefund = !!user && !!trip && trip.hostId === user.id;

  const policy = policyFromTrip(
    trip
      ? {
          cancellation_preset: trip.cancellationPreset,
          cancellation_rules: trip.cancellationRules,
          cancellation_notes: trip.cancellationNotes,
        }
      : null,
  );

  return (
    <>
      <div className="card enter" style={{ borderColor: 'var(--line)' }}>
        <div className="card-body row-between" style={{ gap: 12 }}>
          <div>
            <div className="small">
              <strong>Remove {name} from this trip</strong>
            </div>
            <div className="muted small" style={{ marginTop: 2 }}>
              {moneyUnknown
                ? "We can't read what they have paid right now. Reload before removing them."
                : isOffline
                  ? 'They lose the plan and the group chat. Anything they paid you outside Swellyo is between you and them.'
                  : 'They lose the plan and the group chat. Anything they paid is decided first.'}
            </div>
          </div>
          <button
            className="btn btn-sm btn-danger"
            onClick={() => setOpen(true)}
            disabled={isPending || moneyUnknown}
          >
            Remove
          </button>
        </div>
      </div>

      {open && (
        <RemoveTravelerDialog
          tripId={tripId}
          userId={userId}
          travelerName={name}
          paidUsd={paidUsd}
          isOffline={isOffline}
          policy={policy}
          tripStartDate={trip?.startDate ?? null}
          canRefund={canRefund}
          onCancel={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            // Everything the roster feeds: the member list, both document
            // queries, and the ledger the money cards read.
            void qc.invalidateQueries({ queryKey: ['members', tripId] });
            void qc.invalidateQueries({ queryKey: ['review', tripId] });
            void qc.invalidateQueries({ queryKey: ['counts', tripId] });
            void qc.invalidateQueries({ queryKey: ['payEvents', tripId] });
            void qc.invalidateQueries({ queryKey: ['refunds', tripId] });
            // This page is about someone who is no longer on the trip.
            navigate(`/trips/${tripId}`);
          }}
        />
      )}
    </>
  );
}
