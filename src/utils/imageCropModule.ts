import { NativeModules, TurboModuleRegistry } from 'react-native';
import { isExpoGo } from './keyboardAvoidingView';

type ImageCropPickerModule = typeof import('react-native-image-crop-picker');

// Capability probe: returns true iff react-native-image-crop-picker's native
// module is registered in the current binary. The library registers as
// `RNCImageCropPicker` (via RCT_EXPORT_MODULE on iOS / TurboModuleRegistry
// getEnforcing<Spec>('RNCImageCropPicker') on New Arch). Under Fabric /
// bridgeless, TurboModules don't always show up in NativeModules — check
// TurboModuleRegistry as a second source.
export function isImageCropPickerAvailable(): boolean {
  if (isExpoGo) return false;
  if (NativeModules?.RNCImageCropPicker != null) return true;
  try {
    return TurboModuleRegistry.get?.('RNCImageCropPicker') != null;
  } catch {
    return false;
  }
}

let cached: ImageCropPickerModule['default'] | null | undefined;

// Crash-safe accessor for the default export (the picker singleton). Returns
// null on web / Expo Go / missing pod — callers should fall back to the old
// preview-modal flow in that case.
export function getImageCropPicker(): ImageCropPickerModule['default'] | null {
  if (cached !== undefined) return cached;
  if (!isImageCropPickerAvailable()) {
    cached = null;
    return null;
  }
  try {
    const mod = require('react-native-image-crop-picker') as ImageCropPickerModule;
    cached = mod.default;
  } catch {
    cached = null;
  }
  return cached;
}

export function isPickerCancelError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === 'E_PICKER_CANCELLED';
}
