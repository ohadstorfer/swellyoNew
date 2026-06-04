// Shared multi-select option card for the Levels + Board Style sheets.
// Matches Figma node 12506:14912 — white card (radius 20, soft shadow), photo
// thumbnail (84×70) left, title + description, and a 20×20 checkbox on the
// right. Selected = cyan border + filled cyan check; unselected = grey ring.

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ImageSourcePropType,
  ImageResizeMode,
  Platform,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

const FONT_INTER = Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter';

const C = {
  surface: '#FFFFFF',
  accent: '#05BCD3',
  ink: '#333333',
  desc: '#555555',
  shadow: 'rgba(89, 110, 124, 0.15)',
  imagePlaceholder: '#F2F2F2',
  checkboxOffBg: '#F7F7F7',
  checkboxOffBorder: '#CFCFCF',
};

export interface SheetOptionCardProps {
  title: string;
  description: string;
  image: ImageSourcePropType;
  selected: boolean;
  onPress: () => void;
  /** 'cover' for photos (levels), 'contain' for board renders. Default 'cover'. */
  imageResizeMode?: ImageResizeMode;
  /** When false, the image sits on the card with no grey backing box (boards). */
  imageBackground?: boolean;
  /** Scale factor on the thumbnail (>1 zooms in, cropping via overflow). Default 1. */
  imageZoom?: number;
}

export const SheetOptionCard: React.FC<SheetOptionCardProps> = ({
  title,
  description,
  image,
  selected,
  onPress,
  imageResizeMode = 'cover',
  imageBackground = true,
  imageZoom = 1,
}) => {
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={title}
      style={[styles.card, selected && styles.cardSelected]}
    >
      <View style={[styles.imageWrap, !imageBackground && styles.imageWrapPlain]}>
        <Image
          source={image}
          style={[styles.image, imageZoom !== 1 && { transform: [{ scale: imageZoom }] }]}
          resizeMode={imageResizeMode}
        />
      </View>

      <View style={styles.textCol}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.desc} numberOfLines={2}>
          {description}
        </Text>
      </View>

      <View style={[styles.checkbox, selected ? styles.checkboxOn : styles.checkboxOff]}>
        {selected ? (
          <MaterialCommunityIcons name="check-bold" size={15} color="#FFFFFF" />
        ) : null}
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    minHeight: 112,
    padding: 14,
    backgroundColor: C.surface,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: 'transparent', // reserves space so selected border adds no shift
    shadowColor: '#596E7C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  cardSelected: {
    borderColor: C.accent,
  },
  imageWrap: {
    width: 84,
    height: 84,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: C.imagePlaceholder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Boards sit directly on the card — no grey backing box.
  imageWrapPlain: {
    backgroundColor: 'transparent',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  textCol: {
    flex: 1,
    gap: 5,
  },
  title: {
    fontFamily: FONT_INTER,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '700',
    color: C.ink,
  },
  desc: {
    fontFamily: FONT_INTER,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '400',
    color: C.desc,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: {
    backgroundColor: C.accent,
  },
  checkboxOff: {
    backgroundColor: C.checkboxOffBg,
    borderWidth: 1,
    borderColor: C.checkboxOffBorder,
  },
});

export default SheetOptionCard;
