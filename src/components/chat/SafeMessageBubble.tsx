import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ErrorBoundary } from 'react-error-boundary';
import * as Sentry from '@sentry/react-native';
import { ff } from '../../theme/fonts';

interface Props {
  messageId: string;
  children: React.ReactNode;
}

function BubbleFallback() {
  return (
    <View style={styles.fallback}>
      <Text style={styles.fallbackText}>Message unavailable</Text>
    </View>
  );
}

export function SafeMessageBubble({ messageId, children }: Props) {
  return (
    <ErrorBoundary
      resetKeys={[messageId]}
      onError={(error: unknown) => {
        Sentry.captureException(error, {
          tags: { surface: 'message_bubble' },
          extra: { messageId },
        });
      }}
      fallback={<BubbleFallback />}
    >
      {children}
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  fallback: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#f0f0f0',
  },
  fallbackText: {
    fontFamily: ff('Inter', '400'),
    fontSize: 13,
    color: '#999',
    fontStyle: 'italic',
  },
});
