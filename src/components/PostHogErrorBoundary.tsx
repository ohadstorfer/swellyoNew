import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Error boundary specifically for PostHog initialization errors
 * 
 * Catches navigation state errors and other PostHog-related errors
 * to prevent them from crashing the entire app.
 */
export class PostHogErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State | null {
    // Check if error is from PostHog
    if (
      error.message?.includes('navigation state') || 
      error.message?.includes('PostHog') ||
      error.message?.includes('useNavigationState')
    ) {
      console.warn('[PostHog] Initialization error caught:', error.message);
      return { hasError: true };
    }
    // Re-throw other errors - they're not PostHog-related
    throw error;
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.warn('[PostHog] Error boundary caught:', error.message);
    console.warn('[PostHog] Component stack:', errorInfo.componentStack);
  }

  render() {
    if (this.state.hasError) {
      // Render children without PostHog on error
      console.warn('[PostHog] Rendering app without PostHog due to initialization error');
      return this.props.children;
    }

    return this.props.children;
  }
}

