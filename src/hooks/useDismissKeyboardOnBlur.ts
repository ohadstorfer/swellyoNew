import { useCallback } from 'react';
import { Keyboard } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

export function useDismissKeyboardOnBlur(): void {
  useFocusEffect(
    useCallback(() => {
      return () => {
        Keyboard.dismiss();
      };
    }, [])
  );
}
