import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export interface AdoptionFeature {
  key: string; // event_name like 'trip_chat_opened'
  joiners: { used: number; denom: number };
  hosts: { used: number; denom: number };
}

type Group = 'joiners' | 'hosts';

// Palette mirrors AnalyticsDashboardScreen (not exported there).
const C = {
  bg: '#F4F5F7', card: '#FFFFFF', text: '#222B30', textSecondary: '#7B7B7B',
  faint: '#AEB4BC', border: '#E5E7EB', divider: '#ECECEC', track: '#EEF0F2',
  accent: '#0788B0', accentSoft: '#E6F4F8',
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
              <View key={r.key} style={styles.barRow}>
                <Text style={[styles.barLabel, dim && styles.dimText]} numberOfLines={2}>
                  {labelFor(r.key)}
                </Text>
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
              </View>
            );
          })}
        </View>
      )}
    </View>
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
  barLabel: { width: 110, fontSize: 12, fontWeight: '600', color: C.text, lineHeight: 15 },
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
});
