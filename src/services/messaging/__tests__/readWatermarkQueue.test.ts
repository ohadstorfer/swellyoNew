import { schedule, flush, flushAll, _resetForTests } from '../readWatermarkQueue';

describe('readWatermarkQueue', () => {
  beforeEach(() => { jest.useFakeTimers(); _resetForTests(); });
  afterEach(() => { jest.useRealTimers(); });

  it('coalesces rapid schedules for the same key into one run after the delay', () => {
    const fn = jest.fn();
    schedule('c1', fn, 2000);
    schedule('c1', fn, 2000);
    schedule('c1', fn, 2000);
    expect(fn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(2000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('runs the LATEST scheduled fn for a key', () => {
    const first = jest.fn(); const last = jest.fn();
    schedule('c1', first, 2000);
    schedule('c1', last, 2000);
    jest.advanceTimersByTime(2000);
    expect(first).not.toHaveBeenCalled();
    expect(last).toHaveBeenCalledTimes(1);
  });

  it('flush(key) runs immediately and cancels the timer', () => {
    const fn = jest.fn();
    schedule('c1', fn, 2000);
    flush('c1');
    expect(fn).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(2000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('flushAll runs all pending keys once', () => {
    const a = jest.fn(); const b = jest.fn();
    schedule('c1', a, 2000); schedule('c2', b, 2000);
    flushAll();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});
