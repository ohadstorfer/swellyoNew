/**
 * PhoneField — a phone number with a country dial-code picker (Figma
 * 17134:25620): flag + chevron, a hairline, the bold "+371", then the number.
 *
 * The value stays ONE string, "+371 21234567". That is what the column stores
 * and what the operator's "call" link dials, so nothing downstream changes.
 * A number saved before the picker existed has no "+" prefix; it is shown
 * as typed and gains the code the next time the traveler edits it.
 *
 * ⚠️ The picker sheet is rendered HERE, inside the field. When the field sits
 * in a bottom sheet that makes it a child of that sheet's Modal, which is the
 * only arrangement iOS survives — a sibling Modal strands a view controller
 * that eats every touch.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  StyleSheet,
  Platform,
  Keyboard,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheetShell } from '../BottomSheetShell';
import { textStyle, textStyles } from '../../theme/typography';
import { DIAL_COUNTRIES, flagEmoji, type DialCountry } from '../../data/dialCodes';

const BY_CC = new Map(DIAL_COUNTRIES.map(c => [c.cc, c]));

// Several countries share a code. When all we have is the number, these win.
const PREFERRED_FOR_DIAL: Record<string, string> = { '1': 'US', '7': 'RU', '44': 'GB' };

/** Longest dial code that prefixes `digits`, or null. */
function countryForDigits(digits: string): DialCountry | null {
  for (let len = Math.min(4, digits.length); len >= 1; len--) {
    const dial = digits.slice(0, len);
    const preferred = PREFERRED_FOR_DIAL[dial];
    const hit =
      (preferred && BY_CC.get(preferred)) || DIAL_COUNTRIES.find(c => c.dial === dial);
    if (hit) return hit;
  }
  return null;
}

/** The phone's own region — the most likely country for someone's contact. */
function deviceCountry(): DialCountry {
  try {
    // Native layer, not Intl: Hermes has no reliable region.
    const region = require('expo-localization').getLocales?.()[0]?.regionCode;
    const hit = region ? BY_CC.get(String(region).toUpperCase()) : undefined;
    if (hit) return hit;
  } catch {
    // Web / Expo Go without the module — fall through.
  }
  return BY_CC.get('US')!;
}

function splitValue(value: string, country: DialCountry): string {
  const v = value.trim();
  if (!v.startsWith('+')) return v;
  const digits = v.slice(1);
  return digits.startsWith(country.dial) ? digits.slice(country.dial.length).replace(/^\s+/, '') : digits;
}

export const PhoneField: React.FC<{
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  accessibilityLabel?: string;
}> = ({ value, onChangeText, placeholder = 'Phone number', maxLength = 40, accessibilityLabel }) => {
  const [country, setCountry] = useState<DialCountry>(() => {
    const v = value.trim();
    return (v.startsWith('+') && countryForDigits(v.slice(1).replace(/\D/g, ''))) || deviceCountry();
  });
  const [pickerOpen, setPickerOpen] = useState(false);

  // The form loads after mount. When a saved number arrives carrying another
  // country's code, follow it.
  useEffect(() => {
    const v = value.trim();
    if (!v.startsWith('+')) return;
    const digits = v.slice(1).replace(/\D/g, '');
    if (digits.startsWith(country.dial)) return;
    const next = countryForDigits(digits);
    if (next) setCountry(next);
    // Only a new value should move the country, not the country itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const national = splitValue(value, country);

  // An empty number stays an empty string, so "is there a phone?" checks keep
  // meaning "did they type one" rather than "is there a dial code".
  const emit = (c: DialCountry, number: string) => {
    const n = number.replace(/[^\d\s\-()]/g, '');
    onChangeText(n.trim() ? `+${c.dial} ${n}`.slice(0, maxLength) : '');
  };

  return (
    <View style={styles.field}>
      <Pressable
        onPress={() => {
          Keyboard.dismiss();
          setPickerOpen(true);
        }}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 4 }}
        style={({ pressed }) => [styles.country, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`Country code: ${country.name}, plus ${country.dial}`}
      >
        <Text style={styles.flag} allowFontScaling={false}>
          {flagEmoji(country.cc)}
        </Text>
        <Ionicons name="chevron-down" size={18} color="#333333" />
      </Pressable>
      <View style={styles.divider} />
      <Text style={styles.dial}>+{country.dial}</Text>
      <TextInput
        value={national}
        onChangeText={t => emit(country, t)}
        placeholder={placeholder}
        placeholderTextColor="#7B7B7B"
        keyboardType="phone-pad"
        autoComplete="tel"
        accessibilityLabel={accessibilityLabel ?? placeholder}
        style={styles.input}
      />

      <DialCodePicker
        visible={pickerOpen}
        selected={country.cc}
        onClose={() => setPickerOpen(false)}
        onSelect={c => {
          setCountry(c);
          emit(c, national);
          setPickerOpen(false);
        }}
      />
    </View>
  );
};

const ROW_HEIGHT = 52;

const DialCodePicker: React.FC<{
  visible: boolean;
  selected: string;
  onClose: () => void;
  onSelect: (c: DialCountry) => void;
}> = ({ visible, selected, onClose, onSelect }) => {
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (visible) setQuery('');
  }, [visible]);

  // Same shrink-above-the-keyboard as CountrySearchModal: the shell lifts the
  // sheet by the keyboard height, so a fixed-height sheet would push its search
  // box off the top of the screen.
  useEffect(() => {
    if (!visible) {
      setKeyboardHeight(0);
      return;
    }
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvt, e =>
      setKeyboardHeight(e?.endCoordinates?.height ?? 0),
    );
    const hideSub = Keyboard.addListener(hideEvt, () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [visible]);

  const full = Math.round(screenH * 0.8);
  const sheetHeight =
    keyboardHeight > 0 ? Math.min(full, screenH - keyboardHeight - insets.top - 12) : full;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^\+/, '');
    if (!q) return DIAL_COUNTRIES;
    return DIAL_COUNTRIES.filter(
      c => c.name.toLowerCase().includes(q) || c.dial.startsWith(q) || c.cc.toLowerCase() === q,
    );
  }, [query]);

  return (
    <BottomSheetShell visible={visible} onClose={onClose} avoidKeyboard>
      {({ panHandlers }) => (
        <View
          style={[
            styles.sheet,
            { height: sheetHeight, paddingBottom: Math.max(insets.bottom, 16) },
          ]}
        >
          <View {...panHandlers} style={styles.sheetHead}>
            <View style={styles.grabber} />
            <Text style={styles.sheetTitle}>Country code</Text>
          </View>

          {/* Not auto-focused: raising the keyboard while a nested sheet is
              still presenting closes it again on iOS (see CountrySearchModal). */}
          <View style={styles.searchWrap}>
            <Ionicons name="search" size={18} color="#A0A0A0" />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search country or code"
              placeholderTextColor="#A0A0A0"
              autoCorrect={false}
              autoCapitalize="none"
              style={styles.searchInput}
            />
          </View>

          <FlatList
            data={rows}
            keyExtractor={c => c.cc}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            initialNumToRender={14}
            getItemLayout={(_, i) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * i, index: i })}
            ListEmptyComponent={<Text style={styles.empty}>No countries found</Text>}
            renderItem={({ item }) => {
              const on = item.cc === selected;
              return (
                <Pressable
                  onPress={() => onSelect(item)}
                  style={({ pressed }) => [styles.row, (on || pressed) && styles.rowOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${item.name}, plus ${item.dial}`}
                >
                  <Text style={styles.flag} allowFontScaling={false}>
                    {flagEmoji(item.cc)}
                  </Text>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.rowDial}>+{item.dial}</Text>
                </Pressable>
              );
            }}
          />
        </View>
      )}
    </BottomSheetShell>
  );
};

const styles = StyleSheet.create({
  // Same box as the form's other inputs: 56 tall, radius 12, Stroke/M 03.
  field: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CFCFCF',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  country: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  pressed: { opacity: 0.6 },
  flag: { fontSize: 18, lineHeight: 22 },
  divider: { width: 1, alignSelf: 'stretch', backgroundColor: '#D5D7DA' },
  // Bold over Size/md 14 — the export's 18 is the desktop mode.
  dial: { ...textStyle('MB2', '700'), color: '#333333' },
  input: {
    flex: 1,
    alignSelf: 'stretch',
    padding: 0,
    ...textStyles.MB2,
    // A fixed line height clips the caret and shifts the text on iOS inputs.
    lineHeight: undefined,
    color: '#333333',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  sheetHead: { alignItems: 'center', paddingTop: 10, paddingBottom: 12, gap: 10 },
  grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#E4E4E4' },
  sheetTitle: { ...textStyle('MB1', '700'), color: '#333333' },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 48,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 16,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: '#D5D7DA',
  },
  searchInput: {
    flex: 1,
    padding: 0,
    ...textStyles.MB2,
    lineHeight: undefined,
    color: '#333333',
  },
  row: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
  },
  rowOn: { backgroundColor: '#F7F7F7' },
  rowName: { flex: 1, ...textStyles.MB2, color: '#333333' },
  rowDial: { ...textStyles.MB2, color: '#7B7B7B' },
  empty: { ...textStyles.MB2, color: '#7B7B7B', textAlign: 'center', padding: 24 },
});
