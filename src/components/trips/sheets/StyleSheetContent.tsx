// StyleSheetContent — multi-select 2x2 grid of board types using the real
// board images from the onboarding board selector. Bottom drop-shadow baked
// into each PNG is clipped via overflow:hidden.
import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { SurfStyle } from '../../../services/trips/groupTripsService';

const FONT_INTER = Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter';
const FONT_MONTSERRAT =
  Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat';

const C = {
  brandTeal: '#0788B0',
  brandTealTint: '#E6F4F8',
  brandTealText: '#066b8c',
  inkBody: '#222B30',
  textMuted: '#7B7B7B',
  borderDivider: '#E0E0E0',
  surfaceCard: '#FFFFFF',
};

type StyleKey = Extract<
  SurfStyle,
  'shortboard' | 'midlength' | 'softtop' | 'longboard'
>;

interface StyleMeta {
  key: StyleKey;
  label: string;
  imageUrl: string;
}

// URLs match OnboardingStep1Screen.tsx BOARD_TYPES.
const STYLES: readonly StyleMeta[] = [
  {
    key: 'shortboard',
    label: 'Shortboard',
    imageUrl:
      'https://api.builder.io/api/v1/image/assets/TEMP/9761796f6e2272f3cacf14c4fc9342525bb54ff8?width=371',
  },
  {
    key: 'midlength',
    label: 'Mid-length',
    imageUrl:
      'https://api.builder.io/api/v1/image/assets/TEMP/377f67727b21485479e873ed3d93c57611722f74?width=371',
  },
  {
    key: 'softtop',
    label: 'Soft top',
    imageUrl:
      'https://api.builder.io/api/v1/image/assets/TEMP/1d104557a7a5ea05c3b36931c1ee56fd01a6d426?width=371',
  },
  {
    key: 'longboard',
    label: 'Longboard',
    imageUrl:
      'https://api.builder.io/api/v1/image/assets/TEMP/4692a28e8ac444a82eec1f691f5f008c8a9bbc8e?width=371',
  },
];

export interface StyleSheetContentProps {
  selected: SurfStyle[];
  onChange: (next: SurfStyle[]) => void;
}

export const StyleSheetContent: React.FC<StyleSheetContentProps> = ({
  selected,
  onChange,
}) => {
  const toggle = useCallback(
    (key: StyleKey) => {
      const isSelected = selected.includes(key);
      const next = isSelected
        ? selected.filter(s => s !== key)
        : [...selected, key];
      onChange(next);
    },
    [selected, onChange],
  );

  return (
    <View style={styles.grid}>
      {STYLES.map(style => {
        const isSelected = selected.includes(style.key);
        return (
          <TouchableOpacity
            key={style.key}
            activeOpacity={0.85}
            onPress={() => toggle(style.key)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: isSelected }}
            accessibilityLabel={style.label}
            style={[styles.tile, isSelected && styles.tileSelected]}
          >
            <View style={styles.boardWrap}>
              <View style={styles.boardClip}>
                <Image
                  source={{ uri: style.imageUrl }}
                  style={styles.boardImage}
                  resizeMode="contain"
                />
              </View>
            </View>
            {isSelected ? (
              <View style={styles.checkBadge}>
                <Ionicons
                  name="checkmark-circle"
                  size={22}
                  color={C.brandTeal}
                />
              </View>
            ) : null}
            <Text
              style={[styles.label, isSelected && styles.labelSelected]}
              numberOfLines={1}
            >
              {style.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 12,
  },
  tile: {
    width: '48%',
    paddingTop: 18,
    paddingBottom: 14,
    paddingHorizontal: 10,
    borderRadius: 18,
    backgroundColor: C.surfaceCard,
    alignItems: 'center',
    justifyContent: 'flex-end',
    position: 'relative',
    minHeight: 280,
    // Soft elevation so the card reads as rounded + thick without a border.
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.10,
    shadowRadius: 12,
    elevation: 4,
    // 2pt transparent border so the inner content area doesn't shift when the
    // selected state adds a real 2pt teal border.
    borderWidth: 2,
    borderColor: 'transparent',
  },
  tileSelected: {
    borderColor: C.brandTeal,
    // Inside stays white — no tint fill.
  },
  // Container around the board image — fixed aspect so all 4 read consistent.
  boardWrap: {
    width: '100%',
    height: 220,
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginBottom: 10,
  },
  // Clip removes the baked-in bottom drop shadow on the PNG.
  boardClip: {
    width: '100%',
    height: '108%',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  boardImage: {
    width: '100%',
    height: '100%',
  },
  checkBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
  },
  label: {
    textAlign: 'center',
    fontFamily: FONT_MONTSERRAT,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
    color: C.inkBody,
  },
  labelSelected: {
    color: C.brandTealText,
  },
});

export default StyleSheetContent;
