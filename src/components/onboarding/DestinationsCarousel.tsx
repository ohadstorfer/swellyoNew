import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ImageBackground,
  Image,
  Dimensions,
  Platform,
  ScrollView,
  Animated,
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

// Card width/height both scale with the carousel width (see component below).
// PEEK governs how much of the neighbouring card shows; CARD_GAP the spacing.
// CARD_WIDTH_TARGET just caps the width on very wide screens (tablet/web).
const CARD_WIDTH_TARGET = 400;
const CARD_GAP = 12;
const PEEK = 30;
// Card image height is derived from its width — landscape-ish so destination
// photos sit naturally without looking stretched.
const CARD_IMAGE_RATIO = 0.75;

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
  imageHeight: number;
  onPress: () => void;
  onRemove: () => void;
}

const DestinationCard: React.FC<DestinationCardProps> = ({
  destination,
  width,
  imageHeight,
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
        <View style={[styles.imageWrap, { height: imageHeight }]}>
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
  imageHeight: number;
  onPress: () => void;
}

const AddDestinationCard: React.FC<AddCardProps> = ({ width, imageHeight, onPress }) => {
  return (
    <View style={[styles.card, { width }]}>
      <View style={styles.cardInner}>
        <Image
          source={DEFAULT_DESTINATION_IMAGE}
          style={[styles.addImagePlaceholder, { height: imageHeight }]}
          resizeMode="cover"
        />
        <View style={styles.addBody}>
          {/* Only the button gets the press feedback, not the whole card. */}
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={onPress}
            style={styles.addButton}
          >
            <Ionicons name="add" size={20} color="#212121" />
            <Text style={styles.addButtonText}>Add Destination</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

export const DestinationsCarousel: React.FC<Props> = ({
  destinations,
  onAdd,
  onEditAt,
  onRemoveAt,
}) => {
  // Measured width of the carousel itself — parent padding makes this
  // narrower than the window, so window width would mis-center the card.
  const [containerWidth, setContainerWidth] = useState(Dimensions.get('window').width);
  const cardWidth = Math.min(CARD_WIDTH_TARGET, containerWidth - PEEK * 2);
  // Center the snapped card; with multiple cards this leaves a symmetric
  // peek (sidePadding - CARD_GAP) of the neighbouring card.
  const sidePadding = Math.max(PEEK, (containerWidth - cardWidth) / 2);
  // Card image height scales with the (screen-derived) card width.
  const imageHeight = Math.round(cardWidth * CARD_IMAGE_RATIO);

  const scrollRef = useRef<ScrollView>(null);
  const cardWidthRef = useRef(cardWidth);
  cardWidthRef.current = cardWidth;
  const prevCountRef = useRef(destinations.length);

  // When a destination was just added, let the user see the filled card for
  // a moment, then glide to the Add card so they can enter the next one.
  useEffect(() => {
    const prev = prevCountRef.current;
    prevCountRef.current = destinations.length;
    if (destinations.length <= prev) return;
    const addCardIndex = destinations.length; // [...cards, addCard, ghost]
    const timer = setTimeout(() => {
      scrollRef.current?.scrollTo({
        x: addCardIndex * (cardWidthRef.current + CARD_GAP),
        animated: true,
      });
    }, 1500);
    return () => clearTimeout(timer);
  }, [destinations.length]);

  // Hint shown when the user tries to slide past the Add card to the ghost.
  const [limitHintVisible, setLimitHintVisible] = useState(false);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hintOpacity = useRef(new Animated.Value(0)).current;
  const showLimitHint = useCallback(() => {
    setLimitHintVisible(true);
    hintOpacity.stopAnimation();
    hintOpacity.setValue(1);
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    // Hold briefly, then fade out over 1.5s before unmounting.
    hintTimerRef.current = setTimeout(() => {
      Animated.timing(hintOpacity, {
        toValue: 0,
        duration: 1500,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setLimitHintVisible(false);
      });
    }, 1000);
  }, [hintOpacity]);
  useEffect(
    () => () => {
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    },
    [],
  );

  // Snap targets for every real card + the Add card. The trailing ghost is
  // deliberately excluded so it can't be slid to.
  const snapOffsets = useMemo(
    () =>
      Array.from({ length: destinations.length + 1 }, (_, i) => i * (cardWidth + CARD_GAP)),
    [destinations.length, cardWidth],
  );

  const items = useMemo(
    () => [
      ...destinations.map((d, index) => ({ kind: 'card' as const, destination: d, index })),
      { kind: 'add' as const },
      // Trailing ghost so the next slot always peeks beside the last real card.
      { kind: 'ghost' as const },
    ],
    [destinations],
  );

  return (
    <View style={styles.wrapper}>
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      scrollEventThrottle={16}
      onScroll={(e) => {
        const x = e.nativeEvent.contentOffset.x;
        const interval = cardWidth + CARD_GAP;
        const maxOffset = destinations.length * interval;
        // Hard-block scrolling past the Add card toward the ghost.
        if (x > maxOffset + 1) {
          scrollRef.current?.scrollTo({ x: maxOffset, animated: false });
          showLimitHint();
        }
      }}
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        if (w > 0) setContainerWidth(w);
      }}
      contentContainerStyle={[styles.scrollContent, { paddingHorizontal: sidePadding }]}
      decelerationRate="fast"
      snapToOffsets={snapOffsets}
      {...(Platform.OS === 'web' && {
        style: {
          overflowX: 'auto' as any,
          overflowY: 'hidden' as any,
          WebkitOverflowScrolling: 'touch' as any,
          scrollSnapType: 'x mandatory' as any,
        } as any,
      })}
    >
      {items.map((item, idx) => (
        <View
          key={
            item.kind === 'add'
              ? 'add-card'
              : item.kind === 'ghost'
              ? 'ghost-card'
              : `dest-${item.index}`
          }
          style={[
            { marginRight: idx === items.length - 1 ? 0 : CARD_GAP },
            Platform.OS === 'web' &&
              ({ scrollSnapAlign: item.kind === 'ghost' ? 'none' : 'center' } as any),
          ]}
        >
          {item.kind === 'add' || item.kind === 'ghost' ? (
            <AddDestinationCard
              width={cardWidth}
              imageHeight={imageHeight}
              onPress={onAdd}
            />
          ) : (
            <DestinationCard
              destination={item.destination}
              width={cardWidth}
              imageHeight={imageHeight}
              onPress={() => onEditAt(item.index)}
              onRemove={() => onRemoveAt(item.index)}
            />
          )}
        </View>
      ))}
    </ScrollView>
      <View style={styles.limitHintArea} pointerEvents="none">
        {limitHintVisible ? (
          <Animated.View style={{ opacity: hintOpacity }}>
            <Text style={styles.limitHintText}>Add this destination first</Text>
          </Animated.View>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  scrollContent: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  wrapper: {
    flex: 1,
  },
  limitHintArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  limitHintText: {
    color: '#212121',
    fontSize: 13,
    fontWeight: '500',
    ...Platform.select({
      web: { fontFamily: 'Inter, sans-serif' },
      default: { fontFamily: 'Inter' },
    }),
  },
  card: {
    // Solid white card with a soft downward drop shadow.
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 10,
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.16,
        shadowRadius: 14,
      },
      android: { elevation: 8 },
      web: { boxShadow: '0px 10px 20px rgba(0, 0, 0, 0.16)' as any },
    }),
  },
  cardInner: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  imageWrap: {
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
    width: '100%',
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
    fontWeight: '500',
    color: '#333333',
    ...Platform.select({
      web: { fontFamily: 'Inter, sans-serif' },
      default: { fontFamily: 'Inter' },
    }),
  },
});

export default DestinationsCarousel;
