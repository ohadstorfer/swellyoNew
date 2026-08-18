/**
 * The crew of one trip: who runs it, what each of them may see, and what you
 * have asked them for.
 *
 * Spec: docs/superpowers/specs/2026-08-14-crew-page.md
 *
 * ── Who gets in ────────────────────────────────────────────────────────────
 * The operator of record, and nobody else. `staff.manage` is held by the
 * operator alone — `my_trip_capabilities()` hands out the whole operator set to
 * `group_trips.host_id`, and no assignable tier carries the key — so asking
 * "can I?" is exactly "am I the operator", without this page ever branching on
 * a tier. A Manager reviewing documents never sees the link, and typing the URL
 * lands here on a sentence rather than on controls the database would refuse.
 *
 * ── Rule 1 ─────────────────────────────────────────────────────────────────
 * No new table, no new function, no migration. Every read and write was already
 * live and already permitted.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { fetchTrip } from '../services/trips';
import { fetchCrew, fetchStaffRoles, type CrewMember } from '../services/staff';
import { fetchStaffFulfilment, fetchStaffRequirements, isFulfilled } from '../services/staffRequirements';
import { useTripAccess } from '../services/access';
import { Avatar, ErrorBox, Loading } from '../components/StateBits';
import { PageHead } from '../components/Shell';
import { CrewMemberDialog } from '../components/CrewMemberDialog';
import { AddCrewDialog } from '../components/AddCrewDialog';
import { TIER_TAG } from '../components/CrewFields';
import { plural } from '../lib/format';

export function CrewPage() {
  const { tripId = '' } = useParams();
  const access = useTripAccess(tripId);

  const trip = useQuery({ queryKey: ['trip', tripId], queryFn: () => fetchTrip(tripId) });
  const crew = useQuery({ queryKey: ['crew', tripId], queryFn: () => fetchCrew(tripId) });
  // The five tier definitions change roughly never and are the same on every
  // trip, so this is read once per session.
  const roles = useQuery({
    queryKey: ['staffRoles'],
    queryFn: fetchStaffRoles,
    staleTime: Infinity,
  });

  // Both are also what the paperwork section inside the dialog reads, so opening
  // someone costs nothing.
  const reqs = useQuery({
    queryKey: ['staffRequirements', tripId],
    queryFn: () => fetchStaffRequirements(tripId),
  });
  const done = useQuery({
    queryKey: ['staffFulfilment', tripId],
    queryFn: () => fetchStaffFulfilment(tripId),
  });

  const [editing, setEditing] = useState<CrewMember | null>(null);
  const [adding, setAdding] = useState(false);

  if (trip.isError) return <ErrorBox error={trip.error} onRetry={() => void trip.refetch()} />;
  if (crew.isError) return <ErrorBox error={crew.error} onRetry={() => void crew.refetch()} />;
  // Without the tier definitions there is no picker and no pill, which is most
  // of the page. Better to say so than to render a crew list with blank tiers.
  if (roles.isError) return <ErrorBox error={roles.error} onRetry={() => void roles.refetch()} />;
  if (trip.isPending || crew.isPending || roles.isPending || access.isPending) {
    return <Loading what="Loading the crew" />;
  }

  // Reachable by typing the URL — the link on the trip page is already hidden.
  // Every write below is refused by RLS for anyone but the operator; this turns
  // that refusal into a sentence.
  if (access.ready && !access.can('staff.manage')) {
    return (
      <>
        <PageHead back={`/trips/${tripId}`} backLabel={trip.data.title} title="Crew" />
        <div className="card">
          <div className="card-body">
            <p>Only the operator can manage this trip's crew.</p>
            <p className="muted small" style={{ marginTop: 8 }}>
              That is the account Stripe pays. It is deliberate: if a Manager could edit the crew,
              a Manager could give themselves the operator's permissions.
            </p>
          </div>
        </div>
      </>
    );
  }

  // The Operator tier is never assignable — it is held by owning the trip, not
  // by a row. Offering it would create a second, contradictory source of truth.
  const assignable = (roles.data ?? []).filter(r => r.roleKey !== 'operator');
  const roleLabel = (key: string) =>
    roles.data?.find(r => r.roleKey === key)?.label ?? key;

  /** "1 of 3 sent", or null when this person has been asked for nothing. */
  const paperworkLine = (member: CrewMember): string | null => {
    if (!member.userId) return null;
    const asked = (reqs.data ?? []).filter(r => r.assignedStaffIds.includes(member.id));
    if (asked.length === 0) return null;
    const sent = asked.filter(r => isFulfilled(done.data ?? new Set(), member.userId, r)).length;
    return `${sent} of ${asked.length} sent`;
  };

  return (
    <>
      <PageHead
        back={`/trips/${tripId}`}
        backLabel={trip.data.title}
        title="Crew"
        sub={`${plural(crew.data.length, 'person', 'people')} helping you run this trip`}
        right={
          <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}>
            Add someone
          </button>
        }
      />

      <div className="card enter">
        {crew.data.length === 0 ? (
          <div className="card-body">
            <p className="muted small">
              Nobody on the crew yet. Add the people who help you run this trip — a guide, a
              photographer, a driver.
            </p>
          </div>
        ) : (
          crew.data.map(member => {
            const paperwork = paperworkLine(member);
            const detail =
              [
                member.pending ? 'Invite not accepted yet' : member.title,
                member.userId ? null : 'No Swellyo account',
                paperwork,
              ]
                .filter(Boolean)
                .join(' · ') || null;

            return (
              <button
                key={member.id}
                type="button"
                className="row-link"
                onClick={() => setEditing(member)}
              >
                <span className="row" style={{ gap: 11, minWidth: 0 }}>
                  <Avatar url={member.photoUrl} name={member.name} />
                  <span style={{ minWidth: 0, textAlign: 'left' }}>
                    <span style={{ display: 'block' }}>{member.name}</span>
                    {detail && (
                      <span className="muted small" style={{ display: 'block', marginTop: 2 }}>
                        {detail}
                      </span>
                    )}
                  </span>
                </span>
                <span className="row" style={{ gap: 10 }}>
                  <span className={`tag ${TIER_TAG[member.roleKey]}`}>
                    {roleLabel(member.roleKey)}
                  </span>
                  <span className="muted" aria-hidden>
                    ›
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>

      <p className="muted small" style={{ marginTop: 12 }}>
        Crew are not travelers: they take no place on the trip and pay nothing. Someone without a
        Swellyo account can still be credited on the trip page — add them from the app.
      </p>

      {editing && (
        <CrewMemberDialog
          tripId={tripId}
          member={editing}
          roles={assignable}
          onClose={() => setEditing(null)}
        />
      )}
      {adding && (
        <AddCrewDialog tripId={tripId} roles={assignable} onClose={() => setAdding(false)} />
      )}
    </>
  );
}
