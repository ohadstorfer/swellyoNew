// Overview / Plan segmented toggle — shared chrome on the trip detail screen.
// Active segment is a solid dark fill (Figma node 11274/11275). Only shown to
// members (host + approved); non-members never see it.

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';

const FONT_MONTSERRAT = Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat';

export type TripTab = 'overview' | 'plan';

interface Props {
  value: TripTab;
  onChange: (tab: TripTab) => void;
}

const TABS: { key: TripTab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'plan', label: 'Plan' },
];

export const TripTabToggle: React.FC<Props> = ({ value, onChange }) => (
  <View style={styles.container}>
    {TABS.map(tab => {
      const active = value === tab.key;
      return (
        <TouchableOpacity
          key={tab.key}
          style={[styles.segment, active && styles.segmentActive]}
          onPress={() => onChange(tab.key)}
          activeOpacity={0.8}
          accessibilityRole="tab"
          accessibilityState={{ selected: active }}
          accessibilityLabel={tab.label}
        >
          <Text style={[styles.label, active && styles.labelActive]}>{tab.label}</Text>
        </TouchableOpacity>
      );
    })}
  </View>
);

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#222B30',
    borderRadius: 10,
    overflow: 'hidden',
  },
  segment: {
    flex: 1,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  segmentActive: {
    backgroundColor: '#222B30',
  },
  label: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 15,
    fontWeight: '700',
    color: '#222B30',
  },
  labelActive: {
    color: '#FFFFFF',
  },
});

export default TripTabToggle;
