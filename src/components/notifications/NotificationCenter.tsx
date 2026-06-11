import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
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
import { useNavigation, useFocusEffect, StackActions } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  notificationsService,
  renderNotification,
  formatNotificationTime,
  tripFocusForNotification,
  NotificationRow,
  type TripDetailFocus,
} from '../../services/notifications/notificationsService';
import {
  approveJoinRequest,
  declineJoinRequest,
  approveGearRequest,
  declineGearRequest,
  approveCommitment,
  declineCommitment,
} from '../../services/trips/groupTripsService';
import { queryClient } from '../../lib/queryClient';
import { tripsKeys } from '../../hooks/trips/useTripQueries';

interface Props {
  /** Current user id — used for the realtime filter. Null while logged out. */
  userId: string | null;
  /** Render a bare bell (no dark circle) to sit next to other plain header icons. */
  bare?: boolean;
}

interface PanelProps {
  userId: string | null;
  /** Pop the panel route (after the slide-out animation). */
  onClose: () => void;
  /**
   * Tap on a trip notification. The panel does NOT close — it stays in the
   * navigation stack beneath the pushed trip card, so backing out of the
   * trip lands on the still-open panel.
   */
  onOpenTrip?: (tripId: string, focus?: TripDetailFocus) => void;
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
 * Bell button for screen headers. Shows the unread badge and OPENS the
 * notifications panel as a navigation route (`NotificationsPanel` on the
 * root stack) — the panel participates in back history, so a trip opened
 * from a notification returns to the panel on back.
 *
 * Self-contained: owns its badge fetch + realtime subscription. Must render
 * inside a navigator screen (all headers are).
 */
export const NotificationCenter: React.FC<Props> = ({ userId, bare = false }) => {
  const navigation = useNavigation();
  const [unread, setUnread] = useState(0);

  // Badge count: on mount, on every focus regain (the panel marks rows read
  // while this screen is blurred beneath it), and +1 on realtime inserts.
  useFocusEffect(
    useCallback(() => {
      if (!userId) {
        setUnread(0);
        return;
      }
      let active = true;
      notificationsService.unreadCount().then((c) => active && setUnread(c));
      return () => {
        active = false;
      };
    }, [userId])
  );

  useEffect(() => {
    if (!userId) return;
    const unsubscribe = notificationsService.subscribe(userId, {
      onInsert: () => setUnread((u) => u + 1),
      onUpdate: () => {},
    });
    return unsubscribe;
  }, [userId]);

  const openPanel = useCallback(() => {
    navigation.dispatch(StackActions.push('NotificationsPanel', { userId }));
  }, [navigation, userId]);

  return (
    <TouchableOpacity
      testID="notifications-bell-button"
      style={[styles.bellButton, bare && styles.bellButtonBare]}
      onPress={openPanel}
      activeOpacity={0.7}
      accessibilityLabel="Notifications"
      accessibilityRole="button"
    >
      <Ionicons name="notifications-outline" size={bare ? 30 : 20} color="#FFFFFF" />
      {unread > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

/**
 * The notifications drawer, rendered as a transparentModal ROUTE (see
 * RootNavigator). Slides itself in from the right over a dimmed backdrop;
 * dismissed by backdrop tap, the back chevron, a rightward swipe, or
 * hardware back (route pop). Actionable notifications carry inline
 * Approve / Decline wired to groupTripsService.
 */
export const NotificationsPanel: React.FC<PanelProps> = ({ userId, onClose, onOpenTrip }) => {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  // Full-screen panel — slides in from the right edge over the whole screen.
  const panelWidth = width;

  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(false);
  // Id of the notification whose Approve/Decline is currently in flight.
  const [acting, setActing] = useState<string | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);

  // Rows that were unread the moment the panel opened — kept highlighted for the
  // duration of this viewing even after we mark them read.
  const unreadAtOpen = useRef<Set<string>>(new Set());

  // Drawer position: 0 = fully open, `panelWidth` = fully off-screen to the
  // right. Starts off-screen so the first frame has no opaque-backdrop flash.
  const translateX = useRef(new Animated.Value(panelWidth)).current;
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

  // ── Live inserts/updates while the panel is open ─────────────────────────
  useEffect(() => {
    if (!userId) {
      setItems([]);
      return;
    }
    const unsubscribe = notificationsService.subscribe(userId, {
      onInsert: (row) => {
        setItems((prev) => (prev.some((r) => r.id === row.id) ? prev : [row, ...prev]));
        notificationsService.markRead(row.id); // panel open → treat as seen
      },
      onUpdate: (row) => {
        setItems((prev) => prev.map((r) => (r.id === row.id ? row : r)));
      },
    });
    return unsubscribe;
  }, [userId]);

  const loadList = useCallback(async () => {
    setLoading(true);
    const rows = await notificationsService.fetch(50);
    setItems(rows);
    setLoading(false);
    unreadAtOpen.current = new Set(rows.filter((r) => !r.read_at).map((r) => r.id));
    if (unreadAtOpen.current.size > 0) {
      notificationsService.markAllRead();
    }
  }, []);

  // Slide in on mount (the route itself has no nav animation).
  useEffect(() => {
    translateX.setValue(panelWidth);
    Animated.timing(translateX, {
      toValue: 0,
      duration: reduceMotion ? 0 : 300,
      easing: EASE_DRAWER,
      useNativeDriver: true,
    }).start();
    loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closePanel = useCallback(() => {
    // Exit a touch faster than enter (emil: the system responds quickly).
    Animated.timing(translateX, {
      toValue: panelWidth,
      duration: reduceMotion ? 0 : 240,
      easing: EASE_DRAWER,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) onClose();
    });
  }, [translateX, panelWidth, reduceMotion, onClose]);

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

  // ── Tap a row → push its trip card ON TOP of the panel ──────────────────
  // The panel stays mounted in the stack underneath; backing out of the trip
  // returns to it exactly as left.
  const handleRowPress = useCallback(
    (n: NotificationRow) => {
      if (!onOpenTrip || !n.trip_id) return;
      onOpenTrip(n.trip_id, tripFocusForNotification(n.type, n.data));
    },
    [onOpenTrip]
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
        // The decision just changed trip state behind react-query's back —
        // refresh any mounted trip screens (e.g. the host approving from the
        // bell while their own TripDetailScreen sits underneath).
        if (n.trip_id) {
          queryClient.invalidateQueries({ queryKey: tripsKeys.detail(n.trip_id) });
          queryClient.invalidateQueries({ queryKey: tripsKeys.detailRequests(n.trip_id) });
          queryClient.invalidateQueries({ queryKey: tripsKeys.detailGear(n.trip_id) });
          queryClient.invalidateQueries({ queryKey: tripsKeys.detailGearRequests(n.trip_id) });
          queryClient.invalidateQueries({ queryKey: ['trips', 'my'] });
        }
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
                    onPress={onOpenTrip && n.trip_id ? handleRowPress : undefined}
                  />
                ))}
              </ScrollView>
            )}
          </Animated.View>
    </View>
  );
};

// ── Single notification row ──────────────────────────────────────────────────
interface ItemProps {
  n: NotificationRow;
  isUnread: boolean;
  acting: boolean;
  disabled: boolean;
  onDecision: (n: NotificationRow, decision: Decision) => void;
  /** When set, the whole row is tappable and deep-links to its trip. */
  onPress?: (n: NotificationRow) => void;
}

const NotificationItem: React.FC<ItemProps> = ({ n, isUnread, acting, disabled, onDecision, onPress }) => {
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
    <Pressable
      onPress={onPress ? () => onPress(n) : undefined}
      disabled={!onPress}
      style={({ pressed }) => [
        styles.row,
        isUnread && styles.rowUnread,
        pressed && !!onPress && styles.rowPressed,
      ]}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={onPress ? `Open trip — ${r.title}` : undefined}
    >
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
    </Pressable>
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
    top: 2,
    right: 2,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: '#FF3B30',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#212121',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 13,
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
  // Tap feedback — the row should feel like it heard the press (emil).
  rowPressed: {
    backgroundColor: '#EFF2F5',
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
