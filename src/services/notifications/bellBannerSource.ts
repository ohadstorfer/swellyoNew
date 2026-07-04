/**
 * Bridges the notifications realtime hub to the in-app banner: instant bell
 * banners (<1s) instead of waiting for the push queue cron (~1min). The
 * native push still fires later; the foreground gate suppresses it.
 */
import {
  NotificationRow,
  TripDetailFocus,
  isNotificationsScreenOpen,
  renderNotification,
  tripFocusForNotification,
} from './notificationsService';
import { getStorageThumbUrl } from '../media/imageService';
import { showInAppBanner } from './inAppBannerBus';
import { onNotification } from './notificationsRealtimeHub';

const AVATAR_PX = 80;

type Ctx = { userId: string; openTrip: (tripId: string, focus: TripDetailFocus | null) => void };

export function handleBellInsert(row: NotificationRow, ctx: Ctx): void {
  try {
    if (!row?.id || !row.type) return;
    if (row.actor_id && row.actor_id === ctx.userId) return;   // own action
    if (isNotificationsScreenOpen()) return;                    // watching the list live
    const r = renderNotification(row);
    const avatar = row.data?.actor_avatar_url
      ? getStorageThumbUrl(row.data.actor_avatar_url, AVATAR_PX)
      : undefined;
    const tripId = row.trip_id;
    showInAppBanner({
      id: row.id,
      avatarUrl: avatar ?? undefined,
      title: r.title,
      body: r.body,
      onPress: tripId
        ? () => ctx.openTrip(tripId, tripFocusForNotification(row.type, row.data ?? undefined))
        : undefined,
    });
  } catch (e) {
    if (__DEV__) console.warn('[bellBannerSource] skipped malformed row:', e);
  }
}

export function startBellBannerSource(userId: string, openTrip: Ctx['openTrip']): () => void {
  return onNotification({ onInsert: (row) => handleBellInsert(row, { userId, openTrip }) });
}
