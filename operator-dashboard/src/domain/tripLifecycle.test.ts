import { describe, expect, it } from 'vitest';
import {
  canCompleteTrip,
  isRemindable,
  localToday,
  tripHasStarted,
  tripIsLocked,
} from './tripLifecycle';
import { groupTripInviteUrl, tripShareMessage } from './inviteLinks';

const T = '2026-11-18';
const live = { status: 'published', startDate: '2026-11-10', endDate: '2026-11-25' };

describe('canCompleteTrip', () => {
  it('a host can complete a trip that is underway', () => {
    expect(canCompleteTrip(live, true, T)).toBe(true);
  });
  it('not before it starts', () => {
    expect(canCompleteTrip({ ...live, startDate: '2026-12-01', endDate: '2026-12-10' }, true, T)).toBe(false);
  });
  it('starting today counts as started', () => {
    expect(tripHasStarted({ ...live, startDate: T }, T)).toBe(true);
  });
  it('not once it has ended (the app locks a past trip)', () => {
    expect(canCompleteTrip({ ...live, endDate: '2026-11-17' }, true, T)).toBe(false);
  });
  it('ending today is still live', () => {
    expect(tripIsLocked({ ...live, endDate: T }, T)).toBe(false);
  });
  it('not when cancelled or already completed', () => {
    expect(canCompleteTrip({ ...live, status: 'cancelled' }, true, T)).toBe(false);
    expect(canCompleteTrip({ ...live, status: 'completed' }, true, T)).toBe(false);
  });
  it('not for someone who is not a host', () => {
    expect(canCompleteTrip(live, false, T)).toBe(false);
  });
  it('no dates: the host decides', () => {
    expect(canCompleteTrip({ status: 'published', startDate: null, endDate: null }, true, T)).toBe(true);
  });
  it('localToday is YYYY-MM-DD in local time', () => {
    expect(localToday(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
});

describe('isRemindable', () => {
  it('matches the RPC: not started, overdue, rejected', () => {
    for (const state of ['not_started', 'overdue', 'rejected'])
      expect(isRemindable({ state, reqType: 'upload' })).toBe(true);
    for (const state of ['submitted', 'approved'])
      expect(isRemindable({ state, reqType: 'upload' })).toBe(false);
  });
  it('never a pay row', () => {
    expect(isRemindable({ state: 'not_started', reqType: 'pay' })).toBe(false);
  });
});

describe('share link', () => {
  it('is the app link', () => {
    expect(groupTripInviteUrl('abc-1')).toBe('https://swellyo-invite.netlify.app/?grouptrip=abc-1');
  });
  it('carries the app message', () => {
    expect(tripShareMessage('  ', 'u')).toBe('Yo! check out my trip "my surf trip" on Swellyo! 🌊\nu');
  });
});
