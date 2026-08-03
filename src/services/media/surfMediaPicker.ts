/**
 * Surf Skill media picker — lets the user show how they ride with EITHER a
 * video clip OR a still photo.
 *
 * Onboarding (OnboardingVideoUploadScreen) and profile editing
 * (ProfileEditSurfVideoScreen) had a byte-for-byte copy of this picker between
 * them, so widening "videos" to "photo or video" in one place and not the other
 * was a real risk. Both now call in here.
 *
 * What stays in the screens: the gallery-primer overlay, because that's UI
 * state. Call `launchSurfMediaPicker()` once the primer has been shown (or when
 * it isn't needed) — it handles the OS permission prompt itself.
 */
import { Platform, Alert, Linking } from 'react-native';
import { validateVideoComplete } from '../../utils/videoValidation';

export type SurfMediaKind = 'photo' | 'video';

export interface PickedSurfMedia {
  kind: SurfMediaKind;
  /** Local URI: `file://` / `content://` / `ph://` on native, `blob:` on web. */
  uri: string;
  mimeType?: string;
  /**
   * Picker asset hints. Videos only — `startProfileVideoUpload` uses them to
   * decide whether to transcode without re-probing the file.
   */
  hints?: { width?: number; height?: number; fileSize?: number };
}

export type PickSurfMediaResult =
  | { status: 'picked'; media: PickedSurfMedia }
  /** User backed out, or permission was refused (the helper already alerted). */
  | { status: 'cancelled' }
  /** Something the user should see — an unusable file, a broken picker. */
  | { status: 'error'; message: string };

/** Web <input accept> — mirrors the native `mediaTypes` list below. */
const WEB_ACCEPT = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/webp',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-msvideo',
].join(',');

/**
 * Android 13+ routes through the system Photo Picker, which needs no runtime
 * permission (and no primer overlay).
 */
export const usesAndroidPhotoPicker = (): boolean =>
  Platform.OS === 'android' && Number(Platform.Version) >= 33;

/**
 * Native picker: requests media-library permission when needed, opens the
 * gallery for photos AND videos, and validates a picked video.
 */
export async function launchSurfMediaPicker(): Promise<PickSurfMediaResult> {
  try {
    const ImagePicker = require('expo-image-picker');

    if (!usesAndroidPhotoPicker()) {
      const { status, canAskAgain } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        if (!canAskAgain) {
          Alert.alert(
            'Permission Required',
            'Swellyo needs access to your photos. Please enable it in your device settings.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Open Settings', onPress: () => Linking.openSettings() },
            ],
          );
        } else {
          Alert.alert(
            'Permission Required',
            'Sorry, we need media library permissions to upload your photo or video!',
          );
        }
        return { status: 'cancelled' };
      }
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      allowsEditing: false,
      quality: 1.0,
    });

    if (result.canceled || !result.assets?.[0]) return { status: 'cancelled' };

    const asset = result.assets[0];
    const mimeType: string | undefined = asset.mimeType || undefined;
    // expo-image-picker reports `type: 'image' | 'video'`; fall back to the MIME
    // type on the rare asset that doesn't carry it.
    const isVideo = asset.type === 'video' || (!asset.type && !!mimeType?.startsWith('video/'));

    if (isVideo) {
      const validation = await validateVideoComplete(asset.uri, mimeType);
      if (!validation.valid) {
        return { status: 'error', message: validation.error || 'Please select a valid video file.' };
      }
      return {
        status: 'picked',
        media: {
          kind: 'video',
          uri: asset.uri,
          mimeType,
          hints: {
            width: asset.width,
            height: asset.height,
            fileSize: (asset as { fileSize?: number }).fileSize,
          },
        },
      };
    }

    // Photos need no validation — uploadSurfPhoto re-encodes to JPEG anyway,
    // which normalises HEIC and strips anything odd about the source.
    return { status: 'picked', media: { kind: 'photo', uri: asset.uri, mimeType } };
  } catch (err) {
    console.warn('[surfMediaPicker] expo-image-picker not available:', err);
    return {
      status: 'error',
      message: 'Photo picker not available. Please try again.',
    };
  }
}

/**
 * Web picker: a transient `<input type="file">`. Resolves 'cancelled' when the
 * user dismisses the file dialog (browsers that fire `cancel`; older ones simply
 * never resolve, same as before this module existed).
 */
export function pickSurfMediaOnWeb(): Promise<PickSurfMediaResult> {
  return new Promise<PickSurfMediaResult>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = WEB_ACCEPT;
    input.style.display = 'none';

    const cleanup = () => {
      if (input.parentNode) document.body.removeChild(input);
    };

    input.oncancel = () => {
      cleanup();
      resolve({ status: 'cancelled' });
    };

    input.onchange = async (event: Event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) {
        cleanup();
        resolve({ status: 'cancelled' });
        return;
      }

      const uri = URL.createObjectURL(file);
      const mimeType = file.type || undefined;
      const isVideo = !!mimeType?.startsWith('video/');

      if (!isVideo) {
        cleanup();
        resolve({ status: 'picked', media: { kind: 'photo', uri, mimeType } });
        return;
      }

      try {
        const validation = await validateVideoComplete(uri, mimeType);
        if (!validation.valid) {
          URL.revokeObjectURL(uri);
          cleanup();
          resolve({ status: 'error', message: validation.error || 'Please select a valid video file.' });
          return;
        }
        cleanup();
        resolve({
          status: 'picked',
          media: { kind: 'video', uri, mimeType, hints: { fileSize: file.size } },
        });
      } catch (err) {
        console.error('[surfMediaPicker] video validation threw:', err);
        URL.revokeObjectURL(uri);
        cleanup();
        resolve({ status: 'error', message: 'Failed to validate video. Please try again.' });
      }
    };

    document.body.appendChild(input);
    input.click();
  });
}

/** Release a `blob:` URI created by the web picker. No-op elsewhere. */
export function releasePickedMedia(media: PickedSurfMedia | null): void {
  if (!media) return;
  if (Platform.OS === 'web' && media.uri.startsWith('blob:')) {
    URL.revokeObjectURL(media.uri);
  }
}
