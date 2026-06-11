import React from 'react';
import { View, Text, StyleSheet, ScrollView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export interface HealthTrip {
  trip_id: string;
  title: string | null;
  crew: number;
  created_at: string;
  days: { day: number; active: number | null }[]; // null = future day
  tag: 'alive' | 'cooling' | 'dead' | 'completed';
  last7_active: number;
}

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

const CELL_W = 44;
const CELL_H = 38;
const TRIP_COL_W = 124;
const TAG_COL_W = 92;
const HEAT_TEXT = '#13363B';
const ZERO_TEXT = '#A9B6B8';
const ZERO_BG = '#F4F7F7';

const TAG_STYLES: Record<HealthTrip['tag'], { bg: string; fg: string; label: string }> = {
  alive: { bg: '#1A7F3718', fg: '#1A7F37', label: 'Alive' },
  cooling: { bg: '#9A670020', fg: '#9A6700', label: 'Cooling' },
  dead: { bg: '#CF222E18', fg: '#CF222E', label: 'Dead' },
  completed: { bg: '#EEF2F3', fg: '#6C7D81', label: 'Completed' },
};

const TAG_ORDER: Record<HealthTrip['tag'], number> = { alive: 0, cooling: 1, dead: 2, completed: 3 };

function truncate(title: string | null): string {
  const t = title?.trim() || 'Untitled trip';
  return t.length > 14 ? `${t.slice(0, 14)}…` : t;
}

function HeatCell({ active, crew }: { active: number | null; crew: number }) {
  if (active === null) {
    return (
      <View style={[styles.cell, styles.cellFuture]}>
        <Text style={styles.cellFutureDash}>–</Text>
      </View>
    );
  }
  const pct = crew > 0 ? Math.round((active / crew) * 100) : 0;
  if (pct <= 0) {
    return (
      <View style={[styles.cell, { backgroundColor: ZERO_BG }]}>
        <Text style={[styles.cellPct, { color: ZERO_TEXT }]}>0</Text>
        <Text style={[styles.cellCount, { color: ZERO_TEXT }]}>{`0/${crew}`}</Text>
      </View>
    );
  }
  // Opacity ramp on the accent color: stronger = more of the crew showed up.
  const alpha = Math.min(pct, 100) / 100;
  return (
    <View style={[styles.cell, { backgroundColor: `rgba(7,136,176,${alpha.toFixed(2)})` }]}>
      <Text style={[styles.cellPct, alpha > 0.6 && { color: '#FFFFFF' }]}>{pct}</Text>
      <Text style={[styles.cellCount, alpha > 0.6 && { color: 'rgba(255,255,255,0.85)' }]}>
        {`${active}/${crew}`}
      </Text>
    </View>
  );
}

export function TripHealthCard({ buckets, trips }: { buckets: number[]; trips: HealthTrip[] }) {
  const sorted = [...trips].sort(
    (a, b) => TAG_ORDER[a.tag] - TAG_ORDER[b.tag] || b.last7_active - a.last7_active
  );

  return (
    <View style={styles.sectionCard}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionIconWrap}>
          <Ionicons name="pulse-outline" size={16} color={C.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.sectionTitle}>Trip health</Text>
          <Text style={styles.sectionSubtitle}>
            % of each crew active per day — sorted alive → dead
          </Text>
        </View>
      </View>

      {sorted.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="pulse-outline" size={20} color={C.faint} />
          <Text style={styles.emptyText}>No active trips in this range yet.</Text>
        </View>
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View>
              <View style={styles.gridRow}>
                <Text style={[styles.headCell, styles.tripCol, { textAlign: 'left' }]}>TRIP · CREW</Text>
                {buckets.map(b => (
                  <Text key={b} style={[styles.headCell, { width: CELL_W }]}>{`D${b}`}</Text>
                ))}
                <Text style={[styles.headCell, { width: TAG_COL_W }]}>HEALTH</Text>
              </View>

              {sorted.map(trip => {
                const tag = TAG_STYLES[trip.tag];
                return (
                  <View key={trip.trip_id} style={styles.gridRow}>
                    <View style={styles.tripCol}>
                      <Text style={styles.tripTitle} numberOfLines={1}>{truncate(trip.title)}</Text>
                      <Text style={styles.tripCrew}>{`crew ${trip.crew}`}</Text>
                    </View>
                    {buckets.map(b => {
                      const d = trip.days.find(x => x.day === b);
                      return <HeatCell key={b} active={d ? d.active : null} crew={trip.crew} />;
                    })}
                    <View style={[styles.tagCol, { width: TAG_COL_W }]}>
                      <View style={[styles.tagPill, { backgroundColor: tag.bg }]}>
                        <Text style={[styles.tagText, { color: tag.fg }]}>{tag.label}</Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          </ScrollView>

          <View style={styles.legendRow}>
            <Text style={styles.legendText}>less active</Text>
            <View style={styles.ramp}>
              {[0.06, 0.2, 0.35, 0.5, 0.65, 0.8, 1].map(a => (
                <View key={a} style={[styles.rampStep, { backgroundColor: `rgba(7,136,176,${a})` }]} />
              ))}
            </View>
            <Text style={styles.legendText}>more active</Text>
            <Text style={[styles.legendText, { marginLeft: 'auto' }]}>% of crew active that day</Text>
          </View>
        </>
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

  gridRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 3 },
  headCell: {
    fontSize: 10, fontWeight: '700', color: C.textSecondary,
    letterSpacing: 0.4, textAlign: 'center', paddingVertical: 3,
  },
  tripCol: { width: TRIP_COL_W, paddingRight: 8 },
  tripTitle: { fontSize: 12.5, fontWeight: '600', color: C.text },
  tripCrew: { fontSize: 10.5, color: C.textSecondary, marginTop: 1 },

  cell: {
    width: CELL_W, height: CELL_H, borderRadius: 5,
    alignItems: 'center', justifyContent: 'center',
  },
  cellPct: { fontSize: 11, fontWeight: '700', color: HEAT_TEXT, lineHeight: 13 },
  cellCount: { fontSize: 8.5, color: HEAT_TEXT, opacity: 0.7, lineHeight: 10 },
  cellFuture: { backgroundColor: C.bg, borderWidth: 1, borderColor: C.divider },
  cellFutureDash: { fontSize: 12, color: C.faint },

  tagCol: { alignItems: 'center' },
  tagPill: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 20 },
  tagText: { fontSize: 10.5, fontWeight: '700' },

  legendRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginTop: 12, flexWrap: 'wrap',
  },
  ramp: {
    flexDirection: 'row', borderRadius: 6, overflow: 'hidden',
    borderWidth: 1, borderColor: C.border,
  },
  rampStep: { width: 18, height: 11 },
  legendText: { fontSize: 11, color: C.textSecondary },

  empty: {
    paddingVertical: 28, alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 12, backgroundColor: C.bg, marginTop: 4,
  },
  emptyText: { fontSize: 12.5, color: C.textSecondary, fontStyle: 'italic' },
});
