import { capMessages, MAX_IN_MEMORY_MESSAGES, mergeLatestWindow } from '../messageWindow';

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

describe('mergeLatestWindow', () => {
  const srv = (id: string, at: string, client_id?: string) =>
    ({ id, client_id: client_id ?? null, created_at: at } as any);
  const window = [srv('s1', '2026-10-21T01:00:00Z', 'c1'), srv('s2', '2026-10-21T01:01:00Z', 'c2')];

  it('keeps a text message that is still sending (id === client_id)', () => {
    const pending = { id: 'c9', client_id: 'c9', created_at: '2026-10-21T00:00:00Z' } as any;
    const out = mergeLatestWindow([window[0], pending], window);
    expect(out.map((m) => m.id)).toEqual(['s1', 's2', 'c9']);
  });

  it('keeps a sent row newer than the server window (reload raced the insert)', () => {
    const sent = srv('s3', '2026-10-21T01:02:00Z', 'c3');
    expect(mergeLatestWindow([sent], window).map((m) => m.id)).toEqual(['s1', 's2', 's3']);
  });

  it('keeps media with an upload in flight', () => {
    const media = { id: 'tmp1', client_id: 'cm', upload_state: 'uploading', created_at: '2026-10-21T00:00:00Z' } as any;
    expect(mergeLatestWindow([media], window).map((m) => m.id)).toEqual(['s1', 's2', 'tmp1']);
  });

  it('does not duplicate a row the server already returned (matched by client_id)', () => {
    const optimistic = { id: 'c2', client_id: 'c2', created_at: '2026-10-21T01:01:00Z' } as any;
    expect(mergeLatestWindow([optimistic], window)).toBe(window);
  });

  it('drops older rows from a scrolled-up window', () => {
    const old = srv('s0', '2026-10-21T00:30:00Z', 'c0');
    expect(mergeLatestWindow([old], window)).toBe(window);
  });

  it('returns the server window as-is when nothing is pending', () => {
    expect(mergeLatestWindow([], window)).toBe(window);
  });
});
