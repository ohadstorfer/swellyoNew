import {
  attachPanelReducer,
  initialPanelState,
  SEED_KEYBOARD_HEIGHT,
  type PanelState,
} from '../attachPanelMachine';

const open = (s: PanelState = initialPanelState) => attachPanelReducer(s, { type: 'TOGGLE' });

describe('attachPanelReducer', () => {
  it('starts closed at the seed height', () => {
    expect(initialPanelState).toEqual({ open: false, height: SEED_KEYBOARD_HEIGHT });
  });

  it('TOGGLE opens, then closes', () => {
    const opened = open();
    expect(opened.open).toBe(true);
    expect(attachPanelReducer(opened, { type: 'TOGGLE' }).open).toBe(false);
  });

  it('CLOSE is idempotent', () => {
    const closed = attachPanelReducer(open(), { type: 'CLOSE' });
    expect(closed.open).toBe(false);
    expect(attachPanelReducer(closed, { type: 'CLOSE' }).open).toBe(false);
  });

  it('KEYBOARD_SHOWN adopts a real height', () => {
    const s = attachPanelReducer(initialPanelState, { type: 'KEYBOARD_SHOWN', height: 336 });
    expect(s.height).toBe(336);
  });

  it('KEYBOARD_SHOWN ignores a zero height (iPad floating keyboard)', () => {
    const measured = attachPanelReducer(initialPanelState, { type: 'KEYBOARD_SHOWN', height: 336 });
    const zeroed = attachPanelReducer(measured, { type: 'KEYBOARD_SHOWN', height: 0 });
    expect(zeroed.height).toBe(336);
  });

  it('KEYBOARD_SHOWN closes the panel — the deferred unmount', () => {
    const s = attachPanelReducer(open(), { type: 'KEYBOARD_SHOWN', height: 336 });
    expect(s.open).toBe(false);
    expect(s.height).toBe(336);
  });

  it('TOGGLE preserves the measured height', () => {
    const measured = attachPanelReducer(initialPanelState, { type: 'KEYBOARD_SHOWN', height: 336 });
    expect(open(measured).height).toBe(336);
  });
});
