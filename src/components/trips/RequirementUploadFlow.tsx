/**
 * RequirementUploadFlow — the whole traveler-side upload journey in one component:
 *
 *   disclosure sheet  ->  OS picker  ->  confirm the photo  ->  upload
 *
 * Self-contained on purpose. TripDetailScreen is already very large and touches
 * everything, so it gets one component and one `onUploaded` callback rather than
 * five pieces of state.
 *
 * THREE THINGS HERE ARE NOT STYLE CHOICES:
 *
 * 1. The picker is launched from the shell's `onDismissed`, never from the tile
 *    press. Firing a picker while iOS is still tearing down the Modal's
 *    UIViewController hangs the main thread on PHPicker (it runs out of process)
 *    and the OS kills the app. See the note in BottomSheetShell and the history
 *    in AttachMenuGrid.
 * 2. Because of (1), THIS COMPONENT MUST OUTLIVE ITS OWN SHEET. Closing a sheet
 *    hides it (`hidden`) — it never tells the parent, until the flow is really
 *    over. `onClose` means "unmount me", and the parent does exactly that.
 *
 *    Getting this wrong is not a subtle bug. Between 6fd2a4b and this fix, the
 *    parent unmounted the flow the moment a button was tapped: the queued
 *    hand-off died with the component, `onDismissed` never ran, and NO upload
 *    was possible on any operator trip. It looked like the buttons did nothing.
 *    Every non-picker sheet (waiver, medical) kept working, which is what made
 *    it read as "the pickers are broken" rather than "the sheet unmounted".
 * 3. The confirm preview asks the traveler to check the two machine-readable
 *    lines are legible. That one line of copy is the only quality gate in v1 —
 *    the operator reads the passport by eye — and it is what v2's scanner will
 *    depend on too.
 *
 * Spec: docs/specs/operator-trips/passport-upload-v1.md
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import {
  uploadDocument,
  REQUIREMENT_CATALOG,
  type RequirementKind,
} from '../../services/trips/tripDocumentsService';
import { showErrorAlert } from '../../utils/friendlyError';

type PickSource = 'camera' | 'library' | 'file';

export const RequirementUploadFlow: React.FC<{
  visible: boolean;
  /**
   * The whole flow is over — the traveler backed out of everything.
   *
   * The parent may unmount on this, and does. It is NOT "hide the sheet": see
   * point 2 in the file header. Nothing in here calls it to close a sheet.
   */
  onClose: () => void;
  tripId: string;
  requirementId: string;
  userId: string;
  /** Which requirement this is. Drives every piece of copy and whether a PDF
   *  is accepted. */
  kind: RequirementKind;
  /** Fired after the row exists in the database. */
  onUploaded: () => void;
  /** Shown when the operator rejected the previous file. */
  rejectionNote?: string | null;
}> = ({
  visible,
  onClose,
  tripId,
  requirementId,
  userId,
  kind,
  onUploaded,
  rejectionNote,
}) => {
  const catalog = REQUIREMENT_CATALOG[kind];
  const allowPdf = catalog.allowPdf;
  /** "passport", "travel insurance", … — this sheet serves every upload kind. */
  const itemLabel = catalog.title.toLowerCase();
  const [pickedUri, setPickedUri] = useState<string | null>(null);
  const [pickedIsPdf, setPickedIsPdf] = useState(false);
  const [pickedName, setPickedName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  /**
   * Slides whichever sheet is on screen away WITHOUT unmounting this component,
   * so the queued hand-off below still has somewhere to run.
   */
  const [hidden, setHidden] = useState(false);
  /**
   * What to do once that sheet has fully gone. Every native hand-off and every
   * exit is queued here and fired from the shell's `onDismissed` — see point 1
   * in the file header for why nothing may present while a Modal is tearing
   * down.
   */
  const afterDismiss = useRef<(() => void) | null>(null);
  // Survives the sheet closing, so "Retake" can reopen the picker directly
  // instead of bouncing the traveler back through the disclosure.
  const lastSource = useRef<PickSource | null>(null);
  // The picker resolves long after the tap. Nothing may touch state once the
  // parent has unmounted us.
  const alive = useRef(true);
  useEffect(() => () => {
    alive.current = false;
  }, []);

  /** Slide the current sheet away, then run `next`. */
  const dismissThen = useCallback((next: () => void) => {
    afterDismiss.current = next;
    setHidden(true);
  }, []);

  const handleDismissed = useCallback(() => {
    const next = afterDismiss.current;
    afterDismiss.current = null;
    next?.();
  }, []);

  /** Back out of the whole thing. Animates first, THEN tells the parent. */
  const close = useCallback(() => dismissThen(onClose), [dismissThen, onClose]);

  // ── the OS picker ────────────────────────────────────────────────────────
  /** Returns whether the traveler actually chose something. */
  const openPicker = useCallback(async (source: PickSource): Promise<boolean> => {
    lastSource.current = source;
    try {
      // A PDF comes from the document picker, not the photo library, and is
      // uploaded untouched — nothing to re-encode, and no camera EXIF to strip.
      if (source === 'file') {
        const DocumentPicker = require('expo-document-picker');
        const res = await DocumentPicker.getDocumentAsync({
          type: 'application/pdf',
          copyToCacheDirectory: true,
          multiple: false,
        });
        const asset = !res.canceled ? res.assets?.[0] : null;
        if (!asset?.uri || !alive.current) return false;
        setPickedUri(asset.uri);
        setPickedIsPdf(true);
        setPickedName(asset.name ?? 'document.pdf');
        return true;
      }

      const ImagePicker = require('expo-image-picker');

      if (source === 'camera') {
        const { status, canAskAgain } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          askAgainOrSettings(canAskAgain, 'camera', itemLabel);
          return false;
        }
      } else {
        // Android 13+ uses the system photo picker, which needs no permission.
        const usePhotoPicker = Platform.OS === 'android' && Platform.Version >= 33;
        if (!usePhotoPicker) {
          const { status, canAskAgain } =
            await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (status !== 'granted') {
            askAgainOrSettings(canAskAgain, 'photos', itemLabel);
            return false;
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
      if (!uri || !alive.current) return false;
      setPickedUri(uri);
      setPickedIsPdf(false);
      setPickedName(null);
      return true;
    } catch (e) {
      console.error('[RequirementUploadFlow] picker failed:', e);
      showErrorAlert(
        'Something went wrong',
        e,
        source === 'camera'
          ? 'Could not open your camera. Please try again.'
          : source === 'file'
          ? 'Could not open your files. Please try again.'
          : 'Could not open your photos. Please try again.',
      );
      return false;
    }
  }, [itemLabel]);

  /**
   * Hand off to the OS picker: slide the sheet away, launch once it is really
   * gone, then come back with the confirm view.
   *
   * Nothing chosen means the traveler backed out, and by then there is no sheet
   * left on screen — so the flow ends rather than leaving this component
   * mounted and invisible.
   */
  const pick = useCallback(
    (source: PickSource) => {
      dismissThen(() => {
        void openPicker(source).then(picked => {
          if (!alive.current) return;
          if (picked) setHidden(false);
          else onClose();
        });
      });
    },
    [dismissThen, openPicker, onClose],
  );

  // ── upload ───────────────────────────────────────────────────────────────
  const handleUse = useCallback(async () => {
    if (!pickedUri || uploading) return;
    setUploading(true);
    try {
      await uploadDocument({
        tripId,
        requirementId,
        userId,
        localUri: pickedUri,
        isPdf: pickedIsPdf,
      });
      if (!alive.current) return;
      // Still spinning while it slides out — the row behind is about to flip to
      // "submitted", and a button that snaps back to idle first reads as a
      // failure.
      dismissThen(onUploaded);
    } catch (e) {
      console.error('[RequirementUploadFlow] upload failed:', e);
      if (!alive.current) return;
      setUploading(false);
      // Keep the picked photo on screen so "Use this photo" can simply be
      // tapped again. Never silently drop it.
      showErrorAlert(
        'Upload failed',
        e,
        `Could not upload your ${itemLabel}. Please try again.`,
      );
    }
  }, [
    pickedUri,
    pickedIsPdf,
    uploading,
    tripId,
    requirementId,
    userId,
    itemLabel,
    dismissThen,
    onUploaded,
  ]);

  // Goes through the same dismiss-then-launch hand-off as the first pick. The
  // confirm view IS a shell — it has a Modal in it just like the disclosure —
  // so launching straight from here is the exact hazard point 1 warns about.
  const handleRetake = useCallback(() => {
    pick(lastSource.current ?? 'camera');
  }, [pick]);

  // ── confirm view ─────────────────────────────────────────────────────────
  // Its own shell so it inherits the same scrim + slide as every other sheet.
  if (pickedUri) {
    return (
      <BottomSheetShell
        visible={visible && !hidden}
        onClose={() => {
          if (!uploading) close();
        }}
        onDismissed={handleDismissed}
        swipeToDismiss={!uploading}
      >
        <View style={styles.surface}>
          <View style={styles.grabber} />
          <Text style={styles.title}>{pickedIsPdf ? 'Check the file' : 'Check the photo'}</Text>
          <Text style={styles.checkLine}>
            {kind === 'passport'
              ? 'Can you read the two lines of letters and numbers at the bottom of the page?'
              : pickedIsPdf
              ? 'Make sure this is the right document.'
              : 'Make sure everything on it is readable.'}
          </Text>

          {pickedIsPdf ? (
            <View style={styles.pdfPreview}>
              <Ionicons name="document-text-outline" size={36} color="#7B7B7B" />
              <Text style={styles.pdfName} numberOfLines={2}>
                {pickedName ?? 'document.pdf'}
              </Text>
            </View>
          ) : (
            <Image
              source={{ uri: pickedUri }}
              style={styles.preview}
              contentFit="contain"
              // Never leave a plain copy of a document in the app's disk cache —
              // it would outlive the signed URL, the 30-day delete, and logout.
              cachePolicy="memory"
              transition={120}
            />
          )}

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
              {pickedIsPdf ? 'Choose another file' : 'Take another'}
            </Text>
          </Pressable>
        </View>
      </BottomSheetShell>
    );
  }

  // ── disclosure sheet ─────────────────────────────────────────────────────
  return (
    <BottomSheetShell
      visible={visible && !hidden}
      onClose={close}
      onDismissed={handleDismissed}
    >
      <View style={styles.surface}>
        <View style={styles.grabber} />

        <View style={styles.titleRow}>
          {kind === 'passport' ? (
            <TripIcon name="passport" size={22} color="#212121" strokeWidth={1.5} />
          ) : null}
          <Text style={styles.title}>Add your {catalog.title.toLowerCase()}</Text>
        </View>
        <Text style={styles.purpose}>{catalog.helpText}</Text>

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
            text="Your organiser can save a copy to do their job. That copy is theirs, and our deletion does not reach it."
          />
        </View>

        <Pressable onPress={() => pick('camera')} style={styles.primaryBtn}>
          <Ionicons name="camera-outline" size={18} color="#FFFFFF" />
          <Text style={styles.primaryBtnText}>Take a photo</Text>
        </Pressable>

        <Pressable onPress={() => pick('library')} style={styles.outlineBtn}>
          <Ionicons name="images-outline" size={18} color="#212121" />
          <Text style={styles.outlineBtnText}>Choose from photos</Text>
        </Pressable>

        {allowPdf ? (
          <Pressable onPress={() => pick('file')} style={styles.outlineBtn}>
            <Ionicons name="document-outline" size={18} color="#212121" />
            <Text style={styles.outlineBtnText}>Choose a PDF</Text>
          </Pressable>
        ) : null}

        <Pressable onPress={close} hitSlop={8}>
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

function askAgainOrSettings(
  canAskAgain: boolean,
  what: 'camera' | 'photos',
  /** Lowercased requirement title — this sheet is not passport-only. */
  item: string,
) {
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
  Alert.alert('Permission needed', `Swellyo needs access to your ${what} to add your ${item}.`);
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
  pdfPreview: {
    alignSelf: 'stretch',
    height: 140,
    borderRadius: 12,
    backgroundColor: '#F7F7F5',
    borderWidth: 1,
    borderColor: '#E4E4E4',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 20,
  },
  pdfName: {
    fontFamily: ff('Inter', '600'),
    fontSize: 13,
    fontWeight: '600',
    color: '#212121',
    textAlign: 'center',
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
