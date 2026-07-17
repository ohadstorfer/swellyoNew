import { Platform, Linking } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { isExpoGo } from '../../utils/keyboardAvoidingView';

// Instagram Stories third-party sharing (Meta "Sharing to Stories" spec):
// the image travels via UIPasteboard (iOS) / ACTION_SEND intent (Android),
// and since Jan 2023 Instagram silently rejects shares without a Meta App ID.
const metaAppId = (): string => process.env.EXPO_PUBLIC_META_APP_ID?.trim() || '';

export async function isInstagramStoriesAvailable(): Promise<boolean> {
  if (Platform.OS === 'web' || isExpoGo) return false;
  if (!metaAppId()) {
    console.warn('[instagramStoryShare] EXPO_PUBLIC_META_APP_ID missing — Instagram story share disabled');
    return false;
  }
  try {
    const canOpen = await Linking.canOpenURL('instagram-stories://share');
    if (!canOpen) {
      console.warn(
        '[instagramStoryShare] canOpenURL=false — Instagram not installed, or the running binary lacks instagram-stories in LSApplicationQueriesSchemes'
      );
    }
    return canOpen;
  } catch (e) {
    console.warn('[instagramStoryShare] canOpenURL threw:', e);
    return false;
  }
}

/**
 * Hand a 1080x1920 PNG to Instagram's story composer and put the trip's
 * invite link on the clipboard so the user can paste it as a Link sticker.
 * Instagram dropped programmatic link attachment for third parties — the
 * clipboard + manual sticker two-step is the Spotify/Strava pattern.
 *
 * Throws on share failure; callers own the user-facing alert.
 */
export async function shareToInstagramStory(opts: { base64Png: string; inviteUrl: string }): Promise<void> {
  // Lazy-required so Expo Go never touches the native module.
  const RNShare = require('react-native-share');
  const Share = RNShare.default ?? RNShare;
  const Social = RNShare.Social ?? Share.Social;

  if (Platform.OS === 'android') {
    // The Android intent doesn't touch the clipboard — safe to copy up front.
    await Clipboard.setStringAsync(opts.inviteUrl);
  }

  await Share.shareSingle({
    social: Social.InstagramStories,
    appId: metaAppId(),
    backgroundImage: `data:image/png;base64,${opts.base64Png}`,
  });

  if (Platform.OS === 'ios') {
    // iOS transports the image THROUGH the pasteboard, so copying the link
    // before sharing gets clobbered. Copy once Instagram has consumed the
    // payload (react-native-share#1388 workaround).
    setTimeout(() => {
      Clipboard.setStringAsync(opts.inviteUrl).catch(() => {});
    }, 2000);
  }
}
