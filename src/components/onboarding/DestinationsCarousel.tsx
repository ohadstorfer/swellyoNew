import React, { useMemo } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ImageBackground,
  Image,
  Dimensions,
  Platform,
  ScrollView,
} from 'react-native';

const DEFAULT_DESTINATION_IMAGE = require('../../../assets/onboarding/destinations-default.png');
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../Text';
import {
  getCountryImageFromStorage,
  getCountryImageFallback,
} from '../../services/media/imageService';
import { getDisplayLabelAndFlagKey } from '../../utils/destinationDisplay';
import { computeDurationParts } from '../../utils/destinationDuration';

export type OnboardingDestination = {
  country: string;
  state?: string;
  area: string[];
  time_in_days: number;
  time_in_text?: string;
};

interface Props {
  destinations: OnboardingDestination[];
  onAdd: () => void;
  onEditAt: (index: number) => void;
  onRemoveAt: (index: number) => void;
}

// Figma: card 316px wide, peek visible on right; gap 16px. Cap so the design
// holds on narrow phones without overlapping the screen edge.
const CARD_WIDTH_TARGET = 316;
const CARD_GAP = 16;
const PEEK = 24;

const formatDays = (days: number, text?: string): string => {
  if (text && text.trim()) return text.trim();
  if (!days || days < 1) return '';
  // Try to parse back via util so we display "2 weeks" / "1 month" naturally.
  const parts = computeDurationParts(String(days), 'days');
  return parts?.timeInText ?? `${days} days`;
};

interface DestinationCardProps {
  destination: OnboardingDestination;
  width: number;
  onPress: () => void;
  onRemove: () => void;
}

const DestinationCard: React.FC<DestinationCardProps> = ({
  destination,
  width,
  onPress,
  onRemove,
}) => {
  const { displayLabel, flagKey } = getDisplayLabelAndFlagKey(destination.country);
  const storageUrl = getCountryImageFromStorage(flagKey);
  const fallback = getCountryImageFallback(flagKey);
  const imageUri = storageUrl || fallback;
  const dayText = formatDays(destination.time_in_days, destination.time_in_text);
  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={[styles.card, { width }]}>
      <View style={styles.cardInner}>
        <View style={styles.imageWrap}>
          <ImageBackground
            source={{ uri: imageUri }}
            style={styles.image}
            imageStyle={styles.imageRadius}
          />
          {/* Remove (x) — corner overlay so the user can drop a destination. */}
          <TouchableOpacity
            onPress={onRemove}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={styles.removeButton}
            activeOpacity={0.7}
          >
            <Ionicons name="close" size={16} color="#212121" />
          </TouchableOpacity>
        </View>
        <View style={styles.body}>
          <View style={styles.titleRow}>
            <Text style={styles.countryName} numberOfLines={1}>{displayLabel}</Text>
            {dayText ? <Text style={styles.dayText}>{dayText}</Text> : null}
          </View>
          {destination.area.length > 0 ? (
            <View style={styles.chipsRow}>
              {destination.area.slice(0, 4).map((a, i) => (
                <View key={`${a}-${i}`} style={styles.chip}>
                  <Text style={styles.chipText} numberOfLines={1}>{a}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
};

interface AddCardProps {
  width: number;
  onPress: () => void;
}

const AddDestinationCard: React.FC<AddCardProps> = ({ width, onPress }) => {
  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={[styles.card, { width }]}>
      <View style={styles.cardInner}>
        <Image
          source={DEFAULT_DESTINATION_IMAGE}
          style={styles.addImagePlaceholder}
          resizeMode="cover"
        />
        <View style={styles.addBody}>
          <View style={styles.addButton}>
            <Ionicons name="add" size={20} color="#212121" />
            <Text style={styles.addButtonText}>Add Destination</Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
};

export const DestinationsCarousel: React.FC<Props> = ({
  destinations,
  onAdd,
  onEditAt,
  onRemoveAt,
}) => {
  const screenWidth = Dimensions.get('window').width;
  const cardWidth = Math.min(CARD_WIDTH_TARGET, screenWidth - PEEK * 2);

  const items = useMemo(
    () => [
      ...destinations.map((d, index) => ({ kind: 'card' as const, destination: d, index })),
      { kind: 'add' as const },
    ],
    [destinations],
  );

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[styles.scrollContent, { paddingHorizontal: PEEK }]}
      decelerationRate="fast"
      snapToInterval={cardWidth + CARD_GAP}
      snapToAlignment="start"
      {...(Platform.OS === 'web' && {
        style: {
          overflowX: 'auto' as any,
          overflowY: 'hidden' as any,
          WebkitOverflowScrolling: 'touch' as any,
        } as any,
      })}
    >
      {items.map((item, idx) => (
        <View
          key={item.kind === 'add' ? 'add-card' : `dest-${item.index}`}
          style={{ marginRight: idx === items.length - 1 ? 0 : CARD_GAP }}
        >
          {item.kind === 'add' ? (
            <AddDestinationCard width={cardWidth} onPress={onAdd} />
          ) : (
            <DestinationCard
              destination={item.destination}
              width={cardWidth}
              onPress={() => onEditAt(item.index)}
              onRemove={() => onRemoveAt(item.index)}
            />
          )}
        </View>
      ))}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  scrollContent: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  card: {
    // Figma outer card uses translucent white + soft drop shadow.
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
    borderRadius: 20,
    padding: 10,
    ...Platform.select({
      ios: {
        shadowColor: '#0D1827',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.09,
        shadowRadius: 24,
      },
      android: { elevation: 4 },
      web: { boxShadow: '0px 0px 24px rgba(13, 24, 39, 0.09)' as any },
    }),
  },
  cardInner: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  imageWrap: {
    height: 235,
    width: '100%',
    position: 'relative',
  },
  image: {
    width: '100%',
    height: '100%',
    backgroundColor: '#E8E8E8',
  },
  imageRadius: {
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  removeButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 16,
    gap: 12,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  countryName: {
    flex: 1,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '700',
    color: '#333333',
    ...Platform.select({
      web: { fontFamily: 'Inter, sans-serif' },
      default: { fontFamily: 'Inter' },
    }),
  },
  dayText: {
    fontSize: 12,
    color: '#333333',
    marginLeft: 8,
    ...Platform.select({
      web: { fontFamily: 'Inter, sans-serif' },
      default: { fontFamily: 'Inter' },
    }),
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: '#E4E4E4',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  chipText: {
    fontSize: 12,
    color: '#333333',
    ...Platform.select({
      web: { fontFamily: 'Inter, sans-serif' },
      default: { fontFamily: 'Inter' },
    }),
  },
  // Add-destination card — large gray placeholder image + outlined button below.
  addImagePlaceholder: {
    height: 235,
    backgroundColor: '#F2F2F2',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  addBody: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 8,
    paddingVertical: 16,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 56,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CFCFCF',
    backgroundColor: '#FFFFFF',
  },
  addButtonText: {
    fontSize: 14,
    color: '#333333',
    ...Platform.select({
      web: { fontFamily: 'Inter, sans-serif' },
      default: { fontFamily: 'Inter' },
    }),
  },
});

export default DestinationsCarousel;
