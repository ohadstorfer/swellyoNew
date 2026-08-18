/**
 * "What do I need from this person?" — the crew paperwork tick list.
 *
 * Two exports, one list:
 *   • CrewPaperworkPicker  — a step in the invite dialog. Nothing is written;
 *     the ticked kinds ride out on the invite and land when it is accepted,
 *     because an invited person has no staff row to assign anything to yet.
 *   • CrewPaperworkSection — the same list for someone already on the crew.
 *     Every tick is a write, and each row also says whether it arrived.
 *
 * ── Why the tick is a KIND and not a requirement row ───────────────────────
 * The list is the CATALOG — Passport, Visa, Waiver… — not the trip's existing
 * staff requirements. A trip that has never asked crew for anything would
 * otherwise show an empty box telling the operator to go and make a requirement
 * somewhere else, which nobody was ever going to do. Ticking one creates the
 * row. See ensureStaffRequirements.
 *
 * ── Two things it deliberately does not do ─────────────────────────────────
 * No deadline and no overdue state: crew paperwork is flagged, never gated.
 * And unticking never deletes the requirement, only the assignment — the
 * document they already sent stays where it is, and everyone else asked for the
 * same thing is untouched.
 */
import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  assignStaffRequirement,
  ensureStaffRequirements,
  fetchStaffFulfilment,
  fetchStaffRequirements,
  friendlyStaffRequirementError,
  isFulfilled,
  STAFF_KINDS,
  STAFF_KIND_COPY,
  unassignStaffRequirement,
  type StaffKind,
  type StaffRequirement,
} from '../services/staffRequirements';
import { friendlyError } from '../lib/errors';

/** Shared row. `right` is the status or the spinner — never both. */
function CheckRow({
  title,
  sub,
  checked,
  disabled,
  right,
  onToggle,
}: {
  title: string;
  sub?: string | null;
  checked: boolean;
  disabled?: boolean;
  right?: ReactNode;
  onToggle: () => void;
}) {
  return (
    <label className="row-link" style={{ cursor: disabled ? 'default' : 'pointer' }}>
      <span className="row" style={{ gap: 11, minWidth: 0 }}>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={onToggle}
          style={{ width: 16, height: 16, flexShrink: 0, accentColor: 'var(--cyan-dark)' }}
        />
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'block' }}>{title}</span>
          {sub && (
            <span className="muted small" style={{ display: 'block', marginTop: 2 }}>
              {sub}
            </span>
          )}
        </span>
      </span>
      {right}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Draft — the invite step. Writes nothing.
// ---------------------------------------------------------------------------

export function CrewPaperworkPicker({
  selected,
  onChange,
}: {
  /** Kinds currently ticked. Owned by the caller, because the send button needs
   *  them and a selection living in here would be gone by then. */
  selected: StaffKind[];
  onChange: (next: StaffKind[]) => void;
}) {
  const toggle = (kind: StaffKind) =>
    onChange(selected.includes(kind) ? selected.filter(k => k !== kind) : [...selected, kind]);

  return (
    <div className="card" style={{ marginTop: 8 }}>
      {STAFF_KINDS.map(kind => (
        <CheckRow
          key={kind}
          title={STAFF_KIND_COPY[kind].title}
          sub={STAFF_KIND_COPY[kind].sub}
          checked={selected.includes(kind)}
          onToggle={() => toggle(kind)}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live — someone already on the crew. Every tick is a write.
// ---------------------------------------------------------------------------

export function CrewPaperworkSection({
  tripId,
  staffId,
  userId,
}: {
  tripId: string;
  /** The `organized_trip_staff` row id. */
  staffId: string;
  /** Null for a Listed credit — the caller should not render this at all then. */
  userId: string | null;
}) {
  const qc = useQueryClient();
  /** Kinds with a write in flight, so each row can spin alone. */
  const [busy, setBusy] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reqs = useQuery({
    queryKey: ['staffRequirements', tripId],
    queryFn: () => fetchStaffRequirements(tripId),
  });
  const done = useQuery({
    queryKey: ['staffFulfilment', tripId],
    queryFn: () => fetchStaffFulfilment(tripId),
  });

  const requirements = reqs.data ?? [];

  /** kind → the trip's requirement row for it, if there is one. */
  const byKind = new Map<string, StaffRequirement>();
  for (const r of requirements) if (!byKind.has(r.kind)) byKind.set(r.kind, r);

  /**
   * Rows the catalog does not offer — a `custom` ask typed into the trip's
   * requirement editor. Listed so it can still be given to someone from here.
   */
  const extras = requirements.filter(r => !(STAFF_KINDS as readonly string[]).includes(r.kind));

  // `key` is what the row is keyed by in the list below — the kind for a
  // catalog row, the requirement id for a custom one — so the spinner appears
  // on the row that was clicked and on no other.
  const toggle = useMutation({
    mutationFn: async ({ kind, row }: { key: string; kind: string; row?: StaffRequirement }) => {
      const assigned = !!row?.assignedStaffIds.includes(staffId);

      if (assigned && row) {
        await unassignStaffRequirement(staffId, row.requirementId);
        return;
      }
      const [requirementId] = row
        ? [row.requirementId]
        : await ensureStaffRequirements(tripId, [kind as StaffKind]);
      await assignStaffRequirement({ tripId, staffId, requirementId });
    },
    onMutate: ({ key }) => {
      setError(null);
      setBusy(b => [...b, key]);
    },
    onError: e => setError(friendlyStaffRequirementError(e) ?? friendlyError(e)),
    onSettled: (_d, _e, { key }) => {
      setBusy(b => b.filter(k => k !== key));
      void qc.invalidateQueries({ queryKey: ['staffRequirements', tripId] });
    },
  });

  if (!userId) return null;

  const rows: Array<{ key: string; kind: string; title: string; sub: string | null; row?: StaffRequirement }> = [
    ...STAFF_KINDS.map(kind => ({
      key: kind,
      kind: kind as string,
      title: STAFF_KIND_COPY[kind].title,
      sub: STAFF_KIND_COPY[kind].sub,
      row: byKind.get(kind),
    })),
    ...extras.map(r => ({
      key: r.requirementId,
      kind: r.kind,
      title: r.title,
      sub: r.helpText,
      row: r,
    })),
  ];

  return (
    <>
      <div className="row-between" style={{ marginTop: 18, marginBottom: 6 }}>
        <h2>Paperwork</h2>
        {reqs.isPending && <span className="muted small">Loading…</span>}
      </div>
      <p className="muted small" style={{ marginBottom: 8 }}>
        Tick what you need from them. Nobody else on the crew is affected, and nothing here blocks
        them from the trip.
      </p>

      <div className="card">
        {rows.map(({ key, kind, title, sub, row }) => {
          const checked = !!row?.assignedStaffIds.includes(staffId);
          const spinning = busy.includes(key);
          const arrived = checked && row ? isFulfilled(done.data ?? new Set(), userId, row) : false;

          return (
            <CheckRow
              key={key}
              title={title}
              sub={sub}
              checked={checked}
              disabled={spinning}
              // `row` is passed explicitly rather than looked up by kind: a
              // `custom` ask is not unique by kind, so a lookup would toggle the
              // first custom row every time.
              onToggle={() => toggle.mutate({ key, kind, row })}
              right={
                spinning ? (
                  <span className="spinner" />
                ) : checked ? (
                  <span className={`tag ${arrived ? 'tag-ok' : 'tag-idle'}`}>
                    {arrived ? 'Sent' : 'Not sent'}
                  </span>
                ) : null
              }
            />
          );
        })}
      </div>

      {error && (
        <p className="small" style={{ color: 'var(--danger)', marginTop: 8 }}>
          {error}
        </p>
      )}
    </>
  );
}
