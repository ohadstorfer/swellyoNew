import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Modal,
  ScrollView,
  Animated,
  Easing,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  notificationsService,
  renderNotification,
  formatNotificationTime,
  NotificationRow,
} from '../../services/notifications/notificationsService';

interface Props {
  /** Current user id — used for the realtime filter. Null while logged out. */
  userId: string | null;
}

// Strong ease-out (emil): starts fast, feels responsive. Adapted to RN bezier.
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

/**
 * Bell button for the conversations header + the notification overlay it opens.
 * Self-contained: owns its fetch, realtime subscription, unread badge and panel.
 * Drop `<NotificationCenter userId={...} />` into the header and that's it.
 */
export const NotificationCenter: React.FC<Props> = ({ userId }) => {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  // Rows that were unread the moment the panel opened — kept highlighted for the
  // duration of this viewing even after we mark them read.
  const unreadAtOpen = useRef<Set<string>>(new Set());
  // Mirror of `open` for use inside the realtime callback without re-subscribing.
  const openRef = useRef(false);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  // Panel entrance animation (scale + slight drop from the bell, origin top-right).
  const anim = useRef(new Animated.Value(0)).current;

  // ── Badge count on mount + realtime subscription ───────────────────────────
  useEffect(() => {
    if (!userId) {
      setItems([]);
      setUnread(0);
      return;
    }
    let active = true;
    notificationsService.unreadCount().then((c) => active && setUnread(c));

    const unsubscribe = notificationsService.subscribe(userId, {
      onInsert: (row) => {
        setItems((prev) => (prev.some((r) => r.id === row.id) ? prev : [row, ...prev]));
        if (openRef.current) {
          notificationsService.markRead(row.id); // panel open → treat as seen
        } else {
          setUnread((u) => u + 1);
        }
      },
      onUpdate: (row) => {
        setItems((prev) => prev.map((r) => (r.id === row.id ? row : r)));
      },
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [userId]);

  const loadList = useCallback(async () => {
    setLoading(true);
    const rows = await notificationsService.fetch(50);
    setItems(rows);
    setLoading(false);
    unreadAtOpen.current = new Set(rows.filter((r) => !r.read_at).map((r) => r.id));
    if (unreadAtOpen.current.size > 0) {
      setUnread(0);
      notificationsService.markAllRead();
    }
  }, []);

  const openPanel = useCallback(() => {
    setOpen(true);
    anim.setValue(0);
    Animated.timing(anim, {
      toValue: 1,
      duration: 190,
      easing: EASE_OUT,
      useNativeDriver: true,
    }).start();
    loadList();
  }, [anim, loadList]);

  const closePanel = useCallback(() => {
    // Exit faster than enter (emil: the system responds quickly).
    Animated.timing(anim, {
      toValue: 0,
      duration: 130,
      easing: EASE_OUT,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setOpen(false);
        unreadAtOpen.current = new Set();
      }
    });
  }, [anim]);

  const panelStyle = {
    opacity: anim,
    transform: [
      { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
      { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) },
    ],
  };

  return (
    <>
      <TouchableOpacity
        testID="notifications-bell-button"
        style={styles.bellButton}
        onPress={openPanel}
        activeOpacity={0.7}
        accessibilityLabel="Notifications"
        accessibilityRole="button"
      >
        <Ionicons name="notifications-outline" size={20} color="#FFFFFF" />
        {unread > 0 && (
          <View style={styles.badge}>
            {unread > 1 ? <Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text> : null}
          </View>
        )}
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="none" onRequestClose={closePanel}>
        <View style={styles.modalRoot}>
          {/* Backdrop sits BEHIND the panel — taps on the panel never reach it,
              so the inner ScrollView keeps its gestures. */}
          <Pressable style={styles.backdrop} onPress={closePanel} accessibilityLabel="Close notifications" />

          <Animated.View
            style={[
              styles.panel,
              { top: Platform.OS === 'web' ? 110 : insets.top + 56, right: 16 },
              panelStyle,
            ]}
          >
            <View style={styles.panelHeader}>
              <Text style={styles.panelTitle}>Notifications</Text>
            </View>

            {loading ? (
              <View style={styles.center}>
                <ActivityIndicator size="small" color="#A0A0A0" />
              </View>
            ) : items.length === 0 ? (
              <View style={styles.center}>
                <Ionicons name="notifications-off-outline" size={28} color="#C2C7CE" />
                <Text style={styles.emptyText}>You're all caught up</Text>
              </View>
            ) : (
              <ScrollView
                style={styles.list}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.listContent}
              >
                {items.map((n) => {
                  const r = renderNotification(n);
                  const isUnread = unreadAtOpen.current.has(n.id);
                  return (
                    <View key={n.id} style={[styles.row, isUnread && styles.rowUnread]}>
                      <View style={styles.rowIcon}>
                        <Ionicons name={r.icon as any} size={18} color="#222B30" />
                      </View>
                      <View style={styles.rowBody}>
                        <View style={styles.rowTitleLine}>
                          <Text style={styles.rowTitle} numberOfLines={1}>
                            {r.title}
                          </Text>
                          <Text style={styles.rowTime}>{formatNotificationTime(n.created_at)}</Text>
                        </View>
                        {!!r.body && (
                          <Text style={styles.rowText} numberOfLines={2}>
                            {r.body}
                          </Text>
                        )}
                      </View>
                      {isUnread && <View style={styles.unreadDot} />}
                    </View>
                  );
                })}
              </ScrollView>
            )}
          </Animated.View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  // Bell matches the existing headerButton (36x36 #333 circle).
  bellButton: {
    width: 36,
    height: 36,
    borderRadius: 40,
    backgroundColor: '#333333',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 6,
    right: 6,
    minWidth: 8,
    height: 8,
    paddingHorizontal: 2,
    borderRadius: 8,
    backgroundColor: '#FF3B30',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#333333',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 8,
    fontWeight: '700',
    lineHeight: 9,
  },
  modalRoot: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  panel: {
    position: 'absolute',
    width: 320,
    maxWidth: '92%',
    maxHeight: '72%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    shadowColor: '#596E7C',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 8,
    overflow: 'hidden',
  },
  panelHeader: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#EEF0F2',
  },
  panelTitle: {
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat-Bold',
    fontSize: 16,
    fontWeight: '700',
    color: '#222B30',
  },
  center: {
    paddingVertical: 36,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyText: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 13,
    color: '#7B7B7B',
  },
  list: {
    flexGrow: 0,
  },
  listContent: {
    paddingVertical: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 12,
  },
  rowUnread: {
    backgroundColor: '#F4F7FF',
  },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F1F3F5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: {
    flex: 1,
  },
  rowTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  rowTitle: {
    flex: 1,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 14,
    fontWeight: '600',
    color: '#222B30',
  },
  rowTime: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 11,
    color: '#9AA3B2',
  },
  rowText: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 13,
    color: '#596E7C',
    marginTop: 2,
    lineHeight: 17,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#05BCD3',
    marginTop: 6,
  },
});

export default NotificationCenter;
