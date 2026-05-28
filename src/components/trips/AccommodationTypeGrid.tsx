import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Reanimated, { FadeIn } from 'react-native-reanimated';

// --------------------------------------------------------------------------
// AccommodationTypeGrid — 2-column icon grid for the 9 accommodation kinds.
//
// Spec refs:
//   • docs/create-trip-redesign-spec.md §4.3.1 (Step 3 — accommodation type)
//   • docs/create-trip-redesign-spec.md §7.6 (component signature)
//   • docs/component-ux-research.md §9 (card-list selector survey)
//
// Tokens come straight from the redesign spec §2 — do NOT import theme.ts.
// --------------------------------------------------------------------------

const FONT_INTER = Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter';

// Design tokens (spec §2)
const C = {
  brandTeal: '#0788B0',
  brandTealTint: '#E6F4F8',
  brandTealText: '#066b8c',
  inkBody: '#222B30',
  textMuted: '#7B7B7B',
  borderField: '#CFCFCF',
  surfaceCard: '#FFFFFF',
  errorText: '#C0392B',
};

export type AccommodationKind =
  | 'villa'
  | 'hostel'
  | 'hotel'
  | 'surfcamp'
  | 'bungalow'
  | 'apartment'
  | 'guesthouse'
  | 'ecolodge'
  | 'other';

interface KindMeta {
  key: AccommodationKind;
  title: string;
  desc: string;
  // Verified against Ionicons glyphmap.
  icon: keyof typeof Ionicons.glyphMap;
}

// Titles + descriptions match the existing ACCOMMODATION_KINDS constant in
// CreateTripFlowA.tsx, kept in sync with spec §6 microcopy.
const KINDS: readonly KindMeta[] = [
  { key: 'villa',      title: 'Villa',      desc: 'Shared house with private rooms',  icon: 'home-outline' },
  { key: 'hostel',     title: 'Hostel',     desc: 'Budget-friendly, social vibe',     icon: 'bed-outline' },
  { key: 'hotel',      title: 'Hotel',      desc: 'Private rooms, more comfort',      icon: 'business-outline' },
  { key: 'surfcamp',   title: 'Surf camp',  desc: 'Surf-focused, all-in package',     icon: 'water-outline' },
  { key: 'bungalow',   title: 'Bungalow',   desc: 'Standalone, close to the beach',   icon: 'leaf-outline' },
  { key: 'apartment',  title: 'Apartment',  desc: 'Self-catering, your own space',    icon: 'grid-outline' },
  { key: 'guesthouse', title: 'Guesthouse', desc: 'Homey, locally run',               icon: 'heart-outline' },
  { key: 'ecolodge',   title: 'Eco lodge',  desc: 'Off-grid, nature-immersed',        icon: 'flower-outline' },
  { key: 'other',      title: 'Other',      desc: 'Something else',                   icon: 'ellipsis-horizontal-outline' },
];

export interface AccommodationTypeGridProps {
  selected: AccommodationKind | null;
  onChange: (kind: AccommodationKind) => void;
  /** Inline error rendered below the grid. */
  error?: string;
}

export const AccommodationTypeGrid: React.FC<AccommodationTypeGridProps> = ({
  selected,
  onChange,
  error,
}) => {
  const selectedMeta = useMemo<KindMeta | null>(
    () => (selected ? KINDS.find(k => k.key === selected) ?? null : null),
    [selected],
  );

  return (
    <View>
      <View style={styles.grid}>
        {KINDS.map(k => {
          const isSelected = selected === k.key;
          return (
            <TouchableOpacity
              key={k.key}
              activeOpacity={0.85}
              onPress={() => onChange(k.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={k.title}
              style={[styles.tile, isSelected && styles.tileSelected]}
            >
              <Ionicons
                name={k.icon}
                size={28}
                color={isSelected ? C.brandTeal : C.textMuted}
              />
              <Text style={[styles.tileLabel, isSelected && styles.tileLabelSelected]}>
                {k.title}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {selectedMeta ? (
        <Reanimated.View
          key={selectedMeta.key}
          entering={FadeIn.duration(200)}
          style={styles.descPanel}
        >
          <Text style={styles.descTitle}>{selectedMeta.title}</Text>
          <Text style={styles.descBody}>{selectedMeta.desc}</Text>
        </Reanimated.View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  tile: {
    width: '48%',
    aspectRatio: 1.7,
    marginBottom: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.borderField,
    backgroundColor: C.surfaceCard,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
  },
  tileSelected: {
    borderWidth: 2,
    borderColor: C.brandTeal,
    backgroundColor: C.brandTealTint,
  },
  tileLabel: {
    marginTop: 8,
    fontFamily: FONT_INTER,
    fontSize: 14,
    fontWeight: '600',
    color: C.inkBody,
    textAlign: 'center',
  },
  tileLabelSelected: {
    color: C.brandTealText,
  },
  descPanel: {
    marginTop: 16,
    padding: 12,
    backgroundColor: C.brandTealTint,
    borderRadius: 12,
  },
  descTitle: {
    fontFamily: FONT_INTER,
    fontSize: 14,
    fontWeight: '700',
    color: C.brandTealText,
    marginBottom: 2,
  },
  descBody: {
    fontFamily: FONT_INTER,
    fontSize: 13,
    lineHeight: 18,
    color: C.inkBody,
  },
  error: {
    marginTop: 8,
    fontFamily: FONT_INTER,
    fontSize: 12,
    fontWeight: '500',
    color: C.errorText,
  },
});

export default AccommodationTypeGrid;
