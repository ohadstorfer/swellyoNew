import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Polyline, Line, Circle, Text as SvgText } from 'react-native-svg';

export interface RetentionPoint { day: number; active: number; eligible: number }
export interface RetentionData {
  buckets: number[]; // [0,1,3,7,14,30]
  joiners: RetentionPoint[];
  hosts: RetentionPoint[];
  totals: { joiners: number; hosts: number };
}

type Group = 'joiners' | 'hosts';

// Palette mirrors AnalyticsDashboardScreen (not exported there).
const C = {
  bg: '#F4F5F7', card: '#FFFFFF', text: '#222B30', textSecondary: '#7B7B7B',
  faint: '#AEB4BC', border: '#E5E7EB', divider: '#ECECEC', track: '#EEF0F2',
  accent: '#0788B0', accentSoft: '#E6F4F8',
};
const HOST = '#6639BA'; // host line color from the mockup

const CARD_SHADOW = Platform.select({
  ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8 },
  android: { elevation: 2 },
  default: {},
});

const CHART_H = 200;
const PAD = { top: 10, right: 10, bottom: 24, left: 38 };

function pctFor(p: RetentionPoint | undefined): number | null {
  if (!p || p.eligible <= 0) return null;
  return (p.active / p.eligible) * 100;
}

function GroupToggle({ value, onChange }: { value: Group; onChange: (g: Group) => void }) {
  return (
    <View style={styles.toggle}>
      {(['joiners', 'hosts'] as Group[]).map(g => {
        const on = g === value;
        return (
          <TouchableOpacity
            key={g}
            style={[styles.togglePill, on && styles.togglePillOn]}
            activeOpacity={0.7}
            onPress={() => onChange(g)}
          >
            <Text style={[styles.toggleText, on && styles.toggleTextOn]}>
              {g === 'joiners' ? 'Joiners' : 'Hosts'}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function CurveChart({ data, group }: { data: RetentionData; group: Group }) {
  const [width, setWidth] = useState(0);
  const plotW = width - PAD.left - PAD.right;
  const plotH = CHART_H - PAD.top - PAD.bottom;
  const n = data.buckets.length;

  const xFor = (i: number) => PAD.left + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
  const yFor = (pct: number) => PAD.top + plotH - (pct / 100) * plotH;

  const pointsOf = (rows: RetentionPoint[]) =>
    data.buckets
      .map((b, i) => {
        const pct = pctFor(rows.find(r => r.day === b));
        return pct === null ? null : { x: xFor(i), y: yFor(pct) };
      })
      .filter((p): p is { x: number; y: number } => p !== null);

  const activeRows = group === 'joiners' ? data.joiners : data.hosts;
  const fadedRows = group === 'joiners' ? data.hosts : data.joiners;
  const activeColor = group === 'joiners' ? C.accent : HOST;
  const fadedColor = group === 'joiners' ? HOST : C.accent;
  const activePts = pointsOf(activeRows);
  const fadedPts = pointsOf(fadedRows);
  const toStr = (pts: { x: number; y: number }[]) => pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  return (
    <View style={{ height: CHART_H, width: '100%' }} onLayout={e => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 && (
        <Svg width={width} height={CHART_H}>
          {[0, 25, 50, 75, 100].map(pct => (
            <Line key={pct} x1={PAD.left} y1={yFor(pct)} x2={width - PAD.right} y2={yFor(pct)} stroke={C.track} strokeWidth={1} />
          ))}
          {[0, 25, 50, 75, 100].map(pct => (
            <SvgText key={pct} x={PAD.left - 6} y={yFor(pct) + 3.5} fontSize={10} fill={C.textSecondary} textAnchor="end">
              {`${pct}%`}
            </SvgText>
          ))}
          {data.buckets.map((b, i) => (
            <SvgText key={b} x={xFor(i)} y={CHART_H - 8} fontSize={10.5} fill={C.textSecondary} textAnchor="middle">
              {`D${b}`}
            </SvgText>
          ))}
          {fadedPts.length > 1 && (
            <Polyline points={toStr(fadedPts)} fill="none" stroke={fadedColor} strokeWidth={2} strokeOpacity={0.32} strokeDasharray="4 4" strokeLinejoin="round" strokeLinecap="round" />
          )}
          {activePts.length > 1 && (
            <Polyline points={toStr(activePts)} fill="none" stroke={activeColor} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
          )}
          {activePts.map((p, i) => (
            <Circle key={i} cx={p.x} cy={p.y} r={3.5} fill={activeColor} />
          ))}
        </Svg>
      )}
    </View>
  );
}

export function RetentionCurveCard({ data }: { data: RetentionData }) {
  const [group, setGroup] = useState<Group>('joiners');
  const isEmpty = [...data.joiners, ...data.hosts].every(p => p.eligible <= 0);

  return (
    <View style={styles.sectionCard}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionIconWrap}>
          <Ionicons name="analytics-outline" size={16} color={C.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.sectionTitle}>Trip retention</Text>
          <Text style={styles.sectionSubtitle}>
            Of people who joined or created a trip — % still opening the app
          </Text>
        </View>
      </View>

      {isEmpty ? (
        <View style={styles.empty}>
          <Ionicons name="analytics-outline" size={20} color={C.faint} />
          <Text style={styles.emptyText}>No retention data in this range yet.</Text>
        </View>
      ) : (
        <>
          <GroupToggle value={group} onChange={setGroup} />
          <CurveChart data={data} group={group} />

          <View style={styles.legendRow}>
            <View style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: group === 'joiners' ? C.accent : HOST }]} />
              <Text style={styles.legendText}>{group === 'joiners' ? 'Joiners (shown)' : 'Hosts (shown)'}</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: group === 'joiners' ? HOST : C.accent, opacity: 0.4 }]} />
              <Text style={styles.legendText}>{group === 'joiners' ? 'Hosts (toggle)' : 'Joiners (toggle)'}</Text>
            </View>
          </View>

          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Text style={[styles.statBig, { color: C.accent }]}>{data.totals.joiners.toLocaleString()}</Text>
              <Text style={styles.statLabel}>JOINERS TOTAL</Text>
            </View>
            <View style={styles.stat}>
              <Text style={[styles.statBig, { color: HOST }]}>{data.totals.hosts.toLocaleString()}</Text>
              <Text style={styles.statLabel}>HOSTS TOTAL</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statBig}>{(data.totals.joiners + data.totals.hosts).toLocaleString()}</Text>
              <Text style={styles.statLabel}>EVERYONE</Text>
            </View>
          </View>

          <View style={styles.table}>
            <View style={styles.tableRow}>
              <Text style={[styles.tableHeadCell, styles.tableLabelCol]}>ACTIVE / ELIGIBLE</Text>
              {data.buckets.map(b => (
                <Text key={b} style={styles.tableHeadCell}>{`D${b}`}</Text>
              ))}
            </View>
            {(['joiners', 'hosts'] as Group[]).map(g => {
              const rows = g === 'joiners' ? data.joiners : data.hosts;
              return (
                <View key={g} style={[styles.tableRow, styles.tableRowDivider]}>
                  <View style={[styles.tableLabelCol, styles.tableLabelWrap]}>
                    <View style={[styles.legendDot, { backgroundColor: g === 'joiners' ? C.accent : HOST }]} />
                    <Text style={styles.tableLabel}>{g === 'joiners' ? 'Joiners' : 'Hosts'}</Text>
                  </View>
                  {data.buckets.map(b => {
                    const p = rows.find(r => r.day === b);
                    const pct = pctFor(p);
                    return (
                      <View key={b} style={styles.tableCell}>
                        <Text style={styles.tableCount}>{p ? `${p.active}/${p.eligible}` : '—'}</Text>
                        <Text style={styles.tablePct}>{pct === null ? '—' : `${pct.toFixed(0)}%`}</Text>
                      </View>
                    );
                  })}
                </View>
              );
            })}
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

  toggle: {
    flexDirection: 'row', alignSelf: 'flex-start', borderWidth: 1, borderColor: C.border,
    borderRadius: 9, overflow: 'hidden', marginBottom: 12,
  },
  togglePill: { paddingHorizontal: 14, paddingVertical: 6, backgroundColor: C.card },
  togglePillOn: { backgroundColor: C.accent },
  toggleText: { fontSize: 12.5, fontWeight: '600', color: C.textSecondary },
  toggleTextOn: { color: '#FFFFFF' },

  legendRow: { flexDirection: 'row', gap: 16, marginTop: 6, paddingLeft: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendSwatch: { width: 12, height: 3, borderRadius: 2 },
  legendText: { fontSize: 11.5, color: C.textSecondary },
  legendDot: { width: 9, height: 9, borderRadius: 5 },

  statsRow: { flexDirection: 'row', gap: 10, marginTop: 14, flexWrap: 'wrap' },
  stat: {
    flex: 1, minWidth: 90, backgroundColor: C.bg, borderRadius: 10,
    paddingVertical: 9, paddingHorizontal: 12, borderWidth: 1, borderColor: C.border,
  },
  statBig: { fontSize: 20, fontWeight: '800', color: C.text, letterSpacing: -0.3 },
  statLabel: { fontSize: 10, fontWeight: '700', color: C.textSecondary, letterSpacing: 0.4, marginTop: 2 },

  table: { marginTop: 14 },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  tableRowDivider: { borderTopWidth: 1, borderTopColor: C.divider },
  tableHeadCell: {
    flex: 1, fontSize: 10, fontWeight: '700', color: C.textSecondary,
    letterSpacing: 0.4, textAlign: 'center',
  },
  tableLabelCol: { flex: 1.6, textAlign: 'left' },
  tableLabelWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tableLabel: { fontSize: 12, fontWeight: '600', color: C.text },
  tableCell: { flex: 1, alignItems: 'center' },
  tableCount: { fontSize: 11.5, fontWeight: '700', color: C.text },
  tablePct: { fontSize: 10, color: C.textSecondary, marginTop: 1 },

  empty: {
    paddingVertical: 28, alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 12, backgroundColor: C.bg, marginTop: 4,
  },
  emptyText: { fontSize: 12.5, color: C.textSecondary, fontStyle: 'italic' },
});
