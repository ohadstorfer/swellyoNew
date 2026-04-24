import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Animated,
  Easing,
  TouchableOpacity,
  Image,
  Platform,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { SupabaseSurfer } from '../../services/database/supabaseDatabaseService';

type Props = {
  visible: boolean;
  onClose: () => void;
  surfer: SupabaseSurfer | null;
};

const SafeAreaContainer = Platform.OS === 'web' ? View : SafeAreaView;

const FIGMA = {
  bg: '#F7F7F7',
  cardBg: '#FFFFFF',
  fieldBg: '#F7F7F7',
  border: '#EEEEEE',
  divider: '#E3E3E3',
  textPrimary: '#333333',
  textSecondary: '#7B7B7B',
  brandTeal: '#0788B0',
};

export const ProfileEditPanel: React.FC<Props> = ({ visible, onClose, surfer }) => {
  const { width: screenWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(false);
  const translateX = useRef(new Animated.Value(screenWidth)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible && !mounted) {
      translateX.setValue(screenWidth);
      backdropOpacity.setValue(0);
      setMounted(true);
    }
  }, [visible, mounted, screenWidth, translateX, backdropOpacity]);

  useEffect(() => {
    if (mounted && !visible) {
      Animated.parallel([
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.timing(translateX, {
          toValue: screenWidth,
          duration: 320,
          easing: Easing.bezier(0.64, 0, 0.78, 0),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [mounted, visible, screenWidth, translateX, backdropOpacity]);

  const runEnterAnimation = useCallback(() => {
    translateX.setValue(screenWidth);
    backdropOpacity.setValue(0);
    Animated.parallel([
      Animated.timing(backdropOpacity, {
        toValue: 1,
        duration: 320,
        useNativeDriver: true,
      }),
      Animated.timing(translateX, {
        toValue: 0,
        duration: 520,
        easing: Easing.bezier(0.22, 1, 0.36, 1),
        useNativeDriver: true,
      }),
    ]).start();
  }, [screenWidth, translateX, backdropOpacity]);

  if (!mounted) return null;

  const avatarUrl = surfer?.profile_image_url;
  const nickname = surfer?.name ?? '';
  const country = surfer?.country_from ?? '';
  const surfStyleLabel = formatSurfboardType(surfer?.surfboard_type);
  const tripCount = typeof surfer?.travel_experience === 'number' ? surfer.travel_experience : null;
  const travelExperienceLabel =
    tripCount == null ? '—' : `${tripCount} surf trip${tripCount === 1 ? '' : 's'}`;
  const surfSkillLabel = capitalizeWords(surfer?.surf_level_category) || '—';
  const destinations = surfer?.destinations_array ?? [];

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      statusBarTranslucent
      hardwareAccelerated
      onShow={runEnterAnimation}
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <Animated.View
          style={[styles.backdrop, { opacity: backdropOpacity }]}
          pointerEvents="none"
        />
        <Animated.View
          style={[
            styles.panel,
            { width: screenWidth, transform: [{ translateX }] },
          ]}
        >
          <SafeAreaContainer style={styles.safeArea} edges={['top', 'bottom']}>
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={[
                styles.scrollContent,
                { paddingBottom: Math.max(insets.bottom, 24) + 48 },
              ]}
              showsVerticalScrollIndicator={false}
            >
              {/* Back button (top-left pill) */}
              <View style={styles.backRow}>
                <TouchableOpacity
                  style={styles.backButton}
                  onPress={onClose}
                  activeOpacity={0.7}
                >
                  <Ionicons name="chevron-back" size={16} color={FIGMA.textPrimary} />
                  <Text style={styles.backButtonText}>Back</Text>
                </TouchableOpacity>
              </View>

              {/* Avatar + change picture link */}
              <View style={styles.avatarWrap}>
                <View style={styles.avatarRing}>
                  {avatarUrl ? (
                    <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
                  ) : (
                    <View style={[styles.avatarImage, styles.avatarPlaceholder]}>
                      <Ionicons name="person" size={48} color="#C5C5C5" />
                    </View>
                  )}
                </View>
                <Text style={styles.changeProfileLink}>Change profile picture</Text>
              </View>

              {/* White rounded content panel */}
              <View style={styles.contentPanel}>
                {/* Personal information */}
                <Section title="Personal information">
                  <View style={styles.fieldsContainer}>
                    <InlineField label="Nickname" value={nickname} />
                    <InlineField label="where do you live?" value={country} />
                  </View>
                </Section>

                {/* Travel information */}
                <Section title="Travel information">
                  <View style={styles.cardsContainer}>
                    <EditCard
                      thumbnailIcon="albums-outline"
                      thumbnailTint="#0788B0"
                      label="Surf Style"
                      value={surfStyleLabel}
                    />
                    <EditCard
                      thumbnailIcon="airplane-outline"
                      thumbnailTint="#E8A43E"
                      label="Travel Experience"
                      value={travelExperienceLabel}
                    />
                    <EditCard
                      thumbnailIcon="play-circle-outline"
                      thumbnailTint="#3B82F6"
                      label="Surf Skill"
                      value={surfSkillLabel}
                    />
                    <EditCard
                      thumbnailIcon="location-outline"
                      thumbnailTint="#10B981"
                      label="Local Break"
                      value="Not set"
                    />
                  </View>
                </Section>

                {/* Top Destinations */}
                <Section title="Top Destinations">
                  {destinations.length === 0 ? (
                    <Text style={styles.emptyText}>No destinations added yet.</Text>
                  ) : (
                    <View style={styles.cardsContainer}>
                      {destinations.map((dest, idx) => (
                        <EditCard
                          key={`${dest.country}-${idx}`}
                          thumbnailIcon="globe-outline"
                          thumbnailTint="#0788B0"
                          label={dest.country}
                          value={`${dest.time_in_days} Day${dest.time_in_days === 1 ? '' : 's'}`}
                        />
                      ))}
                    </View>
                  )}
                </Section>
              </View>
            </ScrollView>
          </SafeAreaContainer>
        </Animated.View>
      </View>
    </Modal>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <View style={styles.section}>
    <Text style={styles.sectionTitle}>{title}</Text>
    {children}
  </View>
);

const InlineField: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View style={styles.inlineField}>
    <Text style={styles.inlineFieldLabel}>{label}</Text>
    <Text style={styles.inlineFieldValue} numberOfLines={1}>
      {value || '—'}
    </Text>
  </View>
);

const EditCard: React.FC<{
  thumbnailIcon: React.ComponentProps<typeof Ionicons>['name'];
  thumbnailTint: string;
  label: string;
  value: string;
}> = ({ thumbnailIcon, thumbnailTint, label, value }) => (
  <View style={styles.editCard}>
    <View style={[styles.editCardThumb, { backgroundColor: `${thumbnailTint}14` }]}>
      <Ionicons name={thumbnailIcon} size={28} color={thumbnailTint} />
    </View>
    <View style={styles.editCardText}>
      <Text style={styles.editCardLabel}>{label}</Text>
      <Text style={styles.editCardValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
    <Ionicons name="chevron-forward" size={20} color="#B0B0B0" />
  </View>
);

function formatSurfboardType(input?: string): string {
  if (!input) return '—';
  const map: Record<string, string> = {
    shortboard: 'Shortboard',
    mid_length: 'Mid-length',
    longboard: 'Longboard',
    soft_top: 'Soft top',
  };
  return map[input] ?? capitalizeWords(input) ?? '—';
}

function capitalizeWords(input?: string | null): string {
  if (!input) return '';
  return input
    .replace(/_/g, ' ')
    .split(' ')
    .map(w => (w.length ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
  },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    backgroundColor: FIGMA.bg,
  },
  safeArea: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  backRow: {
    paddingHorizontal: 16,
    paddingTop: 6,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    height: 40,
    minWidth: 70,
    paddingLeft: 8,
    paddingRight: 12,
    borderRadius: 48,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: FIGMA.border,
  },
  backButtonText: {
    fontSize: 12,
    lineHeight: 18,
    color: FIGMA.textPrimary,
  },
  avatarWrap: {
    alignItems: 'center',
    marginTop: 24,
    gap: 8,
    zIndex: 2,
  },
  avatarRing: {
    width: 101,
    height: 101,
    borderRadius: 80,
    borderWidth: 6,
    borderColor: '#FFFFFF',
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 80,
  },
  avatarPlaceholder: {
    backgroundColor: '#F0F0F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  changeProfileLink: {
    fontSize: 16,
    lineHeight: 24,
    color: FIGMA.brandTeal,
  },
  contentPanel: {
    marginTop: -38,
    paddingTop: 84,
    paddingHorizontal: 16,
    paddingBottom: 48,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  section: {
    paddingTop: 24,
    gap: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: FIGMA.divider,
    marginTop: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 24,
    color: FIGMA.textPrimary,
  },
  fieldsContainer: {
    paddingHorizontal: 16,
    gap: 16,
  },
  cardsContainer: {
    paddingHorizontal: 16,
    gap: 16,
  },
  inlineField: {
    backgroundColor: FIGMA.fieldBg,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 64,
    justifyContent: 'center',
  },
  inlineFieldLabel: {
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.3,
    color: FIGMA.textSecondary,
  },
  inlineFieldValue: {
    fontSize: 16,
    lineHeight: 24,
    color: FIGMA.textPrimary,
    marginTop: 2,
  },
  editCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 8,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    ...Platform.select({
      web: {
        // @ts-ignore web-only style
        boxShadow: '0px 2px 16px 0px rgba(89, 110, 124, 0.15)',
      },
      ios: {
        shadowColor: '#596E7C',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 16,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  editCardThumb: {
    width: 57,
    height: 57,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editCardText: {
    flex: 1,
    gap: 6,
  },
  editCardLabel: {
    fontSize: 12,
    lineHeight: 14,
    color: FIGMA.textPrimary,
  },
  editCardValue: {
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '700',
    color: FIGMA.textPrimary,
  },
  emptyText: {
    paddingHorizontal: 16,
    fontSize: 14,
    color: FIGMA.textSecondary,
  },
});

export default ProfileEditPanel;
