// API Configuration
// Resolve a sensible default BASE_URL across web, simulator, and device
import { Platform } from 'react-native';
import Constants from 'expo-constants';

const isBrowser = typeof window !== 'undefined';
const isLocalhost = isBrowser &&
  window.location &&
  window.location.host &&
  (/localhost/.test(window.location.host) || /127\.0\.0\.1/.test(window.location.host));

// Get the development server host (for connecting to backend on same machine)
const getDevServerHost = (): string | null => {
  if (__DEV__ && Constants.debuggerHost) {
    // Extract host from debuggerHost (e.g., "localhost:8081" or "192.168.1.100:8081")
    const hostParts = Constants.debuggerHost.split(':');
    return hostParts[0]; // Return just the host/IP, not the port
  }
  return null;
};

// Determine the API base URL
let DEFAULT_BASE_URL: string;

if (process.env.EXPO_PUBLIC_API_BASE_URL) {
  // Explicitly set via environment variable (highest priority)
  DEFAULT_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;
} else if (__DEV__) {
  // Development mode - use deployed server for both web and mobile
  // This allows development without running local backend
  DEFAULT_BASE_URL = 'https://swellyo.onrender.com';
} else {
  // Production mode
  DEFAULT_BASE_URL = 'https://swellyo.onrender.com';
}

export const API_CONFIG = {
  BASE_URL: DEFAULT_BASE_URL,
};

// Log the API URL in development for debugging
if (__DEV__) {
  console.log('API Configuration:', {
    platform: Platform.OS,
    baseUrl: DEFAULT_BASE_URL,
    debuggerHost: Constants.debuggerHost,
    isLocalhost,
    envUrl: process.env.EXPO_PUBLIC_API_BASE_URL,
  });
}

export const ENDPOINTS = {
  NEW_CHAT: '/new_chat',
  CONTINUE_CHAT: (chatId: string) => `/chats/${chatId}/continue`,
  GET_CHAT: (chatId: string) => `/chats/${chatId}`,
  HEALTH: '/health',
} as const;
