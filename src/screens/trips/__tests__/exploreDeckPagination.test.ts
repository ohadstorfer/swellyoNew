import { nextCursorFrom, isNearEnd, isAppend } from '../exploreDeckPagination';

describe('explore deck pagination helpers', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ created_at: `t${i}`, id: `id${i}` }));

  it('nextCursorFrom returns last row cursor only when the page is full', () => {
    expect(nextCursorFrom(rows(10), 10)).toEqual({ created_at: 't9', id: 'id9' });
    expect(nextCursorFrom(rows(7), 10)).toBeUndefined();
    expect(nextCursorFrom([], 10)).toBeUndefined();
  });

  it('isNearEnd is true within 2 of the last index', () => {
    expect(isNearEnd(8, 10)).toBe(true);
    expect(isNearEnd(7, 10)).toBe(false);
    expect(isNearEnd(0, 1)).toBe(true);
  });

  it('isAppend detects a grown list with an unchanged prefix', () => {
    const a = [{ id: 'a' }, { id: 'b' }];
    expect(isAppend(a, [...a, { id: 'c' }])).toBe(true);
    expect(isAppend(a, [{ id: 'x' }, { id: 'b' }])).toBe(false);
    expect(isAppend(a, [{ id: 'a' }])).toBe(false);
  });
});
