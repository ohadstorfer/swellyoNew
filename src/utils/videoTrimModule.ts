import { NativeModules, TurboModuleRegistry } from 'react-native';
import type { Spec } from 'react-native-video-trim';

// Capability probe: returns true iff react-native-video-trim's native module
// is registered in the currently running binary. Covers both the legacy
// NativeModules map and the New Architecture TurboModuleRegistry, and never
// throws when the module is absent (unlike `TurboModuleRegistry.getEnforcing`,
// which is what react-native-video-trim itself calls at module-eval time).
//
// Use this BEFORE require()ing the library — otherwise the require triggers
// `getEnforcing`, which surfaces as an Uncaught Error in dev even inside a
// try/catch, because RN logs it via the global error handler.
export function isVideoTrimAvailable(): boolean {
  if (NativeModules?.VideoTrim != null) return true;
  try {
    return TurboModuleRegistry.get?.('VideoTrim') != null;
  } catch {
    return false;
  }
}

type VideoTrimModule = typeof import('react-native-video-trim');

let cached: VideoTrimModule | null | undefined;

// Lazy, crash-safe accessor for the react-native-video-trim JS wrapper.
// Returns null if the native module isn't registered (Expo Go, missing
// `pod install`, etc.) so callers can fall back without ever evaluating the
// library's top-level `getEnforcing` call.
export function getVideoTrim(): VideoTrimModule | null {
  if (cached !== undefined) return cached;
  if (!isVideoTrimAvailable()) {
    cached = null;
    return null;
  }
  try {
    cached = require('react-native-video-trim') as VideoTrimModule;
  } catch {
    cached = null;
  }
  return cached;
}

let cachedTurbo: Spec | null | undefined;

// Returns the TurboModule instance that owns the codegen EventEmitter fields
// (onFinishTrimming, onError, …). The JS wrapper re-exported from
// `react-native-video-trim` does NOT expose these — they live on `.default`
// (Fabric) or on the NativeModules proxy (Old Arch).
export function getVideoTrimNativeModule(): Spec | null {
  if (cachedTurbo !== undefined) return cachedTurbo;
  if (!isVideoTrimAvailable()) {
    cachedTurbo = null;
    return null;
  }
  try {
    const direct = (TurboModuleRegistry.get?.('VideoTrim') as Spec | null) ?? null;
    if (direct) {
      cachedTurbo = direct;
      return cachedTurbo;
    }
  } catch {}
  try {
    const mod = require('react-native-video-trim');
    cachedTurbo = (mod?.default ?? null) as Spec | null;
  } catch {
    cachedTurbo = null;
  }
  return cachedTurbo;
}
