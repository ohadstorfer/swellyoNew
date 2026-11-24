/**
 * otaGate follows the native updater's state machine. These tests drive that
 * state by hand (expo-updates is mocked) to cover each path the gate can take.
 */

type Ctx = {
  isStartupProcedureRunning: boolean;
  isUpdateAvailable: boolean;
  isUpdatePending: boolean;
  isChecking: boolean;
  isDownloading: boolean;
  lastCheckForUpdateTime?: Date;
  checkError?: Error;
  downloadError?: Error;
};

const baseCtx = (over: Partial<Ctx> = {}): Ctx => ({
  isStartupProcedureRunning: false,
  isUpdateAvailable: false,
  isUpdatePending: false,
  isChecking: false,
  isDownloading: false,
  ...over,
});

type Setup = {
  embedded?: boolean;
  emergency?: boolean;
  ctx?: Ctx;
  remote?: number | 'fail';
  check?: { isAvailable: boolean } | 'fail';
};

function load(setup: Setup) {
  jest.resetModules();
  (global as any).__DEV__ = false;
  const listeners = new Set<(e: { context: Ctx }) => void>();
  const updates = {
    isEnabled: true,
    isEmbeddedLaunch: setup.embedded ?? false,
    isEmergencyLaunch: setup.emergency ?? false,
    latestContext: setup.ctx ?? baseCtx(),
    addUpdatesStateChangeListener: jest.fn((l: (e: { context: Ctx }) => void) => {
      listeners.add(l);
      return { remove: () => listeners.delete(l) };
    }),
    reloadAsync: jest.fn(() => Promise.resolve()),
    checkForUpdateAsync: jest.fn(() =>
      setup.check === 'fail' ? Promise.reject(new Error('net')) : Promise.resolve(setup.check ?? { isAvailable: false }),
    ),
    fetchUpdateAsync: jest.fn(() => Promise.resolve({ isNew: true })),
  };
  jest.doMock('expo-updates', () => updates);
  jest.doMock('react-native', () => ({ Platform: { OS: 'ios' } }));
  jest.doMock('../../../assets/ota/reload-screen.jpg', () => 1, { virtual: true });
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  (global as any).fetch = jest.fn(() =>
    setup.remote === 'fail'
      ? Promise.reject(new Error('net'))
      : Promise.resolve({ ok: true, json: () => Promise.resolve([{ value: setup.remote ?? 0 }]) }),
  );
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const gate = require('../otaGate') as typeof import('../otaGate');
  const phase = () => gate.getOtaGatePhase();
  const emit = (ctx: Ctx) => {
    updates.latestContext = ctx;
    listeners.forEach(l => l({ context: ctx }));
  };
  return { gate, updates, emit, phase };
}

const flush = () => new Promise(r => setImmediate(r));

beforeEach(() => jest.useFakeTimers({ doNotFake: ['setImmediate'] }));
afterEach(() => jest.useRealTimers());

describe('otaGate', () => {
  it('embedded launch: shows Updating while native downloads, reloads when it is in', async () => {
    const { gate, updates, emit, phase } = load({
      embedded: true,
      ctx: baseCtx({ isStartupProcedureRunning: true, isChecking: true }),
    });
    expect(phase()).toBe('checking');
    gate.startOtaGate();
    emit(baseCtx({ isStartupProcedureRunning: true, isDownloading: true, isUpdateAvailable: true }));
    expect(phase()).toBe('waiting');
    emit(baseCtx({ isStartupProcedureRunning: true, isUpdatePending: true }));
    expect(updates.reloadAsync).toHaveBeenCalledTimes(1);
    expect(updates.checkForUpdateAsync).not.toHaveBeenCalled();
  });

  it('embedded launch: native checked and found nothing → idle, no reload', async () => {
    const { gate, updates, emit, phase } = load({
      embedded: true,
      ctx: baseCtx({ isStartupProcedureRunning: true, isChecking: true }),
    });
    gate.startOtaGate();
    emit(baseCtx({ lastCheckForUpdateTime: new Date() }));
    expect(phase()).toBe('idle');
    expect(updates.reloadAsync).not.toHaveBeenCalled();
    expect(updates.checkForUpdateAsync).not.toHaveBeenCalled();
  });

  it('embedded launch: native check errored → own check + fetch → reload', async () => {
    const { gate, updates, emit, phase } = load({
      embedded: true,
      ctx: baseCtx({ isStartupProcedureRunning: true }),
      check: { isAvailable: true },
    });
    gate.startOtaGate();
    emit(baseCtx({ checkError: new Error('timeout'), lastCheckForUpdateTime: new Date() }));
    await flush();
    await flush();
    expect(updates.checkForUpdateAsync).toHaveBeenCalledTimes(1);
    expect(updates.fetchUpdateAsync).toHaveBeenCalledTimes(1);
    expect(updates.reloadAsync).toHaveBeenCalledTimes(1);
    expect(phase()).toBe('waiting');
  });

  it('embedded launch: nothing starts downloading within 8 s → idle', async () => {
    const { gate, updates, phase } = load({
      embedded: true,
      ctx: baseCtx({ isStartupProcedureRunning: true, isChecking: true }),
    });
    gate.startOtaGate();
    jest.advanceTimersByTime(8_000);
    expect(phase()).toBe('idle');
    expect(updates.reloadAsync).not.toHaveBeenCalled();
  });

  it('embedded launch: a download still going at 25 s → idle', async () => {
    const { gate, updates, emit, phase } = load({
      embedded: true,
      ctx: baseCtx({ isStartupProcedureRunning: true, isDownloading: true }),
    });
    gate.startOtaGate();
    emit(baseCtx({ isStartupProcedureRunning: true, isDownloading: true }));
    jest.advanceTimersByTime(24_000);
    expect(phase()).toBe('waiting');
    jest.advanceTimersByTime(1_000);
    expect(phase()).toBe('idle');
    emit(baseCtx({ isUpdatePending: true })); // lands later: next launch, not now
    expect(updates.reloadAsync).not.toHaveBeenCalled();
  });

  it('normal launch, not critical: never held', async () => {
    const { gate, updates, phase } = load({ remote: 0 });
    expect(phase()).toBe('idle');
    gate.startOtaGate();
    await flush();
    expect(phase()).toBe('idle');
    expect(updates.addUpdatesStateChangeListener).not.toHaveBeenCalled();
  });

  it('normal launch, critical: holds the video, reloads into the downloaded update', async () => {
    const { gate, updates, emit, phase } = load({
      remote: 1,
      ctx: baseCtx({ isStartupProcedureRunning: true, isDownloading: true }),
    });
    gate.startOtaGate();
    expect(phase()).toBe('idle');
    await flush();
    expect(phase()).toBe('waiting');
    emit(baseCtx({ isUpdatePending: true }));
    expect(updates.reloadAsync).toHaveBeenCalledTimes(1);
  });

  it('normal launch, remote read fails: never held', async () => {
    const { gate, phase } = load({ remote: 'fail' });
    gate.startOtaGate();
    await flush();
    expect(phase()).toBe('idle');
  });

  it('emergency launch: never waits, never reloads', async () => {
    const { gate, updates, phase } = load({
      embedded: true,
      emergency: true,
      ctx: baseCtx({ isUpdatePending: true }),
    });
    expect(phase()).toBe('idle');
    gate.startOtaGate();
    await flush();
    expect(updates.reloadAsync).not.toHaveBeenCalled();
  });
});
