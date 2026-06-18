import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { ErrorBoundary } from 'react-error-boundary';
import type { ErrorInfo } from 'react';
import * as Sentry from '@sentry/react-native';
import { ff } from '../../theme/fonts';

interface Props {
  children: React.ReactNode;
  resetKeys?: Array<string | number | undefined>;
  onGoBack?: () => void;
}

interface FallbackProps {
  resetErrorBoundary: () => void;
  onGoBack?: () => void;
}

function Fallback({ resetErrorBoundary, onGoBack }: FallbackProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Something went wrong</Text>
      <Text style={styles.subtitle}>This chat hit an error. You can retry or go back.</Text>
      <View style={styles.row}>
        <TouchableOpacity style={styles.button} onPress={resetErrorBoundary}>
          <Text style={styles.buttonText}>Try again</Text>
        </TouchableOpacity>
        {onGoBack && (
          <TouchableOpacity style={[styles.button, styles.secondary]} onPress={onGoBack}>
            <Text style={styles.buttonText}>Go back</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

export function ChatErrorBoundary({ children, resetKeys, onGoBack }: Props) {
  return (
    <ErrorBoundary
      resetKeys={resetKeys}
      onError={(error: unknown, info: ErrorInfo) => {
        Sentry.captureException(error, { extra: { componentStack: info.componentStack } });
      }}
      fallbackRender={({ resetErrorBoundary }) => (
        <Fallback resetErrorBoundary={resetErrorBoundary} onGoBack={onGoBack} />
      )}
    >
      {children}
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#fff',
  },
  title: {
    fontFamily: ff('Montserrat', '600'),
    fontSize: 18,
    marginBottom: 8,
    color: '#111',
  },
  subtitle: {
    fontFamily: ff('Inter', '400'),
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 20,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#111',
  },
  secondary: {
    backgroundColor: '#888',
  },
  buttonText: {
    fontFamily: ff('Montserrat', '600'),
    color: '#fff',
    fontSize: 14,
  },
});
