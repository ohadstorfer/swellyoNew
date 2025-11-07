// API Configuration
// Resolve a sensible default BASE_URL across web, simulator, and device
const isBrowser = typeof window !== 'undefined';
const isLocalhost = isBrowser &&
  window.location &&
  window.location.host &&
  (/localhost/.test(window.location.host) || /127\.0\.0\.1/.test(window.location.host));

// Prefer localhost when developing on web/simulator. Allow override via env.
const DEFAULT_BASE_URL = isBrowser && isLocalhost
  ? 'http://localhost:8000'
  : (process.env.EXPO_PUBLIC_API_BASE_URL || 'https://swellyo.onrender.com');

export const API_CONFIG = {
  BASE_URL: DEFAULT_BASE_URL,
};

export const ENDPOINTS = {
  NEW_CHAT: '/new_chat',
  CONTINUE_CHAT: (chatId: string) => `/chats/${chatId}/continue`,
  GET_CHAT: (chatId: string) => `/chats/${chatId}`,
  HEALTH: '/health',
} as const;
