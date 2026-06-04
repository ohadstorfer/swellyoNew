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
  const totalDays = Math.floor(diffMs / MS_DAY);

  let blocks: { value: string; label: string }[];

  if (totalDays >= 31) {
    // ≥ 31 days out → Months / Days / Hours / Minutes (no seconds).
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
    // < 31 days out → Days / Hours / Minutes / Seconds.
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

// Icon-box + label + value cell, used by "Who it's for" and "Wave information".
const IconCell: React.FC<{
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}> = ({ icon, label, value }) => (
  <View style={styles.iconCell}>
    <View style={styles.iconCellBox}>
      <Ionicons name={icon} size={18} color={C.brandTeal} />
    </View>
    <View style={styles.iconCellText}>
      <Text style={styles.iconCellLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.iconCellValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  </View>
);

// Placeholder participant avatars (real pics wired later — VM only has a count).
const AvatarStack: React.FC<{ count: number }> = ({ count }) => {
  const shown = Math.min(Math.max(count, 0), 6);
  const extra = count - shown;
  if (shown === 0) return <Text style={styles.mutedSmall}>No one yet</Text>;
  return (
    <View style={styles.avatarRow}>
      {Array.from({ length: shown }).map((_, i) => (
        <View key={i} style={[styles.avatar, i > 0 && styles.avatarOverlap]}>
          <Ionicons name="person" size={22} color="#FFFFFF" />
        </View>
      ))}
      {extra > 0 ? (
        <View style={[styles.avatar, styles.avatarOverlap, styles.avatarExtra]}>
          <Text style={styles.avatarExtraText}>+{extra}</Text>
        </View>
      ) : null}
    </View>
  );
};

// ---------------------------------------------------------------------------
export const TripDetailViewRedesigned: React.FC<TripDetailViewProps> = ({
  vm,
  onSeeAllParticipants,
  onLeaderPress,
  afterHeroSlot,
  bodyHidden,
}) => {
  const [showIncludes, setShowIncludes] = useState(false);
  const [aboutExpanded, setAboutExpanded] = useState(false);

  const dateRange = formatDateRange(vm);
  const countdownTarget = computeCountdownTarget(vm);
  const skillLabel = formatSkillLevel(vm.skillLevels);
  const ageLabel = formatAge(vm.ageMin, vm.ageMax);
  const participantsLabel = vm.maxParticipants
    ? `${vm.participantCount}/${vm.maxParticipants} going`
    : `${vm.participantCount} going`;

  const vibeLabel = vm.vibeSlug
    ? TRIP_VIBE_OPTIONS.find(v => v.slug === vm.vibeSlug)?.label ?? null
    : null;

  const surfStyles = vm.surfStyles.filter(s => s !== 'all');
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
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    value: string;
    highlight?: boolean;
    footer?: string;
    onPress?: () => void;
  }[] = [];
  if (vm.costPerPerson != null) {
    chips.push({
      icon: 'cash-outline',
      label: 'Price',
      value: `${vm.costPerPerson}$`,
      highlight: true,
      footer: includeSections.length > 0 ? 'See what’s included' : undefined,
      onPress: includeSections.length > 0 ? () => setShowIncludes(true) : undefined,
    });
  } else if (budgetLabel) {
    chips.push({ icon: 'cash-outline', label: 'Budget', value: budgetLabel });
  }
  chips.push({ icon: 'ribbon-outline', label: 'Level', value: skillLabel });
  chips.push({ icon: 'calendar-outline', label: 'Age range', value: ageLabel });
  chips.push({ icon: 'people-outline', label: 'Participants', value: participantsLabel });
  if (tripTypeLabel) chips.push({ icon: 'flag-outline', label: 'Trip type', value: tripTypeLabel });
  if (vibeLabel) chips.push({ icon: 'sparkles-outline', label: 'Focus vibe', value: vibeLabel });
  if (waveSizeLabel) chips.push({ icon: 'resize-outline', label: 'Wave size', value: waveSizeLabel });
  if (vm.waveShapeLabel)
    chips.push({ icon: 'water-outline', label: 'Wave type', value: vm.waveShapeLabel });

  // "Who it's for" / "Wave information" only render when they have real data.
  const showWhoFor = vm.ageMin != null || vm.ageMax != null || vm.skillLevels.length > 0;
  const showWaveInfo = !!waveSizeLabel || !!vm.waveShapeLabel;

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
        <View style={styles.heroCard}>
          <Text style={styles.heroDate}>{dateRange}</Text>
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
                  <View style={[styles.chipIconBox, c.highlight && styles.chipIconBoxHi]}>
                    <Ionicons
                      name={c.icon}
                      size={18}
                      color={c.highlight ? '#FFFFFF' : C.brandTeal}
                    />
                  </View>
                  <View style={styles.chipText}>
                    <Text
                      style={[styles.chipLabel, c.highlight && styles.chipLabelHi]}
                      numberOfLines={1}
                    >
                      {c.label}
                    </Text>
                    <Text
                      style={[styles.chipValue, c.highlight && styles.chipValueHi]}
                      numberOfLines={1}
                    >
                      {c.value}
                    </Text>
                    {c.footer ? (
                      <View style={styles.chipFooterRow}>
                        <Text style={styles.chipFooter} numberOfLines={1}>
                          {c.footer}
                        </Text>
                        <Ionicons name="chevron-forward" size={11} color="#FFFFFF" />
                      </View>
                    ) : null}
                  </View>
                </>
              );
              const cardStyle = [styles.chip, c.highlight && styles.chipHi];
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

          {/* ---- About ---- */}
          {vm.description ? (
            <View style={styles.section}>
              <SectionTitle title="About this trip" />
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
                      <Text style={styles.surfPillText}>{BOARD_SHORT[s] ?? s}</Text>
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
              <View style={{ gap: 18, marginTop: 4 }}>
                {structures.map(slug => {
                  const d = STRUCTURE_DISPLAY[slug];
                  return (
                    <View key={slug} style={styles.howRow}>
                      <Ionicons name={d.icon} size={22} color={C.brandTeal} />
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
                  {vm.leader.leadNote ? (
                    <Text style={styles.leaderNote}>“{vm.leader.leadNote}”</Text>
                  ) : null}
                </View>
              </View>
            </View>
          ) : null}

          {/* ---- Participants ---- */}
          <View style={styles.section}>
            <SectionTitle
              title="Participants"
              right={
                onSeeAllParticipants ? (
                  <TouchableOpacity onPress={onSeeAllParticipants} activeOpacity={0.7}>
                    <Text style={styles.seeAll}>See all</Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={styles.seeAll}>See all</Text>
                )
              }
            />
            <AvatarStack count={vm.participantCount} />
          </View>

          {/* ---- Who it's for ---- */}
          {showWhoFor ? (
            <View style={styles.section}>
              <SectionTitle title="Who it's for" />
              <View style={styles.cellRow}>
                <IconCell icon="calendar-outline" label="Age range" value={ageLabel} />
                <IconCell icon="ribbon-outline" label="Surf level" value={skillLabel} />
              </View>
            </View>
          ) : null}

          {/* ---- Wave information ---- */}
          {showWaveInfo ? (
            <View style={styles.section}>
              <SectionTitle title="Wave information" />
              <View style={styles.cellRow}>
                <IconCell icon="resize-outline" label="Wave size" value={waveSizeLabel ?? '—'} />
                <IconCell
                  icon="water-outline"
                  label="Wave type"
                  value={vm.waveShapeLabel ?? '—'}
                />
              </View>
            </View>
          ) : null}

          {/* ---- Accommodation ---- */}
          {showAccommodation ? (
            <View style={styles.section}>
              <SectionTitle title="Accommodation" />
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
                      <Ionicons name="home-outline" size={18} color={C.brandTeal} />
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
                    icon="home-outline"
                    label="Type"
                    value={vm.accommodationKindLabel ?? '—'}
                  />
                  <IconCell
                    icon="bed-outline"
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    padding: 8,
    backgroundColor: C.surface,
  },
  chipHi: {
    backgroundColor: C.brandTeal,
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
  chipIconBoxHi: {
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  chipText: {
    flex: 1,
  },
  chipLabel: {
    fontFamily: FONT_INTER,
    fontSize: 10,
    fontWeight: '400',
    color: C.textFaint,
  },
  chipLabelHi: {
    color: 'rgba(255,255,255,0.85)',
  },
  chipValue: {
    marginTop: 1,
    fontFamily: FONT_INTER,
    fontSize: 15,
    fontWeight: '700',
    color: C.ink,
  },
  chipValueHi: {
    color: '#FFFFFF',
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
    color: '#FFFFFF',
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
    fontSize: 13,
    lineHeight: 19,
    color: C.textMuted,
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
    gap: 12,
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
    fontSize: 10,
    fontWeight: '400',
    color: C.ink,
  },
  boardsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 14,
    height: 72,
  },
  boardImg: {
    width: 22,
    height: 72,
  },

  // How it works
  howRow: {
    flexDirection: 'row',
    alignItems: 'center',
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
    fontSize: 11,
    lineHeight: 15,
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
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCellText: {
    flex: 1,
  },
  iconCellLabel: {
    fontFamily: FONT_INTER,
    fontSize: 10,
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
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: C.avatarBg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: C.surface,
  },
  avatarOverlap: {
    marginLeft: -12,
  },
  avatarExtra: {
    backgroundColor: C.brandTeal,
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
    fontSize: 10,
    lineHeight: 14,
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
