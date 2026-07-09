/**
 * react-native-pdf-renderer ships a native Fabric view. In Expo Go the native
 * component does not exist.
 *
 * The require()-then-probe-a-method guard used by contactPicker/documentPicker
 * does NOT work here: those modules expose functions, so accessing a method
 * trips the lazy native proxy and throws where we can catch it. A component is
 * never *called* — it is *mounted* — so the failure would land inside React's
 * render, not in our try. Resolve once at module load and export null instead,
 * exactly as src/utils/keyboardAvoidingView.ts does for KeyboardGestureArea.
 */
import type { ComponentType } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { isExpoGo } from '../../utils/keyboardAvoidingView';

export interface PdfRendererProps {
  /** Local path only — a file:// uri that already exists on disk. */
  source: string;
  /** Renders only the first page, without scroll. */
  singlePage?: boolean;
  maxZoom?: number;
  /** Android only. Caps page resolution so a zoomed page cannot blow the bitmap budget. */
  maxPageResolution?: number;
  onError?: () => void;
  style?: StyleProp<ViewStyle>;
}

let resolved: ComponentType<PdfRendererProps> | null = null;
if (!isExpoGo) {
  try {
    resolved = require('react-native-pdf-renderer').default ?? null;
  } catch {
    resolved = null; // dep missing, or a build that predates it
  }
}

/** null when the native view is unavailable — callers MUST branch on it. */
export const PdfRendererView = resolved;
