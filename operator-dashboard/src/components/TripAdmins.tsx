import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { demoteTripHost, promoteTripHost, useTripHosts } from '../services/tripActions';
import { fetchProfiles } from '../services/travelers';
import { friendlyError } from '../lib/errors';
import { Avatar } from './StateBits';
import { ConfirmDialog } from './ConfirmDialog';

/**
 * Co-hosts — the app's "Set as admin" / "Remove as admin"
 * (TripMembersScreen → TripMemberSheet), same RPCs, same gate:
 *
 *   viewer is a host (host_id or role 'host') · never on yourself ·
 *   Set only on a member · Remove only on a host who is NOT the operator of record
 *
 * Being an admin is `participants.role = 'host'`, which is NOT a crew tier and
 * grants no capability row: money, cancelling and crew stay on `host_id` and
 * `my_trip_capabilities`. That is why this lives apart from the Crew page.
 */

function refresh(qc: ReturnType<typeof useQueryClient>, tripId: string) {
  void qc.invalidateQueries({ queryKey: ['hosts', tripId] });
  // A promoted traveler leaves `fetchMembers` (role = 'member' only).
  void qc.invalidateQueries({ queryKey: ['members', tripId] });
  void qc.invalidateQueries({ queryKey: ['capabilities', tripId] });
}

/**
 * Who else hosts this trip. Silent while the operator is the only one — a
 * card listing one person, who is the reader, says nothing.
 */
export function AdminsCard({ tripId, ownerId }: { tripId: string; ownerId: string | null }) {
  const qc = useQueryClient();
  const { ids, me, viewerIsHost, hosts } = useTripHosts(tripId, ownerId);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);

  const profiles = useQuery({
    queryKey: ['profiles', ids],
    queryFn: () => fetchProfiles(ids),
    enabled: ids.length > 1,
  });

  const demote = useMutation({
    mutationFn: (userId: string) => demoteTripHost(tripId, userId),
    onSuccess: () => {
      setRemoving(null);
      refresh(qc, tripId);
    },
  });

  if (hosts.isError || ids.length <= 1) return null;

  return (
    <div className="card enter">
      <div className="card-head">
        <h2>Admins</h2>
      </div>
      <div className="card-body stack" style={{ gap: 12 }}>
        {ids.map(id => {
          const p = profiles.data?.get(id);
          const name = p?.name ?? 'Someone';
          const isOwnerRow = id === ownerId;
          const canRemove = viewerIsHost && id !== me && !isOwnerRow;
          return (
            <div key={id} className="row-between" style={{ gap: 12 }}>
              <div className="row" style={{ gap: 12, minWidth: 0 }}>
                <Avatar url={p?.photoUrl ?? null} name={name} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {name}
                    {id === me && <span className="muted small"> · you</span>}
                  </div>
                  <span className={`tag ${isOwnerRow ? 'tag-brand' : 'tag-idle'}`}>
                    {isOwnerRow ? 'Operator' : 'Admin'}
                  </span>
                </div>
              </div>
              {canRemove && (
                <button
                  className="btn btn-sm"
                  style={{ flexShrink: 0 }}
                  onClick={() => {
                    demote.reset();
                    setRemoving({ id, name });
                  }}
                >
                  Remove as admin
                </button>
              )}
            </div>
          );
        })}
        <p className="muted small">
          Admins can edit this trip, approve requests and remove members. Money, crew and
          cancelling stay with the operator.
        </p>
      </div>

      {removing && (
        <ConfirmDialog
          title={`Remove ${removing.name} as admin?`}
          confirmLabel="Remove as admin"
          busyLabel="Removing…"
          danger
          busy={demote.isPending}
          error={demote.isError ? friendlyError(demote.error) : null}
          onConfirm={() => demote.mutate(removing.id)}
          onCancel={() => setRemoving(null)}
        >
          <p>They stay on the trip as a member and lose admin controls.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

/**
 * "Set as admin" on one traveler's page. Same gate as the app's sheet: the
 * viewer is a host, and it is not their own page.
 */
export function MakeAdminCard({
  tripId,
  ownerId,
  userId,
  name,
}: {
  tripId: string;
  ownerId: string | null;
  userId: string;
  name: string;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { me, viewerIsHost, ready } = useTripHosts(tripId, ownerId);
  const [asking, setAsking] = useState(false);

  const promote = useMutation({
    mutationFn: () => promoteTripHost(tripId, userId),
    onSuccess: () => {
      setAsking(false);
      refresh(qc, tripId);
      // They are not a traveler on this site any more, so this page would
      // turn into "Not found". Go where they now are.
      navigate(`/trips/${tripId}`);
    },
  });

  if (!ready || !viewerIsHost || userId === me) return null;

  return (
    <div className="card enter">
      <div className="card-body row-between" style={{ gap: 12, flexWrap: 'wrap' }}>
        <span className="muted small" style={{ flex: '1 1 240px' }}>
          Make {name} an admin of this trip.
        </span>
        <button
          className="btn btn-sm"
          style={{ flexShrink: 0 }}
          onClick={() => {
            promote.reset();
            setAsking(true);
          }}
        >
          Set as admin
        </button>
      </div>

      {asking && (
        <ConfirmDialog
          title={`Set ${name} as admin?`}
          confirmLabel="Set as admin"
          busyLabel="Saving…"
          busy={promote.isPending}
          error={promote.isError ? friendlyError(promote.error) : null}
          onConfirm={() => promote.mutate()}
          onCancel={() => setAsking(false)}
        >
          {/* The app's sentence, then what changes on THIS site. */}
          <p>Admins can edit this trip, approve requests, remove members, and delete the trip.</p>
          <p style={{ marginTop: 8 }}>
            On this site they move from Travelers to Admins, so their documents and payments no
            longer show in the traveler lists.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
