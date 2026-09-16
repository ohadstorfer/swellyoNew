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
 * ── The two doors that USED to be missing ──────────────────────────────────
 * This file said an invite LINK and a LISTED credit "stay in the app", the
 * second because "a Listed credit wants a photo upload this project has no path
 * for". Product Specs is explicit that every function exists on both surfaces,
 * and the photo turned out not to be a real obstacle: crew photos go through
 * the `image-upload-s3` edge function, which is two `fetch` calls and works
 * identically in a browser. See `services/images.ts`.
 *
 * So there are three doors now, and they are the three shapes a crew member
 * comes in:
 *
 *   · IN THE APP — search, invite, they accept. Their name and face are theirs.
 *   · NOT IN THE APP — a Listed credit typed in by hand, with a photo. No
 *     login, no permissions, a name on the trip page.
 *   · SOMEWHERE ELSE — a link to send over WhatsApp, redeemable once by
 *     whoever opens it.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addListedCrew,
  createStaffInviteLink,
  inviteStaffMember,
  searchUsersForStaff,
  updateCrewMember,
  type StaffRole,
  type StaffRoleKey,
  type StaffSearchResult,
} from '../services/staff';
import {
  ensureStaffRequirements,
  friendlyStaffRequirementError,
  type StaffKind,
} from '../services/staffRequirements';
import { uploadCrewPhoto } from '../services/images';
import { useAuth } from '../lib/auth';
import { friendlyError } from '../lib/errors';
import { Avatar } from './StateBits';
import { CrewPaperworkPicker } from './CrewPaperwork';
import { ProfileFields, TierPicker } from './CrewFields';

const BLOCKED_REASON: Record<Exclude<StaffSearchResult['state'], 'available'>, string> = {
  traveler: 'Already a traveler on this trip',
  crew: 'Already on the crew',
  invited: 'Already invited',
};

type Door = 'account' | 'listed' | 'link';

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
  const { user } = useAuth();

  const [door, setDoor] = useState<Door | null>(null);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [picked, setPicked] = useState<StaffSearchResult | null>(null);
  const [roleKey, setRoleKey] = useState<StaffRoleKey>('crew');
  const [title, setTitle] = useState('');
  const [bio, setBio] = useState('');
  const [kinds, setKinds] = useState<StaffKind[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Listed-credit fields
  const [displayName, setDisplayName] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  // Invite-link result
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // 250ms is long enough to swallow a burst of typing and short enough to feel
  // live. React Query handles the rest — an earlier, slower query landing after
  // a later one cannot overwrite it, because the key changed.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  // The object URL is the browser's handle on the file, and it leaks until it
  // is revoked.
  useEffect(() => {
    if (!photoFile) {
      setPhotoPreview(null);
      return;
    }
    const url = URL.createObjectURL(photoFile);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photoFile]);

  const results = useQuery({
    queryKey: ['staffSearch', tripId, debounced],
    queryFn: () => searchUsersForStaff(tripId, debounced),
    enabled: door === 'account' && debounced.length >= 2,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['crew', tripId] });
    void qc.invalidateQueries({ queryKey: ['staffRequirements', tripId] });
    // The person just invited now answers 'invited' rather than 'available',
    // and a cached search would offer them again.
    void qc.invalidateQueries({ queryKey: ['staffSearch', tripId] });
  };

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
      refresh();
      onClose();
    },
    onError: e => setError(friendlyStaffRequirementError(e) ?? friendlyError(e)),
  });

  const addListed = useMutation({
    mutationFn: async () => {
      // The ROW first, the photo second. An upload that fails must not lose the
      // operator the name and title they typed — the credit exists without a
      // face, and the crew page can add one later.
      const staffId = await addListedCrew({ tripId, displayName, title, bio });
      if (photoFile && user) {
        const url = await uploadCrewPhoto(photoFile, user.id);
        await updateCrewMember({ id: staffId, userId: null }, { photoUrl: url });
      }
    },
    onMutate: () => setError(null),
    onSuccess: () => {
      refresh();
      onClose();
    },
    onError: e => setError(friendlyError(e)),
  });

  const makeLink = useMutation({
    mutationFn: async () => {
      const requirementIds = await ensureStaffRequirements(tripId, kinds);
      return createStaffInviteLink({
        tripId,
        roleKey: roleKey as Exclude<StaffRoleKey, 'operator'>,
        title,
        bio,
        requirementIds,
      });
    },
    onMutate: () => setError(null),
    onSuccess: url => {
      setLink(url);
      refresh();
    },
    onError: e => setError(friendlyStaffRequirementError(e) ?? friendlyError(e)),
  });

  const busy = send.isPending || addListed.isPending || makeLink.isPending;

  return (
    <div className="scrim" onClick={busy ? undefined : onClose} role="dialog" aria-modal="true">
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="card-head">
          <strong>
            {door === null
              ? 'Who are you adding?'
              : door === 'listed'
                ? 'Someone not in the app'
                : door === 'link'
                  ? 'Send an invite link'
                  : picked
                    ? 'Add to the crew'
                    : 'Find them'}
          </strong>
        </div>

        <div className="card-body" style={{ overflowY: 'auto' }}>
          {/* ── The three doors ──────────────────────────────────────────── */}
          {door === null && (
            <div className="card">
              <button type="button" className="row-link" onClick={() => setDoor('account')}>
                <span>
                  <strong>They have a Swellyo account</strong>
                  <span className="muted small" style={{ display: 'block' }}>
                    Search for them and send an invite. They keep their own name and photo.
                  </span>
                </span>
                <span className="muted" aria-hidden>
                  ›
                </span>
              </button>
              <button type="button" className="row-link" onClick={() => setDoor('listed')}>
                <span>
                  <strong>They are not in the app</strong>
                  <span className="muted small" style={{ display: 'block' }}>
                    A name, a photo and a job on the trip page. No login, no access.
                  </span>
                </span>
                <span className="muted" aria-hidden>
                  ›
                </span>
              </button>
              <button type="button" className="row-link" onClick={() => setDoor('link')}>
                <span>
                  <strong>Send them a link</strong>
                  <span className="muted small" style={{ display: 'block' }}>
                    One link, used once, by whoever opens it. Good for WhatsApp.
                  </span>
                </span>
                <span className="muted" aria-hidden>
                  ›
                </span>
              </button>
            </div>
          )}

          {/* ── Door 1: an account ───────────────────────────────────────── */}
          {door === 'account' && !picked && (
            <>
              <input
                type="text"
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search by name"
              />

              {debounced.length < 2 ? (
                <p className="muted small" style={{ marginTop: 12 }}>
                  Type at least two letters. For anyone without an account, go back and add them as
                  a name on the trip, or send a link.
                </p>
              ) : results.isPending ? (
                <p className="muted small" style={{ marginTop: 12 }}>
                  Searching…
                </p>
              ) : results.isError ? (
                <p className="small" style={{ color: 'var(--danger)', marginTop: 12 }}>
                  {friendlyError(results.error)}
                </p>
              ) : (results.data ?? []).length === 0 ? (
                <p className="muted small" style={{ marginTop: 12 }}>
                  Nobody found. Try their full name, or go back and send them a link.
                </p>
              ) : (
                <div className="card" style={{ marginTop: 12 }}>
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
                        <span className="row" style={{ gap: 12, minWidth: 0 }}>
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
          )}

          {door === 'account' && picked && (
            <>
              <div className="row-between" style={{ marginBottom: 16 }}>
                <span className="row" style={{ gap: 12, minWidth: 0 }}>
                  <Avatar url={picked.photoUrl} name={picked.name} />
                  <strong>{picked.name}</strong>
                </span>
                <button className="btn btn-sm" disabled={busy} onClick={() => setPicked(null)}>
                  Change
                </button>
              </div>
              <TierAndPaperwork
                roles={roles}
                roleKey={roleKey}
                setRoleKey={setRoleKey}
                title={title}
                setTitle={setTitle}
                bio={bio}
                setBio={setBio}
                kinds={kinds}
                setKinds={setKinds}
              />
            </>
          )}

          {/* ── Door 2: a Listed credit ──────────────────────────────────── */}
          {door === 'listed' && (
            <>
              <p className="muted small" style={{ marginBottom: 16 }}>
                They appear on the trip page and nowhere else. No account, no login, and nothing
                to accept — a credit, like a photographer in a film.
              </p>

              <div className="row" style={{ gap: 16, alignItems: 'center', marginBottom: 16 }}>
                <Avatar url={photoPreview} name={displayName || '?'} size={56} />
                <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
                  {photoFile ? 'Change photo' : 'Add a photo'}
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={e => setPhotoFile(e.target.files?.[0] ?? null)}
                  />
                </label>
                {photoFile && (
                  <button className="btn btn-sm btn-ghost" onClick={() => setPhotoFile(null)}>
                    Remove
                  </button>
                )}
              </div>

              <label className="small" style={{ display: 'block', marginBottom: 12 }}>
                Their name
                <input
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value.slice(0, 80))}
                  placeholder="Kadek Surya"
                  style={{ width: '100%', marginTop: 8 }}
                  autoFocus
                />
              </label>

              <ProfileFields title={title} bio={bio} onTitle={setTitle} onBio={setBio} />
            </>
          )}

          {/* ── Door 3: a link ───────────────────────────────────────────── */}
          {door === 'link' && !link && (
            <>
              <p className="muted small" style={{ marginBottom: 16 }}>
                Anyone who opens this link and signs in joins the crew at the tier you pick. It can
                be used once.
              </p>
              <TierAndPaperwork
                roles={roles}
                roleKey={roleKey}
                setRoleKey={setRoleKey}
                title={title}
                setTitle={setTitle}
                bio={bio}
                setBio={setBio}
                kinds={kinds}
                setKinds={setKinds}
              />
            </>
          )}

          {door === 'link' && link && (
            <>
              <p className="small" style={{ marginBottom: 12 }}>
                Send them this. It works once.
              </p>
              <div className="row" style={{ gap: 8 }}>
                <input readOnly value={link} className="mono" style={{ flex: 1 }} />
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => {
                    void navigator.clipboard.writeText(link);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2500);
                  }}
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </>
          )}

          {error && (
            <p className="small" style={{ color: 'var(--danger)', marginTop: 12 }}>
              {error}
            </p>
          )}
        </div>

        <div
          className="row"
          style={{
            borderTop: '1px solid var(--line)',
            padding: '16px 24px',
            justifyContent: 'flex-end',
            gap: 8,
          }}
        >
          <button
            className="btn btn-sm"
            disabled={busy}
            onClick={() => {
              // Back to the doors from a half-filled form, rather than out of
              // the dialog: picking the wrong door is the likeliest mistake
              // here, and it should cost one click.
              if (door && !link) {
                setDoor(null);
                setPicked(null);
                setError(null);
              } else {
                onClose();
              }
            }}
          >
            {door && !link ? 'Back' : 'Close'}
          </button>

          {door === 'account' && picked && (
            <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => send.mutate()}>
              {busy ? 'Sending…' : 'Send invite'}
            </button>
          )}
          {door === 'listed' && (
            <button
              className="btn btn-sm btn-primary"
              disabled={busy || !displayName.trim()}
              onClick={() => addListed.mutate()}
            >
              {busy ? 'Adding…' : 'Add them'}
            </button>
          )}
          {door === 'link' && !link && (
            <button
              className="btn btn-sm btn-primary"
              disabled={busy}
              onClick={() => makeLink.mutate()}
            >
              {busy ? 'Making the link…' : 'Make the link'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** The tier, the job title and the paperwork — the three things an invite and
 *  an invite link both need, and in the same order. */
function TierAndPaperwork({
  roles,
  roleKey,
  setRoleKey,
  title,
  setTitle,
  bio,
  setBio,
  kinds,
  setKinds,
}: {
  roles: StaffRole[];
  roleKey: StaffRoleKey;
  setRoleKey: (k: StaffRoleKey) => void;
  title: string;
  setTitle: (s: string) => void;
  bio: string;
  setBio: (s: string) => void;
  kinds: StaffKind[];
  setKinds: (k: StaffKind[]) => void;
}) {
  return (
    <>
      <h2 style={{ marginBottom: 8 }}>What they can see</h2>
      <TierPicker roles={roles} value={roleKey} onChange={setRoleKey} />

      <div style={{ marginTop: 16 }}>
        <ProfileFields title={title} bio={bio} onTitle={setTitle} onBio={setBio} />
      </div>

      <h2 style={{ marginTop: 16, marginBottom: 8 }}>Paperwork</h2>
      <p className="muted small">
        Tick what you need from them. It is asked as soon as they accept, and nobody else on the
        crew is affected. Deadlines follow the travelers' own. Leave it all off if you need
        nothing.
      </p>
      <CrewPaperworkPicker selected={kinds} onChange={setKinds} />
    </>
  );
}
