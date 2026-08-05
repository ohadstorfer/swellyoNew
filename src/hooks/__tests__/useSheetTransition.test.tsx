// Regression tests for the touch-lock hazard: a bottom sheet whose exit
// animation is interrupted must still unmount. If it does not, the Modal stays
// mounted, fully transparent and full-screen, and swallows every touch in the
// app — indistinguishable from a freeze.
//
// Both tests model an interrupted animation the same way: `start()` simply never
// invokes its completion callback, which is exactly what happens when another
// animation seizes the same Animated.Value.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Animated } from 'react-native';
import { useSheetTransition } from '../useSheetTransition';

let latest: ReturnType<typeof useSheetTransition>;

function Probe({ visible }: { visible: boolean }) {
  latest = useSheetTransition(visible, () => {});
  return null;
}

/** Replace parallel() with one whose completion callback is never called. */
function dropAnimationCallbacks() {
  jest.spyOn(Animated, 'parallel').mockReturnValue({ start: () => {} } as any);
}

describe('useSheetTransition', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('unmounts even when the exit animation callback never fires', () => {
    dropAnimationCallbacks();

    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(<Probe visible />);
    });
    expect(latest.mounted).toBe(true);

    act(() => {
      r.update(<Probe visible={false} />);
    });
    // The animation callback never came. Before the fallback existed, `mounted`
    // stayed true here forever.
    expect(latest.mounted).toBe(true);

    act(() => {
      jest.advanceTimersByTime(400);
    });
    expect(latest.mounted).toBe(false);
  });

  it('does not tear down a sheet that re-opened mid-close', () => {
    dropAnimationCallbacks();

    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(<Probe visible />);
    });

    act(() => {
      r.update(<Probe visible={false} />);
    });
    act(() => {
      jest.advanceTimersByTime(100); // still closing
    });

    act(() => {
      r.update(<Probe visible />); // user re-opens
    });
    act(() => {
      jest.advanceTimersByTime(1000); // the stale exit timer would fire in here
    });

    expect(latest.mounted).toBe(true);
  });

  it('leaves no timer behind when the sheet unmounts mid-animation', () => {
    dropAnimationCallbacks();
    const errors: unknown[] = [];
    jest.spyOn(console, 'error').mockImplementation(e => errors.push(e));

    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(<Probe visible />);
    });
    act(() => {
      r.update(<Probe visible={false} />);
    });
    act(() => {
      r.unmount(); // parent drops the sheet before the fallback fires
    });
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    // A surviving timer would setState on a dead component and warn here.
    expect(errors).toHaveLength(0);
  });
});
