// Progressive "Who is it for?" card for the Create-Trip audience step.
// Matches Figma node 12650:4012 — full-width horizontal card: photo thumbnail
// (84×70) on the left, title + body on the right, an action icon at the far right.
//
// Three states drive the audience step's strict-sequential flow:
//   • 'active'    — the next card to fill. Shows the description + a teal "+".
//   • 'completed' — already set. Shows selection chips + a "›" chevron. Re-editable.
//   • 'locked'    — not yet reachable. Dimmed to 25% opacity, not pressable.

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ImageSourcePropType,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const FONT_INTER = Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter';

const C = {
  surface: '#FFFFFF',
  ink: '#333333',
  chipBg: '#EEEEEE',
  chipBorder: '#EEEEEE',
  plus: '#05BCD3', // brand cyan — the "add" affordance
  chevron: '#333333',
  shadow: 'rgba(89, 110, 124, 0.15)',
  imagePlaceholder: '#F2F2F2',
};

export type AudienceCardStatus = 'active' | 'completed' | 'locked';

export interface AudienceCardProps {
  title: string;
  /** Shown in active / locked states (no selection yet). */
  description: string;
  /** Shown in the completed state — one pill per selection. */
  chips?: string[];
  image: ImageSourcePropType;
  status: AudienceCardStatus;
  onPress?: () => void;
  /** Zoom factor on the thumbnail (>1 crops in). Default 1. */
  imageZoom?: number;
}

export const AudienceCard: React.FC<AudienceCardProps> = ({
  title,
  description,
  chips,
  image,
  status,
  onPress,
  imageZoom = 1,
}) => {
  const locked = status === 'locked';
  const completed = status === 'completed';
  const Wrap: React.ComponentType<any> = onPress && !locked ? TouchableOpacity : View;

  return (
    <Wrap
      activeOpacity={0.85}
      onPress={locked ? undefined : onPress}
      disabled={locked}
      style={[styles.card, locked && styles.cardLocked]}
      accessibilityRole={onPress && !locked ? 'button' : undefined}
      accessibilityLabel={`${title}${completed && chips?.length ? `: ${chips.join(', ')}` : ''}`}
    >
      <View style={styles.imageWrap}>
        <Image
          source={image}
          style={[styles.image, imageZoom !== 1 && { transform: [{ scale: imageZoom }] }]}
          resizeMode="cover"
        />
      </View>

      <View style={styles.body}>
        <View style={styles.textCol}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>

          {completed && chips && chips.length > 0 ? (
            <View style={styles.chipsRow}>
              {chips.map((chip, i) => (
                <View key={`${chip}-${i}`} style={styles.chip}>
                  <Text style={styles.chipText} numberOfLines={1}>
                    {chip}
                  </Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.description} numberOfLines={3}>
              {description}
            </Text>
          )}
        </View>

        <Ionicons
          name={completed ? 'chevron-forward' : 'add'}
          size={24}
          color={completed ? C.chevron : C.plus}
          style={styles.icon}
        />
      </View>
    </Wrap>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingLeft: 12,
    paddingRight: 14,
    paddingVertical: 12,
    backgroundColor: C.surface,
    borderRadius: 20,
    // Box Shadow 01 — diffuse, low-opacity "floating" feel.
    shadowColor: '#596E7C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  cardLocked: {
    opacity: 0.25,
  },
  imageWrap: {
    width: 84,
    height: 88,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: C.imagePlaceholder,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  body: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  textCol: {
    flex: 1,
    gap: 8,
    // Extra right padding narrows the text column so the description wraps
    // earlier (a tighter block) instead of running right up to the icon.
    paddingRight: 16,
  },
  title: {
    fontFamily: FONT_INTER,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '700',
    color: C.ink,
  },
  description: {
    fontFamily: FONT_INTER,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '400',
    color: C.ink,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  chip: {
    backgroundColor: C.chipBg,
    borderWidth: 1,
    borderColor: C.chipBorder,
    borderRadius: 15,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  chipText: {
    fontFamily: FONT_INTER,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '400',
    color: C.ink,
    textAlign: 'center',
  },
  icon: {
    width: 24,
    height: 24,
    textAlign: 'center',
  },
});

export default AudienceCard;
