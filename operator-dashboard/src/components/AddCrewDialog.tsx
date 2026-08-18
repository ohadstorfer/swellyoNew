/**
 * Add someone to the crew: find them, choose what they may do, say what you
 * need from them, send.
 *
 * ── Why a search and not an email field ────────────────────────────────────
 * `search_users_for_staff` never returns an email, so this cannot be used to
 * confirm an address, and it drops blocks in both directions server-side. What
 * it does return is a `state` for the three cases the operator can already see
 * on their own trip — already a traveler, already crew, already invited — so
 * those rows are shown greyed with the reason instead of silently missing,
 * which is what left operators staring at "Nobody found" while the person sat
 * on the trip in front of them.
 *
 * ── The two doors that are not here ────────────────────────────────────────
 * An invite LINK and a LISTED credit stay in the app: the link is shared over
 * WhatsApp, which is a phone action anyway, and a Listed credit wants a photo
 * upload this project has no path for. An existing Listed row is still editable
 * from the crew page.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  inviteStaffMember,
  searchUsersForStaff,
  type StaffRole,
  type StaffRoleKey,
  type StaffSearchResult,
} from '../services/staff';
import {
  ensureStaffRequirements,
  friendlyStaffRequirementError,
  type StaffKind,
} from '../services/staffRequirements';
import { friendlyError } from '../lib/errors';
import { Avatar } from './StateBits';
import { CrewPaperworkPicker } from './CrewPaperwork';
import { ProfileFields, TierPicker } from './CrewFields';

const BLOCKED_REASON: Record<Exclude<StaffSearchResult['state'], 'available'>, string> = {
  traveler: 'Already a traveler on this trip',
  crew: 'Already on the crew',
  invited: 'Already invited',
};

export function AddCrewDialog({
  tripId,
  roles,
  onClose,
}: {
  tripId: string;
  /** Assignable tiers only. */
  roles: StaffRole[];
  onClose: () => void;
}) {
  const qc = useQueryClient();

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [picked, setPicked] = useState<StaffSearchResult | null>(null);
  const [roleKey, setRoleKey] = useState<StaffRoleKey>('crew');
  const [title, setTitle] = useState('');
  const [bio, setBio] = useState('');
  const [kinds, setKinds] = useState<StaffKind[]>([]);
  const [error, setError] = useState<string | null>(null);

  // 250ms is long enough to swallow a burst of typing and short enough to feel
  // live. React Query handles the rest — an earlier, slower query landing after
  // a later one cannot overwrite it, because the key changed.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const results = useQuery({
    queryKey: ['staffSearch', tripId, debounced],
    queryFn: () => searchUsersForStaff(tripId, debounced),
    enabled: debounced.length >= 2,
  });

  const send = useMutation({
    mutationFn: async () => {
      if (!picked) return;
      // The requirement rows are created here, at send, and not while the
      // operator is ticking: a dialog abandoned halfway must not leave
      // "Passport (crew)" on a trip that never asked anyone for one.
      const requirementIds = await ensureStaffRequirements(tripId, kinds);
      await inviteStaffMember({
        tripId,
        userId: picked.userId,
        roleKey: roleKey as Exclude<StaffRoleKey, 'operator'>,
        title,
        bio,
        requirementIds,
      });
    },
    onMutate: () => setError(null),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['crew', tripId] });
      void qc.invalidateQueries({ queryKey: ['staffRequirements', tripId] });
      // The person just invited now answers 'invited' rather than 'available',
      // and a cached search would offer them again.
      void qc.invalidateQueries({ queryKey: ['staffSearch', tripId] });
      onClose();
    },
    onError: e => setError(friendlyStaffRequirementError(e) ?? friendlyError(e)),
  });

  const busy = send.isPending;

  return (
    <div className="scrim" onClick={busy ? undefined : onClose} role="dialog" aria-modal="true">
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="card-head">
          <strong>{picked ? 'Add to the crew' : 'Who are you adding?'}</strong>
        </div>

        <div className="card-body" style={{ overflowY: 'auto' }}>
          {!picked ? (
            <>
              <input
                type="text"
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search by name"
              />

              {debounced.length < 2 ? (
                <p className="muted small" style={{ marginTop: 10 }}>
                  Type at least two letters. They need a Swellyo account — for anyone else, send an
                  invite link from the app.
                </p>
              ) : results.isPending ? (
                <p className="muted small" style={{ marginTop: 10 }}>
                  Searching…
                </p>
              ) : results.isError ? (
                <p className="small" style={{ color: 'var(--danger)', marginTop: 10 }}>
                  {friendlyError(results.error)}
                </p>
              ) : (results.data ?? []).length === 0 ? (
                <p className="muted small" style={{ marginTop: 10 }}>
                  Nobody found. Try their full name, or send them an invite link from the app.
                </p>
              ) : (
                <div className="card" style={{ marginTop: 10 }}>
                  {(results.data ?? []).map(person => {
                    const blocked = person.state !== 'available';
                    return (
                      <button
                        key={person.userId}
                        type="button"
                        className="row-link"
                        // Dimmed by :disabled, not hidden: the row is an answer,
                        // and an answer you cannot read is the state this
                        // replaced.
                        disabled={blocked}
                        onClick={() => setPicked(person)}
                      >
                        <span className="row" style={{ gap: 11, minWidth: 0 }}>
                          <Avatar url={person.photoUrl} name={person.name} />
                          <span>{person.name}</span>
                        </span>
                        {blocked ? (
                          <span className="muted small">
                            {BLOCKED_REASON[person.state as keyof typeof BLOCKED_REASON]}
                          </span>
                        ) : (
                          <span className="muted" aria-hidden>
                            ›
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="row-between" style={{ marginBottom: 16 }}>
                <span className="row" style={{ gap: 11, minWidth: 0 }}>
                  <Avatar url={picked.photoUrl} name={picked.name} />
                  <strong>{picked.name}</strong>
                </span>
                <button className="btn btn-sm" disabled={busy} onClick={() => setPicked(null)}>
                  Change
                </button>
              </div>

              <h2 style={{ marginBottom: 6 }}>What they can see</h2>
              <TierPicker roles={roles} value={roleKey} onChange={setRoleKey} />

              <div style={{ marginTop: 18 }}>
                <ProfileFields title={title} bio={bio} onTitle={setTitle} onBio={setBio} />
              </div>

              <h2 style={{ marginTop: 18, marginBottom: 6 }}>Paperwork</h2>
              <p className="muted small">
                Tick what you need from them. It is asked as soon as they accept, and nobody else on
                the crew is affected. Leave it all off if you need nothing.
              </p>
              <CrewPaperworkPicker selected={kinds} onChange={setKinds} />

              {error && (
                <p className="small" style={{ color: 'var(--danger)', marginTop: 12 }}>
                  {error}
                </p>
              )}
            </>
          )}
        </div>

        <div
          className="row"
          style={{
            borderTop: '1px solid var(--line)',
            padding: '12px 16px',
            justifyContent: 'flex-end',
            gap: 8,
          }}
        >
          <button className="btn btn-sm" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          {picked && (
            <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => send.mutate()}>
              {busy ? 'Sending…' : 'Send invite'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
