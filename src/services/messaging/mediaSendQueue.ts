/**
 * Concurrency-limited queue for chat media uploads (images, videos, files).
 *
 * Why: a multi-item send used to fire every upload at once; N transfers split
 * the uplink so each one crawled past its timeout and the whole batch failed.
 * Optimistic bubbles still appear instantly — only the network transfer waits
 * for a slot. Concurrency 2 keeps one big video from serializing everything
 * while still leaving each transfer most of the bandwidth.
 */
const MAX_CONCURRENT = 2;

let active = 0;
const waiting: Array<() => void> = [];

export function enqueueMediaUpload<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      active++;
      fn().then(resolve, reject).finally(() => {
        active--;
        const next = waiting.shift();
        if (next) next();
      });
    };
    if (active < MAX_CONCURRENT) run();
    else waiting.push(run);
  });
}
