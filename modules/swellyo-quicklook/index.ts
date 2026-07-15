/**
 * JS face of the swellyo-quicklook native module. iOS-only in effect: it wraps
 * QLPreviewController to show a local Office document (docx/xlsx/pptx/…) in-app.
 *
 * Degrades to an inert `false` when the native side is absent (Expo Go, web,
 * an old build, or Android where the module is a no-op stub) —
 * requireOptionalNativeModule returns null instead of throwing, so callers
 * never need a try/catch and simply fall back to the OS share sheet.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

type NativeSwellyoQuickLook = {
  preview(path: string): Promise<boolean>;
};

const native = requireOptionalNativeModule<NativeSwellyoQuickLook>('SwellyoQuickLook');

/**
 * Present a local file:// (or bare path) in Apple's QuickLook. Resolves true
 * once presented; false if the module is unavailable or presentation fails —
 * the caller then falls back to the OS share sheet.
 */
export async function previewFile(uri: string): Promise<boolean> {
  if (!native) return false;
  try {
    return await native.preview(uri);
  } catch {
    return false;
  }
}
