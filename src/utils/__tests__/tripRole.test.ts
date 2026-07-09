import { isTripHost } from '../tripRole';

const P = (user_id: string, role: 'host' | 'member') => ({ user_id, role });

describe('isTripHost', () => {
  it('is false when userId is null', () => {
    expect(isTripHost({ host_id: 'a' }, [P('a', 'host')], null)).toBe(false);
  });
  it('is true for the primary host even before participants load', () => {
    expect(isTripHost({ host_id: 'a' }, [], 'a')).toBe(true);
  });
  it('is true for a co-host present only in participants', () => {
    expect(isTripHost({ host_id: 'a' }, [P('a', 'host'), P('b', 'host')], 'b')).toBe(true);
  });
  it('is false for a plain member', () => {
    expect(isTripHost({ host_id: 'a' }, [P('a', 'host'), P('c', 'member')], 'c')).toBe(false);
  });
  it('is false for a non-participant', () => {
    expect(isTripHost({ host_id: 'a' }, [P('a', 'host')], 'z')).toBe(false);
  });
  it('is false when trip is null and user not in participants', () => {
    expect(isTripHost(null, [], 'a')).toBe(false);
  });
  it('is true when trip is null but user is a host participant', () => {
    expect(isTripHost(null, [P('a', 'host')], 'a')).toBe(true);
  });
});
