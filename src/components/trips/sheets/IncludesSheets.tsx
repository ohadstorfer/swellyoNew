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

import React, { useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  ACTIVITIES_OPTIONS,
  SURF_FILM_MEDIA_OPTIONS,
  SURF_FILM_TYPE_OPTIONS,
  type ActivityInclusion,
  type SurfFilmInclusion,
  type VideoAnalysisInclusion,
  type CustomInclusion,
  type IncludeOption,
} from '../../../services/trips/priceInclusions';

const FONT_INTER = Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter';

const C = {
  brandTeal: '#0788B0',
  brandTealText: '#066b8c',
  brandTealTint: '#E6F4F8',
  inkBody: '#222B30',
  textMuted: '#7B7B7B',
  textPlaceholder: '#B0B0B0',
  borderField: '#E0E0E0',
  surfaceCard: '#FFFFFF',
};

// --- shared pill -------------------------------------------------------------
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
    style={[
      styles.pill,
      {
        borderColor: selected ? C.brandTeal : C.borderField,
        backgroundColor: selected ? C.brandTealTint : C.surfaceCard,
      },
    ]}
  >
    <Text style={[styles.pillLabel, { color: selected ? C.brandTealText : C.inkBody }]}>
      {label}
    </Text>
    {selected ? (
      <Ionicons name="checkmark-circle" size={20} color={C.brandTeal} style={{ marginLeft: 8 }} />
    ) : null}
  </TouchableOpacity>
);

const toggleSlug = (arr: string[] | undefined, slug: string): string[] => {
  const cur = arr ?? [];
  return cur.includes(slug) ? cur.filter(s => s !== slug) : [...cur, slug];
};

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
      placeholder="—"
      placeholderTextColor={C.textPlaceholder}
      maxLength={3}
    />
  </View>
);

const SubLabel: React.FC<{ children: string }> = ({ children }) => (
  <Text style={styles.subLabel}>{children}</Text>
);

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
                placeholder="Where to, how long, why — a quick note"
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
// Surf film — media (video/photo) + count + film types.
// =============================================================================
export const SurfFilmSheetContent: React.FC<{
  value: SurfFilmInclusion;
  onChange: (next: SurfFilmInclusion) => void;
}> = ({ value, onChange }) => {
  const renderPills = (
    options: readonly IncludeOption[],
    selected: string[] | undefined,
    key: 'media' | 'filmTypes',
  ) => (
    <View style={styles.list}>
      {options.map(opt => (
        <Pill
          key={opt.slug}
          label={opt.label}
          selected={(selected ?? []).includes(opt.slug)}
          onPress={() => onChange({ ...value, [key]: toggleSlug(selected, opt.slug) })}
        />
      ))}
    </View>
  );

  return (
    <View style={{ gap: 18 }}>
      <View>
        <SubLabel>Media</SubLabel>
        {renderPills(SURF_FILM_MEDIA_OPTIONS, value.media, 'media')}
      </View>

      <CountInput
        label="How many filmed sessions?"
        value={value.count}
        onChange={n => onChange({ ...value, count: n })}
      />

      <View>
        <SubLabel>Film types (optional)</SubLabel>
        {renderPills(SURF_FILM_TYPE_OPTIONS, value.filmTypes, 'filmTypes')}
      </View>
    </View>
  );
};

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
}> = ({ value, onChange, onRemove }) => (
  <View style={{ gap: 16 }}>
    <View>
      <SubLabel>Title</SubLabel>
      <TextInput
        style={styles.titleInput}
        value={value.title}
        onChangeText={t => onChange({ ...value, title: t.slice(0, 60) })}
        placeholder="e.g. Airport pickup"
        placeholderTextColor={C.textPlaceholder}
        maxLength={60}
      />
    </View>
    <View>
      <SubLabel>Description</SubLabel>
      <TextInput
        style={styles.noteInput}
        value={value.description ?? ''}
        onChangeText={t => onChange({ ...value, description: t.slice(0, 200) })}
        placeholder="Details & examples — e.g. private car, up to 2 bags, hotel to airport"
        placeholderTextColor={C.textPlaceholder}
        multiline
        maxLength={200}
        textAlignVertical="top"
      />
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

const styles = StyleSheet.create({
  list: { gap: 8 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderRadius: 12,
  },
  pillLabel: {
    flex: 1,
    fontFamily: FONT_INTER,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
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
  subLabel: {
    fontFamily: FONT_INTER,
    fontSize: 13,
    fontWeight: '700',
    color: C.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 8,
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
  titleInput: {
    height: 52,
    borderWidth: 1,
    borderColor: C.borderField,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontFamily: FONT_INTER,
    fontSize: 16,
    color: C.inkBody,
    backgroundColor: C.surfaceCard,
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
