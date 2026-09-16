import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJoinRequests, decideJoinRequest } from '../services/joinRequests';
import { fetchProfiles } from '../services/travelers';
import { friendlyError } from '../lib/errors';
import { Avatar } from './StateBits';
import { plural } from '../lib/format';

/**
 * "Three people want to come." The card that lets a desktop operator say yes.
 *
 * Product Specs §"Trip dashboard space" item 2, for the manager and the
 * operator alike. Without it, an operator working at a computer could do
 * everything on this site except the one thing that starts a trip.
 *
 * ── What approval means on an operator trip ────────────────────────────────
 * Not a seat. It opens the traveler's onboarding — payment, waiver, medical,
 * documents — and only finishing that puts them on the trip. So the copy says
 * "let them start joining", not "add them": an operator who reads this as
 * "they're in" will wonder why the count did not move.
 *
 * ── Silent when there is nothing waiting ───────────────────────────────────
 * A permanent "No requests" card is a permanent piece of furniture that says
 * nothing. This page already has a lot on it.
 */
export function JoinRequestsCard({ tripId }: { tripId: string }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const requests = useQuery({
    queryKey: ['joinRequests', tripId],
    queryFn: () => fetchJoinRequests(tripId),
  });

  const ids = (requests.data ?? []).map(r => r.requesterId);
  const profiles = useQuery({
    queryKey: ['profiles', ids],
    queryFn: () => fetchProfiles(ids),
    enabled: ids.length > 0,
  });

  const decide = useMutation({
    mutationFn: (args: { id: string; decision: 'approved' | 'declined' }) =>
      decideJoinRequest(args.id, args.decision),
    onMutate: args => {
      setPendingId(args.id);
      setError(null);
    },
    onSuccess: () => {
      // The roster, the counts and the review queue all move when somebody is
      // let in — the trigger writes the participant row, so this page has to
      // re-read rather than patch its own cache.
      void qc.invalidateQueries({ queryKey: ['joinRequests', tripId] });
      void qc.invalidateQueries({ queryKey: ['members', tripId] });
      void qc.invalidateQueries({ queryKey: ['review', tripId] });
      void qc.invalidateQueries({ queryKey: ['trip', tripId] });
    },
    onError: e => setError(friendlyError(e)),
    onSettled: () => setPendingId(null),
  });

  const rows = requests.data ?? [];
  if (requests.isPending || rows.length === 0) return null;

  return (
    <div className="card enter">
      <div className="card-head">
        <h2>Wants to come</h2>
        <span className="muted small">{plural(rows.length, 'request')}</span>
      </div>
      <div className="card-body stack">
        {error && (
          <div className="banner" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
            {error}
          </div>
        )}

        {rows.map(r => {
          const p = profiles.data?.get(r.requesterId);
          const busy = pendingId === r.id;
          return (
            <div key={r.id} className="row-between" style={{ gap: 12, alignItems: 'flex-start' }}>
              <div className="row" style={{ gap: 12, alignItems: 'flex-start', minWidth: 0 }}>
                <Avatar url={p?.photoUrl ?? null} name={p?.name ?? 'Traveler'} />
                <div style={{ minWidth: 0 }}>
                  <strong>{p?.name ?? 'Traveler'}</strong>
                  <div className="muted small">
                    {[
                      p?.age ? `${p.age}` : null,
                      p?.countryFrom,
                      p?.surfLevel?.replace(/_/g, ' '),
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'No profile details'}
                  </div>
                  {/* Their own words. It is the only thing on this card the
                      operator cannot get anywhere else, so it is not truncated. */}
                  {r.note && (
                    <p className="small" style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>
                      {r.note}
                    </p>
                  )}
                </div>
              </div>

              <div className="row" style={{ gap: 8, flexShrink: 0 }}>
                <button
                  className="btn btn-sm"
                  disabled={busy}
                  onClick={() => decide.mutate({ id: r.id, decision: 'declined' })}
                >
                  Decline
                </button>
                <button
                  className="btn btn-sm btn-primary"
                  disabled={busy}
                  onClick={() => decide.mutate({ id: r.id, decision: 'approved' })}
                >
                  {busy ? 'Saving…' : 'Let them join'}
                </button>
              </div>
            </div>
          );
        })}

        <p className="muted small">
          Approving opens their onboarding — payment, waiver and documents. They are on the trip
          once they finish it, not before.
        </p>
      </div>
    </div>
  );
}
