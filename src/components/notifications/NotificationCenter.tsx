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
  ActivityIndicator,
  PanResponder,
  Alert,
  AccessibilityInfo,
  useWindowDimensions,
  PixelRatio,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useFocusEffect } from '@react-navigation/native';
import { pushRootCard } from '../../navigation/navigationRef';
import { Ionicons } from '@expo/vector-icons';
import { getStorageThumbUrl } from '../../services/media/imageService';
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
import { ff } from '../../theme/fonts';

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

  // ONE stable subscription per mounted bell — NOT focus-gated. Focus-gating
  // churned this channel (subscribe + removeChannel on every navigation), which
  // spammed the realtime socket with CLOSED/re-subscribe cycles and heated the
  // device during heavy use. A bell's badge needs to stay live regardless of
  // focus, so keep a stable channel for the bell's lifetime. (The panel below
  // IS focus-gated — it's a single screen, so that's correct there.)
  useEffect(() => {
    if (!userId) return;
    const unsubscribe = notificationsService.subscribe(userId, {
      onInsert: () => setUnread((u) => u + 1),
      onUpdate: () => {},
    });
    return unsubscribe;
  }, [userId]);

  const openPanel = useCallback(() => {
    // Via the root ref — this bell renders inside the `independent`
    // ConversationsStack too, where local dispatches can't reach the root.
    pushRootCard('NotificationsPanel', { userId });
  }, [userId]);

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
 * The notifications screen, rendered as a plain CARD route (see
 * RootNavigator). The navigator owns the slide-in/out and the edge-swipe
 * back gesture. Actionable notifications carry inline Approve / Decline
 * wired to groupTripsService. Trips opened from rows push ON TOP — back
 * returns here.
 */
export const NotificationsPanel: React.FC<PanelProps> = ({ userId, onClose, onOpenTrip }) => {
  const insets = useSafeAreaInsets();

  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(false);
  // Id of the notification whose Approve/Decline is currently in flight.
  const [acting, setActing] = useState<string | null>(null);

  // Rows that were unread the moment the panel opened — kept highlighted for the
  // duration of this viewing even after we mark them read.
  const unreadAtOpen = useRef<Set<string>>(new Set());

  // ── Live inserts/updates while the panel is FOCUSED ──────────────────────
  // The panel is a card that stays mounted in the stack when you open a trip on
  // top of it; focus-gating closes its channel while it's not the visible
  // screen and re-opens on return (see useTripRealtime for the rationale).
  useFocusEffect(
    useCallback(() => {
      if (!userId) {
        setItems([]);
        return;
      }
      const unsubscribe = notificationsService.subscribe(userId, {
        onInsert: (row) => {
          const thumbs = avatarThumbsFor([row]);
          if (thumbs.length) ExpoImage.prefetch(thumbs).catch(() => {});
          setItems((prev) => (prev.some((r) => r.id === row.id) ? prev : [row, ...prev]));
          notificationsService.markRead(row.id); // panel open → treat as seen
        },
        onUpdate: (row) => {
          setItems((prev) => prev.map((r) => (r.id === row.id ? row : r)));
        },
      });
      return unsubscribe;
    }, [userId])
  );

  const loadList = useCallback(async () => {
    setLoading(true);
    const rows = await notificationsService.fetch(50);
    // Warm avatar/trip thumbnails into cache before first paint (near-instant render).
    const thumbs = avatarThumbsFor(rows);
    if (thumbs.length) ExpoImage.prefetch(thumbs).catch(() => {});
    setItems(rows);
    setLoading(false);
    unreadAtOpen.current = new Set(rows.filter((r) => !r.read_at).map((r) => r.id));
    if (unreadAtOpen.current.size > 0) {
      notificationsService.markAllRead();
    }
  }, []);

  // Load on mount; the navigator animates the screen in.
  useEffect(() => {
    loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The route pop animates the slide-out natively.
  const closePanel = onClose;

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
    <View style={styles.panelScreen}>
            <View style={[styles.panelHeader, { paddingTop: insets.top + 8 }]}>
              <TouchableOpacity
                onPress={closePanel}
                style={styles.backButton}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityLabel="Close notifications"
                accessibilityRole="button"
              >
                <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
              </TouchableOpacity>
              <Text style={styles.panelTitle}>Notifications</Text>
              <View style={styles.headerSpacer} />
              {/* Decorative — mirrors the bell that opened this panel (matches Figma). */}
              <View style={styles.headerBell} pointerEvents="none">
                <Ionicons name="notifications-outline" size={24} color="#FFFFFF" />
                <View style={styles.headerBellDot} />
              </View>
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
    </View>
  );
};

// ── Avatar (real photos, stacked) ────────────────────────────────────────────
// Rendered circle size, and the pixel size we request from Supabase's image
// transform endpoint (@2x/@3x, capped) — a ~3 KB thumbnail instead of the
// ~300 KB original, so avatars paint near-instantly and stay disk-cached.
const AVATAR = 52;
const AVATAR_PEEK = 28; // how far the back (trip) circle peeks out behind the actor
const THUMB_PX = Math.min(150, Math.round(AVATAR * PixelRatio.get()));

/** Build the list of thumbnail URLs to warm into cache for a set of rows. */
function avatarThumbsFor(rows: NotificationRow[]): string[] {
  const out: string[] = [];
  for (const r of rows) {
    const a = getStorageThumbUrl(r.data?.actor_avatar_url, THUMB_PX);
    const t = getStorageThumbUrl(r.data?.trip_image_url, THUMB_PX);
    if (a) out.push(a);
    if (t) out.push(t);
  }
  return out;
}

/** One circular remote image (expo-image: memory+disk cache, fade-in). Falls
 *  back to `fallback` (initial/icon) or a plain gray circle on load error. */
const RemoteCircle: React.FC<{ uri: string; style?: any; fallback?: React.ReactNode }> = ({
  uri,
  style,
  fallback,
}) => {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <View style={[styles.avatarCircle, style]}>{fallback}</View>;
  }
  return (
    <ExpoImage
      source={{ uri }}
      style={[styles.avatarCircle, style]}
      contentFit="cover"
      cachePolicy="memory-disk"
      transition={150}
      recyclingKey={uri}
      onError={() => setFailed(true)}
    />
  );
};

/** Actor avatar in front, trip cover peeking behind. Degrades to a single photo,
 *  then to the initial/icon when no photo is available. */
const NotificationAvatar: React.FC<{
  actorUrl?: string | null;
  tripUrl?: string | null;
  initial: string;
  icon: string;
}> = ({ actorUrl, tripUrl, initial, icon }) => {
  const actorThumb = getStorageThumbUrl(actorUrl, THUMB_PX);
  const tripThumb = getStorageThumbUrl(tripUrl, THUMB_PX);

  const fallbackNode = initial ? (
    <Text style={styles.avatarInitial}>{initial}</Text>
  ) : (
    <Ionicons name={icon as any} size={24} color="#596E7C" />
  );

  // Both → stacked cluster (actor in front-left, trip behind-right).
  if (actorThumb && tripThumb) {
    return (
      <View style={styles.avatarCluster}>
        <RemoteCircle uri={tripThumb} style={styles.clusterBack} />
        <RemoteCircle uri={actorThumb} style={styles.clusterFront} fallback={fallbackNode} />
      </View>
    );
  }

  // Single photo (actor preferred). The actor falls back to the initial/icon;
  // a lone trip image just shows the gray circle if it ever fails.
  const single = actorThumb ?? tripThumb;
  if (single) {
    return <RemoteCircle uri={single} fallback={actorThumb ? fallbackNode : null} />;
  }

  // No photo at all (system notifications) → initial / icon.
  return <View style={styles.avatar}>{fallbackNode}</View>;
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
      <NotificationAvatar
        actorUrl={d.actor_avatar_url}
        tripUrl={d.trip_image_url}
        initial={initial}
        icon={r.icon}
      />
      <View style={styles.rowBody}>
        <View style={styles.rowTitleLine}>
          <Text style={styles.rowTitle} numberOfLines={2}>
            {r.title}
          </Text>
          <View style={styles.timeContainer}>
            <Text style={styles.rowTime}>{formatNotificationTime(n.created_at)}</Text>
            {isUnread && <View style={styles.unreadDot} />}
          </View>
        </View>
        {!!r.body && (
          <Text style={[styles.rowText, isUnread && styles.rowTextUnread]} numberOfLines={2}>
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
            {resolvedDecision === 'approved' ? 'Approved!' : 'Declined'}
          </Text>
        )}
      </View>
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
  // Full-screen card route (white, navigator owns slide + swipe-back).
  panelScreen: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  // Dark header bleeds up through the status bar (Figma: Surface/M 07).
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#212121',
    paddingHorizontal: 8,
    paddingBottom: 14,
    gap: 4,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panelTitle: {
    fontFamily: ff('Montserrat', '700'),
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  headerSpacer: {
    flex: 1,
  },
  headerBell: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBellDot: {
    position: 'absolute',
    top: 8,
    right: 9,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#FF3B30',
  },
  center: {
    flex: 1,
    paddingVertical: 36,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyText: {
    fontFamily: ff('Inter', '400'),
    fontSize: 13,
    color: '#7B7B7B',
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingVertical: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 16,
    gap: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#EEEEEE',
  },
  // Unread rows read as a soft fill, not a blue tint (Figma: Surface/M 02).
  rowUnread: {
    backgroundColor: '#F7F7F7',
  },
  // Tap feedback — the row should feel like it heard the press (emil).
  rowPressed: {
    backgroundColor: '#EFEFEF',
  },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    backgroundColor: '#E6E9ED',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Base for a single remote photo circle (gray bg shows under the fade-in).
  avatarCircle: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    backgroundColor: '#E6E9ED',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  // Two overlapping circles: actor in front-left, trip cover peeking behind.
  avatarCluster: {
    width: AVATAR + AVATAR_PEEK,
    height: AVATAR,
  },
  clusterFront: {
    position: 'absolute',
    left: 0,
    top: 0,
    zIndex: 2,
  },
  clusterBack: {
    position: 'absolute',
    left: AVATAR_PEEK,
    top: 0,
    zIndex: 1,
  },
  avatarInitial: {
    fontFamily: ff('Inter', '600'),
    fontSize: 20,
    fontWeight: '600',
    color: '#596E7C',
  },
  rowBody: {
    flex: 1,
    gap: 4,
  },
  rowTitleLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
  },
  rowTitle: {
    flex: 1,
    fontFamily: ff('Inter', '600'),
    fontSize: 14,
    fontWeight: '600',
    color: '#333333',
    lineHeight: 18,
  },
  timeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 1,
  },
  rowTime: {
    fontFamily: ff('Inter', '400'),
    fontSize: 12,
    fontWeight: '400',
    color: '#7B7B7B',
  },
  rowText: {
    fontFamily: ff('Inter', '400'),
    fontSize: 12,
    fontWeight: '400',
    color: '#A0A0A0',
    lineHeight: 16,
  },
  // Unread bodies are slightly darker than read ones (Figma: Text/M 02 vs 03).
  rowTextUnread: {
    color: '#7B7B7B',
  },
  actions: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 8,
  },
  actionBtn: {
    flex: 1,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  approveBtn: {
    backgroundColor: '#212121',
  },
  declineBtn: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#CFCFCF',
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
    fontFamily: ff('Inter', '600'),
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  declineText: {
    fontFamily: ff('Inter', '600'),
    fontSize: 14,
    fontWeight: '600',
    color: '#333333',
  },
  statusText: {
    fontFamily: ff('Inter', '700'),
    fontSize: 14,
    fontWeight: '700',
    marginTop: 4,
  },
  statusApproved: {
    color: '#05BCD3',
  },
  statusDeclined: {
    color: '#8A93A0',
  },
  unreadDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#05BCD3',
  },
});

export default NotificationCenter;
