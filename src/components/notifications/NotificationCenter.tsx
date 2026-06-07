import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  PanResponder,
  Alert,
  AccessibilityInfo,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  notificationsService,
  renderNotification,
  formatNotificationTime,
  NotificationRow,
} from '../../services/notifications/notificationsService';
import {
  approveJoinRequest,
  declineJoinRequest,
  approveGearRequest,
  declineGearRequest,
  approveCommitment,
  declineCommitment,
} from '../../services/trips/groupTripsService';

interface Props {
  /** Current user id — used for the realtime filter. Null while logged out. */
  userId: string | null;
  /** Render a bare bell (no dark circle) to sit next to other plain header icons. */
  bare?: boolean;
}

// Strong ease-out (emil): starts fast, feels responsive.
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
// iOS-like drawer curve (Ionic) — for the panel sliding in/out from the edge.
const EASE_DRAWER = Easing.bezier(0.32, 0.72, 0, 1);

// Notifications whose source row is a pending request the admin can act on.
const ACTIONABLE_TYPES = new Set<NotificationRow['type']>([
  'join_request_received',
  'gear_request_received',
  'commitment_request_received',
]);

type Decision = 'approved' | 'declined';

/**
 * Bell button for the conversations header + the notification panel it opens.
 *
 * The panel is a right-side drawer: it slides in from the right edge over a
 * dimmed backdrop and can be dismissed by tapping the backdrop, the back
 * chevron, or swiping it back out to the right. Actionable notifications
 * (join / gear / commitment requests an admin received) carry inline
 * Approve / Decline buttons wired to groupTripsService.
 *
 * Self-contained: owns its fetch, realtime subscription, unread badge and panel.
 * Drop `<NotificationCenter userId={...} />` into the header and that's it.
 */
export const NotificationCenter: React.FC<Props> = ({ userId, bare = false }) => {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  // Full-screen panel — slides in from the right edge over the whole screen.
  const panelWidth = width;

  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  // Id of the notification whose Approve/Decline is currently in flight.
  const [acting, setActing] = useState<string | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);

  // Rows that were unread the moment the panel opened — kept highlighted for the
  // duration of this viewing even after we mark them read.
  const unreadAtOpen = useRef<Set<string>>(new Set());
  // Mirror of `open` for use inside the realtime callback without re-subscribing.
  const openRef = useRef(false);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  // Drawer position: 0 = fully open, `panelWidth` = fully off-screen to the right.
  const translateX = useRef(new Animated.Value(0)).current;
  const dragStartedAt = useRef(0);

  // Backdrop dims in as the panel slides in.
  const backdropOpacity = translateX.interpolate({
    inputRange: [0, panelWidth],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  // ── Respect reduce-motion (emil/a11y): keep the panel, drop the movement ────
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((v) => mounted && setReduceMotion(!!v))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v) =>
      setReduceMotion(!!v)
    );
    return () => {
      mounted = false;
      // @ts-ignore older RN returns void; newer returns a subscription
      sub?.remove?.();
    };
  }, []);

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
    translateX.setValue(panelWidth);
    Animated.timing(translateX, {
      toValue: 0,
      duration: reduceMotion ? 0 : 300,
      easing: EASE_DRAWER,
      useNativeDriver: true,
    }).start();
    loadList();
  }, [translateX, panelWidth, reduceMotion, loadList]);

  const closePanel = useCallback(() => {
    // Exit a touch faster than enter (emil: the system responds quickly).
    Animated.timing(translateX, {
      toValue: panelWidth,
      duration: reduceMotion ? 0 : 240,
      easing: EASE_DRAWER,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setOpen(false);
        unreadAtOpen.current = new Set();
      }
    });
  }, [translateX, panelWidth, reduceMotion]);

  // ── Swipe-to-dismiss: drag the panel out to the right ──────────────────────
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        // Only claim clearly-horizontal drags so the inner ScrollView keeps vertical scroll.
        onMoveShouldSetPanResponder: (_, g) =>
          Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.4,
        onPanResponderGrant: () => {
          dragStartedAt.current = Date.now();
        },
        onPanResponderMove: (_, g) => {
          // Rightward drags track 1:1; leftward over-drag gets heavy friction (no hard wall).
          const dx = g.dx >= 0 ? g.dx : g.dx / 4;
          translateX.setValue(Math.max(dx, -24));
        },
        onPanResponderRelease: (_, g) => {
          const elapsed = Math.max(1, Date.now() - dragStartedAt.current);
          const velocity = g.dx / elapsed; // px/ms, positive = flicking right
          // A far drag OR a quick flick dismisses; otherwise spring back open.
          if (g.dx > panelWidth * 0.4 || velocity > 0.4) {
            closePanel();
          } else {
            Animated.timing(translateX, {
              toValue: 0,
              duration: 200,
              easing: EASE_OUT,
              useNativeDriver: true,
            }).start();
          }
        },
      }),
    [translateX, panelWidth, closePanel]
  );

  // ── Inline Approve / Decline for actionable requests ───────────────────────
  const handleDecision = useCallback(
    async (n: NotificationRow, decision: Decision) => {
      if (acting || !n.entity_id) return;
      setActing(n.id);
      const nowIso = new Date().toISOString();
      // Optimistic: stamp handled + remember the decision for the status label.
      setItems((prev) =>
        prev.map((r) =>
          r.id === n.id ? { ...r, handled_at: nowIso, data: { ...(r.data ?? {}), decision } } : r
        )
      );
      const approved = decision === 'approved';
      try {
        if (n.entity_type === 'join_request') {
          if (approved) await approveJoinRequest(n.entity_id);
          else await declineJoinRequest(n.entity_id);
        } else if (n.entity_type === 'gear_request') {
          if (approved) await approveGearRequest(n.entity_id, 1);
          else await declineGearRequest(n.entity_id);
        } else if (n.entity_type === 'commitment_request') {
          if (!userId) throw new Error('You are not signed in.');
          if (approved) await approveCommitment(n.entity_id, userId);
          else await declineCommitment(n.entity_id, userId);
        }
        notificationsService.markHandled(n.id);
      } catch (e: any) {
        // Revert the optimistic stamp so the buttons come back.
        setItems((prev) =>
          prev.map((r) => (r.id === n.id ? { ...r, handled_at: null } : r))
        );
        Alert.alert('Could not complete', e?.message || 'Please try again.');
      } finally {
        setActing(null);
      }
    },
    [acting, userId]
  );

  return (
    <>
      <TouchableOpacity
        testID="notifications-bell-button"
        style={[styles.bellButton, bare && styles.bellButtonBare]}
        onPress={openPanel}
        activeOpacity={0.7}
        accessibilityLabel="Notifications"
        accessibilityRole="button"
      >
        <Ionicons name="notifications-outline" size={bare ? 24 : 20} color="#FFFFFF" />
        {unread > 0 && (
          <View style={styles.badge}>
            {unread > 1 ? <Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text> : null}
          </View>
        )}
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="none" onRequestClose={closePanel}>
        <View style={styles.modalRoot}>
          {/* Dimmed backdrop (fades with the slide); taps handled by the layer below. */}
          <Animated.View
            style={[styles.backdrop, { opacity: backdropOpacity }]}
            pointerEvents="none"
          />
          {/* Full-screen tap-catcher; the panel renders on top, so only the
              exposed left strip closes on tap. */}
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={closePanel}
            accessibilityLabel="Close notifications"
          />

          <Animated.View
            style={[
              styles.panel,
              {
                width: panelWidth,
                paddingTop: insets.top,
                transform: [{ translateX }],
              },
            ]}
            {...panResponder.panHandlers}
          >
            <View style={styles.panelHeader}>
              <TouchableOpacity
                onPress={closePanel}
                style={styles.backButton}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityLabel="Close notifications"
                accessibilityRole="button"
              >
                <Ionicons name="chevron-back" size={24} color="#222B30" />
              </TouchableOpacity>
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
                contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 24 }]}
              >
                {items.map((n) => (
                  <NotificationItem
                    key={n.id}
                    n={n}
                    isUnread={unreadAtOpen.current.has(n.id)}
                    acting={acting === n.id}
                    disabled={!!acting && acting !== n.id}
                    onDecision={handleDecision}
                  />
                ))}
              </ScrollView>
            )}
          </Animated.View>
        </View>
      </Modal>
    </>
  );
};

// ── Single notification row ──────────────────────────────────────────────────
interface ItemProps {
  n: NotificationRow;
  isUnread: boolean;
  acting: boolean;
  disabled: boolean;
  onDecision: (n: NotificationRow, decision: Decision) => void;
}

const NotificationItem: React.FC<ItemProps> = ({ n, isUnread, acting, disabled, onDecision }) => {
  const r = renderNotification(n);
  const d = n.data ?? {};
  const initial = String(d.actor_name ?? '').trim().charAt(0).toUpperCase();
  const isActionable = ACTIONABLE_TYPES.has(n.type) && !n.handled_at;
  // A request notification that's been resolved shows its outcome instead of buttons.
  const resolvedDecision: Decision | null =
    ACTIONABLE_TYPES.has(n.type) && n.handled_at
      ? d.decision === 'approved'
        ? 'approved'
        : d.decision === 'declined'
        ? 'declined'
        : null
      : null;

  return (
    <View style={[styles.row, isUnread && styles.rowUnread]}>
      <View style={styles.avatar}>
        {initial ? (
          <Text style={styles.avatarInitial}>{initial}</Text>
        ) : (
          <Ionicons name={r.icon as any} size={18} color="#222B30" />
        )}
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowTitleLine}>
          <Text style={styles.rowTitle} numberOfLines={2}>
            {r.title}
          </Text>
          <Text style={styles.rowTime}>{formatNotificationTime(n.created_at)}</Text>
        </View>
        {!!r.body && (
          <Text style={styles.rowText} numberOfLines={2}>
            {r.body}
          </Text>
        )}

        {isActionable && (
          <View style={styles.actions}>
            <Pressable
              onPress={() => onDecision(n, 'approved')}
              disabled={disabled || acting}
              style={({ pressed }) => [
                styles.actionBtn,
                styles.approveBtn,
                pressed && styles.btnPressed,
                (disabled || acting) && styles.btnDisabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Approve"
            >
              {acting ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.approveText}>Approve</Text>
              )}
            </Pressable>
            <Pressable
              onPress={() => onDecision(n, 'declined')}
              disabled={disabled || acting}
              style={({ pressed }) => [
                styles.actionBtn,
                styles.declineBtn,
                pressed && styles.btnPressed,
                (disabled || acting) && styles.btnDisabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Decline"
            >
              <Text style={styles.declineText}>Decline</Text>
            </Pressable>
          </View>
        )}

        {resolvedDecision && (
          <Text
            style={[
              styles.statusText,
              resolvedDecision === 'approved' ? styles.statusApproved : styles.statusDeclined,
            ]}
          >
            {resolvedDecision === 'approved' ? 'Approved' : 'Declined'}
          </Text>
        )}
      </View>
      {isUnread && <View style={styles.unreadDot} />}
    </View>
  );
};

const styles = StyleSheet.create({
  // Bell matches the existing headerButton (36x36 #333 circle).
  bellButtonBare: {
    backgroundColor: 'transparent',
  },
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
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  panel: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#FFFFFF',
    shadowColor: '#596E7C',
    shadowOffset: { width: -4, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 16,
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EEF0F2',
    gap: 4,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panelTitle: {
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat-Bold',
    fontSize: 18,
    fontWeight: '700',
    color: '#222B30',
  },
  center: {
    flex: 1,
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
    flex: 1,
  },
  listContent: {
    paddingVertical: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F4F6',
  },
  rowUnread: {
    backgroundColor: '#F4F7FF',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#E6E9ED',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 16,
    fontWeight: '700',
    color: '#596E7C',
  },
  rowBody: {
    flex: 1,
  },
  rowTitleLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  rowTitle: {
    flex: 1,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 14,
    fontWeight: '600',
    color: '#222B30',
    lineHeight: 19,
  },
  rowTime: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 11,
    color: '#9AA3B2',
    marginTop: 2,
  },
  rowText: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 13,
    color: '#596E7C',
    marginTop: 2,
    lineHeight: 17,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  actionBtn: {
    flex: 1,
    height: 38,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  approveBtn: {
    backgroundColor: '#212121',
  },
  declineBtn: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#C9CED4',
  },
  // Press feedback — buttons should feel like they heard the tap (emil).
  btnPressed: {
    transform: [{ scale: 0.97 }],
    opacity: 0.92,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  approveText: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  declineText: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 14,
    fontWeight: '700',
    color: '#222B30',
  },
  statusText: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 8,
  },
  statusApproved: {
    color: '#1E9E5A',
  },
  statusDeclined: {
    color: '#8A93A0',
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
