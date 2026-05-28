// Wraps RN Alert.alert with the discard-confirm UX from the create-trip redesign spec §3.6.
// When `dirty` is false, guardedCancel() fires onDiscard immediately. Otherwise it shows
// the native two-button confirmation matching TripsScreen.tsx:322-332.

import { useCallback } from 'react';
import { Alert } from 'react-native';

export interface UseDiscardConfirmOptions {
  dirty: boolean;
  onDiscard: () => void;
  onKeepEditing?: () => void;
  title?: string;
  message?: string;
  discardLabel?: string;
  keepEditingLabel?: string;
}

export interface UseDiscardConfirmApi {
  guardedCancel: () => void;
}

const DEFAULT_TITLE = 'Discard your new trip?';
const DEFAULT_MESSAGE = "Any details you've entered won't be saved.";
const DEFAULT_DISCARD_LABEL = 'Discard';
const DEFAULT_KEEP_LABEL = 'Keep editing';

export function useDiscardConfirm(opts: UseDiscardConfirmOptions): UseDiscardConfirmApi {
  const {
    dirty,
    onDiscard,
    onKeepEditing,
    title = DEFAULT_TITLE,
    message = DEFAULT_MESSAGE,
    discardLabel = DEFAULT_DISCARD_LABEL,
    keepEditingLabel = DEFAULT_KEEP_LABEL,
  } = opts;

  const guardedCancel = useCallback(() => {
    if (!dirty) {
      onDiscard();
      return;
    }
    Alert.alert(title, message, [
      {
        text: keepEditingLabel,
        style: 'cancel',
        onPress: () => {
          if (onKeepEditing) onKeepEditing();
        },
      },
      {
        text: discardLabel,
        style: 'destructive',
        onPress: () => onDiscard(),
      },
    ]);
  }, [dirty, onDiscard, onKeepEditing, title, message, discardLabel, keepEditingLabel]);

  return { guardedCancel };
}
