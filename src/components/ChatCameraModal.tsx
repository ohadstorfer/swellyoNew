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
  AccessibilityInfo,
  Alert,
  Animated,
  Easing,
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
import { RecentMediaStrip, type GalleryAsset, type StripFrame } from './RecentMediaStrip';
import { ImagePreviewContent } from './ImagePreviewContent';
import { VideoPreviewContent } from './VideoPreviewContent';
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
  /**
   * Legacy fallback: routes an asset to the host's external preview. Only used
   * when onSendImage/onSendVideo aren't wired — otherwise every asset (shutter
   * captures and filmstrip picks) previews inline on the camera surface.
   */
  onCapture: (asset: CapturedAsset) => void;
  onCancel: () => void;
  /** Opens the full OS gallery picker (the caller closes this modal first). */
  onOpenGallery: () => void;
  /**
   * When both are provided, every asset — shutter captures and filmstrip picks —
   * previews inline on this same surface (caption + send over the media), so the
   * camera never detours through the chat. Send the final image/video uri
   * straight to the host's upload path.
   */
  onSendImage?: (uri: string, caption?: string) => void;
  onSendVideo?: (uri: string, caption?: string) => void;
  /**
   * Opens the native crop editor on an image and resolves the edited file (or
   * null if cancelled). Absent → the inline preview hides its Edit button.
   */
  onCropImage?: (
    uri: string,
    width: number,
    height: number,
  ) => Promise<{ uri: string; width: number; height: number } | null>;
  /** Send-button tint for the inline preview, to match the host chat's theme. */
  primaryColor?: string;
}

const HOLD_TO_RECORD_MS = 200;
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

export function ChatCameraModal({
  visible,
  onCapture,
  onCancel,
  onOpenGallery,
  onSendImage,
  onSendVideo,
  onCropImage,
  primaryColor = '#B72DF2',
}: ChatCameraModalProps) {
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraView>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();

  const [facing, setFacing] = useState<CameraType>('back');
  const [flash, setFlash] = useState<FlashMode>('off');
  const [mode, setMode] = useState<'picture' | 'video'>('picture');
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  // WhatsApp-style bottom mode selector. Photo mode keeps tap=photo /
  // hold=video; Video mode makes the shutter tap-to-start / tap-to-stop.
  // Distinct from `mode` above, which is the CameraView's native session mode
  // and flips on its own schedule while a recording spins up.
  const [captureMode, setCaptureMode] = useState<'photo' | 'video'>('photo');
  const captureModeRef = useRef<'photo' | 'video'>('photo');
  // Drives the mode-selector slide: 0 = VIDEO centered, 1 = PHOTO centered.
  // Starts at 1 to match the initial captureMode above.
  const modeAnim = useRef(new Animated.Value(1)).current;
  const [videoLabelWidth, setVideoLabelWidth] = useState(0);
  const [photoLabelWidth, setPhotoLabelWidth] = useState(0);

  // Pre-configure the native session for the selected tab: pay the mode-switch
  // reconfiguration once at tab switch, so tap-to-record in the VIDEO tab
  // starts (almost) instantly instead of lagging on every take.
  useEffect(() => {
    captureModeRef.current = captureMode;
    if (!recordingRef.current) {
      setMode(captureMode === 'video' ? 'video' : 'picture');
    }
  }, [captureMode]);

  // Gesture bookkeeping. Refs, not state: pressIn/pressOut and the retry loop
  // race each other across ticks and must read current values synchronously.
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdingRef = useRef(false);
  const recordingRef = useRef(false);
  const recordStartRef = useRef(0);
  const busyRef = useRef(false); // one capture at a time
  const deniedAlertShownRef = useRef(false);

  const shutterScale = useRef(new Animated.Value(1)).current;

  // ── Inline preview: a tapped thumbnail opens the caption/send UI on this same
  // surface. The preview grows its own image/video from the thumbnail frame to
  // its final laid-out position (openFrame), so it lands exactly at the editor
  // size — no external modal, no fullscreen overshoot, no jump.
  const growingRef = useRef(false);
  const reduceMotionRef = useRef(false);
  const [preview, setPreview] = useState<GalleryAsset | null>(null);
  const [previewFrame, setPreviewFrame] = useState<StripFrame | undefined>(undefined);
  const [previewImageUri, setPreviewImageUri] = useState<string | null>(null);
  const previewImageDimsRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  // Inline preview is only possible when the host wired the send callbacks;
  // otherwise fall back to the legacy onCapture → external-preview route.
  const canInlinePreview = !!(onSendImage && onSendVideo);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(v => {
      if (mounted) reduceMotionRef.current = v;
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', v => {
      reduceMotionRef.current = v;
    });
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

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
    growingRef.current = false;
    setPreview(null);
    setPreviewFrame(undefined);
    setPreviewImageUri(null);
    setMode('picture');
    setCaptureMode('photo');
    modeAnim.setValue(1);
    setIsRecording(false);
    setRecordSeconds(0);
  }, [visible, modeAnim]);

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

  // Switch the WhatsApp-style mode tabs, sliding the selected label to center
  // and swapping colors. Color can't run on the native driver, so the whole
  // value stays JS-driven — cheap for a two-label row.
  const animateCaptureMode = useCallback((next: 'photo' | 'video') => {
    if (captureModeRef.current === next) return;
    setCaptureMode(next);
    Animated.timing(modeAnim, {
      toValue: next === 'photo' ? 1 : 0,
      duration: reduceMotionRef.current ? 0 : 220,
      easing: Easing.bezier(0.77, 0, 0.175, 1),
      useNativeDriver: false,
    }).start();
  }, [modeAnim]);

  // Legacy fallback: route an asset to the host's external preview (used only
  // when the inline-preview callbacks weren't wired).
  const routePick = useCallback(
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

  // Open the inline preview on this same surface — the camera stays mounted
  // behind it, so there's no detour through the chat. With `frame` (filmstrip
  // tap) the media grows from that rect; without it (shutter captures) it
  // appears in place.
  const presentPick = useCallback(
    (asset: GalleryAsset, frame?: StripFrame) => {
      if (!canInlinePreview) {
        routePick(asset);
        return;
      }
      if (!asset.isVideo) {
        setPreviewImageUri(asset.uri);
        previewImageDimsRef.current = { width: asset.width ?? 0, height: asset.height ?? 0 };
      }
      setPreviewFrame(reduceMotionRef.current ? undefined : frame);
      setPreview(asset);
    },
    [canInlinePreview, routePick]
  );

  const takePicture = useCallback(async () => {
    if (busyRef.current || !cameraRef.current) return;
    busyRef.current = true;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 1 });
      if (photo?.uri) {
        presentPick({
          uri: photo.uri,
          isVideo: false,
          width: photo.width,
          height: photo.height,
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
  }, [presentPick]);

  // Kicks off recordAsync once the video session is live. In the VIDEO tab the
  // session is already configured (mode flips on tab switch), so the first
  // attempt usually sticks; from a PHOTO-tab hold the mode was just flipped and
  // the native session reconfigures on its own schedule, so retry a few times
  // instead of trusting any single callback to fire.
  //
  // isRecording flips ON once here and OFF once in the finally — flipping it
  // per attempt made the timer, red shutter, and filmstrip strobe on every
  // failed attempt while the session spun up.
  const startRecording = useCallback(async () => {
    setIsRecording(true);
    setRecordSeconds(0);
    recordStartRef.current = Date.now();
    try {
      for (let attempt = 0; attempt < 6; attempt++) {
        if (!holdingRef.current || !cameraRef.current) return; // finger lifted while spinning up
        try {
          recordingRef.current = true;
          recordStartRef.current = Date.now();
          const recordPromise = cameraRef.current.recordAsync({ maxDuration: MAX_VIDEO_SECONDS });
          const video = await recordPromise; // resolves on stopRecording() or maxDuration
          const durationSec = Math.max(1, Math.round((Date.now() - recordStartRef.current) / 1000));
          recordingRef.current = false;
          holdingRef.current = false; // disarm tap-mode intent (maxDuration can end the take)
          if (video?.uri) {
            presentPick({
              uri: video.uri,
              isVideo: true,
              duration: durationSec,
            });
          }
          return;
        } catch (error) {
          recordingRef.current = false;
          // Session not ready yet — wait a beat and retry while still armed.
          if (attempt < 5 && holdingRef.current) {
            await new Promise(resolve => setTimeout(resolve, 250));
            continue;
          }
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
    } finally {
      setIsRecording(false);
      // Restore the session for the selected tab (video stays hot in VIDEO).
      setMode(captureModeRef.current === 'video' ? 'video' : 'picture');
    }
  }, [presentPick]);

  const beginHold = useCallback(async () => {
    if (busyRef.current) return;
    // Microphone is asked for lazily — taking photos must never trigger a mic
    // prompt. Denial degrades to photo-only, it doesn't block the camera.
    if (!micPermission?.granted) {
      const result = await requestMicPermission();
      if (!result.granted) {
        holdingRef.current = false;
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
      // iOS: the session lives in video mode permanently and the mic input
      // attaches reactively when `mute` flips false after this grant. Give the
      // session a beat to wire the audio in, or the first-ever video records
      // silent. Only paid once, right after the system permission dialog.
      if (Platform.OS === 'ios') {
        await new Promise(resolve => setTimeout(resolve, 500));
        if (!holdingRef.current) return;
      }
    }
    setMode('video');
    void startRecording();
  }, [micPermission, requestMicPermission, startRecording]);

  const handleShutterPressIn = useCallback(() => {
    pressShutter(true);
    if (captureMode === 'video') {
      // Video mode is tap-to-toggle: first tap starts, second tap stops.
      if (recordingRef.current) {
        holdingRef.current = false;
        cameraRef.current?.stopRecording();
        return;
      }
      // holdingRef doubles as "recording intent" for the startRecording retry
      // loop; in tap mode it stays armed until the stop tap.
      holdingRef.current = true;
      void beginHold();
      return;
    }
    holdingRef.current = true;
    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null;
      if (holdingRef.current) void beginHold();
    }, HOLD_TO_RECORD_MS);
  }, [beginHold, pressShutter, captureMode]);

  const handleShutterPressOut = useCallback(() => {
    pressShutter(false);
    if (captureMode === 'video') return; // tap-to-toggle: release does nothing
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
  }, [pressShutter, takePicture, captureMode]);

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

  // Dismiss the inline preview back to the live camera (swipe-down / close ✕).
  const handlePreviewCancel = useCallback(() => {
    setPreview(null);
    setPreviewFrame(undefined);
    setPreviewImageUri(null);
    growingRef.current = false;
    busyRef.current = false; // re-arm the shutter after a cancelled capture
  }, []);

  const handlePreviewSendImage = useCallback(
    (caption?: string) => {
      if (previewImageUri) onSendImage?.(previewImageUri, caption);
      onCancel();
    },
    [previewImageUri, onSendImage, onCancel]
  );

  const handlePreviewSendVideo = useCallback(
    (caption?: string, overrideUri?: string) => {
      const uri = overrideUri ?? preview?.uri;
      if (uri) onSendVideo?.(uri, caption);
      onCancel();
    },
    [preview, onSendVideo, onCancel]
  );

  const handlePreviewEdit = useCallback(async () => {
    if (!previewImageUri || !onCropImage) return;
    const { width, height } = previewImageDimsRef.current;
    try {
      const result = await onCropImage(previewImageUri, width, height);
      if (result?.uri) {
        setPreviewImageUri(result.uri);
        previewImageDimsRef.current = { width: result.width, height: result.height };
      }
    } catch (err) {
      console.warn('[ChatCameraModal] crop failed:', err);
    }
  }, [previewImageUri, onCropImage]);

  const handleStripSelect = useCallback(
    (_displayUri: string, frame: StripFrame, _isVideo: boolean, asset: Promise<GalleryAsset>) => {
      if (growingRef.current) return;
      growingRef.current = true;
      // Resolve the real file, then open the preview — which grows its own media
      // from the tapped thumbnail's frame to its final position.
      asset.then(a => presentPick(a, frame)).catch(err => {
        console.warn('[ChatCameraModal] filmstrip asset failed to resolve:', err);
        growingRef.current = false;
      });
    },
    [presentPick]
  );

  // Mode-selector geometry: shift the whole VIDEO/PHOTO row so the active
  // label's own center — not the pair's — lands on the row's center. Falls
  // back to an equal-width guess until both labels have reported onLayout.
  const modeLabelGap = styles.modeRowInner.gap as number;
  const videoW = videoLabelWidth || 58;
  const photoW = photoLabelWidth || 58;
  const modeRowTranslateX = modeAnim.interpolate({
    inputRange: [0, 1],
    outputRange: reduceMotionRef.current
      ? [0, 0]
      : [(modeLabelGap + photoW) / 2, -(videoW + modeLabelGap) / 2],
  });
  const videoLabelColor = modeAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['#FFCC00', 'rgba(255,255,255,0.75)'],
  });
  const photoLabelColor = modeAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['rgba(255,255,255,0.75)', '#FFCC00'],
  });

  return (
    <Modal
      visible={visible}
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent={Platform.OS === 'android'}
      navigationBarTranslucent={Platform.OS === 'android'}
    >
      <View style={styles.container}>
        {/* iOS runs the native session in video mode PERMANENTLY: flipping mode
            reconfigures the running AVCaptureSession (preset + movie output +
            mic attach/detach), and each reconfiguration blanks the preview /
            resets exposure — the dark flick on every photo↔video switch. So:
            - mode is pinned to 'video'; takePictureAsync has no mode guard and
              the photo output is always attached, so photos still work (at the
              1080p session format — the upload pipeline's ≤2560px makes the
              12MP→2MP drop irrelevant).
            - pictureSize matches videoQuality so no preset ever changes.
            - the mic attaches once via `mute` flipping false when permission
              lands, not on every mode flip.
            Android keeps the per-tab mode flips (different native stack). */}
        {cameraPermission?.granted && (
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing={facing}
            flash={flash}
            enableTorch={isRecording && flash !== 'off'}
            mode={Platform.OS === 'ios' ? 'video' : mode}
            mute={Platform.OS === 'ios' ? !micPermission?.granted : false}
            videoQuality="1080p"
            pictureSize={Platform.OS === 'ios' ? '1920x1080' : undefined}
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

        {/* Bottom: filmstrip above the controls row. The strip hides by opacity
            while recording — unmounting its FlatList of thumbnails right at
            record start/stop caused a visible hitch. */}
        <View style={[styles.bottom, { paddingBottom: insets.bottom + 16 }]}>
          <View
            style={isRecording && styles.stripHidden}
            pointerEvents={isRecording ? 'none' : 'auto'}
          >
            <RecentMediaStrip onSelect={handleStripSelect} />
          </View>
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
              accessibilityLabel={
                captureMode === 'video'
                  ? isRecording
                    ? 'Stop recording'
                    : 'Start recording'
                  : 'Take photo, hold to record video'
              }
            >
              <View style={[styles.shutterRing, isRecording && styles.shutterRingRecording]}>
                <Animated.View
                  style={[
                    styles.shutterInner,
                    (captureMode === 'video' || isRecording) && styles.shutterInnerRecording,
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

          {/* WhatsApp-style mode selector. Kept mounted (opacity 0) while
              recording so the shutter doesn't jump when the row hides. */}
          <View
            style={[styles.modeRow, isRecording && styles.modeRowHidden]}
            pointerEvents={isRecording ? 'none' : 'auto'}
          >
            <Animated.View
              style={[styles.modeRowInner, { transform: [{ translateX: modeRowTranslateX }] }]}
            >
              <Pressable
                onPress={() => animateCaptureMode('video')}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityState={{ selected: captureMode === 'video' }}
              >
                <Animated.Text
                  onLayout={e => setVideoLabelWidth(e.nativeEvent.layout.width)}
                  style={[styles.modeLabel, { color: videoLabelColor }]}
                >
                  VIDEO
                </Animated.Text>
              </Pressable>
              <Pressable
                onPress={() => animateCaptureMode('photo')}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityState={{ selected: captureMode === 'photo' }}
              >
                <Animated.Text
                  onLayout={e => setPhotoLabelWidth(e.nativeEvent.layout.width)}
                  style={[styles.modeLabel, { color: photoLabelColor }]}
                >
                  PHOTO
                </Animated.Text>
              </Pressable>
            </Animated.View>
          </View>
        </View>

        {/* Inline preview: caption + send (and edit/trim) on this same surface.
            The preview grows its own media from the tapped thumbnail's frame
            (openFrame) straight to its final editor size — no external modal,
            no fullscreen overshoot, no jump. */}
        {preview && (
          <View style={styles.previewOverlay}>
            {preview.isVideo ? (
              <VideoPreviewContent
                visible
                videoUri={preview.uri}
                openFrame={previewFrame}
                onSend={handlePreviewSendVideo}
                onCancel={handlePreviewCancel}
                primaryColor={primaryColor}
              />
            ) : (
              <ImagePreviewContent
                visible
                imageUri={previewImageUri ?? preview.uri}
                openFrame={previewFrame}
                onSend={handlePreviewSendImage}
                onCancel={handlePreviewCancel}
                onEdit={onCropImage ? handlePreviewEdit : undefined}
                primaryColor={primaryColor}
              />
            )}
          </View>
        )}
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
  modeRow: {
    alignItems: 'center',
    paddingTop: 18,
  },
  modeRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 36,
  },
  modeRowHidden: {
    opacity: 0,
  },
  stripHidden: {
    opacity: 0,
  },
  modeLabel: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: fs(13),
    letterSpacing: 1.2,
    fontFamily: ff('Inter', '600'),
    includeFontPadding: false,
  },
  previewOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 7,
    backgroundColor: '#000',
  },
});
