import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchAdminUpdates,
  postAdminUpdate,
  deleteAdminUpdate,
  type AdminUpdate,
} from '../services/updates';
import { formatDate } from '../lib/format';
import { friendlyError } from '../lib/errors';

/**
 * Admin updates — one message to everyone on the trip.
 *
 * Product Specs lists "admin updates — view + send" for crew, managers and
 * operators. This is also, for now, the desktop's answer to "chat" — see
 * decision D5 and the header of `services/updates.ts`.
 *
 * ── Posting sends a push. Say so before they press it ──────────────────────
 * Every traveler gets a notification. That is the point of the feature and it
 * is also why the button is not a quiet one: the same rule the app applies to
 * "Remind N people", which was deliberately moved away from a list where the
 * only other gesture was "open".
 *
 * ── Read for everyone, post behind `updates.send` ──────────────────────────
 * A Guide can see what the trip has been told — they are on it — and cannot
 * add to it. `canPost` decides the composer; RLS decides the write.
 */
export function AdminUpdatesCard({
  tripId,
  canPost,
}: {
  tripId: string;
  canPost: boolean;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);

  const updates = useQuery({
    queryKey: ['adminUpdates', tripId],
    queryFn: () => fetchAdminUpdates(tripId),
  });

  const post = useMutation({
    mutationFn: () => postAdminUpdate({ tripId, title, body }),
    onSuccess: () => {
      setTitle('');
      setBody('');
      setOpen(false);
      setError(null);
      void qc.invalidateQueries({ queryKey: ['adminUpdates', tripId] });
    },
    onError: e => setError(friendlyError(e)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteAdminUpdate(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['adminUpdates', tripId] }),
    onError: e => setError(friendlyError(e)),
  });

  const rows = updates.data ?? [];

  return (
    <div className="card enter">
      <div className="card-head">
        <h2>Updates</h2>
        {canPost && !open && (
          <button className="btn btn-sm" onClick={() => setOpen(true)}>
            Write one
          </button>
        )}
      </div>
      <div className="card-body stack">
        {error && (
          <div className="banner" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
            {error}
          </div>
        )}

        {open && (
          <div className="stack" style={{ gap: 8 }}>
            <input
              value={title}
              onChange={e => setTitle(e.target.value.slice(0, 120))}
              placeholder="The boat leaves at six"
              autoFocus
            />
            <textarea
              value={body}
              onChange={e => setBody(e.target.value.slice(0, 2000))}
              placeholder="Anything more they need to know. Optional."
              rows={4}
            />
            <div className="row-between">
              {/* Named before the button is pressed, not apologised for after. */}
              <span className="muted small">Everyone on the trip gets a notification.</span>
              <div className="row" style={{ gap: 8 }}>
                <button
                  className="btn btn-sm"
                  disabled={post.isPending}
                  onClick={() => {
                    setOpen(false);
                    setError(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-sm btn-primary"
                  disabled={!title.trim() || post.isPending}
                  onClick={() => post.mutate()}
                >
                  {post.isPending ? 'Sending…' : 'Send to everyone'}
                </button>
              </div>
            </div>
          </div>
        )}

        {updates.isPending ? (
          <p className="muted small">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="muted small">
            {canPost
              ? 'Nothing sent yet. An update goes to everyone on the trip at once.'
              : 'Nothing sent yet.'}
          </p>
        ) : (
          rows.map((u: AdminUpdate) => (
            <div key={u.id} style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
              <div className="row-between">
                <strong className="small">{u.title}</strong>
                <span className="muted small">{formatDate(u.createdAt)}</span>
              </div>
              {u.body && (
                <p className="small" style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>
                  {u.body}
                </p>
              )}
              {canPost && (
                <button
                  className="btn btn-sm btn-ghost"
                  style={{ marginTop: 8 }}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(u.id)}
                >
                  Delete
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
