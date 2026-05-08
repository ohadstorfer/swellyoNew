/**
 * useVoiceRecorder
 *
 * Push-to-talk recorder for voice messages. Wraps expo-av's Audio.Recording
 * with metering enabled so the UI can render a live waveform during recording
 * and persist a decimated waveform with the sent message.
 *
 * Lifecycle (start → stop or start → cancel):
 *
 *   idle ──start()──▶ requesting ──perm ok──▶ recording ──stop()──▶ finalizing ──▶ idle (returns file)
 *                                                       └─cancel()─▶ cancelled ──▶ idle (no file)
 *
 * Metering note: expo-av reports metering in dB (typical range −160..0).
 * We normalize to 0..1 with `(m + 60) / 60` clamped — a 60dB dynamic floor
 * gives readable bars without spending pixels on inaudible noise.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Linking, Platform } from 'react-native';
import { Audio } from 'expo-av';

const MIN_RECORDING_MS = 500;
const STATUS_UPDATE_MS = 100; // 10 Hz — smooth enough for the live waveform
const WAVEFORM_BUCKET_COUNT = 50;
const DB_FLOOR = 60; // dB below 0 we treat as silence

export type RecorderState =
  | 'idle'
  | 'requesting'
  | 'recording'
  | 'cancelled'
  | 'finalizing';

export interface VoiceRecording {
  uri: string;
  durationMs: number;
  waveform: number[];
  sizeBytes: number;
  mimeType: string;
}

export interface UseVoiceRecorder {
  state: RecorderState;
  durationMs: number;
  amplitude: number;        // latest 0..1 sample, for live UI
  liveWaveform: number[];   // last ~30 samples for the recording overlay
  start: () => Promise<boolean>;
  cancel: () => Promise<void>;
  stop: () => Promise<VoiceRecording | null>;
}

/** Normalize an expo-av metering dB value to 0..1. */
function normalizeMetering(metering: number | undefined): number {
  if (typeof metering !== 'number' || !Number.isFinite(metering)) return 0;
  // metering is dB, 0 = max, ~-60 = quiet. Clamp to floor.
  const normalized = (metering + DB_FLOOR) / DB_FLOOR;
  return Math.max(0, Math.min(1, normalized));
}

/**
 * Decimate a long array of amplitude samples down to `bucketCount` entries by
 * averaging within each bucket. Used at stop time so the persisted waveform is
 * a fixed size regardless of recording length.
 */
function decimateWaveform(samples: number[], bucketCount: number): number[] {
  if (samples.length === 0) return new Array(bucketCount).fill(0);
  if (samples.length <= bucketCount) {
    // Not enough samples — pad with the last value so the bar count is consistent.
    const padded = [...samples];
    while (padded.length < bucketCount) padded.push(samples[samples.length - 1] ?? 0);
    return padded;
  }
  const out: number[] = [];
  const bucketSize = samples.length / bucketCount;
  for (let i = 0; i < bucketCount; i++) {
    const start = Math.floor(i * bucketSize);
    const end = Math.floor((i + 1) * bucketSize);
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j++) {
      sum += samples[j];
      count++;
    }
    out.push(count > 0 ? sum / count : 0);
  }
  return out;
}

/** HIGH_QUALITY preset with metering enabled and mono audio (smaller file). */
function getRecordingOptions(): Audio.RecordingOptions {
  const preset = Audio.RecordingOptionsPresets.HIGH_QUALITY;
  return {
    ...preset,
    isMeteringEnabled: true,
    android: {
      ...preset.android,
      numberOfChannels: 1,
    },
    ios: {
      ...preset.ios,
      numberOfChannels: 1,
    },
    web: preset.web,
  };
}

export function useVoiceRecorder(): UseVoiceRecorder {
  const [state, setState] = useState<RecorderState>('idle');
  const [durationMs, setDurationMs] = useState(0);
  const [amplitude, setAmplitude] = useState(0);
  const [liveWaveform, setLiveWaveform] = useState<number[]>([]);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const allSamplesRef = useRef<number[]>([]);
  const cancelledRef = useRef<boolean>(false);
  const startedAtRef = useRef<number>(0);

  // Cleanup on unmount — make sure we don't leave the mic hot.
  useEffect(() => {
    return () => {
      const rec = recordingRef.current;
      recordingRef.current = null;
      if (rec) {
        rec.stopAndUnloadAsync().catch(() => undefined);
      }
    };
  }, []);

  const handleStatus = useCallback((status: Audio.RecordingStatus) => {
    if (!status.isRecording) return;
    const sample = normalizeMetering(status.metering);
    allSamplesRef.current.push(sample);
    setAmplitude(sample);
    setLiveWaveform((prev) => {
      const next = prev.length >= 30 ? prev.slice(prev.length - 29) : prev;
      return [...next, sample];
    });
    setDurationMs(status.durationMillis ?? 0);
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    if (state !== 'idle') return false;
    setState('requesting');
    cancelledRef.current = false;
    allSamplesRef.current = [];
    setLiveWaveform([]);
    setAmplitude(0);
    setDurationMs(0);

    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        setState('idle');
        Alert.alert(
          'Microphone access needed',
          'Enable microphone access in Settings to record voice messages.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ]
        );
        return false;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        getRecordingOptions(),
        handleStatus,
        STATUS_UPDATE_MS
      );
      recordingRef.current = recording;
      startedAtRef.current = Date.now();
      setState('recording');
      return true;
    } catch (err) {
      console.error('[useVoiceRecorder] start failed:', err);
      setState('idle');
      Alert.alert('Recording failed', 'Could not start recording. Try again.');
      return false;
    }
  }, [handleStatus, state]);

  const cancel = useCallback(async (): Promise<void> => {
    cancelledRef.current = true;
    const rec = recordingRef.current;
    recordingRef.current = null;
    setState('cancelled');
    if (rec) {
      try {
        await rec.stopAndUnloadAsync();
      } catch {
        // Recording may already be unloaded — fine.
      }
    }
    // Restore the audio session for playback.
    if (Platform.OS === 'ios') {
      Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => undefined);
    }
    setState('idle');
    setLiveWaveform([]);
    setAmplitude(0);
  }, []);

  const stop = useCallback(async (): Promise<VoiceRecording | null> => {
    const rec = recordingRef.current;
    if (!rec || state !== 'recording') return null;
    setState('finalizing');
    recordingRef.current = null;

    const elapsed = Date.now() - startedAtRef.current;

    try {
      await rec.stopAndUnloadAsync();
    } catch (err) {
      console.warn('[useVoiceRecorder] stopAndUnload error (continuing):', err);
    }

    if (Platform.OS === 'ios') {
      Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => undefined);
    }

    if (cancelledRef.current) {
      setState('idle');
      return null;
    }

    if (elapsed < MIN_RECORDING_MS) {
      setState('idle');
      return null; // caller should show a "hold to record" toast
    }

    const uri = rec.getURI();
    if (!uri) {
      setState('idle');
      return null;
    }

    const finalDuration = Math.max(elapsed, durationMs);
    const waveform = decimateWaveform(allSamplesRef.current, WAVEFORM_BUCKET_COUNT);

    setState('idle');
    setLiveWaveform([]);
    setAmplitude(0);

    return {
      uri,
      durationMs: finalDuration,
      waveform,
      sizeBytes: 0, // we don't have expo-file-system; receivers don't need this for v1
      mimeType: Platform.OS === 'ios' ? 'audio/m4a' : 'audio/mp4',
    };
  }, [durationMs, state]);

  return { state, durationMs, amplitude, liveWaveform, start, cancel, stop };
}
