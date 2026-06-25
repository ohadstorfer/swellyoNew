// Host-only inline edit sheets for the trip Overview (Figma "admin view").
// Each sheet edits exactly one field with a focused, keyboard-aware UX:
//   • EditTextSheet  — multiline text (trip description, host self-intro).
//   • EditCoverSheet — the trip cover photo (pick → preview → save).
//
// All three are opened from the "Edit" pills in TripDetailViewRedesigned and
// persist via the parent's onSave handler (which calls updateGroupTrip).
// Built on WizardBottomSheet so they inherit the drag-to-dismiss + keyboard
// anchoring used across the create-trip wizard.

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Image,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { WizardBottomSheet } from './WizardBottomSheet';
import { WhenSheetContent } from './sheets/WhenSheetContent';
import { StayTypeSheetContent, type AccommodationKind } from './sheets/StayTypeSheetContent';
import { SpecificStaySheetContent } from './sheets/SpecificStaySheetContent';
import { Images } from '../../assets/images';

// Compact date helpers (mirror CreateTripFlowA — kept inline to avoid importing
// from the wizard screen).
const toISODate = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseISODate = (s: string | null): Date | null => {
  if (!s) return null;
  const d = new Date(`${s}T00:00:00`);
  return isNaN(d.getTime()) ? null : d;
};
// First day of a 'YYYY-MM' month, or null.
const monthStart = (ym: string): Date | null => {
  if (!ym) return null;
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return null;
  return new Date(y, m - 1, 1);
};
// Last day of a 'YYYY-MM' month (day 0 of the next month), or null.
const monthEnd = (ym: string): Date | null => {
  if (!ym) return null;
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return null;
  return new Date(y, m, 0);
};
const startOfToday = (): Date => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const expandMonthRange = (from: string, to: string, cap = 6): string[] => {
  if (!from) return to ? [to] : [];
  if (!to || to === from) return [from];
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  let start = fy * 12 + (fm - 1);
  let end = ty * 12 + (tm - 1);
  if (end < start) [start, end] = [end, start];
  const out: string[] = [];
  for (let i = start; i <= end && out.length < cap; i++) {
    out.push(`${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`);
  }
  return out;
};

const FONT_INTER = Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter';
const FONT_MONTSERRAT = Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat';

const C = {
  accent: '#0788B0',
  ink: '#333333',
  textMuted: '#7B7B7B',
  textFaint: '#A0A0A0',
  border: '#E1E1E1',
  surfaceMuted: '#F7F7F7',
  white: '#FFFFFF',
  danger: '#C0392B',
};

// Shared image picker (mirrors CreateTripFlowA — kept inline to avoid coupling
// to the wizard screen). Returns a local file URI, or null on cancel/deny.
const pickImageUri = async (aspect: [number, number] = [12, 5]): Promise<string | null> => {
  try {
    const ImagePicker = require('expo-image-picker');
    const usePhotoPicker = Platform.OS === 'android' && Platform.Version >= 33;
    if (!usePhotoPicker) {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'We need photo library access to pick an image.');
        return null;
      }
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect,
      quality: 0.85,
    });
    if (!result.canceled && result.assets?.[0]) {
      return result.assets[0].uri as string;
    }
  } catch (e) {
    console.error('[TripEditSheets] pickImage error:', e);
  }
  return null;
};

// ---------------------------------------------------------------------------
const SaveButton: React.FC<{ onPress: () => void; loading?: boolean; disabled?: boolean; label?: string }> = ({
  onPress,
  loading,
  disabled,
  label = 'Save',
}) => (
  <TouchableOpacity
    style={[styles.saveBtn, (disabled || loading) && styles.saveBtnDisabled]}
    onPress={onPress}
    disabled={disabled || loading}
    activeOpacity={0.85}
    accessibilityRole="button"
    accessibilityLabel={label}
  >
    {loading ? (
      <ActivityIndicator color={C.white} />
    ) : (
      <Text style={styles.saveBtnText}>{label}</Text>
    )}
  </TouchableOpacity>
);

// ---------------------------------------------------------------------------
// EditTextSheet — one multiline text field with optional char counter.
// ---------------------------------------------------------------------------
export interface EditTextSheetProps {
  visible: boolean;
  title: string;
  subtitle?: string;
  label: string;
  initialValue: string;
  placeholder?: string;
  maxLength?: number;
  /** Approx. visible rows (sets minHeight). Default 6. */
  rows?: number;
  onClose: () => void;
  /** Persist the trimmed value. May be async; the Save button shows a spinner. */
  onSave: (value: string) => void | Promise<void>;
}

export const EditTextSheet: React.FC<EditTextSheetProps> = ({
  visible,
  title,
  subtitle,
  label,
  initialValue,
  placeholder,
  maxLength,
  rows = 6,
  onClose,
  onSave,
}) => {
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);

  // Reset the draft each time the sheet opens so a cancelled edit doesn't leak
  // into the next open.
  useEffect(() => {
    if (visible) setValue(initialValue);
  }, [visible, initialValue]);

  const handleSave = async () => {
    const next = value.trim();
    setSaving(true);
    try {
      await onSave(next);
      onClose();
    } catch {
      // onSave surfaces its own error alert; keep the sheet open to retry.
    } finally {
      setSaving(false);
    }
  };

  const dirty = value.trim() !== initialValue.trim();

  return (
    <WizardBottomSheet
      visible={visible}
      title={title}
      subtitle={subtitle}
      largeTitle
      titleAlign="left"
      hideHeaderDivider
      onClose={onClose}
      heightMode="auto"
      extendBehindKeyboard
      footer={<SaveButton onPress={handleSave} loading={saving} disabled={!dirty} />}
    >
      <View style={styles.fieldLabelRow}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {maxLength ? (
          <Text
            style={[
              styles.counter,
              { color: value.length >= maxLength ? C.danger : C.textMuted },
            ]}
          >
            {value.length}/{maxLength}
          </Text>
        ) : null}
      </View>
      <View style={[styles.inputWrap, styles.inputWrapTextarea]}>
        <Image source={Images.tripDeets.pencil} style={styles.inputPencil} resizeMode="contain" />
        <TextInput
          style={[styles.inputField, { minHeight: rows * 22 }]}
          value={value}
          onChangeText={t => setValue(maxLength ? t.slice(0, maxLength) : t)}
          placeholder={placeholder}
          placeholderTextColor={C.textFaint}
          multiline
          maxLength={maxLength}
          textAlignVertical="top"
          autoFocus
        />
      </View>
    </WizardBottomSheet>
  );
};

// ---------------------------------------------------------------------------
// EditCoverSheet — pick a new cover photo, preview, then save.
// ---------------------------------------------------------------------------
export interface EditCoverSheetProps {
  visible: boolean;
  currentUri: string | null;
  onClose: () => void;
  /** Receives the picked LOCAL uri to upload + persist. May be async. */
  onSave: (localUri: string) => void | Promise<void>;
}

export const EditCoverSheet: React.FC<EditCoverSheetProps> = ({
  visible,
  currentUri,
  onClose,
  onSave,
}) => {
  const [pickedUri, setPickedUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) setPickedUri(null);
  }, [visible]);

  const previewUri = pickedUri ?? currentUri;

  const handlePick = async () => {
    const uri = await pickImageUri([12, 5]);
    if (uri) setPickedUri(uri);
  };

  const handleSave = async () => {
    if (!pickedUri) return;
    setSaving(true);
    try {
      await onSave(pickedUri);
      onClose();
    } catch {
      // parent alerts; keep open to retry
    } finally {
      setSaving(false);
    }
  };

  return (
    <WizardBottomSheet
      visible={visible}
      title="Edit cover"
      subtitle="This photo shows at the top of your trip."
      largeTitle
      titleAlign="left"
      hideHeaderDivider
      onClose={onClose}
      heightMode="auto"
      footer={<SaveButton onPress={handleSave} loading={saving} disabled={!pickedUri} />}
    >
      <TouchableOpacity
        style={styles.coverPreviewWrap}
        onPress={handlePick}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={previewUri ? 'Change cover photo' : 'Add cover photo'}
      >
        {previewUri ? (
          <Image source={{ uri: previewUri }} style={styles.coverPreview} resizeMode="cover" />
        ) : (
          <View style={[styles.coverPreview, styles.coverPreviewEmpty]}>
            <Ionicons name="image-outline" size={36} color={C.textFaint} />
            <Text style={styles.coverEmptyText}>No cover yet</Text>
          </View>
        )}
        <View style={styles.coverOverlayPill}>
          <Ionicons name="camera-outline" size={16} color={C.white} />
          <Text style={styles.coverOverlayText}>
            {previewUri ? 'Change photo' : 'Choose photo'}
          </Text>
        </View>
      </TouchableOpacity>
    </WizardBottomSheet>
  );
};

// ---------------------------------------------------------------------------
// EditDatesSheet — set/adjust the trip dates (reuses the create-flow picker:
// Calendar/Months toggle + duration). Shown to the host on A/B trips that don't
// have exact dates yet.
// ---------------------------------------------------------------------------
export interface DatesInitial {
  datesMode: 'months' | 'exact';
  startDateISO: string | null;
  endDateISO: string | null;
  monthFrom: string;
  monthTo: string;
  durationDays: number | null;
}

/** The trip-field patch produced by the dates sheet. */
export interface DatesPatch {
  start_date: string | null;
  end_date: string | null;
  dates_set_in_stone: boolean;
  date_months: string[] | null;
  duration_days: number | null;
}

export interface EditDatesSheetProps {
  visible: boolean;
  initial: DatesInitial;
  lockCalendar?: boolean;
  onClose: () => void;
  onSave: (patch: DatesPatch) => void | Promise<void>;
}

export const EditDatesSheet: React.FC<EditDatesSheetProps> = ({
  visible,
  initial,
  onClose,
  onSave,
}) => {
  const [startDate, setStartDate] = useState<Date | null>(parseISODate(initial.startDateISO));
  const [endDate, setEndDate] = useState<Date | null>(parseISODate(initial.endDateISO));
  const [saving, setSaving] = useState(false);

  // The loose months chosen at trip creation are fixed here — they can't be
  // changed, only narrowed to exact dates inside them.
  const monthFrom = initial.monthFrom;
  const monthTo = initial.monthTo || initial.monthFrom;

  useEffect(() => {
    if (visible) {
      setStartDate(parseISODate(initial.startDateISO));
      setEndDate(parseISODate(initial.endDateISO));
    }
  }, [visible, initial]);

  // Calendar bounds = the loose window. Never let the start fall before today.
  const looseStart = monthStart(monthFrom);
  const today = startOfToday();
  const minDate = looseStart ? (looseStart.getTime() < today.getTime() ? today : looseStart) : undefined;
  const maxDate = monthEnd(monthTo) ?? undefined;

  // Length window: the picked range must stay within ±DURATION_TOLERANCE days of
  // the trip length chosen at creation (e.g. 14 days → 9–19 days).
  const DURATION_TOLERANCE = 5;
  const baseLen = initial.durationDays ?? null;
  const minRangeDays = baseLen ? Math.max(1, baseLen - DURATION_TOLERANCE) : undefined;
  const maxRangeDays = baseLen ? baseLen + DURATION_TOLERANCE : undefined;

  // Need a full range; if a length window applies, the picked length must fit it.
  const pickedLen =
    startDate && endDate
      ? Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1
      : null;
  const valid =
    !!startDate &&
    !!endDate &&
    (minRangeDays == null || (pickedLen != null && pickedLen >= minRangeDays)) &&
    (maxRangeDays == null || (pickedLen != null && pickedLen <= maxRangeDays));

  const handleSave = async () => {
    if (!valid) return;
    const duration =
      startDate && endDate
        ? Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1
        : initial.durationDays;
    // Keep the loose window on the record so the constraint persists if re-opened.
    const dateMonths = expandMonthRange(monthFrom, monthTo);
    const patch: DatesPatch = {
      start_date: startDate ? toISODate(startDate) : null,
      end_date: endDate ? toISODate(endDate) : null,
      dates_set_in_stone: true,
      date_months: dateMonths.length ? dateMonths : null,
      duration_days: duration,
    };
    setSaving(true);
    try {
      await onSave(patch);
      onClose();
    } catch {
      // parent surfaces its own error; keep open to retry
    } finally {
      setSaving(false);
    }
  };

  return (
    <WizardBottomSheet
      visible={visible}
      title="Set trip dates"
      subtitle={
        minRangeDays && maxRangeDays
          ? `Pick ${minRangeDays}-${maxRangeDays} days inside the months you chose.`
          : 'Pick exact dates inside the months you chose.'
      }
      largeTitle
      titleAlign="left"
      hideHeaderDivider
      onClose={onClose}
      heightMode="full"
      footer={<SaveButton onPress={handleSave} loading={saving} disabled={!valid} label="Set dates" />}
    >
      <WhenSheetContent
        // Calendar-only: the loose months are locked, you can only narrow to
        // exact dates within them.
        mode="calendar"
        onModeChange={() => {}}
        startDate={startDate}
        endDate={endDate}
        onCalendarChange={({ startDate: s, endDate: e }) => {
          setStartDate(s);
          setEndDate(e);
        }}
        monthFrom={monthFrom}
        monthTo={monthTo}
        onMonthsChange={() => {}}
        durationDays={initial.durationDays}
        onDurationChange={() => {}}
        lockCalendar
        minDate={minDate}
        maxDate={maxDate}
        minRangeDays={minRangeDays}
        maxRangeDays={maxRangeDays}
      />
    </WizardBottomSheet>
  );
};

// ---------------------------------------------------------------------------
// EditAccommodationSheet — set the stay type + specific stay (name / link /
// photo). Shown to the host on A/B trips that don't have a specific stay yet.
// ---------------------------------------------------------------------------
export interface AccommodationInitial {
  kind: AccommodationKind | null;
  name: string;
  url: string;
  photoUri: string | null;
}

export interface EditAccommodationSheetProps {
  visible: boolean;
  initial: AccommodationInitial;
  onClose: () => void;
  /** Receives the chosen values. photoUri may be a freshly-picked LOCAL uri (the
   *  parent uploads it) or the existing remote url (left as-is). */
  onSave: (next: AccommodationInitial) => void | Promise<void>;
  /** When true, hide the stay-type picker and only edit the specific place
   *  (name / link / photo). The type stays whatever was set at creation. */
  specificOnly?: boolean;
}

export const EditAccommodationSheet: React.FC<EditAccommodationSheetProps> = ({
  visible,
  initial,
  onClose,
  onSave,
  specificOnly = false,
}) => {
  const [kind, setKind] = useState<AccommodationKind | null>(initial.kind);
  const [name, setName] = useState(initial.name);
  const [url, setUrl] = useState(initial.url);
  const [photoUri, setPhotoUri] = useState<string | null>(initial.photoUri);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setKind(initial.kind);
      setName(initial.name);
      setUrl(initial.url);
      setPhotoUri(initial.photoUri);
    }
  }, [visible, initial]);

  const valid = (specificOnly || !!kind) && name.trim().length > 0;

  const handleSave = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      await onSave({ kind, name: name.trim(), url: url.trim(), photoUri });
      onClose();
    } catch {
      // parent surfaces its own error; keep open to retry
    } finally {
      setSaving(false);
    }
  };

  return (
    <WizardBottomSheet
      visible={visible}
      title={specificOnly ? 'Stay details' : 'Accommodation'}
      subtitle={specificOnly ? undefined : 'Pick the stay type and add the specific place.'}
      largeTitle
      titleAlign="left"
      hideHeaderDivider
      onClose={onClose}
      heightMode="full"
      extendBehindKeyboard
      footer={<SaveButton onPress={handleSave} loading={saving} disabled={!valid} />}
    >
      {!specificOnly && (
        <>
          <StayTypeSheetContent selected={kind} onChange={setKind} />
          <View style={{ height: 20 }} />
        </>
      )}
      <SpecificStaySheetContent
        name={name}
        url={url}
        photoUri={photoUri}
        onChange={next => {
          setName(next.name);
          setUrl(next.url);
          setPhotoUri(next.photoUri);
        }}
      />
    </WizardBottomSheet>
  );
};

const styles = StyleSheet.create({
  // Footer button — mirrors the create-trip "Select" footer button exactly
  // (CreateTripFlowA localStyles.sheetSelectBtn): dark pill, 62 tall, radius 16,
  // 28px side margins, Montserrat 16/600.
  saveBtn: {
    backgroundColor: '#212121',
    height: 62,
    borderRadius: 16,
    marginHorizontal: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnDisabled: {
    opacity: 0.4,
  },
  saveBtnText: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '600',
    color: C.white,
  },

  // Text field — mirrors the create-trip Description field.
  fieldLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  fieldLabel: {
    fontFamily: FONT_INTER,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '700',
    color: '#222B30',
  },
  counter: {
    fontFamily: FONT_INTER,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#EEEEEE',
    borderRadius: 12,
    paddingHorizontal: 16,
    backgroundColor: C.white,
  },
  inputWrapTextarea: {
    alignItems: 'flex-start',
    paddingVertical: 16,
  },
  inputPencil: {
    width: 22,
    height: 22,
  },
  inputField: {
    flex: 1,
    fontFamily: FONT_INTER,
    fontSize: 16,
    lineHeight: 22,
    color: '#222B30',
    textAlignVertical: 'top',
  },

  // Cover preview
  coverPreviewWrap: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: C.surfaceMuted,
  },
  coverPreview: {
    width: '100%',
    aspectRatio: 12 / 5,
  },
  coverPreviewEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  coverEmptyText: {
    fontFamily: FONT_INTER,
    fontSize: 13,
    color: C.textFaint,
  },
  coverOverlayPill: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  coverOverlayText: {
    fontFamily: FONT_INTER,
    fontSize: 13,
    fontWeight: '600',
    color: C.white,
  },
});
