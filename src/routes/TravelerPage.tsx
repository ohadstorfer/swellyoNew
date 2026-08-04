import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { fetchMembers, fetchTrip } from '../services/trips';
import { fetchTripReview, type ReviewItem } from '../services/review';
import { fetchMedicalForm, fetchProfiles } from '../services/travelers';
import { isUploadRequirement } from '../domain/requirements';
import { approveDocuments, rejectDocument, setTravelerPrice } from '../services/actions';
import { downloadAll, downloadOne, safeFileName } from '../services/files';
import { useTripMoney } from '../services/useTripMoney';
import { STEP_STATE_LABEL } from '../domain/money';
import { useAuth } from '../lib/auth';
import { fileNameFor, formatDate, formatUsd, plural } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { ErrorBox, Loading, StateTag } from '../components/StateBits';
import { PageHead } from '../components/Shell';
import { DocumentViewer } from '../components/DocumentViewer';
import { RejectDialog } from '../components/RejectDialog';
import { TravelerPriceDialog } from '../components/TravelerPriceDialog';

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
                    <p key={`${e.createdAt}-${i}`} className="muted" style={{ fontSize: 12 }}>
                      {formatDate(e.createdAt)} ·{' '}
                      {e.eventType === 'refunded' ? 'Refund' : 'Payment'} {formatUsd(e.amountUsd)}
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
