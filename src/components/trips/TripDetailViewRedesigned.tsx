// TripDetailViewRedesigned — the Figma "Overview" layout for the real
// TripDetailScreen (Figma node 12557-3316, "how a non-member sees the trip").
//
// This is a visual reskin of TripDetailView. It is intentionally a SEPARATE
// component so the create-trip wizard PREVIEW keeps using the original
// TripDetailView and is left untouched. Both share the same TripDetailVM and the
// pure label/format helpers (imported from TripDetailView), so the data contract
// stays in one place.
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

import React, { useEffect, useState } from 'react';
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
  Dimensions,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { TRIP_VIBE_OPTIONS } from '../../services/trips/groupTripsService';
import {
  priceInclusionSections,
  priceInclusionAddOns,
  CATEGORY_TITLE,
} from '../../services/trips/priceInclusions';
import { WizardBottomSheet } from './WizardBottomSheet';
import { TripIcon, type TripIconName } from './tripIcons';

// Trip Overview icon color (Figma "Untitled UI" ink).
const ICON_INK = '#222B30';

// "How this trip works" rows — map each structure slug to a Figma icon so the
// whole section uses the same icon set (Figma node 12557-5173).
const STRUCTURE_ICON: Record<string, TripIconName> = {
  shared_decisions: 'bar-chart-square-01',
  structured_schedule: 'calendar-date',
  loose_schedule: 'sun-setting-03',
  book_own_stay: 'passport',
  book_together: 'home-03',
  group_all_day: 'users-02',
  own_thing_day: 'map-01',
};
import {
  type TripDetailViewProps,
  BOARD_IMAGE,
  BOARD_SHORT,
  STRUCTURE_DISPLAY,
  BUDGET_VIBE,
  formatAge,
  formatBudgetRange,
  formatDateRange,
  formatSkillLevel,
  formatSkillRange,
  computeCountdownTarget,
} from './TripDetailView';
import { TRIP_TYPE_WORD, TRIP_TYPE_GRADIENT } from '../../services/trips/tripVocabulary';

const FONT_INTER = Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter';
const FONT_MONTSERRAT = Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat';

// Open the accommodation booking/listing link, tolerating URLs typed without a
// scheme (e.g. "airbnb.com/...").
function openStayUrl(raw: string) {
  const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  Linking.openURL(url).catch(() => {});
}

const SCREEN_WIDTH = Dimensions.get('window').width;
// Info chips show ~2.4 per screen. Page gutter is 16, gap is 10.
const CHIP_WIDTH = Math.round((SCREEN_WIDTH - 16) / 2.4) - 8;

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
  iconBubble: '#F4F6F7',
  surface: '#FFFFFF',
  surfaceMuted: '#F7F7F7',
  chipBg: '#EEEEEE',
  brandTealTint: '#E6F4F8',
  avatarBg: '#9CB6C0',
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
    <Ionicons name="create-outline" size={14} color={C.ink} />
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
      <TripIcon name={icon} size={22} color={ICON_INK} strokeWidth={1.1} />
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
export const TripDetailViewRedesigned: React.FC<TripDetailViewProps> = ({
  vm,
  participants = [],
  onParticipantPress,
  onLeaderPress,
  afterHeroSlot,
  bodyHidden,
  isHost = false,
  aboutHost = null,
  onEditCover,
  onEditAboutHost,
  onEditDescription,
  onEditDates,
  onEditAccommodation,
}) => {
  const [showIncludes, setShowIncludes] = useState(false);
  const [showBudgetInfo, setShowBudgetInfo] = useState(false);
  const [aboutExpanded, setAboutExpanded] = useState(false);
  const [aboutHostExpanded, setAboutHostExpanded] = useState(false);

  const dateRange = formatDateRange(vm);
  const countdownTarget = computeCountdownTarget(vm);
  const skillLabel = formatSkillLevel(vm.skillLevels); // compact "Beginner+" for the chip
  const skillRange = formatSkillRange(vm.skillLevels); // "Beginner – Intermediate" for the cell
  const ageLabel = formatAge(vm.ageMin, vm.ageMax);
  const participantsLabel = vm.maxParticipants
    ? `${vm.participantCount}/${vm.maxParticipants} going`
    : `${vm.participantCount} going`;

  const vibeLabel = vm.vibeSlug
    ? TRIP_VIBE_OPTIONS.find(v => v.slug === vm.vibeSlug)?.label ?? null
    : null;

  const surfStyles = vm.surfStyles.filter(s => s !== 'all');
  // Pill font scales with how much room the boards illustration leaves: with all
  // 4 boards it eats ~half the row, so drop to 10px to keep the pills in 2 lines.
  // 3 or fewer boards → narrower illustration → 14px still fits in 2 lines.
  // Boards sit beside the pills, so 4 long labels ("Mid - Length") only fit two
  // rows at a small size; fewer boards leave room to stay big.
  const surfPillFontSize = surfStyles.length >= 4 ? 10 : surfStyles.length === 3 ? 14 : 18;
  const structures = vm.structureSlugs.filter(s => STRUCTURE_DISPLAY[s]);

  const waveSizeLabel =
    vm.waveSizeMin != null && vm.waveSizeMax != null
      ? vm.waveSizeMin === vm.waveSizeMax
        ? `${vm.waveSizeMax} ft`
        : `${vm.waveSizeMin}–${vm.waveSizeMax} ft`
      : null;

  const showAccommodation =
    !!vm.accommodationName || !!vm.accommodationKindLabel || vm.specificStaySelected != null;
  // Tapping the stay card opens the host's booking/listing link, if one was set.
  const stayUrl = vm.accommodationUrl?.trim() || null;

  const priceLabel =
    vm.costPerPerson != null ? `$${vm.costPerPerson.toLocaleString('en-US')}` : null;
  const includeSections = priceInclusionSections(vm.priceInclusions);
  const addOns = priceInclusionAddOns(vm.priceInclusions);
  const hasPriceDetail = includeSections.length > 0 || addOns.length > 0;

  // Horizontal info chips below the countdown — fixed order, each shown only
  // when it has data.
  const budgetLabel = formatBudgetRange(vm.budgetMin ?? null, vm.budgetMax ?? null);
  const budgetVibe = vm.budgetTier ? BUDGET_VIBE[vm.budgetTier] : null;
  // Coloured trip-type tag straddling the top of the countdown card.
  const typeTagWord = vm.hostingStyle ? TRIP_TYPE_WORD[vm.hostingStyle] : null;
  const typeTagGradient = vm.hostingStyle ? TRIP_TYPE_GRADIENT[vm.hostingStyle] : null;
  const chips: {
    icon: TripIconName;
    label: string;
    value: string;
    highlight?: boolean;
    footer?: string;
    onPress?: () => void;
  }[] = [];
  // "Trip Operator" trips (hosting_style 'C') are fully-planned: they're always
  // presented as a fixed "Price" that taps into the "What's included" sheet —
  // even when only a budget range was captured instead of a fixed cost.
  const isOperator = vm.hostingStyle === 'C';
  // "Planned Together" trips (hosting_style 'A') are group-led — there is no
  // single organizer to spotlight, so the leader's "About" self-intro is hidden.
  const isPlannedTogether = vm.hostingStyle === 'A';
  if (vm.costPerPerson != null) {
    chips.push({
      icon: 'currency-dollar-circle',
      label: 'Price',
      value: `${vm.costPerPerson}$`,
      highlight: true,
      footer: hasPriceDetail ? 'What’s included' : undefined,
      onPress: hasPriceDetail ? () => setShowIncludes(true) : undefined,
    });
  } else if (budgetLabel) {
    const operatorIncludes = isOperator && hasPriceDetail;
    chips.push({
      icon: 'currency-dollar-circle',
      label: isOperator ? 'Price' : budgetVibe ?? 'Budget',
      value: budgetLabel,
      highlight: true,
      // Operator price → "what's included"; AI budget range → "see estimation".
      footer: operatorIncludes
        ? 'What’s included'
        : !isOperator
          ? 'See estimation'
          : undefined,
      onPress: operatorIncludes
        ? () => setShowIncludes(true)
        : !isOperator
          ? () => setShowBudgetInfo(true)
          : undefined,
    });
  }

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
  chips.push({ icon: 'bar-chart-10', label: 'Level', value: skillLabel });
  chips.push({ icon: 'calendar', label: 'Age range', value: ageLabel });
  chips.push({ icon: 'users-02', label: 'Participants', value: participantsLabel });
  // Trip type is now shown as the coloured tag above the countdown card, so it's
  // no longer repeated as a chip here.
  if (vibeLabel) chips.push({ icon: 'sun-setting-03', label: 'Focus vibe', value: vibeLabel });
  if (waveSizeLabel) chips.push({ icon: 'ruler', label: 'Wave size', value: waveSizeLabel });
  if (vm.waveShapeLabel)
    chips.push({ icon: 'waves', label: 'Wave shape', value: vm.waveShapeLabel });

  // "Who it's for" / "Wave information" only render when they have real data.
  const showWhoFor = vm.ageMin != null || vm.ageMax != null || vm.skillLevels.length > 0;
  const showWaveInfo = !!waveSizeLabel || !!vm.waveShapeLabel;

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

  // Trip Operator (Flow C): host profile detail badges shown in "About <host>",
  // mirroring the create-trip "About you" stats (age, origin, level, board, trips).
  // Two lines of badges (mirrors the create-flow "About you" card): top =
  // trips + board, bottom = level, age, origin.
  const hostBadgesTop: string[] = aboutHost
    ? ([
        aboutHost.surfTrips != null ? `${aboutHost.surfTrips} Surf Trips` : null,
        aboutHost.boardLabel,
      ].filter(Boolean) as string[])
    : [];
  const hostBadgesBottom: string[] = aboutHost
    ? ([
        aboutHost.surfLevelLabel,
        aboutHost.age != null ? `${aboutHost.age} yrs` : null,
        aboutHost.countryFrom,
      ].filter(Boolean) as string[])
    : [];
  const hasHostBadges = hostBadgesTop.length > 0 || hostBadgesBottom.length > 0;

  // "Local knowledge" lines for the About block — the host's familiarity with the
  // destination and the stay (Captain + Operator). Names come from the trip VM.
  const hostFamiliarity: { icon: keyof typeof Ionicons.glyphMap; place: string; label: string }[] = [];
  if (aboutHost?.destinationFamiliarityLabel && vm.destinationLabel) {
    hostFamiliarity.push({
      icon: 'navigate-outline',
      place: vm.destinationLabel,
      label: aboutHost.destinationFamiliarityLabel,
    });
  }
  if (aboutHost?.stayFamiliarityLabel && vm.accommodationName) {
    hostFamiliarity.push({
      icon: 'home-outline',
      place: vm.accommodationName,
      label: aboutHost.stayFamiliarityLabel,
    });
  }

  return (
    <View style={styles.root}>
      {/* White header zone — the hero, countdown card and the Overview/Plan
          toggle sit on white; everything below the toggle is the #FAFAFA body. */}
      <View style={styles.headerWhite}>
      {/* ---- Hero + overlapping card with countdown ---- */}
      <View style={styles.heroWrap}>
        {vm.heroImageUri ? (
          <CachedImage
            source={{ uri: vm.heroImageUri }}
            style={styles.hero}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={150}
          />
        ) : (
          <View style={[styles.hero, styles.heroPlaceholder]}>
            <Ionicons name="image-outline" size={40} color="#B0B0B0" />
          </View>
        )}
        {isHost ? (
          <View style={styles.editCoverPill}>
            <EditPill label="Edit cover" onPress={onEditCover} />
          </View>
        ) : null}
        <View style={styles.heroCard}>
          {/* Coloured trip-type tag, straddling the top edge of the card. */}
          {typeTagWord ? (
            <View style={styles.typeTagWrap} pointerEvents="none">
              <LinearGradient
                colors={typeTagGradient ?? [C.accent, C.accent, C.accent]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.typeTag}
              >
                <Text style={styles.typeTagText}>{typeTagWord}</Text>
              </LinearGradient>
            </View>
          ) : null}
          <View style={styles.heroDateRow}>
            <Text style={styles.heroDate}>{dateRange}</Text>
            {canEditDates ? <EditPill label="Set dates" onPress={onEditDates} /> : null}
          </View>
          <Text style={styles.heroTitle} numberOfLines={2}>
            {vm.title || vm.destinationLabel || 'Your trip'}
          </Text>
          <CountdownBoxes target={countdownTarget} />
        </View>
      </View>

      {/* Shared chrome slot (Overview/Plan toggle) — sits between hero and body. */}
      {afterHeroSlot ?? null}
      </View>

      {!bodyHidden && (
        <>
          {/* ---- Info chips — horizontal scroll, fixed order ---- */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipsScroll}
            contentContainerStyle={styles.chipsScrollContent}
          >
            {chips.map((c, i) => {
              const inner = (
                <>
                  <View style={[styles.chipIconBox, c.highlight && styles.chipIconBoxHighlight]}>
                    <TripIcon
                      name={c.icon}
                      size={22}
                      color={c.highlight ? '#FFFFFF' : ICON_INK}
                      strokeWidth={1.1}
                    />
                  </View>
                  <View style={styles.chipText}>
                    <Text style={styles.chipLabel} numberOfLines={1}>
                      {c.label}
                    </Text>
                    <Text style={styles.chipValue} numberOfLines={1}>
                      {c.value}
                    </Text>
                    {c.footer ? (
                      <View style={styles.chipFooterRow}>
                        <Text style={styles.chipFooter} numberOfLines={1}>
                          {c.footer}
                        </Text>
                        <Ionicons name="arrow-forward" size={14} color={C.brandTeal} />
                      </View>
                    ) : null}
                  </View>
                </>
              );
              const cardStyle = c.highlight ? [styles.chip, styles.chipHighlight] : styles.chip;
              return c.onPress ? (
                <TouchableOpacity
                  key={`${c.label}-${i}`}
                  activeOpacity={0.85}
                  onPress={c.onPress}
                  style={cardStyle}
                  accessibilityRole="button"
                  accessibilityLabel={`${c.label} ${c.value}.${c.footer ? ` ${c.footer}` : ''}`}
                >
                  {inner}
                </TouchableOpacity>
              ) : (
                <View key={`${c.label}-${i}`} style={cardStyle}>
                  {inner}
                </View>
              );
            })}
          </ScrollView>

          {/* ---- About <host> (organizer self-intro) — host_lead_note. Shown
                  when the host wrote one, or always to the host so they can add
                  one via "Edit Profile". ---- */}
          {!isPlannedTogether &&
          aboutHost &&
          (aboutHost.bio || isHost || hasHostBadges || hostFamiliarity.length > 0) ? (
            <View style={styles.section}>
              <View style={styles.aboutHostHeader}>
                {aboutHost.avatarUrl ? (
                  <CachedImage
                    source={{ uri: aboutHost.avatarUrl }}
                    style={styles.aboutHostAvatar}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                  />
                ) : (
                  <View style={[styles.aboutHostAvatar, styles.aboutHostAvatarEmpty]}>
                    <Ionicons name="person" size={22} color="#FFFFFF" />
                  </View>
                )}
                <Text style={styles.aboutHostName} numberOfLines={1}>
                  {aboutHost.name
                    ? `About ${aboutHost.name}`
                    : isOperator
                      ? 'About the operator'
                      : 'About the Captain'}
                </Text>
                {isHost ? <EditPill label="Edit Profile" onPress={onEditAboutHost} /> : null}
              </View>
              {hasHostBadges ? (
                <View style={styles.hostBadgeGroup}>
                  {hostBadgesTop.length > 0 ? (
                    <View style={styles.hostBadgeRow}>
                      {hostBadgesTop.map((b, i) => (
                        <View key={`top-${b}-${i}`} style={styles.hostBadge}>
                          <Text style={styles.hostBadgeText} numberOfLines={1}>
                            {b}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                  {hostBadgesBottom.length > 0 ? (
                    <View style={styles.hostBadgeRow}>
                      {hostBadgesBottom.map((b, i) => (
                        <View key={`bot-${b}-${i}`} style={styles.hostBadge}>
                          <Text style={styles.hostBadgeText} numberOfLines={1}>
                            {b}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : null}
              {hostFamiliarity.length > 0 ? (
                <View style={styles.hostFamiliarity}>
                  {hostFamiliarity.map((f, i) => (
                    <View key={`fam-${i}`} style={styles.hostFamRow}>
                      <Ionicons name={f.icon} size={16} color={C.brandTeal} />
                      <Text style={styles.hostFamText}>
                        <Text style={styles.hostFamPlace}>{f.place}</Text>
                        {` · ${f.label}`}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
              {aboutHost.bio ? (
                <>
                  <Text style={styles.body} numberOfLines={aboutHostExpanded ? undefined : 4}>
                    {aboutHost.bio}
                  </Text>
                  {aboutHost.bio.length > 140 ? (
                    <TouchableOpacity
                      onPress={() => setAboutHostExpanded(v => !v)}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                    >
                      <Text style={styles.seeMore}>
                        {aboutHostExpanded ? 'See less' : 'See More'}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </>
              ) : (
                <Text style={styles.bodyPlaceholder}>
                  {isOperator
                    ? 'Tell surfers who you are and why you run great trips.'
                    : 'Tell surfers who you are and why you’re the Captain for this trip.'}
                </Text>
              )}
            </View>
          ) : null}

          {/* ---- About this trip ---- */}
          {vm.description || isHost ? (
            <View style={styles.section}>
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

          {/* ---- Surf style ---- */}
          {surfStyles.length > 0 ? (
            <View style={styles.section}>
              <SectionTitle title="Surf style" />
              <View style={styles.surfCard}>
                <View style={styles.surfPills}>
                  {surfStyles.map(s => (
                    <View key={s} style={styles.surfPill}>
                      <Text style={[styles.surfPillText, { fontSize: surfPillFontSize }]}>
                        {BOARD_SHORT[s] ?? s}
                      </Text>
                    </View>
                  ))}
                </View>
                <View style={styles.boardsRow}>
                  {surfStyles.map(s => {
                    const img = BOARD_IMAGE[s];
                    if (!img) return null;
                    return (
                      <Image key={s} source={img} style={styles.boardImg} resizeMode="contain" />
                    );
                  })}
                </View>
              </View>
            </View>
          ) : null}

          {/* ---- How this trip works ---- */}
          {structures.length > 0 ? (
            <View style={styles.section}>
              <SectionTitle title="How this trip works" />
              <View style={{ gap: 30, marginTop: 16 }}>
                {structures.map(slug => {
                  const d = STRUCTURE_DISPLAY[slug];
                  return (
                    <View key={slug} style={styles.howRow}>
                      <TripIcon name={STRUCTURE_ICON[slug] ?? 'map-01'} size={24} color={ICON_INK} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.howTitle}>{d.title}</Text>
                        <Text style={styles.howDesc}>{d.desc}</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          ) : null}

          {/* ---- Participants — tappable avatars, scroll right for more ---- */}
          <View style={styles.section}>
            <View style={styles.sectionTitleRow}>
              <View style={styles.participantsTitle}>
                <Text style={styles.sectionTitle}>Participants</Text>
                {vm.participantCount > 0 ? (
                  <Text style={styles.participantsCount}>{vm.participantCount}</Text>
                ) : null}
              </View>
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
                  >
                    {p.avatarUrl ? (
                      <CachedImage
                        source={{ uri: p.avatarUrl }}
                        style={styles.avatar}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                      />
                    ) : (
                      <View style={[styles.avatar, styles.avatarPlaceholder]}>
                        <Ionicons name="person" size={24} color="#FFFFFF" />
                      </View>
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            ) : (
              <Text style={styles.mutedSmall}>No one yet</Text>
            )}
          </View>

          {/* ---- Who it's for ---- */}
          {showWhoFor ? (
            <View style={[styles.section, styles.sectionPadBottom]}>
              <SectionTitle title="Who it's for" />
              <View style={styles.cellRow}>
                <IconCell icon="calendar-date" label="Age range" value={ageLabel} />
                <IconCell icon="bar-chart-10" label="Surf level" value={skillRange} />
              </View>
            </View>
          ) : null}

          {/* ---- Wave information ---- */}
          {showWaveInfo ? (
            <View style={[styles.section, styles.sectionPadBottom]}>
              <SectionTitle title="Wave information" />
              <View style={styles.cellRow}>
                <IconCell icon="ruler" label="Wave size" value={waveSizeLabel ?? '—'} />
                <IconCell
                  icon="waves"
                  label="Wave shape"
                  value={vm.waveShapeLabel ?? '—'}
                />
              </View>
            </View>
          ) : null}

          {/* ---- Accommodation ---- */}
          {showAccommodation || canEditStay ? (
            <View style={styles.section}>
              <SectionTitle
                title="Accommodation"
                right={
                  canEditStay ? (
                    <EditPill
                      label={vm.accommodationKindLabel ? 'Add stay' : 'Set stay'}
                      onPress={onEditAccommodation}
                    />
                  ) : undefined
                }
              />
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
                    <View style={styles.stayPillIcon}>
                      <TripIcon name="home-03" size={24} color={ICON_INK} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.stayName} numberOfLines={1}>
                        {vm.accommodationName}
                      </Text>
                      <Text style={styles.stayMeta} numberOfLines={1}>
                        {vm.accommodationKindLabel
                          ? `${vm.accommodationKindLabel} · Leading option`
                          : 'Leading option'}
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>
              ) : (
                <View style={styles.cellRow}>
                  <IconCell
                    icon="home-03"
                    label="Type"
                    value={vm.accommodationKindLabel ?? '—'}
                  />
                  <IconCell
                    icon="passport"
                    label="Specific stay"
                    value={
                      vm.specificStaySelected == null
                        ? '—'
                        : vm.specificStaySelected
                          ? 'Selected'
                          : 'Not yet'
                    }
                  />
                </View>
              )}
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
  heroWrap: {
    marginHorizontal: -16,
    marginBottom: 8,
    backgroundColor: '#FFFFFF',
  },
  hero: {
    width: '100%',
    height: 280,
    backgroundColor: C.border,
  },
  heroPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroCard: {
    marginTop: -120,
    marginHorizontal: 24,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 26,
    paddingBottom: 32,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
    alignItems: 'center',
  },
  // Coloured trip-type tag — centered, straddling the card's top edge.
  typeTagWrap: {
    position: 'absolute',
    top: -14,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 5,
  },
  typeTag: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 9,
  },
  typeTagText: {
    fontFamily: FONT_INTER,
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  heroDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  heroDate: {
    fontFamily: FONT_INTER,
    fontSize: 12,
    fontWeight: '400',
    lineHeight: 18,
    color: C.textMuted,
    textAlign: 'center',
  },
  heroTitle: {
    marginTop: 2,
    fontFamily: FONT_INTER,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '700',
    color: C.ink,
    textAlign: 'center',
  },

  // Countdown boxes
  countdownRow: {
    marginTop: 16,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'center',
  },
  countdownBox: {
    width: 64,
    height: 64,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  countdownValue: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '800',
    color: C.accent,
  },
  countdownLabel: {
    fontFamily: FONT_INTER,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '400',
    color: C.inkBody,
  },

  // Info chips — horizontal scroll, bleeds edge-to-edge.
  chipsScroll: {
    marginTop: 34,
    marginHorizontal: -16,
  },
  chipsScrollContent: {
    paddingHorizontal: 16,
    gap: 10,
  },
  chip: {
    width: CHIP_WIDTH,
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 12,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 18,
    padding: 12,
    backgroundColor: C.surface,
  },
  chipHighlight: {
    borderColor: C.brandTeal,
  },
  chipIconBox: {
    width: 48,
    height: 48,
    borderRadius: 12,
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
  chipLabel: {
    fontFamily: FONT_INTER,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400',
    color: C.textFaint,
  },
  chipValue: {
    fontFamily: FONT_INTER,
    fontSize: 17,
    lineHeight: 20,
    fontWeight: '700',
    color: C.ink,
  },
  chipFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 6,
  },
  chipFooter: {
    fontFamily: FONT_INTER,
    fontSize: 13,
    fontWeight: '600',
    color: C.brandTeal,
  },

  // Sections — separated by a hairline top border like the Figma rows.
  section: {
    marginTop: 36,
    paddingTop: 36,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 22,
  },
  // Extra breathing room under the icon-cell sections (Who it's for / Wave)
  // before the next section's divider line.
  sectionPadBottom: {
    paddingBottom: 16,
  },
  sectionTitle: {
    fontFamily: FONT_INTER,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '700',
    color: C.ink,
  },
  body: {
    fontFamily: FONT_INTER,
    fontSize: 14,
    lineHeight: 20,
    color: C.textMuted,
    // Wrap the description earlier so it doesn't run to the right edge.
    marginRight: 44,
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
  // "About <host>" header — avatar + name + Edit Profile pill.
  aboutHostHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  aboutHostAvatar: {
    width: 53,
    height: 53,
    borderRadius: 27,
    borderWidth: 1,
    borderColor: C.surface,
    backgroundColor: C.avatarBg,
  },
  aboutHostAvatarEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  aboutHostName: {
    flex: 1,
    fontFamily: FONT_INTER,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '700',
    color: C.ink,
  },
  // Host profile detail badges (Trip Operator) — soft pill tags under the bio.
  hostBadgeGroup: {
    gap: 8,
    marginBottom: 22,
  },
  hostBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  // Floating chips — white, no border/fill tint, soft drop shadow so they lift
  // off the card.
  hostBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  hostBadgeText: {
    fontFamily: FONT_INTER,
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '600',
    color: C.inkBody,
  },
  // "Local knowledge" rows in the About block — destination + stay familiarity.
  hostFamiliarity: {
    gap: 8,
    marginBottom: 16,
  },
  hostFamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  hostFamText: {
    flex: 1,
    fontFamily: FONT_INTER,
    fontSize: 14,
    lineHeight: 20,
    color: C.inkBody,
  },
  hostFamPlace: {
    fontWeight: '700',
  },
  seeMore: {
    marginTop: 8,
    fontFamily: FONT_INTER,
    fontSize: 15,
    fontWeight: '400',
    color: C.brandTeal,
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
    gap: 16,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 20,
    backgroundColor: C.surface,
    paddingHorizontal: 12,
    paddingVertical: 16,
  },
  surfPills: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 8,
    rowGap: 12,
  },
  surfPill: {
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.chipBg,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  surfPillText: {
    fontFamily: FONT_INTER,
    // Base size comes from surfPillFontSize (16, or 12 with 4 boards) — set inline.
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '400',
    color: C.ink,
    textAlign: 'center',
  },
  boardsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    height: 112,
  },
  boardImg: {
    width: 28,
    height: 112,
  },

  // How it works
  howRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
  },
  howTitle: {
    fontFamily: FONT_INTER,
    fontSize: 14,
    fontWeight: '700',
    color: '#0A0A0A',
  },
  howDesc: {
    marginTop: 2,
    fontFamily: FONT_INTER,
    fontSize: 12,
    lineHeight: 17,
    color: C.textHowDesc,
  },

  // Icon-box cells (Who it's for / Wave information / Accommodation fallback)
  cellRow: {
    flexDirection: 'row',
    gap: 4,
  },
  iconCell: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  // White square sized to the height of the label+value text beside it.
  iconCellBox: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  iconCellText: {
    flex: 1,
  },
  iconCellLabel: {
    fontFamily: FONT_INTER,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400',
    color: C.textMuted,
  },
  iconCellValue: {
    marginTop: 3,
    fontFamily: FONT_INTER,
    fontSize: 14,
    fontWeight: '700',
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
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
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
  avatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
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
  stayCard: {
    backgroundColor: C.surface,
    borderRadius: 36,
    padding: 16,
    gap: 12,
    // No border — a small float instead.
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  stayImage: {
    width: '100%',
    aspectRatio: 328 / 198, // ≈ 3.3 wide : 2 tall (landscape, per Figma)
    borderRadius: 28,
    backgroundColor: C.surfaceMuted,
  },
  stayImagePlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  stayPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: C.surfaceMuted,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  stayPillIcon: {
    width: 48,
    height: 48,
    borderRadius: 28,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stayName: {
    fontFamily: FONT_INTER,
    fontSize: 16,
    lineHeight: 18,
    fontWeight: '700',
    color: '#0A0A0A',
  },
  stayMeta: {
    marginTop: 2,
    fontFamily: FONT_INTER,
    fontSize: 13,
    lineHeight: 18,
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
