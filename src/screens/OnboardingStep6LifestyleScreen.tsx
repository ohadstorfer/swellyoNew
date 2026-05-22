import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Platform,
  TextInput,
  ActivityIndicator,
  Alert,
  FlatList,
  ListRenderItemInfo,
  Keyboard,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../components/Text';
import { colors, spacing } from '../styles/theme';
import { OnboardingData } from './OnboardingStep1Screen';
import { useIsDesktopWeb } from '../utils/responsive';
import { useRegisterOnboardingStep } from '../context/OnboardingStepContext';
import {
  LIFESTYLE_BUCKET_IMAGE_FILENAMES,
  getLifestyleImageBucketUrlForFilename,
  getLifestyleImageFromPexels,
} from '../services/media/imageService';
import { useDebounce } from '../hooks/useDebounce';

interface Props {
  onNext: (data: OnboardingData) => void;
  onBack: () => void;
  initialData?: Partial<OnboardingData>;
  updateFormData: (data: Partial<OnboardingData>) => void;
}

type Preset = { keyword: string; label: string; imageUrl: string };

// Discriminated union for FlatList items — keeps the synthetic "Add your own"
// card in the same data array so virtualization covers everything.
type GridItem =
  | { type: 'preset'; keyword: string; label: string; imageUrl: string }
  | { type: 'add'; searchTerm: string };

const COLUMNS = 3;
const GRID_GAP = 8;
const SCROLL_HORIZONTAL_PAD = spacing.sm;
const SEARCH_DEBOUNCE_MS = 150;

// Some images cover several distinct activities. The filename can't tell us
// which underscores separate words ("Rock_Climbing") vs separate titles
// ("Adventure_Explore"), so the multi-title labels are listed explicitly and
// shown with " / " between the titles. (Best guess — adjust freely.)
const MULTI_TITLE_LABELS: Record<string, string> = {
  'Adventure_Explore.jpg': 'Adventure / Explore',
  'Baseball_Softball.jpg': 'Baseball / Softball',
  'Calisthenics_Body_Weight.jpg': 'Calisthenics / Body Weight',
  'Cold_Plunges_Ice_Bath.jpg': 'Cold Plunges / Ice Bath',
  'Concerts_Festivals.jpg': 'Concerts / Festivals',
  'Cycling_Triathlon.jpg': 'Cycling / Triathlon',
  'Dirt_Biking_Motocross.jpg': 'Dirt Biking / Motocross',
  'Gym_Fitness_Workout_Crossfit.jpg': 'Gym / Fitness / Workout / Crossfit',
  'Mindfullness_Meditation.jpg': 'Mindfullness / Meditation',
  'Mobility_Training_Stretching.jpg': 'Mobility Training / Stretching',
  'Overlanding_Van_Life.jpg': 'Overlanding / Van Life',
  'Pool_Billiards_Snooker.jpg': 'Pool / Billiards / Snooker',
  'Safari_Wild_Animal.jpg': 'Safari / Wild Animal',
  'Skiing_Snowboarding.jpg': 'Skiing / Snowboarding',
  'Wakeboarding_Waterskiing.jpg': 'Wakeboarding / Waterskiing',
  'Whale_Watching_Dolphin_Watching.jpg': 'Whale Watching / Dolphin Watching',
};

export const OnboardingStep6LifestyleScreen: React.FC<Props> = ({
  onNext,
  onBack,
  initialData = {},
  updateFormData,
}) => {
  const isDesktop = useIsDesktopWeb();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Record<string, string>>(
    (initialData.lifestyle_image_urls as Record<string, string>) || {},
  );
  const [loadingCustom, setLoadingCustom] = useState(false);
  const [flatListWidth, setFlatListWidth] = useState(0);

  const cardWidth = flatListWidth > 0
    ? Math.floor(
        (flatListWidth - SCROLL_HORIZONTAL_PAD * 2 - GRID_GAP * (COLUMNS - 1)) / COLUMNS,
      )
    : 0;

  // Build preset list once per mount instead of at module import — AppContent
  // imports this screen eagerly, so module-level work would run at app start.
  const PRESET_LIFESTYLES = useMemo<Preset[]>(() => {
    return Array.from(LIFESTYLE_BUCKET_IMAGE_FILENAMES)
      .map((filename) => {
        const url = getLifestyleImageBucketUrlForFilename(filename);
        if (!url) return null;
        const stem = filename.replace(/\.jpg$/i, '');
        return {
          keyword: stem.toLowerCase().replace(/_/g, ' '),
          label: MULTI_TITLE_LABELS[filename] ?? stem.replace(/_/g, ' '),
          imageUrl: url,
        };
      })
      .filter((p): p is Preset => p !== null)
      .sort((a, b) => a.label.localeCompare(b.label));
  }, []);

  // Debounce filtering — input stays instant, but the grid only recomputes
  // (and triggers any re-renders) after the user pauses typing.
  const debouncedSearch = useDebounce(search, SEARCH_DEBOUNCE_MS);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (q.length === 0) return PRESET_LIFESTYLES;
    return PRESET_LIFESTYLES.filter(
      (p) => p.label.toLowerCase().includes(q) || p.keyword.includes(q),
    );
  }, [debouncedSearch, PRESET_LIFESTYLES]);

  const showAddYourOwn =
    debouncedSearch.trim().length >= 2 &&
    filtered.length === 0 &&
    !selected[debouncedSearch.trim().toLowerCase()];

  // Mirror `selected` into a ref so `handleToggle` can stay stable (empty deps
  // useCallback) — that's what lets React.memo on LifestyleCard actually skip
  // rerenders of the ~75 cards on every interaction.
  const selectedRef = useRef(selected);
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  const updateFormDataRef = useRef(updateFormData);
  useEffect(() => { updateFormDataRef.current = updateFormData; }, [updateFormData]);

  const persist = useCallback((next: Record<string, string>) => {
    selectedRef.current = next;
    setSelected(next);
    updateFormDataRef.current({
      lifestyle_keywords: Object.keys(next),
      lifestyle_image_urls: next,
    });
  }, []);

  const handleToggle = useCallback((keyword: string, imageUrl: string) => {
    // Tapping a card also drops the search keyboard if it's up.
    Keyboard.dismiss();
    const current = selectedRef.current;
    const next = { ...current };
    if (next[keyword]) delete next[keyword];
    else next[keyword] = imageUrl;
    persist(next);
  }, [persist]);

  const handleAddYourOwn = useCallback(async () => {
    Keyboard.dismiss();
    const term = debouncedSearch.trim();
    if (!term) return;
    setLoadingCustom(true);
    try {
      const url = await getLifestyleImageFromPexels(term);
      if (url) {
        const next = { ...selectedRef.current, [term.toLowerCase()]: url };
        persist(next);
        // Don't clear search — user sees their pick in "Your picks" and
        // chooses when to return to the full grid via the X icon.
      } else {
        Alert.alert(
          'No image found',
          `We couldn't find a photo for "${term}". Try a different word.`,
        );
      }
    } finally {
      setLoadingCustom(false);
    }
  }, [debouncedSearch, persist]);

  const handleNext = () => {
    onNext({
      ...initialData,
      lifestyle_keywords: Object.keys(selected),
      lifestyle_image_urls: selected,
    } as OnboardingData);
  };

  useRegisterOnboardingStep({
    nextLabel: 'Next',
    canProceed: true,
    onNext: handleNext,
    onBack,
  });

  // Data fed to FlatList. Filtered presets + optional "add" synthetic.
  const data = useMemo<GridItem[]>(() => {
    const items: GridItem[] = filtered.map((p) => ({
      type: 'preset',
      keyword: p.keyword,
      label: p.label,
      imageUrl: p.imageUrl,
    }));
    if (showAddYourOwn) {
      items.push({ type: 'add', searchTerm: debouncedSearch.trim() });
    }
    return items;
  }, [filtered, showAddYourOwn, debouncedSearch]);

  const selectedEntries = useMemo(() => Object.entries(selected), [selected]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<GridItem>) => {
      if (item.type === 'preset') {
        return (
          <LifestyleCard
            keyword={item.keyword}
            label={item.label}
            imageUrl={item.imageUrl}
            width={cardWidth}
            selected={!!selected[item.keyword]}
            onToggle={handleToggle}
          />
        );
      }
      return (
        <AddYourOwnCard
          searchTerm={item.searchTerm}
          width={cardWidth}
          loading={loadingCustom}
          onPress={handleAddYourOwn}
        />
      );
    },
    [cardWidth, selected, handleToggle, loadingCustom, handleAddYourOwn],
  );

  const keyExtractor = useCallback(
    (item: GridItem) => (item.type === 'preset' ? item.keyword : `add:${item.searchTerm}`),
    [],
  );

  // When searching with existing picks, the grid shows "Suggestions" first
  // (this header) and "Your picks" after it (the footer below).
  const ListHeader = useMemo(() => {
    const showSections = search.trim().length > 0 && selectedEntries.length > 0;
    if (!showSections || cardWidth === 0) return null;
    if (filtered.length === 0 && !showAddYourOwn) return null;
    return (
      <View style={styles.headerWrap}>
        <Text style={styles.sectionLabel}>Suggestions</Text>
      </View>
    );
  }, [search, selectedEntries.length, cardWidth, filtered.length, showAddYourOwn]);

  const ListFooter = useMemo(() => {
    const showSections = search.trim().length > 0 && selectedEntries.length > 0;
    if (!showSections || cardWidth === 0) return null;
    return (
      <View style={styles.footerWrap}>
        <Text style={styles.sectionLabel}>Your picks</Text>
        <View style={styles.picksGrid}>
          {selectedEntries.map(([keyword, url]) => (
            <LifestyleCard
              key={`picked-${keyword}`}
              keyword={keyword}
              label={keyword}
              imageUrl={url}
              width={cardWidth}
              selected
              onToggle={handleToggle}
            />
          ))}
        </View>
      </View>
    );
  }, [search, selectedEntries, cardWidth, handleToggle]);

  return (
    <View style={styles.contentRoot}>
      <View style={styles.headerCopy}>
        <Text style={styles.subtitle}>What's your lifestyle?</Text>
        <Text style={styles.helper}>Pick at least 3!</Text>
      </View>

      <View style={styles.searchBarWrap}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={20} color="#A7B8C2" />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search"
            placeholderTextColor="#A7B8C2"
            style={styles.searchInput}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Ionicons name="close-circle" size={20} color="#A7B8C2" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <FlatList
        data={cardWidth > 0 ? data : []}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        numColumns={COLUMNS}
        columnWrapperStyle={styles.columnWrapper}
        ListHeaderComponent={ListHeader}
        ListFooterComponent={ListFooter}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        // Virtualization tuning — mirrors DirectMessageScreen.
        initialNumToRender={12}
        windowSize={5}
        maxToRenderPerBatch={9}
        updateCellsBatchingPeriod={32}
        removeClippedSubviews={Platform.OS === 'android'}
        style={styles.flatList}
        onLayout={(e) => {
          const w = e.nativeEvent.layout.width;
          if (w > 0 && w !== flatListWidth) setFlatListWidth(w);
        }}
      />
    </View>
  );
};

interface LifestyleCardProps {
  keyword: string;
  label: string;
  imageUrl: string;
  width: number;
  selected: boolean;
  onToggle: (keyword: string, imageUrl: string) => void;
}

const LifestyleCardImpl: React.FC<LifestyleCardProps> = ({
  keyword,
  label,
  imageUrl,
  width,
  selected,
  onToggle,
}) => {
  const handlePress = useCallback(() => onToggle(keyword, imageUrl), [onToggle, keyword, imageUrl]);
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={handlePress}
      style={[styles.card, { width }, selected && styles.cardSelected]}
    >
      <View style={styles.cardImageWrap}>
        <Image
          source={{ uri: imageUrl }}
          style={styles.cardImage}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={120}
          recyclingKey={keyword}
        />
        <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
          {selected && <Ionicons name="checkmark" size={12} color="#FFFFFF" />}
        </View>
      </View>
      <View style={styles.cardLabelWrap}>
        <Text style={styles.cardLabel} numberOfLines={2}>{label}</Text>
      </View>
    </TouchableOpacity>
  );
};

// React.memo with explicit comparator. With `onToggle` stable (useCallback []
// in the parent) and the other props unchanged for cards whose selection
// state didn't move, this short-circuits ~74 of the 75 cards on every toggle.
const LifestyleCard = React.memo(
  LifestyleCardImpl,
  (prev, next) =>
    prev.keyword === next.keyword &&
    prev.label === next.label &&
    prev.imageUrl === next.imageUrl &&
    prev.width === next.width &&
    prev.selected === next.selected &&
    prev.onToggle === next.onToggle,
);

interface AddYourOwnCardProps {
  searchTerm: string;
  loading: boolean;
  width: number;
  onPress: () => void;
}

const AddYourOwnCardImpl: React.FC<AddYourOwnCardProps> = ({
  searchTerm,
  loading,
  width,
  onPress,
}) => {
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      disabled={loading}
      style={[styles.card, { width }, styles.cardAddOwn]}
    >
      <View style={[styles.cardImageWrap, styles.cardAddImageWrap]}>
        {loading ? (
          <ActivityIndicator color="#212121" />
        ) : (
          <Ionicons name="add" size={32} color="#212121" />
        )}
      </View>
      <View style={styles.cardLabelWrap}>
        <Text style={styles.cardLabel} numberOfLines={2}>
          Add &quot;{searchTerm}&quot;
        </Text>
      </View>
    </TouchableOpacity>
  );
};

const AddYourOwnCard = React.memo(
  AddYourOwnCardImpl,
  (prev, next) =>
    prev.searchTerm === next.searchTerm &&
    prev.loading === next.loading &&
    prev.width === next.width &&
    prev.onPress === next.onPress,
);

const styles = StyleSheet.create({
  contentRoot: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: colors.backgroundGray || '#FAFAFA',
  },
  content: {
    flex: 1,
    paddingHorizontal: Platform.OS !== 'web' ? spacing.md : 0,
  },
  contentDesktop: {
    maxWidth: 800,
    alignSelf: 'center',
    width: '100%',
    paddingHorizontal: 0,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: Platform.OS === 'web' ? spacing.md : spacing.sm,
    height: 44,
  },
  headerDesktop: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
  },
  backButton: {
    width: 60,
    alignItems: 'flex-start',
  },
  stepText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
    lineHeight: 15,
  },
  skipButton: {
    width: 60,
    alignItems: 'flex-end',
    paddingHorizontal: 10,
    opacity: 0,
  },
  progressContainer: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    alignItems: 'center',
  },
  progressContainerDesktop: {
    paddingBottom: spacing.sm,
  },
  progressBar: {
    height: 4,
    backgroundColor: '#BDBDBD',
    borderRadius: 8,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#333333',
    borderRadius: 8,
  },
  headerCopy: {
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    gap: 4,
  },
  subtitle: {
    fontSize: 21,
    lineHeight: 28,
    fontWeight: '700',
    color: '#000000',
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
    ...Platform.select({
      web: { fontFamily: 'Montserrat, sans-serif' },
      default: { fontFamily: 'Montserrat' },
    }),
  },
  helper: {
    fontSize: 16,
    lineHeight: 24,
    color: '#7B7B7B',
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
    ...Platform.select({
      web: { fontFamily: 'Inter, sans-serif' },
      default: { fontFamily: 'Inter' },
    }),
  },
  searchBarWrap: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 48,
    paddingHorizontal: 16,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: '#D5D7DA',
    backgroundColor: '#FFFFFF',
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    lineHeight: 18,
    color: '#333333',
    ...Platform.select({
      web: { outlineStyle: 'none' as any, fontFamily: 'Inter, sans-serif' },
      default: { fontFamily: 'Inter' },
    }),
  },
  flatList: {
    flex: 1,
    // End the scroll area above the Next button so cards clip with a gap,
    // not flush against it.
    marginBottom: spacing.md,
  },
  scrollContent: {
    paddingHorizontal: SCROLL_HORIZONTAL_PAD,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    rowGap: GRID_GAP,
  },
  columnWrapper: {
    gap: GRID_GAP,
  },
  headerWrap: {
    paddingBottom: GRID_GAP,
  },
  footerWrap: {
    paddingTop: GRID_GAP,
  },
  picksGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
    marginBottom: 8,
  },
  sectionLabel: {
    fontSize: 12,
    color: '#7B7B7B',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 8,
    marginBottom: 8,
    ...Platform.select({
      web: { fontFamily: 'Inter, sans-serif' },
      default: { fontFamily: 'Inter' },
    }),
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 6,
    // Border is always present (transparent until selected) so toggling the
    // selection only recolours it — the card never changes size.
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#596E7C',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
      },
      android: { elevation: 2 },
      web: { boxShadow: '0px 2px 8px rgba(89, 110, 124, 0.15)' as any },
    }),
  },
  cardSelected: {
    borderColor: '#05BCD3',
  },
  cardAddOwn: {
    justifyContent: 'center',
  },
  cardImageWrap: {
    width: '100%',
    height: 108,
    position: 'relative',
    borderRadius: 8,
    overflow: 'hidden',
  },
  cardAddImageWrap: {
    backgroundColor: '#F2F2F2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardImage: {
    width: '100%',
    height: '100%',
    backgroundColor: '#E8E8E8',
    borderRadius: 8,
  },
  cardLabelWrap: {
    width: '100%',
    minHeight: 28,
    marginTop: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardLabel: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '500',
    color: '#333333',
    textAlign: 'center',
    textTransform: 'capitalize',
    ...Platform.select({
      web: { fontFamily: 'Inter, sans-serif' },
      default: { fontFamily: 'Inter' },
    }),
  },
  checkbox: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CFCFCF',
    backgroundColor: '#F7F7F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: {
    backgroundColor: '#05BCD3',
    borderColor: '#FFFFFF',
  },
  buttonContainer: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
    alignItems: 'center',
    width: '100%',
    flexShrink: 0,
  },
  buttonContainerDesktop: {
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.xxl,
    alignSelf: 'center',
  },
  primaryButton: {
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    backgroundColor: '#212121',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'System',
    color: colors.white || '#FFF',
    textAlign: 'center',
    lineHeight: 24,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});

export default OnboardingStep6LifestyleScreen;
