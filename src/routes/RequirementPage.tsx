import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { fetchMembers, fetchTrip } from '../services/trips';
import { fetchTripReview, type ReviewItem } from '../services/review';
import { fetchProfiles } from '../services/travelers';
import { approveDocuments, rejectDocument } from '../services/actions';
import { downloadAll, safeFileName } from '../services/files';
import { fileNameFor, formatDate, plural } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { ErrorBox, Loading, StateTag } from '../components/StateBits';
import { PageHead } from '../components/Shell';
import { DocumentViewer } from '../components/DocumentViewer';
import { RejectDialog } from '../components/RejectDialog';

type Row = { userId: string; name: string; item: ReviewItem };

export function RequirementPage() {
  const { tripId = '', requirementId = '' } = useParams();
  const qc = useQueryClient();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewing, setViewing] = useState<Row | null>(null);
  const [rejecting, setRejecting] = useState<Row | null>(null);
  const [exportState, setExportState] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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

  const refreshAll = () => {
    void qc.invalidateQueries({ queryKey: ['review', tripId] });
    void qc.invalidateQueries({ queryKey: ['counts', tripId] });
  };

  const approve = useMutation({
    mutationFn: (ids: string[]) => approveDocuments(ids),
    onSuccess: () => {
      setSelected(new Set());
      setViewing(null);
      setActionError(null);
      refreshAll();
    },
    onError: e => setActionError(friendlyError(e)),
  });

  const reject = useMutation({
    mutationFn: ({ row, note }: { row: Row; note?: string }) =>
      rejectDocument({ id: row.item.documentId!, storagePath: row.item.storagePath }, note),
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
    return <Loading what="Loading documents" />;

  const requirement = review.data.requirements.find(r => r.id === requirementId);
  if (!requirement) {
    return (
      <>
        <PageHead back={`/trips/${tripId}`} backLabel={trip.data.title} title="Not found" />
        <p className="muted">That requirement is no longer on this trip.</p>
      </>
    );
  }

  const rows: Row[] = review.data.travelers.map(t => ({
    userId: t.userId,
    name: profiles.data?.get(t.userId)?.name ?? 'Traveler',
    item: t.items.find(i => i.requirementId === requirementId)!,
  }));

  const isUpload = requirement.reqType === 'upload';
  const pending = rows.filter(r => r.item.state === 'submitted' && r.item.documentId);
  const exportable = rows.filter(r => r.item.storagePath && !r.item.fileDeleted);
  const received = rows.filter(r => r.item.state !== 'not_started' && r.item.state !== 'overdue');
  const approved = rows.filter(r => r.item.state === 'approved');

  async function exportAll() {
    setExportState('Preparing…');
    const result = await downloadAll(
      exportable.map(r => ({
        storagePath: r.item.storagePath,
        fileName: fileNameFor(r.item.storagePath, safeFileName(`${r.name} - ${requirement!.title}`)),
        fileDeleted: r.item.fileDeleted,
      })),
      safeFileName(`${trip.data!.title} - ${requirement!.title}`),
      (done, total) => setExportState(`Downloading ${done} of ${total}…`),
    );
    setExportState(
      result.failed > 0
        ? `Saved ${result.saved}. ${result.failed} could not be downloaded.`
        : `Saved ${plural(result.saved, 'file')}.`,
    );
    setTimeout(() => setExportState(null), 6000);
  }

  return (
    <>
      <PageHead
        back={`/trips/${tripId}`}
        backLabel={trip.data.title}
        title={requirement.title}
        sub={`${received.length}/${rows.length} in · ${approved.length}/${rows.length} approved`}
        right={
          isUpload && exportable.length > 0 ? (
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

      {isUpload && pending.length > 0 && (
        <div className="banner enter" style={{ marginBottom: 14 }}>
          <span>
            {selected.size > 0
              ? `${plural(selected.size, 'document')} selected`
              : `${plural(pending.length, 'document')} waiting for you`}
          </span>
          <div className="row" style={{ gap: 8 }}>
            {selected.size > 0 && (
              <button className="btn btn-sm" onClick={() => setSelected(new Set())}>
                Clear
              </button>
            )}
            <button
              className="btn btn-sm btn-primary"
              disabled={approve.isPending}
              onClick={() =>
                approve.mutate(
                  selected.size > 0
                    ? [...selected]
                    : pending.map(r => r.item.documentId!),
                )
              }
            >
              {approve.isPending
                ? 'Approving…'
                : selected.size > 0
                  ? 'Approve selected'
                  : 'Approve all'}
            </button>
          </div>
        </div>
      )}

      <div className="card enter">
        <div className="tscroll">
          <table>
            <thead>
              <tr>
                {isUpload && <th style={{ width: 36 }} />}
                <th>Traveler</th>
                <th>State</th>
                <th>When</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const canSelect = row.item.state === 'submitted' && !!row.item.documentId;
                return (
                  <tr key={row.userId}>
                    {isUpload && (
                      <td>
                        {canSelect && (
                          <input
                            type="checkbox"
                            aria-label={`Select ${row.name}`}
                            checked={selected.has(row.item.documentId!)}
                            onChange={e => {
                              const next = new Set(selected);
                              e.target.checked
                                ? next.add(row.item.documentId!)
                                : next.delete(row.item.documentId!);
                              setSelected(next);
                            }}
                          />
                        )}
                      </td>
                    )}
                    <td>
                      <Link to={`/trips/${tripId}/t/${row.userId}`}>{row.name}</Link>
                      {row.item.fileDeleted && (
                        <div className="muted" style={{ fontSize: 12 }}>
                          File deleted after 30 days
                        </div>
                      )}
                      {row.item.note && (
                        <div className="muted" style={{ fontSize: 12 }}>
                          Note: {row.item.note}
                        </div>
                      )}
                    </td>
                    <td>
                      <StateTag state={row.item.state} />
                    </td>
                    <td className="muted small">
                      {row.item.submittedAt ? formatDate(row.item.submittedAt) : '—'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {row.item.storagePath && !row.item.fileDeleted ? (
                        <button className="btn btn-sm" onClick={() => setViewing(row)}>
                          View
                        </button>
                      ) : (
                        <span className="muted small">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {!isUpload && (
        <p className="muted small" style={{ marginTop: 12 }}>
          This is not an upload, so there are no files to review or export.
        </p>
      )}

      {viewing && (
        <DocumentViewer
          item={viewing.item}
          travelerName={viewing.name}
          busy={approve.isPending}
          onClose={() => setViewing(null)}
          onApprove={() => approve.mutate([viewing.item.documentId!])}
          onReject={() => setRejecting(viewing)}
        />
      )}

      {rejecting && (
        <RejectDialog
          travelerName={rejecting.name}
          requirementTitle={requirement.title}
          busy={reject.isPending}
          onCancel={() => setRejecting(null)}
          onConfirm={note => reject.mutate({ row: rejecting, note })}
        />
      )}
    </>
  );
}
