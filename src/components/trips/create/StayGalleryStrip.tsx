// StayGalleryStrip — the stay's extra photos, under its main photo.
//
// A row of square thumbnails with an "add" tile at the end. Each thumbnail
// has an × to remove it. The main photo is NOT in this list: it stays
// accommodation_image_url; these are accommodation_gallery_urls (max 9).
//
// pickStayGalleryPhotos opens the library with multi-select, limited to the
// slots left. No crop: iOS and Android cannot crop when several are picked.
import React from 'react';
import { Alert, Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { textStyle, textStyles } from '../../../theme/typography';

/** Extra photos allowed besides the main one (DB check: group_trips_accommodation_gallery_max). */
export const STAY_GALLERY_MAX = 9;

const THUMB = 72;

const C = {
  accent: '#05BCD3',
  ink: '#333333',
  muted: '#7B7B7B',
  dashed: '#CFCFCF',
  surface: '#FFFFFF',
};

/** Opens the photo library for up to `slots` photos. Returns local uris ([] if cancelled). */
export async function pickStayGalleryPhotos(slots: number): Promise<string[]> {
  if (slots <= 0) return [];
  try {
    // Same rule as the wizard's pickImage: the system photo picker needs no
    // permission (iOS, Android 13+); only older Android asks.
    const usePhotoPicker =
      Platform.OS === 'ios' || (Platform.OS === 'android' && Platform.Version >= 33);
    if (!usePhotoPicker) {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'We need photo library access to pick photos.');
        return [];
      }
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: slots,
      orderedSelection: true,
      quality: 0.85,
    });
    if (result.canceled || !result.assets) return [];
    return result.assets.slice(0, slots).map(a => a.uri);
  } catch (e) {
    console.error('[StayGalleryStrip] pick error:', e);
    return [];
  }
}

export interface StayGalleryStripProps {
  uris: string[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  /** The add tile is hidden until there is a main photo, so the order reads right. */
  disabled?: boolean;
  /** Screen-reader label of the add tile. Defaults to the stay wording. */
  addAccessibilityLabel?: string;
}

export const StayGalleryStrip: React.FC<StayGalleryStripProps> = ({
  uris,
  onAdd,
  onRemove,
  disabled,
  addAccessibilityLabel = 'Add more stay photos',
}) => {
  const canAdd = uris.length < STAY_GALLERY_MAX && !disabled;
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.label}>More photos</Text>
        <Text style={styles.counter}>
          {uris.length} /{STAY_GALLERY_MAX}
        </Text>
      </View>
      {disabled && uris.length === 0 ? (
        <Text style={styles.hint}>Add the main photo first.</Text>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.row}
          keyboardShouldPersistTaps="handled"
        >
          {uris.map((uri, i) => (
            <View key={`${uri}-${i}`} style={styles.thumbWrap}>
              <Image source={{ uri }} style={styles.thumb} resizeMode="cover" />
              <Pressable
                onPress={() => onRemove(i)}
                hitSlop={8}
                style={({ pressed }) => [styles.remove, pressed && styles.removePressed]}
                accessibilityRole="button"
                accessibilityLabel={`Remove photo ${i + 1}`}
              >
                <Ionicons name="close" size={12} color="#FFFFFF" />
              </Pressable>
            </View>
          ))}
          {canAdd && (
            <Pressable
              onPress={onAdd}
              style={({ pressed }) => [styles.add, pressed && styles.addPressed]}
              accessibilityRole="button"
              accessibilityLabel={addAccessibilityLabel}
            >
              <Ionicons name="add" size={22} color={C.accent} />
              <Text style={styles.addText}>Add</Text>
            </Pressable>
          )}
        </ScrollView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  root: { gap: 10 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 4 },
  label: { ...textStyle('MB2', '700'), color: C.ink },
  counter: { ...textStyles.B3, color: C.muted },
  hint: { ...textStyles.B3, color: C.muted },
  row: { gap: 8, paddingVertical: 4, paddingRight: 4 },
  thumbWrap: { width: THUMB, height: THUMB },
  thumb: { width: THUMB, height: THUMB, borderRadius: 12, backgroundColor: '#F2F2F2' },
  remove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removePressed: { transform: [{ scale: 0.92 }] },
  add: {
    width: THUMB,
    height: THUMB,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: C.dashed,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  addPressed: { transform: [{ scale: 0.97 }] },
  addText: { ...textStyles.B3, color: C.accent },
});
