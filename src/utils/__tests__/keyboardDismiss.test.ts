const mockRnDismiss = jest.fn();
const mockControllerDismiss = jest.fn();

jest.mock('react-native', () => ({
  Keyboard: { dismiss: mockRnDismiss },
}));
jest.mock('react-native-keyboard-controller', () => ({
  KeyboardController: { dismiss: mockControllerDismiss },
}));

describe('dismissKeyboardNow', () => {
  beforeEach(() => {
    jest.resetModules();
    mockRnDismiss.mockClear();
    mockControllerDismiss.mockClear();
  });

  it('dismisses without animation on a dev build', () => {
    jest.doMock('../keyboardAvoidingView', () => ({ isExpoGo: false }));
    const { dismissKeyboardNow } = require('../keyboardDismiss');
    dismissKeyboardNow();
    expect(mockControllerDismiss).toHaveBeenCalledWith({ animated: false, keepFocus: false });
    expect(mockRnDismiss).not.toHaveBeenCalled();
  });

  it('falls back to RN Keyboard.dismiss in Expo Go', () => {
    jest.doMock('../keyboardAvoidingView', () => ({ isExpoGo: true }));
    const { dismissKeyboardNow } = require('../keyboardDismiss');
    dismissKeyboardNow();
    expect(mockRnDismiss).toHaveBeenCalled();
    expect(mockControllerDismiss).not.toHaveBeenCalled();
  });
});
