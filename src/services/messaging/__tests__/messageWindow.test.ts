import { capMessages, MAX_IN_MEMORY_MESSAGES } from '../messageWindow';

const make = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `m${i}` } as any));

describe('capMessages', () => {
  it('returns the array unchanged when at or under the cap', () => {
    const arr = make(10);
    expect(capMessages(arr, 50, 'tail')).toBe(arr);
  });

  it("dropFrom 'head' keeps the newest `max` (drops oldest)", () => {
    const arr = make(60); // chronological: m0 oldest ... m59 newest
    const out = capMessages(arr, 50, 'head');
    expect(out).toHaveLength(50);
    expect(out[0].id).toBe('m10');
    expect(out[49].id).toBe('m59');
  });

  it("dropFrom 'tail' keeps the oldest `max` (drops newest)", () => {
    const arr = make(60);
    const out = capMessages(arr, 50, 'tail');
    expect(out).toHaveLength(50);
    expect(out[0].id).toBe('m0');
    expect(out[49].id).toBe('m49');
  });

  it('exports a sane default cap', () => {
    expect(MAX_IN_MEMORY_MESSAGES).toBeGreaterThanOrEqual(150);
  });
});
