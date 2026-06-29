import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';
import { BottomSheetShell } from './BottomSheetShell';
import { QUICK_REACTION_EMOJIS } from './MessageReactionsBar';
import { getStorageThumbUrl } from '../services/media/imageService';
import { AggregatedReaction } from '../services/messaging/messagingService';
import { colors } from '../styles/theme';

export interface ReactorInfo {
  name?: string;
  avatar?: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Live reactions for the tapped message (re-derived by the parent each render). */
  reactions: AggregatedReaction[];
  currentUserId?: string | null;
  /** user_id -> { name, avatar } resolver (conversation members + message senders). */
  membersById: Map<string, ReactorInfo>;
  /** Emoji whose pill was tapped — pre-selects that filter tab. */
  initialEmoji?: string | null;
  /** Remove the current user's own reaction from this message. */
  onRemoveOwn: () => void;
  /** Add (or switch to) a reaction on this message. */
  onAddReaction: (emoji: string) => void;
}

const SELECTED_TINT = 'rgba(5, 188, 211, 0.12)';
const SELECTED_BORDER = '#05BCD3';

/**
 * WhatsApp-style "who reacted" sheet. Opens when a reaction pill under a message
 * is tapped. Lists every reactor (avatar + name, "You" with a tap-to-remove
 * hint), filterable by emoji, plus an add-reaction row. Rides the shared
 * BottomSheetShell.
 */
export function ReactionsDetailSheet({
  visible,
  onClose,
  reactions,
  currentUserId,
  membersById,
  initialEmoji,
  onRemoveOwn,
  onAddReaction,
}: Props) {
  const insets = useSafeAreaInsets();
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [showPicker, setShowPicker] = useState(false);

  const total = useMemo(
    () => reactions.reduce((sum, r) => sum + r.count, 0),
    [reactions]
  );
  const distinctCount = reactions.length;

  // On open, default the filter to the tapped emoji (or "all" when there are
  // several distinct emojis, or the single emoji when there's just one).
  useEffect(() => {
    if (!visible) return;
    if (initialEmoji && reactions.some(r => r.emoji === initialEmoji)) {
      setActiveFilter(initialEmoji);
    } else if (distinctCount === 1) {
      setActiveFilter(reactions[0].emoji);
    } else {
      setActiveFilter('all');
    }
    setShowPicker(false);
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close automatically once every reaction is gone (e.g. you removed the last).
  useEffect(() => {
    if (visible && total === 0) onClose();
  }, [visible, total, onClose]);

  // Flatten to one row per reactor, current user first.
  const rows = useMemo(() => {
    const source =
      activeFilter === 'all'
        ? reactions
        : reactions.filter(r => r.emoji === activeFilter);
    const flat = source.flatMap(r =>
      r.userIds.map(userId => ({ userId, emoji: r.emoji }))
    );
    flat.sort((a, b) => {
      if (a.userId === currentUserId) return -1;
      if (b.userId === currentUserId) return 1;
      return 0;
    });
    return flat;
  }, [reactions, activeFilter, currentUserId]);

  const renderTab = (key: string, label: string, emoji?: string) => {
    const selected = activeFilter === key;
    return (
      <TouchableOpacity
        key={key}
        activeOpacity={0.7}
        onPress={() => setActiveFilter(key)}
        style={[styles.tab, selected && styles.tabSelected]}
      >
        {emoji ? <Text style={styles.tabEmoji}>{emoji}</Text> : null}
        <Text style={[styles.tabLabel, selected && styles.tabLabelSelected]}>
          {label}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <BottomSheetShell visible={visible} onClose={onClose} backdropColor="rgba(33,33,33,0.6)">
      {({ panHandlers }) => (
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
          {/* Drag zone for swipe-down-to-dismiss: the whole header (handle +
              title), so it's an easy grab target that sits above the scrolling
              tabs/list (which would otherwise fight a downward drag). */}
          <View {...panHandlers}>
            <View style={styles.handleContainer}>
              <View style={styles.handle} />
            </View>

            <Text style={styles.header}>
              {total} {total === 1 ? 'Reaction' : 'Reactions'}
            </Text>
          </View>

          {/* Filter tabs: add-reaction pill, optional "All", then one per emoji. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabsRow}
          >
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => setShowPicker(p => !p)}
              style={[styles.tab, styles.addTab, showPicker && styles.tabSelected]}
            >
              <Ionicons name="happy-outline" size={20} color={colors.textSecondary} />
              <Ionicons name="add" size={14} color={colors.textSecondary} style={styles.addPlus} />
            </TouchableOpacity>

            {distinctCount > 1 && renderTab('all', `All ${total}`)}

            {reactions.map(r => renderTab(r.emoji, String(r.count), r.emoji))}
          </ScrollView>

          {/* Add-reaction quick picker (toggled by the add pill). */}
          {showPicker && (
            <View style={styles.pickerRow}>
              {QUICK_REACTION_EMOJIS.map(emoji => (
                <TouchableOpacity
                  key={emoji}
                  activeOpacity={0.7}
                  onPress={() => {
                    onAddReaction(emoji);
                    setShowPicker(false);
                  }}
                  style={styles.pickerEmojiBtn}
                >
                  <Text style={styles.pickerEmoji}>{emoji}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Reactor list. */}
          <ScrollView style={styles.list} bounces={false}>
            {rows.map(({ userId, emoji }) => {
              const isYou = userId === currentUserId;
              const info = membersById.get(userId);
              const name = isYou ? 'You' : info?.name || 'Member';
              const thumb = getStorageThumbUrl(info?.avatar, 96);
              return (
                <TouchableOpacity
                  key={`${userId}-${emoji}`}
                  activeOpacity={isYou ? 0.6 : 1}
                  disabled={!isYou}
                  onPress={isYou ? onRemoveOwn : undefined}
                  style={styles.reactorRow}
                >
                  {thumb ? (
                    <Image source={{ uri: thumb }} style={styles.avatar} />
                  ) : (
                    <View style={[styles.avatar, styles.avatarPlaceholder]}>
                      <Text style={styles.avatarInitial}>
                        {(name || '?').charAt(0).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <View style={styles.reactorText}>
                    <Text style={styles.reactorName} numberOfLines={1}>
                      {name}
                    </Text>
                    {isYou && <Text style={styles.removeHint}>Tap to remove</Text>}
                  </View>
                  <Text style={styles.reactorEmoji}>{emoji}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}
    </BottomSheetShell>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
  },
  handleContainer: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 4,
  },
  handle: {
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  header: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.textDark,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 14,
  },
  tabsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 8,
    paddingBottom: 4,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 14,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.10)',
    backgroundColor: colors.white,
  },
  addTab: {
    paddingHorizontal: 12,
  },
  addPlus: {
    marginLeft: -4,
    marginTop: -8,
  },
  tabSelected: {
    backgroundColor: SELECTED_TINT,
    borderColor: SELECTED_BORDER,
  },
  tabEmoji: {
    fontSize: 16,
  },
  tabLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  tabLabelSelected: {
    color: SELECTED_BORDER,
  },
  pickerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  pickerEmojiBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.backgroundGray,
  },
  pickerEmoji: {
    fontSize: 24,
    // Emoji are taller than the cap height; without headroom the inherited
    // body lineHeight (22) clips the glyph's top. ~1.35x clears it.
    lineHeight: 32,
  },
  list: {
    marginTop: 12,
    maxHeight: 360,
  },
  reactorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.backgroundGray,
  },
  avatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  reactorText: {
    flex: 1,
    marginLeft: 12,
  },
  reactorName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textDark,
  },
  removeHint: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 1,
  },
  reactorEmoji: {
    fontSize: 22,
    lineHeight: 30,
    marginLeft: 8,
  },
});
