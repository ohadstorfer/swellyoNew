// SpecificStaySheetContent — name + URL (auto-prefix) + photo picker for the locked-stay step.
// Styled to the Figma "Stay details" bottom sheet (node 12509:17052): bold dark
// labels, inline char counter, pencil-prefixed fields, dashed cover-photo box.
import React, { useEffect, useRef } from 'react';
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
import { Images } from '../../../assets/images';

const FONT_INTER = Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter';

const C = {
  accent: '#05BCD3', // text/m-accent — teal link text
  ink: '#333333', // text/m-01 — bold labels + typed text
  textMuted: '#7B7B7B', // text/m-02 — placeholder, counter, icons
  borderField: '#EEEEEE', // stroke/m-04 — input border
  borderDashed: '#CFCFCF', // stroke/m-03 — photo dashed border
  borderDivider: '#EEEEEE',
  surfaceCard: '#FFFFFF',
  errorText: '#C0392B',
  errorBorder: '#FF6B6B',
};

const NAME_MAX = 18;

export interface SpecificStaySheetContentProps {
  name: string;
  url: string;
  photoUri: string | null;
  onChange: (next: { name: string; url: string; photoUri: string | null }) => void;
  errors?: { name?: string; url?: string; photo?: string };
}

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
    const trimmed = url.trim();
    if (!trimmed) return;
    if (!/^https?:\/\//i.test(trimmed)) {
      onChange({ name, url: `https://${trimmed}`, photoUri });
    } else if (trimmed !== url) {
      onChange({ name, url: trimmed, photoUri });
    }
  };

  const handlePickPhoto = async () => {
    // Drop the keyboard before the picker opens so the sheet isn't left
    // scrolled up behind a keyboard once a photo comes back.
    Keyboard.dismiss();
    const uri = await pickImage();
    if (uri) onChange({ name, url, photoUri: uri });
  };

  return (
    <View style={styles.container}>
      {/* Name — divider above separates it from the sheet title */}
      <View style={[styles.field, styles.fieldDivided]}>
        <View style={styles.labelRow}>
          <Text style={styles.label}>Name</Text>
          <Text style={styles.counter}>
            {name.length} /{NAME_MAX}
          </Text>
        </View>
        <View
          style={[
            styles.inputBox,
            errors?.name ? styles.inputBoxError : null,
          ]}
        >
          <Image
            source={Images.tripDeets.pencil}
            style={styles.leadIcon}
            resizeMode="contain"
          />
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
        {errors?.name ? <Text style={styles.error}>{errors.name}</Text> : null}
      </View>

      {/* Link */}
      <View style={styles.field}>
        <View style={styles.labelRow}>
          <Text style={styles.label}>Link</Text>
        </View>
        <View
          style={[
            styles.inputBox,
            errors?.url ? styles.inputBoxError : null,
          ]}
        >
          <Image
            source={Images.tripDeets.pencil}
            style={styles.leadIcon}
            resizeMode="contain"
          />
          <TextInput
            ref={urlRef}
            value={url}
            onChangeText={handleUrlChange}
            onBlur={handleUrlBlur}
            placeholder="Booking.com"
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
        </View>
        {errors?.url ? <Text style={styles.error}>{errors.url}</Text> : null}
      </View>

      {/* Photo */}
      <View style={styles.field}>
        <Text style={styles.photoLabel}>Photo</Text>
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
            <>
              <Image
                source={{ uri: photoUri }}
                style={styles.photo}
                resizeMode="cover"
              />
              <View style={styles.changeOverlay}>
                <Ionicons name="camera" size={14} color="#FFFFFF" />
                <Text style={styles.changeOverlayText}>Change photo</Text>
              </View>
            </>
          ) : (
            <View style={styles.photoPlaceholder}>
              <Ionicons name="image-outline" size={34} color={C.textMuted} />
              <Text style={styles.photoPlaceholderText}>
                Tap to add cover photo
              </Text>
            </View>
          )}
        </TouchableOpacity>
        {errors?.photo ? <Text style={styles.error}>{errors.photo}</Text> : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: 24,
    paddingBottom: 8,
  },
  field: {
    gap: 8,
  },
  fieldDivided: {
    marginTop: -14,
    borderTopWidth: 1,
    borderTopColor: C.borderDivider,
    paddingTop: 28,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 4,
  },
  label: {
    fontFamily: FONT_INTER,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '700',
    color: C.ink,
  },
  photoLabel: {
    fontFamily: FONT_INTER,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '700',
    color: C.ink,
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
    height: 56,
    borderWidth: 1,
    borderColor: C.borderField,
    borderRadius: 12,
    paddingHorizontal: 16,
    backgroundColor: C.surfaceCard,
  },
  inputBoxError: {
    borderColor: C.errorBorder,
  },
  leadIcon: {
    width: 22,
    height: 22,
  },
  input: {
    flex: 1,
    fontFamily: FONT_INTER,
    fontSize: 14,
    lineHeight: 18,
    color: C.ink,
    padding: 0,
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
    height: 148,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.borderDashed,
    borderStyle: 'dashed',
    backgroundColor: C.surfaceCard,
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
  changeOverlay: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  changeOverlayText: {
    fontFamily: FONT_INTER,
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  photoPlaceholder: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  photoPlaceholderText: {
    fontFamily: FONT_INTER,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '400',
    color: C.accent,
  },
});

export default SpecificStaySheetContent;
