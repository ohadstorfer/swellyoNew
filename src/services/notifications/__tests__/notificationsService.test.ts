/**
 * Unit tests for the REAL notification render/format logic.
 *
 * SAFETY: zero network, zero DB. The supabase client is mocked so importing the
 * service never opens a connection — these tests cannot notify any user.
 *
 * Scope: the pure, exported functions `renderNotification` and
 * `formatNotificationTime`. The server-side trigger fan-out (Plane A) is covered
 * by supabase/tests/notifications_test.sql (run against a DB, not here).
 */

// Mock the only side-effecting import so the module loads without a real client.
jest.mock('../../../config/supabase', () => ({ supabase: {} }));

import {
  renderNotification,
  formatNotificationTime,
  type NotificationRow,
  type NotificationType,
} from '../notificationsService';

/** Build a minimal notification row for a given type + data snapshot. */
function row(type: NotificationType, data: Record<string, any> | null): NotificationRow {
  return {
    id: 'n1',
    recipient_id: 'u1',
    trip_id: 't1',
    type,
    audience: 'user',
    actor_id: 'a1',
    entity_type: null,
    entity_id: null,
    data,
    read_at: null,
    handled_at: null,
    created_at: '2026-06-08T00:00:00.000Z',
  };
}

describe('renderNotification — happy path (full snapshot)', () => {
  const full = { actor_name: 'Alice', trip_title: 'Costa Rica Camp', qty: 2, gear_name: 'wetsuit', item_name: 'wetsuit', preview: 'Meet at 7am', decision: 'approved' };

  it('member_joined names the actor and the trip', () => {
    const r = renderNotification(row('member_joined', full));
    expect(r.body).toBe('Alice joined “Costa Rica Camp”.');
    expect(r.icon).toBe('person-add-outline');
  });

  it('gear_claimed includes qty + gear name', () => {
    expect(renderNotification(row('gear_claimed', full)).body).toBe('Alice claimed 2 wetsuit.');
  });

  it('admin_update_posted prefers the preview text', () => {
    expect(renderNotification(row('admin_update_posted', full)).body).toBe('Meet at 7am');
  });

  it('join_request_decided reflects the decision and trip', () => {
    const r = renderNotification(row('join_request_decided', full));
    expect(r.body).toBe('Your request to join “Costa Rica Camp” was approved.');
    expect(r.icon).toBe('checkmark-circle-outline');
  });

  it('join_request_received names requester + trip', () => {
    expect(renderNotification(row('join_request_received', full)).body).toBe('Alice asked to join “Costa Rica Camp”.');
  });

  it('declined decisions flip the wording and icon', () => {
    const r = renderNotification(row('gear_request_decided', { ...full, decision: 'declined' }));
    expect(r.body).toBe('Your request for wetsuit was declined.');
    expect(r.icon).toBe('close-circle-outline');
  });

  it('renders a body+title+icon for every notification type', () => {
    const types: NotificationType[] = [
      'member_joined', 'member_committed', 'gear_claimed', 'admin_update_posted',
      'group_gear_updated', 'personal_gear_updated', 'gear_request_decided',
      'commitment_decided', 'join_request_decided', 'join_request_received',
      'gear_request_received', 'commitment_request_received',
    ];
    for (const t of types) {
      const r = renderNotification(row(t, full));
      expect(r.title.length).toBeGreaterThan(0);
      expect(r.body.length).toBeGreaterThan(0);
      expect(r.icon.length).toBeGreaterThan(0);
    }
  });
});

describe('renderNotification — degraded snapshot (the REAL B1 bug surface)', () => {
  // B1: the DB triggers for *_received / *_decided omit `trip_title` from the
  // snapshot, so the render falls back to the generic "the trip". These tests
  // PIN that contract: render depends on trip_title being present. If the
  // server snapshot is fixed to include trip_title, the happy-path tests above
  // prove the name shows up; here we document the current degraded output.

  it('falls back to "the trip" when trip_title is missing', () => {
    const r = renderNotification(row('join_request_received', { actor_name: 'Bob' }));
    expect(r.body).toBe('Bob asked to join the trip.'); // <-- generic, no trip name (B1)
  });

  it('falls back to "Someone" when actor_name is missing', () => {
    const r = renderNotification(row('member_joined', { trip_title: 'Baleal' }));
    expect(r.body).toBe('Someone joined “Baleal”.');
  });

  it('personal_gear_updated does NOT reference the actor (corrects an audit claim)', () => {
    // The audit agent claimed this renders "Someone updated your gear".
    // The real code renders a trip-scoped sentence with no actor at all.
    const r = renderNotification(row('personal_gear_updated', { trip_title: 'Ericeira' }));
    expect(r.body).toBe('Your gear list for “Ericeira” was updated.');
    expect(r.body).not.toContain('Someone');
  });

  it('null data never throws and yields a usable fallback', () => {
    const r = renderNotification(row('gear_claimed', null));
    expect(r.body).toBe('Someone claimed gear.');
  });

  it('unknown type returns the safe default', () => {
    const r = renderNotification(row('totally_new_type' as NotificationType, null));
    expect(r.title).toBe('Notification');
    expect(r.icon).toBe('notifications-outline');
  });
});

describe('formatNotificationTime', () => {
  const NOW = new Date('2026-06-08T12:00:00.000Z').getTime();
  beforeAll(() => { jest.useFakeTimers().setSystemTime(NOW); });
  afterAll(() => { jest.useRealTimers(); });

  const ago = (ms: number) => new Date(NOW - ms).toISOString();

  it('"now" under a minute', () => expect(formatNotificationTime(ago(30 * 1000))).toBe('now'));
  it('minutes', () => expect(formatNotificationTime(ago(5 * 60 * 1000))).toBe('5m'));
  it('hours', () => expect(formatNotificationTime(ago(3 * 60 * 60 * 1000))).toBe('3h'));
  it('days', () => expect(formatNotificationTime(ago(2 * 24 * 60 * 60 * 1000))).toBe('2d'));
  it('falls back to DD/MM past a week', () => {
    // Shape assertion only — the exact day is timezone-dependent (see below).
    expect(formatNotificationTime('2026-05-01T00:00:00.000Z')).toMatch(/^\d{2}\/\d{2}$/);
  });

  it('B5 fixed: renders the UTC calendar day deterministically', () => {
    // The function now formats the date with UTC getters (getUTCDate/getUTCMonth),
    // so a UTC-midnight timestamp renders the same DD/MM regardless of the machine's
    // timezone. 2026-05-01T00:00:00Z must always render as "01/05".
    expect(formatNotificationTime('2026-05-01T00:00:00.000Z')).toBe('01/05');
  });
});
