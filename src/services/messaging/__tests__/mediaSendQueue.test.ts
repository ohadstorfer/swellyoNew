import { enqueueMediaUpload } from '../mediaSendQueue';

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: any) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe('enqueueMediaUpload', () => {
  it('runs at most 2 tasks concurrently', async () => {
    let running = 0;
    let peak = 0;
    const gates = [deferred<void>(), deferred<void>(), deferred<void>(), deferred<void>()];
    const results = gates.map(g => enqueueMediaUpload(async () => {
      running++; peak = Math.max(peak, running);
      await g.promise;
      running--;
    }));
    await Promise.resolve(); // let the queue start tasks
    expect(peak).toBe(2);
    gates.forEach(g => g.resolve());
    await Promise.all(results);
    expect(peak).toBe(2);
  });

  it('a rejected task frees its slot and propagates the error', async () => {
    const boom = enqueueMediaUpload(async () => { throw new Error('boom'); });
    await expect(boom).rejects.toThrow('boom');
    await expect(enqueueMediaUpload(async () => 42)).resolves.toBe(42);
  });

  it('preserves FIFO start order', async () => {
    const order: number[] = [];
    const gate = deferred<void>();
    const a = enqueueMediaUpload(async () => { order.push(1); await gate.promise; });
    const b = enqueueMediaUpload(async () => { order.push(2); await gate.promise; });
    const c = enqueueMediaUpload(async () => { order.push(3); });
    await Promise.resolve();
    expect(order).toEqual([1, 2]);
    gate.resolve();
    await Promise.all([a, b, c]);
    expect(order).toEqual([1, 2, 3]);
  });
});
