/**
 * "What do I need from this person?" — the crew paperwork checklist.
 *
 * Spec: docs/staff-requirements-and-wallet-delivery-spec-and-plan.html, Part A.
 *
 * Two exports, one list:
 *   • StaffPaperworkPicker  — a step in the invite flow. Nothing is written;
 *     the ticked kinds ride out on the invite and land when it is accepted,
 *     because an invited person has no staff row to assign anything to yet.
 *   • StaffPaperworkSection — the same list on a member who is already crew.
 *     Each tick writes immediately.
 *
 * ── Why the tick is a KIND and not a requirement row ───────────────────────
 * The first version listed the trip's staff-audience requirements and nothing
 * else, so a trip that had never made one showed an empty box telling the
 * operator to go and make one somewhere else. Nobody was ever going to. The
 * list is now the catalog — Passport, Visa, Waiver… — and ticking one creates
 * the requirement row if the trip has none. See ensureStaffRequirements.
 *
 * ── Two things it deliberately does not do ─────────────────────────────────
 * No deadline, no overdue state. Staff paperwork is flagged, never gated: the
 * operator hired this person and knows the situation, and a countdown that
 * locks the guide out two days before departure is a worse outcome than the
 * missing certificate.
 *
 * And unticking never deletes the requirement row, only the assignment — the
 * document the person already sent stays where it is, and the other people
 * asked for the same thing are untouched.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ff } from '../../theme/fonts';
import {
  assignStaffRequirement,
  ensureStaffRequirements,
  fetchStaffPaperworkEvidence,
  listStaffRequirements,
  unassignStaffRequirement,
  STAFF_REQUIREMENT_KINDS,
  STAFF_KIND_COPY,
  type StaffEvidenceRow,
  type StaffRequirement,
  type StaffRequirementKind,
} from '../../services/trips/staffRequirementsService';

const ACCENT = '#05BCD3';
const INK = '#222B30';
const MUTED = '#7B7B7B';
const LINE = '#EEEEEE';

const KIND_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  passport: 'card-outline',
  visa: 'document-outline',
  waiver: 'document-text-outline',
  medical: 'medkit-outline',
  insurance: 'shield-checkmark-outline',
  flights: 'airplane-outline',
  custom: 'ellipsis-horizontal-circle-outline',
};

// Crew copy lives in the service, because it is also what gets written onto the
// requirement row when a tick creates one — the wording the operator ticked is
// the wording the crew member later reads.
const KIND_COPY = STAFF_KIND_COPY;

/** Everything the catalog can ask crew for. `custom` is absent: it needs a
 *  title typed by hand, which belongs in the trip's requirement editor, not in
 *  a tick list. Existing custom rows still show — see `extras` below. */
const OFFERED_KINDS = STAFF_REQUIREMENT_KINDS.filter(
  k => k !== 'custom',
) as StaffRequirementKind[];

// ---------------------------------------------------------------------------

const Row: React.FC<{
  kind: string;
  title: string;
  sub?: string | null;
  checked: boolean;
  busy?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}> = ({ kind, title, sub, checked, busy, disabled, onPress }) => (
  <Pressable
    onPress={disabled || busy ? undefined : onPress}
    disabled={disabled || busy}
    style={({ pressed }) => [
      styles.row,
      checked && styles.rowOn,
      pressed && !disabled && styles.pressed,
    ]}
    accessibilityRole="checkbox"
    accessibilityState={{ checked, disabled: !!disabled }}
    accessibilityLabel={title}
  >
    <View style={[styles.box, checked && styles.boxOn]}>
      {checked ? <Ionicons name="checkmark" size={13} color="#FFFFFF" /> : null}
    </View>
    <Ionicons
      name={KIND_ICON[kind] ?? 'document-outline'}
      size={17}
      color={checked ? INK : MUTED}
    />
    <View style={styles.rowText}>
      <Text style={styles.rowTitle}>{title}</Text>
      {sub ? <Text style={styles.rowHelp}>{sub}</Text> : null}
    </View>
    {busy ? <ActivityIndicator size="small" color={MUTED} /> : null}
  </Pressable>
);

const Heading: React.FC<{ blurb: string }> = ({ blurb }) => (
  <>
    <Text style={styles.label}>Paperwork</Text>
    <Text style={styles.blurb}>{blurb}</Text>
  </>
);

// ---------------------------------------------------------------------------
// Draft — the invite step. Writes nothing.
// ---------------------------------------------------------------------------

export const StaffPaperworkPicker: React.FC<{
  /** Kinds currently ticked. Owned by the caller, because the send button needs
   *  them and a selection that lives in here would be gone by then. */
  selected: StaffRequirementKind[];
  onChange: (next: StaffRequirementKind[]) => void;
}> = ({ selected, onChange }) => {
  const toggle = (kind: StaffRequirementKind) =>
    onChange(
      selected.includes(kind) ? selected.filter(k => k !== kind) : [...selected, kind],
    );

  return (
    <View style={styles.wrapPlain}>
      {/* No "Paperwork" label here — the invite step's own title already asks
          the question, and repeating it under the title reads as two headings
          for one list. */}
      <Text style={styles.blurb}>
        Tick what you need from them. It's asked as soon as they accept, and nobody else on
        the crew is affected. Leave it all off if you need nothing.
      </Text>
      {OFFERED_KINDS.map(kind => (
        <Row
          key={kind}
          kind={kind}
          title={KIND_COPY[kind]?.title ?? kind}
          sub={KIND_COPY[kind]?.sub}
          checked={selected.includes(kind)}
          onPress={() => toggle(kind)}
        />
      ))}
    </View>
  );
};

// ---------------------------------------------------------------------------
// Live — a member who is already crew. Every tick is a write.
// ---------------------------------------------------------------------------

export const StaffPaperworkSection: React.FC<{
  tripId: string;
  /** The `organized_trip_staff` row id. */
  staffId: string;
  /**
   * False for a Listed credit. Somebody with no account cannot upload
   * anything, so asking them for a passport is a task with no owner.
   */
  hasAccount: boolean;
  /** False hides every control and shows the list read-only. */
  canManage: boolean;
}> = ({ tripId, staffId, hasAccount, canManage }) => {
  const [requirements, setRequirements] = useState<StaffRequirement[]>([]);
  const [loading, setLoading] = useState(true);
  /** Kinds with a write in flight, so each row can spin alone. */
  const [busy, setBusy] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      setRequirements(await listStaffRequirements(tripId));
    } catch {
      // A paperwork list that fails to load must not take the staff sheet down
      // with it — the tier picker above still works, and that is the screen's
      // primary job.
      setRequirements([]);
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** kind → the trip's requirement row for it, if there is one. */
  const byKind = useMemo(() => {
    const map = new Map<string, StaffRequirement>();
    for (const r of requirements) if (!map.has(r.kind)) map.set(r.kind, r);
    return map;
  }, [requirements]);

  /** Rows the catalog does not offer — a `custom` ask typed in the trip's
   *  requirement editor. Shown so it can still be assigned from here. */
  const extras = useMemo(
    () => requirements.filter(r => !OFFERED_KINDS.includes(r.kind as StaffRequirementKind)),
    [requirements],
  );

  const isOn = (kind: string) => !!byKind.get(kind)?.assignedStaffIds.includes(staffId);

  /**
   * `row` is passed for an extra — a `custom` ask, where the kind is not a
   * unique key and looking it up would toggle the first custom row every time.
   * The catalog rows have no such ambiguity and look themselves up by kind.
   */
  const toggle = async (kind: string, row?: StaffRequirement) => {
    const current = row ?? byKind.get(kind);
    const assigned = !!current?.assignedStaffIds.includes(staffId);
    // Keyed the way the row that shows the spinner is keyed: catalog rows by
    // kind, extras by their requirement id.
    const busyKey = row ? row.requirementId : kind;
    setBusy(b => [...b, busyKey]);

    // Optimistic, but only when the row already exists — a first tick has to
    // create the requirement server-side before there is anything to show as
    // ticked, and inventing an id here to take back later reads worse than the
    // short spinner the row already has.
    if (current) {
      setRequirements(prev =>
        prev.map(r =>
          r.requirementId === current.requirementId
            ? {
                ...r,
                assignedStaffIds: assigned
                  ? r.assignedStaffIds.filter(id => id !== staffId)
                  : [...r.assignedStaffIds, staffId],
              }
            : r,
        ),
      );
    }

    try {
      if (assigned && current) {
        await unassignStaffRequirement(staffId, current.requirementId);
      } else {
        const [requirementId] = current
          ? [current.requirementId]
          : await ensureStaffRequirements(tripId, [kind as StaffRequirementKind]);
        await assignStaffRequirement({ tripId, staffId, requirementId });
        if (!current) await load();
      }
    } catch {
      await load();
    } finally {
      setBusy(b => b.filter(k => k !== busyKey));
    }
  };

  if (!hasAccount) return null;
  if (loading) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.label}>Paperwork</Text>
        <ActivityIndicator size="small" color={MUTED} style={styles.loader} />
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Heading
        blurb={
          canManage
            ? 'Tick what you need from this person. Everyone else on the crew is unaffected.'
            : 'What this person was asked for.'
        }
      />

      {OFFERED_KINDS.map(kind => (
        <Row
          key={kind}
          kind={kind}
          title={KIND_COPY[kind]?.title ?? kind}
          sub={KIND_COPY[kind]?.sub}
          checked={isOn(kind)}
          busy={busy.includes(kind)}
          disabled={!canManage}
          onPress={() => toggle(kind)}
        />
      ))}

      {extras.map(r => (
        <Row
          key={r.requirementId}
          kind={r.kind}
          title={r.title}
          sub={r.helpText}
          checked={r.assignedStaffIds.includes(staffId)}
          busy={busy.includes(r.requirementId)}
          disabled={!canManage}
          onPress={() => toggle(r.kind, r)}
        />
      ))}
    </View>
  );
};

// ---------------------------------------------------------------------------
// Received — what this person actually sent, for the operator to review.
// ---------------------------------------------------------------------------

/** State → the line under the title, and whether the row opens anything. */
const EVIDENCE_COPY: Record<
  StaffEvidenceRow['state'],
  { label: string; tone: 'muted' | 'accent' | 'done' }
> = {
  missing: { label: 'Not sent yet', tone: 'muted' },
  submitted: { label: 'In — tap to review', tone: 'accent' },
  approved: { label: 'Approved', tone: 'done' },
  agreed: { label: 'Agreed', tone: 'done' },
  filled: { label: 'Filled in', tone: 'done' },
};

/**
 * The operator's review list for ONE crew member — the missing half of the
 * loop. Ticks above ASK; this shows what ARRIVED, and hands an upload to the
 * caller's DocumentViewer to approve or send back. Until now the only place
 * to look at a crew member's paperwork was the web dashboard's Crew page.
 *
 * Renders nothing when nothing is assigned: the section above is where asking
 * starts, and an empty "Received" under an empty checklist is two ways of
 * saying nothing.
 */
export const StaffPaperworkReceived: React.FC<{
  tripId: string;
  staffId: string;
  /** Null for a Listed credit — no account, nothing can arrive. */
  userId: string | null;
  /** Bump after an approve/reject so the list re-reads. */
  reloadToken?: number;
  /** Only rows holding a file call this. */
  onOpenDocument: (row: StaffEvidenceRow) => void;
}> = ({ tripId, staffId, userId, reloadToken = 0, onOpenDocument }) => {
  const [rows, setRows] = useState<StaffEvidenceRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchStaffPaperworkEvidence({ tripId, staffId, userId });
        if (!cancelled) setRows(data);
      } catch {
        // Same rule as the checklist above: a failed read must not take the
        // staff sheet down. The ticks still work without this list.
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tripId, staffId, userId, reloadToken]);

  if (!userId || loading || rows.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Received</Text>
      <Text style={styles.blurb}>What they sent so far. Tap a document to review it.</Text>
      {rows.map(r => {
        const copy = EVIDENCE_COPY[r.state];
        const openable = !!r.storagePath && (r.state === 'submitted' || r.state === 'approved');
        return (
          <Pressable
            key={r.requirementId}
            style={styles.evidenceRow}
            disabled={!openable}
            onPress={() => onOpenDocument(r)}
            accessibilityRole={openable ? 'button' : undefined}
          >
            <Ionicons
              name={KIND_ICON[r.kind] ?? 'document-outline'}
              size={20}
              color={copy.tone === 'muted' ? MUTED : INK}
            />
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{r.title}</Text>
              <Text
                style={[
                  styles.evidenceState,
                  copy.tone === 'accent' && styles.evidenceAccent,
                  copy.tone === 'done' && styles.evidenceDone,
                ]}
              >
                {copy.label}
              </Text>
            </View>
            {openable && <Ionicons name="chevron-forward" size={16} color={MUTED} />}
          </Pressable>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { marginTop: 22, paddingTop: 18, borderTopWidth: 1, borderTopColor: LINE },
  wrapPlain: { marginTop: 2 },
  label: {
    fontFamily: ff('Inter', '600'),
    fontWeight: '600',
    fontSize: 13,
    color: INK,
    marginBottom: 4,
  },
  blurb: {
    fontFamily: ff('Inter', '400'),
    fontSize: 12.5,
    lineHeight: 18,
    color: MUTED,
    marginBottom: 10,
  },
  loader: { alignSelf: 'flex-start', marginTop: 8 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#EAECF0',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginBottom: 8,
  },
  rowOn: { borderColor: ACCENT, backgroundColor: '#F4FCFD' },
  pressed: { transform: [{ scale: 0.98 }] },
  box: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#D5D7DA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: ACCENT, borderColor: ACCENT },
  rowText: { flex: 1 },
  // Received rows: same card shape as the ticks above, minus the checkbox —
  // these are facts, not switches.
  evidenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#EAECF0',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginBottom: 8,
  },
  evidenceState: {
    fontFamily: ff('Inter', '400'),
    fontSize: 12,
    color: MUTED,
    marginTop: 1,
  },
  evidenceAccent: { color: ACCENT, fontFamily: ff('Inter', '600'), fontWeight: '600' },
  evidenceDone: { color: '#12805C' },
  rowTitle: {
    fontFamily: ff('Inter', '500'),
    fontWeight: '500',
    fontSize: 13.5,
    color: INK,
  },
  rowHelp: {
    fontFamily: ff('Inter', '400'),
    fontSize: 12,
    lineHeight: 16,
    color: MUTED,
    marginTop: 1,
  },
});

export default StaffPaperworkSection;
