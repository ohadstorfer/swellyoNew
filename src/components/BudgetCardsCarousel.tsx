import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  Dimensions,
  Platform,
  PixelRatio,
  TouchableOpacity,
  Image,
  Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Text } from './Text';
import { Images } from '../assets/images';

export type BudgetOption = 'budget' | 'mid' | 'high' | 'premium';

// Card text ignores device font scaling beyond this. The card frame is a fixed
// height, so unbounded accessibility font scaling overflows the frame and clips
// the Select button — which blocks onboarding. Hosts sizing the carousel area
// (e.g. OnboardingStep5BudgetScreen) use this to compute the min height the
// card needs at the worst-case scale.
export const CARD_MAX_FONT_SCALE = 1.2;

// Figma: outer padding 10.703px, outer radius 21.4px, inner radius 14.27px, shadow 0px 1.784px 14.271px rgba(89,110,124,0.15)
const FIGMA_OUTER_PADDING = 10.703;
const FIGMA_OUTER_RADIUS = 21;
const FIGMA_INNER_RADIUS = 14;
// Fallback card height, used until the available space has been measured.
const FALLBACK_HEIGHT = 368;
// Upper bound so the card doesn't become oversized on very tall screens.
const MAX_CARD_HEIGHT = 460;
// Small gap kept between the card frame and the bottom of the carousel area so
// the frame's rounded corners aren't flush against (or clipped by) the edge.
const CARD_V_BREATHING = 12;
const FIGMA_SHADOW = {
  shadowColor: 'rgba(89, 110, 124, 0.15)',
  shadowOffset: { width: 0, height: 1.8 },
  shadowOpacity: 1,
  shadowRadius: 14,
  elevation: 4,
};

// Gradient borders from Figma (angle ~128–132deg → start/end for expo-linear-gradient)
const BUDGET_GRADIENTS: Record<BudgetOption, { colors: string[]; start?: { x: number; y: number }; end?: { x: number; y: number } }> = {
  budget: {
    colors: ['rgba(246, 186, 122, 0.5)', 'rgba(207, 130, 71, 0.5)'],
    start: { x: 0.2, y: 0 },
    end: { x: 0.8, y: 1 },
  },
  mid: {
    colors: ['rgba(238, 238, 238, 0.5)', 'rgba(136, 136, 136, 0.5)'],
    start: { x: 0.2, y: 0 },
    end: { x: 0.8, y: 1 },
  },
  high: {
    colors: ['rgba(254, 237, 154, 0.6)', 'rgba(213, 167, 90, 0.6)'],
    start: { x: 0.2, y: 0 },
    end: { x: 0.8, y: 1 },
  },
  premium: {
    colors: [
      'rgba(242, 249, 213, 0.5)',
      'rgba(248, 211, 250, 0.5)',
      'rgba(196, 231, 247, 0.5)',
      'rgba(206, 207, 246, 0.5)',
      'rgba(242, 250, 217, 0.5)',
    ],
    start: { x: 0.15, y: 0 },
    end: { x: 0.85, y: 1 },
  },
};

const BUDGET_ITEMS: { value: BudgetOption; imageSource: any; label: string }[] = [
  { value: 'budget', imageSource: Images.budget.low, label: 'Low budget' },
  { value: 'mid', imageSource: Images.budget.medium, label: 'Medium' },
  { value: 'high', imageSource: Images.budget.high, label: 'High' },
  { value: 'premium', imageSource: Images.budget.premium, label: 'Premium' },
];

const NUM_REAL = BUDGET_ITEMS.length;

// Infinite loop: render the 4 cards repeated many times and keep the user near
// the middle. FlatList virtualises, so only the visible cards are mounted.
const INFINITE_SIZE = 400;
const START_INDEX = INFINITE_SIZE / 2; // 200 — a multiple of 4, lands on 'budget'
const EDGE_THRESHOLD = 8;

// Side cards are smaller + dimmer than the centred one; the scroll position
// drives a smooth interpolation between the two states. Scale is kept fairly high
// so the peeking neighbours stay clearly visible (a low scale eats the side peek).
const SIDE_SCALE = 0.82;
const SIDE_OPACITY = 0.5;

// Figma structured cards – same layout, different copy and coin image
const STRUCTURED_CARDS: Record<BudgetOption, { title: string; tagline: string; description: string; coinImageSource: any }> = {
  budget: {
    title: 'Barefoot Mode',
    tagline: 'Light, simple, flexible.',
    description: 'Hostels, cheap local food, shared boards, counting sessions not coins.',
    coinImageSource: Images.budget.low,
  },
  mid: {
    title: 'Cruise Control',
    tagline: 'Balanced and easy.',
    description: 'Comfort stays, decent gear, sunset dinners after long sessions.',
    coinImageSource: Images.budget.medium,
  },
  high: {
    title: 'Premium Swell',
    tagline: 'Smooth rides all around.',
    description: 'Quality boards, ocean-view rooms, and the chef’s special.',
    coinImageSource: Images.budget.high,
  },
  premium: {
    title: 'Endless Summer',
    tagline: 'No limits.',
    description: 'Chasing perfect swell windows, boutique villas, custom quivers waiting on arrival.',
    coinImageSource: Images.budget.premium,
  },
};

const mod = (n: number, m: number) => ((n % m) + m) % m;

interface BudgetCardsCarouselProps {
  onSelect: (budget: BudgetOption) => void;
  isReadOnly?: boolean;
  initialSelection?: BudgetOption;
  onCenteredCardChange?: (budget: BudgetOption, index: number) => void;
  /** Hide the per-card Select button — the host owns selection (e.g. a bottom "Select" button). */
  hideSelectButton?: boolean;
  /** Ref to parent ScrollView native gesture so vertical scroll can run simultaneously with horizontal pan. */
  parentScrollNativeRef?: React.RefObject<unknown> | null;
}

export const BudgetCardsCarousel: React.FC<BudgetCardsCarouselProps> = ({
  onSelect,
  isReadOnly = false,
  initialSelection,
  onCenteredCardChange,
  hideSelectButton = false,
}) => {
  const [selectedBudget, setSelectedBudget] = useState<BudgetOption | null>(initialSelection ?? null);
  const flatListRef = useRef<FlatList>(null);

  // Larger PEEK = more of the neighbouring cards shows on each side, so two
  // adjacent cards are always visible.
  const PEEK = 44;
  // 0 gap: the card itself is wider instead — the per-card step (itemWidth)
  // stays the same, so the side-peek / snap behaviour is unchanged.
  const CARD_GAP = 0;

  // Measured carousel box. Width drives horizontal centring — the parent
  // screen has side padding, so the window width would push cards off-centre.
  // Height drives the card size.
  const [carouselSize, setCarouselSize] = useState({
    width: Dimensions.get('window').width,
    height: 0,
  });
  // Cap kept ≥ ~252 so the card's inner content (tagline minWidth 228 + padding)
  // never overflows; below that the copy would clip.
  const cardWidth = Math.min(264, carouselSize.width - 2 * PEEK - CARD_GAP);
  const itemWidth = cardWidth + CARD_GAP;
  // Pad so a card at scroll offset i*itemWidth ends up centred in the carousel.
  const sidePad = Math.max(0, (carouselSize.width - cardWidth) / 2);
  // Top padding above the card inside the carousel area (kept small so the card
  // gets most of the vertical space).
  const cardTopPad = carouselSize.height > 0 ? Math.round(carouselSize.height * 0.02) : 0;
  // Natural height of the card interior = fixed chrome (paddings 40 + coin 116 +
  // margins 60 + button 45 = 261; 216 without the button) + text lines. Text grows
  // with the device font scale twice over: taller lines AND extra wrapped lines
  // (tagline/description are width-capped at 228), hence the (108 + 200·(s−1))·s
  // term: 369 at scale 1, ~439 at the 1.2 cap (with the button).
  const fontScale = Math.min(PixelRatio.getFontScale(), CARD_MAX_FONT_SCALE);
  const naturalContentHeight =
    (hideSelectButton ? 216 : 261) + (108 + 200 * (fontScale - 1)) * fontScale;

  // The card fills the measured carousel area (minus the top pad and a little
  // breathing room) rather than using a fixed height: too small clips the content,
  // too big clips the card FRAME top/bottom because the horizontal FlatList clips
  // its cards to the container's vertical bounds — both were seen on Android.
  // It never grows past what its content actually needs, though, otherwise a tall
  // screen gives an airy, half-empty card (very visible once the per-card Select
  // button is hidden). MAX_CARD_HEIGHT keeps it sensible on very tall screens.
  const naturalCardHeight = naturalContentHeight + FIGMA_OUTER_PADDING * 2;
  const cardHeight =
    carouselSize.height > 0
      ? Math.min(
          carouselSize.height - cardTopPad - CARD_V_BREATHING,
          naturalCardHeight,
          MAX_CARD_HEIGHT,
        )
      : Math.min(FALLBACK_HEIGHT, naturalCardHeight);

  // When the card the screen affords is shorter than its natural height, every
  // interior size (fonts, coin, margins, button) shrinks by the same factor so the
  // whole content — critically the Select button — always fits with no clipping
  // and no scrolling.
  const availableForContent = cardHeight - FIGMA_OUTER_PADDING * 2;
  let contentScale = Math.min(1, availableForContent / naturalContentHeight);
  if (!hideSelectButton && 45 * contentScale < 40) {
    // The Select button stops shrinking at 40pt (it's the one control the user
    // MUST hit), so once it hits that floor the rest shrinks a bit further to
    // absorb the difference: needed(k) = (natural − 45)·k + 40.
    contentScale = (availableForContent - 40) / (naturalContentHeight - 45);
  }
  contentScale = Math.max(0.55, Math.min(1, contentScale));

  // Interior style overrides for the shrunken card; null at full size so the
  // static styles apply untouched. Every value mirrors its StyleSheet twin below.
  const shrunk = useMemo(() => {
    if (contentScale >= 1) return null;
    const k = contentScale;
    return {
      content: { paddingTop: 16 * k, paddingBottom: 24 * k },
      title: { fontSize: 22 * k, lineHeight: 32 * k, marginBottom: 18 * k },
      coin: { width: 122 * k, height: 116 * k, marginBottom: 18 * k },
      coinImage: { width: 122 * k, height: 116 * k },
      tagline: { fontSize: 18 * k, lineHeight: 22 * k, marginBottom: 6 * k },
      description: {
        fontSize: 16 * k,
        lineHeight: (Platform.OS === 'web' ? 15 : 18) * k,
        marginBottom: 18 * k,
      },
      // The button shrinks less than the rest: below ~40pt it stops being a
      // comfortable touch target, and it's the one control the user MUST hit.
      button: { height: Math.max(40, 45 * k), paddingVertical: 13 * k },
      buttonText: { fontSize: 18 * k, lineHeight: 20 * k },
    };
  }, [contentScale]);

  const initialReal = initialSelection
    ? Math.max(0, BUDGET_ITEMS.findIndex((b) => b.value === initialSelection))
    : 0;
  const initialIndex = START_INDEX + initialReal;

  // Drives the scale/opacity interpolation for every card.
  const scrollX = useRef(new Animated.Value(initialIndex * itemWidth)).current;

  const [centeredIndex, setCenteredIndex] = useState(initialIndex);
  const centeredIndexRef = useRef(initialIndex);
  centeredIndexRef.current = centeredIndex;

  const infiniteData = useMemo<typeof BUDGET_ITEMS>(
    () => Array.from({ length: INFINITE_SIZE }, (_, i) => BUDGET_ITEMS[i % NUM_REAL]),
    [],
  );

  // Select button on card = submit: call onSelect directly.
  const handleCardPress = useCallback(
    (budget: BudgetOption) => {
      if (isReadOnly) return;
      setSelectedBudget(budget);
      onSelect(budget);
    },
    [isReadOnly, onSelect],
  );

  // Keep the centred card centred — on mount, and whenever a width change
  // resizes the items.
  useEffect(() => {
    const offset = centeredIndexRef.current * itemWidth;
    const t = setTimeout(() => {
      flatListRef.current?.scrollToOffset({ offset, animated: false });
      scrollX.setValue(offset);
    }, 0);
    return () => clearTimeout(t);
  }, [itemWidth, scrollX]);

  // Notify the parent which card is centred.
  useEffect(() => {
    if (!onCenteredCardChange) return;
    const real = mod(centeredIndex, NUM_REAL);
    onCenteredCardChange(BUDGET_ITEMS[real].value, real);
  }, [centeredIndex, onCenteredCardChange]);

  const handleMomentumEnd = useCallback(
    (event: { nativeEvent: { contentOffset: { x: number } } }) => {
      const offsetX = event?.nativeEvent?.contentOffset?.x ?? 0;
      const idx = Math.max(0, Math.min(INFINITE_SIZE - 1, Math.round(offsetX / itemWidth)));
      // Near an end → jump to the equivalent card in the middle (invisible,
      // the content is identical) so the loop never actually runs out.
      if (idx < EDGE_THRESHOLD || idx > INFINITE_SIZE - 1 - EDGE_THRESHOLD) {
        const jumped = START_INDEX + mod(idx, NUM_REAL);
        const jumpedOffset = jumped * itemWidth;
        flatListRef.current?.scrollToOffset({ offset: jumpedOffset, animated: false });
        scrollX.setValue(jumpedOffset);
        setCenteredIndex(jumped);
      } else {
        setCenteredIndex(idx);
      }
    },
    [itemWidth, scrollX],
  );

  return (
    <View
      style={[styles.container, { paddingTop: cardTopPad }]}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setCarouselSize((prev) =>
          Math.abs(prev.width - width) < 0.5 && Math.abs(prev.height - height) < 0.5
            ? prev
            : { width, height },
        );
      }}
    >
      <View style={styles.carouselContainer}>
        <FlatList
          ref={flatListRef}
          data={infiniteData}
          keyExtractor={(_, i) => `budget-${i}`}
          horizontal
          directionalLockEnabled
          showsHorizontalScrollIndicator={false}
          snapToInterval={itemWidth}
          snapToAlignment="start"
          decelerationRate="fast"
          disableIntervalMomentum
          scrollEventThrottle={16}
          onScroll={(e) => {
            scrollX.setValue(e.nativeEvent.contentOffset.x);
          }}
          onMomentumScrollEnd={handleMomentumEnd}
          initialScrollIndex={initialIndex}
          getItemLayout={(_, index) => ({
            length: itemWidth,
            offset: index * itemWidth,
            index,
          })}
          onScrollToIndexFailed={(info) => {
            setTimeout(() => {
              flatListRef.current?.scrollToOffset({
                offset: info.index * itemWidth,
                animated: false,
              });
            }, 100);
          }}
          contentContainerStyle={[styles.carouselContent, { paddingHorizontal: sidePad }]}
          {...(Platform.OS === 'web' && {
            style: {
              overflowX: 'auto' as any,
              overflowY: 'hidden' as any,
              WebkitOverflowScrolling: 'touch' as any,
            } as any,
          })}
          renderItem={({ item: budgetItem, index }) => {
            const gradient = BUDGET_GRADIENTS[budgetItem.value];
            const structuredCard = STRUCTURED_CARDS[budgetItem.value];
            const isSelected = selectedBudget === budgetItem.value;

            // Centred when scrollX === index * itemWidth; shrinks/dims either side.
            const inputRange = [
              (index - 1) * itemWidth,
              index * itemWidth,
              (index + 1) * itemWidth,
            ];
            const scale = scrollX.interpolate({
              inputRange,
              outputRange: [SIDE_SCALE, 1, SIDE_SCALE],
              extrapolate: 'clamp',
            });
            const opacity = scrollX.interpolate({
              inputRange,
              outputRange: [SIDE_OPACITY, 1, SIDE_OPACITY],
              extrapolate: 'clamp',
            });

            return (
              <View style={[styles.cardSlot, { width: cardWidth, height: cardHeight, marginRight: CARD_GAP }]}>
                <Animated.View
                  style={[
                    styles.cardScaler,
                    { width: cardWidth, height: cardHeight, transform: [{ scale }], opacity },
                  ]}
                >
                  <View style={[styles.cardOuterTouchable, isReadOnly && styles.cardReadOnly]}>
                    <LinearGradient
                      colors={gradient.colors}
                      start={gradient.start}
                      end={gradient.end}
                      style={[
                        styles.cardGradientOuter,
                        {
                          padding: FIGMA_OUTER_PADDING,
                          borderRadius: FIGMA_OUTER_RADIUS,
                        },
                      ]}
                    >
                      <View style={[styles.cardInner, { borderRadius: FIGMA_INNER_RADIUS }]}>
                        {structuredCard ? (
                          <View style={[styles.structuredCardContent, shrunk?.content]}>
                            <Text
                              style={[styles.structuredCardTitle, shrunk?.title]}
                              maxFontSizeMultiplier={CARD_MAX_FONT_SCALE}
                            >
                              {structuredCard.title}
                            </Text>
                            <View style={[styles.structuredCardCoin, shrunk?.coin]}>
                              <Image
                                source={structuredCard.coinImageSource}
                                style={[styles.structuredCardCoinImage, shrunk?.coinImage]}
                                resizeMode="contain"
                              />
                            </View>
                            <Text
                              style={[styles.structuredCardTagline, shrunk?.tagline]}
                              maxFontSizeMultiplier={CARD_MAX_FONT_SCALE}
                            >
                              {structuredCard.tagline}
                            </Text>
                            <Text
                              style={[styles.structuredCardDescription, shrunk?.description]}
                              maxFontSizeMultiplier={CARD_MAX_FONT_SCALE}
                            >
                              {structuredCard.description}
                            </Text>
                            {!hideSelectButton && (
                              <TouchableOpacity
                                onPress={() => handleCardPress(budgetItem.value)}
                                disabled={isReadOnly}
                                activeOpacity={0.8}
                                style={[
                                  styles.structuredCardSelectButton,
                                  shrunk?.button,
                                  isSelected && styles.structuredCardSelectButtonSelected,
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.structuredCardSelectButtonText,
                                    shrunk?.buttonText,
                                    isSelected && styles.structuredCardSelectButtonTextSelected,
                                  ]}
                                  maxFontSizeMultiplier={CARD_MAX_FONT_SCALE}
                                >
                                  {isSelected ? 'Selected' : 'Select'}
                                </Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        ) : (
                          <Image
                            source={budgetItem.imageSource}
                            style={[styles.cardImage, { width: cardWidth - FIGMA_OUTER_PADDING * 2, height: cardHeight - FIGMA_OUTER_PADDING * 2, borderRadius: FIGMA_INNER_RADIUS }]}
                            resizeMode="cover"
                          />
                        )}
                      </View>
                    </LinearGradient>
                  </View>
                </Animated.View>
              </View>
            );
          }}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    // The card no longer fills the area (it's capped at its natural height), so
    // centre the leftover space instead of dumping it all below the card.
    justifyContent: 'center',
  },
  carouselContainer: {
    width: '100%',
  },
  carouselContent: {
    alignItems: 'center',
  },
  cardSlot: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardScaler: {
    overflow: 'hidden',
  },
  cardOuterTouchable: {
    overflow: 'hidden',
    flex: 1,
  },
  cardGradientOuter: {
    overflow: 'hidden',
    flex: 1,
  },
  cardInner: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
    ...FIGMA_SHADOW,
    ...(Platform.OS === 'web' && {
      boxShadow: '0px 1.784px 14.271px rgba(89, 110, 124, 0.15)',
    }),
  },
  cardReadOnly: {
    opacity: 0.6,
  },
  cardImage: {
    backgroundColor: '#f5f5f5',
  },
  // Spacing spec: 16px above title, 18px below image, 18px above Select, 24px below Select
  structuredCardContent: {
    flex: 1,
    paddingTop: 16,
    paddingBottom: 24,
    paddingHorizontal: 4,
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    backgroundColor: '#FFFFFF',
  },
  structuredCardTitle: {
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat',
    fontWeight: '700',
    fontSize: 22,
    lineHeight: 32,
    color: '#333',
    textAlign: 'center',
    width: '100%',
    marginBottom: 18,
    // Android's default includeFontPadding inflates every line box, pushing the
    // fixed-height card's content (title…Select button) past the height iOS fits
    // into — clipping the title at the top and the Select button at the bottom.
    // Disabling it matches iOS metrics (no-op on iOS/web).
    includeFontPadding: false,
  },
  structuredCardCoin: {
    width: 122,
    height: 116,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  structuredCardCoinImage: {
    width: 122,
    height: 116,
  },
  structuredCardTagline: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontWeight: '700',
    fontSize: 18,
    lineHeight: 22,
    color: '#333',
    textAlign: 'center',
    minWidth: 228,
    maxWidth: 228,
    marginBottom: 6,
    includeFontPadding: false,
  },
  structuredCardDescription: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontWeight: '400',
    fontSize: 16,
    lineHeight: Platform.OS === 'web' ? 15 : 18,
    color: '#a0a0a0',
    textAlign: 'center',
    maxWidth: 228,
    marginBottom: 18,
    includeFontPadding: false,
  },
  structuredCardSelectButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#212121',
    borderRadius: 32,
    height: 45,
    minWidth: 120,
    paddingHorizontal: 16,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  structuredCardSelectButtonText: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontWeight: '400',
    fontSize: 18,
    lineHeight: 20,
    color: '#333',
    includeFontPadding: false,
  },
  // Selected state: filled dark button so the user sees their pick.
  structuredCardSelectButtonSelected: {
    backgroundColor: '#212121',
  },
  structuredCardSelectButtonTextSelected: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
});
