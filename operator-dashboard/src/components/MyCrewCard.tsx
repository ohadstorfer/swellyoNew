import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchMyCrewRow, updateCrewMember } from '../services/staff';
import { ProfileFields } from './CrewFields';
import { friendlyError } from '../lib/errors';

/**
 * Your own line on this trip's crew.
 *
 * Product Specs §"Manage self": "edit your own description." Until
 * 20260904000300 nobody could — every write to `organized_trip_staff` needed
 * `staff.manage`, so a guide who wanted to fix a typo in their own bio had to
 * ask the operator to do it.
 *
 * ── Two fields, and the database is what limits it ─────────────────────────
 * Title and bio. Not the tier — `trg_guard_ots_self_edit` refuses every other
 * column to anyone without `staff.manage`, which is what stops a policy scoped
 * to "your own row" from handing every guide the ability to promote themselves.
 * Not the name or photo either: those come from their Swellyo profile, and this
 * is one trip, not a second identity.
 *
 * ── The operator can still write this ──────────────────────────────────────
 * Deliberately. The crew section is how the trip introduces its people, and
 * keeping it coherent is the operator's job. Two writers, last write wins,
 * which is the right answer for two people editing one sentence about one of
 * them — so the copy says so rather than letting it come as a surprise.
 *
 * Renders nothing for a traveler or an operator with no crew row of their own.
 */
export function MyCrewCard({ tripId }: { tripId: string }) {
  const qc = useQueryClient();
  const mine = useQuery({
    queryKey: ['crew', tripId, 'mine'],
    queryFn: () => fetchMyCrewRow(tripId),
  });

  const [title, setTitle] = useState('');
  const [bio, setBio] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Seeded from the row, and re-seeded only when the ROW changes — not on every
  // refetch, which would wipe what somebody was halfway through typing.
  useEffect(() => {
    if (!mine.data) return;
    setTitle(mine.data.title ?? '');
    setBio(mine.data.bio ?? '');
  }, [mine.data?.id]);

  const save = useMutation({
    mutationFn: () => updateCrewMember({ id: mine.data!.id, userId: mine.data!.userId }, { title, bio }),
    onMutate: () => {
      setError(null);
      setSaved(false);
    },
    onSuccess: () => {
      setSaved(true);
      void qc.invalidateQueries({ queryKey: ['crew', tripId] });
    },
    onError: e => setError(friendlyError(e)),
  });

  if (mine.isPending || !mine.data) return null;

  const dirty = title.trim() !== (mine.data.title ?? '') || bio.trim() !== (mine.data.bio ?? '');

  return (
    <div className="card enter">
      <div className="card-head">
        <h2>Your details</h2>
        <span className="muted small">How you are introduced on this trip</span>
      </div>
      <div className="card-body">
        <ProfileFields
          title={title}
          bio={bio}
          onTitle={v => {
            setTitle(v);
            setSaved(false);
          }}
          onBio={v => {
            setBio(v);
            setSaved(false);
          }}
        />

        {error && (
          <p className="small" style={{ color: 'var(--danger)', marginTop: 12 }}>
            {error}
          </p>
        )}

        <div className="row" style={{ gap: 12, marginTop: 16 }}>
          <button
            className="btn btn-sm btn-primary"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
          {saved && !dirty && <span className="muted small">Saved</span>}
        </div>

        <p className="muted small" style={{ marginTop: 12 }}>
          Your operator can edit this too — whoever saves last wins. Your name and photo come from
          your Swellyo profile.
        </p>
      </div>
    </div>
  );
}
