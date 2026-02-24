/**
 * Logout Registry
 * Infrastructure-level handlers for clearing caches and cancelling active work on logout.
 * Scope: storage clears, upload cancel+clear, trip planning clear. No UI-level or cross-feature handlers.
 * executeAll never rejects; every handler error is logged.
 */

export type LogoutHandler = () => void | Promise<void>;

const DEFAULT_TIMEOUT_MS = 5000;

const handlers = new Map<symbol, LogoutHandler>();

/**
 * Register a handler to run on logout. Returns an id for unregister.
 * Handlers registered from providers must unregister on unmount to avoid duplicate runs on remount/hot reload.
 */
export function register(handler: LogoutHandler): symbol {
  const id = Symbol('logoutHandler');
  handlers.set(id, handler);
  return id;
}

/**
 * Unregister a handler by id.
 */
export function unregister(id: symbol): void {
  handlers.delete(id);
}

/**
 * Run all registered handlers. Never rejects; each handler is try/catch wrapped and errors are logged.
 * timeoutMs only stops awaiting (does not abort handlers). When timeout fires, resolve and log.
 */
export function executeAll(options: { timeoutMs?: number } = {}): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const list = Array.from(handlers.values());

  if (list.length === 0) {
    return Promise.resolve();
  }

  const runOne = async (handler: LogoutHandler): Promise<void> => {
    try {
      const result = handler();
      if (result instanceof Promise) {
        await result;
      }
    } catch (err) {
      console.error('[LogoutRegistry] Handler error:', err);
    }
  };

  const runAll = async (): Promise<void> => {
    for (const handler of list) {
      await runOne(handler);
    }
  };

  const timeoutPromise = new Promise<void>((resolve) => {
    setTimeout(() => {
      console.log('[LogoutRegistry] Timeout reached, stopping wait (handlers may still run)');
      resolve();
    }, timeoutMs);
  });

  return Promise.race([runAll(), timeoutPromise]);
}

export const logoutRegistry = {
  register,
  unregister,
  executeAll,
};
