// TripDetailViewRedesigned — the Figma "Overview" layout for the real
// TripDetailScreen (Figma node 12557-3316, "how a non-member sees the trip").
//
// This is a visual reskin of TripDetailView. It is intentionally a SEPARATE
// component so the create-trip wizard PREVIEW keeps using the original
// TripDetailView and is left untouched. Both share the same TripDetailVM and the
// pure label/format helpers (imported from TripDetailView), so the data contract
// stays in one place.
//
// 2 Oct 2026 — Figma 17157:26127 (Ohad): the top card carries the host and
// the surf stats (level, wave type, wave range) instead of a countdown; three
// small cards under it (Participants, Local Crew, Trip Vibe) replace the row of
// eight; the price moves to the bar at the bottom of the trip screen (see
// `priceDetailsRef`). "How this trip works" and "Wave information" are gone
// (waves live in the top card). "Who it's for" stays — age range has no other
// home. All trip types.
//
// What changed vs TripDetailView:
//   • Countdown rendered as 4 bordered boxes (accent number + label inside).
//   • Info chips get a rounded icon box above the label/value.
//   • Hero card + section titles use Inter (matching the Figma type ramp).
//   • "About this trip" gets a See More / See less toggle.
//   • Surf style is wrapped in a bordered card (pills + boards).
//   • New "Who it's for" and "Wave information" sections (Figma shows them in
//     addition to the top chips — duplicated on purpose).
//   • Accommodation is a rounded-32 card with an info pill.

import React, { useEffect, useLayoutEffect, useState } from 'react';
// Remote user-content images (hero, avatars, stay photo) go through expo-image
// for its disk cache — upload URLs are immutable, so cached copies never stale.
import { Image as CachedImage } from 'expo-image';
import {
  View,
  Text,
  Image,
  StyleSheet,
  Platform,
  ScrollView,
  TouchableOpacity,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Reanimated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { TRIP_VIBE_OPTIONS } from '../../services/trips/groupTripsService';
import {
  priceInclusionSections,
  priceInclusionAddOns,
  CATEGORY_TITLE,
} from '../../services/trips/priceInclusions';
import { WizardBottomSheet } from './WizardBottomSheet';
import { CrewCards } from './CrewSection';
import { StayCertRows } from './overview/StayCertRows';
import { Images } from '../../assets/images';
import { TripIcon, type TripIconName } from './tripIcons';
import { textStyle, textStyles } from '../../theme/typography';
import { getStorageThumbUrl } from '../../services/media/imageService';
import { Thumb } from '../Thumb';

// Trip Overview icon color (Figma "Untitled UI" ink).
const ICON_INK = '#222B30';

import {
  type TripDetailViewProps,
  BOARD_IMAGE_EVEN,
  BOARD_SHORT,
  BUDGET_VIBE,
  computeCountdownTarget,
  formatAge,
  formatDateRange,
  formatSkillLevel,
  formatSkillRange,
} from './TripDetailView';
import { formatTripPrice, formatTripPriceRange } from '../../utils/currency';
import { useViewer } from '../../hooks/useViewer';

/** How long the cover takes to slide away (or back). The trip screen waits
 *  this long before swapping in the Chat tab, so the two must stay in step. */
export const HERO_SLIDE_MS = 300;

const FONT_INTER = Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter';
const FONT_MONTSERRAT = Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat';

// Open the accommodation booking/listing link, tolerating URLs typed without a
// scheme (e.g. "airbnb.com/...").
function openStayUrl(raw: string) {
  const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  Linking.openURL(url).catch(() => {});
}

// Surf-style board height — Figma's 70 (12558-4942, again in 17020-29476).
// Widths derive from each board's aspect ratio so they stay even.
const BOARD_H = 70;

const C = {
  accent: '#05BCD3', // countdown numbers (brighter Figma accent)
  accentTint: '#EAF9FC',
  brandTeal: '#0788B0', // chip icons + links
  ink: '#333333',
  inkDark: '#212121',
  inkBody: '#222B30',
  textMuted: '#7B7B7B',
  textFaint: '#A0A0A0',
  textHowDesc: '#4A5565',
  border: '#EEEEEE',
  borderCard: '#E8E8E8',
  borderChip: '#E4E4E4', // Colors/Neutral/400 — "About <host>" profile chips
  borderIconCell: '#CFCFCF', // Stroke/M - 03 — boxed icon cells
  iconBubble: '#F4F6F7',
  surface: '#FFFFFF',
  surfaceMuted: '#F7F7F7',
  chipBg: '#EEEEEE',
  brandTealTint: '#E6F4F8',
  avatarBg: '#9CB6C0',
  verified: '#B72DF2', // Fill/Tertiary — "Trip Vibe" label, "Verified Swellyo Stay"
};

// Icon per "What's included" category — keyed by display title, mirroring the
// create-flow pricing step.
const INCLUDE_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  [CATEGORY_TITLE.meals]: 'restaurant-outline',
  [CATEGORY_TITLE.accommodation]: 'bed-outline',
  [CATEGORY_TITLE.transportation]: 'car-outline',
  [CATEGORY_TITLE.surfSessions]: 'water-outline',
  [CATEGORY_TITLE.surfEquipment]: 'construct-outline',
  [CATEGORY_TITLE.surfFilm]: 'film-outline',
  [CATEGORY_TITLE.videoAnalysis]: 'videocam-outline',
  [CATEGORY_TITLE.activities]: 'compass-outline',
  [CATEGORY_TITLE.wellness]: 'leaf-outline',
  [CATEGORY_TITLE.custom]: 'sparkles-outline',
};

// ---------------------------------------------------------------------------
const SectionTitle: React.FC<{ title: string; right?: React.ReactNode }> = ({ title, right }) => (
  <View style={styles.sectionTitleRow}>
    <Text style={styles.sectionTitle}>{title}</Text>
    {right ?? null}
  </View>
);

// Small "Edit" pill (Figma admin view) — white surface, hairline border, a
// pencil glyph + label. Shown only to the host.
const EditPill: React.FC<{ label: string; onPress?: () => void }> = ({ label, onPress }) => (
  <TouchableOpacity
    style={styles.editPill}
    onPress={onPress}
    activeOpacity={0.7}
    accessibilityRole="button"
    accessibilityLabel={label}
  >
    <TripIcon name="edit-02" size={14} color={C.ink} />
    <Text style={styles.editPillText}>{label}</Text>
  </TouchableOpacity>
);

// Icon-box + label + value cell, used by "Who it's for" and "Wave information".
const IconCell: React.FC<{
  icon: TripIconName;
  label: string;
  value: string;
}> = ({ icon, label, value }) => (
  <View style={styles.iconCell}>
    <View style={styles.iconCellBox}>
      <TripIcon name={icon} size={18} color={ICON_INK} strokeWidth={1.1} />
    </View>
    <View style={styles.iconCellText}>
      <Text style={styles.iconCellLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.iconCellValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  </View>
);


// ---------------------------------------------------------------------------
// Countdown — 4 bordered boxes (number + label stacked inside each box).
// Mirrors TripDetailView's countdown logic but with the boxed Figma styling.
// ---------------------------------------------------------------------------
const MS_MIN = 60_000;
const MS_HOUR = 3_600_000;
const MS_DAY = 86_400_000;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
function addMonths(base: Date, n: number): Date {
  const d = new Date(base.getTime());
  d.setMonth(d.getMonth() + n);
  return d;
}

const CountdownBoxes: React.FC<{ target: Date | null }> = ({ target }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!target) return null;
  const diffMs = Math.max(0, target.getTime() - now);
  // "Under a month" = less than one calendar month away (not a fixed 31 days).
  // At/over a month we lead with Months (no seconds); under it we lead with Days
  // and reveal Seconds (Figma node 12557-3316).
  const underOneMonth = target.getTime() < addMonths(new Date(now), 1).getTime();

  let blocks: { value: string; label: string }[];

  if (!underOneMonth) {
    // ≥ 1 month out → Months / Days / Hours / Minutes (no seconds).
    const nowDate = new Date(now);
    let months = 0;
    while (addMonths(nowDate, months + 1).getTime() <= target.getTime()) months++;
    let rem = Math.max(0, target.getTime() - addMonths(nowDate, months).getTime());
    const days = Math.floor(rem / MS_DAY);
    rem -= days * MS_DAY;
    const hours = Math.floor(rem / MS_HOUR);
    rem -= hours * MS_HOUR;
    const minutes = Math.floor(rem / MS_MIN);
    blocks = [
      { value: String(months), label: months === 1 ? 'Month' : 'Months' },
      { value: String(days), label: days === 1 ? 'Day' : 'Days' },
      { value: pad2(hours), label: 'Hours' },
      { value: pad2(minutes), label: 'Minutes' },
    ];
  } else {
    // < 1 month out → Days / Hours / Minutes / Seconds.
    const totalSec = Math.floor(diffMs / 1000);
    const days = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;
    blocks = [
      { value: String(days), label: days === 1 ? 'Day' : 'Days' },
      { value: pad2(hours), label: 'Hours' },
      { value: pad2(minutes), label: 'Minutes' },
      { value: pad2(seconds), label: 'Seconds' },
    ];
  }

  return (
    <View style={styles.countdownRow}>
      {blocks.map(b => (
        <View key={b.label} style={styles.countdownBox}>
          <Text style={styles.countdownValue}>{b.value}</Text>
          <Text style={styles.countdownLabel} numberOfLines={1}>
            {b.label}
          </Text>
        </View>
      ))}
    </View>
  );
};

/** Cover height below the status bar. */
const HERO_H = 340;
const MAX_COVER_PHOTOS = 10;

/** The cover. One photo is just the photo; two or more swipe sideways with
 *  dots and an "n / N" count (Figma 17488:27976). */
const HeroCover: React.FC<{ uris: string[]; height: number }> = ({ uris, height }) => {
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);
  const many = uris.length > 1;
  const photo = (uri: string, i: number, w?: number) => (
    <Thumb
      key={i}
      uri={uri}
      widthPx={1280}
      style={{ width: w ?? '100%', height }}
      contentFit="cover"
      cachePolicy="memory-disk"
      transition={150}
    />
  );
  return (
    <View
      style={[styles.hero, { height }, uris.length === 0 && styles.heroPlaceholder]}
      onLayout={e => setWidth(e.nativeEvent.layout.width)}
    >
      {uris.length === 0 ? (
        <Ionicons name="image-outline" size={40} color="#B0B0B0" />
      ) : many && width > 0 ? (
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={e => {
            const next = Math.round(e.nativeEvent.contentOffset.x / width);
            setIndex(prev => (prev !== next ? next : prev));
          }}
        >
          {uris.map((u, i) => photo(u, i, width))}
        </ScrollView>
      ) : (
        photo(uris[0], 0)
      )}
      {uris.length > 0 ? (
        <LinearGradient
          pointerEvents="none"
          colors={['rgba(0,0,0,0)', 'rgba(0,0,0,1)']}
          locations={[0.14, 0.75]}
          style={styles.heroShade}
        />
      ) : null}
      {many ? (
        <>
          <View style={styles.heroDots} pointerEvents="none">
            {uris.map((_, i) => (
              <View key={i} style={[styles.heroDot, i === index && styles.heroDotActive]} />
            ))}
          </View>
          <View style={styles.heroCount} pointerEvents="none">
            <Text style={styles.heroCountText}>{`${index + 1} / ${uris.length}`}</Text>
          </View>
        </>
      ) : null}
    </View>
  );
};

// ---------------------------------------------------------------------------
export const TripDetailViewRedesigned: React.FC<TripDetailViewProps> = ({
  vm,
  participants = [],
  crew = [],
  onViewAllCrew,
  membersSlot,
  onEditTrip,
  heroCollapsed = false,
  heroCardCountdown = false,
  heroCollapsedHeight = 0,
  heroTopInset = 0,
  heroControls,
  animateHeroCollapse = false,
  onParticipantPress,
  onSeeAllParticipants,
  onLeaderPress,
  afterHeroSlot,
  bodyHidden,
  hideParticipants = false,
  onShare,
  isHost = false,
  aboutHost = null,
  onEditCover,
  onEditAboutHost,
  onAboutHostPress,
  onEditDescription,
  onEditDates,
  onEditAccommodation,
  priceDetailsRef,
}) => {
  const viewer = useViewer();
  // What this trip was priced in. A viewer on the same currency sees the
  // operator's real number; everyone else sees an estimate at today's rate.
  const pricing = { budget_currency: vm.budgetCurrency, budget_fx_rate: vm.budgetFxRate };
  const [showIncludes, setShowIncludes] = useState(false);
  const [showBudgetInfo, setShowBudgetInfo] = useState(false);
  const [aboutExpanded, setAboutExpanded] = useState(false);
  const [aboutHostExpanded, setAboutHostExpanded] = useState(false);

  // ── Hero collapse (Chat) ──────────────────────────────────────────────────
  // The chat has no cover, so on the way in the cover + card slide up under
  // the black header and the tabs sit right below it. Dashboard and Plan used
  // to do the same (14 Sep); since 6 Oct they keep the cover (Figma
  // 17488:28466) and only swap the card to a countdown.
  // `heroH` is the hero's natural height, measured on an inner view that is
  // never clipped, so it stays right while the outer one shrinks.
  const reduceMotion = useReducedMotion();
  const heroH = useSharedValue(0);
  const heroCollapse = useSharedValue(heroCollapsed ? 1 : 0);
  // Layout effect, not a passive one: on the no-animation path this has to land
  // in the same UI frame as the commit that switched tabs, or the hero shows
  // for a frame before snapping shut.
  useLayoutEffect(() => {
    const to = heroCollapsed ? 1 : 0;
    // Only a tap animates. The screen choosing a tab for you on open (or from a
    // notification) should just land there, not play a hero leaving.
    heroCollapse.value =
      animateHeroCollapse && !reduceMotion
        ? withTiming(to, { duration: HERO_SLIDE_MS, easing: Easing.bezier(0.77, 0, 0.175, 1) })
        : to;
  }, [heroCollapsed, animateHeroCollapse, reduceMotion, heroCollapse]);
  const heroClipStyle = useAnimatedStyle(() => {
    const c = heroCollapse.value;
    if (heroH.value === 0) {
      return c === 1 ? { height: heroCollapsedHeight, overflow: 'hidden' as const } : {};
    }
    return {
      height: heroH.value * (1 - c) + heroCollapsedHeight * c,
      // Visible at rest so the countdown card's shadow is not cut off.
      overflow: c > 0 ? ('hidden' as const) : ('visible' as const),
    };
  });
  // Moves with the clip edge, so the hero reads as sliding up, not as being
  // cropped from the bottom.
  const heroSlideStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -heroH.value * heroCollapse.value }],
    opacity: 1 - heroCollapse.value * 0.6,
  }));

  // Under the round buttons when the cover carries them (44 tall, 8 above).
  const editPillTop = heroControls ? { top: heroTopInset + 8 + 44 + 8, right: 16 } : null;

  const dateRange = formatDateRange(vm);
  const skillLabel = formatSkillLevel(vm.skillLevels); // compact "Beginner+" for the chip
  const skillRange = formatSkillRange(vm.skillLevels); // "Beginner – Intermediate" for the cell
  const ageLabel = formatAge(vm.ageMin, vm.ageMax);
  const participantsLabel = vm.maxParticipants
    ? `${vm.participantCount}/${vm.maxParticipants} going`
    : `${vm.participantCount} going`;

  const vibeLabel = vm.vibeSlug
    ? // Show only the short title (e.g. "Surf-focused"), dropping the
      // " - wake up early, surf a lot" description.
      TRIP_VIBE_OPTIONS.find(v => v.slug === vm.vibeSlug)?.label.split(' - ')[0] ?? null
    : null;

  // Fixed left-to-right display order for the pills + boards illustration:
  // short → mid → long → soft (independent of how the data is stored).
  const BOARD_DISPLAY_ORDER = ['shortboard', 'midlength', 'longboard', 'softtop'];
  const orderRank = (s: string) => {
    const i = BOARD_DISPLAY_ORDER.indexOf(s);
    return i === -1 ? BOARD_DISPLAY_ORDER.length : i;
  };
  const surfStyles = vm.surfStyles
    .filter(s => s !== 'all')
    .sort((a, b) => orderRank(a) - orderRank(b));

  const waveSizeLabel =
    vm.waveSizeMin != null && vm.waveSizeMax != null
      ? vm.waveSizeMin === vm.waveSizeMax
        ? `${vm.waveSizeMax} Feet`
        : `${vm.waveSizeMin}–${vm.waveSizeMax} Feet`
      : null;

  const showAccommodation =
    !!vm.accommodationName || !!vm.accommodationKindLabel || vm.specificStaySelected != null;
  // Tapping the stay card opens the host's booking/listing link, if one was set.
  const stayUrl = vm.accommodationUrl?.trim() || null;

  const priceLabel = formatTripPrice(vm.costPerPerson ?? null, pricing, viewer);
  const includeSections = priceInclusionSections(vm.priceInclusions);
  const addOns = priceInclusionAddOns(vm.priceInclusions);
  const hasPriceDetail = includeSections.length > 0 || addOns.length > 0;

  const budgetLabel = formatTripPriceRange(vm.budgetMin ?? null, vm.budgetMax ?? null, pricing, viewer);
  const budgetVibe = vm.budgetTier ? BUDGET_VIBE[vm.budgetTier] : null;
  // "Trip Operator" trips (hosting_style 'C') are fully-planned: their price
  // opens the "What's included" sheet — even when only a budget range was
  // captured instead of a fixed cost.
  const isOperator = vm.hostingStyle === 'C';
  // "Planned Together" trips (hosting_style 'A') are group-led — there is no
  // single organizer to spotlight, so the leader's "About" self-intro is hidden.
  const isPlannedTogether = vm.hostingStyle === 'A';

  // Static "Based on" chips for the budget-info sheet — from data we already
  // have, no extra AI call.
  const budgetBasedOn: string[] = (
    [
      vm.destinationLabel,
      vm.durationDays ? `${vm.durationDays} day${vm.durationDays === 1 ? '' : 's'}` : null,
      vm.accommodationKindLabel,
    ].filter(Boolean) as string[]
  );
  // What the estimate covers — mirrors the AI prompt (accommodation + food +
  // local transport + surf activities; international flights excluded).
  const accLower = vm.accommodationKindLabel?.toLowerCase();
  const stayLine = vm.durationDays
    ? `${vm.durationDays} ${vm.durationDays === 1 ? 'day' : 'days'} at a ${accLower ?? 'place to stay'}`
    : accLower
      ? `Your stay at a ${accLower}`
      : 'Accommodation for your whole stay';
  const budgetCovers: { icon: keyof typeof Ionicons.glyphMap; text: string }[] = [
    { icon: 'bed-outline', text: stayLine },
    { icon: 'restaurant-outline', text: 'Three meals a day' },
    { icon: 'airplane-outline', text: 'Airport transfers both ways' },
    { icon: 'car-outline', text: 'Getting around the spot and nearby' },
    { icon: 'water-outline', text: 'Everyday surf activities' },
  ];

  // "Who it's for" only renders when it has real data.
  const showWhoFor = vm.ageMin != null || vm.ageMax != null || vm.skillLevels.length > 0;

  // The price lives in the trip screen's bottom bar now. Tapping it opens the
  // same sheet the Price card used to: "What's included" on an itemised
  // operator price, "About this estimate" on an AI budget range.
  const priceDetailsAction: (() => void) | null =
    hasPriceDetail && (vm.costPerPerson != null || isOperator)
      ? () => setShowIncludes(true)
      : !isOperator && budgetLabel
        ? () => setShowBudgetInfo(true)
        : null;
  useEffect(() => {
    if (!priceDetailsRef) return;
    priceDetailsRef.current = priceDetailsAction;
    return () => {
      priceDetailsRef.current = null;
    };
  });

  // ── Top card (Figma 17157:26147) ──
  // The host on the left — not on "planned together" trips, which have none.
  const heroHost = !isPlannedTogether && aboutHost?.name ? aboutHost : null;
  // The host's own crew card, if they put themselves on the crew: its title
  // ("Local Guide") is how the Figma names them ("Oscar - Local Guide").
  const hostCrewTitle =
    crew.find(c => c.roleKey === 'operator' && c.title?.trim())?.title?.trim() ?? null;
  const heroStats: { icon: TripIconName; label: string; value: string }[] = [];
  if (vm.skillLevels.length > 0)
    heroStats.push({ icon: 'bar-chart-10', label: 'Level', value: skillLabel });
  if (vm.waveShapeLabel)
    heroStats.push({ icon: 'waves', label: 'Wave type', value: vm.waveShapeLabel });
  if (waveSizeLabel) heroStats.push({ icon: 'ruler', label: 'Wave Range', value: waveSizeLabel });

  // ── The three cards under it (Figma 17157:26177) ──
  // "Local Crew" counts the crew the operator marked local (staff `is_local`).
  const localCrew = crew.filter(c => c.isLocal).length;
  // Icons are Figma's own (17488:28030 / 28038 / 28044): the pin and the
  // sunset are the same glyphs TripIcon already carries.
  const infoCards: { icon: TripIconName; label: string; value: string; tint: string }[] = [
    { icon: 'users-02', label: 'Participants', value: participantsLabel, tint: C.accent },
  ];
  if (crew.length > 0)
    infoCards.push({
      icon: 'marker-pin-05',
      label: 'Local Crew',
      value: `${localCrew}/${crew.length}`,
      tint: '#F37A3C',
    });
  if (vibeLabel) infoCards.push({ icon: 'sun-setting-03', label: 'Trip Vibe', value: vibeLabel, tint: C.verified });

  // Host (admin) "Set" affordances for loosely-planned trips. Trip Operator (C)
  // always ships with exact dates + a specific stay, so it's excluded — A/B can
  // start with only a month range and/or no specific stay, and the host fills
  // those in from here (mirrors the "if no exact value yet, show an Edit button"
  // pattern of cover/about/description).
  const isLooseFlow = vm.hostingStyle === 'A' || vm.hostingStyle === 'B';
  const hasExactDates = !!vm.startDateISO;
  const hasSpecificStay = !!(vm.specificStaySelected && vm.accommodationName);
  const canEditDates = isHost && isLooseFlow && !hasExactDates && !!onEditDates;
  const canEditStay = isHost && isLooseFlow && !hasSpecificStay && !!onEditAccommodation;

  // Host profile detail badges shown in "About <host>", mirroring the
  // create-trip "About you" stats. ONE wrapping flow in Figma's order — trips,
  // board, level, origin, age — not a fixed two-row split: the chips are
  // different widths per host, so any hardcoded split leaves a ragged line.
  // Only the trips chip carries the island emoji (Figma 17022-31883; the others
  // have that layer hidden).
  const hostBadges: { label: string; emoji?: string }[] = aboutHost
    ? ([
        aboutHost.surfTrips != null
          ? { label: `${aboutHost.surfTrips} Surf Trips`, emoji: '🏝️' }
          : null,
        aboutHost.boardLabel ? { label: aboutHost.boardLabel } : null,
        aboutHost.surfLevelLabel ? { label: aboutHost.surfLevelLabel } : null,
        aboutHost.countryFrom ? { label: aboutHost.countryFrom } : null,
        aboutHost.age != null ? { label: `${aboutHost.age} yrs` } : null,
      ].filter(Boolean) as { label: string; emoji?: string }[])
    : [];
  const hasHostBadges = hostBadges.length > 0;

  // "Local knowledge" lines for the About block — the host's familiarity with the
  // destination and the stay (Captain + Operator). Names come from the trip VM.
  // Figma 17022-31903/31912 pin the icons to the Untitled-UI set, in a boxed
  // cell, so they are TripIcons rather than Ionicons.
  const hostFamiliarity: { icon: TripIconName; place: string; label: string }[] = [];
  if (aboutHost?.destinationFamiliarityLabel && vm.destinationLabel) {
    hostFamiliarity.push({
      icon: 'marker-pin-05',
      place: vm.destinationLabel,
      label: aboutHost.destinationFamiliarityLabel,
    });
  }
  if (aboutHost?.stayFamiliarityLabel && vm.accommodationName) {
    hostFamiliarity.push({
      icon: 'home-03',
      place: vm.accommodationName,
      label: aboutHost.stayFamiliarityLabel,
    });
  }

  // Surf style — one block, placed under Accommodation for every trip type.
  const surfStyleSection = surfStyles.length > 0 ? (
    <View style={[styles.section, styles.sectionLineAbove]}>
      <SectionTitle title="Surf style" />
      <View style={styles.surfCard}>
        <View style={styles.surfPills}>
          {surfStyles.map(s => (
            <View key={s} style={styles.surfPill}>
              <Text style={styles.surfPillText}>
                {BOARD_SHORT[s] ?? s}
              </Text>
            </View>
          ))}
        </View>
        <View style={styles.boardsRow}>
          {surfStyles.map(s => {
            const board = BOARD_IMAGE_EVEN[s];
            if (!board) return null;
            // Boards share one height (BOARD_H); width follows each
            // board's aspect ratio so the row reads as a uniform even set.
            // Exception: the shortboard PNG renders bulky, so squish it
            // to 90% width. 'stretch' (not 'contain') keeps the full
            // height — contain would scale the whole board down instead.
            const isShort = s === 'shortboard';
            const boardW = Math.round(BOARD_H * board.aspect * (isShort ? 0.9 : 1));
            return (
              <Image
                key={s}
                source={board.src}
                style={{ width: boardW, height: BOARD_H }}
                resizeMode={isShort ? 'stretch' : 'contain'}
              />
            );
          })}
        </View>
      </View>
    </View>
  ) : null;

  return (
    <View style={styles.root}>
      {/* White header zone — the hero, countdown card and the Overview/Plan
          toggle sit on white; everything below the toggle is the #FAFAFA body. */}
      <View style={styles.headerWhite}>
      {/* ---- Hero + overlapping card with countdown ---- */}
      <Reanimated.View style={[styles.heroClip, heroClipStyle]}>
        <Reanimated.View
          style={[styles.heroWrap, heroSlideStyle]}
          onLayout={e => {
            heroH.value = e.nativeEvent.layout.height;
          }}
        >
          <HeroCover
            uris={
              vm.galleryImageUris && vm.galleryImageUris.length > 0
                ? vm.galleryImageUris.slice(0, MAX_COVER_PHOTOS)
                : vm.heroImageUri
                  ? [vm.heroImageUri]
                  : []
            }
            height={HERO_H + heroTopInset}
          />
          {heroControls ? (
            <View style={[styles.heroControls, { top: heroTopInset + 8 }]}>{heroControls}</View>
          ) : onShare ? (
            <TouchableOpacity
              style={styles.shareFab}
              onPress={onShare}
              activeOpacity={0.8}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Share trip"
            >
              <Ionicons name="share-social-outline" size={22} color={C.ink} />
            </TouchableOpacity>
          ) : null}
          {/* Operator trips have no pill here: the whole trip is edited from
              the ⋮ menu ("Edit trip"), and the wizard owns the cover too. Peer
              hosts keep the cover sheet. */}
          {!isOperator && isHost ? (
            <View style={[styles.editCoverPill, editPillTop]}>
              <EditPill label="Edit cover" onPress={onEditCover} />
            </View>
          ) : null}
          <View style={styles.heroCard}>
            <View style={styles.heroCardTop}>
              <View style={styles.heroDateRow}>
                {/* formatDateRange already ends with " · N days". */}
                <Text style={styles.heroDate}>{dateRange}</Text>
                {canEditDates ? <EditPill label="Set dates" onPress={onEditDates} /> : null}
              </View>
              <Text style={styles.heroTitle} numberOfLines={2}>
                {vm.title || vm.destinationLabel || 'Your trip'}
              </Text>
            </View>
            {heroCardCountdown ? (
              <CountdownBoxes target={computeCountdownTarget(vm)} />
            ) : heroHost || heroStats.length > 0 ? (
              <View
                style={[
                  styles.heroCardBottom,
                  !(heroHost && heroStats.length > 0) && styles.heroCardBottomSolo,
                ]}
              >
                {heroHost ? (
                  <TouchableOpacity
                    style={styles.heroHost}
                    onPress={onAboutHostPress}
                    disabled={!onAboutHostPress}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${heroHost.name}'s profile`}
                  >
                    {heroHost.avatarUrl ? (
                      <Thumb
                        uri={heroHost.avatarUrl}
                        size={160}
                        style={styles.heroHostAvatar}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                      />
                    ) : (
                      <CachedImage
                        source={Images.defaultAvatar}
                        style={styles.heroHostAvatar}
                        contentFit="cover"
                      />
                    )}
                    <Text style={styles.heroHostName} numberOfLines={1}>
                      {`By ${heroHost.name?.split(' ')[0] ?? ''}`}
                    </Text>
                  </TouchableOpacity>
                ) : null}
                {heroStats.length > 0 ? (
                  <View style={styles.heroStats}>
                    {heroStats.map(st => (
                      <View key={st.label} style={styles.heroStat}>
                        <View style={styles.heroStatIcon}>
                          <TripIcon name={st.icon} size={20} color={ICON_INK} strokeWidth={1.1} />
                        </View>
                        <View style={styles.heroStatText}>
                          <Text style={styles.heroStatLabel}>{st.label}</Text>
                          <Text style={styles.heroStatValue} numberOfLines={1}>
                            {st.value}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        </Reanimated.View>
      </Reanimated.View>

      {/* Shared chrome slot (Overview/Plan toggle) — sits between hero and body. */}
      {afterHeroSlot ?? null}
      </View>

      {!bodyHidden && (
        <>
          {/* ---- Three info cards (Figma 17157:26177) ---- */}
          <View style={styles.infoRow}>
            {infoCards.map(card => (
              <View key={card.label} style={styles.infoCard}>
                <View style={styles.chipIconBox}>
                  <TripIcon name={card.icon} size={18} color={ICON_INK} strokeWidth={1.1} />
                </View>
                <View>
                  <Text style={[styles.chipLabel, { color: card.tint }]} numberOfLines={1}>
                    {card.label}
                  </Text>
                  <Text style={styles.chipValue} numberOfLines={2}>
                    {card.value}
                  </Text>
                </View>
              </View>
            ))}
          </View>

          {/* ---- About this trip ---- */}
          {vm.description || isHost ? (
            <View style={[styles.section, styles.sectionLineBelow]}>
              <SectionTitle
                title="About this trip"
                right={
                  isHost ? <EditPill label="Edit" onPress={onEditDescription} /> : undefined
                }
              />
              {vm.description ? (
                <>
                  <Text style={styles.body} numberOfLines={aboutExpanded ? undefined : 4}>
                    {vm.description}
                  </Text>
                  {vm.description.length > 140 ? (
                    <TouchableOpacity
                      onPress={() => setAboutExpanded(v => !v)}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                    >
                      <Text style={styles.seeMore}>{aboutExpanded ? 'See less' : 'See More'}</Text>
                    </TouchableOpacity>
                  ) : null}
                </>
              ) : (
                <Text style={styles.bodyPlaceholder}>
                  Add a description so surfers know what this trip is about.
                </Text>
              )}
            </View>
          ) : null}

          {/* ---- About <host> (organizer self-intro) — host_lead_note. Shown
                  when the host wrote one, or always to the host so they can add
                  one via "Edit Profile". ---- */}
          {/* Operator trips DO get this card again (Ohad, 27 Sep 2026, Figma
              17022-31876) — reversing Product Specs §3 ("no more 'about the
              operator' section") and the "settled" note in
              docs/operator-spec-gaps-plan.html. The reason the spec's removal
              did not hold: the operator is NOT in the Crew list below unless
              they add themselves (nothing creates a staff row for the owner),
              so an operator trip showed no face at all on the overview while
              the create flow kept collecting `host_lead_note` with nowhere to
              put it. The card shows the OWNER's surfer profile, the same as a
              Captain's — that is what the Figma draws.

              Still not on "planned together" trips (style A): there is no host
              selling the trip, everyone plans it. */}
          {!isPlannedTogether &&
          aboutHost &&
          (aboutHost.bio || isHost || hasHostBadges || hostFamiliarity.length > 0) ? (
            <View style={[styles.section, styles.sectionLineBelow]}>
              <View style={styles.aboutHostHeader}>
                <TouchableOpacity
                  style={styles.aboutHostIdentity}
                  onPress={onAboutHostPress}
                  disabled={!onAboutHostPress}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={aboutHost.name ? `Open ${aboutHost.name}'s profile` : undefined}
                >
                  {aboutHost.avatarUrl ? (
                    <Thumb
                      uri={aboutHost.avatarUrl}
                      size={144}
                      style={styles.aboutHostAvatar}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                    />
                  ) : (
                    <CachedImage
                      source={Images.defaultAvatar}
                      style={styles.aboutHostAvatar}
                      contentFit="cover"
                    />
                  )}
                  <Text style={styles.aboutHostName} numberOfLines={1}>
                    {aboutHost.name
                      ? hostCrewTitle
                        ? `${aboutHost.name} - ${hostCrewTitle}`
                        : aboutHost.name
                      : isOperator
                        ? 'About the operator'
                        : 'About the Captain'}
                  </Text>
                </TouchableOpacity>
              </View>
              {hasHostBadges ? (
                <View style={styles.hostBadgeRow}>
                  {hostBadges.map((b, i) => (
                    <View key={`${b.label}-${i}`} style={styles.hostBadge}>
                      {b.emoji ? <Text style={styles.hostBadgeEmoji}>{b.emoji}</Text> : null}
                      <Text style={styles.hostBadgeText} numberOfLines={1}>
                        {b.label}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
              {/* Bio sits ABOVE the local-knowledge rows (Figma 17022-31901
                  before 17022-31903). */}
              {aboutHost.bio ? (
                <Text style={styles.hostBio} numberOfLines={aboutHostExpanded ? undefined : 4}>
                  {aboutHost.bio}
                </Text>
              ) : (
                // The empty hint IS the host's way in to the bio sheet — there
                // is no Edit Profile pill any more (Figma 17488:28054).
                <Text
                  style={styles.bodyPlaceholder}
                  onPress={isHost ? onEditAboutHost : undefined}
                  accessibilityRole={isHost && onEditAboutHost ? 'button' : undefined}
                >
                  {isOperator
                    ? 'Tell surfers who you are and why you run great trips.'
                    : 'Tell surfers who you are and why you’re the Captain for this trip.'}
                </Text>
              )}
              {hostFamiliarity.length > 0 ? (
                <View style={styles.hostFamiliarity}>
                  {hostFamiliarity.map((f, i) => (
                    <View key={`fam-${i}`} style={styles.hostFamRow}>
                      <View style={styles.hostFamIconCell}>
                        {/* Both icons are traced at a ~16 viewBox while Figma
                            draws them in an 18 one, and strokeWidth is in
                            VIEWBOX units — so plain 1 would render 1.125px.
                            16/18 gives back Figma's 1px hairline. */}
                        <TripIcon
                          name={f.icon}
                          size={18}
                          color={C.inkBody}
                          strokeWidth={16 / 18}
                        />
                      </View>
                      <Text style={styles.hostFamText} numberOfLines={1}>
                        <Text style={styles.hostFamPlace}>{f.place}</Text>
                        {`  ${f.label}`}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
              {/* Last in the card, under the local-knowledge rows (Figma
                  17022-31921) — it still toggles the BIO above. */}
              {aboutHost.bio && aboutHost.bio.length > 140 ? (
                <TouchableOpacity
                  onPress={() => setAboutHostExpanded(v => !v)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                >
                  <Text style={styles.hostSeeMore}>
                    {aboutHostExpanded ? 'See less' : 'See More'}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}

          {/* ---- Crew ---- */}
          {/* Operator trips only, and only the people the operator chose to show
              (capability `profile.shown_to_travelers`, filtered server-side).
              Shown to EVERYONE, unlike Participants below: whether you are still
              deciding or already booked, "who runs this trip" belongs on the
              page that describes the trip. Travelers used to meet them as a list
              on Plan instead — one section, two designs; the cards won (Ohad,
              18 Sep). Peer trips pass an empty array and CrewCards renders null.
              Figma 14980-66208, operator ringed in the accent colour. */}
          <CrewCards
            crew={crew}
            title="Crew"
            variant="overview"
            onViewAll={onViewAllCrew}
            style={[styles.section, styles.sectionLineBelow]}
          />

          {/* ---- Accommodation ---- */}
          {/* Right under "About this trip", above Surf style: where someone
              stays is a bigger deal on an operator trip than board choice, so
              it reads early instead of dangling at the very bottom. */}
          {showAccommodation || canEditStay ? (
            <View style={[styles.section, styles.sectionStay]}>
              {/* The empty-state card below is itself the "add" affordance for
                  the host, so the header keeps just the title (Figma 13518-9184). */}
              <SectionTitle title="Accommodation" />
              {vm.specificStaySelected && vm.accommodationName ? (
                <TouchableOpacity
                  style={styles.stayCard}
                  activeOpacity={stayUrl ? 0.85 : 1}
                  disabled={!stayUrl}
                  onPress={stayUrl ? () => openStayUrl(stayUrl) : undefined}
                  accessibilityRole={stayUrl ? 'link' : undefined}
                  accessibilityLabel={stayUrl ? `Open ${vm.accommodationName}` : undefined}
                >
                  {vm.accommodationImageUri ? (
                    <CachedImage
                      source={{ uri: vm.accommodationImageUri }}
                      style={styles.stayImage}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                    />
                  ) : (
                    <View style={[styles.stayImage, styles.stayImagePlaceholder]}>
                      <Ionicons name="image-outline" size={32} color="#B0B0B0" />
                    </View>
                  )}
                  <View style={styles.stayPill}>
                    {/* The stay's own logo when there is one (Figma
                        17488:28129), the house icon otherwise. */}
                    {vm.accommodationLogoUri ? (
                      <Thumb
                        uri={vm.accommodationLogoUri}
                        size={114}
                        style={styles.stayLogo}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                      />
                    ) : (
                      <View style={styles.stayPillIcon}>
                        <TripIcon name="home-03" size={18} color={ICON_INK} />
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.stayName} numberOfLines={1}>
                        {vm.accommodationName}
                      </Text>
                      {vm.accommodationVerified ? (
                        <Text style={[styles.stayMeta, styles.stayVerified]} numberOfLines={1}>
                          Verified Swellyo Stay
                        </Text>
                      ) : (
                        <Text style={styles.stayMeta} numberOfLines={1}>
                          {vm.accommodationKindLabel
                            ? `${vm.accommodationKindLabel} · Leading option`
                            : 'Leading option'}
                        </Text>
                      )}
                    </View>
                  </View>
                  <StayCertRows
                    ciSurfConservation={vm.ciSurfConservation}
                    stokeCertified={vm.stokeCertified}
                  />
                </TouchableOpacity>
              ) : (
                // Empty state (no specific stay yet). Host (loose flow) → a big
                // tap-to-add card; members/viewers → the same card reading
                // "Not set yet" (Figma 13518-9184).
                <View style={styles.stayCard}>
                  <TouchableOpacity
                    style={[styles.stayImage, styles.stayEmpty]}
                    activeOpacity={canEditStay ? 0.85 : 1}
                    disabled={!canEditStay}
                    onPress={canEditStay ? onEditAccommodation : undefined}
                    accessibilityRole={canEditStay ? 'button' : undefined}
                    accessibilityLabel={canEditStay ? 'Add accommodation' : undefined}
                  >
                    <TripIcon name="home-03" size={30} color="#7B7B7B" />
                    <Text style={styles.stayEmptyText}>
                      {canEditStay ? 'Tap to add Accommodation' : 'Not set yet'}
                    </Text>
                  </TouchableOpacity>
                  {vm.accommodationKindLabel ? (
                    <View style={styles.stayPill}>
                      <View style={styles.stayPillIcon}>
                        <TripIcon name="home-03" size={18} color={ICON_INK} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.stayName} numberOfLines={1}>
                          {vm.accommodationKindLabel}
                        </Text>
                        <Text style={styles.stayMeta} numberOfLines={1}>
                          Leading option
                        </Text>
                      </View>
                    </View>
                  ) : null}
                </View>
              )}
            </View>
          ) : null}

          {/* ---- Member (operator trips) — the screen's Member section, then
              Surf style after it: that is the Figma order (14980-66208). ---- */}
          {!hideParticipants && membersSlot ? (
            <View style={styles.section}>{membersSlot}</View>
          ) : null}

          {/* ---- Participants — tappable avatars, scroll right for more ----
              Hidden for members who have the Plan tab: they see the richer
              Members section there (Figma 13455-38686). */}
          {!hideParticipants && !membersSlot && (
          <View style={styles.section}>
            <View style={styles.sectionTitleRow}>
              <View style={styles.participantsTitle}>
                <Text style={styles.sectionTitle}>Members</Text>
              </View>
              {onSeeAllParticipants && participants.length > 0 ? (
                <TouchableOpacity onPress={onSeeAllParticipants} hitSlop={8}>
                  <Text style={styles.seeAllLink}>
                    {vm.maxParticipants
                      ? `View all (${vm.participantCount}/${vm.maxParticipants})`
                      : `View all (${vm.participantCount})`}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
            {participants.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.avatarScroll}
                contentContainerStyle={styles.avatarScrollContent}
              >
                {participants.map(p => (
                  <TouchableOpacity
                    key={p.id}
                    activeOpacity={0.8}
                    onPress={onParticipantPress ? () => onParticipantPress(p.id) : undefined}
                    disabled={!onParticipantPress}
                    accessibilityRole="button"
                    accessibilityLabel={p.name ? `Open ${p.name}'s profile` : 'Open profile'}
                    style={styles.avatarCol}
                  >
                    {p.avatarUrl ? (
                      <CachedImage
                        source={{ uri: getStorageThumbUrl(p.avatarUrl, 144) ?? p.avatarUrl }}
                        style={styles.avatar}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                      />
                    ) : (
                      <CachedImage
                        source={Images.defaultAvatar}
                        style={styles.avatar}
                        contentFit="cover"
                      />
                    )}
                    {/* First name under the avatar (Figma 17020-29522). */}
                    {p.name ? (
                      <Text style={styles.avatarName} numberOfLines={1}>
                        {p.name.split(' ')[0]}
                      </Text>
                    ) : null}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            ) : (
              <Text style={styles.mutedSmall}>No one yet</Text>
            )}
          </View>
          )}

          {/* ---- What's included ---- */}
          {/* Flow C only, and only when the operator actually itemised the
              price. The same rows the Price chip's sheet shows — but nobody
              who does not tap the chip ever finds that sheet, and "what am I
              paying for" is the page's whole sales question. Five rows here,
              the sheet for the rest. */}
          {isOperator && hasPriceDetail ? (
            <View style={[styles.section, styles.sectionLineAbove]}>
              <SectionTitle title="What's included" />
              <View style={styles.sheetList}>
                {includeSections.slice(0, 5).map((sec, i) => (
                  <View
                    key={sec.title}
                    style={[styles.sheetRow, i > 0 && styles.sheetRowDivider]}
                  >
                    <View style={styles.sheetRowIcon}>
                      <Ionicons
                        name={INCLUDE_ICON[sec.title] ?? 'checkmark'}
                        size={18}
                        color={C.inkBody}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.sheetRowTitle}>{sec.title}</Text>
                      <Text style={styles.sheetRowItem} numberOfLines={2}>
                        {sec.items.join(', ')}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
              {(includeSections.length > 5 || addOns.length > 0) && (
                <TouchableOpacity
                  onPress={() => setShowIncludes(true)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                >
                  <Text style={styles.seeMore}>See everything included</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : null}

          {/* Surf style sits under Accommodation, above How this trip works,
              on every trip type (Figma 17020-29433 — the operator overview).
              It used to drop below Member on operator trips (14980-66208);
              the newer frame moves it back up. */}
          {surfStyleSection}


          {/* ---- Who it's for ---- */}
          {showWhoFor ? (
            <View style={[styles.section, styles.sectionLineAbove, styles.sectionPadBottom]}>
              <SectionTitle title="Who it's for" />
              <View style={styles.cellRow}>
                <IconCell icon="calendar-date" label="Age range" value={ageLabel} />
                <IconCell icon="bar-chart-10" label="Surf level" value={skillRange} />
              </View>
            </View>
          ) : null}


        </>
      )}

      {/* ---- "What's included" sheet (Flow C — opened from the Price chip) ---- */}
      <WizardBottomSheet
        visible={showIncludes}
        title="What's included"
        titleAlign="left"
        hideHeaderDivider
        largeTitle
        onClose={() => setShowIncludes(false)}
        heightMode="full"
      >
        {priceLabel ? (
          <View style={styles.priceHero}>
            <View style={styles.priceHeroLeft}>
              <Text style={styles.priceHeroValue} numberOfLines={1} adjustsFontSizeToFit>
                {priceLabel}
              </Text>
              <Text style={styles.priceHeroPer}>per person</Text>
            </View>
            <View style={styles.priceHeroTag}>
              <Ionicons name="shield-checkmark" size={13} color="#FFFFFF" />
              <Text style={styles.priceHeroTagText}>Set by host</Text>
            </View>
          </View>
        ) : null}

        <Text style={styles.sheetIntro}>
          One fixed, all-in price. Here’s everything it covers.
        </Text>

        {includeSections.length > 0 ? (
          <View style={styles.sheetList}>
            {includeSections.map((sec, i) => (
              <View
                key={sec.title}
                style={[styles.sheetRow, i > 0 && styles.sheetRowDivider]}
              >
                <View style={styles.sheetRowIcon}>
                  <Ionicons
                    name={INCLUDE_ICON[sec.title] ?? 'checkmark'}
                    size={18}
                    color={C.inkBody}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sheetRowTitle}>{sec.title}</Text>
                  {sec.asTags ? (
                    <Text style={styles.sheetRowItem}>{sec.items.join(', ')}</Text>
                  ) : (
                    sec.items.map((it, j) => (
                      <Text key={j} style={styles.sheetRowItem}>
                        {it}
                      </Text>
                    ))
                  )}
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {addOns.length > 0 ? (
          <View style={styles.addOnsCard}>
            <Text style={styles.addOnsTitle}>Add-ons for extra price</Text>
            <Text style={styles.addOnsHint}>Available on the trip for an extra cost.</Text>
            <View style={styles.addOnTags}>
              {addOns.map(label => (
                <View key={label} style={styles.addOnTag}>
                  <Text style={styles.addOnTagText}>{label}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </WizardBottomSheet>

      {/* ---- "About this estimate" sheet (A/B — opened from the Budget chip).
              Pure description from data we already have; no AI call. ---- */}
      <WizardBottomSheet
        visible={showBudgetInfo}
        title="About this estimate"
        titleAlign="left"
        hideHeaderDivider
        largeTitle
        onClose={() => setShowBudgetInfo(false)}
        heightMode="auto"
      >
        {budgetLabel ? (
          <View style={styles.priceHero}>
            <View style={styles.priceHeroLeft}>
              <Text style={styles.priceHeroValue} numberOfLines={1} adjustsFontSizeToFit>
                {budgetLabel}
              </Text>
              <Text style={styles.priceHeroPer}>per person · estimated</Text>
            </View>
            {budgetVibe ? (
              <View style={styles.priceHeroTag}>
                <Ionicons name="pricetag" size={12} color="#FFFFFF" />
                <Text style={styles.priceHeroTagText}>{budgetVibe}</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        <Text style={styles.sheetIntro}>
          A rough AI estimate to plan around - not a price the organizer set. What
          you actually spend depends on how you travel.
        </Text>

        {budgetBasedOn.length > 0 ? (
          <>
            <Text style={styles.sheetSectionLabel}>Based on</Text>
            <View style={styles.basedOnRow}>
              {budgetBasedOn.map((t, i) => (
                <View key={`${t}-${i}`} style={styles.basedOnChip}>
                  <Text style={styles.basedOnChipText}>{t}</Text>
                </View>
              ))}
            </View>
          </>
        ) : null}

        <Text style={styles.sheetSectionLabel}>What it covers</Text>
        <View style={styles.sheetList}>
          {budgetCovers.map((c, i) => (
            <View
              key={c.text}
              style={[styles.sheetRow, i > 0 && styles.sheetRowDivider]}
            >
              <View style={styles.sheetRowIcon}>
                <Ionicons name={c.icon} size={18} color={C.inkBody} />
              </View>
              <Text style={[styles.sheetRowTitle, styles.sheetRowTitleFlex]}>{c.text}</Text>
            </View>
          ))}
        </View>

        <View style={styles.callout}>
          <Ionicons name="airplane-outline" size={16} color={C.textMuted} />
          <Text style={styles.calloutText}>
            International flights aren’t included - book those separately.
          </Text>
        </View>
      </WizardBottomSheet>
    </View>
  );
};

export default TripDetailViewRedesigned;

const styles = StyleSheet.create({
  // Owns its own horizontal padding so the hero can bleed edge-to-edge via
  // negative margins. Render inside a 0-horizontal-padding container.
  root: {
    paddingHorizontal: 16,
  },
  // White zone for the hero + countdown card + toggle. Bleeds full-width; the
  // body below it sits on the screen's #FAFAFA.
  headerWhite: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: -16,
    paddingHorizontal: 16,
  },

  // Hero + floating card. White background so the area behind the overlapping
  // countdown card (which is pulled up over the hero) stays white, not the
  // page's #FAFAFA.
  // The clip carries the full-bleed margin. On the inner view it would reach
  // 16px past the clip's edges, and the collapse would crop both sides.
  heroClip: {
    marginHorizontal: -16,
  },
  // paddingBottom, not marginBottom: a margin is not part of the measured
  // height, so the collapse would leave an 8px sliver behind.
  heroWrap: {
    paddingBottom: 8,
    backgroundColor: '#FFFFFF',
  },
  // Figma 17488:27976 — the card overlaps the cover's last 61px. Height is set
  // inline (HERO_H + the status-bar inset the cover runs under).
  hero: {
    width: '100%',
    backgroundColor: C.border,
    overflow: 'hidden',
  },
  heroPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Figma 17488:27977 — black rising from the bottom, 252 tall.
  heroShade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 252 },
  // Figma 17488:28286 — 26 above the card (which starts 61 from the bottom).
  heroDots: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 87,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  heroDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#EEEEEE' },
  heroDotActive: { width: 24, backgroundColor: '#FFFFFF' },
  // Figma 17488:28287 — "1 / 14".
  heroCount: {
    position: 'absolute',
    right: 20,
    bottom: 80,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: 'rgba(33,33,33,0.7)',
  },
  heroCountText: { ...textStyles.MB2, color: '#FFFFFF' },
  // Figma 17488:27978 — back on the left, the actions on the right.
  heroControls: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  // Figma 17488:27990 — one white card on the Card Shadow (0 0 24 #00000017):
  // the date + name on top, the host and the surf stats below.
  heroCard: {
    marginTop: -61,
    marginHorizontal: 18,
    backgroundColor: C.surface,
    borderRadius: 16,
    shadowColor: '#000000',
    shadowOpacity: 0.09,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 3,
  },
  heroCardTop: { paddingHorizontal: 20, paddingVertical: 10, alignItems: 'center' },
  // Figma 17488:27997 — the host 48 from the left edge, the stats 48 from the
  // right. `gap` is only the floor between them on a narrow phone.
  heroCardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    paddingHorizontal: 48,
    paddingTop: 8,
    paddingBottom: 16,
  },
  // Only one of the two (no host on planned-together trips): centre it.
  heroCardBottomSolo: { justifyContent: 'center' },
  heroHost: { alignItems: 'center', gap: 8, width: 74 },
  heroHostAvatar: { width: 74, height: 74, borderRadius: 37, backgroundColor: C.border },
  // "By <name>" — B-4 bold (get_variable_defs 17488:28003).
  heroHostName: { ...textStyle('B4', '700'), color: C.ink, textAlign: 'center' },
  // Figma 17488:28004 — 8 between the rows, icon centred on its two lines.
  heroStats: { gap: 8, flexShrink: 1 },
  heroStat: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  heroStatIcon: { padding: 5, borderRadius: 4, backgroundColor: C.surfaceMuted },
  // flexShrink, not flex: 1 — with no host beside it (planned-together trips)
  // the stats column has no set width, and flex: 1 collapses the text to 0.
  heroStatText: { flexShrink: 1 },
  heroStatLabel: { ...textStyles.B4, color: C.textFaint, marginBottom: -3 },
  heroStatValue: { ...textStyle('B3', '700'), color: C.ink },
  heroDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  heroDate: {
    // Body/B-3 12/18 (get_variable_defs 17488:27993).
    ...textStyles.B3,
    color: C.textMuted,
    textAlign: 'center',
  },
  heroTitle: {
    marginTop: 2,
    // Body/M B-1 16/24, bold override (get_variable_defs 17020:29668).
    ...textStyle('MB1', '700'),
    color: C.ink,
    textAlign: 'center',
  },

  // Countdown boxes
  // Figma 17488:29008: 48px boxes, 8 radius, 16 apart; 16 under the title
  // (10 of it is heroCardTop's padding), 24 to the card's edge.
  countdownRow: {
    marginTop: 6,
    marginBottom: 24,
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'center',
  },
  countdownBox: {
    width: 48,
    height: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  // Figma draws Heebo ExtraBold 18 (a literal, no size variable). Heebo is
  // not loaded in the app, so the family stays Montserrat at Figma's size.
  countdownValue: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '800',
    color: C.accent,
  },
  // Body/text-xs 10/16 (get_variable_defs 17020:29673).
  countdownLabel: {
    fontFamily: FONT_INTER,
    fontSize: 10,
    lineHeight: 16,
    fontWeight: '400',
    color: C.inkBody,
  },

  // Info chips — horizontal scroll, bleeds edge-to-edge.
  // Figma 17157:26177 — three equal cards, 8 apart.
  infoRow: {
    flexDirection: 'row',
    gap: 8,
    // Line up with the hero card's edges (18 from the screen). The root
    // already pads 16, so only 2 more here.
    marginHorizontal: 2,
    // Figma 17488:28026 — 20 under the tabs (12 gap + 8 padding), 8 below.
    marginTop: 20,
    marginBottom: 8,
  },
  infoCard: {
    flex: 1,
    // Keep the icon box its own size (38x38), not stretched across the card.
    alignItems: 'flex-start',
    gap: 8,
    padding: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
  },
  chipsScroll: {
    marginTop: 26,
    marginBottom: 12,
    marginHorizontal: -16,
  },
  // Vertical padding gives the price card's all-round shadow room; the
  // bottom margin is the carousel's own `pb-20` (Figma 17020-29593).
  chipsScrollContent: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 16,
  },
  // Info cards — Figma 17020-29614: 132 wide, 8 padding, 16 radius, 8 gap.
  chip: {
    width: 132,
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    padding: 8,
    backgroundColor: C.surface,
  },
  // Price card — no border, a soft all-round shadow instead (Figma "Card
  // Shadow" 0/0/12 9%), and 28 between the top row and the footer.
  chipHighlight: {
    borderColor: 'transparent',
    gap: 28,
    shadowColor: '#000',
    shadowOpacity: 0.09,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
    elevation: 3,
  },
  chipHighlightTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  // 38x38: 18px icon in 10px padding.
  chipIconBox: {
    padding: 10,
    borderRadius: 8,
    backgroundColor: C.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Price/budget card — filled teal icon (white glyph), per design.
  chipIconBoxHighlight: {
    backgroundColor: C.accent,
  },
  chipText: {
    width: '100%',
  },
  chipTextBeside: {
    flex: 1,
  },
  chipLabel: {
    // Body/B-4 10/17 (get_variable_defs 17020:29601).
    ...textStyles.B4,
    color: C.textFaint,
  },
  chipValue: {
    // Body/B-3 12/18, bold override (get_variable_defs 17020:29602).
    ...textStyle('B3', '700'),
    color: C.ink,
  },
  chipFooter: {
    alignSelf: 'stretch',
    textAlign: 'center',
    // Body/B-3 12/18 (get_variable_defs 17020:29607).
    ...textStyles.B3,
    color: C.accent,
  },

  // Sections — 20 above and below the content. The hairlines follow Figma
  // 17488:27988: one UNDER About, the host and Crew; none around Accommodation
  // and Member; one ABOVE Surf style and whatever comes after it.
  section: {
    paddingVertical: 20,
  },
  sectionLineBelow: {
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  sectionLineAbove: {
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  // Accommodation closes on 16, not 20 (Figma 17488:28114).
  sectionStay: {
    paddingBottom: 16,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  // Extra breathing room under the icon-cell sections (Who it's for / Wave)
  // before the next section's divider line (Figma frame `pb-20`).
  sectionPadBottom: {
    paddingBottom: 40,
  },
  sectionTitle: {
    // Body/M B-1 16/24 with a Bold override (get_variable_defs 17020:29409).
    ...textStyle('MB1', '700'),
    color: C.ink,
  },
  body: {
    // Body/B-3 12/18 (get_variable_defs 17020:29411).
    ...textStyles.B3,
    color: C.textMuted,
  },
  bodyPlaceholder: {
    fontFamily: FONT_INTER,
    fontSize: 14,
    lineHeight: 20,
    fontStyle: 'italic',
    color: C.textFaint,
  },

  // Admin (host) edit affordances — Figma "admin view".
  editPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: '#CFCFCF',
    borderRadius: 9,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  editPillText: {
    fontFamily: FONT_INTER,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '400',
    color: C.ink,
  },
  // Floating "Edit cover" pill, top-right over the hero image.
  editCoverPill: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 2,
  },
  // Floating circular share button, top-left over the hero image.
  shareFab: {
    position: 'absolute',
    top: 12,
    left: 12,
    zIndex: 2,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 3,
  },
  // "About <host>" header — avatar + name + Edit Profile pill.
  aboutHostHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    // Figma 17022-31876 stacks the card's blocks on a flat 16 gap.
    marginBottom: 16,
    paddingRight: 24,
  },
  // Avatar + name → tappable identity (opens the host's profile). Kept separate
  // from the Edit Profile pill so only the identity is the touch target.
  aboutHostIdentity: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  aboutHostAvatar: {
    width: 53,
    height: 53,
    borderRadius: 27,
    borderWidth: 1,
    borderColor: C.surface,
    backgroundColor: C.avatarBg,
  },
  aboutHostName: {
    flex: 1,
    // Body/M B-1 16/24 with a Bold override (get_variable_defs 17022:31879).
    // The design-context export prints 20 — that is the Desktop-mode
    // inflation, not the size this phone frame renders.
    ...textStyle('MB1', '700'),
    color: C.ink,
  },
  // Host profile detail badges — one wrapping flow of outlined chips
  // (Figma 17022-31880/31881).
  hostBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 4,
    marginBottom: 16,
  },
  hostBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: C.borderChip,
    backgroundColor: C.surface,
    overflow: 'hidden',
  },
  hostBadgeText: {
    // 14px (Body/M B-2) — Ohad, 2 Oct 2026. Figma's B-5 9px read too small.
    ...textStyles.MB2,
    color: C.ink,
  },
  hostBadgeEmoji: {
    // Same size as the label. NO fontFamily: Inter has no emoji glyphs, and on
    // web a font with no fallback draws 🏝️ as two empty boxes. The system
    // font picks up the emoji font on every platform.
    fontSize: 14,
    lineHeight: 18,
  },
  // Bio — Body/B-3 12/18 (get_variable_defs 17022:31902). Its own style rather
  // than the shared `body`, which is 14/20 and reserved for section prose.
  hostBio: {
    ...textStyles.B3,
    color: C.textMuted,
  },
  // "Local knowledge" rows in the About block — destination + stay familiarity.
  hostFamiliarity: {
    gap: 16,
    marginTop: 16,
  },
  hostFamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  // 38x38 cell: 18px icon in 10px padding (Figma 17022-31904).
  hostFamIconCell: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.borderIconCell,
    backgroundColor: C.surfaceMuted,
  },
  hostFamText: {
    flex: 1,
    // Body/B-3 12/18 (get_variable_defs 17022:31907, 17022:31908).
    ...textStyles.B3,
    color: C.ink,
  },
  hostFamPlace: {
    // Native bakes the weight into the family, so the bold run needs the
    // Bold family — `fontWeight` alone renders Regular on iOS.
    ...textStyle('B3', '700'),
  },
  hostSeeMore: {
    marginTop: 16,
    // Body/B-3 12/18 (get_variable_defs 17022:31921).
    ...textStyles.B3,
    color: C.accent,
  },
  seeMore: {
    marginTop: 16,
    // Body/M B-2 14/18 (get_variable_defs 17020:29412).
    ...textStyles.MB2,
    color: C.accent,
  },
  seeAll: {
    fontFamily: FONT_INTER,
    fontSize: 15,
    fontWeight: '400',
    color: C.brandTeal,
  },

  // Surf style card
  surfCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 20,
    backgroundColor: C.surface,
    // Figma 17020-29449: px 12, py 16.
    paddingHorizontal: 12,
    paddingVertical: 16,
  },
  surfPills: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    // Figma 17488:28212 — 8 both ways.
    gap: 8,
  },
  surfPill: {
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.chipBg,
    borderRadius: 15,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  surfPillText: {
    // Body/B-4 10/17 (get_variable_defs 17020:29458).
    ...textStyles.B4,
    color: C.ink,
    textAlign: 'center',
  },
  boardsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 16,
    height: BOARD_H,
  },

  // How it works
  howRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  howTitle: {
    // Body/B-4 10/17, bold override (get_variable_defs 17020:29503).
    ...textStyle('B4', '700'),
    color: '#0A0A0A',
  },
  howDesc: {
    // Body/B-4 10/17 (get_variable_defs 17020:29504).
    ...textStyles.B4,
    color: C.textHowDesc,
  },

  // Icon-box cells (Who it's for / Wave information / Accommodation fallback)
  // Figma 17020-29564: the title→cells gap is 24 (16 from the title row + 8).
  cellRow: {
    flexDirection: 'row',
    marginTop: 8,
  },
  iconCell: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  // 38x38 white square: 18px icon in 10px padding, 8 radius.
  iconCellBox: {
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCellText: {
    flex: 1,
    alignSelf: 'stretch',
    justifyContent: 'center',
  },
  iconCellLabel: {
    // Body/B-3 12/18 (get_variable_defs 17020:29569).
    ...textStyles.B3,
    color: C.textMuted,
  },
  iconCellValue: {
    // Body/B-3 12/18, bold override (get_variable_defs 17020:29570).
    ...textStyle('B3', '700'),
    color: C.ink,
  },

  // Participants
  participantsTitle: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  participantsCount: {
    fontFamily: FONT_INTER,
    fontSize: 14,
    fontWeight: '400',
    color: C.textMuted,
  },
  // "View all" → full Members screen (Figma 13459-48582).
  seeAllLink: {
    // Body/M B-2 14/18 (get_variable_defs 17020:29519).
    ...textStyles.MB2,
    color: '#05BCD3',
  },
  // Name under each avatar — Figma 13439:36846 (B-4, Text/M-03).
  avatarCol: {
    alignItems: 'center',
    gap: 2,
  },
  avatarName: {
    width: 48,
    ...textStyles.B4,
    color: C.textFaint,
    textAlign: 'center',
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Crew styles live in CrewSection.tsx with the section itself.
  // Tappable avatar row — bleeds edge-to-edge so it scrolls to the screen edge.
  avatarScroll: {
    marginHorizontal: -16,
  },
  avatarScrollContent: {
    paddingHorizontal: 16,
    gap: 8,
    alignItems: 'center',
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: C.avatarBg,
  },
  avatarGap: {
    marginLeft: 8,
  },
  avatarExtra: {
    backgroundColor: C.brandTeal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarExtraText: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  mutedSmall: {
    fontFamily: FONT_INTER,
    fontSize: 13,
    color: C.textMuted,
  },

  // Accommodation card
  // Figma 17020-29417: white, 32 radius, 10 padding, 12 gap — no border and
  // no shadow; the #FAFAFA page behind it is the contrast.
  stayCard: {
    backgroundColor: C.surface,
    borderRadius: 32,
    padding: 10,
    gap: 12,
  },
  stayImage: {
    width: '100%',
    aspectRatio: 328 / 198, // ≈ 3.3 wide : 2 tall (landscape, per Figma)
    borderRadius: 24,
    backgroundColor: C.surfaceMuted,
  },
  stayImagePlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Empty-state "Tap to add Accommodation" / "Not set yet" placeholder.
  stayEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  stayEmptyText: {
    fontFamily: FONT_INTER,
    fontSize: 15,
    lineHeight: 20,
    color: C.textHowDesc,
  },
  // Info pill — Figma 17020-29427: px 8, py 7, 8 gap, 32 radius.
  stayPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.surfaceMuted,
    borderRadius: 32,
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  // 38x38 white circle: 18px icon in 10px padding.
  stayPillIcon: {
    padding: 10,
    borderRadius: 32,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The stay's logo fills the same 38px circle (Figma 17488:28129).
  stayLogo: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.surface },
  // "Verified Swellyo Stay" — B-4 in Fill/Tertiary (17488:28132).
  stayVerified: { color: C.verified },
  stayName: {
    // Body/B-3 12/18, bold override (get_variable_defs 17020:29431).
    ...textStyle('B3', '700'),
    color: '#0A0A0A',
  },
  stayMeta: {
    // Body/B-4 10/17 (get_variable_defs 17020:29432).
    ...textStyles.B4,
    color: C.textHowDesc,
  },

  // ---- Shared "info sheet" design (price/included + budget estimate) ----
  priceHero: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: C.surface,
    borderRadius: 20,
    paddingVertical: 18,
    paddingHorizontal: 20,
    shadowColor: '#596E7C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  priceHeroLeft: {
    flex: 1,
  },
  priceHeroValue: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '800',
    color: C.inkDark,
  },
  priceHeroPer: {
    marginTop: 2,
    fontFamily: FONT_INTER,
    fontSize: 13,
    fontWeight: '500',
    color: C.textMuted,
  },
  priceHeroTag: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: C.inkDark,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  priceHeroTagText: {
    fontFamily: FONT_INTER,
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  sheetIntro: {
    marginTop: 16,
    fontFamily: FONT_INTER,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400',
    color: C.inkBody,
  },
  sheetSectionLabel: {
    marginTop: 24,
    marginBottom: 12,
    fontFamily: FONT_INTER,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    color: C.inkBody,
  },
  // One light container around the whole list — gives the "included" block
  // structure without boxing every row.
  sheetList: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: C.borderCard,
    borderRadius: 16,
    paddingHorizontal: 16,
  },
  // Add-ons — a distinct cyan-bordered card so "extra cost" reads apart from
  // what's already included.
  addOnsCard: {
    marginTop: 28,
    backgroundColor: C.surface,
    borderRadius: 20,
    paddingVertical: 18,
    paddingHorizontal: 18,
    shadowColor: '#596E7C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  addOnsTitle: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    color: C.inkDark,
  },
  addOnsHint: {
    marginTop: 4,
    fontFamily: FONT_INTER,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400',
    color: C.textMuted,
  },
  addOnTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
  },
  addOnTag: {
    backgroundColor: C.inkDark,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  addOnTagText: {
    fontFamily: FONT_INTER,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
  },
  sheetRowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
  },
  sheetRowIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.iconBubble,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetRowTitle: {
    fontFamily: FONT_INTER,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    color: C.inkBody,
  },
  sheetRowTitleFlex: {
    flex: 1,
  },
  sheetRowItem: {
    marginTop: 3,
    fontFamily: FONT_INTER,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400',
    color: C.textMuted,
  },
  basedOnRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  basedOnChip: {
    backgroundColor: '#F2F2F2',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  basedOnChipText: {
    fontFamily: FONT_INTER,
    fontSize: 13,
    fontWeight: '500',
    color: C.inkBody,
  },
  callout: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 24,
    backgroundColor: '#F6F8F9',
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  calloutText: {
    flex: 1,
    fontFamily: FONT_INTER,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400',
    color: C.textMuted,
  },

  // Meet your leader
  leaderBlock: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    padding: 14,
    gap: 12,
  },
  leaderTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  leaderAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: C.surfaceMuted,
  },
  leaderAvatarEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.avatarBg,
  },
  leaderName: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 16,
    fontWeight: '700',
    color: C.inkBody,
  },
  leaderMeta: {
    fontFamily: FONT_INTER,
    fontSize: 13,
    fontWeight: '400',
    color: C.textMuted,
  },
  leaderCreds: {
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingTop: 12,
  },
  leaderCredRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  leaderCredText: {
    flex: 1,
    fontFamily: FONT_INTER,
    fontSize: 13,
    color: C.inkBody,
  },
  leaderNote: {
    fontFamily: FONT_INTER,
    fontSize: 13,
    fontStyle: 'italic',
    color: C.textMuted,
    lineHeight: 18,
  },
});
