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
  Platform,
  StatusBar,
  Dimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
  InteractionManager,
  StyleProp,
  ViewStyle,
  TextInput,
  Pressable,
  Keyboard,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
// Remote user-content images (trip covers, avatars) render through expo-image
// for its disk cache — URLs are immutable (timestamped filenames), so cached
// copies never go stale. Local bundled assets keep using RN's Image.
import { Image as CachedImage } from 'expo-image';
import { CertBadges } from '../../components/trips/overview/CertBadges';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
const NOISE_TEXTURE = require('../../../assets/textures/noise.png');
import { useOnboarding } from '../../context/OnboardingContext';
import {
  GroupTrip,
  HostingStyle,
  MyTripsBuckets,
  SurfLevel,
  TripCardMeta,
} from '../../services/trips/groupTripsService';
import {
  ExploreFiltersSheet,
  EMPTY_EXPLORE_FILTERS,
  countActiveFilters,
  type ExploreFilters,
} from '../../components/trips/ExploreFiltersSheet';
import { COUNTRY_NAMES } from '../../data/countryNames';
import {
  formatTripPrice as formatTripPriceIn,
  formatTripPriceRange,
  type Viewer,
} from '../../utils/currency';
import { useViewer } from '../../hooks/useViewer';
import { useUserProfile } from '../../context/UserProfileContext';
import { useQueryClient } from '@tanstack/react-query';
import { useExploreTrips, useMyTrips, tripsKeys, type ExploreFilterKey } from '../../hooks/trips/useTripQueries';
import { fetchTripCore, TRIP_DETAIL_GC_MS } from '../../hooks/trips/useTripDetail';
import { useTripsListRealtime } from '../../hooks/trips/useTripsListRealtime';
import CreateTripWizard from './CreateTripWizard';
import { OperatorSetupBanner } from '../../components/trips/OperatorSetupBanner';
import { useOperatorSetup } from '../../hooks/trips/useOperatorSetup';
import { bypassesOperatorSetup } from '../../services/trips/operatorSetup';
import { pushRootCard } from '../../navigation/navigationRef';
import { ff, fs } from '../../theme/fonts';
import { fontSize, textStyle, textStyles } from '../../theme/typography';
import { LinearGradient } from 'expo-linear-gradient';
import { setStatusBarStyle } from 'expo-status-bar';
import MaskedView from '@react-native-masked-view/masked-view';
import BottomSheetShell from '../../components/BottomSheetShell';
import { TripIcon, type TripIconName } from '../../components/trips/tripIcons';
import { MyTripsSkeleton, ExploreDeckSkeleton } from '../../components/skeletons';
import NoTripsEmptyState from '../../components/trips/NoTripsEmptyState';
import { FadeInView } from '../../components/FadeInView';
import { WIZARD_STATE_VERSION } from './CreateTripFlowA';
import {
  peekTripWizardDraft,
  clearTripWizardDraft,
} from '../../hooks/useTripWizardDraft';
import { useNavigation, StackActions } from '@react-navigation/native';
import { useTripsBottomNavControl, type TripsBottomNavControl } from '../../components/trips/TripsBottomNav';
import { Images } from '../../assets/images';
import { MainHeader } from '../../components/MainHeader';
import type { TripDetailFocus } from '../../services/notifications/notificationsService';
import { getStorageThumbUrl } from '../../services/media/imageService';
import { toWidthThumbUrl } from '../../services/media/thumbnails';
import Thumb from '../../components/Thumb';
import { neighbourHeroUrls, neighbourAvatarUrls } from './deckPrefetch';
import { isNearEnd } from './exploreDeckPagination';
import Reanimated, {
  Easing,
  Extrapolation,
  interpolate,
  interpolateColor,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

export type TripsTab = 'explore' | 'my';
/** How long after opening the app we may still move a user on a trip to My
 *  Trips. Later than this they are already browsing Explore. */
const ENTRY_DECISION_WINDOW_MS = 4000;

interface TripsScreenProps {
  onBack: () => void;
  /** Shared control for the app-level floating nav bar — the tab lists pipe
   *  their scroll events into it so the bar collapses/restores. */
  navControl?: TripsBottomNavControl;
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
  // `tripIcon` wins when set — Figma's own glyph, where we have it traced.
  { bg: string; icon: keyof typeof Ionicons.glyphMap; tripIcon?: TripIconName; label: string }
> = {
  upcoming: { bg: '#84EBB4', icon: 'briefcase-outline', tripIcon: 'luggage-02', label: 'Upcoming' },
  requested: { bg: '#FFB443', icon: 'chatbox-ellipses-outline', label: 'Requested' },
  completed: { bg: '#F7F7F7', icon: 'checkmark-circle-outline', label: 'Completed' },
};

// Card avatars render the static square thumbnail (few KB) instead of the
// full-resolution profile photo (~300 KB+). 96 covers the 40–52px circles at
// any density; must match the size passed to the deck's avatar prefetch so the
// warmed URL is the one <Thumb> actually requests.
const AVATAR_THUMB_PX = 96;

/** Width the deck/list cards render their hero at — must match <Thumb widthPx>. */
const HERO_THUMB_PX = 1280;

/**
 * Prefetch the exact hero URL the card renders. Warming the RAW hero_image_url
 * (what this did before) fetched the full-size original — up to 2048px — under a
 * URL the UI never requests: the download was pure waste on every swipe, and each
 * decoded original sat in expo-image's uncapped memory cache. Mirrors
 * warmAvatarThumbs: warm what you will actually show.
 */
const warmHeroThumbs = (heroUrls: string[]) => {
  heroUrls.forEach(u => {
    const t = toWidthThumbUrl(u, HERO_THUMB_PX) ?? u;
    CachedImage.prefetch(t);
  });
};

/** Prefetch the exact URLs <Thumb size={AVATAR_THUMB_PX}> will render. */
const warmAvatarThumbs = (avatarUrls: string[]) => {
  avatarUrls.forEach(u => {
    const t = getStorageThumbUrl(u, AVATAR_THUMB_PX) ?? u;
    CachedImage.prefetch(t);
  });
};

const TripCard: React.FC<{
  trip: GroupTrip;
  status: TripCardStatus;
  meta?: TripCardMeta;
  onPress?: () => void;
  onPressIn?: () => void;
}> = ({ trip, status, meta, onPress, onPressIn }) => {
  const badge = STATUS_BADGE[status];
  const avatars = (meta?.memberAvatars ?? []).slice(0, 3);
  const total = meta?.totalCount ?? trip.participant_count ?? 0;
  const overflow = total - avatars.length;

  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={onPress ? 0.9 : 1}
      onPress={onPress}
      onPressIn={onPressIn}
      disabled={!onPress}
    >
      <View style={styles.cardImageWrap}>
        {trip.hero_image_url ? (
          <Thumb
            uri={trip.hero_image_url}
            widthPx={HERO_THUMB_PX}
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
            <Thumb
              uri={meta.hostAvatar}
              size={AVATAR_THUMB_PX}
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
            <Text style={styles.cardDesc} numberOfLines={2}>
              {formatDestination(trip)}
            </Text>
          </View>
        </View>

        {/* Participant cluster (bottom-right). Falls back to an icon + count when
            no avatars are available (e.g. Explore trips the viewer isn't in). */}
        {avatars.length > 0 ? (
          <View style={[styles.avatarCluster, overflow <= 0 && styles.avatarClusterTight]}>
            {avatars.map((uri, i) => (
              <Thumb
                key={`${uri}-${i}`}
                uri={uri}
                size={AVATAR_THUMB_PX}
                contentFit="cover"
                cachePolicy="memory-disk"
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
          {badge.tripIcon ? (
            <TripIcon name={badge.tripIcon} size={18} color="#0A0A0A" strokeWidth={1} />
          ) : (
            <Ionicons name={badge.icon} size={18} color="#0A0A0A" />
          )}
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
// Filter pills (My Trips, Figma 17029:25735) — All / Upcoming (n) / Completed (n).
// No "Requested": My Trips is operator-only now, and operators do not request
// to join. A pending trip, if one exists, still shows under All.
// ---------------------------------------------------------------------------
type TripFilter = 'all' | 'upcoming' | 'completed';

const TripFilterBar: React.FC<{
  active: TripFilter;
  counts: { upcoming: number; completed: number };
  onChange: (f: TripFilter) => void;
}> = ({ active, counts, onChange }) => {
  const items: { key: TripFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'upcoming', label: `Upcoming (${counts.upcoming})` },
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
// Explore card (Figma 17779:51085) — a white frame holding the photo (level +
// vibe pills on top, title / place / dates / who's going at the bottom) and,
// under it, the host and the price. It has no touch handling of its own: the
// swipe deck owns the gestures, tap included.
// ---------------------------------------------------------------------------
const formatTripPrice = (trip: GroupTrip, viewer: Viewer): string | null => {
  if (trip.cost_per_person != null) {
    return formatTripPriceIn(trip.cost_per_person, trip, viewer);
  }
  return formatTripPriceRange(trip.budget_min, trip.budget_max, trip, viewer);
};

const LEVEL_RANK: SurfLevel[] = ['beginner', 'intermediate', 'advanced', 'pro'];
const LEVEL_FULL: Record<string, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
  pro: 'Pro',
};
const LEVEL_SHORT: Record<string, string> = {
  beginner: 'Beg',
  intermediate: 'Int',
  advanced: 'Adv',
  pro: 'Pro',
};

/** ['intermediate','advanced'] → "Intermediate - Adv". Null when the host set none. */
const formatLevelRange = (levels: SurfLevel[] | null | undefined): string | null => {
  const all = levels ?? [];
  const picked = LEVEL_RANK.filter(l => all.includes(l));
  if (picked.length === 0) return all.includes('all') ? 'All levels' : null;
  if (picked.length === LEVEL_RANK.length) return 'All levels';
  if (picked.length === 1) return LEVEL_FULL[picked[0]];
  return `${LEVEL_FULL[picked[0]]} - ${LEVEL_SHORT[picked[picked.length - 1]]}`;
};

// The vibe pill's own wording, in the Figma's title case ("Surf Focused",
// 17779:51097). The create flow's labels are full sentences
// ("Surf-focused - wake up early, surf a lot") and do not fit a pill.
const VIBE_PILL: Record<string, string> = {
  improve_surf: 'Improve Surfing',
  surf_focused: 'Surf Focused',
  explore: 'Surf + Explore',
  vacation: 'Vacation Style',
};

const formatVibe = (trip: GroupTrip): string | null => {
  const slug = trip.trip_vibes?.[0];
  return slug ? VIBE_PILL[slug] ?? null : null;
};

// Card geometry. The frame pads the photo by 8 on every side and leaves a
// fixed 64px row under it for the host and the price; only the photo scales.
const EX_FRAME_PAD = 8;
// How far the card shrinks before its shadow has fully faded (see
// ExploreTripCard).
const EX_SHADOW_FADE_PX = 40;
const EX_INFO_H = 64;
// Figma 18960:24187: a horizontal carousel. The first card starts 14 from the
// left edge and the next one sits 8 after it, so it peeks in on the right.
const EX_CAROUSEL_INSET = 14;
const EX_CAROUSEL_GAP = 8;
// The design is a 344 card on a 393 screen. The card keeps that share of the
// width, so it grows on a Max phone instead of stopping at 344.
const EX_CARD_WIDTH_SHARE = 344 / 393;
// Ceiling for tablets and wide web windows.
const EX_CARD_MAX_W = 420;
const EX_CARD_MIN_W = 280;
// The HEIGHT follows the phone: the card fills the space down to the floating
// nav bar, so a tall phone gets a tall photo and a short one a shorter photo.
// The bar's top edge sits ~91px above the bottom of the screen, and the design
// leaves ~44 more between it and the card (481 tall on an 852 screen).
// iOS only: there the native tab bar floats and the screen runs under it. On
// Android the Material tab bar takes its own space — the screen already ends
// at its top edge — so reserving it again left the card ~90dp short.
const EX_NAV_RESERVE = Platform.OS === 'android' ? 0 : 92;
const EX_NAV_GAP = 44;
// The photo never gets shorter than this (an SE-size phone)…
const EX_IMAGE_MIN_H = 220;
// …or taller than this share of its width (tablets, tall web windows).
const EX_IMAGE_MAX_RATIO = 1.6;
const exploreCardHeight = (w: number, areaH: number) => {
  const imageW = w - EX_FRAME_PAD * 2;
  const room = areaH - EX_NAV_RESERVE - EX_NAV_GAP - EX_INFO_H - EX_FRAME_PAD * 3;
  const imageH = Math.max(EX_IMAGE_MIN_H, Math.min(Math.round(imageW * EX_IMAGE_MAX_RATIO), room));
  return imageH + EX_INFO_H + EX_FRAME_PAD * 3;
};

// Search runs server-side (explore_feed p_search: title, About, host, place,
// levels, boards, vibe…). Wait this long after the last keystroke before
// asking, so typing "nicaragua" is one request, not nine.
const EX_SEARCH_DEBOUNCE_MS = 250;
// Keyboard-up card fit: space kept above the keyboard, and the smallest the
// card may get (details panel + a strip of photo) on very short phones.
const EX_KB_GAP = 16;
const EX_FIT_MIN_H = 200;
// Where the keyboard's top landed last time (window y). Search opens with the
// same keyboard almost every time, so the cards can start shrinking in the tap
// itself, with the header, instead of waiting for the keyboard event.
let lastKbTop = 0;
// Android: the keyboard's screenY counts from the top of the screen, but
// measureInWindow (the deck's top) counts from below the status bar. (The tab
// bar is hidden while the keyboard is up — see RootNavigator.)
const kbLimit = (kbTop: number) =>
  Platform.OS === 'android' ? kbTop - (StatusBar.currentHeight ?? 0) : kbTop;
// If no keyboard has started showing this long after search opens (hardware
// keyboard), the cards grow back. Long, because the first keyboard of a
// session can take ~1s to appear, and Android only reports it once it is up.
const EX_NO_KB_GRACE_MS = 1500;
const normalizeSearch = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase().slice(0, 100);

const exploreCardLabel = (trip: GroupTrip): string => {
  const headline = trip.title || formatDestination(trip);
  const location = formatDestination(trip);
  const place = trip.title && location !== headline ? `, ${location}` : '';
  return `${headline}${place}, ${formatTripDates(trip)}`;
};

// Explore card logos live in components/trips/overview/CertBadges (shared
// with the trip page's top card).
const ExploreTripCard: React.FC<{
  trip: GroupTrip;
  meta?: TripCardMeta;
  /** How many px shorter than full the card looks right now (see
   *  ExploreTripsView), while the keyboard is up. */
  shrinkBy?: SharedValue<number>;
}> = React.memo(({ trip, meta, shrinkBy }) => {
  const viewer = useViewer();
  const reduceMotion = useReducedMotion();
  // The card never changes its layout size — only transforms move, so the
  // shrink runs on the GPU at a steady pace (animating `height` re-laid-out
  // the card every frame and stuttered on a real phone). Layers, by where
  // they end up on screen:
  //  · window (clips the card's bottom edge): up by Δ;
  //  · white frame: back down by Δ → stays still;
  //  · photo window (clips the photo's bottom edge): up by Δ;
  //  · photo: back down by Δ → stays still, cropped from below;
  //  · details panel + host row: up by Δ, riding the bottom edge.
  // Each clipping layer rounds its own corners, so they stay round.
  const up = useAnimatedStyle(() => ({ transform: [{ translateY: -(shrinkBy ? shrinkBy.value : 0) }] }));
  const down = useAnimatedStyle(() => ({ transform: [{ translateY: shrinkBy ? shrinkBy.value : 0 }] }));
  // The shadow can't be clipped with the card, so it fades out early in the
  // shrink and back in at the end of the grow.
  const shadowStyle = useAnimatedStyle(() => ({
    opacity: 1 - Math.min(1, (shrinkBy ? shrinkBy.value : 0) / EX_SHADOW_FADE_PX),
  }));
  const avatars = (meta?.memberAvatars ?? []).slice(0, 3);
  const count = meta?.totalCount ?? trip.participant_count ?? 0;
  const max = trip.max_participants;
  const occupancy = max != null ? `${count}/${max}` : `${count}`;
  const price = formatTripPrice(trip, viewer);
  const level = formatLevelRange(trip.target_surf_levels);
  const vibe = formatVibe(trip);
  const hasCi = trip.ci_surf_conservation === true;
  const hasSc = trip.stoke_certified === true;

  // Tiny (~24px) transform thumbnail used as a blur-up placeholder. For
  // non-Supabase hero URLs getStorageThumbUrl returns the URL unchanged, so we
  // pass no placeholder and fall back to the plain fade.
  const heroThumb = useMemo(() => {
    const t = getStorageThumbUrl(trip.hero_image_url, 24);
    return t && t !== trip.hero_image_url ? t : null;
  }, [trip.hero_image_url]);

  const headline = trip.title || formatDestination(trip);
  const location = formatDestination(trip);
  const showLocation = !!trip.title && !!location && location !== headline;

  return (
    <View style={styles.exCard}>
    <Reanimated.View style={[styles.exCardShadow, shadowStyle]} pointerEvents="none" />
    <Reanimated.View style={[styles.exCardWindow, up]}>
    <Reanimated.View style={[styles.exFrame, down]}>
      <Reanimated.View style={[styles.exImage, up]}>
      <Reanimated.View style={[styles.exPhotoContent, down]}>
        {trip.hero_image_url ? (
          <Thumb
            uri={trip.hero_image_url}
            widthPx={HERO_THUMB_PX}
            placeholder={heroThumb ? { uri: heroThumb } : undefined}
            placeholderContentFit="cover"
            style={styles.cardImageBg}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={reduceMotion ? 0 : 150}
          />
        ) : (
          <View style={[styles.cardImageBg, styles.cardImagePlaceholder]}>
            <Ionicons name="image-outline" size={32} color="#B0B0B0" />
          </View>
        )}

        {(level || vibe) && (
          <View style={styles.exPills}>
            {!!level && (
              <View style={styles.exPill}>
                <Text style={styles.exPillText} numberOfLines={1}>{level}</Text>
              </View>
            )}
            {!!vibe && (
              <View style={styles.exPill}>
                <Text style={styles.exPillText} numberOfLines={1}>{vibe}</Text>
              </View>
            )}
          </View>
        )}

        {/* Details panel (Figma 17779:51100): the photo blurred behind the
            text, under a grey wash that is strongest at the bottom and gone at
            the top. The frame above clips the rounded corners. The blur is
            faded in through a gradient mask too — a bare BlurView ends in a
            hard line across the photo. Same pairing as OnboardingChrome. */}
        <Reanimated.View style={[styles.exPanel, up]}>
          <MaskedView
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
            maskElement={
              <LinearGradient
                colors={['transparent', '#000000']}
                locations={[0, 0.45]}
                style={StyleSheet.absoluteFill}
              />
            }
          >
            <BlurView intensity={18} tint="dark" style={StyleSheet.absoluteFill} />
          </MaskedView>
          <LinearGradient
            colors={['rgba(78,78,78,0)', 'rgba(78,78,78,0.63)']}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <View style={styles.exPanelContent}>
            {/* Conservation International + STOKE Certified logos (Figma
                18675:22874), only when the operator ticked them on the stay.
                Both: one grid cell, SC 43 right and 1 down over CI's edge. */}
            <CertBadges ci={hasCi} stoke={hasSc} />
            <View style={styles.exRoute}>
              <Text style={styles.exTitle} numberOfLines={1}>{headline}</Text>
              {showLocation && (
                <Text style={styles.exLocation} numberOfLines={1}>{location}</Text>
              )}
            </View>
            <View style={styles.exDateRow}>
              <Text style={styles.exDates} numberOfLines={1}>{formatTripDates(trip)}</Text>
              {(avatars.length > 0 || count > 0) && (
                <View style={styles.exCluster}>
                  {avatars.length > 0 ? (
                    avatars.map((uri, i) => (
                      <Thumb
                        key={`${uri}-${i}`}
                        uri={uri}
                        size={AVATAR_THUMB_PX}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                        style={[
                          styles.exClusterAvatar,
                          i > 0 && styles.exClusterOverlap,
                          { zIndex: avatars.length - i },
                        ]}
                      />
                    ))
                  ) : (
                    <Ionicons name="people" size={16} color="#7B7B7B" style={{ marginLeft: 8 }} />
                  )}
                  <Text style={styles.exClusterCount}>{occupancy}</Text>
                </View>
              )}
            </View>
          </View>
        </Reanimated.View>
      </Reanimated.View>
      </Reanimated.View>

      <Reanimated.View style={[styles.exInfo, up]}>
        <View style={styles.exHost}>
          {meta?.hostAvatar ? (
            <Thumb
              uri={meta.hostAvatar}
              size={AVATAR_THUMB_PX}
              style={styles.exHostAvatar}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
          ) : (
            <View style={[styles.exHostAvatar, styles.hostAvatarPlaceholder]}>
              <Ionicons name="person" size={18} color="#FFFFFF" />
            </View>
          )}
          <View style={styles.exHostText}>
            <Text style={styles.exHostLabel}>Host</Text>
            {!!meta?.hostName && (
              <Text style={styles.exHostName} numberOfLines={1}>{meta.hostName}</Text>
            )}
          </View>
        </View>
        {/* Price ranges ("₪1,700-₪2,500") are wide — keep them on one line and
            let them scale down instead of wrapping. */}
        {!!price && (
          <Text style={styles.exPrice} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
            {price}
          </Text>
        )}
      </Reanimated.View>
    </Reanimated.View>
    </Reanimated.View>
    </View>
  );
});

// Explore filters: budget slider, dates calendar, age range. The sheet lives
// in components/trips/ExploreFiltersSheet.tsx; filtering runs server-side in
// explore_feed across the whole catalogue.

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
  userId: string | null;
  /** Search opened/closed — the screen slides its header away while open. */
  onSearchOpenChange?: (open: boolean) => void;
  /** The header's height and how far it has slid away (0 shown, 1 hidden),
   *  so the deck's top can be tracked on the UI thread while it slides. */
  headerH?: SharedValue<number>;
  headerP?: SharedValue<number>;
}> = ({ onOpenTrip, userId, onSearchOpenChange, headerH, headerP }) => {
  // The viewer decides the budget slider's label currency; the RPC filter
  // value itself stays in USD.
  const viewer = useViewer();

  const [filters, setFilters] = useState<ExploreFilters>(EMPTY_EXPLORE_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const applyFilters = useCallback((next: ExploreFilters) => {
    setFiltersOpen(false);
    // Same values → keep the old object, so the query key does not change.
    setFilters(prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, []);
  const activeFilterCount = countActiveFilters(filters);

  // Search (Figma 18960:24689). `query` is what the box shows; `search` is the
  // debounced, normalized text that goes into the query key and the RPC.
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  useEffect(() => {
    const next = normalizeSearch(query);
    // Clearing is instant; typing waits for a pause.
    if (next === '') { setSearch(''); return; }
    const t = setTimeout(() => setSearch(next), EX_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);
  const q = normalizeSearch(query);

  // Push month/budget filters into the RPC so they span the whole catalogue, not
  // just the loaded page. The derived key drives BOTH the query cache identity and
  // the RPC args (changing a chip re-queries the server). Memoised by primitive
  // signature so the key reference is stable across renders that don't change the
  // selection (otherwise useInfiniteQuery would see a new key every render).
  const filterKey: ExploreFilterKey = useMemo(
    () => ({ ...filters, search }),
    [filters, search],
  );
  // New filters or a new search = a different list, so the carousel goes back to
  // its first card.
  const resetKey = useMemo(() => JSON.stringify(filterKey), [filterKey]);

  // Cached + stale-while-revalidate. The data survives tab switches and
  // leaving/re-entering Trips, so re-entry is instant (no skeleton) and only
  // revalidates silently in the background when stale.
  const { trips, meta, isLoading, isError, refetch, hasNextPage, fetchNextPage, isFetchingNextPage, isPlaceholderData } = useExploreTrips(filterKey);
  const hasActiveFilter = activeFilterCount > 0;

  // Results for the text typed are still on their way (debounce, or the
  // request itself while the last results stay on screen).
  const searchPending = q !== search || isPlaceholderData;
  const visibleTrips = trips;
  const listKey = resetKey;

  const queryClient = useQueryClient();
  const liveRef = useRef({ trips: visibleTrips, meta });
  liveRef.current = { trips: visibleTrips, meta };

  // Warm what the next swipes will show: hero + avatar thumbs for the cards
  // behind the front one, and the detail query for the front card and its
  // neighbour so a tap opens instantly.
  const warmAround = useCallback((index: number) => {
    const { trips: live, meta: liveMeta } = liveRef.current;
    if (live.length === 0) return;
    warmHeroThumbs(neighbourHeroUrls(live, index));
    warmAvatarThumbs(neighbourAvatarUrls(live, liveMeta, index));
    // Skip while userId is unknown (e.g. mid session-restore): a userId-less
    // prefetch would cache a detail with myRequest=null that the real open
    // would then consume, showing a wrong CTA.
    if (!userId) return;
    InteractionManager.runAfterInteractions(() => {
      for (let k = 0; k < 2; k++) {
        const t = live[(index + k) % live.length];
        if (!t) continue;
        queryClient.prefetchQuery({
          queryKey: tripsKeys.detail(t.id),
          // Short gcTime: most prefetched trips are swiped past and never
          // opened. Opening one mounts useTripCore, which extends its life.
          gcTime: 1000 * 60 * 2,
          queryFn: ({ signal }) => fetchTripCore(t.id, userId, signal),
        });
      }
    });
  }, [queryClient, userId]);

  useEffect(() => {
    if (!isLoading) warmAround(0);
  }, [isLoading, listKey, warmAround]);

  // The stack loops, so "near the end" only means "ask for the next page if
  // there is one" — once everything is loaded it simply wraps to the start.
  const handleTopChange = useCallback((index: number) => {
    warmAround(index);
    if (isNearEnd(index, liveRef.current.trips.length) && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [warmAround, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Width: the design's share of the screen. Height: whatever the phone has
  // down to the nav bar (see exploreCardHeight).
  const [area, setArea] = useState({ w: 0, h: 0 });
  // Opening search slides the header away, so this area grows taller. Keep the
  // height measured with the header shown, so the cards stay the same size.
  // The hold starts in the tap (before the header's first frame) and ends when
  // the header has REALLY landed back (headerP back at 0, seen on the UI
  // thread) — not on a timer. A timer raced the JS thread: when it was busy
  // (the feed swapping back in on close), the slide's late, in-between layout
  // heights arrived after the timer had let go, so the cards grew a few px
  // past their size and came back (the "bump").
  const holdAreaH = useRef(false);
  const searchOpenRef = useRef(searchOpen);
  searchOpenRef.current = searchOpen;
  const releaseHold = useCallback(() => {
    if (!searchOpenRef.current) holdAreaH.current = false;
  }, []);
  // This view mounts with search closed. If the parent still has the header
  // slid away (this view was remounted mid-search, e.g. by Fast Refresh), put
  // it back — otherwise the deck is measured with the header gone, the cards
  // come out a header taller, and the keyboard fit never runs.
  useEffect(() => {
    onSearchOpenChange?.(false);
    // Mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useAnimatedReaction(
    () => (headerP ? headerP.value : 0),
    (p, prev) => {
      if (p === 0 && prev != null && prev !== 0) runOnJS(releaseHold)();
    },
    [headerP, releaseHold],
  );
  const cardW = area.w === 0
    ? 0
    : Math.max(EX_CARD_MIN_W, Math.min(EX_CARD_MAX_W, Math.round(area.w * EX_CARD_WIDTH_SHARE)));
  const cardH = cardW === 0 ? 0 : exploreCardHeight(cardW, area.h);

  // With the keyboard up, the cards shrink to fit between the search row and
  // the keyboard, and grow back when it goes down. Both edges are tracked on
  // the UI thread: the keyboard's top (animated with the keyboard's own
  // duration) and the deck's top. The deck's top is measured ONCE, at rest
  // with the header shown, and then moved by the header's own animation —
  // measuring while the header slides returns late, stepped values (the
  // card jumps). The photo takes the change; the details panel keeps its size.
  const reduceMotion = useReducedMotion();
  const deckRef = useRef<View>(null);
  const deckBase = useSharedValue(0);
  const measureDeck = useCallback(() => {
    if (holdAreaH.current || (headerP && headerP.value !== 0)) return;
    deckRef.current?.measureInWindow((_x, y) => { deckBase.value = y; });
  }, [headerP, deckBase]);
  // Room for the card, animated straight to its FINAL value: the keyboard's
  // end position minus the deck's end position (header gone). Following both
  // live made the card over-shrink — the keyboard (~250ms) lands before the
  // header (460ms) has finished sliding away — and then grow back.
  const NO_LIMIT = 1e6;
  const room = useSharedValue(NO_LIMIT);
  // Where `room` is heading (NO_LIMIT = full card, no fit). A keyboard event
  // that asks for the same place is ignored: restarting the timing would
  // restart the curve too, and the card would visibly kick.
  const roomTo = useRef(NO_LIMIT);
  const cardHRef = useRef(cardH);
  cardHRef.current = cardH;
  // The header slide in progress (start time + length), so a resize that
  // starts late still lands on the same frame as the header.
  const slide = useRef({ start: 0, ms: 0 });
  const openToken = useRef(0);
  // The keyboard has started to show (our own show event). NOT
  // Keyboard.isVisible(): that only turns true at keyboardDidShow, after the
  // keyboard has finished rising — a slow first keyboard read as "no keyboard"
  // and the card grew back under it.
  const kbComing = useRef(false);
  const slideLeft = () =>Math.max(0, slide.current.ms - (Date.now() - slide.current.start));
  // The photo is never rescaled: it always keeps the size it has in the
  // full-height card, and the smaller card just crops its bottom (the photo
  // stays anchored at the top). Only the card's height animates — with the header when search
  // opens or closes (same curve, same end), or with the keyboard when only it
  // moves.
  const resizeTo = useCallback((target: number, cardMs: number, release = false) => {
    const full = cardHRef.current;
    if (full === 0) return;
    const to = Math.min(full, target);
    roomTo.current = release ? NO_LIMIT : to;
    room.value = room.value >= NO_LIMIT ? full : Math.min(full, room.value);
    room.value = withTiming(to, { duration: reduceMotion ? 0 : cardMs, easing: EX_SEARCH_EASE }, done => {
      if (done && release) room.value = NO_LIMIT;
    });
  }, [room, reduceMotion]);
  // The card height that fits above a keyboard whose top is at `kbTop`.
  const fitFor = useCallback((kbTop: number) => {
    const deckTopEnd = deckBase.value - (searchOpenRef.current && headerH ? headerH.value : 0);
    return Math.max(Math.min(EX_FIT_MIN_H, cardHRef.current), kbLimit(kbTop) - deckTopEnd - EX_KB_GAP);
  }, [deckBase, headerH]);
  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', e => {
      kbComing.current = true;
      lastKbTop = e.endCoordinates.screenY;
      if (deckBase.value === 0 || !searchOpenRef.current) return;
      const target = Math.min(cardHRef.current, fitFor(lastKbTop));
      // Already on its way there (started in the tap from the last keyboard).
      if (roomTo.current < NO_LIMIT && Math.abs(roomTo.current - target) < 2) return;
      resizeTo(target, Math.max(slideLeft(), e.duration || 250));
    });
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', e => {
      kbComing.current = false;
      // Closing search is handled below, in step with the header.
      if (!searchOpenRef.current || roomTo.current >= NO_LIMIT) return;
      resizeTo(cardHRef.current, e.duration || 250, true);
    });
    return () => { show.remove(); hide.remove(); };
  }, [deckBase, fitFor, resizeTo]);
  // The ONE way search opens or closes. Everything that moves starts right
  // here, in the tap, on the UI thread: the header slide (parent, no re-render
  // there), the keyboard, and the card — shrinking on open (to where the
  // keyboard landed last time) and growing back on close, with the header's
  // own duration and curve, so it is one movement. Waiting for a render first
  // froze the screen ~400ms and then jumped to the end.
  const changeSearchOpen = useCallback((open: boolean) => {
    searchOpenRef.current = open;
    slide.current = { start: Date.now(), ms: open ? EX_SEARCH_OPEN_MS : EX_SEARCH_CLOSE_MS };
    onSearchOpenChange?.(open);
    const token = ++openToken.current;
    if (open) {
      holdAreaH.current = true;
      if (lastKbTop > 0 && deckBase.value !== 0) {
        resizeTo(fitFor(lastKbTop), EX_SEARCH_OPEN_MS);
        // Shrunk for a keyboard that never came (hardware keyboard): grow back.
        setTimeout(() => {
          if (token !== openToken.current || !searchOpenRef.current) return;
          if (!kbComing.current && roomTo.current < NO_LIMIT) resizeTo(cardHRef.current, 250, true);
        }, EX_NO_KB_GRACE_MS);
      }
    } else {
      Keyboard.dismiss();
      if (roomTo.current < NO_LIMIT || room.value < NO_LIMIT) resizeTo(cardHRef.current, EX_SEARCH_CLOSE_MS, true);
      // The header never left (search was opened on another tab's header
      // state), so nothing will report it landing.
      if (!headerP || headerP.value === 0) holdAreaH.current = false;
    }
    setSearchOpen(open);
  }, [onSearchOpenChange, room, resizeTo, fitFor, deckBase, headerP]);
  // How much shorter than full the card looks (the card never resizes; see
  // ExploreTripCard).
  const shrinkBy = useDerivedValue(() => {
    if (cardH === 0 || room.value >= NO_LIMIT) return 0;
    return Math.max(0, cardH - Math.max(Math.min(EX_FIT_MIN_H, cardH), Math.min(cardH, room.value)));
  }, [cardH]);

  const renderCard = useCallback(
    (trip: GroupTrip) => <ExploreTripCard trip={trip} meta={meta.get(trip.id)} shrinkBy={shrinkBy} />,
    [meta, shrinkBy],
  );
  const openTrip = useCallback((trip: GroupTrip) => {
    // The keyboard can still be up from search; don't carry it onto the trip.
    Keyboard.dismiss();
    onOpenTrip(trip.id);
  }, [onOpenTrip]);

  let body: React.ReactNode = null;
  if (isError && trips.length === 0) {
    // Error on cold load (no cached data) — show retry instead of an empty
    // state, which would mislead the user.
    body = (
      <FadeInView style={styles.emptyState}>
        <Ionicons name="cloud-offline-outline" size={48} color="#B0B0B0" />
        <Text style={styles.emptyText}>Couldn't load trips. Check your connection.</Text>
        <TouchableOpacity style={styles.emptyCta} onPress={() => refetch()}>
          <Text style={styles.emptyCtaText}>Retry</Text>
        </TouchableOpacity>
      </FadeInView>
    );
  } else if (isLoading) {
    // Same footprint as the real carousel below, so nothing moves when it lands.
    body = cardW > 0 ? (
      <FadeInView style={styles.exFillWidth}>
        <ExploreDeckSkeleton
          cardWidth={cardW}
          cardHeight={cardH}
          gap={EX_CAROUSEL_GAP}
          inset={EX_CAROUSEL_INSET}
        />
      </FadeInView>
    ) : null;
  } else if (visibleTrips.length === 0) {
    body = (
      <FadeInView style={styles.emptyState}>
        <Ionicons name={q ? 'search-outline' : 'compass-outline'} size={48} color="#B0B0B0" />
        <Text style={styles.emptyText}>
          {q
            ? (searchPending ? 'Searching…' : `No trips match "${query.trim()}".`)
            : hasActiveFilter ? 'No trips match these filters.' : 'No trips yet. Check back soon.'}
        </Text>
      </FadeInView>
    );
  } else if (cardW > 0) {
    body = (
      <ExploreCarousel
        items={visibleTrips}
        cardWidth={cardW}
        cardHeight={cardH}
        renderCard={renderCard}
        onOpen={openTrip}
        onIndexChange={handleTopChange}
        getAccessibilityLabel={exploreCardLabel}
        resetKey={listKey}
      />
    );
  }

  return (
    <View style={styles.exRoot}>
      <ExploreSearchRow
        query={query}
        onChangeQuery={setQuery}
        filterCount={activeFilterCount}
        onOpenFilters={() => setFiltersOpen(true)}
        open={searchOpen}
        onOpenChange={changeSearchOpen}
      />
      <View
        ref={deckRef}
        style={styles.exDeckArea}
        onLayout={e => {
          measureDeck();
          const { width } = e.nativeEvent.layout;
          const measured = e.nativeEvent.layout.height;
          setArea(prev => {
            const height = holdAreaH.current && prev.h > 0 ? prev.h : measured;
            return prev.w === width && prev.h === height ? prev : { w: width, h: height };
          });
        }}
      >
        {/* Nothing covers the cards while search is open, so the carousel
            can be swiped (and a card opened) with the keyboard still up.
            This sits BEHIND the cards: a tap on the empty space under them
            drops the keyboard when text is typed, or closes search when the
            box is empty. The X always closes. */}
        {searchOpen && (
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => (q ? Keyboard.dismiss() : changeSearchOpen(false))}
            accessible={false}
          />
        )}
        {body}
      </View>
      <ExploreFiltersSheet
        visible={filtersOpen}
        value={filters}
        onApply={applyFilters}
        viewer={viewer}
      />
    </View>
  );
};

// ---------------------------------------------------------------------------
// Explore header row (Figma 18960:24283): "Travel Better Together." + search +
// filters. Tapping search grows the search button to the LEFT into a text
// field; the title slides out to the left ahead of it and fades. The search
// icon rides the field's left edge, so the button visibly becomes the field.
// ---------------------------------------------------------------------------
const EX_ROW_PAD = 20;
const EX_BTN_W = 48;
const EX_BTN_GAP = 7; // Figma: search at right 55 of a 48 filter button.
// The field's right edge stays where the search button's right edge is.
const EX_FIELD_RIGHT = EX_ROW_PAD + EX_BTN_W + EX_BTN_GAP;
// Strong ease-out: the field answers the tap at once, then settles.
// iOS drawer curve: quick to start, long soft landing — the slide stays on
// screen long enough to read as "the button became the field".
const EX_SEARCH_EASE = Easing.bezier(0.32, 0.72, 0, 1);
const EX_SEARCH_OPEN_MS = 460;
const EX_SEARCH_CLOSE_MS = 360;
// Share of the header slide (0–1) done before the status-bar area starts
// changing color. Higher = later.
const EX_SAFE_AREA_COLOR_FROM = 0.55;
// The field's border turns the app accent while search is open.
const EX_SEARCH_BORDER = '#E4E4E4';
const EX_SEARCH_BORDER_OPEN = '#05BCD3';

const ExploreSearchRow: React.FC<{
  query: string;
  onChangeQuery: (q: string) => void;
  filterCount: number;
  onOpenFilters: () => void;
  /** Owned by the parent, so a tap anywhere else on Explore can close it. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whether the text field has focus (the keyboard is up). */
}> = ({ query, onChangeQuery, filterCount, onOpenFilters, open, onOpenChange }) => {
  const reduceMotion = useReducedMotion();
  const [rowW, setRowW] = useState(0);
  const inputRef = useRef<TextInput>(null);
  const progress = useSharedValue(0);
  // How far the field's left edge travels: from the button to the row's start.
  const travel = Math.max(0, rowW - EX_ROW_PAD - EX_FIELD_RIGHT - EX_BTN_W);
  const travelSV = useSharedValue(0);
  useEffect(() => { travelSV.value = travel; }, [travel, travelSV]);

  // Focus / blur in the tap itself, so the keyboard moves with the slide
  // instead of after a render.
  const openSearch = useCallback(() => {
    inputRef.current?.focus();
    onOpenChange(true);
  }, [onOpenChange]);
  const closeSearch = useCallback(() => {
    inputRef.current?.blur();
    onOpenChange(false);
  }, [onOpenChange]);

  // However it was closed (the X, or a tap elsewhere on the screen), closing
  // drops the keyboard and the query and plays the slide back.
  useEffect(() => {
    progress.value = withTiming(open ? 1 : 0, {
      duration: reduceMotion ? 0 : open ? EX_SEARCH_OPEN_MS : EX_SEARCH_CLOSE_MS,
      easing: EX_SEARCH_EASE,
    });
    if (open) {
      inputRef.current?.focus();
      return;
    }
    inputRef.current?.blur();
    // Clearing the query swaps the whole list back to the full feed — heavy.
    // Do it once the slide has landed, so it can't stall the animation.
    const t = setTimeout(() => onChangeQuery(''), reduceMotion ? 0 : EX_SEARCH_CLOSE_MS + 40);
    return () => clearTimeout(t);
    // onChangeQuery is a state setter; only `open` should drive this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // The title is pushed all the way off the row's left edge (its travel plus
  // the row padding), shrinking a touch, and only fades late — so you watch it
  // leave instead of seeing it vanish in place.
  const titleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.25, 0.9], [1, 0], Extrapolation.CLAMP),
    transform: [
      { translateX: -progress.value * (travelSV.value + EX_ROW_PAD) },
      { scale: interpolate(progress.value, [0, 1], [1, 0.94]) },
    ],
  }));
  const fieldStyle = useAnimatedStyle(() => ({
    width: EX_BTN_W + progress.value * travelSV.value,
    borderColor: interpolateColor(progress.value, [0, 1], [EX_SEARCH_BORDER, EX_SEARCH_BORDER_OPEN]),
    shadowOpacity: progress.value * 0.12,
  }));
  // The magnifier gives a small pop as it sets off to the left.
  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(progress.value, [0, 0.35, 1], [1, 1.15, 1], Extrapolation.CLAMP) }],
  }));
  // Text and the X arrive from the right once the field has room for them.
  const inputStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.45, 1], [0, 1], Extrapolation.CLAMP),
    transform: [{ translateX: interpolate(progress.value, [0.45, 1], [24, 0], Extrapolation.CLAMP) }],
  }));
  const closeStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(progress.value, [0.6, 1], [0.6, 1], Extrapolation.CLAMP) }],
  }));

  return (
    <View
      style={styles.exTopRow}
      // Empty parts of the row let the tap through to the dismiss layer.
      pointerEvents="box-none"
      onLayout={e => {
        const w = e.nativeEvent.layout.width;
        setRowW(prev => (prev === w ? prev : w));
      }}
    >
      <Reanimated.View
        style={[styles.exTitleWrap, titleStyle]}
        pointerEvents={open ? 'none' : 'auto'}
        accessibilityElementsHidden={open}
        importantForAccessibility={open ? 'no-hide-descendants' : 'auto'}
      >
        <Text style={styles.exploreTitle} numberOfLines={1}>Travel Better Together.</Text>
      </Reanimated.View>

      {/* Holds the search button's slot; the field itself floats over it. */}
      <View style={styles.exBtnSlot} />

      <TouchableOpacity
        testID="explore-filter-button"
        style={styles.exFilterBtn}
        onPress={onOpenFilters}
        activeOpacity={0.8}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={filterCount > 0 ? `Filters, ${filterCount} on` : 'Filters'}
      >
        <TripIcon name="settings-04" size={24} color="#212121" strokeWidth={1} />
        {filterCount > 0 && (
          <View style={styles.exFilterBadge}>
            <Text style={styles.exFilterBadgeText}>{filterCount}</Text>
          </View>
        )}
      </TouchableOpacity>

      <Reanimated.View style={[styles.exSearchField, fieldStyle]}>
        <Pressable
          testID="explore-search-button"
          style={styles.exSearchIcon}
          onPress={open ? () => inputRef.current?.focus() : openSearch}
          hitSlop={8}
          accessibilityRole={open ? undefined : 'button'}
          accessibilityLabel={open ? undefined : 'Search trips'}
        >
          <Reanimated.View style={iconStyle}>
            {/* Same color and stroke as the filter icon beside it, so the pair reads
                as one set. */}
            <TripIcon name="search-lg" size={24} color="#212121" strokeWidth={1} />
          </Reanimated.View>
        </Pressable>
        <Reanimated.View style={[styles.exSearchInputWrap, inputStyle]} pointerEvents={open ? 'auto' : 'none'}>
          <TextInput
            ref={inputRef}
            testID="explore-search-input"
            value={query}
            onChangeText={onChangeQuery}
            placeholder="Search trips or places"
            placeholderTextColor="#A0A0A0"
            style={styles.exSearchInput}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
            clearButtonMode="never"
            accessibilityLabel="Search trips"
          />
          <Reanimated.View style={closeStyle}>
            <TouchableOpacity
              onPress={closeSearch}
              hitSlop={10}
              style={styles.exSearchClose}
              accessibilityRole="button"
              accessibilityLabel="Close search"
            >
              <TripIcon name="x-close" size={20} color="#7B7B7B" strokeWidth={1.5} />
            </TouchableOpacity>
          </Reanimated.View>
        </Reanimated.View>
      </Reanimated.View>
    </View>
  );
};

// ---------------------------------------------------------------------------
// Explore carousel (Figma 18960:24187): one card at a time, snapping, with the
// next card peeking in on the right. Replaces the vertical ExploreSwipeDeck.
// ---------------------------------------------------------------------------
// Room under the cards so their drop shadow is not clipped by the list.
const EX_SHADOW_ROOM = 28;
const CarouselGap: React.FC = () => <View style={{ width: EX_CAROUSEL_GAP }} />;

const CarouselCard: React.FC<{
  trip: GroupTrip;
  width: number;
  height: number;
  label?: string;
  onOpen: (trip: GroupTrip) => void;
  children: React.ReactNode;
}> = React.memo(({ trip, width, height, label, onOpen, children }) => {
  // Press feedback: a subtle scale, eased, not a jump.
  const pressed = useSharedValue(0);
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * 0.02 }],
  }));
  return (
    <Pressable
      onPress={() => onOpen(trip)}
      // A swipe starts with a touch too; wait a beat so a swipe doesn't
      // flash the press scale.
      unstable_pressDelay={80}
      onPressIn={() => { pressed.value = withTiming(1, { duration: 120, easing: Easing.out(Easing.quad) }); }}
      onPressOut={() => { pressed.value = withTiming(0, { duration: 160, easing: Easing.out(Easing.quad) }); }}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Reanimated.View style={[{ width, height }, style]}>{children}</Reanimated.View>
    </Pressable>
  );
});

const ExploreCarousel: React.FC<{
  items: GroupTrip[];
  cardWidth: number;
  cardHeight: number;
  renderCard: (trip: GroupTrip) => React.ReactNode;
  onOpen: (trip: GroupTrip) => void;
  onIndexChange: (index: number) => void;
  getAccessibilityLabel: (trip: GroupTrip) => string;
  resetKey: string;
}> = ({ items, cardWidth, cardHeight, renderCard, onOpen, onIndexChange, getAccessibilityLabel, resetKey }) => {
  const listRef = useRef<FlatList<GroupTrip>>(null);
  const interval = cardWidth + EX_CAROUSEL_GAP;
  const indexRef = useRef(0);

  useEffect(() => {
    indexRef.current = 0;
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [resetKey]);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.max(0, Math.round(e.nativeEvent.contentOffset.x / interval));
    if (i !== indexRef.current) {
      indexRef.current = i;
      onIndexChange(i);
    }
  }, [interval, onIndexChange]);

  const renderItem = useCallback(({ item }: { item: GroupTrip }) => (
    <CarouselCard
      trip={item}
      width={cardWidth}
      height={cardHeight}
      label={getAccessibilityLabel(item)}
      onOpen={onOpen}
    >
      {renderCard(item)}
    </CarouselCard>
  ), [cardWidth, cardHeight, getAccessibilityLabel, onOpen, renderCard]);

  const getItemLayout = useCallback((_: unknown, index: number) => ({
    length: interval,
    offset: EX_CAROUSEL_INSET + interval * index,
    index,
  }), [interval]);

  return (
    <FlatList
      ref={listRef}
      testID="explore-carousel"
      data={items}
      keyExtractor={t => t.id}
      renderItem={renderItem}
      getItemLayout={getItemLayout}
      ItemSeparatorComponent={CarouselGap}
      horizontal
      showsHorizontalScrollIndicator={false}
      // Search can leave the keyboard up: swipes and taps on a card work
      // without closing it first.
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="none"
      snapToInterval={interval}
      snapToAlignment="start"
      decelerationRate="fast"
      disableIntervalMomentum
      onScroll={onScroll}
      scrollEventThrottle={32}
      initialNumToRender={3}
      windowSize={5}
      style={[styles.exCarousel, { height: cardHeight + EX_SHADOW_ROOM, marginBottom: -EX_SHADOW_ROOM }]}
      contentContainerStyle={styles.exCarouselContent}
    />
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

// Accounts that keep BOTH the setup banner and the "Create a trip" card while
// their operator setup is unfinished — Ohad's, so he can test the two together.
const KEEP_CREATE_CARD_DURING_SETUP = new Set(['ecaaa678-974a-4641-895a-12cf12e74599']);

const CreateTripCard: React.FC<{ onPress: () => void }> = ({ onPress }) => (
  <TouchableOpacity
    testID="trips-create-trip-card"
    style={styles.createCard}
    onPress={onPress}
    activeOpacity={0.85}
    accessibilityRole="button"
    accessibilityLabel="Create a trip. For surf trip operating businesses."
  >
    <Image source={Images.createTrip.card} style={styles.createCardThumb} resizeMode="cover" />
    <View style={styles.createCardRight}>
      <View style={styles.createCardBody}>
        <Text style={styles.createCardTitle}>Create a trip</Text>
        <Text style={styles.createCardDesc}>
          For surf trip operating businesses.{'\n'}Everything's set
        </Text>
      </View>
      {/* Figma draws this plus at 1.5px on a 24 grid; the icon's own grid is
          28, so the stroke is scaled to match (1.5 × 28 / 24). */}
      <TripIcon name="plus" size={24} color="#05BCD3" strokeWidth={1.75} />
    </View>
  </TouchableOpacity>
);

const MyTripsView: React.FC<{
  userId: string | null;
  /** Operators get the "Create a trip" card; everyone else is sent to Explore. */
  isOperator: boolean;
  /** False until we know whether they are an operator. */
  operatorReady: boolean;
  /** Operators only, and not while "Finish your setup" is showing — one or the other. */
  showCreateCard: boolean;
  onCreateTrip: () => void;
  onExplore: () => void;
  onOpenTrip: (tripId: string) => void;
  onNavScroll?: NavScrollHandler;
}> = ({ userId, isOperator, operatorReady, showCreateCard, onCreateTrip, onExplore, onOpenTrip, onNavScroll }) => {
  // Cached + stale-while-revalidate (see useExploreTrips). Re-entry is instant;
  // pull-to-refresh and post-create/edit invalidation drive background updates.
  const { data, isLoading, isFetching, refetch } = useMyTrips(userId);
  const buckets = data?.buckets ?? EMPTY_BUCKETS;
  const meta = data?.meta ?? EMPTY_META;
  const [filter, setFilter] = useState<TripFilter>('all');

  // Warm the detail query on press-in so the trip opens instantly (header is
  // already seeded from this list cache; this primes participants + myRequest).
  // Mirrors ExploreTripCard's onPressIn. Skip while userId is unknown — a
  // userId-less prefetch would cache myRequest=null and show a wrong CTA.
  const queryClient = useQueryClient();
  const prefetchDetail = useCallback((id: string) => {
    if (!userId) return;
    queryClient.prefetchQuery({
      queryKey: tripsKeys.detail(id),
      queryFn: ({ signal }) => fetchTripCore(id, userId, signal),
      gcTime: TRIP_DETAIL_GC_MS,
    });
  }, [queryClient, userId]);
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
    completed: buckets.past.length,
  };
  const visible = filter === 'all' ? tagged : tagged.filter(x => x.status === filter);

  // The empty state has two different buttons, so hold the skeleton until we
  // know which one — otherwise an operator sees "Explore trips" flash first.
  if (isLoading || (tagged.length === 0 && !operatorReady)) {
    return <MyTripsSkeleton />;
  }

  if (tagged.length === 0) {
    // Figma 17029:25489 — palm illustration, "No trips yet?" and one accent
    // button: operators create a trip, everyone else goes to Explore.
    return (
      <FadeInView style={styles.emptyWrap}>
        <NoTripsEmptyState
          variant={isOperator ? 'create' : 'explore'}
          onPress={isOperator ? onCreateTrip : onExplore}
        />
      </FadeInView>
    );
  }

  return (
    <FlatList
      data={visible}
      keyExtractor={x => x.trip.id}
      onScroll={onNavScroll}
      scrollEventThrottle={16}
      // Windowing: cap the cards mounted/laid-out on activation so the Yoga
      // layout pass doesn't stutter the bottom-bar animation on tab switch.
      initialNumToRender={4}
      maxToRenderPerBatch={4}
      windowSize={5}
      removeClippedSubviews
      ListHeaderComponent={
        <FadeInView>
          {showCreateCard && <CreateTripCard onPress={onCreateTrip} />}
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
            onPressIn={() => prefetchDetail(item.trip.id)}
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
// Tab pager — slide + cross-fade between the two tabs
// ---------------------------------------------------------------------------
// Visual order MUST match the header bar (My Trips · Explore) so the
// slide direction matches where the user taps. Both panes stay mounted
// (preserves scroll + react-query state); we only translate the row and
// cross-fade each pane as it crosses the viewport.
const TAB_ORDER: TripsTab[] = ['my', 'explore'];
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
export default function TripsScreen({ navControl: navControlProp }: TripsScreenProps) {
  const insets = useSafeAreaInsets();
  const { user: contextUser } = useOnboarding();
  const currentUserId = contextUser?.id?.toString() ?? null;
  const navigation = useNavigation();
  // Trip detail + edit are CARDS on the root stack now (nav migration Phase 2):
  // push bubbles up from this tab screen to the root navigator.
  const openTrip = useCallback(
    (tripId: string, focus?: TripDetailFocus | null) => {
      navigation.dispatch(StackActions.push('TripDetail', { tripId, focus: focus ?? null }));
    },
    [navigation],
  );

  const queryClient = useQueryClient();
  const reduceMotion = useReducedMotion();
  // Cached and shared with the Create gate below — both must give the same
  // answer, or the banner and the chooser end up disagreeing on screen.
  const operatorSetup = useOperatorSetup();

  // Keep Explore + My Trips live while this screen is mounted — new trips,
  // card edits, member counts. Per-trip realtime is useTripRealtime in detail.
  useTripsListRealtime(currentUserId ?? undefined);

  const [activeTab, setActiveTab] = useState<TripsTab>('explore');
  // Tabs are lazily mounted on first visit, then kept mounted (translated
  // off-screen in the pager row) so switching back is instant and scroll
  // position + react-query state are preserved.
  const [visited, setVisited] = useState<Record<TripsTab, boolean>>({
    explore: true,
    my: false,
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

  // Switch tabs: mark visited synchronously (so the incoming pane has content as
  // it slides in — no empty-cell flash) and set the active tab.
  const goToTab = useCallback((tab: TripsTab) => {
    setVisited(prev => (prev[tab] ? prev : { ...prev, [tab]: true }));
    setActiveTab(tab);
  }, []);

  // App re-entry: when the app opens, a user on a trip (host, staff, or an
  // approved traveler, on a trip that has not ended: My Trips' "approved"
  // bucket) lands on My Trips. Everyone else stays on Explore. Decided once,
  // from the first My Trips data. Skipped if the user already switched tabs,
  // or if that data took so long that they are already browsing Explore.
  const { data: myTripsForEntry } = useMyTrips(currentUserId);
  const entryDecided = useRef(false);
  const mountedAt = useRef(Date.now());
  useEffect(() => {
    if (entryDecided.current || !myTripsForEntry) return;
    entryDecided.current = true;
    if (activeTab !== 'explore') return;
    if (Date.now() - mountedAt.current > ENTRY_DECISION_WINDOW_MS) return;
    if (myTripsForEntry.buckets.approved.length === 0) return;
    // Open already on My Trips: snap, don't slide.
    firstSlide.current = true;
    goToTab('my');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myTripsForEntry]);

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
  // The hosting style the wizard is open for. null = wizard closed. Only 'C'
  // is reachable now — the "Create a trip" card on My Trips, operators only.
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
    // Only style C is gated. The other two are ordinary group trips that need
    // no Stripe account, no waiver and no refund policy — blocking those would
    // punish an operator for being promoted (Ohad, 2026-08-11).
    if (key === 'C' && operatorSetup.needsSetup && !bypassesOperatorSetup(currentUserId)) {
      pushRootCard('OperatorSetup', undefined);
      return;
    }
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

  // Explore search open → slide the header (title bar + tabs) up and out,
  // the way The Lineup's search does, so the search field rises to the top.
  // Driven by refs, NOT state: re-rendering this whole screen on every open /
  // close is what froze the slide. The child calls onExploreSearchChange in
  // the tap, and the header starts moving on the UI thread right away.
  const headerH = useSharedValue(0);
  const headerP = useSharedValue(0);
  const statusBarTouched = useRef(false);
  const exploreSearchingRef = useRef(false);
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const headerHiddenRef = useRef(false);
  const applyHeader = useCallback((hidden: boolean) => {
    if (hidden === headerHiddenRef.current) return;
    headerHiddenRef.current = hidden;
    headerP.value = withTiming(hidden ? 1 : 0, {
      duration: reduceMotion ? 0 : hidden ? EX_SEARCH_OPEN_MS : EX_SEARCH_CLOSE_MS,
      easing: EX_SEARCH_EASE,
    });
    // Dark text on the light top while searching. Only touch the status bar
    // once search has actually opened, so mounting this screen in the
    // background never overrides another screen's style.
    if (hidden) statusBarTouched.current = true;
    if (statusBarTouched.current) setStatusBarStyle(hidden ? 'dark' : 'light', true);
  }, [headerP, reduceMotion]);
  const onExploreSearchChange = useCallback((open: boolean) => {
    exploreSearchingRef.current = open;
    applyHeader(open && activeTabRef.current === 'explore');
  }, [applyHeader]);
  useEffect(() => {
    applyHeader(exploreSearchingRef.current && activeTab === 'explore');
  }, [activeTab, applyHeader]);
  // Leaving the screen mid-search (opening a trip, another tab, unmount) must
  // not leave dark status-bar text on the next screen's dark top; coming back
  // with search still open puts it back.
  useEffect(() => {
    const offBlur = navigation.addListener('blur', () => {
      if (statusBarTouched.current) setStatusBarStyle('light', true);
    });
    const offFocus = navigation.addListener('focus', () => {
      if (headerHiddenRef.current) setStatusBarStyle('dark', true);
    });
    return () => {
      offBlur();
      offFocus();
      if (statusBarTouched.current) setStatusBarStyle('light', true);
    };
  }, [navigation]);
  // The wrapper's height shrinks to 0 (so the page below rises) while the
  // header inside moves up by the same amount (so it slides, not crops).
  // The slide is a TRANSFORM, not a height change: the header and the page
  // under it move up together by the header's height. Animating the header's
  // height made the whole screen re-layout every frame (Explore, My Trips, the
  // cards) — smooth in the simulator, dropped frames on a real phone, so the
  // header, the cards and the photo read as separate movements. The page is
  // one header taller (below the screen's bottom edge, clipped) so its bottom
  // never comes up short; see pageShift.
  const [headerPx, setHeaderPx] = useState(0);
  const pageShiftStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -headerH.value * headerP.value }],
  }));
  // The header fades to the search white with the SAME progress as the
  // status-bar area above it (rootBgStyle), so the two read as one surface —
  // like The Lineup's search page. The header is #212121, the same dark as
  // the root, so a #FAFAFA veil at opacity p matches the interpolated color.
  const headerVeilStyle = useAnimatedStyle(() => ({ opacity: headerP.value }));
  // The status-bar area waits until the header has slid most of the way up
  // under it, then turns white (EX_SAFE_AREA_COLOR_FROM). Closing plays it
  // backwards: it turns dark first, then the header slides back in.
  const rootBgStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(headerP.value, [EX_SAFE_AREA_COLOR_FROM, 1], ['#212121', '#FAFAFA']),
  }));

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      {/* Behind the status bar: dark with the header, light once search slides
          the header away (like The Lineup's search). */}
      <Reanimated.View style={[StyleSheet.absoluteFill, rootBgStyle]} pointerEvents="none" />
      {/* Shared dark header (see MainHeader). "Trips" is the title slot and the
          underline tabs are the `below` slot; no gradient hairline here.
          While Explore search is open it slides up out of the way and the
          page rises with it. */}
      {/* Clips the page at the safe-area edge, so the header slides up
          under the status bar instead of over it. */}
      <View style={styles.pageClip}>
      <Reanimated.View
        style={[styles.pageShift, { marginBottom: -headerPx, paddingBottom: headerPx }, pageShiftStyle]}
      >
      <View style={styles.headerWrap}>
        <View
          onLayout={e => {
            const h = e.nativeEvent.layout.height;
            if (h > 0 && h !== headerH.value) headerH.value = h;
            if (h > 0) setHeaderPx(prev => (prev === h ? prev : h));
          }}
        >
          <MainHeader
            userId={currentUserId}
            title={<Text style={styles.tripsHeaderTitle}>Trips</Text>}
            // Figma bar is 59px (17779:51132), not the default 60. The pixel comes
            // off the bottom so the logo + bell stay level with The Lineup's.
            spaceBelow={7}
            below={<TripsHeaderTabs active={activeTab} onChange={goToTab} />}
          />
        </View>
        <Reanimated.View
          style={[StyleSheet.absoluteFill, styles.headerVeil, headerVeilStyle]}
          pointerEvents="none"
        />
      </View>

      {/* My Trips only. That is where the "Create a trip" card it gates lives,
          and on Explore its ~105px would push the card stack under the nav
          bar (the stack cannot scroll — it is swiped in every direction). */}
      {operatorSetup.needsSetup && activeTab === 'my' && (
        <OperatorSetupBanner
          summary={operatorSetup.summary}
          total={operatorSetup.steps.length}
          done={operatorSetup.steps.length - operatorSetup.outstanding.length}
          onPress={() => pushRootCard('OperatorSetup', undefined)}
        />
      )}

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
                isOperator={operatorSetup.isOperator}
                operatorReady={operatorSetup.isReady}
                // `complete` is false while setup is still loading, so the card
                // cannot flash and then swap for the banner on a cold start.
                showCreateCard={
                  operatorSetup.complete ||
                  (operatorSetup.isOperator &&
                    !!currentUserId &&
                    (KEEP_CREATE_CARD_DURING_SETUP.has(currentUserId) ||
                      bypassesOperatorSetup(currentUserId)))
                }
                onCreateTrip={() => void onPickStyle('C')}
                onExplore={() => goToTab('explore')}
                onOpenTrip={openTrip}
                onNavScroll={handleMyNavScroll}
              />
            ) : null}
          </TabPane>

          {/* index 1 — Explore */}
          <TabPane index={1} width={bodyW} tx={tx} reduceMotion={reduceMotion}>
            {visited.explore ? (
              <ExploreTripsView
                onOpenTrip={openTrip}
                userId={currentUserId}
                onSearchOpenChange={onExploreSearchChange}
                headerH={headerH}
                headerP={headerP}
              />
            ) : null}
          </TabPane>

        </Reanimated.View>
      </View>
      {/* The extra header-tall strip under the page: it only comes into view
          while the page is slid up, and matches Explore's white. */}
      <View style={[styles.pageTail, { height: headerPx }]} pointerEvents="none" />
      </Reanimated.View>
      </View>

      {/* Trip detail + edit are CARDS on the root stack now (Phase 2) —
          pushed via openTrip; this screen stays mounted underneath them. */}

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
  // Same white as Explore's page (exRoot) and the status-bar area in search.
  headerVeil: { backgroundColor: '#FAFAFA' },
  pageClip: { flex: 1, overflow: 'hidden' },
  pageShift: { flex: 1 },
  headerWrap: { overflow: 'hidden' },
  pageTail: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#FAFAFA' },

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
    paddingLeft: 16, // align logo with the 16px content gutter + the Lineup header
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
    fontFamily: ff('Inter', '700'),
    fontSize: fs(22),
    fontWeight: Platform.OS === 'web' ? '700' : undefined,
    includeFontPadding: false,
    color: '#FFFFFF',
  },

  // Figma "Menu tags" (17779:51132): each tab is 42px tall — 12 + 18 label + 12.
  // The underline is drawn INSIDE that 42 in Figma, but a border adds to the
  // box here, so each state takes its border off the bottom padding. Without
  // that (and with the old 4px row padding) the header came out 8px too tall.
  tabsRow: {
    flexDirection: 'row',
  },
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 12,
    paddingHorizontal: 8,
  },
  tabBtnActive: {
    paddingBottom: 8,
    borderBottomWidth: 4,
    borderBottomColor: '#05BCD3',
  },
  tabBtnInactive: {
    paddingBottom: 10,
    borderBottomWidth: 2,
    borderBottomColor: '#7B7B7B',
  },
  tabLabel: { fontFamily: ff('Inter', '400'), fontSize: fs(14), lineHeight: 18, fontWeight: '400', letterSpacing: 0.3, includeFontPadding: false },
  tabLabelActive: { color: '#05BCD3' },
  tabLabelInactive: { color: '#FFFFFF' },

  body: { flex: 1, backgroundColor: '#FFFFFF', paddingTop: 0, overflow: 'hidden' },
  // Horizontal pager row: three full-width panes laid side by side; translateX
  // slides between them. Width is set inline once the viewport is measured.
  pagerRow: { flex: 1, flexDirection: 'row' },

  // Explore (Figma 17779:50970): title + filter button, then the card stack.
  exRoot: { flex: 1, backgroundColor: '#FAFAFA' },
  // Figma 18960:24283: 42 tall, 21 under the header, 22 above the cards.
  exTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: EX_BTN_GAP,
    height: 42,
    paddingHorizontal: EX_ROW_PAD,
    marginTop: 21,
    marginBottom: 22,
    zIndex: 2,
  },
  exTitleWrap: { flex: 1, minWidth: 0 },
  // Inter Bold 20/24. The node is Body/M B-1, but its Size/lg resolves to 20
  // on this layer, not the 16 the style has elsewhere — measured on the render.
  exploreTitle: {
    fontFamily: ff('Inter', '700'),
    fontSize: fs(20),
    lineHeight: 24,
    fontWeight: Platform.OS === 'web' ? '700' : undefined,
    includeFontPadding: false,
    color: '#333333',
  },
  exBtnSlot: { width: EX_BTN_W, height: 42 },
  // The search button and, once open, the field. Anchored on the right where
  // the button sits; its width grows to the left.
  exSearchField: {
    position: 'absolute',
    right: EX_FIELD_RIGHT,
    top: 0,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E4E4E4',
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    // Lifts off the page as it opens (opacity is animated from 0).
    shadowColor: '#05BCD3',
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    shadowOpacity: 0,
  },
  // 12 + 24 + 12 = the closed 48 width, so the icon sits centred when closed.
  exSearchIcon: { width: EX_BTN_W - 2, height: 40, alignItems: 'center', justifyContent: 'center' },
  exSearchInputWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingRight: 12 },
  exSearchInput: {
    ...textStyles.MB2,
    flex: 1,
    color: '#333333',
    paddingVertical: 0,
    height: 40,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
  },
  exSearchClose: { marginLeft: 8 },
  exFilterBtn: {
    width: EX_BTN_W,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E4E4E4',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  exFilterBadge: {
    position: 'absolute',
    top: -6,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: '#FF5367',
    alignItems: 'center',
    justifyContent: 'center',
  },
  exFilterBadgeText: { ...textStyles.B3, lineHeight: 16, color: '#FFFFFF' },
  exDeckArea: { flex: 1 },
  exFillWidth: { alignSelf: 'stretch' },
  exCarousel: { flexGrow: 0, overflow: 'visible' },
  exCarouselContent: { paddingHorizontal: EX_CAROUSEL_INSET, paddingBottom: EX_SHADOW_ROOM },

  // Explore filter sheet.
  listContent: { paddingHorizontal: 16, paddingBottom: 150, flexGrow: 1 },

  // Filter pills (My Trips, Figma 17029:25735): three hug-width pills packed to
  // the left, 11 apart. Each is 33 tall — 8 + 17 line + 8.
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 22,
    marginBottom: 28,
    marginHorizontal: 6,
    gap: 11,
  },
  filterPill: {
    minWidth: 42,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterPillActive: { backgroundColor: '#212121' },
  filterPillInactive: {
    backgroundColor: '#F7F7F7',
    borderWidth: 1,
    borderColor: '#EEEEEE',
  },
  // Body/B-4 — Size/xs resolves to 10 on the pill instances (17029:25736/7).
  filterText: { fontFamily: ff('Inter', '400'), fontSize: fs(10), lineHeight: 17, textAlign: 'center', includeFontPadding: false },
  filterTextActive: { color: '#FFFFFF' },
  filterTextInactive: { color: '#333333' },
  filterEmpty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48 },

  // Trip card (Figma): photo with overlaid host/title/avatars + status badge.
  // Figma 17029:25623: 350 wide on a 393 frame, 10 of padding round the photo.
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 32,
    padding: 10,
    marginHorizontal: 5,
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
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#FFFFFF',
    backgroundColor: '#3A3A3A',
  },
  hostAvatarPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  hostName: {
    flex: 1,
    ...textStyles.MB2,
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },

  cardTextBlock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    // The glass hugs its text (Figma 14382:56288): 88 tall with a one-line
    // description, taller when the description wraps. It was a fixed 120 before,
    // so a short card had ~32px of empty glass above the title.
    minHeight: 88,
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
    paddingTop: 8,
    paddingRight: 16,
    paddingBottom: 24,
    paddingLeft: 16,
    gap: 4,
  },
  cardTitle: {
    ...textStyles.H4,
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  cardDesc: {
    ...textStyles.MB2,
    color: '#FFFFFF',
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
    right: 11,
    bottom: 11,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F7F7F7',
    borderRadius: 56,
    borderWidth: 1,
    borderColor: '#CFCFCF',
    paddingVertical: 1,
    paddingLeft: 1,
    paddingRight: 8,
  },
  clusterAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#DDDDDD',
    borderWidth: 1,
    borderColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.18,
    shadowRadius: 2.5,
    elevation: 3,
  },
  clusterAvatarOverlap: { marginLeft: -16 },
  avatarClusterTight: { paddingRight: 0 },
  avatarClusterCount: { gap: 4, paddingLeft: 8 },
  // Headings/H-7 for size and line height (12/16); the layer overrides the
  // weight to Regular.
  clusterMore: {
    marginLeft: 2,
    ...textStyle('H7', '400'),
    color: '#7B7B7B',
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
    gap: 8,
  },
  statusLabel: { ...textStyles.B3, color: '#0A0A0A' },
  statusDate: { ...textStyles.B3, color: '#4A5565', flexShrink: 1 },

  // Explore card (Figma 17779:51085): white frame, photo, host + price row.
  // See ExploreTripCard: the card is clipped by transforms, never resized.
  exCard: { flex: 1 },
  exCardShadow: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#FFFFFF',
    borderRadius: 32,
    shadowColor: '#3E3E3E',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 6,
  },
  exCardWindow: { flex: 1, borderRadius: 32, overflow: 'hidden' },
  exFrame: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    overflow: 'hidden',
    padding: EX_FRAME_PAD,
    gap: EX_FRAME_PAD,
  },
  exImage: { flex: 1, borderRadius: 24, overflow: 'hidden' },
  exPhotoContent: {
    ...StyleSheet.absoluteFillObject,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#F2F2F2',
  },
  exPills: { position: 'absolute', top: 20, left: 8, right: 8, flexDirection: 'row', gap: 8 },
  // Figma 17779:51090 — 33 tall: 8 + the 17 line + 8.
  exPill: {
    backgroundColor: 'rgba(255,255,255,0.6)',
    borderRadius: 32,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flexShrink: 1,
  },
  exPillText: { ...textStyles.B4, color: '#333333' },
  exPanel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    // Figma 18675:22534: 170 of the 408 image, so the logo row fits. A floor,
    // not a fixed height: on a short photo the text needs more than 42%, and a
    // fixed height clipped the title's top.
    minHeight: '42%',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  exPanelContent: { paddingLeft: 20, paddingRight: 16, paddingVertical: 16, gap: 9 },
  exRoute: { gap: 4 },
  // "H6.2" in Figma — Inter Bold 20/24, a fixed size with no Size/* variable.
  exTitle: {
    fontFamily: ff('Inter', '700'),
    fontSize: fs(20),
    lineHeight: 24,
    fontWeight: Platform.OS === 'web' ? '700' : undefined,
    includeFontPadding: false,
    color: '#FFFFFF',
  },
  exLocation: { ...textStyles.MB2, color: '#FFFFFF' },
  exDateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  exDates: { ...textStyles.MB1, color: '#FFFFFF', flexShrink: 1 },
  exCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F7F7F7',
    borderRadius: 56,
    paddingLeft: 1,
    paddingVertical: 1,
    paddingRight: 8,
  },
  exClusterAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#DDDDDD' },
  exClusterOverlap: { marginLeft: -16 },
  // Headings/H-7 for size and line height (12/16), but the layer overrides the
  // weight to Regular — the style alone would draw it bold.
  exClusterCount: { ...textStyle('H7', '400'), color: '#7B7B7B', marginLeft: 4 },
  exInfo: {
    height: EX_INFO_H,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingTop: 8,
    paddingBottom: 16,
    paddingHorizontal: 16,
  },
  exHost: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  exHostAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#FFFFFF',
    backgroundColor: '#B0B0B0',
  },
  exHostText: { flexShrink: 1 },
  exHostLabel: { ...textStyle('B3', '700'), color: '#333333' },
  exHostName: { ...textStyles.MB2, color: '#333333' },
  // "H3.2" in Figma — Inter Bold, Size/3xl, line height 24.
  exPrice: {
    fontFamily: ff('Inter', '700'),
    fontSize: fs(fontSize['3xl']),
    lineHeight: 28,
    fontWeight: Platform.OS === 'web' ? '700' : undefined,
    includeFontPadding: false,
    color: '#333333',
    // A price range is wide; it may shrink its font, but not squeeze the host
    // name down to an initial.
    maxWidth: '58%',
    textAlign: 'right',
  },

  fillFlex: { flex: 1 },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 64 },
  emptyText: { fontFamily: ff('Inter', '400'), fontSize: fs(14), color: '#7B7B7B', marginTop: 12, textAlign: 'center', includeFontPadding: false },
  emptyCta: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#0788B0',
  },
  emptyCtaText: { fontFamily: ff('Inter', '600'), color: '#FFFFFF', fontWeight: Platform.OS === 'web' ? '600' : undefined, includeFontPadding: false },

  // "No trips yet?" empty state (see NoTripsEmptyState) — fills the pane so the
  // illustration + CTA sit centred.
  emptyWrap: { flex: 1 },

  // "Create a trip" card on My Trips — operators only (Figma 17779:50948).
  createCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    minHeight: 94,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#2BCCBD',
    paddingLeft: 12,
    paddingRight: 6,
    paddingVertical: 12,
    marginTop: 22,
    // With the filter row's own top margin this is the 30 Figma leaves below.
    marginBottom: 8,
    shadowColor: '#596E7C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 3,
  },
  createCardThumb: { width: 84, height: 70, borderRadius: 8, backgroundColor: '#EEF2F4' },
  // Text and plus sit 8 apart; the photo is 16 from them (the card's gap).
  createCardRight: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 4 },
  createCardBody: { flex: 1, gap: 8 },
  createCardTitle: { ...textStyle('MB2', '700'), color: '#333333' },
  createCardDesc: { ...textStyles.B3, color: '#333333' },

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
