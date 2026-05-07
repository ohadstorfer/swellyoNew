import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Text } from '../../components/Text';
import {
  getSurftripInvitePreview,
  type SurftripInvitePreview,
} from '../../services/surftrips/surftripsService';

// TODO: replace with the real App Store numeric ID once Swellyo is live in the
// App Store. The Play Store URL uses the package which is already final.
const APP_STORE_URL = 'https://apps.apple.com/app/swellyo';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.swellyo.app';

interface Props {
  token: string | null;
  groupId: string | null;
  onDismiss: () => void;
}

export default function SurftripInviteLanding({ token, groupId, onDismiss }: Props) {
  const [preview, setPreview] = useState<SurftripInvitePreview | null>(null);
  const [loading, setLoading] = useState<boolean>(!!token);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getSurftripInvitePreview(token)
      .then(p => {
        if (!cancelled) setPreview(p);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [token]);

  const hasPreview = !!preview?.group_name;

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onDismiss}
          style={styles.closeButton}
          hitSlop={12}
        >
          <Ionicons name="close" size={28} color="#fff" />
        </Pressable>

        <View style={styles.heroWrapper}>
          {hasPreview && preview?.hero_image_url ? (
            <Image source={{ uri: preview.hero_image_url }} style={styles.heroImage} />
          ) : (
            <LinearGradient
              colors={['#0788B0', '#05BCD3']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.heroImage}
            >
              <Ionicons name="globe-outline" size={64} color="rgba(255,255,255,0.85)" />
            </LinearGradient>
          )}
        </View>

        <View style={styles.body}>
          {loading ? (
            <ActivityIndicator color="#0788B0" style={{ marginVertical: 24 }} />
          ) : hasPreview ? (
            <>
              <Text style={styles.eyebrow}>You're invited to</Text>
              <Text style={styles.title}>{preview!.group_name}</Text>
              <Text style={styles.subtitle}>
                {preview!.host_display_name
                  ? `Hosted by ${preview!.host_display_name}`
                  : 'Surftrip on Swellyo'}
              </Text>
              {preview!.member_count != null && preview!.max_members != null ? (
                <Text style={styles.meta}>
                  {preview!.member_count} / {preview!.max_members} surfers
                </Text>
              ) : null}
            </>
          ) : (
            <>
              <Text style={styles.eyebrow}>Surftrip on Swellyo</Text>
              <Text style={styles.title}>Open the Swellyo app to join</Text>
              <Text style={styles.subtitle}>
                This link opens inside the app. Once you have it installed, tap
                the link again and you'll go straight to the surftrip.
              </Text>
            </>
          )}

          <View style={styles.ctaCard}>
            <Text style={styles.ctaTitle}>Get the Swellyo app</Text>
            <Text style={styles.ctaCopy}>
              Surftrips, group chats, and matching live in the mobile app.
            </Text>

            <TouchableOpacity
              activeOpacity={0.85}
              style={[styles.storeButton, styles.storeButtonPrimary]}
              onPress={() => Linking.openURL(APP_STORE_URL)}
            >
              <Ionicons name="logo-apple" size={22} color="#fff" />
              <Text style={styles.storeButtonText}>Download on App Store</Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.85}
              style={[styles.storeButton, styles.storeButtonSecondary]}
              onPress={() => Linking.openURL(PLAY_STORE_URL)}
            >
              <Ionicons name="logo-google-playstore" size={22} color="#212121" />
              <Text style={[styles.storeButtonText, { color: '#212121' }]}>
                Get it on Google Play
              </Text>
            </TouchableOpacity>
          </View>

          {Platform.OS === 'web' ? (
            <Text style={styles.footnote}>
              Already have the app? Open this page from your phone — your invite
              link will route directly into Swellyo.
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0E0E10',
  },
  scroll: {
    flexGrow: 1,
    paddingBottom: 48,
    alignItems: 'center',
  },
  closeButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    zIndex: 2,
    padding: 8,
  },
  heroWrapper: {
    width: '100%',
    aspectRatio: 16 / 9,
    maxHeight: 360,
    backgroundColor: '#1a1a1d',
  },
  heroImage: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    width: '100%',
    maxWidth: 520,
    paddingHorizontal: 24,
    paddingTop: 28,
  },
  eyebrow: {
    color: '#9ca3af',
    fontSize: 13,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  title: {
    color: '#fff',
    fontSize: 26,
    fontWeight: '700',
    marginBottom: 6,
  },
  subtitle: {
    color: '#d1d5db',
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 8,
  },
  meta: {
    color: '#9ca3af',
    fontSize: 13,
    marginBottom: 16,
  },
  ctaCard: {
    marginTop: 24,
    backgroundColor: '#FAFAFA',
    borderRadius: 16,
    padding: 20,
  },
  ctaTitle: {
    color: '#212121',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  ctaCopy: {
    color: '#52525b',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  storeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: 10,
  },
  storeButtonPrimary: {
    backgroundColor: '#212121',
  },
  storeButtonSecondary: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e4e4e7',
  },
  storeButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  footnote: {
    color: '#9ca3af',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 24,
    paddingHorizontal: 16,
  },
});
