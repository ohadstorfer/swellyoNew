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
  resolveLifestyleKeywordToImageUrl,
} from '../../services/media/imageService';
import { uploadCoverImage, uploadProfileImage } from '../../services/storage/storageService';
import {
  profileVideoUploadTracker,
  useProfileVideoUploadStatus,
} from '../../services/storage/profileVideoUploadTracker';
import { ProfileEditSurfStyleScreen } from './ProfileEditSurfStyleScreen';
import { ProfileEditTravelExperienceScreen } from './ProfileEditTravelExperienceScreen';
import { ProfileEditSurfSkillScreen } from './ProfileEditSurfSkillScreen';
import { ProfileEditSurfVideoScreen } from './ProfileEditSurfVideoScreen';
import { ProfileEditDestinationScreen } from './ProfileEditDestinationScreen';
import { ProfileEditLifestyleScreen } from './ProfileEditLifestyleScreen';
import { LIFESTYLE_ICON_MAP } from '../../utils/lifestyleIconMap';
import { CountrySearchModal } from '../CountrySearchModal';
import { HomeBreakSearchSheet, HomeBreakSelection } from '../HomeBreakSearchSheet';
import AvatarCropModal from '../AvatarCropModal';
import { DateOfBirthSheet } from '../DateOfBirthSheet';
import { calculateAgeFromDOB } from '../../utils/ageCalculation';

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
  | 'lifestyle'
  | 'lifestyleDelete'
  | 'cover'
  | 'avatar'
  | 'nickname'
  | 'countryFrom'
  | 'dateOfBirth'
  | 'homeBreak';

type DestinationEditorIndex = number | 'new' | null;
type LifestyleEditorIndex = number | 'new' | null;

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
  const [showSurfVideoEditor, setShowSurfVideoEditor] = useState(false);
  const [editingDestinationIndex, setEditingDestinationIndex] =
    useState<DestinationEditorIndex>(null);
  const [editingLifestyleIndex, setEditingLifestyleIndex] =
    useState<LifestyleEditorIndex>(null);
  const [savingTarget, setSavingTarget] = useState<SaveTarget | null>(null);
  const [showNicknameModal, setShowNicknameModal] = useState(false);
  const [nicknameDraft, setNicknameDraft] = useState('');
  const [showDobModal, setShowDobModal] = useState(false);
  const [showHomeBreakSheet, setShowHomeBreakSheet] = useState(false);
  const [showOriginModal, setShowOriginModal] = useState(false);
  // Raw URI awaiting crop. `target` decides which upload path runs after crop.
  const [pendingCrop, setPendingCrop] = useState<{ uri: string; target: 'avatar' | 'cover' } | null>(null);
  const translateX = useRef(new Animated.Value(screenWidth)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  // Surf video upload status — driven by uploadProfileVideoS3 / pollForProcessedVideo.
  // Survives unmounting the SurfVideo editor (state lives in a module-level singleton).
  const surfVideoUpload = useProfileVideoUploadStatus(surfer?.user_id ?? null);
  const isSurfVideoUploading =
    surfVideoUpload.status === 'uploading' || surfVideoUpload.status === 'processing';

  useEffect(() => {
    const userId = surfer?.user_id;
    if (!userId) return;
    if (surfVideoUpload.status === 'success') {
      // MediaConvert finished and the Edge Function wrote the new URL — refetch.
      (async () => {
        try {
          const fresh = await supabaseDatabaseService.getSurferByUserId(userId);
          if (fresh) updateProfile(fresh);
        } catch (err) {
          console.warn('[ProfileEditPanel] surf video refetch failed:', err);
        } finally {
          profileVideoUploadTracker.reset(userId);
        }
      })();
    } else if (surfVideoUpload.status === 'failed') {
      Alert.alert(
        'Surf video upload failed',
        surfVideoUpload.error || 'Please try again.',
      );
      profileVideoUploadTracker.reset(userId);
    }
  }, [surfVideoUpload.status, surfVideoUpload.error, surfer?.user_id, updateProfile]);

  const persist = useCallback(
    async (
      target: SaveTarget,
      patch: Parameters<typeof supabaseDatabaseService.saveSurfer>[0],
    ) => {
      setSavingTarget(target);
      try {
        const updated = await supabaseDatabaseService.saveSurfer(patch);
        // PostgREST `.select()` after update sometimes omits or lags JSONB / array
        // columns; merge the payload we sent so ProfileScreen (via context) matches DB.
        const next: SupabaseSurfer = { ...updated };
        if (patch.destinationsArray !== undefined) {
          next.destinations_array = patch.destinationsArray;
        }
        if (patch.lifestyleKeywords !== undefined) {
          next.lifestyle_keywords = patch.lifestyleKeywords;
        }
        if (patch.lifestyleImageUrls !== undefined) {
          next.lifestyle_image_urls = patch.lifestyleImageUrls;
        }
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
    async (selectedVideoId: number) => {
      const idx = Math.max(0, Math.min(3, selectedVideoId));
      // saveSurfer maps 0-4 app-level → 1-5 DB-level and auto-derives
      // surf_level_category + surf_level_description from (surfboardType, surfLevel).
      // Passing the current surfboardType keeps the derivation correct when the
      // user only changes their level. profileVideoUrl is intentionally not
      // touched here — it's owned by the dedicated Surf Video editor.
      await persist('skill', {
        surfLevel: idx,
        surfboardType: surfer?.surfboard_type ?? undefined,
      });
    },
    [persist, surfer?.surfboard_type],
  );

  const handleSurfVideoSave = useCallback(
    async (userVideoUri: string | null) => {
      // Persist the new video URL (or empty string to clear it). The S3
      // upload itself was kicked off inside the editor — this only writes
      // the DB pointer.
      await persist('skill', {
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
          if (dataUrl) setPendingCrop({ uri: dataUrl, target: 'cover' });
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

      // Pick raw — cropping happens in our in-app modal so users see the exact
      // 16:9 frame that will appear on the profile.
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 1,
      });

      const asset = result.assets?.[0];
      const uri = asset?.uri ?? (result as { uri?: string }).uri;
      const canceled = result.canceled === true || (result as { cancelled?: boolean }).cancelled === true;
      if (canceled || !uri) return;

      setPendingCrop({ uri, target: 'cover' });
    } catch (error: any) {
      console.warn('[ProfileEditPanel] expo-image-picker not available:', error);
      Alert.alert('Image Picker Not Available', 'Could not open the photo picker.');
    }
  }, [savingTarget, surfer?.user_id]);

  // Avatar picker mirrors the cover picker above, but with a 1:1 crop and the
  // profile-image upload path. Kept as a parallel handler (instead of a shared
  // helper) so that future cover-only or avatar-only tweaks stay isolated.
  const isAvatarPickerOpenRef = useRef(false);
  const webAvatarInputRef = useRef<HTMLInputElement | null>(null);

  const uploadAvatar = useCallback(
    async (uri: string) => {
      const userId = surfer?.user_id;
      if (!userId) return;
      setSavingTarget('avatar');
      try {
        const result = await uploadProfileImage(uri, userId);
        if (!result.success || !result.url) {
          throw new Error(result.error || 'Upload failed');
        }
        const updated = await supabaseDatabaseService.saveSurfer({ profileImageUrl: result.url });
        updateProfile(updated);
      } catch (err: any) {
        console.error('[ProfileEditPanel] Avatar upload failed:', err);
        Alert.alert('Could not update profile picture', err?.message || 'Please try again.');
      } finally {
        setSavingTarget(null);
      }
    },
    [surfer?.user_id, updateProfile],
  );

  const handlePickAvatar = useCallback(async () => {
    if (savingTarget === 'avatar') return;
    if (!surfer?.user_id) return;

    if (Platform.OS === 'web') {
      if (typeof document === 'undefined' || !document.body) return;
      if (isAvatarPickerOpenRef.current) return;
      isAvatarPickerOpenRef.current = true;

      const input = document.createElement('input') as HTMLInputElement;
      input.type = 'file';
      input.accept = 'image/*';
      Object.assign(input.style, {
        position: 'fixed',
        left: '-9999px',
        opacity: '0',
        pointerEvents: 'none',
      });
      webAvatarInputRef.current = input;

      const cleanup = () => {
        if (webAvatarInputRef.current?.parentNode) {
          webAvatarInputRef.current.parentNode.removeChild(webAvatarInputRef.current);
        }
        webAvatarInputRef.current = null;
        isAvatarPickerOpenRef.current = false;
      };

      input.addEventListener('change', (e: Event) => {
        const target = e.target as HTMLInputElement | null;
        const file = target?.files?.[0];
        cleanup();
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          const dataUrl = ev.target?.result as string | undefined;
          if (dataUrl) setPendingCrop({ uri: dataUrl, target: 'avatar' });
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
            Alert.alert('Permission Required', 'Sorry, we need camera roll permissions to update your photo.');
          }
          return;
        }
      }

      // Pick raw; circular crop UI is rendered in the app, matching how avatar
      // crop works in onboarding and the main profile screen.
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 1,
      });

      const asset = result.assets?.[0];
      const uri = asset?.uri ?? (result as { uri?: string }).uri;
      const canceled = result.canceled === true || (result as { cancelled?: boolean }).cancelled === true;
      if (canceled || !uri) return;

      setPendingCrop({ uri, target: 'avatar' });
    } catch (error: any) {
      console.warn('[ProfileEditPanel] expo-image-picker not available:', error);
      Alert.alert('Image Picker Not Available', 'Could not open the photo picker.');
    }
  }, [savingTarget, surfer?.user_id]);

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

  // Mirrors destination handlers but for lifestyle keywords. The keyword text
  // is the source of truth in `lifestyle_keywords`; `lifestyle_image_urls` maps
  // each keyword to a Pexels image URL and stays in sync (entries are added on
  // save and removed on delete/edit-rename).
  const handleLifestyleSave = useCallback(
    async (keyword: string) => {
      if (editingLifestyleIndex == null) return;
      const baseKeywords = [...(surfer?.lifestyle_keywords ?? [])];
      const baseImages: Record<string, string> = {
        ...((surfer?.lifestyle_image_urls as Record<string, string> | null | undefined) ?? {}),
      };

      let nextKeywords: string[];
      if (editingLifestyleIndex === 'new') {
        if (baseKeywords.length >= 6) return;
        if (!baseImages[keyword]) {
          try {
            const url = await resolveLifestyleKeywordToImageUrl(keyword);
            if (url) baseImages[keyword] = url;
          } catch {
            // Pexels failures fall through to the icon fallback in LifestyleCard.
          }
        }
        nextKeywords = [...baseKeywords, keyword];
      } else {
        const previous = baseKeywords[editingLifestyleIndex];
        if (!previous) return;
        if (previous === keyword) return;
        baseKeywords[editingLifestyleIndex] = keyword;
        if (previous && previous !== keyword) {
          delete baseImages[previous];
        }
        if (!baseImages[keyword]) {
          try {
            const url = await resolveLifestyleKeywordToImageUrl(keyword);
            if (url) baseImages[keyword] = url;
          } catch {
            // see above
          }
        }
        nextKeywords = baseKeywords;
      }

      await persist('lifestyle', {
        lifestyleKeywords: nextKeywords,
        lifestyleImageUrls: Object.keys(baseImages).length ? baseImages : null,
      });
    },
    [persist, editingLifestyleIndex, surfer?.lifestyle_keywords, surfer?.lifestyle_image_urls],
  );

  const handleLifestyleDelete = useCallback(async () => {
    if (typeof editingLifestyleIndex !== 'number') return;
    const baseKeywords = [...(surfer?.lifestyle_keywords ?? [])];
    if (editingLifestyleIndex < 0 || editingLifestyleIndex >= baseKeywords.length) return;
    const baseImages: Record<string, string> = {
      ...((surfer?.lifestyle_image_urls as Record<string, string> | null | undefined) ?? {}),
    };
    const removed = baseKeywords[editingLifestyleIndex];
    baseKeywords.splice(editingLifestyleIndex, 1);
    if (removed) delete baseImages[removed];
    await persist('lifestyleDelete', {
      lifestyleKeywords: baseKeywords,
      lifestyleImageUrls: Object.keys(baseImages).length ? baseImages : null,
    });
  }, [persist, editingLifestyleIndex, surfer?.lifestyle_keywords, surfer?.lifestyle_image_urls]);

  // Keep the inline nickname draft in sync with the current surfer name so
  // we don't show a stale value after saving (or after another save path
  // updates the profile).
  useEffect(() => {
    setNicknameDraft(surfer?.name ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surfer?.name]);

  // Save on blur — revert to the previous value if the user clears the field
  // or if the save fails. No-op when the value hasn't changed.
  const handleNicknameBlur = useCallback(async () => {
    const trimmed = nicknameDraft.trim();
    const original = surfer?.name ?? '';
    if (!trimmed) {
      setNicknameDraft(original);
      return;
    }
    if (trimmed === original) return;
    try {
      await persist('nickname', { name: trimmed });
    } catch {
      setNicknameDraft(original);
    }
  }, [nicknameDraft, persist, surfer?.name]);

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

  const handleDobSave = useCallback(
    async (iso: string) => {
      const calculatedAge = calculateAgeFromDOB(iso);
      if (calculatedAge === null || calculatedAge < 18) {
        Alert.alert('Invalid date', 'You must be at least 18 years old to use Swellyo.');
        return;
      }
      try {
        await persist('dateOfBirth', { dateOfBirth: iso });
        setShowDobModal(false);
      } catch {
        // persist already shows an alert
      }
    },
    [persist],
  );

  const handleHomeBreakSave = useCallback(
    async (selection: HomeBreakSelection) => {
      try {
        await persist('homeBreak', {
          homeBreakPlaceId: selection.placeId,
          homeBreakFull: selection.full,
          homeBreakShort: selection.short,
          homeBreakLocality: selection.locality ?? undefined,
          homeBreakCountry: selection.country ?? undefined,
          homeBreakLat: selection.lat ?? undefined,
          homeBreakLng: selection.lng ?? undefined,
        });
        setShowHomeBreakSheet(false);
      } catch {
        // persist already shows an alert
      }
    },
    [persist],
  );

  // Close any open sub-editor whenever the parent panel itself closes,
  // so that re-opening the panel always lands on the main view.
  useEffect(() => {
    if (!visible) {
      setShowSurfStyleEditor(false);
      setShowTravelExperienceEditor(false);
      setShowSurfSkillEditor(false);
      setEditingDestinationIndex(null);
      setEditingLifestyleIndex(null);
      setPendingCrop(null);
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
  const isUploadingAvatar = savingTarget === 'avatar';

  const boardTypeInfo = getBoardTypeInfo(surfer?.surfboard_type);
  const tripCount =
    typeof surfer?.travel_experience === 'number' ? surfer.travel_experience : null;
  const travelExperienceLabel =
    tripCount == null ? '—' : `surf trip${tripCount === 1 ? '' : 's'}`;
  const tripCountText = tripCount == null ? '—' : String(tripCount);
  const surfSkillLabel = capitalizeWords(surfer?.surf_level_category) || '—';
  const surfSkillThumb = getSurfSkillThumb(surfer?.surfboard_type, surfer?.surf_level);
  const destinations = surfer?.destinations_array ?? [];
  const lifestyleKeywords = surfer?.lifestyle_keywords ?? [];
  const lifestyleImageUrls =
    (surfer?.lifestyle_image_urls as Record<string, string> | null | undefined) ?? null;

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
                <TouchableOpacity
                  onPress={handlePickAvatar}
                  activeOpacity={0.8}
                  disabled={isUploadingAvatar}
                  accessibilityLabel="Change profile picture"
                >
                  <View style={styles.avatarRing}>
                    {avatarUrl ? (
                      <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
                    ) : (
                      <View style={[styles.avatarImage, styles.avatarPlaceholder]}>
                        <Ionicons name="person" size={48} color="#C5C5C5" />
                      </View>
                    )}
                    {isUploadingAvatar ? (
                      <View style={styles.avatarUploadingOverlay}>
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      </View>
                    ) : null}
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handlePickAvatar}
                  activeOpacity={0.7}
                  disabled={isUploadingAvatar}
                  hitSlop={{ top: 8, bottom: 8, left: 16, right: 16 }}
                >
                  <Text style={styles.changeProfileLink}>Change profile picture</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.contentPanel}>
                <Section title="Personal information">
                  <View style={styles.fieldsContainer}>
                    {/* Inline-editable nickname — tap to type, blur to save */}
                    <View style={styles.inlineField}>
                      <Text style={styles.inlineFieldLabel}>Nickname</Text>
                      <TextInput
                        style={styles.inlineFieldInput}
                        value={nicknameDraft}
                        onChangeText={setNicknameDraft}
                        onBlur={handleNicknameBlur}
                        onSubmitEditing={() => Keyboard.dismiss()}
                        placeholder="Add nickname"
                        placeholderTextColor="#A0A0A0"
                        returnKeyType="done"
                        autoCapitalize="words"
                        editable={savingTarget !== 'nickname'}
                      />
                    </View>
                    <InlineField
                      label="Country / State"
                      value={country}
                      onPress={() => setShowOriginModal(true)}
                    />
                    <InlineField
                      label="Date of birth"
                      value={(() => {
                        if (!surfer?.date_of_birth) return '';
                        const m = surfer.date_of_birth.match(/^(\d{4})-(\d{2})-(\d{2})/);
                        if (!m) return surfer.date_of_birth;
                        const monthsShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                        const monthIndex = parseInt(m[2], 10) - 1;
                        const monthName = monthsShort[monthIndex] ?? m[2];
                        const day = parseInt(m[3], 10);
                        const year = m[1];
                        const formatted = `${monthName} ${day}, ${year}`;
                        const age = calculateAgeFromDOB(surfer.date_of_birth);
                        return age !== null ? `${formatted}  ·  ${age} years old` : formatted;
                      })()}
                      onPress={() => setShowDobModal(true)}
                    />
                    <InlineField
                      label="Home break"
                      value={surfer?.home_break_short ?? ''}
                      onPress={() => setShowHomeBreakSheet(true)}
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
                      thumbnailText={tripCountText}
                      label="Travel Experience"
                      value={travelExperienceLabel}
                      onPress={() => setShowTravelExperienceEditor(true)}
                    />
                    <EditCard
                      thumbnail={
                        surfVideoUpload.localThumbnail
                          ? { uri: surfVideoUpload.localThumbnail }
                          : surfer?.profile_video_thumbnail_url
                            ? { uri: surfer.profile_video_thumbnail_url }
                            : surfSkillThumb
                      }
                      thumbnailResize="cover"
                      label="Surf Skill"
                      value={surfSkillLabel}
                      loading={isSurfVideoUploading}
                      onPress={() => setShowSurfSkillEditor(true)}
                    />
                    {/* <EditCard
                      fallbackIcon="location-outline"
                      fallbackTint="#10B981"
                      label="Local Break"
                      value="Not set"
                    /> */}
                  </View>
                  {/* Direct video entry — opens the dedicated Surf Video editor
                      (separate from Surf Skill so editing one doesn't touch the
                      other). */}
                  <TouchableOpacity
                    style={styles.surfVideoLinkRow}
                    onPress={() => setShowSurfVideoEditor(true)}
                    activeOpacity={0.7}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    disabled={isSurfVideoUploading}
                  >
                    <Ionicons
                      name={surfer?.profile_video_url ? 'videocam' : 'videocam-outline'}
                      size={18}
                      color={isSurfVideoUploading ? '#B0B0B0' : FIGMA.brandTeal}
                    />
                    <Text
                      style={[
                        styles.surfVideoLinkText,
                        isSurfVideoUploading && { color: '#B0B0B0' },
                      ]}
                    >
                      {isSurfVideoUploading
                        ? 'Uploading surf video…'
                        : surfer?.profile_video_url
                          ? 'Change surf video'
                          : 'Add surf video'}
                    </Text>
                  </TouchableOpacity>
                </Section>

                <Section title="Where you surfed at">
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

                <Section title="Lifestyle">
                  <View style={styles.destinationsBlock}>
                    {lifestyleKeywords.length === 0 ? (
                      <Text style={styles.emptyText}>No lifestyle interests added yet.</Text>
                    ) : (
                      <View style={styles.cardsContainer}>
                        {lifestyleKeywords.slice(0, 6).map((kw, idx) => (
                          <LifestyleCard
                            key={`${kw}-${idx}`}
                            keyword={kw}
                            imageUrl={lifestyleImageUrls?.[kw] ?? null}
                            onPress={() => setEditingLifestyleIndex(idx)}
                          />
                        ))}
                      </View>
                    )}
                    {lifestyleKeywords.length < 6 ? (
                      <View style={styles.destAddButtonWrap}>
                        <TouchableOpacity
                          style={styles.destAddButton}
                          onPress={() => setEditingLifestyleIndex('new')}
                          activeOpacity={0.75}
                          accessibilityLabel="Add lifestyle interest"
                        >
                          <Ionicons name="add" size={36} color="#4A4A4A" />
                        </TouchableOpacity>
                      </View>
                    ) : null}
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
          onSave={handleSurfSkillSave}
          saving={savingTarget === 'skill'}
        />

        <ProfileEditSurfVideoScreen
          visible={showSurfVideoEditor}
          onClose={() => setShowSurfVideoEditor(false)}
          initialBoardType={surfer?.surfboard_type ?? null}
          initialSurfLevel={surfer?.surf_level ?? 1}
          initialUserVideoUri={surfer?.profile_video_url ?? null}
          userId={surfer?.user_id ?? null}
          onSave={handleSurfVideoSave}
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

        <ProfileEditLifestyleScreen
          visible={editingLifestyleIndex !== null}
          mode={editingLifestyleIndex === 'new' ? 'add' : 'edit'}
          onClose={() => setEditingLifestyleIndex(null)}
          keyword={
            editingLifestyleIndex !== null && editingLifestyleIndex !== 'new'
              ? surfer?.lifestyle_keywords?.[editingLifestyleIndex] ?? null
              : null
          }
          existingKeywords={surfer?.lifestyle_keywords ?? []}
          onSave={handleLifestyleSave}
          saving={savingTarget === 'lifestyle'}
          onDelete={handleLifestyleDelete}
          deleting={savingTarget === 'lifestyleDelete'}
        />

        <AvatarCropModal
          visible={pendingCrop !== null}
          imageUri={pendingCrop?.uri ?? ''}
          // Cover aspect must match the actual rendered cover (full width × 180px
          // tall) so the crop frame shows exactly what'll appear in the profile.
          aspect={pendingCrop?.target === 'cover' ? screenWidth / 180 : 1}
          cropShape={pendingCrop?.target === 'cover' ? 'rect' : 'round'}
          title={pendingCrop?.target === 'cover' ? 'Crop cover photo' : 'Move and scale'}
          onCancel={() => setPendingCrop(null)}
          onConfirm={(croppedUri) => {
            const target = pendingCrop?.target;
            setPendingCrop(null);
            if (!target || !croppedUri) return;
            if (target === 'cover') uploadCover(croppedUri);
            else uploadAvatar(croppedUri);
          }}
        />

        {/* DOB sheet — same bottom-sheet picker used during signup age verification */}
        <DateOfBirthSheet
          visible={showDobModal}
          initialDOB={surfer?.date_of_birth ?? null}
          onClose={() => setShowDobModal(false)}
          onSave={handleDobSave}
          saving={savingTarget === 'dateOfBirth'}
          title="Date of birth"
          subtitle="Update your date of birth."
          saveLabel="Save"
        />

        {/* Home Break picker — same bottom sheet used in onboarding step 4 */}
        <HomeBreakSearchSheet
          visible={showHomeBreakSheet}
          onClose={() => setShowHomeBreakSheet(false)}
          onSelect={handleHomeBreakSave}
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
  /** Renders a centered number/text instead of a thumbnail image. Used for
   *  Travel Experience where we want the trip count to be the visual. */
  thumbnailText?: string;
  fallbackIcon?: React.ComponentProps<typeof Ionicons>['name'];
  fallbackTint?: string;
  /** Renders a spinner overlay on top of the thumbnail. */
  loading?: boolean;
  onPress?: () => void;
};

const EditCard: React.FC<EditCardProps> = ({
  label,
  value,
  thumbnail,
  thumbnailResize = 'cover',
  thumbnailText,
  fallbackIcon,
  fallbackTint = '#0788B0',
  loading = false,
  onPress,
}) => {
  const inner = (
    <>
      <View style={styles.editCardThumb}>
        {thumbnailText !== undefined ? (
          <View style={styles.editCardThumbTextWrap}>
            <Text style={styles.editCardThumbText} numberOfLines={1} adjustsFontSizeToFit>
              {thumbnailText}
            </Text>
          </View>
        ) : thumbnail ? (
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
        {loading && (
          <View style={styles.editCardThumbSpinnerOverlay} pointerEvents="none">
            <ActivityIndicator size="small" color="#FFFFFF" />
          </View>
        )}
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

const LifestyleCard: React.FC<{
  keyword: string;
  imageUrl: string | null;
  onPress?: () => void;
}> = ({ keyword, imageUrl, onPress }) => {
  const [failed, setFailed] = useState(false);
  const showImage = !!imageUrl && !failed;
  const iconName = (LIFESTYLE_ICON_MAP[keyword.toLowerCase()] ?? 'ellipse-outline') as React.ComponentProps<typeof Ionicons>['name'];

  const inner = (
    <>
      <View style={styles.editCardThumb}>
        {showImage ? (
          <Image
            source={{ uri: imageUrl as string }}
            style={styles.editCardThumbImage}
            resizeMode="cover"
            onError={() => setFailed(true)}
          />
        ) : (
          <View style={[styles.editCardIconFallback, { backgroundColor: '#0788B014' }]}>
            <Ionicons name={iconName} size={24} color="#0788B0" />
          </View>
        )}
      </View>
      <View style={styles.editCardText}>
        <Text style={styles.editCardLabel}>{capitalizeWords(keyword)}</Text>
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
  avatarUploadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 80,
  },
  changeProfileLink: {
    fontSize: 16,
    lineHeight: 24,
    color: FIGMA.brandTeal,
  },
  // "Change/Add surf video" link rendered just below the Surf Skill card so
  // users have a one-tap entry to update only their surf video. The 16px
  // horizontal padding matches `cardsContainer` so the link aligns with the
  // edges of the cards above it.
  surfVideoLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    paddingHorizontal: 16,
    alignSelf: 'flex-start',
  },
  surfVideoLinkText: {
    fontSize: 15,
    fontWeight: '500',
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
    minHeight: 80,
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
  // TextInput inside an inline field row (e.g. inline-editable nickname).
  // Matches inlineFieldValue's typography but with input-friendly defaults.
  // No lineHeight — RN's TextInput renders tighter than <Text>, and an
  // explicit lineHeight smaller than the actual font metrics clips
  // descenders. Letting the font handle line metrics + a generous minHeight
  // gives the visible glyph (incl. y/g/p) room to breathe.
  inlineFieldInput: {
    fontSize: 16,
    color: FIGMA.textPrimary,
    paddingVertical: 6,
    paddingHorizontal: 0,
    marginTop: 2,
    minHeight: 40,
    ...(Platform.OS === 'android' && { includeFontPadding: false, textAlignVertical: 'center' as const }),
    ...(Platform.OS === 'web' && {
      // @ts-ignore web-only outline removal
      outlineStyle: 'none' as any,
    }),
  },
  destinationsBlock: {
    width: '100%',
  },
  destAddButtonWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
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
  dobOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  dobSheet: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
  },
  dobTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: FIGMA.textPrimary,
    marginBottom: 8,
  },
  dobButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 12,
  },
  dobButton: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 10,
    minWidth: 96,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dobButtonCancel: {
    backgroundColor: '#F0F0F0',
  },
  dobButtonCancelText: {
    color: '#333',
    fontWeight: '600',
  },
  dobButtonSave: {
    backgroundColor: '#212121',
  },
  dobButtonSaveText: {
    color: '#fff',
    fontWeight: '600',
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
  editCardThumbSpinnerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 8,
  },
  editCardIconFallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  editCardThumbTextWrap: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
  },
  editCardThumbText: {
    fontSize: 28,
    fontWeight: '700',
    color: FIGMA.textPrimary,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
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
