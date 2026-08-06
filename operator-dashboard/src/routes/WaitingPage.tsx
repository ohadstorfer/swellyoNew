import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { fetchMembers, fetchTrip } from '../services/trips';
import { fetchTripReview, type ReviewItem } from '../services/review';
import { fetchProfiles } from '../services/travelers';
import { approveDocuments, rejectDocument } from '../services/actions';
import { formatDate, plural } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { Empty, ErrorBox, Loading, StateTag } from '../components/StateBits';
import { PageHead } from '../components/Shell';
import { DocumentViewer } from '../components/DocumentViewer';
import { RejectDialog } from '../components/RejectDialog';

type Row = { userId: string; name: string; item: ReviewItem };

/**
 * Everything waiting on the operator, across every document type.
 *
 * Where "N documents waiting for you" goes. It used to land on the first
 * REQUIREMENT that had work — which meant a banner counting three documents
 * opened a page showing one of them, next to travelers who had sent nothing and
 * were not the point (Ohad, 5 Aug).
 *
 * The rule here is the whole design: a row is on this page if and only if the
 * operator has to do something about it. Approve it or send it back and it
 * leaves, and when the last one goes the page says so. That is what makes the
 * banner's number trustworthy — it is this list's length.
 *
 * Same columns as RequirementPage, plus Document. State is constant down the
 * page ("Waiting for you" is the entry condition) and stays anyway: the tag is
 * how every other table on this dashboard says what a row is, and dropping it
 * here would make this table the odd one out for no gain.
 */
export function WaitingPage() {
  const { tripId = '' } = useParams();
  const qc = useQueryClient();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewing, setViewing] = useState<Row | null>(null);
  const [rejecting, setRejecting] = useState<Row | null>(null);
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
    return <Loading what="Loading what needs you" />;

  // `submitted` AND a document id: the two together are what "the operator can
  // act on this" means. A waiver agreed to has neither, and a rejected item is
  // back with the traveler.
  const rows: Row[] = review.data.travelers
    .flatMap(t =>
      t.items
        .filter(i => i.state === 'submitted' && i.documentId)
        .map(item => ({
          userId: t.userId,
          name: profiles.data?.get(t.userId)?.name ?? 'Traveler',
          item,
        })),
    )
    // Oldest first. A review queue is about who has been kept waiting, and the
    // traveler who sent their passport a week ago should not sit under one who
    // sent theirs this morning.
    .sort((a, b) => (a.item.submittedAt ?? '').localeCompare(b.item.submittedAt ?? ''));

  return (
    <>
      <PageHead
        back={`/trips/${tripId}`}
        backLabel={trip.data.title}
        title="Waiting for you"
        sub={
          rows.length === 0
            ? 'Nothing to review'
            : `${plural(rows.length, 'document')} across ${plural(
                new Set(rows.map(r => r.userId)).size,
                'traveler',
              )}`
        }
      />

      {actionError && (
        <div className="card enter" style={{ borderColor: 'var(--danger)', marginBottom: 14 }}>
          <div className="card-body small" style={{ color: 'var(--danger)' }}>
            {actionError}
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <Empty
          title="Nothing waiting for you"
          note={
            <>
              Every document travelers have sent has been dealt with.{' '}
              <Link to={`/trips/${tripId}`}>Back to the trip</Link>
            </>
          }
        />
      ) : (
        <>
          <div className="banner enter" style={{ marginBottom: 14 }}>
            <span>
              {selected.size > 0
                ? `${plural(selected.size, 'document')} selected`
                : `${plural(rows.length, 'document')} waiting for you`}
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
                    selected.size > 0 ? [...selected] : rows.map(r => r.item.documentId!),
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

          <div className="card enter">
            <div className="tscroll">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 36 }} />
                    <th>Traveler</th>
                    <th>State</th>
                    <th>Document</th>
                    <th>When</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => {
                    // Same rule as RequirementPage: the whole row opens it, the
                    // button is the affordance and the tab stop.
                    const viewable = !!row.item.storagePath && !row.item.fileDeleted;
                    return (
                      <tr
                        // One traveler can be waiting on several documents, so
                        // the key is the document, not the person.
                        key={row.item.documentId}
                        className={viewable ? 'tr-open' : undefined}
                        onClick={viewable ? () => setViewing(row) : undefined}
                      >
                        <td onClick={e => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label={`Select ${row.name} — ${row.item.title}`}
                            checked={selected.has(row.item.documentId!)}
                            onChange={e => {
                              const next = new Set(selected);
                              e.target.checked
                                ? next.add(row.item.documentId!)
                                : next.delete(row.item.documentId!);
                              setSelected(next);
                            }}
                          />
                        </td>
                        <td>
                          <Link
                            to={`/trips/${tripId}/t/${row.userId}`}
                            onClick={e => e.stopPropagation()}
                          >
                            {row.name}
                          </Link>
                        </td>
                        <td>
                          <StateTag state={row.item.state} />
                        </td>
                        <td>
                          {/* Links to that document across every traveler —
                              the other axis, one click away. */}
                          <Link
                            to={`/trips/${tripId}/d/${row.item.requirementId}`}
                            className="muted"
                            onClick={e => e.stopPropagation()}
                          >
                            {row.item.title}
                          </Link>
                        </td>
                        <td className="muted small">
                          {row.item.submittedAt ? formatDate(row.item.submittedAt) : '—'}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {viewable ? (
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
        </>
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
          requirementTitle={rejecting.item.title}
          busy={reject.isPending}
          onCancel={() => setRejecting(null)}
          onConfirm={note => reject.mutate({ row: rejecting, note })}
        />
      )}
    </>
  );
}
