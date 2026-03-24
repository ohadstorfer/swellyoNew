import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  Dimensions,
  Platform,
  TouchableOpacity,
  Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Text } from './Text';
import { getImageUrl } from '../services/media/imageService';
import { spacing } from '../styles/theme';

export type BudgetOption = 'budget' | 'mid' | 'high' | 'premium';

// Figma: outer padding 10.703px, outer radius 21.4px, inner radius 14.27px, shadow 0px 1.784px 14.271px rgba(89,110,124,0.15)
const FIGMA_OUTER_PADDING = 10.703;
const FIGMA_OUTER_RADIUS = 21;
const FIGMA_INNER_RADIUS = 14;
// Fixed height so all cards are the same; content spacing ~365px (16/18/18/24 spec)
const CARD_HEIGHT = 368;
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

const BUDGET_ITEMS: { value: BudgetOption; imagePath: string; label: string }[] = [
  { value: 'budget', imagePath: '/budget/low_budget.png', label: 'Low budget' },
  { value: 'mid', imagePath: '/budget/medium_budget.png', label: 'Medium' },
  { value: 'high', imagePath: '/budget/high_budget.png', label: 'High' },
  { value: 'premium', imagePath: '/budget/premium_budget.png', label: 'Premium' },
];

const NUM_REAL = BUDGET_ITEMS.length;

// Figma structured cards – same layout, different copy and coin image
const STRUCTURED_CARDS: Record<BudgetOption, { title: string; tagline: string; description: string; coinImagePath: string }> = {
  budget: {
    title: 'Barefoot Mode',
    tagline: 'Light, simple, flexible.',
    description: 'Hostels, cheap local food, shared boards, counting sessions not coins.',
    coinImagePath: '/budget/low_budget.png',
  },
  mid: {
    title: 'Cruise Control',
    tagline: 'Balanced and easy.',
    description: 'Comfort stays, decent gear, sunset dinners after long sessions.',
    coinImagePath: '/budget/medium_budget.png',
  },
  high: {
    title: 'Premium Swell',
    tagline: 'Smooth rides all around.',
    description: 'Quality boards, ocean-view rooms, and the chef’s special.',
    coinImagePath: '/budget/high_budget.png',
  },
  premium: {
    title: 'Endless Summer',
    tagline: 'No limits.',
    description: 'Chasing perfect swell windows, boutique villas, custom quivers waiting on arrival.',
    coinImagePath: '/budget/premium_budget.png',
  },
};

interface BudgetCardsCarouselProps {
  onSelect: (budget: BudgetOption) => void;
  isReadOnly?: boolean;
  initialSelection?: BudgetOption;
  onCenteredCardChange?: (budget: BudgetOption, index: number) => void;
  /** Ref to parent ScrollView native gesture so vertical scroll can run simultaneously with horizontal pan. */
  parentScrollNativeRef?: React.RefObject<unknown> | null;
}

export const BudgetCardsCarousel: React.FC<BudgetCardsCarouselProps> = ({
  onSelect,
  isReadOnly = false,
  initialSelection,
  onCenteredCardChange,
  parentScrollNativeRef,
}) => {
  const [selectedBudget, setSelectedBudget] = useState<BudgetOption | null>(initialSelection ?? null);
  const [centeredIndex, setCenteredIndex] = useState(0);
  const centeredIndexRef = useRef(0);
  const flatListRef = useRef<FlatList>(null);

  centeredIndexRef.current = centeredIndex;

  const screenWidth = Dimensions.get('window').width;
  const PEEK = 24;
  const CARD_GAP = 27;
  const cardWidth = Math.min(258, screenWidth - 2 * PEEK - CARD_GAP);
  const itemWidth = cardWidth + CARD_GAP;
  const contentWidth = 2 * PEEK + NUM_REAL * itemWidth;
  const maxScroll = Math.max(0, contentWidth - screenWidth);

  // Center offset for card at list index i (0..NUM_REAL-1).
  const getCenterOffsetForIndex = useCallback(
    (realIndex: number) => {
      const raw = PEEK + realIndex * itemWidth + cardWidth / 2 - screenWidth / 2;
      return Math.max(0, Math.min(maxScroll, raw));
    },
    [itemWidth, cardWidth, screenWidth, maxScroll]
  );

  const snapToOffsets = BUDGET_ITEMS.map((_, i) => getCenterOffsetForIndex(i));

  const carouselData = BUDGET_ITEMS;

  // Select button on card = submit: call onSelect directly (no separate Submit button)
  const handleCardPress = useCallback(
    (budget: BudgetOption) => {
      if (isReadOnly) return;
      setSelectedBudget(budget);
      onSelect(budget);
    },
    [isReadOnly, onSelect]
  );

  const getScrollOffsetForIndex = getCenterOffsetForIndex;

  const scrollOffsetToRealIndex = useCallback(
    (offsetX: number) => {
      const centerInContent = offsetX + screenWidth / 2;
      const rawListIndex = (centerInContent - PEEK - cardWidth / 2) / itemWidth;
      return Math.max(0, Math.min(NUM_REAL - 1, Math.round(rawListIndex)));
    },
    [screenWidth, cardWidth, itemWidth]
  );

  const handleScrollEnd = useCallback(
    (event: { nativeEvent: { contentOffset: { x: number } } }) => {
      const offsetX = event?.nativeEvent?.contentOffset?.x ?? 0;
      const targetIndex = scrollOffsetToRealIndex(offsetX);
      centeredIndexRef.current = targetIndex;
      lastReportedCenteredIndexRef.current = targetIndex;
      setCenteredIndex(targetIndex);
    },
    [scrollOffsetToRealIndex]
  );

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: Array<{ index: number | null }> }) => {
      if (viewableItems.length > 0) {
        const listIndex = viewableItems[0].index;
        if (listIndex !== null && listIndex !== undefined && listIndex >= 0 && listIndex < NUM_REAL) {
          setCenteredIndex(listIndex);
        }
      }
    }
  ).current;

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 }).current;

  // Keep centeredIndex in sync with scroll position (e.g. during drag or external scroll)
  const lastReportedCenteredIndexRef = useRef<number>(0);
  const handleScroll = useCallback(
    (event: { nativeEvent: { contentOffset: { x: number } } }) => {
      const offsetX = event?.nativeEvent?.contentOffset?.x ?? 0;
      const index = scrollOffsetToRealIndex(offsetX);
      if (index !== lastReportedCenteredIndexRef.current) {
        lastReportedCenteredIndexRef.current = index;
        setCenteredIndex(index);
      }
    },
    [scrollOffsetToRealIndex]
  );

  // Notify parent when the centered card changes
  useEffect(() => {
    if (onCenteredCardChange) {
      const budget = BUDGET_ITEMS[centeredIndex]?.value;
      if (budget !== undefined) {
        onCenteredCardChange(budget, centeredIndex);
      }
    }
  }, [centeredIndex, onCenteredCardChange]);

  // Center the first card on mount (carousel uses center-based offsets)
  const hasInitialScroll = useRef(false);
  useEffect(() => {
    if (hasInitialScroll.current) return;
    hasInitialScroll.current = true;
    const offset = getScrollOffsetForIndex(0);
    const t = setTimeout(() => {
      flatListRef.current?.scrollToOffset({ offset, animated: false });
    }, 0);
    return () => clearTimeout(t);
  }, [getScrollOffsetForIndex]);

  return (
    <View style={styles.container}>
      <View style={styles.carouselContainer}>
        <FlatList
          ref={(r) => { flatListRef.current = r; }}
          data={carouselData}
          keyExtractor={(item) => item.value}
          horizontal
          scrollEnabled
          directionalLockEnabled
          showsHorizontalScrollIndicator={false}
          snapToOffsets={snapToOffsets}
          snapToAlignment="start"
          onScroll={handleScroll}
          onScrollEndDrag={handleScrollEnd}
          onMomentumScrollEnd={handleScrollEnd}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          contentContainerStyle={[styles.carouselContent, { paddingHorizontal: PEEK }]}
          getItemLayout={(_, index) => ({
            length: itemWidth,
            offset: PEEK + index * itemWidth,
            index,
          })}
          ListFooterComponent={<View style={{ width: PEEK }} />}
          {...(Platform.OS === 'web' && {
            style: {
              overflowX: 'auto' as any,
              overflowY: 'hidden' as any,
              WebkitOverflowScrolling: 'touch' as any,
            } as any,
            scrollEventThrottle: 16,
          })}
          renderItem={({ item: budgetItem }) => {
            const gradient = BUDGET_GRADIENTS[budgetItem.value];
            const structuredCard = STRUCTURED_CARDS[budgetItem.value];

            return (
              <View style={[styles.cardWrapper, { width: cardWidth, height: CARD_HEIGHT, marginRight: CARD_GAP }]}>
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
                        <View style={styles.structuredCardContent}>
                          <Text style={styles.structuredCardTitle}>{structuredCard.title}</Text>
                          <View style={styles.structuredCardCoin}>
                            <Image
                              source={{ uri: getImageUrl(structuredCard.coinImagePath) }}
                              style={styles.structuredCardCoinImage}
                              resizeMode="contain"
                            />
                          </View>
                          <Text style={styles.structuredCardTagline}>{structuredCard.tagline}</Text>
                          <Text style={styles.structuredCardDescription}>{structuredCard.description}</Text>
                          <TouchableOpacity
                            onPress={() => handleCardPress(budgetItem.value)}
                            disabled={isReadOnly}
                            activeOpacity={0.8}
                            style={styles.structuredCardSelectButton}
                          >
                            <Text style={styles.structuredCardSelectButtonText}>Select</Text>
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <Image
                          source={{ uri: getImageUrl(budgetItem.imagePath) }}
                          style={[styles.cardImage, { width: cardWidth - FIGMA_OUTER_PADDING * 2, height: CARD_HEIGHT - FIGMA_OUTER_PADDING * 2, borderRadius: FIGMA_INNER_RADIUS }]}
                          resizeMode="cover"
                        />
                      )}
                    </View>
                  </LinearGradient>
                </View>
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
    width: '100%',
    alignItems: 'center',
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  carouselContainer: {
    width: '100%',
  },
  carouselContent: {
    alignItems: 'center',
  },
  cardWrapper: {
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
  },
});