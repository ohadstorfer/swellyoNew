/**
 * "What do I need from this person?" — asked on the staff member who has to
 * answer it.
 *
 * Spec: docs/staff-requirements-and-wallet-delivery-spec-and-plan.html, Part A.
 *
 * ── Why it lives inside the member's screen ────────────────────────────────
 * "What is this person's role" and "what do I need from this person" are the
 * same question asked twice. Split across two screens, the second one is never
 * opened — so this sits directly under the tier picker, in `TripStaffSheet`.
 *
 * ── Two things it deliberately does not do ─────────────────────────────────
 * It shows no deadline and no overdue state. Staff paperwork is flagged, never
 * gated: the operator hired this person and knows the situation, and a
 * countdown that locks the guide out two days before departure is a worse
 * outcome than the missing certificate.
 *
 * And it is empty when the trip has no staff-audience requirements, rather than
 * inventing a default set. A crew list where everyone is asked for a passport
 * because that seemed sensible is exactly the list operators learn to ignore.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ff } from '../../theme/fonts';
import {
  assignStaffRequirement,
  listStaffRequirements,
  unassignStaffRequirement,
  type StaffRequirement,
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
  /** Requirement ids with a write in flight, so each row can spin alone. */
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

  const toggle = async (req: StaffRequirement) => {
    const assigned = req.assignedStaffIds.includes(staffId);
    setBusy(b => [...b, req.requirementId]);

    // Optimistic: a tick box that waits for a round trip before moving reads as
    // broken, and the reload below is the correction if the write failed.
    setRequirements(prev =>
      prev.map(r =>
        r.requirementId === req.requirementId
          ? {
              ...r,
              assignedStaffIds: assigned
                ? r.assignedStaffIds.filter(id => id !== staffId)
                : [...r.assignedStaffIds, staffId],
            }
          : r,
      ),
    );

    try {
      if (assigned) await unassignStaffRequirement(staffId, req.requirementId);
      else await assignStaffRequirement({ tripId, staffId, requirementId: req.requirementId });
    } catch {
      await load();
    } finally {
      setBusy(b => b.filter(id => id !== req.requirementId));
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
  if (!requirements.length) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.label}>Paperwork</Text>
        <Text style={styles.empty}>
          This trip asks nothing of its crew. Add a staff requirement on the trip to be able to
          ask for one here.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Paperwork</Text>
      <Text style={styles.blurb}>
        Tick what you need from this person. Everyone else on the crew is unaffected.
      </Text>

      {requirements.map(req => {
        const assigned = req.assignedStaffIds.includes(staffId);
        const working = busy.includes(req.requirementId);
        return (
          <Pressable
            key={req.requirementId}
            onPress={canManage && !working ? () => toggle(req) : undefined}
            disabled={!canManage || working}
            style={({ pressed }) => [
              styles.row,
              assigned && styles.rowOn,
              pressed && canManage && styles.pressed,
            ]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: assigned, disabled: !canManage }}
            accessibilityLabel={req.title}
          >
            <View style={[styles.box, assigned && styles.boxOn]}>
              {assigned ? <Ionicons name="checkmark" size={13} color="#FFFFFF" /> : null}
            </View>
            <Ionicons
              name={KIND_ICON[req.kind] ?? 'document-outline'}
              size={17}
              color={assigned ? INK : MUTED}
            />
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{req.title}</Text>
              {req.helpText ? <Text style={styles.rowHelp}>{req.helpText}</Text> : null}
            </View>
            {working ? <ActivityIndicator size="small" color={MUTED} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { marginTop: 22, paddingTop: 18, borderTopWidth: 1, borderTopColor: LINE },
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
  empty: {
    fontFamily: ff('Inter', '400'),
    fontSize: 12.5,
    lineHeight: 18,
    color: MUTED,
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
