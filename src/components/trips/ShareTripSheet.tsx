// ShareTripSheet — the "Share your trip" bottom sheet shown after a group trip
// is created. Figma node 14417:95595 ("bottom Ofer Contact").
//
// Three ways out, matching the design:
//   WhatsApp   → deep-links into WhatsApp with the invite link pre-typed.
//   Instagram  → hands off to the branded story card (ShareTripStorySheet).
//   Copy link  → clipboard, with the button confirming inline.
//
// WhatsApp is reached with Linking.openURL + catch rather than canOpenURL:
// app.json declares no LSApplicationQueriesSchemes, so canOpenURL always
// answers false on iOS. openURL rejects when the app is missing, which is the
// signal we actually want — we fall back to the OS share sheet there.

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Linking,
  Share,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheetShell } from '../BottomSheetShell';
import { WhatsAppIcon, InstagramIcon } from '../icons/BrandIcons';
import { ff } from '../../theme/fonts';
import { getGroupTripInviteUrl } from '../../services/trips/groupTripsService';
import { buildTripShareMessage } from '../../services/trips/tripShareMessage';
import { logEvent } from '../../services/analytics/eventLogger';
import { showErrorAlert } from '../../utils/friendlyError';

/** How long the Copy link button stays in its "Link copied" state. */
const COPIED_MS = 1800;

/**
 * Extra trip facts that flesh out the shared message (dates, how the trip is
 * run, spots left). All optional — every line is dropped when its data is
 * missing, so a caller that only knows the title still shares something sane.
 */
export interface TripShareDetails {
  startDate?: string | null;
  endDate?: string | null;
  structureSlugs?: string[] | null;
  participantCount?: number | null;
  maxParticipants?: number | null;
}

export interface ShareTripSheetProps {
  visible: boolean;
  onClose: () => void;
  tripId: string;
  tripTitle: string | null;
  /** Fills out the WhatsApp / share-sheet message beyond the bare link. */
  details?: TripShareDetails;
  /** Opens the branded Instagram story card (parent owns that sheet). */
  onCreatePost: () => void;
  /**
   * Fires once this sheet's Modal is fully torn down. The parent waits for it
   * before presenting the story sheet — iOS refuses to present one modal while
   * another is still dismissing.
   */
  onDismissed?: () => void;
}

export const ShareTripSheet: React.FC<ShareTripSheetProps> = ({
  visible,
  onClose,
  tripId,
  tripTitle,
  details,
  onCreatePost,
  onDismissed,
}) => {
  const insets = useSafeAreaInsets();
  const [copied, setCopied] = useState(false);

  const inviteUrl = getGroupTripInviteUrl(tripId);
  const inviteMessage = buildTripShareMessage({
    title: tripTitle,
    inviteUrl,
    startDate: details?.startDate,
    endDate: details?.endDate,
    structureSlugs: details?.structureSlugs,
    participantCount: details?.participantCount,
    maxParticipants: details?.maxParticipants,
  });

  // Reset the copied confirmation whenever the sheet is re-opened.
  useEffect(() => {
    if (!visible) setCopied(false);
  }, [visible]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(t);
  }, [copied]);

  const handleWhatsApp = async () => {
    try {
      await Linking.openURL(`whatsapp://send?text=${encodeURIComponent(inviteMessage)}`);
      logEvent('trip_invite_shared', { tripId, properties: { target: 'whatsapp', platform: Platform.OS } });
    } catch {
      // WhatsApp isn't installed (or the scheme is blocked) — fall back to the
      // OS share sheet so the tap still gets the host somewhere useful.
      try {
        await Share.share({ message: inviteMessage, url: inviteUrl });
        logEvent('trip_invite_shared', { tripId, properties: { target: 'sheet', platform: Platform.OS } });
      } catch (e: any) {
        if (e?.message && !/cancel/i.test(e.message)) {
          showErrorAlert('Could not share', e, 'Please try again.');
        }
      }
    }
  };

  const handleCopyLink = async () => {
    try {
      // Lazy-require so older dev builds without expo-clipboard compiled in
      // don't crash at module load (same pattern as the chat copy action).
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Clipboard = require('expo-clipboard');
      await Clipboard.setStringAsync(inviteUrl);
      setCopied(true);
      logEvent('trip_invite_link_copied', { tripId });
    } catch (e) {
      showErrorAlert('Could not copy', e, 'Please try again.');
    }
  };

  return (
    <BottomSheetShell visible={visible} onClose={onClose} onDismissed={onDismissed}>
      <View style={[styles.sheet, { paddingBottom: 24 + insets.bottom }]}>
        <View style={styles.grabberRow}>
          <View style={styles.grabber} />
        </View>

        <View style={styles.card}>
          <View style={styles.heading}>
            <Text style={styles.title}>Share your trip</Text>
            <Text style={styles.subtitle}>Invite surfers to join your adventure</Text>
          </View>

          <View style={styles.socialRow}>
            <Pressable
              onPress={handleWhatsApp}
              style={({ pressed }) => [styles.socialBtn, styles.waBtn, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Share on WhatsApp"
              testID="share-trip-whatsapp"
            >
              <WhatsAppIcon size={36} />
              <View style={styles.socialLabels}>
                <Text style={styles.appName}>WhatsApp</Text>
                <Text style={[styles.shareOption, styles.waOption]}>Share link</Text>
              </View>
            </Pressable>

            <Pressable
              onPress={onCreatePost}
              style={({ pressed }) => [styles.socialBtn, styles.igBtn, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Share to your Instagram story"
              testID="share-trip-instagram"
            >
              <InstagramIcon size={32} />
              <View style={styles.socialLabels}>
                <Text style={styles.appName}>Instagram</Text>
                <Text style={[styles.shareOption, styles.igOption]}>Share to story</Text>
              </View>
            </Pressable>
          </View>

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>Or</Text>
            <View style={styles.dividerLine} />
          </View>

          <Pressable
            onPress={handleCopyLink}
            style={({ pressed }) => [styles.copyBtn, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Copy the trip link"
            testID="share-trip-copy-link"
          >
            <Ionicons
              name={copied ? 'checkmark' : 'link-outline'}
              size={18}
              color={copied ? '#00C71C' : '#333333'}
            />
            <Text style={[styles.copyText, copied && styles.copyTextDone]}>
              {copied ? 'Link copied' : 'Copy link'}
            </Text>
          </Pressable>
        </View>
      </View>
    </BottomSheetShell>
  );
};

export default ShareTripSheet;

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 2,
    alignItems: 'center',
  },

  // Grabber
  grabberRow: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 8,
    paddingBottom: 16,
  },
  grabber: { width: 80, height: 4, borderRadius: 20, backgroundColor: '#7B7B7B' },

  card: { width: '100%', gap: 12, paddingVertical: 23 },

  // Heading
  heading: { width: '100%' },
  title: {
    fontFamily: ff('Montserrat', '700'),
    fontSize: 18, // Size/xl
    lineHeight: 24, // Size/3-xl
    fontWeight: '700',
    color: '#333333',
  },
  subtitle: {
    fontFamily: ff('Inter', '400'),
    fontSize: 12, // Size/s
    lineHeight: 18,
    color: '#333333',
  },

  // WhatsApp / Instagram
  socialRow: { flexDirection: 'row', alignItems: 'center', gap: 16, width: '100%' },
  socialBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  waBtn: { borderColor: '#00C71C', paddingVertical: 12 },
  igBtn: { borderColor: '#E633BF', paddingVertical: 14 },
  socialLabels: { flexShrink: 1 },
  appName: {
    fontFamily: ff('Inter', '700'),
    fontSize: 14,
    lineHeight: 17,
    fontWeight: '700',
    color: '#333333',
  },
  shareOption: {
    fontFamily: ff('Inter', '400'),
    fontSize: 10, // Size/xs
    lineHeight: 17,
  },
  waOption: { color: '#00C71C' },
  igOption: { color: '#E2235B' },

  // "Or" divider
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 13,
    paddingHorizontal: 9,
    width: '100%',
  },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: '#CFCFCF' },
  dividerText: {
    fontFamily: ff('Inter', '400'),
    fontSize: 10, // Size/xs
    lineHeight: 17,
    color: '#7B7B7B',
  },

  // Copy link
  copyBtn: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#CFCFCF',
    backgroundColor: '#FFFFFF',
  },
  copyText: {
    fontFamily: ff('Inter', '400'),
    fontSize: 14, // Size/md
    lineHeight: 18, // Size/xl
    color: '#333333',
    textAlign: 'center',
  },
  copyTextDone: { color: '#00C71C' },

  // Scale, not opacity — a press should feel like the button gave way under the
  // finger. Matches ShareTripStorySheet's press state so both share surfaces
  // respond identically.
  pressed: { transform: [{ scale: 0.97 }], opacity: 0.9 },
});
