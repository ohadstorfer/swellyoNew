// Overview / Plan tabs — shared chrome on the trip detail screen. Underline
// style (Figma node 12557-4992): the active tab is bold with an accent
// underline, the inactive tab is regular with a hairline underline. Only shown
// to members (host + approved); non-members never see it.

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';

const FONT_INTER = Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter';

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
  // Bleeds edge-to-edge out of the detail view's 16px gutter, like a tab bar.
  container: {
    flexDirection: 'row',
    marginTop: 12,
    marginHorizontal: -16,
    backgroundColor: '#FFFFFF',
  },
  segment: {
    flex: 1,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#EEEEEE',
  },
  segmentActive: {
    borderBottomWidth: 3,
    borderBottomColor: '#05BCD3',
  },
  label: {
    fontFamily: FONT_INTER,
    fontSize: 14,
    fontWeight: '400',
    color: '#333333',
  },
  labelActive: {
    fontSize: 18,
    fontWeight: '700',
  },
});

export default TripTabToggle;
