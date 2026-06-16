import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheetShell } from '../BottomSheetShell';

export interface AdoptionFeature {
  key: string; // event_name like 'trip_chat_opened'
  joiners: { used: number; denom: number };
  hosts: { used: number; denom: number };
}

type Group = 'joiners' | 'hosts';

const { height: SCREEN_H } = Dimensions.get('window');
const HIT = { top: 10, bottom: 10, left: 10, right: 10 };

// Palette mirrors AnalyticsDashboardScreen (not exported there).
const C = {
  bg: '#F4F5F7', card: '#FFFFFF', text: '#222B30', textSecondary: '#7B7B7B',
  label: '#4A5565', faint: '#AEB4BC', border: '#E5E7EB', divider: '#ECECEC', track: '#EEF0F2',
  accent: '#0788B0', accentSoft: '#E6F4F8', backdrop: 'rgba(0,0,0,0.45)',
};

const CARD_SHADOW = Platform.select({
  ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8 },
  android: { elevation: 2 },
  default: {},
});

const FEATURE_LABELS: Record<string, string> = {
  trip_chat_opened: 'Opened trip chat',
  trip_commit: 'Commit',
  trip_gear_claim: 'Group gear "I\'ll bring it"',
  trip_personal_gear: 'Personal gear list',
  trip_gear_request: 'Suggested group gear',
  trip_invite_shared: 'Shared the trip',
  trip_admin_update: 'Admin updates',
  trip_gear_added: 'Added group gear',
  trip_gear_suggestion: 'Gear suggestions',
  trip_join_decision: 'Join request decisions',
};

// Plain-language "what it counts" / "when it's recorded" for each feature,
// mirroring the info sheets on the Overview tab.
const FEATURE_DEFINITIONS: Record<string, { what: string; when: string }> = {
  trip_chat_opened: {
    what: "How many people opened a trip's group chat at least once in the selected range. Each person is counted once per cohort.",
    when: 'When someone opens the trip chat screen (recorded at most once every 30 minutes per trip).',
  },
  trip_commit: {
    what: 'How many people took part in a commitment — a member committing to a trip, or a host responding to one.',
    when: 'When a member taps "Commit", or a host approves or declines a commitment request.',
  },
  trip_gear_claim: {
    what: 'How many people claimed (or un-claimed) a shared group-gear item with "I\'ll bring it".',
    when: 'When a member marks a group-gear item as theirs, or removes that claim.',
  },
  trip_personal_gear: {
    what: 'How many people edited their own personal packing list on a trip.',
    when: 'When a member adds, removes, or toggles an item on their personal gear list.',
  },
  trip_gear_request: {
    what: 'How many people suggested a group-gear item for the host to review — members suggesting, or hosts answering a suggestion.',
    when: 'When a member taps "Suggest item", or a host approves or declines a suggestion.',
  },
  trip_invite_shared: {
    what: 'How many people shared a trip invite at least once in the selected range.',
    when: 'When someone taps Share / invite on a trip.',
  },
  trip_admin_update: {
    what: 'How many hosts posted an update to their trip.',
    when: 'When a host posts an admin update on a trip.',
  },
  trip_gear_added: {
    what: 'How many hosts added or removed a shared group-gear item directly.',
    when: 'When a host adds a new group-gear item, or deletes one.',
  },
  trip_gear_suggestion: {
    what: 'How many hosts edited the suggested packing list for their trip.',
    when: 'When a host edits the host-suggested personal gear list.',
  },
  trip_join_decision: {
    what: 'How many hosts approved or declined a request to join their trip.',
    when: "When a host approves or declines someone's join request.",
  },
};

// Events only hosts can perform — hidden when viewing joiners.
const HOST_ONLY = new Set([
  'trip_admin_update',
  'trip_gear_added',
  'trip_gear_suggestion',
  'trip_join_decision',
]);

function labelFor(key: string): string {
  return FEATURE_LABELS[key] ?? key.replace(/^trip_/, '').replace(/_/g, ' ');
}

export function FeatureAdoptionCard({ features }: { features: AdoptionFeature[] }) {
  const [group, setGroup] = useState<Group>('joiners');
  const [infoKey, setInfoKey] = useState<string | null>(null);

  const rows = features
    .filter(f => group === 'hosts' || !HOST_ONLY.has(f.key))
    .map(f => {
      const g = group === 'joiners' ? f.joiners : f.hosts;
      const pct = g.denom > 0 ? (g.used / g.denom) * 100 : 0;
      return { key: f.key, used: g.used, denom: g.denom, pct };
    })
    .sort((a, b) => b.pct - a.pct);

  const isEmpty = rows.length === 0 || rows.every(r => r.denom === 0);

  return (
    <View style={styles.sectionCard}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionIconWrap}>
          <Ionicons name="bar-chart-outline" size={16} color={C.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.sectionTitle}>Feature adoption</Text>
          <Text style={styles.sectionSubtitle}>
            Who used each feature at least once in the selected range
          </Text>
        </View>
      </View>

      <View style={styles.toggle}>
        {(['joiners', 'hosts'] as Group[]).map(g => {
          const on = g === group;
          return (
            <TouchableOpacity
              key={g}
              style={[styles.togglePill, on && styles.togglePillOn]}
              activeOpacity={0.7}
              onPress={() => setGroup(g)}
            >
              <Text style={[styles.toggleText, on && styles.toggleTextOn]}>
                {g === 'joiners' ? 'Joiners' : 'Hosts'}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {isEmpty ? (
        <View style={styles.empty}>
          <Ionicons name="bar-chart-outline" size={20} color={C.faint} />
          <Text style={styles.emptyText}>No feature usage in this range yet.</Text>
        </View>
      ) : (
        <View style={styles.bars}>
          {rows.map((r, i) => {
            const dim = i === rows.length - 1 && rows.length > 1;
            return (
              <TouchableOpacity
                key={r.key}
                style={styles.barRow}
                activeOpacity={0.7}
                onPress={() => setInfoKey(r.key)}
                accessibilityRole="button"
                accessibilityLabel={`${labelFor(r.key)} — what this means`}
              >
                <View style={styles.labelCell}>
                  <Text style={[styles.barLabel, dim && styles.dimText]} numberOfLines={2}>
                    {labelFor(r.key)}
                  </Text>
                  <Ionicons
                    name="information-circle-outline"
                    size={13}
                    color={C.faint}
                    style={styles.infoDot}
                  />
                </View>
                <View style={styles.barTrack}>
                  <View
                    style={[
                      styles.barFill,
                      { width: `${Math.max(r.pct, r.used > 0 ? 2 : 0)}%` },
                      dim && styles.barFillDim,
                    ]}
                  />
                </View>
                <Text style={[styles.barValue, dim && styles.dimText]} numberOfLines={1}>
                  <Text style={styles.barPct}>{`${r.pct.toFixed(0)}%`}</Text>
                  <Text style={styles.barCount}>{` · ${r.used} of ${r.denom}`}</Text>
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      <FeatureInfoSheet featureKey={infoKey} onClose={() => setInfoKey(null)} />
    </View>
  );
}

// ============== Info sheet (mirrors the Overview tab) ==============

function FeatureInfoSheet({ featureKey, onClose }: { featureKey: string | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  // Keep the last key around so content doesn't blank out during slide-out.
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    if (featureKey) setShown(featureKey);
  }, [featureKey]);
  const def = shown ? FEATURE_DEFINITIONS[shown] : null;

  return (
    <BottomSheetShell visible={featureKey !== null} onClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.sheetHandle} />
        {shown && def && (
          <>
              <View style={styles.sheetHeader}>
                <View style={styles.infoHeaderLeft}>
                  <View style={styles.infoIconWrap}>
                    <Ionicons name="information-circle" size={20} color={C.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sheetTitle}>{labelFor(shown)}</Text>
                    <Text style={styles.infoEventName}>{shown}</Text>
                  </View>
                </View>
                <TouchableOpacity style={styles.sheetCloseBtn} onPress={onClose} hitSlop={HIT} activeOpacity={0.7}>
                  <Ionicons name="close" size={18} color={C.label} />
                </TouchableOpacity>
              </View>

              <View style={styles.sheetBody}>
                <Text style={styles.infoSectionLabel}>WHAT IT COUNTS</Text>
                <Text style={styles.infoText}>{def.what}</Text>

                <Text style={[styles.infoSectionLabel, { marginTop: 18 }]}>WHEN IT'S RECORDED</Text>
                <Text style={styles.infoText}>{def.when}</Text>
              </View>

              <View style={[styles.sheetFooter, { paddingBottom: insets.bottom + 14 }]}>
                <TouchableOpacity style={[styles.btnPrimary, { flex: 1 }]} onPress={onClose} activeOpacity={0.85}>
                  <Text style={styles.btnPrimaryText}>Got it</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
      </View>
    </BottomSheetShell>
  );
}

const styles = StyleSheet.create({
  sectionCard: {
    backgroundColor: C.card, borderRadius: 14, padding: 16, marginBottom: 16,
    borderWidth: 1, borderColor: C.border, ...CARD_SHADOW,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 14 },
  sectionIconWrap: {
    width: 32, height: 32, borderRadius: 9, backgroundColor: C.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: C.text },
  sectionSubtitle: { fontSize: 12, color: C.textSecondary, marginTop: 2 },

  toggle: {
    flexDirection: 'row', alignSelf: 'flex-start', borderWidth: 1, borderColor: C.border,
    borderRadius: 9, overflow: 'hidden', marginBottom: 14,
  },
  togglePill: { paddingHorizontal: 14, paddingVertical: 6, backgroundColor: C.card },
  togglePillOn: { backgroundColor: C.accent },
  toggleText: { fontSize: 12.5, fontWeight: '600', color: C.textSecondary },
  toggleTextOn: { color: '#FFFFFF' },

  bars: { gap: 13 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  labelCell: { width: 112, flexDirection: 'row', alignItems: 'center', gap: 3 },
  barLabel: { flexShrink: 1, fontSize: 12, fontWeight: '600', color: C.text, lineHeight: 15 },
  infoDot: { marginTop: Platform.OS === 'ios' ? 0.5 : 0, opacity: 0.9 },
  barTrack: { flex: 1, height: 14, backgroundColor: C.track, borderRadius: 7, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: C.accent, borderRadius: 7 },
  barFillDim: { backgroundColor: '#B9C8CB' },
  barValue: { width: 84, textAlign: 'right' },
  barPct: { fontSize: 12.5, fontWeight: '700', color: C.text },
  barCount: { fontSize: 10.5, fontWeight: '500', color: C.textSecondary },
  dimText: { opacity: 0.55 },

  empty: {
    paddingVertical: 28, alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 12, backgroundColor: C.bg, marginTop: 4,
  },
  emptyText: { fontSize: 12.5, color: C.textSecondary, fontStyle: 'italic' },

  // ----- Info sheet -----
  sheet: {
    backgroundColor: C.card,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: SCREEN_H * 0.9, paddingTop: 6,
  },
  sheetHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: '#D7DBE0', alignSelf: 'center', marginBottom: 6,
  },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 10, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: C.divider,
  },
  infoHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, paddingRight: 12 },
  infoIconWrap: {
    width: 38, height: 38, borderRadius: 10,
    backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center',
  },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: C.text },
  infoEventName: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11, color: C.faint, marginTop: 2,
  },
  sheetCloseBtn: {
    width: 30, height: 30, borderRadius: 8,
    borderWidth: 1, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
  },
  sheetBody: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 8 },
  infoSectionLabel: {
    fontSize: 10.5, fontWeight: '800',
    color: C.accent, letterSpacing: 0.8, marginBottom: 7,
  },
  infoText: { fontSize: 13.5, color: C.text, lineHeight: 20 },
  sheetFooter: {
    flexDirection: 'row', gap: 10,
    paddingHorizontal: 20, paddingTop: 14,
    borderTopWidth: 1, borderTopColor: C.divider,
  },
  btnPrimary: {
    backgroundColor: C.accent, paddingVertical: 15, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  btnPrimaryText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
});
