import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  deadlineStepBlocked,
  isDeadlineAtEnd,
  resolveDeadlineISO,
  stepDeadline,
  todayISO,
  type RequirementTiming,
} from '../domain/requirements';
import {
  DEFAULT_TIMING,
  REQUIREMENT_CATALOG,
  REQUIREMENT_ORDER,
  isEditableKind,
  isPayKind,
  type EditableKind,
} from '../domain/catalog';
import {
  fetchEditableRequirements,
  saveRequirementChanges,
  type EditableRequirement,
  type RequirementDraft,
} from '../services/requirements';
import { formatDate, plural } from '../lib/format';
import { ErrorBox } from './StateBits';

/**
 * Editing what a trip asks for, and when — inline, inside the Documents card.
 *
 * Spec: docs/specs/operator-trips/deadline-editing.md
 *
 * Inline rather than a dialog on purpose: the operator is already looking at
 * the list of requirements when they decide one is due too early, and sending
 * them to a modal to change it means reading the same list twice.
 *
 * Card-level save, not autosave per row. Changing a deadline moves it for
 * every traveler on the trip at once, and one of the things a save can do is
 * un-overdue four people. That deserves a deliberate press and a sentence
 * saying what will happen, which per-row autosave has nowhere to put.
 */

type Props = {
  tripId: string;
  startDateISO: string | null;
  /** 'managed' = Stripe collects, so the trip has pay rows to time. */
  paymentMode: string | null;
  /** Travelers currently overdue, per requirement KIND. Drives the confirm. */
  overdueByKind: Record<string, number>;
  onClose: () => void;
  /** Saved — the page refetches everything this touched. */
  onSaved: () => void;
};

export function RequirementsEditor(props: Props) {
  // Its own read, not the page's review query: that one drops `pay` rows and
  // filters to active, and an editor needs both. Refetched on mount so a
  // change made on someone's phone is not silently overwritten by a stale
  // cache — the diff is only as good as what it is diffed against.
  const rows = useQuery({
    queryKey: ['editable-reqs', props.tripId],
    queryFn: () => fetchEditableRequirements(props.tripId),
    // Fresh on the way in: the diff is only as good as what it is diffed
    // against, and saving against a stale cache silently undoes a change made
    // on someone's phone. `gcTime: 0` so leaving and re-entering edit mode
    // reads again rather than resurrecting the list from before the last save.
    refetchOnMount: 'always',
    gcTime: 0,
    // ⚠️ OFF, against the app-wide default in main.tsx. The draft below is
    // seeded from this data and keyed on `dataUpdatedAt`, so a background
    // refetch remounts the editor and throws away everything typed. With focus
    // refetching on, alt-tabbing to check a passport expiry date and coming
    // back would wipe four deadline edits with no message. Freshness is bought
    // once, on open, which is when it matters.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  if (rows.isError) {
    return <ErrorBox error={rows.error} onRetry={() => void rows.refetch()} />;
  }
  if (rows.isPending) return <p className="muted small">Loading what this trip asks for…</p>;

  // Keyed on the data so the draft is seeded once, from real rows, and reseeds
  // if the underlying list ever changes underneath.
  return <Editor key={rows.dataUpdatedAt} rows={rows.data} {...props} />;
}

function Editor({
  rows,
  tripId,
  startDateISO,
  paymentMode,
  overdueByKind,
  onClose,
  onSaved,
}: Props & { rows: EditableRequirement[] }) {
  const [on, setOn] = useState<EditableKind[]>(() =>
    rows
      .filter(r => r.isActive && isEditableKind(r.kind) && !isPayKind(r.kind))
      .map(r => r.kind as EditableKind),
  );

  const [timing, setTiming] = useState<Record<string, RequirementTiming>>(() => {
    const t: Record<string, RequirementTiming> = {};
    for (const k of REQUIREMENT_ORDER) {
      const row = rows.find(r => r.kind === k);
      t[k] = row
        ? { skippable: row.skippable, daysBefore: row.daysBefore }
        : { ...DEFAULT_TIMING[k] };
    }
    return t;
  });

  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Money rows are not toggled here. Turning collection off is a trip-level
  // decision, and deleting a pay row with payments against it would strand
  // ledger history pointing at nothing. `paymentMode === 'managed'` alone is
  // NOT enough: the wizard publishes `deposit` only when an amount was
  // entered, so gating on the mode would show a working Deposit row on a trip
  // that has no deposit and a Save that silently does nothing.
  const kinds = useMemo(
    () =>
      REQUIREMENT_ORDER.filter(
        k =>
          !isPayKind(k) ||
          (paymentMode === 'managed' && rows.some(r => r.kind === k && r.isActive)),
      ),
    [paymentMode, rows],
  );

  const docKinds = kinds.filter(k => !isPayKind(k));
  const payKinds = kinds.filter(k => isPayKind(k));
  const offKinds = docKinds.filter(k => !on.includes(k));

  const setKindTiming = (kind: EditableKind, patch: Partial<RequirementTiming>) => {
    setDirty(true);
    setTiming(prev => ({ ...prev, [kind]: { ...prev[kind], ...patch } }));
  };

  const toggle = (kind: EditableKind) => {
    setDirty(true);
    setOn(prev => (prev.includes(kind) ? prev.filter(k => k !== kind) : [...prev, kind]));
  };

  /**
   * Which requirements would stop being overdue if this were saved.
   *
   * Overdue is DERIVED from the date — there is no stored flag — so pushing a
   * deadline later genuinely forgives the miss. That is usually what the
   * operator meant, but it must never be a surprise, so it is said out loud
   * before the write rather than discovered afterwards.
   *
   * Counts a deadline that MOVES LATER, or one that stops existing at all
   * (must_have carries no deadline, so nobody can be overdue on it).
   *
   * ⚠️ `count: null` on a MONEY row, and that is deliberate rather than lazy.
   * `overdueByKind` comes from the review query, which drops `pay` rows — this
   * site has no ledger UI — so there is no honest number to print for the
   * deposit or the final payment. The alternative was re-deriving pay-overdue
   * in the browser from amounts and events, which would be a second
   * implementation of `operator_requirement_pay_state` free to drift from the
   * one in SQL. A sentence without a number is worth more than a number that
   * might be wrong, so a money row is named only when its deadline has ALREADY
   * passed and is moving later — the only case where anyone can be forgiven.
   */
  const unOverdue = useMemo(() => {
    const today = todayISO();
    const out: { kind: EditableKind; count: number | null }[] = [];
    for (const kind of kinds) {
      const row = rows.find(r => r.kind === kind && r.isActive);
      if (!row || !row.skippable) continue;

      const before = resolveDeadlineISO(startDateISO, row.daysBefore);
      if (!before) continue;

      const next = timing[kind];
      const stillOn = isPayKind(kind) || on.includes(kind);
      const after =
        stillOn && next.skippable ? resolveDeadlineISO(startDateISO, next.daysBefore) : null;
      const movesLater = after === null || after > before;
      if (!movesLater) continue;

      if (isPayKind(kind)) {
        if (before < today) out.push({ kind, count: null });
        continue;
      }
      const count = overdueByKind[kind] ?? 0;
      if (count > 0) out.push({ kind, count });
    }
    return out;
  }, [kinds, overdueByKind, rows, startDateISO, timing, on]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const draft: RequirementDraft[] = [
        ...on.map(kind => ({ kind, timing: timing[kind] })),
        // Pay rows never appear in the on/off list — they exist from publish
        // and only their timing is editable — so they are appended here.
        ...payKinds.map(kind => ({ kind, timing: timing[kind] })),
      ];
      await saveRequirementChanges(tripId, rows, draft);
      onSaved();
      onClose();
    } catch (e) {
      // Keep the draft. An edit the server refused is still the operator's
      // work, and clearing it makes them do it twice to read the message.
      setError(e instanceof Error ? e.message : 'Could not save these changes.');
      setConfirming(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {docKinds
        .filter(k => on.includes(k))
        .map(kind => (
          <TimingRow
            key={kind}
            kind={kind}
            timing={timing[kind]}
            startDateISO={startDateISO}
            onChange={patch => setKindTiming(kind, patch)}
            onRemove={() => toggle(kind)}
          />
        ))}

      {payKinds.length > 0 && (
        <>
          <p className="req-group">Payments</p>
          {payKinds.map(kind => (
            <TimingRow
              key={kind}
              kind={kind}
              timing={timing[kind]}
              startDateISO={startDateISO}
              onChange={patch => setKindTiming(kind, patch)}
            />
          ))}
        </>
      )}

      {offKinds.length > 0 && (
        <>
          <p className="req-group">Not asked for</p>
          {offKinds.map(kind => (
            <div key={kind} className="req-off">
              <div>
                <strong className="small">{REQUIREMENT_CATALOG[kind].operatorTitle}</strong>
                <p className="muted small">{REQUIREMENT_CATALOG[kind].operatorSub}</p>
              </div>
              <button className="btn btn-sm" onClick={() => toggle(kind)}>
                Add
              </button>
            </div>
          ))}
        </>
      )}

      {error && (
        <p className="small" style={{ color: 'var(--danger)', marginTop: 12 }}>
          {error}
        </p>
      )}

      {/* The save bar. Only once something changed — a permanent bar reads as
          an unfinished form on a page the operator came to read. */}
      {dirty ? (
        <div className="savebar">
          <span className="muted small">Not saved yet</span>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-sm" onClick={onClose} disabled={saving}>
              Discard
            </button>
            <button
              className="btn btn-sm btn-primary"
              disabled={saving}
              onClick={() => (unOverdue.length > 0 ? setConfirming(true) : void save())}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      ) : (
        <div className="savebar">
          <span className="muted small">
            Deadlines move for everyone on this trip. Travelers are not notified.
          </span>
          <button className="btn btn-sm" onClick={onClose}>
            Done
          </button>
        </div>
      )}

      {confirming && (
        <div
          className="scrim"
          onClick={() => setConfirming(false)}
          role="dialog"
          aria-modal="true"
        >
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="card-head">
              <strong>Save these changes?</strong>
            </div>
            <div className="card-body">
              {unOverdue.map(u => (
                <p key={u.kind} className="small" style={{ marginBottom: 6 }}>
                  {u.count === null ? (
                    <>
                      <strong>{REQUIREMENT_CATALOG[u.kind].operatorTitle}</strong> was already
                      past its date. Anyone late on it stops being late.
                    </>
                  ) : (
                    <>
                      {plural(u.count, 'traveler')} {u.count === 1 ? 'stops' : 'stop'} being
                      overdue on <strong>{REQUIREMENT_CATALOG[u.kind].operatorTitle}</strong>.
                    </>
                  )}
                </p>
              ))}
              <p className="muted small" style={{ marginTop: 10 }}>
                Nobody is notified. They will see the new date next time they open the trip.
              </p>
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
              <button
                className="btn btn-sm"
                onClick={() => setConfirming(false)}
                disabled={saving}
              >
                Cancel
              </button>
              <button className="btn btn-sm btn-primary" onClick={() => void save()} disabled={saving}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** One requirement's timing: the two pills, and the stepper when it is
 *  skippable. `onRemove` is absent on a pay row — those are created at publish
 *  and may only be re-timed here. */
function TimingRow({
  kind,
  timing,
  startDateISO,
  onChange,
  onRemove,
}: {
  kind: EditableKind;
  timing: RequirementTiming;
  startDateISO: string | null;
  onChange: (patch: Partial<RequirementTiming>) => void;
  onRemove?: () => void;
}) {
  const c = REQUIREMENT_CATALOG[kind];
  const dueISO = timing.skippable ? resolveDeadlineISO(startDateISO, timing.daysBefore) : null;

  // ⚠️ PLUS MEANS EARLIER. The scale is days BEFORE departure, so it runs
  // backwards against the calendar and this is the only button that can walk a
  // deadline off the back of today. The minus button carries no such guard —
  // reducing days-before moves the date later, which is how a deadline that is
  // already in the past gets dragged back into the future.
  const plusBlocked =
    isDeadlineAtEnd(timing.daysBefore, 1) ||
    deadlineStepBlocked(timing.daysBefore, 1, startDateISO);
  const minusBlocked = isDeadlineAtEnd(timing.daysBefore, -1);

  return (
    <div className="req-edit">
      <div className="row-between" style={{ alignItems: 'flex-start', gap: 12 }}>
        <div>
          <strong className="small">{c.operatorTitle}</strong>
          <p className="muted small">{c.operatorSub}</p>
        </div>
        {onRemove && (
          <button className="btn btn-sm btn-ghost" onClick={onRemove}>
            Remove
          </button>
        )}
      </div>

      <div className="seg" role="group" aria-label={`${c.operatorTitle} timing`}>
        <button
          className="seg-btn"
          aria-pressed={!timing.skippable}
          onClick={() => onChange({ skippable: false })}
        >
          When they join
        </button>
        <button
          className="seg-btn"
          aria-pressed={timing.skippable}
          onClick={() => onChange({ skippable: true })}
        >
          They can skip
        </button>
      </div>

      {timing.skippable ? (
        <div className="stepper">
          <button
            className="stepper-btn"
            aria-label="Later"
            disabled={minusBlocked}
            onClick={() => onChange({ daysBefore: stepDeadline(timing.daysBefore, -1) })}
          >
            −
          </button>
          <div className="stepper-label">
            <span>
              {timing.daysBefore === 1
                ? '1 day before the trip'
                : `${timing.daysBefore} days before the trip`}
            </span>
            <span className="muted small">
              {dueISO ? formatDate(dueISO) : 'Set exact dates to see the date'}
            </span>
          </div>
          <button
            className="stepper-btn"
            aria-label="Earlier"
            disabled={plusBlocked}
            onClick={() => onChange({ daysBefore: stepDeadline(timing.daysBefore, 1) })}
          >
            +
          </button>
        </div>
      ) : (
        <p className="muted small">No Skip button — they cannot join without it.</p>
      )}
    </div>
  );
}
