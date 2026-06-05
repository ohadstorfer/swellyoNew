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
import {
  View,
  Text,
  Image,
  StyleSheet,
  Platform,
  ScrollView,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TRIP_VIBE_OPTIONS } from '../../services/trips/groupTripsService';
import { priceInclusionSections } from '../../services/trips/priceInclusions';
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
  TRIP_TYPE_LABEL,
  formatAge,
  formatBudgetRange,
  formatDateRange,
  formatSkillLevel,
  formatSkillRange,
  computeCountdownTarget,
} from './TripDetailView';

const FONT_INTER = Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter';
const FONT_MONTSERRAT = Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat';

const SCREEN_WIDTH = Dimensions.get('window').width;
// Info chips show ~2.7 per screen. Page gutter is 16, gap is 10.
const CHIP_WIDTH = Math.round((SCREEN_WIDTH - 16) / 2.7) - 8;

const C = {
  accent: '#05BCD3', // countdown numbers (brighter Figma accent)
  brandTeal: '#0788B0', // chip icons + links
  ink: '#333333',
  inkBody: '#222B30',
  textMuted: '#7B7B7B',
  textFaint: '#A0A0A0',
  textHowDesc: '#4A5565',
  border: '#EEEEEE',
  borderCard: '#E8E8E8',
  surface: '#FFFFFF',
  surfaceMuted: '#F7F7F7',
  chipBg: '#EEEEEE',
  brandTealTint: '#E6F4F8',
  avatarBg: '#9CB6C0',
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
      <TripIcon name={icon} size={18} color={ICON_INK} />
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
  const surfPillFontSize = surfStyles.length >= 4 ? 10 : 14;
  const structures = vm.structureSlugs.filter(s => STRUCTURE_DISPLAY[s]);

  const waveSizeLabel =
    vm.waveSizeMin != null && vm.waveSizeMax != null
      ? vm.waveSizeMin === vm.waveSizeMax
        ? `${vm.waveSizeMax} ft`
        : `${vm.waveSizeMin}–${vm.waveSizeMax} ft`
      : null;

  const showAccommodation =
    !!vm.accommodationName || !!vm.accommodationKindLabel || vm.specificStaySelected != null;

  const priceLabel =
    vm.costPerPerson != null ? `$${vm.costPerPerson.toLocaleString('en-US')}` : null;
  const includeSections = priceInclusionSections(vm.priceInclusions);

  // Horizontal info chips below the countdown — fixed order, each shown only
  // when it has data.
  const budgetLabel = formatBudgetRange(vm.budgetMin ?? null, vm.budgetMax ?? null);
  const tripTypeLabel = vm.hostingStyle ? TRIP_TYPE_LABEL[vm.hostingStyle] : null;
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
      footer: includeSections.length > 0 ? 'See what’s included' : undefined,
      onPress: includeSections.length > 0 ? () => setShowIncludes(true) : undefined,
    });
  } else if (budgetLabel) {
    chips.push({
      icon: 'currency-dollar-circle',
      label: isOperator ? 'Price' : 'Budget',
      value: budgetLabel,
      highlight: isOperator || undefined,
      footer: isOperator && includeSections.length > 0 ? 'See what’s included' : undefined,
      onPress:
        isOperator && includeSections.length > 0 ? () => setShowIncludes(true) : undefined,
    });
  }
  chips.push({ icon: 'bar-chart-10', label: 'Level', value: skillLabel });
  chips.push({ icon: 'calendar', label: 'Age range', value: ageLabel });
  chips.push({ icon: 'users-02', label: 'Participants', value: participantsLabel });
  if (tripTypeLabel) chips.push({ icon: 'marker-pin-05', label: 'Trip type', value: tripTypeLabel });
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
  const hostBadges: string[] = isOperator && aboutHost
    ? ([
        aboutHost.age != null ? `${aboutHost.age} yrs` : null,
        aboutHost.countryFrom,
        aboutHost.surfLevelLabel,
        aboutHost.boardLabel,
        aboutHost.surfTrips != null ? `${aboutHost.surfTrips} Surf Trips` : null,
      ].filter(Boolean) as string[])
    : [];

  return (
    <View style={styles.root}>
      {/* ---- Hero + overlapping card with countdown ---- */}
      <View style={styles.heroWrap}>
        {vm.heroImageUri ? (
          <Image source={{ uri: vm.heroImageUri }} style={styles.hero} resizeMode="cover" />
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
                  <View style={styles.chipIconBox}>
                    <TripIcon name={c.icon} size={18} color={ICON_INK} />
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
                        <Ionicons name="chevron-forward" size={11} color={C.brandTeal} />
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
                  accessibilityLabel={`${c.label} ${c.value}. See what's included.`}
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
          {!isPlannedTogether && aboutHost && (aboutHost.bio || isHost || hostBadges.length > 0) ? (
            <View style={styles.section}>
              <View style={styles.aboutHostHeader}>
                {aboutHost.avatarUrl ? (
                  <Image source={{ uri: aboutHost.avatarUrl }} style={styles.aboutHostAvatar} />
                ) : (
                  <View style={[styles.aboutHostAvatar, styles.aboutHostAvatarEmpty]}>
                    <Ionicons name="person" size={22} color="#FFFFFF" />
                  </View>
                )}
                <Text style={styles.aboutHostName} numberOfLines={1}>
                  {aboutHost.name ? `About ${aboutHost.name}` : 'About the organizer'}
                </Text>
                {isHost ? <EditPill label="Edit Profile" onPress={onEditAboutHost} /> : null}
              </View>
              {hostBadges.length > 0 ? (
                <View style={styles.hostBadgeRow}>
                  {hostBadges.map((b, i) => (
                    <View key={`${b}-${i}`} style={styles.hostBadge}>
                      <Text style={styles.hostBadgeText} numberOfLines={1}>
                        {b}
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
                  Tell surfers who you are and why you’re leading this trip.
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
              <View style={{ gap: 24, marginTop: 4 }}>
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

          {/* ---- Meet your leader (Flow B) ---- */}
          {vm.leader ? (
            <View style={styles.section}>
              <SectionTitle title="Meet your leader" />
              <View style={styles.leaderBlock}>
                <TouchableOpacity
                  activeOpacity={onLeaderPress ? 0.8 : 1}
                  onPress={onLeaderPress}
                  disabled={!onLeaderPress}
                  style={styles.leaderTop}
                  accessibilityRole={onLeaderPress ? 'button' : undefined}
                  accessibilityLabel={onLeaderPress ? "Open leader's profile" : undefined}
                >
                  {vm.leader.avatarUrl ? (
                    <Image source={{ uri: vm.leader.avatarUrl }} style={styles.leaderAvatar} />
                  ) : (
                    <View style={[styles.leaderAvatar, styles.leaderAvatarEmpty]}>
                      <Ionicons name="person" size={22} color="#FFFFFF" />
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.leaderName} numberOfLines={1}>
                      {vm.leader.name || 'The leader'}
                      {vm.leader.age != null ? (
                        <Text style={styles.leaderMeta}>{`  ·  ${vm.leader.age}${
                          vm.leader.countryFrom ? ` from ${vm.leader.countryFrom}` : ''
                        }`}</Text>
                      ) : null}
                    </Text>
                    {(vm.leader.surfLevelLabel || vm.leader.tripsCount != null) && (
                      <Text style={styles.leaderMeta}>
                        {[
                          vm.leader.surfLevelLabel,
                          vm.leader.tripsCount != null
                            ? `${vm.leader.tripsCount} Surf Trips`
                            : null,
                        ]
                          .filter(Boolean)
                          .join('  ·  ')}
                      </Text>
                    )}
                  </View>
                  {onLeaderPress ? (
                    <Ionicons name="chevron-forward" size={18} color={C.textMuted} />
                  ) : null}
                </TouchableOpacity>

                <View style={styles.leaderCreds}>
                  {vm.leader.destinationFamiliarityLabel ? (
                    <View style={styles.leaderCredRow}>
                      <Ionicons name="navigate-outline" size={16} color={C.brandTeal} />
                      <Text style={styles.leaderCredText}>
                        {vm.leader.destinationFamiliarityLabel}
                      </Text>
                    </View>
                  ) : null}
                  {vm.leader.stayFamiliarityLabel ? (
                    <View style={styles.leaderCredRow}>
                      <Ionicons name="home-outline" size={16} color={C.brandTeal} />
                      <Text style={styles.leaderCredText}>{vm.leader.stayFamiliarityLabel}</Text>
                    </View>
                  ) : null}
                  {/* When the "About <host>" block above already shows this note
                      (same host_lead_note), skip it here to avoid duplication. */}
                  {vm.leader.leadNote && !aboutHost?.bio ? (
                    <Text style={styles.leaderNote}>“{vm.leader.leadNote}”</Text>
                  ) : null}
                </View>
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
                      <Image source={{ uri: p.avatarUrl }} style={styles.avatar} />
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
            <View style={styles.section}>
              <SectionTitle title="Who it's for" />
              <View style={styles.cellRow}>
                <IconCell icon="calendar-date" label="Age range" value={ageLabel} />
                <IconCell icon="bar-chart-10" label="Surf level" value={skillRange} />
              </View>
            </View>
          ) : null}

          {/* ---- Wave information ---- */}
          {showWaveInfo ? (
            <View style={styles.section}>
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
                <View style={styles.stayCard}>
                  {vm.accommodationImageUri ? (
                    <Image
                      source={{ uri: vm.accommodationImageUri }}
                      style={styles.stayImage}
                      resizeMode="cover"
                    />
                  ) : (
                    <View style={[styles.stayImage, styles.stayImagePlaceholder]}>
                      <Ionicons name="image-outline" size={32} color="#B0B0B0" />
                    </View>
                  )}
                  <View style={styles.stayPill}>
                    <View style={styles.stayPillIcon}>
                      <TripIcon name="home-03" size={18} color={ICON_INK} />
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
                </View>
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
        onClose={() => setShowIncludes(false)}
        heightMode="full"
      >
        {priceLabel ? (
          <View style={styles.includesSheetPrice}>
            <Text style={styles.priceValue}>{priceLabel}</Text>
            <Text style={styles.pricePer}>per person</Text>
          </View>
        ) : null}
        <View style={styles.includesCard}>
          {includeSections.map((sec, i) => (
            <View key={sec.title} style={[styles.includeRow, i > 0 && styles.includeRowDivider]}>
              <View style={styles.includeBullet}>
                <Ionicons name="checkmark" size={14} color={C.brandTeal} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.includeTitle}>{sec.title}</Text>
                {sec.items.map((it, j) => (
                  <Text key={j} style={styles.includeItem}>
                    {it}
                  </Text>
                ))}
              </View>
            </View>
          ))}
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

  // Hero + floating card
  heroWrap: {
    marginHorizontal: -16,
    marginBottom: 8,
  },
  hero: {
    width: '100%',
    height: 220,
    backgroundColor: C.border,
  },
  heroPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroCard: {
    marginTop: -52,
    marginHorizontal: 16,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 22,
    shadowColor: '#000',
    shadowOpacity: 0.07,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
    alignItems: 'center',
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
    width: 52,
    height: 52,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  countdownValue: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '800',
    color: C.accent,
  },
  countdownLabel: {
    fontFamily: FONT_INTER,
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '400',
    color: C.inkBody,
  },

  // Info chips — horizontal scroll, bleeds edge-to-edge.
  chipsScroll: {
    marginTop: 14,
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
    gap: 8,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    padding: 8,
    backgroundColor: C.surface,
  },
  chipHighlight: {
    borderColor: C.brandTeal,
  },
  chipIconBox: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: C.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
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
    fontSize: 16,
    lineHeight: 18,
    fontWeight: '700',
    color: C.ink,
  },
  chipFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: 2,
  },
  chipFooter: {
    fontFamily: FONT_INTER,
    fontSize: 10,
    fontWeight: '600',
    color: C.brandTeal,
  },

  // Sections — separated by a hairline top border like the Figma rows.
  section: {
    marginTop: 20,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
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
  hostBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  hostBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surfaceMuted,
  },
  hostBadgeText: {
    fontFamily: FONT_INTER,
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '600',
    color: C.inkBody,
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
    fontFamily: FONT_INTER,
    // Base 14px. Overridden to 10px when there are 4 boards (see surfPillFontSize)
    // — with 4, the boards illustration takes ~half the row so 14px wraps to 3
    // lines; fewer boards leave room to keep 14px in 2 lines.
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400',
    color: C.ink,
    textAlign: 'center',
  },
  boardsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 16,
    height: 70,
  },
  boardImg: {
    width: 22,
    height: 72,
  },

  // How it works
  howRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  howTitle: {
    fontFamily: FONT_INTER,
    fontSize: 14,
    fontWeight: '700',
    color: '#0A0A0A',
  },
  howDesc: {
    marginTop: 1,
    fontFamily: FONT_INTER,
    fontSize: 14,
    lineHeight: 20,
    color: C.textHowDesc,
  },

  // Icon-box cells (Who it's for / Wave information / Accommodation fallback)
  cellRow: {
    flexDirection: 'row',
    gap: 16,
  },
  iconCell: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconCellBox: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: C.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
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
    marginTop: 1,
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
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 28,
    padding: 10,
    gap: 10,
  },
  stayImage: {
    width: '100%',
    height: 190,
    borderRadius: 22,
    backgroundColor: C.surfaceMuted,
  },
  stayImagePlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  stayPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.surfaceMuted,
    borderRadius: 28,
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  stayPillIcon: {
    width: 38,
    height: 38,
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

  // "What's included" sheet (Flow C)
  includesSheetPrice: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: C.borderCard,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 18,
  },
  priceValue: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 26,
    fontWeight: '800',
    color: C.ink,
  },
  pricePer: {
    fontFamily: FONT_INTER,
    fontSize: 14,
    fontWeight: '500',
    color: C.textMuted,
  },
  includesCard: {
    borderWidth: 1,
    borderColor: C.borderCard,
    borderRadius: 16,
    paddingHorizontal: 14,
  },
  includeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 12,
  },
  includeRowDivider: {
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  includeBullet: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: C.brandTealTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  includeTitle: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 14,
    fontWeight: '700',
    color: C.inkBody,
  },
  includeItem: {
    marginTop: 2,
    fontFamily: FONT_INTER,
    fontSize: 13,
    lineHeight: 18,
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
