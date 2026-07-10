/**
 * Full-screen in-app camera for chats, WhatsApp-style: live preview, shutter
 * (tap = photo, hold = video), flash/flip, and a filmstrip of recent gallery
 * media above the controls (RecentMediaStrip).
 *
 * Replaces ImagePicker.launchCameraAsync in both chat screens — the OS camera is
 * another process we can't draw the filmstrip over. The contract is the same
 * shape that launchCameraAsync used to produce, so the caller's preview/upload
 * flow (ImagePreviewModal / VideoPreviewModal and everything downstream) is
 * untouched: one `onCapture(asset)` callback, whether the asset was captured
 * or picked from the strip.
 *
 * Hold-to-record subtlety: expo-camera's CameraView records only in
 * mode="video", and switching modes reconfigures the native session, which
 * takes an unknowable moment. So the hold gesture flips the mode and then
 * *retries* recordAsync a few times until the session accepts it. If the
 * finger lifts before recording ever started, there is nothing to send — the
 * hold is cancelled and the camera returns to picture mode (a real recording,
 * however short, is sent like WhatsApp does).
 *
 * Permissions are deliberately independent: camera is required (deny → alert →
 * close), microphone is requested lazily on the first hold (deny → photos keep
 * working), gallery is owned by RecentMediaStrip (deny → strip shows an allow
 * tile, camera unaffected).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  CameraView,
  useCameraPermissions,
  useMicrophonePermissions,
  type CameraType,
  type FlashMode,
} from 'expo-camera';
import Svg, { Path, Rect, Circle } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RecentMediaStrip, type GalleryAsset } from './RecentMediaStrip';
import { ff, fs } from '../theme/fonts';

export interface CapturedAsset {
  uri: string;
  isVideo: boolean;
  width?: number;
  height?: number;
  /** seconds, video only */
  duration?: number;
  mimeType?: string;
}

interface ChatCameraModalProps {
  visible: boolean;
  onCapture: (asset: CapturedAsset) => void;
  onCancel: () => void;
  /** Opens the full OS gallery picker (the caller closes this modal first). */
  onOpenGallery: () => void;
}

const HOLD_TO_RECORD_MS = 300;
const MAX_VIDEO_SECONDS = 60;

const CloseIcon = () => (
  <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
    <Path d="M18 6L6 18M6 6l12 12" stroke="#fff" strokeWidth={2} strokeLinecap="round" />
  </Svg>
);

const BOLT_PATH = 'M13 2L3 14h9l-1 8 10-12h-9l1-8z';

const FlashIcon = ({ mode }: { mode: FlashMode }) => (
  <View style={styles.flashIconWrap}>
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path
        d={BOLT_PATH}
        stroke="#fff"
        strokeWidth={1.5}
        strokeLinejoin="round"
        fill={mode === 'on' ? '#fff' : 'none'}
      />
      {mode === 'off' && (
        <Path d="M3 3l18 18" stroke="#fff" strokeWidth={1.5} strokeLinecap="round" />
      )}
    </Svg>
    {mode === 'auto' && <Text style={styles.flashAutoBadge}>A</Text>}
  </View>
);

const FlipIcon = () => (
  <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
    <Path d="M1 4v6h6" stroke="#fff" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M23 20v-6h-6" stroke="#fff" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    <Path
      d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10M3.51 15a9 9 0 0 0 14.85 3.36L23 14"
      stroke="#fff"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

const GalleryIcon = () => (
  <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
    <Rect x={3} y={3} width={18} height={18} rx={2} stroke="#fff" strokeWidth={1.5} />
    <Circle cx={8.5} cy={8.5} r={1.5} stroke="#fff" strokeWidth={1.5} />
    <Path d="M21 15l-5-5L5 21" stroke="#fff" strokeWidth={1.5} strokeLinecap="round" />
  </Svg>
);

function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function ChatCameraModal({ visible, onCapture, onCancel, onOpenGallery }: ChatCameraModalProps) {
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraView>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();

  const [facing, setFacing] = useState<CameraType>('back');
  const [flash, setFlash] = useState<FlashMode>('off');
  const [mode, setMode] = useState<'picture' | 'video'>('picture');
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);

  // Gesture bookkeeping. Refs, not state: pressIn/pressOut and the retry loop
  // race each other across ticks and must read current values synchronously.
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdingRef = useRef(false);
  const recordingRef = useRef(false);
  const recordStartRef = useRef(0);
  const busyRef = useRef(false); // one capture at a time
  const deniedAlertShownRef = useRef(false);

  const shutterScale = useRef(new Animated.Value(1)).current;

  // ── Camera permission: required. Ask once when the modal opens; a hard
  // denial closes the modal after offering Settings.
  useEffect(() => {
    if (!visible || !cameraPermission) return;
    if (cameraPermission.granted) return;
    if (cameraPermission.canAskAgain) {
      void requestCameraPermission();
    } else if (!deniedAlertShownRef.current) {
      deniedAlertShownRef.current = true;
      Alert.alert(
        'Permission Required',
        'Swellyo needs access to your camera. Please enable it in your device settings.',
        [
          { text: 'Cancel', style: 'cancel', onPress: onCancel },
          { text: 'Open Settings', onPress: () => { void Linking.openSettings(); onCancel(); } },
        ]
      );
    }
  }, [visible, cameraPermission, requestCameraPermission, onCancel]);

  // Reset per-open state (Modal unmounts children while hidden, but refs on
  // this component survive because the component itself stays mounted).
  useEffect(() => {
    if (!visible) return;
    deniedAlertShownRef.current = false;
    busyRef.current = false;
    holdingRef.current = false;
    recordingRef.current = false;
    setMode('picture');
    setIsRecording(false);
    setRecordSeconds(0);
  }, [visible]);

  // Recording timer readout.
  useEffect(() => {
    if (!isRecording) return;
    const id = setInterval(() => {
      setRecordSeconds(Math.floor((Date.now() - recordStartRef.current) / 1000));
    }, 250);
    return () => clearInterval(id);
  }, [isRecording]);

  const pressShutter = useCallback((pressed: boolean) => {
    Animated.timing(shutterScale, {
      toValue: pressed ? 0.88 : 1,
      duration: 120,
      useNativeDriver: true,
    }).start();
  }, [shutterScale]);

  const takePicture = useCallback(async () => {
    if (busyRef.current || !cameraRef.current) return;
    busyRef.current = true;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 1 });
      if (photo?.uri) {
        onCapture({
          uri: photo.uri,
          isVideo: false,
          width: photo.width,
          height: photo.height,
          mimeType: 'image/jpeg',
        });
      }
    } catch (error) {
      busyRef.current = false;
      const msg = error instanceof Error ? error.message : String(error);
      if (/simulator/i.test(msg)) {
        Alert.alert('Camera unavailable', 'iOS Simulator has no camera. Test on a physical device.');
        return;
      }
      console.error('[ChatCameraModal] takePictureAsync failed:', error);
      Alert.alert('Error', 'Failed to take photo. Please try again.');
    }
  }, [onCapture]);

  // Kicks off recordAsync once the video session is live. Mode was just
  // flipped to "video"; the native session reconfigures on its own schedule,
  // so retry a few times instead of trusting any single callback to fire.
  const startRecording = useCallback(async () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      if (!holdingRef.current || !cameraRef.current) return; // finger lifted while spinning up
      try {
        recordingRef.current = true;
        recordStartRef.current = Date.now();
        setIsRecording(true);
        setRecordSeconds(0);
        const recordPromise = cameraRef.current.recordAsync({ maxDuration: MAX_VIDEO_SECONDS });
        const video = await recordPromise; // resolves on stopRecording() or maxDuration
        const durationSec = Math.max(1, Math.round((Date.now() - recordStartRef.current) / 1000));
        recordingRef.current = false;
        setIsRecording(false);
        setMode('picture');
        if (video?.uri) {
          onCapture({
            uri: video.uri,
            isVideo: true,
            duration: durationSec,
            mimeType: video.uri.endsWith('.mov') ? 'video/quicktime' : 'video/mp4',
          });
        }
        return;
      } catch (error) {
        recordingRef.current = false;
        setIsRecording(false);
        // Session not ready yet — wait a beat and retry while still holding.
        if (attempt < 5 && holdingRef.current) {
          await new Promise(resolve => setTimeout(resolve, 250));
          continue;
        }
        setMode('picture');
        const msg = error instanceof Error ? error.message : String(error);
        if (/simulator/i.test(msg)) {
          Alert.alert('Camera unavailable', 'iOS Simulator has no camera. Test on a physical device.');
          return;
        }
        console.error('[ChatCameraModal] recordAsync failed:', error);
        Alert.alert('Error', 'Failed to record video. Please try again.');
        return;
      }
    }
  }, [onCapture]);

  const beginHold = useCallback(async () => {
    if (busyRef.current) return;
    // Microphone is asked for lazily — taking photos must never trigger a mic
    // prompt. Denial degrades to photo-only, it doesn't block the camera.
    if (!micPermission?.granted) {
      const result = await requestMicPermission();
      if (!result.granted) {
        if (!result.canAskAgain) {
          Alert.alert(
            'Microphone needed',
            'Swellyo needs your microphone to record videos with sound. Please enable it in your device settings.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Open Settings', onPress: () => Linking.openSettings() },
            ]
          );
        } else {
          Alert.alert('Microphone needed', 'Allow microphone access to record videos.');
        }
        return;
      }
      if (!holdingRef.current) return; // finger lifted during the permission prompt
    }
    setMode('video');
    void startRecording();
  }, [micPermission, requestMicPermission, startRecording]);

  const handleShutterPressIn = useCallback(() => {
    pressShutter(true);
    holdingRef.current = true;
    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null;
      if (holdingRef.current) void beginHold();
    }, HOLD_TO_RECORD_MS);
  }, [beginHold, pressShutter]);

  const handleShutterPressOut = useCallback(() => {
    pressShutter(false);
    holdingRef.current = false;
    if (holdTimerRef.current) {
      // Quick tap: hold threshold never fired → photo.
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
      void takePicture();
      return;
    }
    if (recordingRef.current) {
      cameraRef.current?.stopRecording();
      return;
    }
    // Hold started but recording never began (mode still spinning up or the
    // mic prompt was up) — cancel back to picture mode, nothing to send.
    setMode('picture');
  }, [pressShutter, takePicture]);

  // Safety: never leave a recording running if the modal is closed mid-hold.
  useEffect(() => {
    if (!visible && recordingRef.current) {
      cameraRef.current?.stopRecording();
      recordingRef.current = false;
    }
  }, [visible]);

  const cycleFlash = useCallback(() => {
    setFlash(prev => (prev === 'off' ? 'on' : prev === 'on' ? 'auto' : 'off'));
  }, []);

  const flipCamera = useCallback(() => {
    setFacing(prev => (prev === 'back' ? 'front' : 'back'));
  }, []);

  const handleStripSelect = useCallback(
    (asset: GalleryAsset) => {
      onCapture({
        uri: asset.uri,
        isVideo: asset.isVideo,
        width: asset.width,
        height: asset.height,
        duration: asset.duration,
      });
    },
    [onCapture]
  );

  return (
    <Modal
      visible={visible}
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent={Platform.OS === 'android'}
      navigationBarTranslucent={Platform.OS === 'android'}
    >
      <View style={styles.container}>
        {cameraPermission?.granted && (
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing={facing}
            flash={flash}
            enableTorch={isRecording && flash !== 'off'}
            mode={mode}
            videoQuality="1080p"
          />
        )}

        {/* Header: close ✕ / recording timer / flash */}
        <View style={[styles.header, { top: insets.top + 8 }]}>
          {isRecording ? (
            <View style={styles.headerSpacer} />
          ) : (
            <Pressable
              style={({ pressed }) => [styles.roundButton, pressed && styles.buttonPressed]}
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel="Close camera"
              hitSlop={8}
            >
              <CloseIcon />
            </Pressable>
          )}
          {isRecording && (
            <View style={styles.timerPill}>
              <View style={styles.recordDot} />
              <Text style={styles.timerText}>{formatTimer(recordSeconds)}</Text>
            </View>
          )}
          {isRecording ? (
            <View style={styles.headerSpacer} />
          ) : (
            <Pressable
              style={({ pressed }) => [styles.roundButton, pressed && styles.buttonPressed]}
              onPress={cycleFlash}
              accessibilityRole="button"
              accessibilityLabel={`Flash ${flash}`}
              hitSlop={8}
            >
              <FlashIcon mode={flash} />
            </Pressable>
          )}
        </View>

        {/* Bottom: filmstrip above the controls row */}
        <View style={[styles.bottom, { paddingBottom: insets.bottom + 16 }]}>
          {!isRecording && <RecentMediaStrip onSelect={handleStripSelect} />}
          <View style={styles.controlsRow}>
            {isRecording ? (
              <View style={styles.sideButton} />
            ) : (
              <Pressable
                style={({ pressed }) => [styles.sideButton, pressed && styles.buttonPressed]}
                onPress={onOpenGallery}
                accessibilityRole="button"
                accessibilityLabel="Open gallery"
                hitSlop={8}
              >
                <GalleryIcon />
              </Pressable>
            )}
            <Pressable
              onPressIn={handleShutterPressIn}
              onPressOut={handleShutterPressOut}
              accessibilityRole="button"
              accessibilityLabel="Take photo, hold to record video"
            >
              <View style={[styles.shutterRing, isRecording && styles.shutterRingRecording]}>
                <Animated.View
                  style={[
                    styles.shutterInner,
                    isRecording && styles.shutterInnerRecording,
                    { transform: [{ scale: shutterScale }] },
                  ]}
                />
              </View>
            </Pressable>
            {isRecording ? (
              <View style={styles.sideButton} />
            ) : (
              <Pressable
                style={({ pressed }) => [styles.sideButton, pressed && styles.buttonPressed]}
                onPress={flipCamera}
                accessibilityRole="button"
                accessibilityLabel="Flip camera"
                hitSlop={8}
              >
                <FlipIcon />
              </Pressable>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const SHUTTER_SIZE = 76;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 2,
  },
  headerSpacer: {
    width: 44,
    height: 44,
  },
  roundButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    opacity: 0.7,
  },
  flashIconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  flashAutoBadge: {
    position: 'absolute',
    top: -4,
    right: -8,
    color: '#fff',
    fontSize: fs(10),
    fontFamily: ff('Inter', '700'),
    includeFontPadding: false,
  },
  timerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  recordDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FF3B30',
  },
  timerText: {
    color: '#fff',
    fontSize: fs(14),
    fontFamily: ff('Inter', '600'),
    includeFontPadding: false,
  },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 2,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 36,
  },
  sideButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterRing: {
    width: SHUTTER_SIZE,
    height: SHUTTER_SIZE,
    borderRadius: SHUTTER_SIZE / 2,
    borderWidth: 4,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterRingRecording: {
    borderColor: '#FF3B30',
  },
  shutterInner: {
    width: SHUTTER_SIZE - 16,
    height: SHUTTER_SIZE - 16,
    borderRadius: (SHUTTER_SIZE - 16) / 2,
    backgroundColor: '#fff',
  },
  shutterInnerRecording: {
    backgroundColor: '#FF3B30',
  },
});
