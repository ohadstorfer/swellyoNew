// SpecificStaySheetContent — name + URL (auto-prefix + validate) + photo picker for the locked-stay step.
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Image,
  Platform,
  Alert,
  Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const FONT_INTER = Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter';

const C = {
  brandTealText: '#066b8c',
  inkBody: '#222B30',
  textMuted: '#7B7B7B',
  borderField: '#CFCFCF',
  borderDivider: '#E0E0E0',
  surfaceCard: '#FFFFFF',
  placeholderBg: '#F5FBFD',
  placeholderIcon: '#0788B0',
  errorText: '#C0392B',
  errorBorder: '#FF6B6B',
  success: '#34C759',
};

const NAME_MAX = 25;

export interface SpecificStaySheetContentProps {
  name: string;
  url: string;
  photoUri: string | null;
  onChange: (next: { name: string; url: string; photoUri: string | null }) => void;
  errors?: { name?: string; url?: string; photo?: string };
}

const looksLikeUrl = (v: string): boolean => {
  if (!v) return false;
  // Basic check — has at least one dot in the host portion, no whitespace.
  const trimmed = v.trim();
  if (/\s/.test(trimmed)) return false;
  // Strip scheme if present, then require at least one dot in the rest.
  const stripped = trimmed.replace(/^https?:\/\//i, '');
  return /\./.test(stripped) && stripped.length > 2;
};

const pickImage = async (): Promise<string | null> => {
  try {
    // expo-image-picker is loaded lazily so test/server envs don't choke on it.
    const ImagePicker = require('expo-image-picker');
    const usePhotoPicker =
      Platform.OS === 'android' && Number(Platform.Version) >= 33;
    if (!usePhotoPicker) {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permission Required',
          'We need photo library access to pick an image.',
        );
        return null;
      }
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.85,
    });
    if (!result.canceled && result.assets?.[0]) {
      return result.assets[0].uri as string;
    }
  } catch (e) {
    console.error('[SpecificStaySheetContent] pickImage error:', e);
  }
  return null;
};

export const SpecificStaySheetContent: React.FC<SpecificStaySheetContentProps> = ({
  name,
  url,
  photoUri,
  onChange,
  errors,
}) => {
  const [urlTouched, setUrlTouched] = useState(false);
  const nameRef = useRef<TextInput>(null);
  const urlRef = useRef<TextInput>(null);

  // Auto-focus Name on open so the keyboard appears immediately (300ms delay
  // matches AgeSheet — lets the sheet's slide-in animation settle first).
  useEffect(() => {
    const t = setTimeout(() => nameRef.current?.focus(), 300);
    return () => clearTimeout(t);
  }, []);

  const handleNameChange = (next: string) => {
    // Hard-cap at NAME_MAX to keep parent state in sync.
    const clipped = next.slice(0, NAME_MAX);
    onChange({ name: clipped, url, photoUri });
  };

  const handleUrlChange = (next: string) => {
    onChange({ name, url: next, photoUri });
  };

  const handleUrlBlur = () => {
    setUrlTouched(true);
    const trimmed = url.trim();
    if (!trimmed) return;
    if (!/^https?:\/\//i.test(trimmed)) {
      onChange({ name, url: `https://${trimmed}`, photoUri });
    } else if (trimmed !== url) {
      onChange({ name, url: trimmed, photoUri });
    }
  };

  const handlePickPhoto = async () => {
    const uri = await pickImage();
    if (uri) onChange({ name, url, photoUri: uri });
  };

  const urlValid = looksLikeUrl(url);
  const showUrlGood = urlTouched && url.length > 0 && urlValid;
  const showUrlBad = urlTouched && url.length > 0 && !urlValid;

  return (
    <View style={styles.container}>
      {/* Name */}
      <View style={styles.field}>
        <Text style={styles.label}>Name</Text>
        <View
          style={[
            styles.inputBox,
            errors?.name ? styles.inputBoxError : null,
          ]}
        >
          <TextInput
            ref={nameRef}
            value={name}
            onChangeText={handleNameChange}
            maxLength={NAME_MAX}
            placeholder="e.g. Casa del Mar"
            placeholderTextColor={C.textMuted}
            style={styles.input}
            accessibilityLabel="Accommodation name"
            returnKeyType="next"
            onSubmitEditing={() => urlRef.current?.focus()}
          />
        </View>
        <View style={styles.helperRow}>
          {errors?.name ? (
            <Text style={styles.error}>{errors.name}</Text>
          ) : (
            <View />
          )}
          <Text style={styles.counter}>
            {name.length}/{NAME_MAX}
          </Text>
        </View>
      </View>

      {/* URL */}
      <View style={styles.field}>
        <Text style={styles.label}>Link</Text>
        <View
          style={[
            styles.inputBox,
            (errors?.url || showUrlBad) ? styles.inputBoxError : null,
            showUrlGood ? styles.inputBoxValid : null,
          ]}
        >
          <TextInput
            ref={urlRef}
            value={url}
            onChangeText={handleUrlChange}
            onBlur={handleUrlBlur}
            placeholder="booking.com/..."
            placeholderTextColor={C.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            inputMode="url"
            style={styles.input}
            accessibilityLabel="Accommodation link"
            returnKeyType="done"
            onSubmitEditing={() => Keyboard.dismiss()}
          />
          {showUrlGood ? (
            <Ionicons
              name="checkmark-circle"
              size={22}
              color={C.success}
              style={styles.inputIcon}
            />
          ) : null}
          {showUrlBad ? (
            <Ionicons
              name="close-circle"
              size={22}
              color={C.errorText}
              style={styles.inputIcon}
            />
          ) : null}
        </View>
        {errors?.url ? (
          <Text style={styles.error}>{errors.url}</Text>
        ) : null}
      </View>

      {/* Photo */}
      <View style={styles.field}>
        <Text style={styles.label}>Photo</Text>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={handlePickPhoto}
          accessibilityRole="button"
          accessibilityLabel="Pick accommodation photo"
          style={[
            styles.photoBox,
            errors?.photo ? styles.photoBoxError : null,
            photoUri ? styles.photoBoxFilled : null,
          ]}
        >
          {photoUri ? (
            <Image
              source={{ uri: photoUri }}
              style={styles.photo}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.photoPlaceholder}>
              <View style={styles.photoIconBubble}>
                <Ionicons
                  name="image-outline"
                  size={26}
                  color={C.placeholderIcon}
                />
              </View>
              <Text style={styles.photoPlaceholderText}>Tap to pick a photo</Text>
              <Text style={styles.photoPlaceholderHint}>
                Any pic (from online) works
              </Text>
            </View>
          )}
        </TouchableOpacity>
        {errors?.photo ? (
          <Text style={styles.error}>{errors.photo}</Text>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: 16,
    paddingBottom: 8,
  },
  field: {
    gap: 4,
  },
  label: {
    fontFamily: FONT_INTER,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: C.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.borderField,
    borderRadius: 12,
    paddingHorizontal: 14,
    backgroundColor: C.surfaceCard,
    minHeight: 48,
  },
  inputBoxError: {
    borderColor: C.errorBorder,
  },
  inputBoxValid: {
    borderColor: C.success,
  },
  input: {
    flex: 1,
    fontFamily: FONT_INTER,
    fontSize: 16,
    lineHeight: 22,
    color: C.inkBody,
    padding: 0,
    paddingVertical: 10,
  },
  inputIcon: {
    marginLeft: 8,
  },
  helperRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  counter: {
    fontFamily: FONT_INTER,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '400',
    color: C.textMuted,
  },
  error: {
    marginTop: 4,
    fontFamily: FONT_INTER,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    color: C.errorText,
  },
  photoBox: {
    width: '100%',
    height: 140,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.borderField,
    borderStyle: 'dashed',
    backgroundColor: C.placeholderBg,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoBoxFilled: {
    borderStyle: 'solid',
    borderColor: C.borderDivider,
  },
  photoBoxError: {
    borderColor: C.errorBorder,
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  photoPlaceholder: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  photoIconBubble: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  photoPlaceholderText: {
    fontFamily: FONT_INTER,
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '600',
    color: C.brandTealText,
  },
  photoPlaceholderHint: {
    fontFamily: FONT_INTER,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '400',
    color: C.textMuted,
  },
});

export default SpecificStaySheetContent;
