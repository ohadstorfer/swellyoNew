/**
 * The album's "+N" expansion — WhatsApp's album view. A fullscreen dark grid
 * of ALL the album's media (3 columns, send order), reusing AlbumTile so
 * upload states and tap/long-press behave exactly like the bubble's tiles.
 * Tapping a tile hands the message back to the host (which closes this modal
 * and opens the fullscreen viewer).
 */
import React from 'react';
import {
  Modal,
  View,
  FlatList,
  Pressable,
  StyleSheet,
  Platform,
  useWindowDimensions,
  GestureResponderEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import type { Message } from '../services/messaging/messagingService';
import { AlbumTile } from './MediaAlbumBubble';

interface AlbumGridModalProps {
  visible: boolean;
  /** Chronological (oldest first). */
  items: Message[];
  onClose: () => void;
  onPressItem: (message: Message) => void;
  onLongPressItem: (message: Message, event: GestureResponderEvent) => void;
  onRetryItem: (message: Message) => void;
  /**
   * Rendered INSIDE this Modal's tree — the host nests the AlbumMediaViewer
   * here so tapping a tile opens the viewer ON TOP of the grid (which stays
   * open underneath and is returned to on close). Sibling RN Modals can't do
   * this reliably on iOS; nested ones can.
   */
  children?: React.ReactNode;
}

const CloseIcon = () => (
  <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
    <Path
      d="M18 6L6 18M6 6l12 12"
      stroke="#FFFFFF"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

const COLUMNS = 3;
const GAP = 2;

export const AlbumGridModal: React.FC<AlbumGridModalProps> = ({
  visible,
  items,
  onClose,
  onPressItem,
  onLongPressItem,
  onRetryItem,
  children,
}) => {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const tileSize = (width - GAP * (COLUMNS - 1)) / COLUMNS;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent={Platform.OS === 'android'}
    >
      <View style={styles.container}>
        <FlatList
          data={items}
          keyExtractor={(m) => m.client_id || m.id}
          numColumns={COLUMNS}
          columnWrapperStyle={{ gap: GAP }}
          contentContainerStyle={{
            gap: GAP,
            paddingTop: insets.top + 60,
            paddingBottom: insets.bottom + 16,
          }}
          renderItem={({ item }) => (
            <AlbumTile
              message={item}
              size={tileSize}
              onPress={onPressItem}
              onLongPress={onLongPressItem}
              onRetry={onRetryItem}
              borderRadius={0}
            />
          )}
        />
        <View style={[styles.closeButton, { top: insets.top + 12 }]}>
          <Pressable
            style={styles.iconFill}
            onPress={onClose}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Close album"
          >
            <CloseIcon />
          </Pressable>
        </View>
        {/* Nested viewer (see prop docs) — presents over the grid. */}
        {children}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  closeButton: {
    position: 'absolute',
    left: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(40, 40, 40, 0.85)',
    zIndex: 10,
  },
  iconFill: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
