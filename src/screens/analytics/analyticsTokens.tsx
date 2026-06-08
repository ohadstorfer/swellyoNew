import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Polyline } from 'react-native-svg';

export const TILE_W = (Dimensions.get('window').width - 32 - 10) / 2;
export const HIT = { top: 10, bottom: 10, left: 10, right: 10 };

export const C = {
  bg: '#F4F5F7', card: '#FFFFFF', text: '#222B30', textSecondary: '#7B7B7B',
  label: '#4A5565', faint: '#AEB4BC', border: '#E5E7EB', divider: '#ECECEC',
  track: '#EEF0F2', accent: '#0788B0', accentSoft: '#E6F4F8', accentBg: '#F0F8FB',
  up: '#1B9E5A', upSoft: '#E7F6EE', down: '#C0392B', downSoft: '#FBE9E7',
  backdrop: 'rgba(0,0,0,0.45)',
};

export const CARD_SHADOW = Platform.select({
  ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8 },
  android: { elevation: 2 },
  default: {},
});

export type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

export interface Counter { total: number; prev: number; series: number[] }

export function deltaPct(total: number, prev: number): { value: number; up: boolean; flat: boolean } | null {
  if (prev <= 0) return null;
  const v = ((total - prev) / prev) * 100;
  return { value: Math.abs(v), up: v >= 0, flat: Math.abs(v) < 0.1 };
}

export function Sparkline({ data, height }: { data: number[]; height: number }) {
  const [width, setWidth] = useState(0);
  if (!data || data.length === 0) return <View style={{ height }} />;
  const max = Math.max(...data), min = Math.min(...data);
  const range = Math.max(max - min, 1);
  const stepX = data.length > 1 && width > 0 ? width / (data.length - 1) : 0;
  const padY = 3, usableH = height - padY * 2;
  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = padY + usableH - ((v - min) / range) * usableH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <View style={{ height, width: '100%' }} onLayout={e => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 && (
        <Svg width={width} height={height}>
          <Polyline points={points} fill="none" stroke={C.accent} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
        </Svg>
      )}
    </View>
  );
}

export function DeltaPill({ counter }: { counter: Counter }) {
  const delta = deltaPct(counter.total, counter.prev);
  const isEmpty = counter.total === 0 && counter.series.every(v => v === 0);
  if (!delta) {
    return <Text style={styles.deltaPlaceholder}>{isEmpty ? 'No events yet' : 'No prior data'}</Text>;
  }
  return (
    <View style={[styles.deltaPill, delta.up ? styles.deltaPillUp : styles.deltaPillDown]}>
      <Text style={[styles.deltaText, delta.up ? styles.deltaUp : styles.deltaDown]}>
        {delta.flat ? '— flat' : `${delta.up ? '▲' : '▼'} ${delta.value.toFixed(0)}%`}
      </Text>
    </View>
  );
}

export function StatTile({ label, icon, counter, eventKey, onInfo }: {
  label: string; icon: IoniconName; counter: Counter; eventKey: string; onInfo: (e: string) => void;
}) {
  const isEmpty = counter.total === 0 && counter.series.every(v => v === 0);
  return (
    <TouchableOpacity style={styles.tile} activeOpacity={0.7} onPress={() => onInfo(eventKey)}>
      <View style={styles.tileHeader}>
        <View style={styles.tileIconWrap}><Ionicons name={icon} size={15} color={C.accent} /></View>
        <Ionicons name="information-circle-outline" size={15} color={C.faint} />
      </View>
      <Text style={styles.tileNumber} numberOfLines={1}>{counter.total.toLocaleString()}</Text>
      <Text style={styles.tileLabel} numberOfLines={2}>{label}</Text>
      <View style={styles.tileFooter}>
        <DeltaPill counter={counter} />
        {!isEmpty && <View style={styles.tileSpark}><Sparkline data={counter.series} height={22} /></View>}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  tile: { width: TILE_W, backgroundColor: C.card, borderRadius: 14, padding: 14, minHeight: 150, borderWidth: 1, borderColor: C.border, ...CARD_SHADOW },
  tileHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  tileIconWrap: { width: 28, height: 28, borderRadius: 8, backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center' },
  tileNumber: { fontSize: 28, fontWeight: '800', color: C.text, letterSpacing: -0.6 },
  tileLabel: { fontSize: 12, fontWeight: '600', color: C.textSecondary, lineHeight: 16, marginTop: 2, minHeight: 32 },
  tileFooter: { marginTop: 'auto', paddingTop: 8 },
  tileSpark: { marginTop: 8 },
  deltaPill: { alignSelf: 'flex-start', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  deltaPillUp: { backgroundColor: C.upSoft },
  deltaPillDown: { backgroundColor: C.downSoft },
  deltaText: { fontSize: 11, fontWeight: '700' },
  deltaUp: { color: C.up },
  deltaDown: { color: C.down },
  deltaPlaceholder: { fontSize: 10.5, fontWeight: '500', color: C.faint, fontStyle: 'italic' },
});
