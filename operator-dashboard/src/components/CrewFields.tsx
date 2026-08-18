/**
 * The two blocks that appear in both crew dialogs: what this person may DO
 * (the tier), and who they ARE to a traveler (job, blurb).
 *
 * They are separate on purpose. The tier is a permission set the operator
 * reads; the title is how the trip introduces a person. The same guide is
 * "Head guide" on one trip and "Photographer" on the next, and neither of those
 * words says anything about what they can see.
 */
import { CAPABILITY_LABELS } from '../services/access';
import { STAFF_PROFESSIONS, type StaffRole, type StaffRoleKey } from '../services/staff';

/**
 * A pill colour per tier, so a crew list can be scanned rather than read.
 *
 * Display only. Nothing branches on the tier — the capabilities do that, and
 * they are data. See the spec: never check `tier >= 4`.
 */
export const TIER_TAG: Record<StaffRoleKey, string> = {
  listed: 'tag-idle',
  crew: 'tag-wait',
  guide: 'tag-ok',
  manager: 'tag-warn',
  operator: 'tag-brand',
};

/**
 * The five cards, with the chosen one's capabilities listed underneath.
 *
 * `role.capabilities` comes from `organized_trip_staff_roles`. Rendering the
 * database's own answer is the whole point of the permission design: what a
 * Guide can do changes with an UPDATE, and this list follows without a release.
 */
export function TierPicker({
  roles,
  value,
  onChange,
}: {
  /** Already filtered — the Operator tier is never assignable. */
  roles: StaffRole[];
  value: StaffRoleKey;
  onChange: (next: StaffRoleKey) => void;
}) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      {roles.map(role => {
        const selected = role.roleKey === value;
        return (
          <button
            key={role.roleKey}
            type="button"
            className="choice"
            aria-pressed={selected}
            onClick={() => onChange(role.roleKey)}
          >
            <span className="row-between">
              <strong>{role.label}</strong>
              <span className={`tag ${TIER_TAG[role.roleKey]}`}>Tier {role.tier}</span>
            </span>
            {role.blurb && (
              <span className="muted small" style={{ display: 'block', marginTop: 3 }}>
                {role.blurb}
              </span>
            )}
            {selected && (
              <span style={{ display: 'block', marginTop: 10 }}>
                {role.capabilities.map(c => (
                  <span
                    key={c}
                    className="small"
                    style={{ display: 'block', color: 'var(--text-2)', marginTop: 4 }}
                  >
                    ✓ {CAPABILITY_LABELS[c] ?? c}
                  </span>
                ))}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Who this person is FOR TRAVELERS: what they do, and a line about them.
 *
 * The chips fill the field under them rather than replacing it, so an operator
 * with a job nobody thought of ("Boat captain", "Shaper") is not stuck picking
 * "Other" from a list that describes nobody.
 */
export function ProfileFields({
  title,
  bio,
  onTitle,
  onBio,
}: {
  title: string;
  bio: string;
  onTitle: (next: string) => void;
  onBio: (next: string) => void;
}) {
  return (
    <>
      <label className="small muted" htmlFor="crew-title" style={{ display: 'block' }}>
        What do they do?
      </label>
      <div className="row" style={{ flexWrap: 'wrap', gap: 8, margin: '8px 0' }}>
        {STAFF_PROFESSIONS.map(job => (
          <button
            key={job}
            type="button"
            className="chip"
            aria-pressed={title.trim().toLowerCase() === job.toLowerCase()}
            onClick={() => onTitle(job)}
          >
            {job}
          </button>
        ))}
      </div>
      <input
        id="crew-title"
        type="text"
        value={title}
        onChange={e => onTitle(e.target.value)}
        placeholder="Head guide"
      />

      <label
        className="small muted"
        htmlFor="crew-bio"
        style={{ display: 'block', marginTop: 14 }}
      >
        A line about them
      </label>
      <textarea
        id="crew-bio"
        value={bio}
        maxLength={280}
        rows={3}
        onChange={e => onBio(e.target.value)}
        placeholder="Shooting from the water all week. Ten years on this coast."
        style={{ marginTop: 6 }}
      />
      <p className="muted small" style={{ marginTop: 4, textAlign: 'right' }}>
        {bio.length}/280
      </p>
    </>
  );
}
