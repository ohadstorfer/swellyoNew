import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Image,
  Pressable,
  Platform,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Sharing from 'expo-sharing';
import { Ionicons } from '@expo/vector-icons';
import { type TripDetailVM, formatDateRange } from './TripDetailView';
import { toWidthThumbUrl, toThumbUrl } from '../../services/media/thumbnails';
import { Logo } from '../Logo';
import { ff } from '../../theme/fonts';
import { showErrorAlert } from '../../utils/friendlyError';
import { logEvent } from '../../services/analytics/eventLogger';
import {
  isInstagramStoriesAvailable,
  shareToInstagramStory,
} from '../../services/share/instagramStoryShare';
import { getGroupTripInviteUrl } from '../../services/trips/groupTripsService';

// Instagram story canvas — captures rescale the on-screen card to this size.
const STORY_W = 1080;
const STORY_H = 1920;

interface ShareTripStorySheetProps {
  visible: boolean;
  tripId: string;
  vm: TripDetailVM;
  onClose: () => void;
}

/**
 * Full-screen preview of the branded 9:16 story card. The preview IS the
 * shared image: the card view is captured with react-native-view-shot at
 * 1080x1920 and handed to Instagram (or the generic share sheet).
 *
 * Only reachable on native non-Expo-Go builds — the Trip Detail menu hides
 * the entry elsewhere — so the lazy view-shot require below is safe.
 */
export const ShareTripStorySheet: React.FC<ShareTripStorySheetProps> = ({
  visible,
  tripId,
  vm,
  onClose,
}) => {
  const cardRef = useRef<View>(null);
  const insets = useSafeAreaInsets();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const [heroReady, setHeroReady] = useState(false);
  // Thumb 404s (e.g. pre-backfill images) fall back to the original URL
  // before giving up on the photo entirely.
  const [heroUseOriginal, setHeroUseOriginal] = useState(false);
  const [heroFailed, setHeroFailed] = useState(false);
  const [igAvailable, setIgAvailable] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) isInstagramStoriesAvailable().then(setIgAvailable);
  }, [visible]);

  // NOTE: only the default WIDTH_VARIANT (1280w) exists in S3 — asking for
  // other widths (e.g. 1080) 404s and the card silently loses its photo.
  const heroUri = vm.heroImageUri
    ? heroUseOriginal
      ? vm.heroImageUri
      : toWidthThumbUrl(vm.heroImageUri)
    : null;
  const showHero = !!heroUri && !heroFailed;
  // Tiny (~15 KB) square thumb as an instant, blurred stand-in while the
  // full-width variant streams in on a cold cache.
  const heroPlaceholderUri = vm.heroImageUri ? toThumbUrl(vm.heroImageUri, 320) : null;
  const canShare = !busy && (!showHero || heroReady);

  // Fit the 9:16 card inside the screen, leaving room for the controls below.
  const cardH = Math.min(screenH * 0.62, ((screenW - 48) * 16) / 9);
  const cardW = (cardH * 9) / 16;

  const capture = async (result: 'base64' | 'tmpfile'): Promise<string> => {
    // Lazy require — native module, absent in Expo Go (sheet unreachable there).
    const { captureRef } = require('react-native-view-shot');
    return captureRef(cardRef, {
      format: 'png',
      quality: 1,
      result,
      width: STORY_W,
      height: STORY_H,
    });
  };

  const handleInstagram = async () => {
    setBusy(true);
    try {
      const base64Png = await capture('base64');
      await shareToInstagramStory({ base64Png, inviteUrl: getGroupTripInviteUrl(tripId) });
      logEvent('trip_story_shared', { tripId, properties: { target: 'instagram', platform: Platform.OS } });
    } catch (e) {
      logEvent('trip_story_share_failed', { tripId, properties: { platform: Platform.OS } });
      showErrorAlert('Share failed', e, "Couldn't open Instagram. Try 'Share image' instead.");
    } finally {
      setBusy(false);
    }
  };

  const handleGenericShare = async () => {
    setBusy(true);
    try {
      const fileUri = await capture('tmpfile');
      await Sharing.shareAsync(fileUri, { mimeType: 'image/png' });
      logEvent('trip_story_shared', { tripId, properties: { target: 'sheet', platform: Platform.OS } });
    } catch (e) {
      logEvent('trip_story_share_failed', { tripId, properties: { platform: Platform.OS } });
      showErrorAlert('Share failed', e, "Couldn't share the image. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const metaLine = [vm.destinationLabel, formatDateRange(vm)]
    .filter(Boolean)
    .join('  ·  ');

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View style={[styles.root, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Share to Story</Text>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
          >
            <Ionicons name="close" size={22} color="#FFFFFF" />
          </Pressable>
        </View>

        {/* Rounded preview wrapper — the radius lives here, NOT on the captured
            view, so the exported PNG has square corners (no transparent pixels
            showing through the published story). */}
        <View style={[styles.cardClip, { width: cardW, height: cardH }]}>
          <View ref={cardRef} collapsable={false} style={styles.card}>
            {showHero && !!heroPlaceholderUri && !heroReady && (
              <Image
                source={{ uri: heroPlaceholderUri }}
                style={StyleSheet.absoluteFill}
                resizeMode="cover"
                blurRadius={6}
              />
            )}
            {showHero ? (
              <Image
                // RN Image (not expo-image): expo-image has known blank-capture
                // issues with view-shot on Android.
                source={{ uri: heroUri! }}
                style={StyleSheet.absoluteFill}
                resizeMode="cover"
                onLoad={() => setHeroReady(true)}
                onError={() => {
                  if (!heroUseOriginal) setHeroUseOriginal(true);
                  else setHeroFailed(true);
                }}
              />
            ) : (
              <LinearGradient
                colors={['#05BCD3', '#0A3540']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
            )}

            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.9)']}
              style={styles.scrim}
            />

            <View style={styles.brandRow}>
              <Logo size={30} iconOnly />
              <Text style={styles.brandText}>Swellyo</Text>
            </View>

            <View style={styles.cardTextBlock}>
              <Text style={styles.cardTitle} numberOfLines={2}>
                {vm.title || 'Surf trip'}
              </Text>
              {!!metaLine && <Text style={styles.cardMeta}>{metaLine}</Text>}
            </View>
          </View>
        </View>

        <View style={styles.controls}>
          <Text style={styles.linkNote}>
            We'll copy the trip link — paste it in Instagram as a Link sticker 🔗
          </Text>

          {igAvailable && (
            <Pressable
              onPress={handleInstagram}
              disabled={!canShare}
              style={({ pressed }) => [
                styles.primaryBtn,
                pressed && styles.pressed,
                !canShare && styles.btnDisabled,
              ]}
            >
              {busy ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Ionicons name="logo-instagram" size={20} color="#FFFFFF" />
                  <Text style={styles.primaryBtnText}>Share to Instagram</Text>
                </>
              )}
            </Pressable>
          )}

          <Pressable
            onPress={handleGenericShare}
            disabled={!canShare}
            style={({ pressed }) => [
              styles.secondaryBtn,
              pressed && styles.pressed,
              !canShare && styles.btnDisabled,
            ]}
          >
            <Ionicons name="share-outline" size={20} color="#FFFFFF" />
            <Text style={styles.secondaryBtnText}>Share image</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#121212',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  header: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontFamily: ff('Montserrat', '600'),
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardClip: {
    borderRadius: 20,
    overflow: 'hidden',
  },
  card: {
    flex: 1,
    backgroundColor: '#0A3540',
  },
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '48%',
  },
  brandRow: {
    position: 'absolute',
    top: 18,
    left: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  brandText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: ff('Montserrat', '700'),
    letterSpacing: 0.4,
  },
  cardTextBlock: {
    position: 'absolute',
    left: 18,
    right: 18,
    bottom: 20,
  },
  cardTitle: {
    color: '#FFFFFF',
    fontSize: 26,
    lineHeight: 31,
    fontFamily: ff('Montserrat', '700'),
  },
  cardMeta: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 13,
    marginTop: 8,
    fontFamily: ff('Inter', '500'),
  },
  controls: {
    width: '100%',
    marginTop: 'auto',
    gap: 10,
  },
  linkNote: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: 4,
    fontFamily: ff('Inter', '400'),
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#05BCD3',
    borderRadius: 14,
    paddingVertical: 15,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: ff('Inter', '600'),
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 14,
    paddingVertical: 15,
  },
  secondaryBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: ff('Inter', '600'),
  },
  pressed: {
    transform: [{ scale: 0.97 }],
  },
  btnDisabled: {
    opacity: 0.5,
  },
});
