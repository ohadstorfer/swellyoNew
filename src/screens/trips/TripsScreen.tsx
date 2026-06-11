import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Image,
  RefreshControl,
  Modal,
  Alert,
  ScrollView,
  Platform,
  Dimensions,
  Animated,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
// Remote user-content images (trip covers, avatars) render through expo-image
// for its disk cache — URLs are immutable (timestamped filenames), so cached
// copies never go stale. Local bundled assets keep using RN's Image.
import { Image as CachedImage } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
const NOISE_TEXTURE = require('../../../assets/textures/noise.png');
const FONT_INTER = Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter';
const FONT_MONTSERRAT = Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat';
import { useOnboarding } from '../../context/OnboardingContext';
import {
  GroupTrip,
  HostingStyle,
  MyTripsBuckets,
  TripCardMeta,
} from '../../services/trips/groupTripsService';
import { TRIP_CHOOSER, TRIP_TYPE_PILL, TRIP_TYPE_GRADIENT } from '../../services/trips/tripVocabulary';
import { COUNTRY_NAMES } from '../../data/countryNames';
import { useQueryClient } from '@tanstack/react-query';
import { useExploreTrips, useMyTrips, tripsKeys } from '../../hooks/trips/useTripQueries';
import { useTripsListRealtime } from '../../hooks/trips/useTripsListRealtime';
import CreateTripWizard from './CreateTripWizard';
import { MyTripsSkeleton, ExploreDeckSkeleton } from '../../components/skeletons';
import { FadeInView } from '../../components/FadeInView';
import { WIZARD_STATE_VERSION } from './CreateTripFlowA';
import {
  peekTripWizardDraft,
  clearTripWizardDraft,
} from '../../hooks/useTripWizardDraft';
import TripDetailScreen from './TripDetailScreen';
import { useTripsBottomNavControl, type TripsBottomNavControl } from '../../components/trips/TripsBottomNav';
import { Images } from '../../assets/images';
import { Logo } from '../../components/Logo';
import { NotificationCenter } from '../../components/notifications/NotificationCenter';
import type { TripDetailFocus } from '../../services/notifications/notificationsService';
import Reanimated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
  SlideInRight,
  SlideOutRight,
} from 'react-native-reanimated';

// Hosting-style chooser content. Lifted out of CreateTripWizard so the chooser
// can live inline on the Create tab and the wizard becomes a pure router.
const HOSTING_STYLE_OPTIONS: {
  key: HostingStyle;
  title: string;
  desc: string;
  image: number; // placeholder thumbnail (any local asset)
}[] = [
  { key: 'A', ...TRIP_CHOOSER.A, image: Images.createTrip.plannedTogether },
  { key: 'B', ...TRIP_CHOOSER.B, image: Images.createTrip.hosted },
  { key: 'C', ...TRIP_CHOOSER.C, image: Images.createTrip.tripOperator },
];

export type TripsTab = 'explore' | 'my' | 'create';

interface TripsScreenProps {
  onBack: () => void;
  /** When provided (e.g. from a push tap), open the detail screen for this trip on mount. */
  initialTripId?: string | null;
  /** Landing spot inside the trip detail (notification deep-link), see TripDetailFocus. */
  initialTripFocus?: TripDetailFocus | null;
  /** Open the group chat linked to a trip. Lifted to AppContent so it can swap to the DM overlay. */
  onOpenGroupChat?: (params: { conversationId: string; title: string; heroImageUrl?: string | null; tripId?: string }) => void;
  /** Tap on a participant inside a trip detail opens their profile. AppContent
   *  records the current trip so the profile back returns here. */
  onViewUserProfile?: (userId: string, fromTripId: string) => void;
  /** Shared control for the app-level floating nav bar — the tab lists pipe
   *  their scroll events into it so the bar collapses/restores. */
  navControl?: TripsBottomNavControl;
  /** Reports when an internal full-screen overlay (trip detail / edit wizard)
   *  opens, so AppContent can hide the floating nav bar. */
  onInnerOverlayChange?: (open: boolean) => void;
}

// ---------------------------------------------------------------------------
// Header tabs (underline style, sit inside the dark header — per Figma)
// ---------------------------------------------------------------------------
const TripsHeaderTabs: React.FC<{
  active: TripsTab;
  onChange: (tab: TripsTab) => void;
}> = ({ active, onChange }) => {
  const tabs: { key: TripsTab; label: string }[] = [
    { key: 'my', label: 'My Trips' },
    { key: 'explore', label: 'Explore' },
    { key: 'create', label: 'Create' },
  ];
  return (
    <View style={styles.tabsRow}>
      {tabs.map(t => {
        const isActive = active === t.key;
        return (
          <TouchableOpacity
            key={t.key}
            style={[styles.tabBtn, isActive ? styles.tabBtnActive : styles.tabBtnInactive]}
            onPress={() => onChange(t.key)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
          >
            <Text style={[styles.tabLabel, isActive ? styles.tabLabelActive : styles.tabLabelInactive]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

// ---------------------------------------------------------------------------
// Trip card (shared by Explore + My Trips)
// ---------------------------------------------------------------------------
const formatTripDates = (trip: GroupTrip): string => {
  if (trip.start_date && trip.end_date) {
    const fmt = (d: string) =>
      new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const setInStone = trip.dates_set_in_stone ? '' : ' (flexible)';
    return `${fmt(trip.start_date)} - ${fmt(trip.end_date)}${setInStone}`;
  }
  if (trip.date_months && trip.date_months.length > 0) {
    return trip.date_months
      .map(m => {
        const [y, mo] = m.split('-');
        const date = new Date(Number(y), Number(mo) - 1, 1);
        return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
      })
      .join(' / ');
  }
  return 'Dates TBD';
};

// ISO-2 code → country name via an offline static map (Hermes has no
// Intl.DisplayNames). Falls back to the raw code only for unknown codes.
const countryName = (code: string | null | undefined): string | null => {
  if (!code) return null;
  const c = code.trim().toUpperCase();
  if (!c) return null;
  return COUNTRY_NAMES[c] || c;
};

// Location label. Rule: <spot/area>, <country> — and always keep the country
// visible (state is only a fallback when no country is set). Drops the geocoded
// "spot, area" short_label, which hid the country.
const formatDestination = (trip: GroupTrip): string => {
  const d = trip.destination;
  if (!d) return 'Destination TBD';
  const region = countryName(d.country) || d.admin_level_1?.trim() || '';
  const place = d.name?.trim() || '';
  if (place && place.toLowerCase() !== region.toLowerCase()) {
    return region ? `${place}, ${region}` : place;
  }
  return region || place || 'Destination TBD';
};

// Status drives the colored badge under the card image (mirrors the Figma
// Upcoming / Requested / Completed variants).
type TripCardStatus = 'upcoming' | 'requested' | 'completed';

const STATUS_BADGE: Record<
  TripCardStatus,
  { bg: string; icon: keyof typeof Ionicons.glyphMap; label: string }
> = {
  upcoming: { bg: '#84EBB4', icon: 'briefcase-outline', label: 'Upcoming' },
  requested: { bg: '#FFB443', icon: 'chatbox-ellipses-outline', label: 'Requested' },
  completed: { bg: '#F7F7F7', icon: 'checkmark-circle-outline', label: 'Completed' },
};

const TripCard: React.FC<{
  trip: GroupTrip;
  status: TripCardStatus;
  meta?: TripCardMeta;
  onPress?: () => void;
}> = ({ trip, status, meta, onPress }) => {
  const badge = STATUS_BADGE[status];
  const avatars = meta?.memberAvatars ?? [];
  const total = meta?.totalCount ?? trip.participant_count ?? 0;
  const overflow = total - avatars.length;

  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={onPress ? 0.9 : 1}
      onPress={onPress}
      disabled={!onPress}
    >
      <View style={styles.cardImageWrap}>
        {trip.hero_image_url ? (
          <CachedImage
            source={{ uri: trip.hero_image_url }}
            style={styles.cardImageBg}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={150}
          />
        ) : (
          <View style={[styles.cardImageBg, styles.cardImagePlaceholder]}>
            <Ionicons name="image-outline" size={32} color="#B0B0B0" />
          </View>
        )}

        {/* Host row (top-left) */}
        <View style={styles.hostRow}>
          {meta?.hostAvatar ? (
            <CachedImage
              source={{ uri: meta.hostAvatar }}
              style={styles.hostAvatar}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
          ) : (
            <View style={[styles.hostAvatar, styles.hostAvatarPlaceholder]}>
              <Ionicons name="person" size={24} color="#FFFFFF" />
            </View>
          )}
          {!!meta?.hostName && (
            <Text style={styles.hostName} numberOfLines={1}>
              {meta.hostName}
            </Text>
          )}
        </View>

        {/* Noise-glass panel behind the title/location (Figma: blur 3.5px +
            black 0.2 tint + fractalNoise grain). Parent clips the rounded corners. */}
        <View style={styles.cardTextBlock}>
          <BlurView intensity={20} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={styles.cardGlassTint} pointerEvents="none" />
          <Image
            source={NOISE_TEXTURE}
            style={styles.cardNoise}
            resizeMode="repeat"
            pointerEvents="none"
          />
          <View style={styles.cardTextContent}>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {trip.title?.trim() || formatDestination(trip)}
            </Text>
            <Text style={styles.cardDesc} numberOfLines={1}>
              {formatDestination(trip)}
            </Text>
          </View>
        </View>

        {/* Participant cluster (bottom-right). Falls back to an icon + count when
            no avatars are available (e.g. Explore trips the viewer isn't in). */}
        {avatars.length > 0 ? (
          <View style={[styles.avatarCluster, overflow <= 0 && styles.avatarClusterTight]}>
            {avatars.map((uri, i) => (
              <Image
                key={`${uri}-${i}`}
                source={{ uri }}
                style={[
                  styles.clusterAvatar,
                  i > 0 && styles.clusterAvatarOverlap,
                  { zIndex: avatars.length - i },
                ]}
              />
            ))}
            {overflow > 0 && <Text style={styles.clusterMore}>+{overflow}</Text>}
          </View>
        ) : total > 0 ? (
          <View style={[styles.avatarCluster, styles.avatarClusterCount]}>
            <Ionicons name="people" size={16} color="#7B7B7B" />
            <Text style={styles.clusterMore}>{total}</Text>
          </View>
        ) : null}
      </View>

      {/* Status badge */}
      <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
        <View style={styles.statusIcon}>
          <Ionicons name={badge.icon} size={18} color="#0A0A0A" />
        </View>
        <View style={styles.statusTextRow}>
          <Text style={styles.statusLabel}>{badge.label}</Text>
          <Text style={styles.statusDate}>{formatTripDates(trip)}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
};

// ---------------------------------------------------------------------------
// Filter pills (My Trips) — All / Upcoming (n) / Requested (n) / Completed (n)
// ---------------------------------------------------------------------------
type TripFilter = 'all' | 'upcoming' | 'requested' | 'completed';

const TripFilterBar: React.FC<{
  active: TripFilter;
  counts: { upcoming: number; requested: number; completed: number };
  onChange: (f: TripFilter) => void;
}> = ({ active, counts, onChange }) => {
  const items: { key: TripFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'upcoming', label: `Upcoming (${counts.upcoming})` },
    { key: 'requested', label: `Requested (${counts.requested})` },
    { key: 'completed', label: `Completed (${counts.completed})` },
  ];
  return (
    <View style={styles.filterRow}>
      {items.map(it => {
        const isActive = active === it.key;
        return (
          <TouchableOpacity
            key={it.key}
            style={[styles.filterPill, isActive ? styles.filterPillActive : styles.filterPillInactive]}
            onPress={() => onChange(it.key)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
          >
            <Text
              numberOfLines={1}
              style={[styles.filterText, isActive ? styles.filterTextActive : styles.filterTextInactive]}
            >
              {it.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

// ---------------------------------------------------------------------------
// Explore card (Figma 12506:16019) — richer than My Trips: trip-type pill,
// price, dates, spots-left and occupancy instead of a personal status badge.
// ---------------------------------------------------------------------------
const TRIP_TYPE: Record<
  HostingStyle,
  { label: string; icon: keyof typeof Ionicons.glyphMap }
> = {
  A: { label: TRIP_TYPE_PILL.A, icon: 'people-outline' },
  B: { label: TRIP_TYPE_PILL.B, icon: 'star-outline' },
  C: { label: TRIP_TYPE_PILL.C, icon: 'briefcase-outline' },
};

const formatTripPrice = (trip: GroupTrip): string | null => {
  if (trip.cost_per_person != null) return `$${trip.cost_per_person}`;
  if (trip.budget_min != null && trip.budget_max != null) {
    return `$${trip.budget_min} - ${trip.budget_max}`;
  }
  return null;
};

const ExploreTripCard: React.FC<{
  trip: GroupTrip;
  meta?: TripCardMeta;
  onPress?: () => void;
}> = ({ trip, meta, onPress }) => {
  const type = TRIP_TYPE[trip.hosting_style] ?? TRIP_TYPE.A;
  const typeGradient = TRIP_TYPE_GRADIENT[trip.hosting_style] ?? TRIP_TYPE_GRADIENT.A;
  const avatars = meta?.memberAvatars ?? [];
  const count = meta?.totalCount ?? trip.participant_count ?? 0;
  const max = trip.max_participants;
  const spotsLeft = max != null ? Math.max(0, max - count) : null;
  const occupancy = max != null ? `${count}/${max}` : `${count}`;
  const price = formatTripPrice(trip);

  const headline = trip.title || formatDestination(trip);
  const location = formatDestination(trip);
  const showLocation = !!trip.title && !!location && location !== headline;

  return (
    <TouchableOpacity
      style={styles.exCard}
      activeOpacity={onPress ? 0.9 : 1}
      onPress={onPress}
      disabled={!onPress}
    >
      {trip.hero_image_url ? (
        <CachedImage
          source={{ uri: trip.hero_image_url }}
          style={styles.cardImageBg}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={150}
        />
      ) : (
        <View style={[styles.cardImageBg, styles.cardImagePlaceholder]}>
          <Ionicons name="image-outline" size={32} color="#B0B0B0" />
        </View>
      )}

      {/* Host row (top-left) */}
      <View style={styles.hostRow}>
        {meta?.hostAvatar ? (
          <CachedImage
            source={{ uri: meta.hostAvatar }}
            style={styles.hostAvatar}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
        ) : (
          <View style={[styles.hostAvatar, styles.hostAvatarPlaceholder]}>
            <Ionicons name="person" size={18} color="#FFFFFF" />
          </View>
        )}
        {!!meta?.hostName && (
          <Text style={styles.hostName} numberOfLines={1}>
            {meta.hostName}
          </Text>
        )}
      </View>

      {/* Trip-type pill (top-right) — coloured per hosting style, matching the
          gradient tag in the trip Overview (Crew=blue, Captain=purple, Operator=gold). */}
      <LinearGradient
        colors={typeGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.tripTypePill}
      >
        <Ionicons name={type.icon} size={14} color="#FFFFFF" />
        <Text style={styles.tripTypeLabel}>{type.label}</Text>
      </LinearGradient>

      {/* Noise-glass panel — same layers as the My Trips card (blur 3.5px +
          black tint + fractalNoise grain). Parent clips the rounded corners. */}
      <View style={styles.exBottom}>
        <BlurView intensity={20} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={styles.cardGlassTint} pointerEvents="none" />
        <Image
          source={NOISE_TEXTURE}
          style={styles.cardNoise}
          resizeMode="repeat"
          pointerEvents="none"
        />
        <View style={styles.exContent}>
          <View style={styles.exHeadings}>
            <Text style={styles.cardTitle} numberOfLines={2}>
              {headline}
            </Text>
            {showLocation && (
              <Text style={styles.cardDesc} numberOfLines={1}>
                {location}
              </Text>
            )}
          </View>

          <View style={styles.exInfoRow}>
            <View style={styles.exInfoLeft}>
              {!!price && <Text style={styles.exPrice}>{price}</Text>}
              <Text style={styles.exDates}>{formatTripDates(trip)}</Text>
            </View>

            <View style={styles.exInfoRight}>
              {spotsLeft != null && (
                <Text style={styles.exSpots}>
                  {spotsLeft} spot{spotsLeft === 1 ? '' : 's'} left
                </Text>
              )}
              {(avatars.length > 0 || count > 0) && (
                <View style={styles.exCluster}>
                  {avatars.length > 0 ? (
                    avatars.map((uri, i) => (
                      <Image
                        key={`${uri}-${i}`}
                        source={{ uri }}
                        style={[
                          styles.clusterAvatar,
                          i > 0 && styles.clusterAvatarOverlap,
                          { zIndex: avatars.length - i },
                        ]}
                      />
                    ))
                  ) : (
                    <Ionicons name="people" size={16} color="#7B7B7B" style={{ marginLeft: 6 }} />
                  )}
                  <Text style={styles.clusterMore}>{occupancy}</Text>
                </View>
              )}
            </View>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
};

// ---------------------------------------------------------------------------
// Explore card carousel (Figma 11966:32391).
// A horizontal snap carousel: each card slides into the center, snaps there with
// momentum, and is fully bidirectional. The first and last trips are hard bounds
// (no looping). The centered card is full-size; neighbours peek, slightly smaller
// and dimmer, driven by the scroll position. The card itself (ExploreTripCard) is
// unchanged — only its placement + the animation.
// ---------------------------------------------------------------------------
const { width: DECK_SCREEN_W } = Dimensions.get('window');
const DECK_SIDE_SCALE = 0.85; // neighbour cards shrink to this
// The card width is DERIVED from the gap + peek we want, so both survive on any
// width: narrow screens just get a slightly smaller card. Capped at 366 so it
// doesn't balloon on tablets/web (there the peek is simply larger).
//   • DECK_GAP  — gap between the centred card and the tip. Must exceed the
//     tilt's corner reach (~16px at 5°) or the rotated corner overlaps.
//   • DECK_PEEK — guaranteed visible width of the neighbour tip.
const DECK_GAP = 28;
const DECK_PEEK = 12;
const DECK_CARD_W = Math.min(366, DECK_SCREEN_W - 2 * (DECK_GAP + DECK_PEEK));
const DECK_CARD_H = Math.round((DECK_CARD_W * 384) / 328); // card aspect ratio
const DECK_ITEM_W = DECK_CARD_W + DECK_GAP; // per-card scroll step (card + gap)
const DECK_SIDE_PAD = Math.max(0, (DECK_SCREEN_W - DECK_ITEM_W) / 2); // centers ends
// Centre-pivot scaling pulls a neighbour's inner edge inward by half the width
// it loses; shift it back so the tip peeks by the layout margin, not less.
const DECK_SIDE_SHIFT = Math.round(((1 - DECK_SIDE_SCALE) * DECK_CARD_W) / 2);
const DECK_SIDE_OPACITY = 0.6; // neighbour cards dim to this
const DECK_SIDE_ROTATION = 5; // deg — neighbours tilt out, straightening into center (Figma rotate-4)
// Scaling shrinks neighbours about their centre, which lifts their bottom edge.
// Drop them by half the height lost so their lower edge stays level with the
// centred card's lower edge.
const DECK_SIDE_DROP = Math.round((DECK_CARD_H * (1 - DECK_SIDE_SCALE)) / 2) + 6;

const TripDeck: React.FC<{
  trips: GroupTrip[];
  meta: Map<string, TripCardMeta>;
  onOpenTrip: (tripId: string) => void;
  /** Fires (throttled) while the user swipes the deck sideways. */
  onUserScroll?: () => void;
}> = ({ trips, meta, onOpenTrip, onUserScroll }) => {
  const listRef = useRef<FlatList<GroupTrip>>(null);
  // Drives the per-card scale/opacity interpolation.
  const scrollX = useRef(new Animated.Value(0)).current;
  // Last offset at which we notified the parent — keeps the JS callback off
  // the per-frame scroll path (we only re-fire every 24px of travel).
  const lastReportedX = useRef(0);

  // Reset to the first card if the deck contents change (e.g. after a reload).
  useEffect(() => {
    scrollX.setValue(0);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [trips, scrollX]);

  const renderItem = useCallback(
    ({ item, index }: { item: GroupTrip; index: number }) => {
      const inputRange = [
        (index - 1) * DECK_ITEM_W,
        index * DECK_ITEM_W,
        (index + 1) * DECK_ITEM_W,
      ];
      const scale = scrollX.interpolate({
        inputRange,
        outputRange: [DECK_SIDE_SCALE, 1, DECK_SIDE_SCALE],
        extrapolate: 'clamp',
      });
      const opacity = scrollX.interpolate({
        inputRange,
        outputRange: [DECK_SIDE_OPACITY, 1, DECK_SIDE_OPACITY],
        extrapolate: 'clamp',
      });
      // Tilt: a card to the right of center leans +Nº, to the left −Nº, and
      // straightens to 0º exactly when centered — interpolated by scroll position.
      const rotate = scrollX.interpolate({
        inputRange,
        outputRange: [`${DECK_SIDE_ROTATION}deg`, '0deg', `-${DECK_SIDE_ROTATION}deg`],
        extrapolate: 'clamp',
      });
      // Compensate for the centre-pivot scale so neighbour bottoms stay aligned
      // with the centred card's bottom edge.
      const translateY = scrollX.interpolate({
        inputRange,
        outputRange: [DECK_SIDE_DROP, 0, DECK_SIDE_DROP],
        extrapolate: 'clamp',
      });
      // Re-expose the scaled neighbour's inner edge: the right-side neighbour
      // shifts left, the left-side neighbour shifts right, so each peeks by the
      // full layout margin (the tip stays visible on any screen width).
      const translateX = scrollX.interpolate({
        inputRange,
        outputRange: [-DECK_SIDE_SHIFT, 0, DECK_SIDE_SHIFT],
        extrapolate: 'clamp',
      });

      return (
        <View style={styles.deckSlot}>
          <Animated.View style={[styles.deckCard, { transform: [{ translateX }, { translateY }, { scale }, { rotate }], opacity }]}>
            <ExploreTripCard
              trip={item}
              meta={meta.get(item.id)}
              onPress={() => onOpenTrip(item.id)}
            />
          </Animated.View>
        </View>
      );
    },
    [scrollX, meta, onOpenTrip],
  );

  return (
    <View style={styles.deckRoot}>
      <Animated.FlatList
        ref={listRef}
        data={trips}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={DECK_ITEM_W}
        snapToAlignment="start"
        decelerationRate="fast"
        disableIntervalMomentum
        // 1 (not 16) so the card transform gets every display frame. At 16 the
        // scroll-event stream is capped to ~60/s while a ProMotion screen runs at
        // 120 — fine during fast motion, but at the slow tail of the snap the
        // transform steps at half the display rate and clips into its final state.
        scrollEventThrottle={1}
        getItemLayout={(_, index) => ({
          length: DECK_ITEM_W,
          offset: index * DECK_ITEM_W,
          index,
        })}
        onScroll={e => {
          const x = e.nativeEvent.contentOffset.x;
          scrollX.setValue(x);
          if (onUserScroll && Math.abs(x - lastReportedX.current) > 24) {
            lastReportedX.current = x;
            onUserScroll();
          }
        }}
        contentContainerStyle={[styles.deckContent, { paddingHorizontal: DECK_SIDE_PAD }]}
        {...(Platform.OS === 'web' && {
          style: {
            overflowX: 'auto' as any,
            overflowY: 'hidden' as any,
            WebkitOverflowScrolling: 'touch' as any,
          } as any,
        })}
      />
    </View>
  );
};

// ---------------------------------------------------------------------------
// Explore filters (Figma 11966:32392) — month + budget chips, all client-side.
// Chips toggle independently. Within a group (months / budget) the matches are
// OR'd; across groups they're AND'd. "All" clears every selection.
// ---------------------------------------------------------------------------
const BUDGET_THRESHOLD = 1000; // $ — the below/above split point (boundary inclusive)

type ExploreChipKind = 'month' | 'budget';
interface ExploreChip {
  id: string;
  label: string;
  kind: ExploreChipKind;
  value: string; // month → "YYYY-MM"; budget → "below" | "above"
}

// Three rolling month chips derived from the device clock, so the labels move
// forward on their own every month. First two read "This/Next Month"; the third
// shows the literal month name (e.g. "August").
const buildExploreChips = (now: Date): ExploreChip[] => {
  const ymOffset = (offset: number) => {
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const name = d.toLocaleDateString(undefined, { month: 'long' });
    return { ym, name };
  };
  const m0 = ymOffset(0);
  const m1 = ymOffset(1);
  const m2 = ymOffset(2);
  return [
    { id: `m:${m0.ym}`, label: 'This Month', kind: 'month', value: m0.ym },
    { id: `m:${m1.ym}`, label: 'Next Month', kind: 'month', value: m1.ym },
    { id: `m:${m2.ym}`, label: m2.name, kind: 'month', value: m2.ym },
    { id: 'b:below', label: `Below $${BUDGET_THRESHOLD / 1000}k`, kind: 'budget', value: 'below' },
    { id: 'b:above', label: `Above $${BUDGET_THRESHOLD / 1000}k`, kind: 'budget', value: 'above' },
  ];
};

// A trip happens in month "YYYY-MM" if its loose months list includes it, or if
// the month falls within the firm start..end range (so a Jun–Jul trip matches
// both June and July). Trips with no dates ("TBD") match no month filter.
const tripInMonth = (trip: GroupTrip, ym: string): boolean => {
  if (trip.date_months?.some(m => m === ym)) return true;
  if (trip.start_date && trip.end_date) {
    return ym >= trip.start_date.slice(0, 7) && ym <= trip.end_date.slice(0, 7);
  }
  return false;
};

// Collapse the three possible budget shapes into one [min, max] band: a flat
// per-person price is a zero-width band; otherwise the min/max pair.
const tripBudgetBand = (trip: GroupTrip): [number, number] | null => {
  if (trip.cost_per_person != null) return [trip.cost_per_person, trip.cost_per_person];
  const lo = trip.budget_min;
  const hi = trip.budget_max;
  if (lo != null || hi != null) {
    const min = lo ?? hi!;
    const max = hi ?? lo!;
    return [min, max];
  }
  return null;
};

// "Below" = the band dips to/under the threshold; "Above" = it reaches/over it.
// Boundary is inclusive both ways, so a trip priced exactly at the threshold
// matches both chips.
const tripInBudget = (trip: GroupTrip, value: string): boolean => {
  const band = tripBudgetBand(trip);
  if (!band) return false;
  return value === 'below' ? band[0] <= BUDGET_THRESHOLD : band[1] >= BUDGET_THRESHOLD;
};

const applyExploreFilters = (
  trips: GroupTrip[],
  chips: ExploreChip[],
  selected: Set<string>,
): GroupTrip[] => {
  if (selected.size === 0) return trips;
  const months = chips.filter(c => c.kind === 'month' && selected.has(c.id)).map(c => c.value);
  const budgets = chips.filter(c => c.kind === 'budget' && selected.has(c.id)).map(c => c.value);
  return trips.filter(t => {
    const monthOk = months.length === 0 || months.some(ym => tripInMonth(t, ym));
    const budgetOk = budgets.length === 0 || budgets.some(v => tripInBudget(t, v));
    return monthOk && budgetOk;
  });
};

const ExploreHeader: React.FC<{
  chips: ExploreChip[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onClear: () => void;
}> = ({ chips, selected, onToggle, onClear }) => {
  const allActive = selected.size === 0;
  return (
    <View style={styles.exHeader}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.exFilterRow}
      >
        <TouchableOpacity
          style={[styles.exFilterPill, allActive ? styles.exFilterPillActive : styles.exFilterPillInactive]}
          onPress={onClear}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityState={{ selected: allActive }}
        >
          <Text style={allActive ? styles.exFilterTextActive : styles.exFilterTextInactive}>All</Text>
        </TouchableOpacity>
        {chips.map(chip => {
          const active = selected.has(chip.id);
          return (
            <TouchableOpacity
              key={chip.id}
              style={[styles.exFilterPill, active ? styles.exFilterPillActive : styles.exFilterPillInactive]}
              onPress={() => onToggle(chip.id)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={active ? styles.exFilterTextActive : styles.exFilterTextInactive}>
                {chip.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
};

// ---------------------------------------------------------------------------
// Explore view
// ---------------------------------------------------------------------------
// Stable empty fallbacks so a loading/disabled query doesn't hand a fresh
// reference to children every render (avoids needless re-renders).
const EMPTY_META: Map<string, TripCardMeta> = new Map();
const EMPTY_BUCKETS: MyTripsBuckets = { approved: [], pending: [], past: [] };

// Views pipe their raw vertical scroll events to the bar's controller
// (useTripsBottomNavControl), which maps them to the collapse scroll-linked.
type NavScrollHandler = (e: NativeSyntheticEvent<NativeScrollEvent>) => void;

const ExploreTripsView: React.FC<{
  onOpenTrip: (tripId: string) => void;
  onNavScroll?: NavScrollHandler;
  onDeckScroll?: () => void;
}> = ({ onOpenTrip, onNavScroll, onDeckScroll }) => {
  // Cached + stale-while-revalidate. The data survives tab switches and
  // leaving/re-entering Trips, so re-entry is instant (no skeleton) and only
  // revalidates silently in the background when stale.
  const { data, isLoading } = useExploreTrips();
  const trips = data?.trips ?? [];
  const meta = data?.meta ?? EMPTY_META;

  // Month chips roll off the device clock; built once per mount.
  const chips = useMemo(() => buildExploreChips(new Date()), []);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggleChip = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);
  const clearChips = useCallback(() => setSelected(new Set()), []);

  const filtered = useMemo(
    () => applyExploreFilters(trips, chips, selected),
    [trips, chips, selected],
  );

  if (isLoading) {
    return <ExploreDeckSkeleton />;
  }

  if (trips.length === 0) {
    return (
      <FadeInView style={styles.emptyState}>
        <Ionicons name="compass-outline" size={48} color="#B0B0B0" />
        <Text style={styles.emptyText}>No group trips yet. Be the first to create one!</Text>
      </FadeInView>
    );
  }

  // Vertical scroll of horizontal swipe-deck carousels. "Popular" shows the
  // filtered set; "Trip Operators" narrows that to operator-run trips (style 'C').
  const operatorTrips = filtered.filter(t => t.hosting_style === 'C');
  return (
    <FadeInView style={styles.fillFlex}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.exScrollContent}
        onScroll={onNavScroll}
        scrollEventThrottle={16}
      >
        <Text style={styles.exploreTitle}>Discover the world{'\n'}with Swellyo</Text>
        <ExploreHeader
          chips={chips}
          selected={selected}
          onToggle={toggleChip}
          onClear={clearChips}
        />
        {filtered.length === 0 ? (
          <View style={styles.filterEmpty}>
            <Text style={styles.emptyText}>No trips match these filters.</Text>
          </View>
        ) : (
          <>
            <Text style={styles.exSectionTitle}>Popular</Text>
            <TripDeck trips={filtered} meta={meta} onOpenTrip={onOpenTrip} onUserScroll={onDeckScroll} />
            {operatorTrips.length > 0 && (
              <>
                <Text style={[styles.exSectionTitle, styles.exSectionTitleStacked]}>Trip Operators</Text>
                <TripDeck trips={operatorTrips} meta={meta} onOpenTrip={onOpenTrip} onUserScroll={onDeckScroll} />
              </>
            )}
          </>
        )}
      </ScrollView>
    </FadeInView>
  );
};

// ---------------------------------------------------------------------------
// My Trips view
// ---------------------------------------------------------------------------
// Bucket → card status: approved trips are upcoming, pending join requests are
// "requested", past trips are completed.
const BUCKET_STATUS: Record<'approved' | 'pending' | 'past', TripCardStatus> = {
  approved: 'upcoming',
  pending: 'requested',
  past: 'completed',
};

// Stagger only the first few cards on their first appearance — a short cascade
// (Emil: 30–80ms between items). Cards beyond this, and any card scrolled back
// into view, appear instantly so recycling never re-triggers the reveal.
const STAGGER_COUNT = 4;
const STAGGER_MS = 55;

const MyTripsView: React.FC<{
  userId: string | null;
  onGoCreate: () => void;
  onOpenTrip: (tripId: string) => void;
  onNavScroll?: NavScrollHandler;
}> = ({ userId, onGoCreate, onOpenTrip, onNavScroll }) => {
  // Cached + stale-while-revalidate (see useExploreTrips). Re-entry is instant;
  // pull-to-refresh and post-create/edit invalidation drive background updates.
  const { data, isLoading, isFetching, refetch } = useMyTrips(userId);
  const buckets = data?.buckets ?? EMPTY_BUCKETS;
  const meta = data?.meta ?? EMPTY_META;
  const [filter, setFilter] = useState<TripFilter>('all');
  // Flips true once the initial stagger window has elapsed, so scrolling /
  // recycling never re-triggers the reveal. (A per-render mutation would
  // misbehave under StrictMode's double render, so we use a post-load timer.)
  const hasRevealedRef = useRef(false);

  // Once the list has loaded, let the first-batch stagger play, then freeze the
  // reveal so later scrolls don't re-animate the top cards.
  useEffect(() => {
    if (isLoading) return;
    const t = setTimeout(() => {
      hasRevealedRef.current = true;
    }, STAGGER_COUNT * STAGGER_MS + 350);
    return () => clearTimeout(t);
  }, [isLoading]);

  // Flatten buckets into one tagged list, then filter by the active pill.
  const tagged: { trip: GroupTrip; status: TripCardStatus }[] = [
    ...buckets.approved.map(trip => ({ trip, status: BUCKET_STATUS.approved })),
    ...buckets.pending.map(trip => ({ trip, status: BUCKET_STATUS.pending })),
    ...buckets.past.map(trip => ({ trip, status: BUCKET_STATUS.past })),
  ];
  const counts = {
    upcoming: buckets.approved.length,
    requested: buckets.pending.length,
    completed: buckets.past.length,
  };
  const visible = filter === 'all' ? tagged : tagged.filter(x => x.status === filter);

  if (isLoading) {
    return <MyTripsSkeleton />;
  }

  if (tagged.length === 0) {
    return (
      <FadeInView style={styles.emptyState}>
        <Ionicons name="airplane-outline" size={48} color="#B0B0B0" />
        <Text style={styles.emptyText}>You haven't joined or created any trips yet.</Text>
        <TouchableOpacity testID="trips-empty-create-button" style={styles.emptyCta} onPress={onGoCreate}>
          <Text style={styles.emptyCtaText}>Create your first trip</Text>
        </TouchableOpacity>
      </FadeInView>
    );
  }

  return (
    <FlatList
      data={visible}
      keyExtractor={x => x.trip.id}
      onScroll={onNavScroll}
      scrollEventThrottle={16}
      ListHeaderComponent={
        <FadeInView>
          <TripFilterBar active={filter} counts={counts} onChange={setFilter} />
        </FadeInView>
      }
      renderItem={({ item, index }) => {
        const card = (
          <TripCard
            trip={item.trip}
            status={item.status}
            meta={meta.get(item.trip.id)}
            onPress={() => onOpenTrip(item.trip.id)}
          />
        );
        // Stagger only the first few cards during the initial reveal window;
        // the rest (and anything scrolled in later) snap in instantly.
        return !hasRevealedRef.current && index < STAGGER_COUNT ? (
          <FadeInView delay={index * STAGGER_MS}>{card}</FadeInView>
        ) : (
          card
        );
      }}
      contentContainerStyle={styles.listContent}
      ListEmptyComponent={
        <View style={styles.filterEmpty}>
          <Text style={styles.emptyText}>Nothing here yet.</Text>
        </View>
      }
      refreshControl={
        <RefreshControl
          refreshing={isFetching && !isLoading}
          onRefresh={() => {
            refetch();
          }}
        />
      }
    />
  );
};

// ---------------------------------------------------------------------------
// Tab pager — slide + cross-fade between the three tabs
// ---------------------------------------------------------------------------
// Visual order MUST match the header bar (My Trips · Explore · Create) so the
// slide direction matches where the user taps. All three panes stay mounted
// (preserves scroll + react-query state); we only translate the row and
// cross-fade each pane as it crosses the viewport.
const TAB_ORDER: TripsTab[] = ['my', 'explore', 'create'];
const SLIDE_DURATION = 300; // occasional action → snappy (stays at/under ~300ms)
const SLIDE_EASING = Easing.out(Easing.cubic); // strong ease-out (matches onboarding)

const TabPane: React.FC<{
  index: number;
  width: number;
  tx: SharedValue<number>;
  reduceMotion: boolean;
  children: React.ReactNode;
}> = ({ index, width, tx, reduceMotion, children }) => {
  const style = useAnimatedStyle(() => {
    if (reduceMotion || width === 0) return { opacity: 1 };
    // offset === 0 when this pane is centered in the viewport; ±width when fully
    // off-screen on either side. Fade out as it leaves, fade in as it arrives.
    const offset = tx.value + index * width;
    return {
      opacity: interpolate(offset, [-width, 0, width], [0, 1, 0], Extrapolation.CLAMP),
    };
  });
  return <Reanimated.View style={[styles.fillFlex, style]}>{children}</Reanimated.View>;
};

// ---------------------------------------------------------------------------
// Wrapper screen
// ---------------------------------------------------------------------------
export default function TripsScreen({ onBack, initialTripId, initialTripFocus, onOpenGroupChat, onViewUserProfile, navControl: navControlProp, onInnerOverlayChange }: TripsScreenProps) {
  const insets = useSafeAreaInsets();
  const { user: contextUser } = useOnboarding();
  const currentUserId = contextUser?.id?.toString() ?? null;

  const queryClient = useQueryClient();
  const reduceMotion = useReducedMotion();

  // Keep Explore + My Trips live while this screen is mounted — new trips,
  // card edits, member counts. Per-trip realtime is useTripRealtime in detail.
  useTripsListRealtime();

  const [activeTab, setActiveTab] = useState<TripsTab>('explore');
  // Tabs are lazily mounted on first visit, then kept mounted (translated
  // off-screen in the pager row) so switching back is instant and scroll
  // position + react-query state are preserved.
  const [visited, setVisited] = useState<Record<TripsTab, boolean>>({
    explore: true,
    my: false,
    create: false,
  });

  // --- Tab pager animation -------------------------------------------------
  const activeIndex = TAB_ORDER.indexOf(activeTab);
  const [bodyW, setBodyW] = useState(Dimensions.get('window').width);
  // Start positioned on the initial tab so there's no slide on first open.
  const tx = useSharedValue(-TAB_ORDER.indexOf('explore') * Dimensions.get('window').width);
  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));
  const firstSlide = useRef(true);

  // --- Bottom nav -----------------------------------------------------------
  // The floating bar lives at AppContent level; we receive its shared control
  // and pipe the tab lists' scroll events into it (scroll down collapses,
  // scroll up restores, sideways deck swipes collapse). The local instance is
  // only a fallback for renders without the prop.
  const ownNavControl = useTripsBottomNavControl();
  const navControl = navControlProp ?? ownNavControl;
  const handleMyNavScroll = useCallback<NavScrollHandler>(
    e => navControl.onVerticalScroll('my', e),
    [navControl],
  );
  const handleExploreNavScroll = useCallback<NavScrollHandler>(
    e => navControl.onVerticalScroll('explore', e),
    [navControl],
  );
  const handleCreateNavScroll = useCallback<NavScrollHandler>(
    e => navControl.onVerticalScroll('create', e),
    [navControl],
  );

  // Switch tabs: mark visited synchronously (so the incoming pane has content as
  // it slides in — no empty-cell flash) and set the active tab.
  const goToTab = useCallback((tab: TripsTab) => {
    setVisited(prev => (prev[tab] ? prev : { ...prev, [tab]: true }));
    setActiveTab(tab);
  }, []);

  // Slide the row when the active tab changes (skip the very first run so the
  // screen opens already positioned, not sliding in).
  useEffect(() => {
    if (firstSlide.current) {
      firstSlide.current = false;
      tx.value = -activeIndex * bodyW;
      return;
    }
    tx.value = withTiming(-activeIndex * bodyW, {
      duration: reduceMotion ? 0 : SLIDE_DURATION,
      easing: SLIDE_EASING,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex]);

  // Snap (no slide) when the viewport width changes — first measure / rotation.
  useEffect(() => {
    tx.value = -activeIndex * bodyW;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyW]);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(initialTripId ?? null);
  // Section the detail screen should land on (notification deep-links only;
  // manual opens leave it null). Cleared on back so it never re-applies.
  const [selectedTripFocus, setSelectedTripFocus] = useState<TripDetailFocus | null>(
    initialTripId ? initialTripFocus ?? null : null
  );
  const openTripFromNotification = useCallback((tripId: string, focus?: TripDetailFocus) => {
    setSelectedTripFocus(focus ?? null);
    setSelectedTripId(tripId);
  }, []);
  const [editingTrip, setEditingTrip] = useState<GroupTrip | null>(null);
  // Tell AppContent when a full-screen inner overlay (trip detail / edit) is
  // up, so the app-level floating nav bar hides instead of floating over it.
  useEffect(() => {
    onInnerOverlayChange?.(!!(selectedTripId || editingTrip));
    return () => onInnerOverlayChange?.(false);
  }, [selectedTripId, editingTrip, onInnerOverlayChange]);
  // Which hosting style the user picked from the inline chooser on the Create
  // tab. null = chooser visible; non-null = wizard open in the create modal.
  const [pendingStyle, setPendingStyle] = useState<HostingStyle | null>(null);
  const [wizardStarted, setWizardStarted] = useState(false);
  // true when the wizard should load the saved draft (user tapped "Continue" on
  // the resume prompt). Reset to false for a fresh start.
  const [resumeDraft, setResumeDraft] = useState(false);

  const createModalVisible = pendingStyle !== null;

  // Tapping a flow card: if there's a saved draft for THIS flow, ask whether to
  // resume it before opening the wizard. A draft from a different flow is left
  // untouched (it gets overwritten only once this flow first saves).
  const openWizard = (key: HostingStyle, resume: boolean) => {
    setResumeDraft(resume);
    setPendingStyle(key);
  };

  const onPickStyle = async (key: HostingStyle) => {
    const draft = await peekTripWizardDraft();
    const hasResumableDraft =
      !!draft && draft.version === WIZARD_STATE_VERSION && draft.hostingStyle === key;
    if (!hasResumableDraft) {
      openWizard(key, false);
      return;
    }
    if (Platform.OS === 'web') {
      // RN Alert ignores custom buttons on web — use the native confirm.
      const cont = window.confirm(
        'You have an unfinished trip. Continue where you left off?\n\n(Cancel to start fresh.)',
      );
      if (!cont) await clearTripWizardDraft();
      openWizard(key, cont);
      return;
    }
    Alert.alert(
      'Continue your trip?',
      'You have an unfinished trip. Pick up where you left off?',
      [
        {
          text: 'Start fresh',
          style: 'destructive',
          onPress: async () => {
            await clearTripWizardDraft();
            openWizard(key, false);
          },
        },
        { text: 'Continue', onPress: () => openWizard(key, true) },
      ],
      { cancelable: false },
    );
  };

  // Deep-link into a trip from a push tap: when the target changes, open it.
  // initialTripFocus is in the deps so a second push for the SAME trip but a
  // different section still re-applies (initialTripId alone wouldn't change).
  useEffect(() => {
    if (initialTripId) {
      setSelectedTripFocus(initialTripFocus ?? null);
      setSelectedTripId(initialTripId);
    }
  }, [initialTripId, initialTripFocus]);

  const closeCreateModal = () => {
    setPendingStyle(null);
    setWizardStarted(false);
  };

  const handleRequestCloseModal = () => {
    if (!wizardStarted) {
      closeCreateModal();
      return;
    }
    // Android hardware-back / swipe path. The wizard autosaves as you go, so
    // closing keeps the draft (restorable next time) — it never discards.
    Alert.alert(
      'Are you sure you want to exit?',
      'Your progress will be saved — you can pick it back up next time.',
      [
        { text: 'No', style: 'cancel' },
        { text: 'Yes, exit', onPress: closeCreateModal },
      ],
    );
  };

  const handleCreated = () => {
    // A new trip affects both the user's list and the public deck. Invalidate
    // (partial key → all users) so the kept-mounted MyTripsView refetches in
    // the background instead of being force-remounted.
    queryClient.invalidateQueries({ queryKey: ['trips', 'my'] });
    queryClient.invalidateQueries({ queryKey: tripsKeys.explore });
    closeCreateModal();
    goToTab('my');
  };

  const handleSavedEdit = () => {
    queryClient.invalidateQueries({ queryKey: ['trips', 'my'] });
    setEditingTrip(null);
    // Stay on detail screen so the host sees the updated trip immediately.
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.tripsHeader}>
        <View style={styles.headerTopRow}>
          <View style={styles.headerLeft}>
            <TouchableOpacity
              testID="trips-back-button"
              onPress={onBack}
              style={styles.backBtn}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="chevron-back" size={26} color="#FFFFFF" />
            </TouchableOpacity>
            <Logo size={40} iconOnly />
            <Text style={styles.tripsHeaderTitle}>Trips</Text>
          </View>
          <NotificationCenter userId={currentUserId} bare onOpenTrip={openTripFromNotification} />
        </View>

        <TripsHeaderTabs active={activeTab} onChange={goToTab} />
      </View>

      <View
        style={styles.body}
        onLayout={e => setBodyW(e.nativeEvent.layout.width)}
      >
        <Reanimated.View style={[styles.pagerRow, { width: bodyW * TAB_ORDER.length }, rowStyle]}>
          {/* index 0 — My Trips */}
          <TabPane index={0} width={bodyW} tx={tx} reduceMotion={reduceMotion}>
            {visited.my ? (
              <MyTripsView
                userId={currentUserId}
                onGoCreate={() => goToTab('create')}
                onOpenTrip={setSelectedTripId}
                onNavScroll={handleMyNavScroll}
              />
            ) : null}
          </TabPane>

          {/* index 1 — Explore */}
          <TabPane index={1} width={bodyW} tx={tx} reduceMotion={reduceMotion}>
            {visited.explore ? (
              <ExploreTripsView
                onOpenTrip={setSelectedTripId}
                onNavScroll={handleExploreNavScroll}
                onDeckScroll={navControl.collapse}
              />
            ) : null}
          </TabPane>

          {/* index 2 — Create */}
          <TabPane index={2} width={bodyW} tx={tx} reduceMotion={reduceMotion}>
            {visited.create ? (
              <View style={styles.createRoot}>
                {/* Background photo (Frame 2511): height exactly fills the area
                    between the header and the bottom of the screen. */}
                <View style={styles.createBgWrap} pointerEvents="none">
                  <Image
                    source={Images.createTrip.background}
                    style={styles.createBgImage}
                    resizeMode="cover"
                  />
                </View>

                <ScrollView
                  contentContainerStyle={styles.chooserScroll}
                  showsVerticalScrollIndicator={false}
                  onScroll={handleCreateNavScroll}
                  scrollEventThrottle={16}
                >
                  <Text
                    style={styles.chooserHeading}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                  >
                    Create a surf trip
                  </Text>
                  <Text style={styles.chooserSubheading}>
                    Plan your next adventure and invite{'\n'}surfers to join you
                  </Text>
                  {HOSTING_STYLE_OPTIONS.map(opt => (
                    <TouchableOpacity
                      key={opt.key}
                      style={styles.chooserCard}
                      onPress={() => void onPickStyle(opt.key)}
                      activeOpacity={0.85}
                      accessibilityRole="button"
                      accessibilityLabel={`${opt.title}. ${opt.desc}`}
                    >
                      <Image source={opt.image} style={styles.chooserThumb} resizeMode="cover" />
                      <View style={styles.chooserBody}>
                        <Text style={styles.chooserCardTitle}>{opt.title}</Text>
                        <Text style={styles.chooserCardDesc}>{opt.desc}</Text>
                      </View>
                      <Ionicons
                        name="chevron-forward"
                        size={24}
                        color="#7B7B7B"
                        style={styles.chooserChevron}
                      />
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            ) : null}
          </TabPane>
        </Reanimated.View>
      </View>

      {/* Trip overview as an OVERLAY (not a replacement): the tab lists stay
          mounted underneath, so going back lands on the exact scroll position
          — vertical lists and deck positions alike. TripDetailScreen manages
          its own top safe area. */}
      {selectedTripId && (
        <Reanimated.View
          style={styles.screenOverlay}
          entering={reduceMotion ? undefined : SlideInRight.duration(280).easing(Easing.out(Easing.cubic))}
          exiting={reduceMotion ? undefined : SlideOutRight.duration(220).easing(Easing.in(Easing.cubic))}
        >
          <TripDetailScreen
            tripId={selectedTripId}
            initialFocus={selectedTripFocus}
            onBack={() => {
              setSelectedTripId(null);
              setSelectedTripFocus(null);
            }}
            onOpenGroupChat={onOpenGroupChat}
            onEditTrip={setEditingTrip}
            onOpenTrip={openTripFromNotification}
            onViewUserProfile={
              onViewUserProfile
                ? (userId: string) => onViewUserProfile(userId, selectedTripId)
                : undefined
            }
          />
        </Reanimated.View>
      )}

      {/* Edit-trip wizard stacks above the overview the same way, so closing
          it returns to the detail screen (and the lists beneath) untouched. */}
      {editingTrip && (
        <View style={styles.screenOverlay}>
          <SafeAreaView style={styles.root} edges={['top']}>
            <View style={[styles.header, { paddingTop: 8 }]}>
              <TouchableOpacity
                onPress={() => setEditingTrip(null)}
                style={styles.backBtn}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="chevron-back" size={28} color="#222B30" />
              </TouchableOpacity>
              <Text style={styles.headerTitle}>Edit trip</Text>
              <View style={{ width: 28 }} />
            </View>
            <CreateTripWizard
              hostId={currentUserId}
              hostingStyle={editingTrip.hosting_style}
              initialTrip={editingTrip}
              onCreated={handleSavedEdit}
              onCancel={() => setEditingTrip(null)}
            />
          </SafeAreaView>
        </View>
      )}

      <Modal
        visible={createModalVisible}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={handleRequestCloseModal}
      >
        {/* The wizard chrome owns the top safe-area + its own close X, so we
            mount it directly in the modal — no SafeAreaView edge, no extra header. */}
        <View style={{ flex: 1, backgroundColor: '#212121' }}>
          {pendingStyle && (
            <CreateTripWizard
              hostId={currentUserId}
              hostingStyle={pendingStyle}
              onCreated={handleCreated}
              // The wizard runs its own discard confirm (the X / Cancel button)
              // before calling onCancel — so here we just close. The Modal's
              // onRequestClose still routes hardware-back / swipe through the
              // confirming handler.
              onCancel={closeCreateModal}
              onStartedChange={setWizardStarted}
              resumeDraft={resumeDraft}
            />
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#212121' },

  // White header reused only by the "Edit trip" sub-screen.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '600', color: '#222B30' },

  // Dark header (Figma): logo + "Trips" + notification bell, underline tabs below.
  tripsHeader: {
    backgroundColor: '#212121',
    paddingTop: 8,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 12,
    paddingRight: 18,
    paddingVertical: 10,
  },
  headerLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tripsHeaderTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  tabsRow: {
    flexDirection: 'row',
    paddingTop: 4,
  },
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 12,
    paddingBottom: 18,
    paddingHorizontal: 8,
  },
  tabBtnActive: {
    borderBottomWidth: 4,
    borderBottomColor: '#05BCD3',
  },
  tabBtnInactive: {
    borderBottomWidth: 2,
    borderBottomColor: '#7B7B7B',
  },
  tabLabel: { fontFamily: FONT_INTER, fontSize: 17, lineHeight: 21, fontWeight: '400', letterSpacing: 0.3 },
  tabLabelActive: { color: '#05BCD3' },
  tabLabelInactive: { color: '#FFFFFF' },

  body: { flex: 1, backgroundColor: '#FFFFFF', paddingTop: 0, overflow: 'hidden' },
  // Horizontal pager row: three full-width panes laid side by side; translateX
  // slides between them. Width is set inline once the viewport is measured.
  pagerRow: { flex: 1, flexDirection: 'row' },

  // Explore section title (Figma — Montserrat 24/600, 140% line-height).
  exploreTitle: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 31,
    fontWeight: '600',
    lineHeight: 40,
    color: '#333',
    paddingHorizontal: 16,
    marginTop: 24,
    marginBottom: 16,
  },

  // Explore body scroll (stacked carousels) + header.
  // Bottom padding clears the floating nav bar (bar ~82 + 44 bottom gap),
  // so the last deck/card scrolls fully above it.
  exScrollContent: { paddingBottom: 150 },
  exHeader: { paddingTop: 14 },
  // "Popular" section label above the trips carousel (Figma 11966:32390).
  exSectionTitle: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 28,
    color: '#333333',
    paddingLeft: 16,
    marginTop: 14,
    marginBottom: 26,
  },
  exSectionTitleStacked: { marginTop: 24 },
  exFilterRow: {
    flexDirection: 'row',
    gap: 11,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  exFilterPill: {
    minWidth: 38,
    borderRadius: 11,
    paddingHorizontal: 11,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exFilterPillActive: { backgroundColor: '#212121' },
  exFilterPillInactive: {
    backgroundColor: '#F7F7F7',
    borderWidth: 1,
    borderColor: '#EEEEEE',
  },
  exFilterTextActive: {
    fontFamily: FONT_INTER,
    fontSize: 12,
    lineHeight: 16,
    color: '#FFFFFF',
  },
  exFilterTextInactive: {
    fontFamily: FONT_INTER,
    fontSize: 12,
    lineHeight: 16,
    color: '#333333',
  },

  // paddingBottom clears the floating nav bar (see exScrollContent)
  listContent: { paddingHorizontal: 16, paddingBottom: 150, flexGrow: 1 },

  // Filter pills (My Trips).
  filterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 22,
    marginBottom: 28,
    marginHorizontal: 6,
    alignItems: 'center',
  },
  filterPill: {
    borderRadius: 12,
    paddingHorizontal: 11,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterPillActive: { backgroundColor: '#212121' },
  filterPillInactive: {
    backgroundColor: '#F7F7F7',
    borderWidth: 1,
    borderColor: '#EEEEEE',
  },
  filterText: { fontFamily: FONT_INTER, fontSize: 13, lineHeight: 18, textAlign: 'center' },
  filterTextActive: { color: '#FFFFFF' },
  filterTextInactive: { color: '#333333' },
  filterEmpty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48 },

  // Trip card (Figma): photo with overlaid host/title/avatars + status badge.
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 32,
    padding: 10,
    marginBottom: 16,
    gap: 12,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.09,
    shadowRadius: 12,
    elevation: 3,
  },
  cardImageWrap: {
    width: '100%',
    aspectRatio: 328 / 246,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#F2F2F2',
  },
  cardImageBg: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  cardImagePlaceholder: { alignItems: 'center', justifyContent: 'center' },

  hostRow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 16,
  },
  hostAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    backgroundColor: '#3A3A3A',
  },
  hostAvatarPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  hostName: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },

  cardTextBlock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 96,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  // Black tint over the blur (Figma glass: rgba(0,0,0,0.2) + the blur's 0.1).
  cardGlassTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.28)',
  },
  // Tiled fractal-noise grain (baked PNG already carries the low alpha).
  cardNoise: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
    opacity: 0.65,
  },
  cardTextContent: {
    justifyContent: 'flex-end',
    paddingTop: 8,
    paddingRight: 16,
    paddingBottom: 24,
    paddingLeft: 16,
    gap: 4,
  },
  cardTitle: {
    fontFamily: FONT_MONTSERRAT,
    color: '#FFFFFF',
    fontSize: 25,
    lineHeight: 34,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  cardDesc: {
    fontFamily: FONT_INTER,
    color: '#FFFFFF',
    fontSize: 15,
    lineHeight: 20,
    // Reserve room for the bottom-right participant cluster so the description
    // truncates a touch earlier instead of running behind the badge. The title
    // sits above the cluster, so only the description needs the inset.
    marginRight: 72,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },

  avatarCluster: {
    position: 'absolute',
    right: 12,
    bottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F7F7F7',
    borderRadius: 56,
    paddingVertical: 0,
    paddingLeft: 0,
    paddingRight: 7,
  },
  clusterAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#DDDDDD',
    borderWidth: 1,
    borderColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.18,
    shadowRadius: 2.5,
    elevation: 3,
  },
  clusterAvatarOverlap: { marginLeft: -20 },
  avatarClusterTight: { paddingRight: 0 },
  avatarClusterCount: { gap: 4, paddingLeft: 8 },
  clusterMore: {
    marginLeft: 1,
    fontFamily: FONT_MONTSERRAT,
    fontSize: 14,
    lineHeight: 18,
    color: '#7B7B7B',
    fontWeight: '400',
  },

  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderRadius: 32,
  },
  statusIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusTextRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 8,
  },
  statusLabel: { fontFamily: FONT_INTER, color: '#0A0A0A', fontSize: 13, lineHeight: 19, fontWeight: '500' },
  statusDate: { fontFamily: FONT_INTER, color: '#4A5565', fontSize: 13, lineHeight: 19, fontWeight: '500' },

  // Explore snap-carousel (Figma 11966:32391) — centered card, peeking neighbours.
  deckRoot: {
    height: DECK_CARD_H + 12,
    justifyContent: 'flex-start',
  },
  deckContent: {
    alignItems: 'flex-start',
  },
  deckSlot: {
    width: DECK_ITEM_W,
    height: DECK_CARD_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deckCard: {
    width: DECK_CARD_W,
    height: DECK_CARD_H,
  },

  // Explore card — single full-bleed image with overlaid info (Figma 12506:16019).
  exCard: {
    width: '100%',
    aspectRatio: 328 / 384,
    borderRadius: 24,
    overflow: 'hidden',
    marginBottom: 16,
    backgroundColor: '#F2F2F2',
  },
  tripTypePill: {
    position: 'absolute',
    top: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  tripTypeLabel: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  exBottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  exContent: {
    paddingTop: 8,
    paddingRight: 16,
    paddingBottom: 24,
    paddingLeft: 16,
    gap: 12,
  },
  exHeadings: { gap: 1 },
  exInfoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  exInfoLeft: { gap: 8, flexShrink: 1, marginTop: 6 },
  exPrice: { color: '#FFFFFF', fontSize: 22, lineHeight: 26, fontWeight: '600' },
  exDates: { color: '#FFFFFF', fontSize: 17, lineHeight: 24 },
  exInfoRight: { alignItems: 'flex-end', gap: 8 },
  exSpots: { color: '#FFFFFF', fontSize: 15, lineHeight: 20, fontWeight: '400' },
  exCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F7F7F7',
    borderRadius: 56,
    paddingVertical: 0,
    paddingLeft: 0,
    paddingRight: 8,
  },

  fillFlex: { flex: 1 },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 64 },
  emptyText: { fontSize: 14, color: '#7B7B7B', marginTop: 12, textAlign: 'center' },
  emptyCta: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#0788B0',
  },
  emptyCtaText: { color: '#FFFFFF', fontWeight: '600' },

  // Inline hosting-style chooser (moved out of CreateTripWizard).
  createRoot: { flex: 1 },
  // Full-screen pushed-page overlay (trip overview / edit wizard). Solid
  // background so the lists underneath never bleed through.
  screenOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
    backgroundColor: '#FFFFFF',
  },
  createBgWrap: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
    alignItems: 'center',
  },
  // Fills the area between the header and the screen bottom edge-to-edge;
  // the photo's ratio is nearly identical to the phone's content area, so
  // `cover` crops imperceptibly.
  createBgImage: {
    width: '100%',
    height: '100%',
    transform: [{ translateY: 20 }],
  },
  chooserScroll: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 32,
  },
  chooserHeading: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    // Native: big starting size; adjustsFontSizeToFit shrinks it so the single
    // line always spans the 60%-width container. Web has no font auto-fit, so
    // it gets a fixed size that fits one line on typical widths.
    fontSize: Platform.OS === 'web' ? 36 : 64,
    fontWeight: '600',
    color: '#333333',
    width: '64%',
    marginTop: 24,
    marginBottom: 16,
  },
  chooserSubheading: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '400',
    color: '#333333',
    marginBottom: 32,
  },
  chooserCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    minHeight: 94,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingLeft: 12,
    paddingRight: 6,
    paddingVertical: 12,
    marginBottom: 16,
    shadowColor: '#596E7C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 3,
  },
  chooserThumb: {
    width: 84,
    height: 70,
    borderRadius: 8,
    backgroundColor: '#EEF2F4',
  },
  chooserBody: {
    flex: 1,
    gap: 4,
  },
  chooserCardTitle: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '700',
    color: '#333333',
  },
  chooserCardDesc: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '400',
    color: '#333333',
  },
  chooserChevron: {
    marginRight: 4,
  },

  modalRoot: { flex: 1, backgroundColor: '#FFFFFF' },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
  },
  modalCloseBtn: { padding: 4 },
});
