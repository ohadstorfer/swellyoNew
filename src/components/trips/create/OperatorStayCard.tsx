// OperatorStayCard — the "Where will your guests be staying?" block of the
// operator (Flow C) Trip Vibe step. Figma 17317:28362.
//
// Name, link and photo sit inline on the step (no bottom sheet, no Yes/No
// gate), followed by the two certification questions. Controlled: the wizard
// owns every value so they ride in the draft like any other answer.
//
// Text sizes come from get_variable_defs on each node, not from the export —
// the export prints desktop sizes.
import React, { useRef } from 'react';
import {
  Alert,
  Image,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Images } from '../../../assets/images';
import { textStyle, textStyles } from '../../../theme/typography';

const C = {
  accent: '#05BCD3', // text/m-accent
  ink: '#333333', // text/m-01
  muted: '#7B7B7B', // text/m-02
  hairline: '#EEEEEE', // stroke/m-04
  checkBorder: '#D5D7DA', // stroke/default
  dashed: '#CFCFCF',
  surface: '#FFFFFF',
  errorBorder: '#FF0000',
  errorText: '#C0392B',
};

// Figma counter reads "0 /21".
export const OPERATOR_STAY_NAME_MAX = 21;

const STOKE_LOGO = require('../../../assets/images/trips/stoke-certified.png');
// A wide wordmark + emblem. The design shows only the emblem, so the image is
// laid out at full height and cropped from the left (see styles.ciLogo).
const CI_LOGO = require('../../../assets/images/trips/conservation-international.png');
const CI_LOGO_RATIO = 3029 / 970;
const LOGO_SIZE = 46;

export interface OperatorStayCardProps {
  name: string;
  url: string;
  photoUri: string | null;
  stokeCertified: boolean;
  ciSurfConservation: boolean;
  onChangeName: (next: string) => void;
  onChangeUrl: (next: string) => void;
  /** Opens the photo picker. The wizard owns the picker and the state. */
  onPickPhoto: () => void;
  onRemovePhoto: () => void;
  onToggleStoke: () => void;
  onToggleCi: () => void;
  /** Lets the wizard chrome scroll the focused field clear of the keyboard. */
  onFieldFocus?: (ref: React.RefObject<TextInput | null>) => void;
  /** One message for the stay block (name / link / photo missing). */
  error?: string | null;
}

interface CertRowProps {
  logo: React.ReactNode;
  label: string;
  checked: boolean;
  onPress: () => void;
}

const CertRow: React.FC<CertRowProps> = ({ logo, label, checked, onPress }) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="checkbox"
    accessibilityState={{ checked }}
    accessibilityLabel={label}
    // Tint on press, not scale — same as the requirement cards: the border is
    // part of the row, and a bordered card that shrinks reads as a glitch.
    style={({ pressed }) => [
      styles.certRow,
      checked && styles.certRowOn,
      pressed && (checked ? styles.certRowPressedOn : styles.certRowPressed),
    ]}
  >
    <View style={styles.certLeft}>
      {logo}
      <Text style={styles.certLabel}>{label}</Text>
    </View>
    <View style={[styles.check, checked && styles.checkOn]}>
      {checked ? <Ionicons name="checkmark" size={14} color="#FFFFFF" /> : null}
    </View>
  </Pressable>
);

export const OperatorStayCard: React.FC<OperatorStayCardProps> = ({
  name,
  url,
  photoUri,
  stokeCertified,
  ciSurfConservation,
  onChangeName,
  onChangeUrl,
  onPickPhoto,
  onRemovePhoto,
  onToggleStoke,
  onToggleCi,
  onFieldFocus,
  error,
}) => {
  const nameRef = useRef<TextInput | null>(null);
  const urlRef = useRef<TextInput | null>(null);

  // Same rule as the stay sheet: a bare "booking.com/…" becomes a real link.
  const handleUrlBlur = () => {
    const trimmed = url.trim();
    if (!trimmed) {
      if (url) onChangeUrl('');
      return;
    }
    if (!/^https?:\/\//i.test(trimmed)) onChangeUrl(`https://${trimmed}`);
    else if (trimmed !== url) onChangeUrl(trimmed);
  };

  return (
    <View style={styles.root}>
      <View>
        <Text style={styles.title}>Where will your guests be staying?</Text>
        <Text style={styles.subtitle}>Rep it well! Share a solid photo to hype your trip!</Text>
      </View>

      <View style={styles.card}>
        {/* Name */}
        <View style={styles.field}>
          <View style={styles.labelRow}>
            <Text style={styles.label}>Name</Text>
            <Text style={styles.counter}>
              {name.length} /{OPERATOR_STAY_NAME_MAX}
            </Text>
          </View>
          <View style={styles.inputBox}>
            <TextInput
              ref={nameRef}
              value={name}
              onChangeText={t => onChangeName(t.slice(0, OPERATOR_STAY_NAME_MAX))}
              maxLength={OPERATOR_STAY_NAME_MAX}
              placeholder="e.g Casa del Mar"
              placeholderTextColor={C.muted}
              style={styles.input}
              accessibilityLabel="Accommodation name"
              returnKeyType="next"
              onFocus={() => onFieldFocus?.(nameRef)}
              onSubmitEditing={() => urlRef.current?.focus()}
            />
          </View>
        </View>

        {/* Link */}
        <View style={styles.field}>
          <View style={styles.labelRow}>
            <Text style={styles.label}>Link</Text>
          </View>
          <View style={styles.inputBox}>
            <TextInput
              ref={urlRef}
              value={url}
              onChangeText={onChangeUrl}
              onBlur={handleUrlBlur}
              placeholder="Booking.com"
              placeholderTextColor={C.muted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              inputMode="url"
              style={styles.input}
              accessibilityLabel="Accommodation link"
              returnKeyType="done"
              onFocus={() => onFieldFocus?.(urlRef)}
              onSubmitEditing={() => Keyboard.dismiss()}
            />
          </View>
        </View>

        {/* Photo */}
        <View style={styles.photoBlock}>
          <Text style={styles.photoLabel}>Photo</Text>
          <Pressable
            onPress={() => {
              // Drop the keyboard first so the step isn't left scrolled up
              // behind it once a photo comes back.
              Keyboard.dismiss();
              onPickPhoto();
            }}
            onLongPress={() => {
              if (!photoUri) return;
              Alert.alert('Remove photo?', '', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Remove', style: 'destructive', onPress: onRemovePhoto },
              ]);
            }}
            accessibilityRole="button"
            accessibilityLabel={photoUri ? 'Change accommodation photo' : 'Add accommodation photo'}
            style={({ pressed }) => [
              styles.photoBox,
              photoUri ? styles.photoBoxFilled : styles.photoBoxEmpty,
              pressed && styles.photoBoxPressed,
            ]}
          >
            {photoUri ? (
              <>
                <Image source={{ uri: photoUri }} style={styles.photo} resizeMode="cover" />
                <View style={styles.changePill}>
                  <Ionicons name="camera-reverse-outline" size={14} color="#FFFFFF" />
                  <Text style={styles.changePillText}>Change</Text>
                </View>
              </>
            ) : (
              <View style={styles.photoEmptyInner}>
                <Image
                  source={Images.tripDeets.coverPhoto}
                  style={styles.photoEmptyIcon}
                  resizeMode="contain"
                />
                <Text style={styles.photoEmptyText}>Tap to add a photo</Text>
              </View>
            )}
          </Pressable>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {/* Certifications */}
        <View style={styles.certBlock}>
          <CertRow
            logo={<Image source={STOKE_LOGO} style={styles.stokeLogo} resizeMode="contain" />}
            label="Do you have a STOKE Certification?"
            checked={stokeCertified}
            onPress={onToggleStoke}
          />
          <CertRow
            logo={
              <View style={styles.ciLogoClip}>
                <Image source={CI_LOGO} style={styles.ciLogo} />
              </View>
            }
            label="Do they participate with CI Surf Conservation?"
            checked={ciSurfConservation}
            onPress={onToggleCi}
          />
          <View style={styles.learnMoreRow}>
            <Text style={styles.learnMore}>
              All good if not!{' '}
              {/* Drawn as a link, opens nothing yet — there is no page to
                  send them to (Ohad, 9 Oct). */}
              <Text style={styles.learnMoreLink}>Learn more here.</Text>
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { gap: 16 },
  // Body/M B-1 with a bold override.
  title: { ...textStyle('MB1', '700'), color: C.ink },
  subtitle: { ...textStyles.B3, color: C.muted },

  card: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    paddingHorizontal: 12,
    paddingVertical: 16,
    gap: 16,
    shadowColor: '#596E7C',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },

  field: { gap: 8 },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 24,
    paddingRight: 4,
  },
  // Body/M B-2 bold — the export's 18px is the desktop size.
  label: { ...textStyle('MB2', '700'), color: C.ink },
  counter: { ...textStyles.B3, color: C.muted },
  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 56,
    borderWidth: 1,
    borderColor: C.hairline,
    borderRadius: 12,
    paddingHorizontal: 16,
    backgroundColor: C.surface,
  },
  input: {
    flex: 1,
    ...textStyles.MB2,
    color: C.ink,
    // Strip the default padding so the 56px box height holds on Android.
    padding: 0,
  },

  photoBlock: { gap: 16 },
  photoLabel: { ...textStyle('MB1', '700'), color: C.ink },
  photoBox: {
    width: '100%',
    borderRadius: 24,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoBoxFilled: { height: 198 },
  // The empty state is a hidden layer in the Figma (148 tall, camera + label)
  // with no visible border; the dashed line matches the wizard's cover photo.
  photoBoxEmpty: {
    height: 148,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: C.dashed,
    backgroundColor: C.surface,
  },
  photoBoxPressed: { transform: [{ scale: 0.985 }] },
  photo: { width: '100%', height: '100%' },
  photoEmptyInner: { alignItems: 'center', justifyContent: 'center', gap: 8 },
  photoEmptyIcon: { width: 40, height: 36 },
  photoEmptyText: { ...textStyles.MB2, color: C.accent },
  changePill: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(33,33,33,0.85)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  changePillText: { ...textStyle('B3', '600'), color: '#FFFFFF' },

  error: { ...textStyle('B3', '500'), color: C.errorText },

  certBlock: { gap: 8 },
  certRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 12,
    paddingVertical: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.hairline,
    backgroundColor: C.surface,
  },
  certRowOn: { borderColor: C.accent },
  certRowPressed: { backgroundColor: '#F4F4F4' },
  certRowPressedOn: { backgroundColor: '#F7FCFD' },
  certLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  certLabel: { flex: 1, ...textStyles.MB2, color: '#000000' },
  stokeLogo: { width: LOGO_SIZE, height: LOGO_SIZE },
  ciLogoClip: { width: LOGO_SIZE, height: LOGO_SIZE, overflow: 'hidden' },
  ciLogo: {
    position: 'absolute',
    right: 0,
    top: 0,
    height: LOGO_SIZE,
    width: LOGO_SIZE * CI_LOGO_RATIO,
  },
  check: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.checkBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: C.accent, borderColor: C.accent },

  learnMoreRow: { paddingHorizontal: 8 },
  learnMore: { ...textStyles.B3, color: C.ink },
  // Body/B-3 with a bold override — the export's 16px is not a real size.
  learnMoreLink: {
    ...textStyle('B3', '700'),
    color: C.accent,
    textDecorationLine: 'underline',
  },
});

export default OperatorStayCard;
