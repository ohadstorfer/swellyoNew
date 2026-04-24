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
  ImageSourcePropType,
  Platform,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { SupabaseSurfer } from '../../services/database/supabaseDatabaseService';
import { Images } from '../../assets/images';
import {
  getCountryImageFromStorage,
  getCountryImageFallback,
} from '../../services/media/imageService';

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

// Mirrors BOARD_TYPE_MAP from ProfileScreen.tsx:60 — same hosted surfboard illustrations.
const BOARD_TYPE_MAP: Record<string, { name: string; imageUrl: string }> = {
  shortboard: {
    name: 'Shortboard',
    imageUrl:
      'https://api.builder.io/api/v1/image/assets/TEMP/9761796f6e2272f3cacf14c4fc9342525bb54ff8?width=371',
  },
  mid_length: {
    name: 'Mid-length',
    imageUrl:
      'https://api.builder.io/api/v1/image/assets/TEMP/377f67727b21485479e873ed3d93c57611722f74?width=371',
  },
  longboard: {
    name: 'Longboard',
    imageUrl:
      'https://api.builder.io/api/v1/image/assets/TEMP/4692a28e8ac444a82eec1f691f5f008c8a9bbc8e?width=371',
  },
  soft_top: {
    name: 'Soft top',
    imageUrl:
      'https://api.builder.io/api/v1/image/assets/TEMP/1d104557a7a5ea05c3b36931c1ee56fd01a6d426?width=371',
  },
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

  const boardTypeInfo = getBoardTypeInfo(surfer?.surfboard_type);
  const tripCount =
    typeof surfer?.travel_experience === 'number' ? surfer.travel_experience : null;
  const travelExperienceLabel =
    tripCount == null ? '—' : `${tripCount} surf trip${tripCount === 1 ? '' : 's'}`;
  const travelLevelImage = getTravelLevelImage(tripCount ?? 0);
  const surfSkillLabel = capitalizeWords(surfer?.surf_level_category) || '—';
  const surfSkillThumb = getSurfSkillThumb(surfer?.surfboard_type, surfer?.surf_level);
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

              <View style={styles.contentPanel}>
                <Section title="Personal information">
                  <View style={styles.fieldsContainer}>
                    <InlineField label="Nickname" value={nickname} />
                    <InlineField label="where do you live?" value={country} />
                  </View>
                </Section>

                <Section title="Travel information">
                  <View style={styles.cardsContainer}>
                    <EditCard
                      thumbnail={{ uri: boardTypeInfo.imageUrl }}
                      thumbnailResize="contain"
                      label="Surf Style"
                      value={boardTypeInfo.name}
                    />
                    <EditCard
                      thumbnail={travelLevelImage}
                      thumbnailResize="contain"
                      label="Travel Experience"
                      value={travelExperienceLabel}
                    />
                    <EditCard
                      thumbnail={surfSkillThumb}
                      thumbnailResize="cover"
                      label="Surf Skill"
                      value={surfSkillLabel}
                    />
                    <EditCard
                      fallbackIcon="location-outline"
                      fallbackTint="#10B981"
                      label="Local Break"
                      value="Not set"
                    />
                  </View>
                </Section>

                <Section title="Top Destinations">
                  {destinations.length === 0 ? (
                    <Text style={styles.emptyText}>No destinations added yet.</Text>
                  ) : (
                    <View style={styles.cardsContainer}>
                      {destinations.map((dest, idx) => (
                        <DestinationCard
                          key={`${dest.country}-${idx}`}
                          country={dest.country}
                          days={dest.time_in_days}
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

type EditCardProps = {
  label: string;
  value: string;
  thumbnail?: ImageSourcePropType | null;
  thumbnailResize?: 'cover' | 'contain';
  fallbackIcon?: React.ComponentProps<typeof Ionicons>['name'];
  fallbackTint?: string;
};

const EditCard: React.FC<EditCardProps> = ({
  label,
  value,
  thumbnail,
  thumbnailResize = 'cover',
  fallbackIcon,
  fallbackTint = '#0788B0',
}) => (
  <View style={styles.editCard}>
    <View style={styles.editCardThumb}>
      {thumbnail ? (
        <Image
          source={thumbnail}
          style={styles.editCardThumbImage}
          resizeMode={thumbnailResize}
        />
      ) : fallbackIcon ? (
        <View style={[styles.editCardIconFallback, { backgroundColor: `${fallbackTint}14` }]}>
          <Ionicons name={fallbackIcon} size={28} color={fallbackTint} />
        </View>
      ) : null}
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

const DestinationCard: React.FC<{ country: string; days: number }> = ({ country, days }) => {
  const primaryUrl = getCountryImageFromStorage(country);
  const [failed, setFailed] = useState(false);
  const imageUri = !failed && primaryUrl ? primaryUrl : getCountryImageFallback(country);

  return (
    <View style={styles.editCard}>
      <View style={styles.editCardThumb}>
        <Image
          source={{ uri: imageUri }}
          style={styles.editCardThumbImage}
          resizeMode="cover"
          onError={() => {
            if (!failed) setFailed(true);
          }}
        />
      </View>
      <View style={styles.editCardText}>
        <Text style={styles.editCardLabel}>{country}</Text>
        <Text style={styles.editCardValue} numberOfLines={1}>
          {days} Day{days === 1 ? '' : 's'}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color="#B0B0B0" />
    </View>
  );
};

function getBoardTypeInfo(input?: string): { name: string; imageUrl: string } {
  if (!input) return BOARD_TYPE_MAP.shortboard;
  return BOARD_TYPE_MAP[input.toLowerCase()] ?? BOARD_TYPE_MAP.shortboard;
}

// Mirrors getTravelLevelImage from ProfileScreen.tsx:94.
function getTravelLevelImage(trips: number): ImageSourcePropType {
  if (trips <= 3) return Images.travelLevels.level1;
  if (trips <= 9) return Images.travelLevels.level2;
  if (trips <= 19) return Images.travelLevels.level3;
  return Images.travelLevels.level4;
}

// Per-board thumbnails for the surf-skill row. surf_level (1-4) indexes into
// the board's thumbnail list, same order used by OnboardingStep2Screen's video list.
function getSurfSkillThumb(
  boardType?: string,
  surfLevel?: number,
): ImageSourcePropType | null {
  const level = Math.max(0, Math.min(3, (surfLevel ?? 1) - 1));
  const board = (boardType || 'shortboard').toLowerCase();

  if (board === 'longboard') {
    return [
      Images.surfLevel.longboard.dippingMyToes,
      Images.surfLevel.longboard.cruisingAround,
      Images.surfLevel.longboard.crossStepping,
      Images.surfLevel.longboard.hangingToes,
    ][level];
  }
  if (board === 'mid_length' || board === 'midlength') {
    return [
      Images.surfLevel.midlength.dippingMyToes,
      Images.surfLevel.midlength.cruisingAround,
      Images.surfLevel.midlength.carvingTurns,
      Images.surfLevel.midlength.chargingOrCarving,
    ][level];
  }
  // shortboard + soft_top
  return [
    Images.surfLevel.shortboard.dippingMyToes,
    Images.surfLevel.shortboard.cruisingAround,
    Images.surfLevel.shortboard.snapping,
    Images.surfLevel.shortboard.charging,
  ][level];
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
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  editCardThumbImage: {
    width: '100%',
    height: '100%',
  },
  editCardIconFallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
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
