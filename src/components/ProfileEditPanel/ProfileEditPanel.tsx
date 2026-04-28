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
  ImageBackground,
  ImageSourcePropType,
  Linking,
  Platform,
  ScrollView,
  ActivityIndicator,
  Alert,
  useWindowDimensions,
  TextInput,
  Keyboard,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import {
  SupabaseSurfer,
  supabaseDatabaseService,
} from '../../services/database/supabaseDatabaseService';
import { useUserProfile } from '../../context/UserProfileContext';
import { Images } from '../../assets/images';
import {
  getCountryImageFromStorage,
  getCountryImageFallback,
} from '../../services/media/imageService';
import { uploadCoverImage } from '../../services/storage/storageService';
import { ProfileEditSurfStyleScreen } from './ProfileEditSurfStyleScreen';
import { ProfileEditTravelExperienceScreen } from './ProfileEditTravelExperienceScreen';
import { ProfileEditSurfSkillScreen } from './ProfileEditSurfSkillScreen';
import { ProfileEditDestinationScreen } from './ProfileEditDestinationScreen';
import { CountrySearchModal } from '../CountrySearchModal';

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

type SaveTarget =
  | 'surfStyle'
  | 'travel'
  | 'skill'
  | 'destination'
  | 'destinationDelete'
  | 'cover'
  | 'nickname'
  | 'countryFrom';

type DestinationEditorIndex = number | 'new' | null;

const BOARD_ID_TO_DB: Record<number, string> = {
  0: 'shortboard',
  1: 'mid_length',
  2: 'longboard',
  3: 'soft_top',
};

export const ProfileEditPanel: React.FC<Props> = ({ visible, onClose, surfer }) => {
  const { width: screenWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { updateProfile } = useUserProfile();
  const [mounted, setMounted] = useState(false);
  const [showSurfStyleEditor, setShowSurfStyleEditor] = useState(false);
  const [showTravelExperienceEditor, setShowTravelExperienceEditor] = useState(false);
  const [showSurfSkillEditor, setShowSurfSkillEditor] = useState(false);
  const [editingDestinationIndex, setEditingDestinationIndex] =
    useState<DestinationEditorIndex>(null);
  const [savingTarget, setSavingTarget] = useState<SaveTarget | null>(null);
  const [showNicknameModal, setShowNicknameModal] = useState(false);
  const [nicknameDraft, setNicknameDraft] = useState('');
  const [showOriginModal, setShowOriginModal] = useState(false);
  const translateX = useRef(new Animated.Value(screenWidth)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  const persist = useCallback(
    async (
      target: SaveTarget,
      patch: Parameters<typeof supabaseDatabaseService.saveSurfer>[0],
    ) => {
      setSavingTarget(target);
      try {
        const updated = await supabaseDatabaseService.saveSurfer(patch);
        // PostgREST `.select()` after update sometimes omits or lags `destinations_array`;
        // merge the payload we sent so ProfileScreen (via context) always matches DB.
        const next: SupabaseSurfer =
          patch.destinationsArray !== undefined
            ? { ...updated, destinations_array: patch.destinationsArray }
            : { ...updated };
        updateProfile(next);
      } catch (err) {
        console.error('[ProfileEditPanel] Save failed:', err);
        Alert.alert('Could not save', 'Please try again.');
        throw err;
      } finally {
        setSavingTarget(null);
      }
    },
    [updateProfile],
  );

  const handleSurfStyleSave = useCallback(
    async (boardId: number) => {
      const surfboardType = BOARD_ID_TO_DB[boardId];
      if (!surfboardType) return;
      await persist('surfStyle', { surfboardType });
    },
    [persist],
  );

  const handleTravelExperienceSave = useCallback(
    async (value: number) => {
      await persist('travel', { travelExperience: value });
    },
    [persist],
  );

  const handleSurfSkillSave = useCallback(
    async (selectedVideoId: number, userVideoUri: string | null) => {
      const idx = Math.max(0, Math.min(3, selectedVideoId));
      await persist('skill', {
        // saveSurfer maps 0-4 app-level → 1-5 DB-level and auto-derives
        // surf_level_category + surf_level_description from (surfboardType, surfLevel).
        // Passing the current surfboardType keeps the derivation correct when the
        // user only changes their level.
        surfLevel: idx,
        surfboardType: surfer?.surfboard_type ?? undefined,
        profileVideoUrl: userVideoUri ?? '',
      });
    },
    [persist, surfer?.surfboard_type],
  );

  // Mirrors DirectMessageScreen's image-picker pattern: web uses a transient
  // <input type="file"> + FileReader; native uses expo-image-picker with a
  // permission request (and a "Open Settings" prompt when the user has
  // permanently declined). The picked image is uploaded immediately — no
  // preview/caption step, since covers don't need one.
  const webFileInputRef = useRef<HTMLInputElement | null>(null);
  const isPickerOpenRef = useRef(false);

  const uploadCover = useCallback(
    async (uri: string) => {
      const userId = surfer?.user_id;
      if (!userId) return;
      setSavingTarget('cover');
      try {
        const result = await uploadCoverImage(uri, userId);
        if (!result.success || !result.url) {
          throw new Error(result.error || 'Upload failed');
        }
        const updated = await supabaseDatabaseService.saveSurfer({ coverImageUrl: result.url });
        updateProfile(updated);
      } catch (err: any) {
        console.error('[ProfileEditPanel] Cover upload failed:', err);
        Alert.alert('Could not update cover photo', err?.message || 'Please try again.');
      } finally {
        setSavingTarget(null);
      }
    },
    [surfer?.user_id, updateProfile],
  );

  const handlePickCover = useCallback(async () => {
    if (savingTarget === 'cover') return;
    if (!surfer?.user_id) return;

    if (Platform.OS === 'web') {
      if (typeof document === 'undefined' || !document.body) return;
      if (isPickerOpenRef.current) return;
      isPickerOpenRef.current = true;

      const input = document.createElement('input') as HTMLInputElement;
      input.type = 'file';
      input.accept = 'image/*';
      Object.assign(input.style, {
        position: 'fixed',
        left: '-9999px',
        opacity: '0',
        pointerEvents: 'none',
      });
      webFileInputRef.current = input;

      const cleanup = () => {
        if (webFileInputRef.current?.parentNode) {
          webFileInputRef.current.parentNode.removeChild(webFileInputRef.current);
        }
        webFileInputRef.current = null;
        isPickerOpenRef.current = false;
      };

      input.addEventListener('change', (e: Event) => {
        const target = e.target as HTMLInputElement | null;
        const file = target?.files?.[0];
        cleanup();
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          const dataUrl = ev.target?.result as string | undefined;
          if (dataUrl) uploadCover(dataUrl);
        };
        reader.onerror = () => {
          Alert.alert('Error', 'Could not read the selected file. Please try another.');
        };
        reader.readAsDataURL(file);
      });

      document.body.appendChild(input);
      input.click();
      return;
    }

    try {
      const ImagePicker = require('expo-image-picker');
      const usePhotoPicker = Platform.OS === 'android' && (Platform.Version as number) >= 33;

      if (!usePhotoPicker) {
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
            Alert.alert('Permission Required', 'Sorry, we need camera roll permissions to update your cover.');
          }
          return;
        }
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        // Cover photos are wide; let the user crop to a 16:9 frame so the
        // result fills the cover container without obvious letterboxing.
        allowsEditing: true,
        aspect: [16, 9],
        quality: 1,
      });

      const asset = result.assets?.[0];
      const uri = asset?.uri ?? (result as { uri?: string }).uri;
      const canceled = result.canceled === true || (result as { cancelled?: boolean }).cancelled === true;
      if (canceled || !uri) return;

      uploadCover(uri);
    } catch (error: any) {
      console.warn('[ProfileEditPanel] expo-image-picker not available:', error);
      Alert.alert('Image Picker Not Available', 'Could not open the photo picker.');
    }
  }, [savingTarget, surfer?.user_id, uploadCover]);

  const handleDestinationSave = useCallback(
    async (next: { country: string; time_in_days: number; time_in_text: string }) => {
      if (editingDestinationIndex == null) return;
      const base = [...(surfer?.destinations_array ?? [])];
      if (editingDestinationIndex === 'new') {
        const arr = [
          ...base,
          {
            country: next.country,
            area: [] as string[],
            time_in_days: next.time_in_days,
            time_in_text: next.time_in_text,
          },
        ];
        await persist('destination', { destinationsArray: arr });
        return;
      }
      const existing = base[editingDestinationIndex];
      if (!existing) return;
      base[editingDestinationIndex] = {
        ...existing,
        country: next.country,
        time_in_days: next.time_in_days,
        time_in_text: next.time_in_text,
      };
      await persist('destination', { destinationsArray: base });
    },
    [persist, editingDestinationIndex, surfer?.destinations_array],
  );

  const handleDestinationDelete = useCallback(async () => {
    if (typeof editingDestinationIndex !== 'number') return;
    const base = [...(surfer?.destinations_array ?? [])];
    if (editingDestinationIndex < 0 || editingDestinationIndex >= base.length) return;
    base.splice(editingDestinationIndex, 1);
    await persist('destinationDelete', { destinationsArray: base });
  }, [persist, editingDestinationIndex, surfer?.destinations_array]);

  const handleNicknameSave = useCallback(async () => {
    const trimmed = nicknameDraft.trim();
    if (!trimmed) {
      Alert.alert('Nickname', 'Please enter a nickname.');
      return;
    }
    try {
      await persist('nickname', { name: trimmed });
      setShowNicknameModal(false);
    } catch {
      // persist already alerted
    }
  }, [nicknameDraft, persist]);

  const openNicknameEditor = useCallback(() => {
    setNicknameDraft(surfer?.name ?? '');
    setShowNicknameModal(true);
  }, [surfer?.name]);

  // Close any open sub-editor whenever the parent panel itself closes,
  // so that re-opening the panel always lands on the main view.
  useEffect(() => {
    if (!visible) {
      setShowSurfStyleEditor(false);
      setShowTravelExperienceEditor(false);
      setShowSurfSkillEditor(false);
      setEditingDestinationIndex(null);
    }
  }, [visible]);

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
  const coverSource: ImageSourcePropType = surfer?.cover_image_url
    ? { uri: surfer.cover_image_url }
    : Images.coverImage;
  const isUploadingCover = savingTarget === 'cover';

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
          <SafeAreaContainer style={styles.safeArea} edges={[ 'bottom']}>
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={[
                styles.scrollContent,
                { paddingBottom: Math.max(insets.bottom, 24) + 48 },
              ]}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.coverContainer}>
                <ImageBackground
                  source={coverSource}
                  style={styles.coverImage}
                  resizeMode="cover"
                >
                  <LinearGradient
                    colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.4)']}
                    locations={[0.29059, 0.99702]}
                    style={styles.coverGradient}
                  />
                </ImageBackground>

                <View style={[styles.coverTopRow, { paddingTop: insets.top + 12 }]}>
                  <TouchableOpacity
                    style={styles.backButton}
                    onPress={onClose}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="chevron-back" size={16} color={FIGMA.textPrimary} />
                    <Text style={styles.backButtonText}>Back</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.coverEditButton}
                    onPress={handlePickCover}
                    activeOpacity={0.7}
                    disabled={isUploadingCover}
                    accessibilityLabel="Change cover photo"
                  >
                    {isUploadingCover ? (
                      <ActivityIndicator size="small" color={FIGMA.textPrimary} />
                    ) : (
                      <Ionicons name="camera" size={18} color={FIGMA.textPrimary} />
                    )}
                  </TouchableOpacity>
                </View>
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
                    <InlineField
                      label="Nickname"
                      value={nickname}
                      onPress={openNicknameEditor}
                    />
                    <InlineField
                      label="Where are you from?"
                      value={country}
                      onPress={() => setShowOriginModal(true)}
                    />
                  </View>
                </Section>

                <Section title="Travel information">
                  <View style={styles.cardsContainer}>
                    <EditCard
                      thumbnail={{ uri: boardTypeInfo.imageUrl }}
                      thumbnailResize="contain"
                      label="Surf Style"
                      value={boardTypeInfo.name}
                      onPress={() => setShowSurfStyleEditor(true)}
                    />
                    <EditCard
                      thumbnail={travelLevelImage}
                      thumbnailResize="contain"
                      label="Travel Experience"
                      value={travelExperienceLabel}
                      onPress={() => setShowTravelExperienceEditor(true)}
                    />
                    <EditCard
                      thumbnail={surfSkillThumb}
                      thumbnailResize="cover"
                      label="Surf Skill"
                      value={surfSkillLabel}
                      onPress={() => setShowSurfSkillEditor(true)}
                    />
                    {/* <EditCard
                      fallbackIcon="location-outline"
                      fallbackTint="#10B981"
                      label="Local Break"
                      value="Not set"
                    /> */}
                  </View>
                </Section>

                <Section title="Top Destinations">
                  <View style={styles.destinationsBlock}>
                    {destinations.length === 0 ? (
                      <Text style={styles.emptyText}>No destinations added yet.</Text>
                    ) : (
                      <View style={styles.cardsContainer}>
                        {destinations.map((dest, idx) => (
                          <DestinationCard
                            key={`${dest.country}-${idx}`}
                            country={dest.country}
                            days={dest.time_in_days}
                            onPress={() => setEditingDestinationIndex(idx)}
                          />
                        ))}
                      </View>
                    )}
                    <View style={styles.destAddButtonWrap}>
                      <TouchableOpacity
                        style={styles.destAddButton}
                        onPress={() => setEditingDestinationIndex('new')}
                        activeOpacity={0.75}
                        accessibilityLabel="Add destination"
                      >
                        <Ionicons name="add" size={36} color="#4A4A4A" />
                      </TouchableOpacity>
                    </View>
                  </View>
                </Section>
              </View>
            </ScrollView>
          </SafeAreaContainer>
        </Animated.View>

        <ProfileEditSurfStyleScreen
          visible={showSurfStyleEditor}
          onClose={() => setShowSurfStyleEditor(false)}
          initialBoardType={surfer?.surfboard_type ?? null}
          onSave={handleSurfStyleSave}
          saving={savingTarget === 'surfStyle'}
        />

        <ProfileEditTravelExperienceScreen
          visible={showTravelExperienceEditor}
          onClose={() => setShowTravelExperienceEditor(false)}
          initialValue={surfer?.travel_experience ?? 0}
          onSave={handleTravelExperienceSave}
          saving={savingTarget === 'travel'}
        />

        <ProfileEditSurfSkillScreen
          visible={showSurfSkillEditor}
          onClose={() => setShowSurfSkillEditor(false)}
          initialBoardType={surfer?.surfboard_type ?? null}
          initialSurfLevel={surfer?.surf_level ?? 1}
          initialUserVideoUri={surfer?.profile_video_url ?? null}
          userId={surfer?.user_id ?? null}
          onSave={handleSurfSkillSave}
          saving={savingTarget === 'skill'}
        />

        <ProfileEditDestinationScreen
          visible={editingDestinationIndex !== null}
          mode={editingDestinationIndex === 'new' ? 'add' : 'edit'}
          onClose={() => setEditingDestinationIndex(null)}
          destination={
            editingDestinationIndex !== null && editingDestinationIndex !== 'new'
              ? surfer?.destinations_array?.[editingDestinationIndex] ?? null
              : null
          }
          onSave={handleDestinationSave}
          saving={savingTarget === 'destination'}
          onDelete={handleDestinationDelete}
          deleting={savingTarget === 'destinationDelete'}
        />

        <CountrySearchModal
          visible={showOriginModal}
          selectedCountry={country}
          onSelect={async c => {
            setShowOriginModal(false);
            try {
              await persist('countryFrom', { countryFrom: c });
            } catch {
              // persist surfaced alert
            }
          }}
          onClose={() => setShowOriginModal(false)}
        />

        <Modal
          visible={showNicknameModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowNicknameModal(false)}
        >
          <TouchableOpacity
            style={styles.nicknameOverlay}
            activeOpacity={1}
            onPress={() => {
              Keyboard.dismiss();
              setShowNicknameModal(false);
            }}
          >
            <TouchableOpacity
              style={styles.nicknameCard}
              activeOpacity={1}
              onPress={e => e.stopPropagation()}
            >
              <Text style={styles.nicknameTitle}>Nickname</Text>
              <TextInput
                style={styles.nicknameInput}
                value={nicknameDraft}
                onChangeText={setNicknameDraft}
                placeholder="Your nickname"
                placeholderTextColor={FIGMA.textSecondary}
                autoCapitalize="words"
                autoCorrect={false}
                maxLength={80}
                editable={savingTarget !== 'nickname'}
              />
              <View style={styles.nicknameActions}>
                <TouchableOpacity
                  style={styles.nicknameCancelBtn}
                  onPress={() => setShowNicknameModal(false)}
                  disabled={savingTarget === 'nickname'}
                >
                  <Text style={styles.nicknameCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.nicknameSaveBtn,
                    savingTarget === 'nickname' && styles.nicknameSaveBtnDisabled,
                  ]}
                  onPress={handleNicknameSave}
                  disabled={savingTarget === 'nickname'}
                >
                  {savingTarget === 'nickname' ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.nicknameSaveText}>Save</Text>
                  )}
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
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

const InlineField: React.FC<{ label: string; value: string; onPress?: () => void }> = ({
  label,
  value,
  onPress,
}) => {
  const valueRow = (
    <View style={styles.inlineFieldValueRow}>
      <Text style={styles.inlineFieldValue} numberOfLines={1}>
        {value || '—'}
      </Text>
      {onPress ? (
        <Ionicons name="chevron-forward" size={18} color="#B0B0B0" />
      ) : null}
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity style={styles.inlineField} onPress={onPress} activeOpacity={0.7}>
        <Text style={styles.inlineFieldLabel}>{label}</Text>
        {valueRow}
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.inlineField}>
      <Text style={styles.inlineFieldLabel}>{label}</Text>
      {valueRow}
    </View>
  );
};

type EditCardProps = {
  label: string;
  value: string;
  thumbnail?: ImageSourcePropType | null;
  thumbnailResize?: 'cover' | 'contain';
  fallbackIcon?: React.ComponentProps<typeof Ionicons>['name'];
  fallbackTint?: string;
  onPress?: () => void;
};

const EditCard: React.FC<EditCardProps> = ({
  label,
  value,
  thumbnail,
  thumbnailResize = 'cover',
  fallbackIcon,
  fallbackTint = '#0788B0',
  onPress,
}) => {
  const inner = (
    <>
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
    </>
  );

  if (onPress) {
    return (
      <TouchableOpacity style={styles.editCard} onPress={onPress} activeOpacity={0.7}>
        {inner}
      </TouchableOpacity>
    );
  }

  return <View style={styles.editCard}>{inner}</View>;
};

const DestinationCard: React.FC<{
  country: string;
  days: number;
  onPress?: () => void;
}> = ({ country, days, onPress }) => {
  const primaryUrl = getCountryImageFromStorage(country);
  const [failed, setFailed] = useState(false);
  const imageUri = !failed && primaryUrl ? primaryUrl : getCountryImageFallback(country);

  const inner = (
    <>
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
    </>
  );

  if (onPress) {
    return (
      <TouchableOpacity style={styles.editCard} onPress={onPress} activeOpacity={0.7}>
        {inner}
      </TouchableOpacity>
    );
  }

  return <View style={styles.editCard}>{inner}</View>;
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
    backgroundColor: '#FFFFFF',
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
  coverContainer: {
    height: 180,
    width: '100%',
    position: 'relative',
  },
  coverImage: {
    width: '100%',
    height: '100%',
  },
  coverGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  coverTopRow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
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
  coverEditButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: FIGMA.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarWrap: {
    alignItems: 'center',
    marginTop: -50,
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
  inlineFieldValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  inlineFieldValue: {
    flex: 1,
    fontSize: 16,
    lineHeight: 24,
    color: FIGMA.textPrimary,
  },
  destinationsBlock: {
    width: '100%',
  },
  destAddButtonWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    paddingBottom: 8,
  },
  destAddButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#B8B8B8',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#596E7C',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.12,
        shadowRadius: 8,
      },
      android: { elevation: 2 },
    }),
  },
  nicknameOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  nicknameCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
  },
  nicknameTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: FIGMA.textPrimary,
    marginBottom: 12,
  },
  nicknameInput: {
    borderWidth: 1,
    borderColor: FIGMA.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: FIGMA.textPrimary,
    marginBottom: 20,
  },
  nicknameActions: {
    flexDirection: 'row',
    gap: 12,
  },
  nicknameCancelBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#EEEEEE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  nicknameCancelText: {
    fontSize: 16,
    color: FIGMA.textPrimary,
  },
  nicknameSaveBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#212121',
    alignItems: 'center',
    justifyContent: 'center',
  },
  nicknameSaveBtnDisabled: {
    opacity: 0.7,
  },
  nicknameSaveText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
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
