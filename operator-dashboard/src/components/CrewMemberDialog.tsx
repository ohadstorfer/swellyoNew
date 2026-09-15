/**
 * One crew member: what they may do, how travelers meet them, and what you need
 * from them.
 *
 * ── What is editable depends on whether there is an ACCOUNT behind the row ──
 * The test is `userId`, never `roleKey === 'listed'` — someone can accept an
 * invite at the Listed tier and still be promotable. See `canChangeTier`.
 *
 *   with an account   tier · title · bio          (name and photo are theirs)
 *   Listed credit     name · title · bio          (no tier: nobody to grant to)
 *
 * A person's name and photo are deliberately not overridable here. One source
 * of truth: they rename themselves once, and every trip they crew follows. What
 * the operator owns is how this trip INTRODUCES them.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  canChangeTier,
  removeCrewMember,
  updateCrewMember,
  updateCrewRole,
  type CrewMember,
  type StaffRole,
  type StaffRoleKey,
} from '../services/staff';
import { uploadCrewPhoto } from '../services/images';
import { useAuth } from '../lib/auth';
import { friendlyError } from '../lib/errors';
import { Avatar } from './StateBits';
import { CrewPaperworkSection } from './CrewPaperwork';
import { ProfileFields, TierPicker, TIER_TAG } from './CrewFields';

export function CrewMemberDialog({
  tripId,
  member,
  roles,
  isOwner,
  onClose,
}: {
  tripId: string;
  member: CrewMember;
  /** Assignable tiers only — Operator is held by owning the trip, not by a row. */
  roles: StaffRole[];
  /**
   * Is the viewer the operator of record — the creator of the trip?
   *
   * A co-operator holds `staff.manage` and may hire crew, but appointing,
   * demoting or removing another co-operator is the creator's alone
   * (invariant I2', enforced by trg_owner_owns_top_tiers). This hides the
   * controls the database would refuse.
   */
  isOwner: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const editable =
    canChangeTier(member) && (isOwner || member.roleKey !== 'co_operator');

  const { user } = useAuth();
  const [name, setName] = useState(member.name);
  const [title, setTitle] = useState(member.title ?? '');
  const [bio, setBio] = useState(member.bio ?? '');
  const [roleKey, setRoleKey] = useState<StaffRoleKey>(member.roleKey);
  const [error, setError] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

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

  const roleLabel = roles.find(r => r.roleKey === member.roleKey)?.label ?? member.roleKey;

  const save = useMutation({
    mutationFn: async () => {
      // Upload FIRST, then write the row — the same order the app's cover-photo
      // editor uses. A file uploaded before a failed row update is orphaned in
      // storage, which is harmless; a row pointing at a file that never
      // uploaded is a broken image on the trip page.
      let photoUrl: string | undefined;
      if (photoFile && !editable && user) {
        photoUrl = await uploadCrewPhoto(photoFile, user.id);
      }

      await updateCrewMember(member, {
        title,
        bio,
        // Offered for a Listed credit only — the service refuses both for
        // anyone with an account, which is the same rule stated twice on
        // purpose.
        ...(editable ? {} : { displayName: name }),
        ...(photoUrl !== undefined ? { photoUrl } : {}),
      });
      if (editable && roleKey !== member.roleKey) {
        await updateCrewRole(member.id, roleKey);
      }
    },
    onMutate: () => setError(null),
    onSuccess: () => {
      setPhotoFile(null);
      void qc.invalidateQueries({ queryKey: ['crew', tripId] });
      // Their own capabilities changed if the tier did. Cheap to drop, and the
      // alternative is a demoted manager keeping the buttons for five minutes.
      void qc.invalidateQueries({ queryKey: ['capabilities'] });
      onClose();
    },
    onError: e => setError(friendlyError(e)),
  });

  const remove = useMutation({
    mutationFn: () => removeCrewMember(member.id),
    onMutate: () => setError(null),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['crew', tripId] });
      void qc.invalidateQueries({ queryKey: ['capabilities'] });
      onClose();
    },
    onError: e => setError(friendlyError(e)),
  });

  const busy = save.isPending || remove.isPending;
  // A Listed credit with a blank name would write display_name = null, which
  // `ots_listed_needs_name` rejects — the row would have neither an account nor
  // a name, so nothing to show. Caught here rather than as a database error.
  // A co-operator's card belongs to the creator, the same as appointing them —
  // so another co-operator can read this dialog and change nothing in it. The
  // database refuses the write either way; this makes the button say so.
  const mayEdit = isOwner || member.roleKey !== 'co_operator';
  const canSave = !busy && mayEdit && (editable || !!name.trim());

  return (
    <div className="scrim" onClick={busy ? undefined : onClose} role="dialog" aria-modal="true">
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="card-head">
          <span className="row" style={{ gap: 10, minWidth: 0 }}>
            <Avatar url={member.photoUrl} name={member.name} size={28} />
            <strong>{member.name}</strong>
          </span>
          <span className={`tag ${TIER_TAG[member.roleKey]}`}>{roleLabel}</span>
        </div>

        <div className="card-body" style={{ overflowY: 'auto' }}>
          {member.pending && (
            <p className="muted small" style={{ marginBottom: 12 }}>
              They haven't accepted the invite yet. Everything below is saved now and applies the
              moment they do.
            </p>
          )}

          {!editable && (
            <>
              <p className="muted small" style={{ marginBottom: 12 }}>
                Listed only — they have no Swellyo account, so there is nothing to give them
                access to.
              </p>

              {/* The photo. This used to say "can be changed in the app", which
                  was never a limit of the platform — crew photos go through the
                  image-upload edge function, and a browser can call it. See
                  services/images.ts. */}
              <div className="row" style={{ gap: 14, alignItems: 'center', marginBottom: 14 }}>
                <Avatar url={photoPreview ?? member.photoUrl} name={name || '?'} size={56} />
                <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
                  {member.photoUrl || photoFile ? 'Change photo' : 'Add a photo'}
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    disabled={busy}
                    onChange={e => setPhotoFile(e.target.files?.[0] ?? null)}
                  />
                </label>
                {photoFile && (
                  <span className="muted small">Saved when you press Save.</span>
                )}
              </div>

              <label className="small muted" htmlFor="crew-name" style={{ display: 'block' }}>
                Name
              </label>
              <input
                id="crew-name"
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Marta Ruiz"
                style={{ marginTop: 6, marginBottom: 14 }}
              />
            </>
          )}

          <ProfileFields title={title} bio={bio} onTitle={setTitle} onBio={setBio} />

          {editable && (
            <>
              <h2 style={{ marginTop: 18, marginBottom: 6 }}>What they can see</h2>
              <TierPicker roles={roles} value={roleKey} onChange={setRoleKey} />
              <CrewPaperworkSection tripId={tripId} staffId={member.id} userId={member.userId} />
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
            padding: '12px 16px',
            gap: 8,
          }}
        >
          {confirmingRemove ? (
            <>
              {/* The sentence sits where the buttons were, so the thing being
                  confirmed and the button confirming it are never apart. */}
              <span className="small" style={{ flex: 1 }}>
                Remove {member.name}? They lose access straight away.
              </span>
              <button className="btn btn-sm" disabled={busy} onClick={() => setConfirmingRemove(false)}>
                Keep
              </button>
              <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => remove.mutate()}>
                {remove.isPending ? 'Removing…' : 'Remove'}
              </button>
            </>
          ) : (
            <>
              {/* A co-operator is removed by the creator alone — same rule as
                  appointing one. The database refuses anyone else. */}
              {isOwner || member.roleKey !== 'co_operator' ? (
                <button
                  className="btn btn-sm btn-danger"
                  disabled={busy}
                  onClick={() => setConfirmingRemove(true)}
                >
                  Remove from crew
                </button>
              ) : null}
              <span className="spacer" />
              <button className="btn btn-sm" disabled={busy} onClick={onClose}>
                Cancel
              </button>
              <button
                className="btn btn-sm btn-primary"
                disabled={!canSave}
                onClick={() => save.mutate()}
              >
                {save.isPending ? 'Saving…' : 'Save'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
