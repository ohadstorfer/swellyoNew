/**
 * PassportUploadFlow — the whole traveler-side upload journey in one component:
 *
 *   disclosure sheet  ->  OS picker  ->  confirm the photo  ->  upload
 *
 * Self-contained on purpose. TripDetailScreen is already very large and touches
 * everything, so it gets one component and one `onUploaded` callback rather than
 * five pieces of state.
 *
 * TWO THINGS HERE ARE NOT STYLE CHOICES:
 *
 * 1. The picker is launched from the shell's `onDismissed`, never from the tile
 *    press. Firing a picker while iOS is still tearing down the Modal's
 *    UIViewController hangs the main thread on PHPicker (it runs out of process)
 *    and the OS kills the app. See the note in BottomSheetShell and the history
 *    in AttachMenuGrid.
 * 2. The confirm preview asks the traveler to check the two machine-readable
 *    lines are legible. That one line of copy is the only quality gate in v1 —
 *    the operator reads the passport by eye — and it is what v2's scanner will
 *    depend on too.
 *
 * Spec: docs/specs/operator-trips/passport-upload-v1.md
 */
import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  Alert,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheetShell } from '../BottomSheetShell';
import { TripIcon } from './tripIcons';
import { ff } from '../../theme/fonts';
import { uploadDocument } from '../../services/trips/tripDocumentsService';
import { showErrorAlert } from '../../utils/friendlyError';

type PendingPick = 'camera' | 'library' | null;

export const PassportUploadFlow: React.FC<{
  visible: boolean;
  onClose: () => void;
  tripId: string;
  requirementId: string;
  userId: string;
  /** Fired after the row exists in the database. */
  onUploaded: () => void;
  /** Shown when the operator rejected the previous photo. */
  rejectionNote?: string | null;
}> = ({ visible, onClose, tripId, requirementId, userId, onUploaded, rejectionNote }) => {
  const [pendingPick, setPendingPick] = useState<PendingPick>(null);
  const [pickedUri, setPickedUri] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  // Survives the sheet closing, so "Retake" can reopen the picker directly
  // instead of bouncing the traveler back through the disclosure.
  const lastSource = useRef<PendingPick>(null);

  const reset = useCallback(() => {
    setPendingPick(null);
    setPickedUri(null);
    setUploading(false);
  }, []);

  // ── the OS picker ────────────────────────────────────────────────────────
  const launch = useCallback(async (source: 'camera' | 'library') => {
    lastSource.current = source;
    try {
      const ImagePicker = require('expo-image-picker');

      if (source === 'camera') {
        const { status, canAskAgain } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          askAgainOrSettings(canAskAgain, 'camera');
          return;
        }
      } else {
        // Android 13+ uses the system photo picker, which needs no permission.
        const usePhotoPicker = Platform.OS === 'android' && Platform.Version >= 33;
        if (!usePhotoPicker) {
          const { status, canAskAgain } =
            await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (status !== 'granted') {
            askAgainOrSettings(canAskAgain, 'photos');
            return;
          }
        }
      }

      const options = {
        mediaTypes: ['images'] as const,
        // Full quality out of the picker. compressImage() does the resizing and
        // the JPEG re-encode, and it is that re-encode which drops EXIF.
        quality: 1,
        allowsMultipleSelection: false,
        // Default is already false; stated so nobody "helpfully" turns it on.
        // We never want the passport's metadata in JS.
        exif: false,
      };

      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync(options)
          : await ImagePicker.launchImageLibraryAsync(options);

      const uri = !result.canceled ? result.assets?.[0]?.uri : null;
      if (uri) setPickedUri(uri);
    } catch (e) {
      console.error('[PassportUploadFlow] picker failed:', e);
      showErrorAlert(
        'Something went wrong',
        e,
        source === 'camera'
          ? 'Could not open your camera. Please try again.'
          : 'Could not open your photos. Please try again.',
      );
    }
  }, []);

  // The shell has fully gone away — safe to present native UI now.
  const handleDismissed = useCallback(() => {
    const next = pendingPick;
    setPendingPick(null);
    if (next) launch(next);
  }, [pendingPick, launch]);

  const choose = (source: 'camera' | 'library') => {
    setPendingPick(source);
    onClose();
  };

  // ── upload ───────────────────────────────────────────────────────────────
  const handleUse = useCallback(async () => {
    if (!pickedUri || uploading) return;
    setUploading(true);
    try {
      await uploadDocument({ tripId, requirementId, userId, localUri: pickedUri });
      reset();
      onUploaded();
    } catch (e) {
      console.error('[PassportUploadFlow] upload failed:', e);
      setUploading(false);
      // Keep the picked photo on screen so "Use this photo" can simply be
      // tapped again. Never silently drop it.
      showErrorAlert(
        'Upload failed',
        e,
        'Could not upload your passport. Please try again.',
      );
    }
  }, [pickedUri, uploading, tripId, requirementId, userId, reset, onUploaded]);

  const handleRetake = useCallback(() => {
    setPickedUri(null);
    const source = lastSource.current ?? 'camera';
    // No Modal in the way here — the confirm view is not a shell — so the
    // picker can be launched directly.
    launch(source);
  }, [launch]);

  // ── confirm view ─────────────────────────────────────────────────────────
  // Its own shell so it inherits the same scrim + slide as every other sheet.
  if (pickedUri) {
    return (
      <BottomSheetShell
        visible
        onClose={() => {
          if (!uploading) reset();
        }}
        swipeToDismiss={!uploading}
      >
        <View style={styles.surface}>
          <View style={styles.grabber} />
          <Text style={styles.title}>Check the photo</Text>
          <Text style={styles.checkLine}>
            Can you read the two lines of letters and numbers at the bottom of the page?
          </Text>

          <Image
            source={{ uri: pickedUri }}
            style={styles.preview}
            contentFit="contain"
            // Never leave a plain copy of a passport in the app's disk cache —
            // it would outlive the signed URL, the 30-day delete, and logout.
            cachePolicy="memory"
            transition={120}
          />

          <Pressable
            onPress={handleUse}
            disabled={uploading}
            style={[styles.primaryBtn, uploading && styles.btnDisabled]}
          >
            {uploading ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.primaryBtnText}>Use this photo</Text>
            )}
          </Pressable>

          <Pressable onPress={handleRetake} disabled={uploading} hitSlop={8}>
            <Text style={[styles.secondaryText, uploading && styles.textDisabled]}>
              Take another
            </Text>
          </Pressable>
        </View>
      </BottomSheetShell>
    );
  }

  // ── disclosure sheet ─────────────────────────────────────────────────────
  return (
    <BottomSheetShell visible={visible} onClose={onClose} onDismissed={handleDismissed}>
      <View style={styles.surface}>
        <View style={styles.grabber} />

        <View style={styles.titleRow}>
          <TripIcon name="passport" size={22} color="#212121" strokeWidth={1.5} />
          <Text style={styles.title}>Add your passport</Text>
        </View>
        <Text style={styles.purpose}>Your trip organiser needs it to book your flights.</Text>

        {rejectionNote ? (
          <View style={styles.rejectBox}>
            <Text style={styles.rejectLabel}>Your organiser asked for a new photo</Text>
            <Text style={styles.rejectNote}>{rejectionNote}</Text>
          </View>
        ) : null}

        {/* Not collapsed and not behind a "learn more" — deliberate. */}
        <View style={styles.disclosure}>
          <DisclosureRow icon="eye-outline" text="Only you and your trip organiser can see it." />
          <DisclosureRow
            icon="trash-outline"
            text="We delete your photo within 30 days after the trip ends — automatically, and also if you leave the trip."
          />
          <DisclosureRow
            icon="information-circle-outline"
            text="Your organiser can save a copy to do the booking. That copy is theirs, and our deletion does not reach it."
          />
        </View>

        <Pressable onPress={() => choose('camera')} style={styles.primaryBtn}>
          <Ionicons name="camera-outline" size={18} color="#FFFFFF" />
          <Text style={styles.primaryBtnText}>Take a photo</Text>
        </Pressable>

        <Pressable onPress={() => choose('library')} style={styles.outlineBtn}>
          <Ionicons name="images-outline" size={18} color="#212121" />
          <Text style={styles.outlineBtnText}>Choose from photos</Text>
        </Pressable>

        <Pressable onPress={onClose} hitSlop={8}>
          <Text style={styles.secondaryText}>Not now</Text>
        </Pressable>
      </View>
    </BottomSheetShell>
  );
};

const DisclosureRow: React.FC<{ icon: any; text: string }> = ({ icon, text }) => (
  <View style={styles.discRow}>
    <Ionicons name={icon} size={16} color="#7B7B7B" style={styles.discIcon} />
    <Text style={styles.discText}>{text}</Text>
  </View>
);

function askAgainOrSettings(canAskAgain: boolean, what: 'camera' | 'photos') {
  if (!canAskAgain) {
    Alert.alert(
      'Permission needed',
      `Swellyo needs access to your ${what}. You can turn it on in your device settings.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open Settings', onPress: () => Linking.openSettings() },
      ],
    );
    return;
  }
  Alert.alert('Permission needed', `Swellyo needs access to your ${what} to add your passport.`);
}

const styles = StyleSheet.create({
  surface: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 28,
    alignItems: 'center',
    gap: 12,
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E4E4E4',
    marginBottom: 6,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: {
    fontFamily: ff('Inter', '700'),
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '700',
    color: '#212121',
  },
  purpose: {
    fontFamily: ff('Inter', '400'),
    fontSize: 13,
    lineHeight: 19,
    color: '#7B7B7B',
    textAlign: 'center',
  },
  checkLine: {
    fontFamily: ff('Inter', '400'),
    fontSize: 13,
    lineHeight: 19,
    color: '#222B30',
    textAlign: 'center',
    paddingHorizontal: 8,
  },

  rejectBox: {
    alignSelf: 'stretch',
    backgroundColor: '#FCEEF0',
    borderRadius: 12,
    padding: 12,
    gap: 3,
  },
  rejectLabel: {
    fontFamily: ff('Inter', '600'),
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    color: '#C4361E',
  },
  rejectNote: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 17, color: '#7B3A30' },

  disclosure: {
    alignSelf: 'stretch',
    backgroundColor: '#FAFAFA',
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  discRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  discIcon: { marginTop: 1 },
  discText: {
    flex: 1,
    fontFamily: ff('Inter', '400'),
    fontSize: 12,
    lineHeight: 17,
    color: '#555555',
  },

  preview: {
    alignSelf: 'stretch',
    height: 260,
    borderRadius: 12,
    backgroundColor: '#F2F2F2',
  },

  primaryBtn: {
    alignSelf: 'stretch',
    height: 48,
    borderRadius: 24,
    backgroundColor: '#05BCD3',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 4,
  },
  primaryBtnText: {
    fontFamily: ff('Inter', '600'),
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  outlineBtn: {
    alignSelf: 'stretch',
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#E4E4E4',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  outlineBtnText: {
    fontFamily: ff('Inter', '600'),
    fontSize: 15,
    fontWeight: '600',
    color: '#212121',
  },
  btnDisabled: { opacity: 0.7 },
  secondaryText: {
    fontFamily: ff('Inter', '400'),
    fontSize: 14,
    color: '#7B7B7B',
    paddingTop: 4,
  },
  textDisabled: { opacity: 0.5 },
});
