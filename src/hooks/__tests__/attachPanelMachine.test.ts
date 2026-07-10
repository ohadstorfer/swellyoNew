import {
  attachPanelReducer,
  initialPanelState,
  SEED_KEYBOARD_HEIGHT,
  type PanelState,
} from '../attachPanelMachine';

const open = (s: PanelState = initialPanelState) => attachPanelReducer(s, { type: 'TOGGLE' });

describe('attachPanelReducer', () => {
  it('starts closed at the seed height', () => {
    expect(initialPanelState).toEqual({
      open: false,
      height: SEED_KEYBOARD_HEIGHT,
      returningToKeyboard: false,
    });
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

  it('CLOSE on an already-closed panel returns the SAME object', () => {
    // Every chat scroll dispatches CLOSE. Returning a fresh object would re-render
    // the whole chat screen on each drag; returning `state` makes useReducer bail.
    expect(attachPanelReducer(initialPanelState, { type: 'CLOSE' })).toBe(initialPanelState);
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

  describe('returningToKeyboard — the icon must not wait for the animation', () => {
    it('starts false', () => {
      expect(initialPanelState.returningToKeyboard).toBe(false);
    });

    it('KEYBOARD_REQUESTED sets it while the panel stays mounted', () => {
      const s = attachPanelReducer(open(), { type: 'KEYBOARD_REQUESTED' });
      expect(s.returningToKeyboard).toBe(true);
      expect(s.open).toBe(true); // still mounted — the keyboard has not risen yet
    });

    it('KEYBOARD_SHOWN clears it along with the panel', () => {
      const requested = attachPanelReducer(open(), { type: 'KEYBOARD_REQUESTED' });
      const shown = attachPanelReducer(requested, { type: 'KEYBOARD_SHOWN', height: 336 });
      expect(shown.open).toBe(false);
      expect(shown.returningToKeyboard).toBe(false);
    });

    it('KEYBOARD_REQUESTED is a no-op when the panel is closed', () => {
      const s = attachPanelReducer(initialPanelState, { type: 'KEYBOARD_REQUESTED' });
      expect(s).toBe(initialPanelState);
    });

    it('re-opening the panel clears a stale flag', () => {
      const requested = attachPanelReducer(open(), { type: 'KEYBOARD_REQUESTED' });
      const closed = attachPanelReducer(requested, { type: 'CLOSE' });
      expect(closed.returningToKeyboard).toBe(false);
      expect(open(closed).returningToKeyboard).toBe(false);
    });
  });
});
