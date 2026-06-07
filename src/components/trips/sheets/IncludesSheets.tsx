// =============================================================================
// IncludesSheets — bottom-sheet contents for the "What's included" categories
// that need more than a flat multi-select:
//   • ActivitiesSheetContent   — multi-select + a free-text note per pick
//   • SurfFilmSheetContent      — media multi-select + count + film-type multi
//   • VideoAnalysisSheetContent — included toggle + session count
//
// The flat categories (Meals, Accommodation, Transportation, Surf sessions,
// Surf equipment, Wellness) use TripTagPicker directly from the wizard.
// =============================================================================

import React, { useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Image,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  ACTIVITIES_OPTIONS,
  SURF_FILM_MEDIA_OPTIONS,
  SURF_FILM_TYPE_OPTIONS,
  WELLNESS_OPTIONS,
  normalizeWellness,
  type ActivityInclusion,
  type SurfFilmInclusion,
  type VideoAnalysisInclusion,
  type CustomInclusion,
  type WellnessInclusion,
  type WellnessPayment,
} from '../../../services/trips/priceInclusions';
import TripTagPicker from '../TripTagPicker';
import { Images } from '../../../assets/images';

const FONT_INTER = Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter';

const C = {
  accent: '#05BCD3',
  brandTeal: '#0788B0',
  brandTealText: '#066b8c',
  brandTealTint: '#E6F4F8',
  inkBody: '#222B30',
  textMuted: '#7B7B7B',
  textPlaceholder: '#B0B0B0',
  borderField: '#E0E0E0',
  surfaceCard: '#FFFFFF',
  checkboxOffBg: '#F7F7F7',
  checkboxOffBorder: '#CFCFCF',
};

// --- shared pill — same language as TripTagPicker (floating white card, cyan
// border when selected, circular cyan checkbox on the right). -----------------
const Pill: React.FC<{
  label: string;
  selected: boolean;
  onPress: () => void;
}> = ({ label, selected, onPress }) => (
  <TouchableOpacity
    activeOpacity={0.85}
    onPress={onPress}
    accessibilityRole="checkbox"
    accessibilityState={{ checked: selected }}
    accessibilityLabel={label}
    style={[styles.pill, selected && styles.pillSelected]}
  >
    <Text style={styles.pillLabel}>{label}</Text>
    <View style={[styles.checkbox, selected ? styles.checkboxOn : styles.checkboxOff]}>
      {selected ? <Ionicons name="checkmark" size={14} color="#FFFFFF" /> : null}
    </View>
  </TouchableOpacity>
);

const CountInput: React.FC<{
  label: string;
  value: number | null | undefined;
  onChange: (n: number | null) => void;
}> = ({ label, value, onChange }) => (
  <View style={styles.countRow}>
    <Text style={styles.countLabel}>{label}</Text>
    <TextInput
      style={styles.countInput}
      value={value != null ? String(value) : ''}
      onChangeText={t => {
        const cleaned = t.replace(/[^0-9]/g, '');
        onChange(cleaned ? parseInt(cleaned, 10) : null);
      }}
      keyboardType="number-pad"
      placeholder="-"
      placeholderTextColor={C.textPlaceholder}
      maxLength={3}
    />
  </View>
);

// Keyboard-free counter (− value +) — keeps sheets at content height with no
// keyboard shift. Empty/0 shows a dash.
const CountStepper: React.FC<{
  value: number | null | undefined;
  onChange: (n: number | null) => void;
}> = ({ value, onChange }) => {
  const n = value ?? 0;
  return (
    <View style={styles.stepper}>
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => onChange(n <= 1 ? null : n - 1)}
        disabled={n <= 0}
        accessibilityRole="button"
        accessibilityLabel="Decrease"
        style={[styles.stepBtn, n <= 0 && styles.stepBtnDisabled]}
      >
        <Ionicons name="remove" size={20} color={n <= 0 ? C.textPlaceholder : C.inkBody} />
      </TouchableOpacity>
      <Text style={styles.stepValue}>{n > 0 ? n : '–'}</Text>
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => onChange(Math.min(99, n + 1))}
        accessibilityRole="button"
        accessibilityLabel="Increase"
        style={styles.stepBtn}
      >
        <Ionicons name="add" size={20} color={C.inkBody} />
      </TouchableOpacity>
    </View>
  );
};

// =============================================================================
// Activities — each selected option carries its own note.
// =============================================================================
export const ActivitiesSheetContent: React.FC<{
  value: ActivityInclusion[];
  onChange: (next: ActivityInclusion[]) => void;
}> = ({ value, onChange }) => {
  const toggle = useCallback(
    (slug: string) => {
      const exists = value.some(a => a.key === slug);
      onChange(exists ? value.filter(a => a.key !== slug) : [...value, { key: slug, note: '' }]);
    },
    [value, onChange],
  );

  const setNote = useCallback(
    (slug: string, note: string) => {
      onChange(value.map(a => (a.key === slug ? { ...a, note } : a)));
    },
    [value, onChange],
  );

  return (
    <View style={styles.list}>
      {ACTIVITIES_OPTIONS.map(opt => {
        const sel = value.find(a => a.key === opt.slug);
        return (
          <View key={opt.slug}>
            <Pill label={opt.label} selected={!!sel} onPress={() => toggle(opt.slug)} />
            {sel ? (
              <TextInput
                style={styles.noteInput}
                value={sel.note ?? ''}
                onChangeText={t => setNote(opt.slug, t.slice(0, 200))}
                placeholder="Where to, how long, why - a quick note"
                placeholderTextColor={C.textPlaceholder}
                multiline
                maxLength={200}
                textAlignVertical="top"
              />
            ) : null}
          </View>
        );
      })}
    </View>
  );
};

// =============================================================================
// Wellness & recovery — each selected option opens a small "Included / Extra
// pay" toggle (defaults to Included).
// =============================================================================
const PaymentToggle: React.FC<{
  value: WellnessPayment;
  onChange: (next: WellnessPayment) => void;
}> = ({ value, onChange }) => (
  <View style={styles.payToggle}>
    {(['included', 'extra'] as const).map(opt => {
      const active = value === opt;
      return (
        <TouchableOpacity
          key={opt}
          activeOpacity={0.85}
          onPress={() => onChange(opt)}
          accessibilityRole="radio"
          accessibilityState={{ selected: active }}
          style={[styles.paySeg, active && styles.paySegActive]}
        >
          <Text style={[styles.paySegText, active && styles.paySegTextActive]}>
            {opt === 'included' ? 'Included' : 'Extra pay'}
          </Text>
        </TouchableOpacity>
      );
    })}
  </View>
);

export const WellnessSheetContent: React.FC<{
  value: WellnessInclusion[];
  onChange: (next: WellnessInclusion[]) => void;
}> = ({ value, onChange }) => {
  const items = normalizeWellness(value);
  const toggle = useCallback(
    (slug: string) => {
      const exists = items.some(w => w.key === slug);
      onChange(
        exists
          ? items.filter(w => w.key !== slug)
          : [...items, { key: slug, payment: 'included' }],
      );
    },
    [items, onChange],
  );
  const setPayment = useCallback(
    (slug: string, payment: WellnessPayment) => {
      onChange(items.map(w => (w.key === slug ? { ...w, payment } : w)));
    },
    [items, onChange],
  );

  return (
    <View style={styles.list}>
      {WELLNESS_OPTIONS.map(opt => {
        const sel = items.find(w => w.key === opt.slug);
        return (
          <View key={opt.slug}>
            <Pill label={opt.label} selected={!!sel} onPress={() => toggle(opt.slug)} />
            {sel ? (
              <PaymentToggle
                value={sel.payment}
                onChange={p => setPayment(opt.slug, p)}
              />
            ) : null}
          </View>
        );
      })}
    </View>
  );
};

// =============================================================================
// Surf film — media (video/photo) + count + film types.
// =============================================================================
export const SurfFilmSheetContent: React.FC<{
  value: SurfFilmInclusion;
  onChange: (next: SurfFilmInclusion) => void;
}> = ({ value, onChange }) => (
  <View style={{ gap: 24 }}>
    <View>
      <Text style={styles.sectionLabel}>Media</Text>
      <TripTagPicker<string>
        options={[...SURF_FILM_MEDIA_OPTIONS]}
        selected={value.media ?? []}
        onChange={next => onChange({ ...value, media: next })}
        accessibilityLabel="Surf film media"
      />
    </View>

    <View>
      <Text style={styles.sectionLabel}>How many filmed sessions?</Text>
      <CountStepper
        value={value.count}
        onChange={n => onChange({ ...value, count: n })}
      />
    </View>

    <View>
      <Text style={styles.sectionLabel}>Film types (optional)</Text>
      <TripTagPicker<string>
        options={[...SURF_FILM_TYPE_OPTIONS]}
        selected={value.filmTypes ?? []}
        onChange={next => onChange({ ...value, filmTypes: next })}
        accessibilityLabel="Surf film types"
      />
    </View>
  </View>
);

// =============================================================================
// Video analysis — included toggle + session count.
// =============================================================================
export const VideoAnalysisSheetContent: React.FC<{
  value: VideoAnalysisInclusion;
  onChange: (next: VideoAnalysisInclusion) => void;
}> = ({ value, onChange }) => (
  <View style={{ gap: 18 }}>
    <Pill
      label="Include video analysis sessions"
      selected={!!value.included}
      onPress={() => onChange({ ...value, included: !value.included })}
    />
    {value.included ? (
      <CountInput
        label="How many sessions? (optional)"
        value={value.count}
        onChange={n => onChange({ ...value, count: n })}
      />
    ) : null}
  </View>
);

// =============================================================================
// Custom "add your own" — a single title + description editor.
// =============================================================================
export const CustomInclusionSheetContent: React.FC<{
  value: CustomInclusion;
  onChange: (next: CustomInclusion) => void;
  onRemove?: () => void;
}> = ({ value, onChange, onRemove }) => {
  const titleRef = useRef<TextInput>(null);
  // Pop the keyboard on the Title field once the sheet has slid up.
  useEffect(() => {
    const t = setTimeout(() => titleRef.current?.focus(), 350);
    return () => clearTimeout(t);
  }, []);

  return (
  <View style={{ gap: 22 }}>
    <View style={styles.field}>
      <View style={styles.labelRow}>
        <Text style={styles.fieldLabel}>Title</Text>
        <Text style={styles.counter}>{value.title.length} / 60</Text>
      </View>
      <View style={styles.inputBox}>
        <Image source={Images.tripDeets.pencil} style={styles.leadIcon} resizeMode="contain" />
        <TextInput
          ref={titleRef}
          style={styles.inputText}
          value={value.title}
          onChangeText={t => onChange({ ...value, title: t.slice(0, 60) })}
          placeholder="e.g. Airport pickup"
          placeholderTextColor={C.textPlaceholder}
          maxLength={60}
        />
      </View>
    </View>

    <View style={styles.field}>
      <View style={styles.labelRow}>
        <Text style={styles.fieldLabel}>Description</Text>
        <Text style={styles.counter}>{(value.description ?? '').length} / 200</Text>
      </View>
      <View style={[styles.inputBox, styles.inputBoxTextarea]}>
        <Image
          source={Images.tripDeets.pencil}
          style={[styles.leadIcon, styles.leadIconTextarea]}
          resizeMode="contain"
        />
        <TextInput
          style={[styles.inputText, styles.inputTextArea]}
          value={value.description ?? ''}
          onChangeText={t => onChange({ ...value, description: t.slice(0, 200) })}
          placeholder="Details & examples - e.g. private car, up to 2 bags, hotel to airport"
          placeholderTextColor={C.textPlaceholder}
          multiline
          maxLength={200}
          textAlignVertical="top"
        />
      </View>
    </View>

    {onRemove ? (
      <TouchableOpacity
        onPress={onRemove}
        style={styles.removeBtn}
        accessibilityRole="button"
        accessibilityLabel="Remove this item"
      >
        <Ionicons name="trash-outline" size={18} color="#C0392B" />
        <Text style={styles.removeBtnText}>Remove</Text>
      </TouchableOpacity>
    ) : null}
  </View>
  );
};

const styles = StyleSheet.create({
  list: { gap: 12 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 64,
    paddingVertical: 20,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'transparent', // reserves space so the selected border adds no shift
    backgroundColor: C.surfaceCard,
    shadowColor: '#596E7C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 3,
  },
  pillSelected: {
    borderColor: C.accent,
  },
  pillLabel: {
    flex: 1,
    fontFamily: FONT_INTER,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '500',
    color: C.inkBody,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  checkboxOn: {
    backgroundColor: C.accent,
  },
  checkboxOff: {
    backgroundColor: C.checkboxOffBg,
    borderWidth: 1,
    borderColor: C.checkboxOffBorder,
  },
  noteInput: {
    marginTop: 8,
    marginBottom: 4,
    minHeight: 64,
    borderWidth: 1,
    borderColor: C.borderField,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontFamily: FONT_INTER,
    fontSize: 14,
    color: C.inkBody,
    backgroundColor: C.surfaceCard,
  },
  // Surf-film section header — matches the flow's bold section labels.
  sectionLabel: {
    fontFamily: FONT_INTER,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '700',
    color: C.inkBody,
    marginBottom: 12,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 20,
  },
  stepBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.borderField,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.surfaceCard,
  },
  stepBtnDisabled: {
    opacity: 0.5,
  },
  stepValue: {
    minWidth: 28,
    textAlign: 'center',
    fontFamily: FONT_INTER,
    fontSize: 18,
    fontWeight: '700',
    color: C.inkBody,
  },
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  countLabel: {
    flex: 1,
    fontFamily: FONT_INTER,
    fontSize: 15,
    fontWeight: '600',
    color: C.inkBody,
  },
  countInput: {
    width: 72,
    height: 48,
    borderWidth: 1,
    borderColor: C.borderField,
    borderRadius: 12,
    paddingHorizontal: 12,
    fontFamily: FONT_INTER,
    fontSize: 16,
    textAlign: 'center',
    color: C.inkBody,
    backgroundColor: C.surfaceCard,
  },
  // "Add your own" inputs — match the create-flow pencil-box fields.
  field: {
    gap: 8,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 4,
  },
  fieldLabel: {
    fontFamily: FONT_INTER,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '700',
    color: C.inkBody,
  },
  counter: {
    fontFamily: FONT_INTER,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '400',
    color: C.textMuted,
  },
  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 56,
    borderWidth: 1,
    borderColor: C.borderField,
    borderRadius: 12,
    paddingHorizontal: 16,
    backgroundColor: C.surfaceCard,
  },
  inputBoxTextarea: {
    alignItems: 'flex-start',
    minHeight: 118,
    paddingVertical: 14,
  },
  leadIcon: {
    width: 22,
    height: 22,
  },
  leadIconTextarea: {
    marginTop: 1,
  },
  inputText: {
    flex: 1,
    fontFamily: FONT_INTER,
    fontSize: 14,
    lineHeight: 18,
    color: C.inkBody,
    padding: 0,
  },
  inputTextArea: {
    minHeight: 84,
  },
  // Wellness "Included / Extra pay" segmented toggle (under a selected item).
  payToggle: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    marginTop: 8,
    marginBottom: 4,
    padding: 3,
    borderRadius: 12,
    backgroundColor: '#F2F2F2',
    gap: 3,
  },
  paySeg: {
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderRadius: 9,
  },
  paySegActive: {
    backgroundColor: C.surfaceCard,
    shadowColor: '#596E7C',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.18,
    shadowRadius: 3,
    elevation: 2,
  },
  paySegText: {
    fontFamily: FONT_INTER,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: C.textMuted,
  },
  paySegTextActive: {
    color: C.accent,
  },
  removeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
  },
  removeBtnText: {
    fontFamily: FONT_INTER,
    fontSize: 15,
    fontWeight: '600',
    color: '#C0392B',
  },
});
