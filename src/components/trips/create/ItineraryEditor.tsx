// ItineraryEditor — how an operator writes the day-by-day plan. Used by the
// wizard's itinerary step and by OperatorEditItineraryScreen after publish, so
// both are the same UI. Design: the "Trip itinerary — operator flow" canvas; the
// guest side is overview/TripItinerarySection.tsx.
//
// Two views, both controlled, nothing written here:
//   ItineraryDayList    one row per calendar day, generated from the trip dates
//   ItineraryDayEditor  title, photos and activities of one day
//
// The day editor is a page, not a sheet: it is a long form with a keyboard, and
// the time picker would otherwise be a sheet opened from a sheet.
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Thumb } from '../../Thumb';
import { WizardBottomSheet } from '../WizardBottomSheet';
import { textStyle, textStyles } from '../../../theme/typography';
import {
  MAX_DAY_PHOTOS,
  MAX_DAY_TITLE_LENGTH,
  dayHighlights,
  dayLabel,
  dayNeedsTitle,
  daysPastEnd,
  emptyDay,
  formatActivityTime,
  isDayPlanned,
  tripRangeLabel,
  type ItineraryActivity,
  type ItineraryDay,
} from '../../../services/trips/itinerary';

const C = {
  accent: '#008A9C',
  cyan: '#05BCD3',
  cyanTint: '#E6F8FA',
  ink: '#333333',
  muted: '#7B7B7B',
  faint: '#A0A0A0',
  hairline: '#EEEEEE',
  dashed: '#D5D7DA',
  tile: '#F7F7F7',
  white: '#FFFFFF',
  warnBg: '#FFF6E5',
  warnInk: '#6B4A00',
  scrim: 'rgba(33,33,33,0.75)',
};

// 12-hour clock with an AM/PM column. Stored as "HH:mm" 24h, so sorting holds.
const HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1));
const PERIODS = ['AM', 'PM'] as const;
type Period = (typeof PERIODS)[number];
const MINUTES = ['00', '15', '30', '45'];
const HOUR_ROW_H = 44;

type PickedPhoto = { uri: string; ratio: number | null };

/** The system photo picker, several at once. Same permission rule as the
 *  wizard's pickImage: only legacy Android asks. Multi-select has no crop step,
 *  which is fine here because every slot is `contentFit="cover"`. */
const pickPhotos = async (limit: number): Promise<PickedPhoto[]> => {
  try {
    const ImagePicker = require('expo-image-picker');
    const usePhotoPicker =
      Platform.OS === 'ios' || (Platform.OS === 'android' && Platform.Version >= 33);
    if (!usePhotoPicker) {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'We need photo library access to pick an image.');
        return [];
      }
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: limit,
      quality: 0.85,
    });
    if (result.canceled) return [];
    return (result.assets ?? [])
      .slice(0, limit)
      .map((a: { uri: string; width?: number; height?: number }) => ({
        uri: a.uri,
        ratio: a.width && a.height ? a.width / a.height : null,
      }));
  } catch (e) {
    console.error('[ItineraryEditor] pickPhotos error:', e);
    return [];
  }
};

// -----------------------------------------------------------------------------
// Day list
// -----------------------------------------------------------------------------
export interface ItineraryDayListProps {
  days: ItineraryDay[];
  totalDays: number;
  startISO: string | null;
  endISO: string | null;
  onOpenDay: (day: ItineraryDay) => void;
  onRemoveDay: (day: number) => void;
}

export const ItineraryDayList: React.FC<ItineraryDayListProps> = ({
  days,
  totalDays,
  startISO,
  endISO,
  onOpenDay,
  onRemoveDay,
}) => {
  const byNumber = new Map(days.map(d => [d.day, d]));
  const inTrip = Array.from({ length: totalDays }, (_, i) => byNumber.get(i + 1) ?? emptyDay(i + 1));
  const plannedCount = inTrip.filter(isDayPlanned).length;
  const past = daysPastEnd(days, totalDays);

  return (
    <View style={styles.listRoot}>
      {plannedCount === 0 && past.length === 0 ? (
        <View style={styles.intro}>
          <Text style={styles.introTitle}>Plan it day by day</Text>
          <Text style={styles.introBody}>
            Optional. Guests see this on your trip page. You can add or change it after you publish.
          </Text>
        </View>
      ) : null}

      <View style={styles.metaRow}>
        <Text style={styles.metaRange}>{tripRangeLabel(startISO, endISO)}</Text>
        {plannedCount > 0 ? (
          <Text style={styles.metaCount}>
            {plannedCount} of {totalDays} planned
          </Text>
        ) : null}
      </View>

      {past.length > 0 ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            <Text style={styles.bannerStrong}>Your trip is shorter now. </Text>
            {past.length === 1 ? `Day ${past[0].day}` : `Days ${past[0].day} to ${past[past.length - 1].day}`}{' '}
            won't show to guests. Remove {past.length === 1 ? 'it' : 'them'}, or change your dates
            back.
          </Text>
        </View>
      ) : null}

      <View style={styles.rows}>
        {inTrip.map(day =>
          isDayPlanned(day) ? (
            <PlannedRow
              key={day.day}
              day={day}
              label={dayLabel(startISO, day.day)}
              onPress={() => onOpenDay(day)}
            />
          ) : (
            <OpenRow
              key={day.day}
              label={dayLabel(startISO, day.day)}
              onPress={() => onOpenDay(day)}
            />
          ),
        )}
        {past.map(day => (
          <View key={day.day} style={[styles.row, styles.rowOutside]}>
            {day.photos[0] ? (
              <Thumb uri={day.photos[0]} size={320} contentFit="cover" cachePolicy="memory-disk" transition={120} style={[styles.rowPhoto, styles.rowPhotoDim]} />
            ) : (
              <View style={styles.rowTile} />
            )}
            <View style={styles.rowBody}>
              <Text style={styles.outsideLabel}>Day {day.day} · Past your end date</Text>
              <Text style={styles.openTitle} numberOfLines={1}>
                {day.title || 'Untitled day'}
              </Text>
            </View>
            <Pressable
              onPress={() => onRemoveDay(day.day)}
              style={styles.removeDayBtn}
              accessibilityRole="button"
              accessibilityLabel={`Remove day ${day.day}`}
            >
              <Text style={styles.removeDayText}>Remove</Text>
            </Pressable>
          </View>
        ))}
      </View>
    </View>
  );
};

const PlannedRow: React.FC<{ day: ItineraryDay; label: string; onPress: () => void }> = ({
  day,
  label,
  onPress,
}) => (
  <Pressable
    onPress={onPress}
    style={({ pressed }) => [styles.row, styles.rowPlanned, pressed && styles.pressed]}
    accessibilityRole="button"
    accessibilityLabel={`${label}, ${day.title}`}
  >
    {day.photos[0] ? (
      <Thumb uri={day.photos[0]} size={320} contentFit="cover" cachePolicy="memory-disk" transition={120} style={styles.rowPhoto} />
    ) : (
      <View style={styles.rowTile}>
        <Ionicons name="image-outline" size={20} color={C.muted} />
      </View>
    )}
    <View style={styles.rowBody}>
      <Text style={styles.rowLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.rowTitle} numberOfLines={1}>
        {day.title}
      </Text>
      <Text style={styles.rowHighlights} numberOfLines={1}>
        {dayHighlights(day)}
      </Text>
    </View>
    <Ionicons name="chevron-forward" size={22} color={C.ink} />
  </Pressable>
);

const OpenRow: React.FC<{ label: string; onPress: () => void }> = ({ label, onPress }) => (
  <Pressable
    onPress={onPress}
    style={({ pressed }) => [styles.row, styles.rowOpen, pressed && styles.pressed]}
    accessibilityRole="button"
    accessibilityLabel={`${label}, add plan`}
  >
    <View style={styles.rowTile}>
      <Ionicons name="add" size={22} color={C.muted} />
    </View>
    <View style={styles.rowBody}>
      <Text style={styles.rowLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.openTitle}>Add plan</Text>
    </View>
    <Ionicons name="chevron-forward" size={22} color={C.muted} />
  </Pressable>
);

/**
 * Leaving an open day by Back while it has photos or activities but no title
 * (`dayNeedsTitle`). Done is disabled in that state, but Back would save the
 * day and publish would then drop it without a word, photos included. So ask:
 * stay and add a title, or leave without saving this day's changes (the
 * version saved before stays as it was). RN's Alert ignores custom buttons on
 * web, hence window.confirm there (same as TripsScreen).
 */
export const confirmLeaveUntitledDay = (onDiscard: () => void): void => {
  const title = 'This day has no title';
  const message =
    "Guests only see days with a title, so this day's photos and activities won't be saved.";
  if (Platform.OS === 'web') {
    if (window.confirm(`${title}\n\n${message}\n\nLeave without saving this day?`)) onDiscard();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Add a title', style: 'cancel' },
    { text: 'Discard changes', style: 'destructive', onPress: onDiscard },
  ]);
};

// -----------------------------------------------------------------------------
// Day editor
// -----------------------------------------------------------------------------
export interface ItineraryDayEditorProps {
  day: ItineraryDay;
  /** Other planned days, offered as a starting point while this one is empty. */
  copyFrom: ItineraryDay[];
  onChange: (next: ItineraryDay) => void;
  /** Lets the wizard chrome scroll the focused field clear of the keyboard. */
  onInputFocus?: (input: TextInput | null) => void;
}

export const ItineraryDayEditor: React.FC<ItineraryDayEditorProps> = ({
  day,
  copyFrom,
  onChange,
  onInputFocus,
}) => {
  const [selectedPhoto, setSelectedPhoto] = useState<number | null>(null);
  const [timeFor, setTimeFor] = useState<number | null>(null);

  const isEmpty = !day.title && day.photos.length === 0 && day.activities.length === 0;
  const needsTitle = dayNeedsTitle(day);
  const canAddPhoto = day.photos.length < MAX_DAY_PHOTOS;

  const setActivity = (index: number, patch: Partial<ItineraryActivity>) =>
    onChange({
      ...day,
      activities: day.activities.map((a, i) => (i === index ? { ...a, ...patch } : a)),
    });

  const addPhotos = async () => {
    const picked = await pickPhotos(MAX_DAY_PHOTOS - day.photos.length);
    if (picked.length === 0) return;
    const ratios = { ...day.photoRatios };
    for (const photo of picked) {
      if (photo.ratio != null) ratios[photo.uri] = photo.ratio;
    }
    onChange({
      ...day,
      photos: [...day.photos, ...picked.map(photo => photo.uri)],
      photoRatios: ratios,
    });
  };

  const makeCover = (index: number) => {
    const photo = day.photos[index];
    onChange({ ...day, photos: [photo, ...day.photos.filter((_, i) => i !== index)] });
    setSelectedPhoto(null);
  };

  const removePhoto = (index: number) => {
    onChange({ ...day, photos: day.photos.filter((_, i) => i !== index) });
    setSelectedPhoto(null);
  };

  return (
    <View style={styles.editorRoot}>
      {isEmpty && copyFrom.length > 0 ? (
        <View style={styles.block}>
          <Text style={styles.fieldLabel}>Start from another day</Text>
          <View style={styles.chips}>
            {copyFrom.map(source => (
              <Pressable
                key={source.day}
                onPress={() =>
                  onChange({
                    ...day,
                    title: source.title,
                    photos: source.photos,
                    photoRatios: source.photoRatios,
                    activities: source.activities,
                  })
                }
                style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
                accessibilityRole="button"
              >
                <Text style={styles.chipText} numberOfLines={1}>
                  Day {source.day}: {source.title}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.block}>
        <Text style={styles.fieldLabel}>Day title</Text>
        <Field
          style={styles.titleInput}
          value={day.title}
          onChangeText={title => onChange({ ...day, title })}
          maxLength={MAX_DAY_TITLE_LENGTH}
          placeholder="e.g. Uluwatu Surf Day"
          placeholderTextColor={C.faint}
          onInputFocus={onInputFocus}
        />
        {needsTitle ? (
          <Text style={styles.warning}>Give this day a title so guests can see it.</Text>
        ) : null}
      </View>

      <View style={styles.block}>
        <View style={styles.blockHeader}>
          <Text style={styles.fieldLabel}>Photos</Text>
          <Text style={styles.blockHint}>
            {day.photos.length} of {MAX_DAY_PHOTOS}
          </Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.photoStrip}
          keyboardShouldPersistTaps="handled"
        >
          {day.photos.map((uri, index) => (
            <Pressable
              key={`${uri}-${index}`}
              onPress={() => setSelectedPhoto(selectedPhoto === index ? null : index)}
              style={[styles.photoTile, selectedPhoto === index && styles.photoTileSelected]}
              accessibilityRole="button"
              accessibilityLabel={`Photo ${index + 1}`}
              accessibilityState={{ selected: selectedPhoto === index }}
            >
              <Thumb uri={uri} size={320} contentFit="cover" cachePolicy="memory-disk" transition={120} style={styles.photoImage} />
              {index === 0 ? (
                <View style={styles.coverTag}>
                  <Text style={styles.coverTagText}>Cover</Text>
                </View>
              ) : null}
            </Pressable>
          ))}
          {canAddPhoto ? (
            <Pressable
              onPress={addPhotos}
              style={({ pressed }) => [styles.addPhotoTile, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Add photos"
            >
              <Ionicons name="add" size={22} color={C.muted} />
            </Pressable>
          ) : null}
        </ScrollView>
        {selectedPhoto !== null ? (
          <View style={styles.photoActions}>
            {selectedPhoto > 0 ? (
              <Pressable
                onPress={() => makeCover(selectedPhoto)}
                style={({ pressed }) => [styles.photoAction, pressed && styles.pressed]}
                accessibilityRole="button"
              >
                <Text style={styles.photoActionText}>Make cover</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => removePhoto(selectedPhoto)}
              style={({ pressed }) => [styles.photoAction, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.photoActionText}>Remove</Text>
            </Pressable>
          </View>
        ) : null}
        <Text style={styles.blockHint}>
          The cover shows on the closed card. All photos show when guests open the day.
        </Text>
      </View>

      <View style={styles.block}>
        <View style={styles.blockHeader}>
          <Text style={styles.fieldLabel}>Activities</Text>
          <Text style={styles.blockHint}>Sorted by time</Text>
        </View>
        {day.activities.map((activity, index) => (
          <View key={index} style={styles.activity}>
            <View style={styles.activityTop}>
              <Pressable
                onPress={() => setTimeFor(index)}
                style={styles.timeBtn}
                accessibilityRole="button"
                accessibilityLabel={
                  activity.time ? `Time, ${formatActivityTime(activity.time)}` : 'Set time'
                }
              >
                <Text style={activity.time ? styles.timeText : styles.timeEmpty}>
                  {activity.time ? formatActivityTime(activity.time) : 'Time'}
                </Text>
              </Pressable>
              <Field
                style={styles.activityName}
                value={activity.name}
                onChangeText={name => setActivity(index, { name })}
                placeholder="e.g. Dawn patrol at Padang Padang"
                placeholderTextColor={C.faint}
                accessibilityLabel="Activity"
                onInputFocus={onInputFocus}
              />
              <Pressable
                onPress={() =>
                  onChange({ ...day, activities: day.activities.filter((_, i) => i !== index) })
                }
                style={styles.activityRemove}
                accessibilityRole="button"
                accessibilityLabel="Remove activity"
              >
                <Ionicons name="close" size={18} color={C.muted} />
              </Pressable>
            </View>
            <View style={styles.activityBottom}>
              <Ionicons name="location-outline" size={16} color={C.muted} />
              <Field
                style={styles.activityPlace}
                value={activity.place ?? ''}
                onChangeText={place => setActivity(index, { place })}
                placeholder="e.g. Padang Padang Beach (optional)"
                placeholderTextColor={C.faint}
                accessibilityLabel="Place"
                onInputFocus={onInputFocus}
              />
            </View>
          </View>
        ))}
        <Pressable
          onPress={() =>
            onChange({
              ...day,
              activities: [...day.activities, { time: null, name: '', place: null }],
            })
          }
          style={({ pressed }) => [styles.addBtn, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <Text style={styles.addText}>Add activity</Text>
        </Pressable>
      </View>

      {!isEmpty ? (
        <Pressable
          onPress={() =>
            Alert.alert('Clear this day?', 'Its title, photos and activities will be removed.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Clear',
                style: 'destructive',
                onPress: () => {
                  setSelectedPhoto(null);
                  onChange(emptyDay(day.day));
                },
              },
            ])
          }
          style={styles.clearBtn}
          accessibilityRole="button"
        >
          <Text style={styles.clearText}>Clear this day</Text>
        </Pressable>
      ) : null}

      <TimeSheet
        visible={timeFor !== null}
        value={timeFor !== null ? (day.activities[timeFor]?.time ?? null) : null}
        onClose={() => setTimeFor(null)}
        onPick={time => {
          if (timeFor !== null) setActivity(timeFor, { time });
          setTimeFor(null);
        }}
      />
    </View>
  );
};

/** A TextInput that reports itself on focus, so the chrome can scroll to it. */
const Field: React.FC<TextInputProps & { onInputFocus?: (input: TextInput | null) => void }> = ({
  onInputFocus,
  ...rest
}) => {
  const ref = useRef<TextInput>(null);
  return <TextInput ref={ref} onFocus={() => onInputFocus?.(ref.current)} {...rest} />;
};

// -----------------------------------------------------------------------------
// Time sheet
// -----------------------------------------------------------------------------
const TimeSheet: React.FC<{
  visible: boolean;
  value: string | null;
  onClose: () => void;
  onPick: (time: string | null) => void;
}> = ({ visible, value, onClose, onPick }) => {
  const [hour, setHour] = useState('9');
  const [minute, setMinute] = useState('00');
  const [period, setPeriod] = useState<Period>('AM');
  const hoursRef = useRef<ScrollView>(null);

  // Seeds from the row being edited each time the sheet opens.
  useEffect(() => {
    if (!visible) return;
    const [h, m] = (value ?? '09:00').split(':');
    const h24 = Number(h) || 0;
    setHour(String(h24 % 12 === 0 ? 12 : h24 % 12));
    setMinute(MINUTES.includes(m) ? m : '00');
    setPeriod(h24 < 12 ? 'AM' : 'PM');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const scrollToHour = () =>
    hoursRef.current?.scrollTo({
      y: Math.max(0, HOURS.indexOf(hour) - 2) * HOUR_ROW_H,
      animated: false,
    });

  // 12 AM is 00, 12 PM is 12.
  const to24h = (): string => {
    const h = Number(hour) % 12 + (period === 'PM' ? 12 : 0);
    return `${String(h).padStart(2, '0')}:${minute}`;
  };

  return (
    <WizardBottomSheet
      visible={visible}
      title="Activity time"
      onClose={onClose}
      titleAlign="left"
      hideHeaderDivider
      footer={
        <View style={styles.sheetFooter}>
          <Pressable
            onPress={() => onPick(to24h())}
            style={({ pressed }) => [styles.sheetPrimary, pressed && styles.pressedDark]}
            accessibilityRole="button"
          >
            <Text style={styles.sheetPrimaryText}>Set time</Text>
          </Pressable>
          <Pressable
            onPress={() => onPick(null)}
            style={styles.sheetSecondary}
            accessibilityRole="button"
          >
            <Text style={styles.sheetSecondaryText}>No set time</Text>
          </Pressable>
        </View>
      }
    >
      <View style={styles.timeColumns}>
        <ScrollView
          ref={hoursRef}
          style={styles.timeColumn}
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled
          onLayout={scrollToHour}
        >
          {HOURS.map(h => (
            <TimeCell key={h} label={h} selected={h === hour} onPress={() => setHour(h)} />
          ))}
        </ScrollView>
        <View style={styles.timeColumn}>
          {MINUTES.map(m => (
            <TimeCell key={m} label={m} selected={m === minute} onPress={() => setMinute(m)} />
          ))}
        </View>
        <View style={styles.timeColumn}>
          {PERIODS.map(p => (
            <TimeCell key={p} label={p} selected={p === period} onPress={() => setPeriod(p)} />
          ))}
        </View>
      </View>
    </WizardBottomSheet>
  );
};

const TimeCell: React.FC<{ label: string; selected: boolean; onPress: () => void }> = ({
  label,
  selected,
  onPress,
}) => (
  <Pressable
    onPress={onPress}
    style={[styles.timeCell, selected && styles.timeCellOn]}
    accessibilityRole="button"
    accessibilityState={{ selected }}
  >
    <Text style={selected ? styles.timeCellTextOn : styles.timeCellText}>{label}</Text>
  </Pressable>
);

const styles = StyleSheet.create({
  // List
  listRoot: { gap: 12 },
  intro: { gap: 2, paddingBottom: 4 },
  introTitle: { ...textStyle('MB1', '700'), color: C.ink },
  introBody: { ...textStyles.B3, color: C.muted },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  metaRange: { ...textStyles.B3, color: C.muted },
  metaCount: { ...textStyle('B3', '700'), color: C.accent },
  banner: { backgroundColor: C.warnBg, borderRadius: 12, padding: 12 },
  bannerText: { ...textStyles.B3, color: C.warnInk },
  bannerStrong: { ...textStyle('B3', '700'), color: C.warnInk },
  rows: { gap: 8 },
  row: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingLeft: 8,
    paddingRight: 6,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: C.white,
  },
  rowPlanned: {
    shadowColor: '#596E7C',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  rowOpen: { borderWidth: 1, borderColor: C.hairline },
  rowOutside: { borderWidth: 1, borderColor: C.dashed, borderStyle: 'dashed' },
  rowPhoto: { width: 68, height: 60, borderRadius: 8, backgroundColor: C.tile },
  rowPhotoDim: { opacity: 0.45 },
  rowTile: {
    width: 68,
    height: 60,
    borderRadius: 8,
    backgroundColor: C.tile,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1, minWidth: 0, justifyContent: 'center' },
  rowLabel: { ...textStyles.B4, color: C.faint },
  rowTitle: { ...textStyle('MB2', '700'), color: C.ink },
  rowHighlights: { ...textStyles.B4, color: C.muted },
  openTitle: { ...textStyle('MB2', '700'), color: C.muted },
  outsideLabel: { ...textStyles.B4, color: C.warnInk },
  removeDayBtn: { minHeight: 44, paddingHorizontal: 10, justifyContent: 'center' },
  removeDayText: { ...textStyle('B3', '700'), color: C.ink },
  pressed: { backgroundColor: '#F6F6F6', transform: [{ scale: 0.985 }] },
  pressedDark: { transform: [{ scale: 0.985 }], opacity: 0.9 },

  // Editor
  editorRoot: { gap: 20 },
  block: { gap: 8 },
  blockHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  blockHint: { ...textStyles.B3, color: C.muted },
  fieldLabel: { ...textStyle('B3', '700'), color: C.ink },
  warning: { ...textStyles.B3, color: C.warnInk },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    minHeight: 44,
    maxWidth: '100%',
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.hairline,
    backgroundColor: C.white,
  },
  chipText: { ...textStyles.B3, color: C.ink },
  titleInput: {
    ...textStyles.MB2,
    color: C.ink,
    height: 48,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.hairline,
    backgroundColor: C.white,
  },
  photoStrip: { gap: 8 },
  photoTile: {
    width: 68,
    height: 60,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'transparent',
    overflow: 'hidden',
    backgroundColor: C.tile,
  },
  photoTileSelected: { borderColor: C.cyan },
  photoImage: { width: '100%', height: '100%' },
  coverTag: {
    position: 'absolute',
    left: 3,
    bottom: 3,
    paddingHorizontal: 4,
    borderRadius: 4,
    backgroundColor: C.scrim,
  },
  coverTagText: { ...textStyles.B5, color: C.white },
  addPhotoTile: {
    width: 68,
    height: 60,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: C.dashed,
    backgroundColor: C.tile,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoActions: { flexDirection: 'row', gap: 8 },
  photoAction: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.hairline,
    backgroundColor: C.white,
  },
  photoActionText: { ...textStyle('B3', '700'), color: C.ink },
  activity: {
    paddingLeft: 8,
    paddingRight: 4,
    paddingVertical: 2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.hairline,
    backgroundColor: C.white,
  },
  activityTop: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48 },
  timeBtn: {
    height: 36,
    minWidth: 60,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: C.tile,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeText: { ...textStyle('B3', '700'), color: C.ink },
  timeEmpty: { ...textStyle('B3', '700'), color: C.muted },
  activityName: { ...textStyle('MB2', '700'), color: C.ink, flex: 1, minWidth: 0, height: 44 },
  activityRemove: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  activityBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    paddingLeft: 2,
    borderTopWidth: 1,
    borderTopColor: C.hairline,
  },
  activityPlace: { ...textStyles.B3, color: C.ink, flex: 1, minWidth: 0, height: 40 },
  addBtn: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.hairline,
    backgroundColor: C.white,
  },
  addText: { ...textStyle('MB2', '700'), color: C.ink },
  clearBtn: { alignSelf: 'center', minHeight: 44, paddingHorizontal: 12, justifyContent: 'center' },
  clearText: { ...textStyle('B3', '700'), color: C.muted },

  // Time sheet
  timeColumns: { flexDirection: 'row', gap: 12, height: 220 },
  timeColumn: { flex: 1 },
  timeCell: {
    height: HOUR_ROW_H,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeCellOn: { backgroundColor: C.cyanTint },
  timeCellText: { ...textStyles.MB1, color: C.ink },
  timeCellTextOn: { ...textStyle('MB1', '700'), color: C.ink },
  sheetFooter: { gap: 4 },
  sheetPrimary: {
    height: 56,
    borderRadius: 14,
    backgroundColor: C.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetPrimaryText: { ...textStyle('MB1', '700'), color: C.white },
  sheetSecondary: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  sheetSecondaryText: { ...textStyle('MB2', '700'), color: C.ink },
});
