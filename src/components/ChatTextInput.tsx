/**
 * ChatTextInput – WhatsApp-style message input bar.
 * Height follows content size (onContentSizeChange on native; hidden mirror on Web).
 * Expands and shrinks with content; caps at 5 lines then scrolls. Resets to 1 line when value is empty.
 */

import React, { useState, useEffect, useCallback, forwardRef, useImperativeHandle, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { colors } from '../styles/theme';
import { useKeyboardVisible } from '../hooks/useKeyboardVisible';
import { useVoiceRecorder, type VoiceRecording } from '../hooks/useVoiceRecorder';
import { RecordingOverlay } from './RecordingOverlay';
import { LockedRecordingBar } from './LockedRecordingBar';

export type { VoiceRecording } from '../hooks/useVoiceRecorder';

const KEYBOARD_GAP = 4;

// Height constants (WhatsApp/Instagram pattern): padding + (lineCount × line height)
// Ensure BASE_HEIGHT + (1 * LINE_HEIGHT) === MIN_INPUT_HEIGHT to avoid twitch between effect and onContentSizeChange
const INPUT_PADDING_VERTICAL = 10;
// 22 matches the message bubble text lineHeight so a paragraph wraps the
// same number of lines in the composer and in the sent bubble.
const LINE_HEIGHT = 22;
const BASE_HEIGHT = INPUT_PADDING_VERTICAL * 2;
const MIN_LINES = 1;
const MAX_LINES = 5;
const MIN_INPUT_HEIGHT = BASE_HEIGHT + LINE_HEIGHT; // 40, same as BASE_HEIGHT + (1 * LINE_HEIGHT)
const MAX_INPUT_HEIGHT = BASE_HEIGHT + MAX_LINES * LINE_HEIGHT; // 120

const SEND_ICON_SIZE = 20;

// Composer shrink duration on send. Set to 2000 to put it in slow-mo for
// visual debugging (see memory: chat_animation_slowmo_knobs.md).
const SEND_SHRINK_DURATION_MS = 180;
// Vertical padding on messageInputContainer (paddingTop + paddingBottom).
// Used to translate input content height ↔ container outer height.
const MESSAGE_CONTAINER_VPADDING = 8;

const SendIcon = ({ color = '#FFFFFF' }: { color?: string }) => (
  <Svg width={SEND_ICON_SIZE} height={SEND_ICON_SIZE} viewBox="0 0 24 24" fill="none">
    <Path
      d="M10.4995 13.5001L20.9995 3.00005M10.6271 13.8281L13.2552 20.5861C13.4867 21.1815 13.6025 21.4791 13.7693 21.566C13.9139 21.6414 14.0862 21.6415 14.2308 21.5663C14.3977 21.4796 14.5139 21.1821 14.7461 20.587L21.3364 3.69925C21.5461 3.16207 21.6509 2.89348 21.5935 2.72185C21.5437 2.5728 21.4268 2.45583 21.2777 2.40604C21.1061 2.34871 20.8375 2.45352 20.3003 2.66315L3.41258 9.25349C2.8175 9.48572 2.51997 9.60183 2.43326 9.76873C2.35809 9.91342 2.35819 10.0857 2.43353 10.2303C2.52043 10.3971 2.81811 10.5128 3.41345 10.7444L10.1715 13.3725C10.2923 13.4195 10.3527 13.443 10.4036 13.4793C10.4487 13.5114 10.4881 13.5509 10.5203 13.596C10.5566 13.6468 10.5801 13.7073 10.6271 13.8281Z"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export interface ChatTextInputProps {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  disabled?: boolean;
  placeholder?: string;
  maxLength?: number;
  leftAccessory?: React.ReactNode;
  primaryColor?: string;
  /** Optional overrides — used by the image preview modal to render a dark variant. */
  backgroundColor?: string;
  textColor?: string;
  placeholderColor?: string;
  /** When true, send stays enabled even with an empty value. Image/video
   * previews use this so users can send a media file without a caption. */
  allowEmpty?: boolean;
  testID?: string;
  /** Native view id — required when pairing with KeyboardGestureArea's
   * `textInputNativeID` to extend the interactive-dismiss zone up to the
   * composer (so dragging from inside the composer also moves the keyboard). */
  nativeID?: string;
  /** Push-to-talk voice messages. When provided AND the text field is empty,
   * the send button is replaced by a mic button (native only). Press-and-hold
   * records, release sends, slide-left cancels. Web does not render the mic.  */
  onVoiceMessage?: (audio: VoiceRecording) => void;
  /** Native-camera capture. When provided AND the text field is empty, a small
   * camera icon appears just left of the mic. Hidden on web (the leftAccessory's
   * file picker covers web). Fades out while a voice recording is in flight. */
  onCameraPress?: () => void;
}

export interface ChatTextInputRef {
  focus: () => void;
  clear: () => void;
}

export const ChatTextInput = forwardRef<ChatTextInputRef, ChatTextInputProps>(function ChatTextInput(
  {
    value,
    onChangeText,
    onSend,
    disabled = false,
    placeholder = 'Type your message..',
    maxLength = 500,
    leftAccessory,
    primaryColor = '#B72DF2',
    backgroundColor,
    textColor,
    placeholderColor,
    allowEmpty = false,
    testID,
    nativeID,
    onVoiceMessage,
    onCameraPress,
  },
  ref
) {
  const inputRef = useRef<TextInput>(null);
  const justSentRef = useRef<boolean>(false);
  const lastLineCountRef = useRef<number>(1);
  const [inputHeight, setInputHeight] = useState<number>(MIN_INPUT_HEIGHT);
  const [measureWidth, setMeasureWidth] = useState<number>(0);
  const keyboardVisible = useKeyboardVisible();

  // While typing, Yoga drives the container height naturally from TextInput's
  // multiline auto-grow. For the post-send shrink we need explicit control:
  // iOS's UITextView collapses its frame immediately when value clears,
  // before Reanimated's layout-transition system can snapshot a size change.
  //
  // We use minHeight (not height) for the override. Reasons:
  //  - Reanimated doesn't reliably "release" a height prop when the animated
  //    style returns undefined — the last value sticks, and Yoga can't
  //    reclaim. With minHeight we always return a real number (0 when not
  //    shrinking), so the constraint is removed cleanly.
  //  - During shrink the TextInput is empty (40px intrinsic), so
  //    max(content, minHeight) === minHeight — the container follows the
  //    animation. When minHeight goes back to 0, Yoga drives freely.
  const isShrinkingFromSendSv = useSharedValue<boolean>(false);
  const shrinkHeightSv = useSharedValue<number>(
    MIN_INPUT_HEIGHT + MESSAGE_CONTAINER_VPADDING
  );

  const shrinkAnimatedStyle = useAnimatedStyle(() => ({
    minHeight: isShrinkingFromSendSv.value ? shrinkHeightSv.value : 0,
  }));

  useImperativeHandle(
    ref,
    () => ({
      focus: () => inputRef.current?.focus?.(),
      clear: () => {
        onChangeText('');
        setInputHeight(MIN_INPUT_HEIGHT);
      },
    }),
    [onChangeText]
  );

  useEffect(() => {
    if (value === '') {
      lastLineCountRef.current = 0;
      setInputHeight(MIN_INPUT_HEIGHT);
      return;
    }
    const lineCount = 1 + (value.match(/\n/g) || []).length;
    if (lineCount < lastLineCountRef.current) {
      const clampedLines = Math.min(Math.max(lineCount, MIN_LINES), MAX_LINES);
      const heightFromValue = BASE_HEIGHT + clampedLines * LINE_HEIGHT;
      const nextHeight = Math.max(MIN_INPUT_HEIGHT, Math.min(MAX_INPUT_HEIGHT, heightFromValue));
      setInputHeight(nextHeight);
    }
    lastLineCountRef.current = lineCount;
  }, [value]);

  const handleContentSizeChange = useCallback(
    (event: any) => {
      const height = event?.nativeEvent?.contentSize?.height;
      if (height == null || height < 0) return;
      const cappedHeight = Math.max(
        MIN_INPUT_HEIGHT,
        Math.min(MAX_INPUT_HEIGHT, Math.ceil(height))
      );
      // Tolerance: ignore sub-pixel/1px deltas to avoid flicker loops on iOS
      if (Math.abs(cappedHeight - inputHeight) >= 2) {
        setInputHeight(cappedHeight);
      }
    },
    [inputHeight]
  );

  const handleWebMeasureLayout = useCallback((event: any) => {
    if (Platform.OS !== 'web') return;
    const { height } = event.nativeEvent.layout;
    const clamped = Math.max(
      MIN_INPUT_HEIGHT,
      Math.min(MAX_INPUT_HEIGHT, Math.ceil(height))
    );
    setInputHeight(clamped);
  }, []);

  const handleSend = () => {
    if (disabled) return;
    if (!allowEmpty && !value.trim()) return;
    // Mark a short window where onBlur should auto-refocus — the re-render
    // from clearing value + LayoutAnimation can blur the TextInput on iOS.
    justSentRef.current = true;
    setTimeout(() => { justSentRef.current = false; }, 400);

    // Slow shrink animation when collapsing the composer back from multi-line
    // to one line. We seed the SV with the CURRENT natural height (so the
    // animation starts from where the bar actually is, not from whatever the
    // SV last held), flip on the override flag, and start the slow timing.
    // After the animation completes we drop the override; the bar's empty-
    // content natural height matches the SV's end value, so the handoff is
    // visually seamless.
    const wasMultiline = inputHeight > MIN_INPUT_HEIGHT;
    if (wasMultiline) {
      const startHeight = inputHeight + MESSAGE_CONTAINER_VPADDING;
      const targetHeight = MIN_INPUT_HEIGHT + MESSAGE_CONTAINER_VPADDING;
      shrinkHeightSv.value = startHeight;
      isShrinkingFromSendSv.value = true;
      shrinkHeightSv.value = withTiming(targetHeight, {
        duration: SEND_SHRINK_DURATION_MS,
        easing: Easing.inOut(Easing.ease),
      });
      setTimeout(() => {
        isShrinkingFromSendSv.value = false;
      }, SEND_SHRINK_DURATION_MS + 50);
    }
    setInputHeight(MIN_INPUT_HEIGHT);
    onSend();
    // Synchronous refocus — UIKit collapses this with any pending
    // resignFirstResponder on the same run loop, so no visual dismiss occurs.
    inputRef.current?.focus();
  };

  const isSendDisabled = disabled || (!allowEmpty && !value.trim());

  // Voice message recording — WhatsApp-style push-to-talk with two release
  // axes: slide LEFT to cancel, slide UP to lock. After lock, the composer is
  // replaced by a hands-free recording bar (trash + send). Mic shows only on
  // native, when onVoiceMessage is provided AND the text field is empty.
  // Anything in the text input takes precedence: typing always restores send.
  const recorder = useVoiceRecorder();
  const [isCancelArmed, setIsCancelArmed] = useState(false);
  const [isLockArmed, setIsLockArmed] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const isRecording =
    recorder.state === 'recording' || recorder.state === 'finalizing';
  // Hide the mic button (and force the locked bar to take over) once locked.
  // typing in the input also kicks us back to the send button.
  const showMic =
    !!onVoiceMessage && !disabled && !value && Platform.OS !== 'web' && !isLocked;
  // Camera affordance follows the same visibility rules as the mic: native
  // only, no text, not disabled, not locked. When the user starts holding the
  // mic to record, the camera fades out — animating width + marginRight too so
  // the space collapses and the RecordingOverlay can expand into it.
  const showCamera =
    !!onCameraPress && !disabled && !value && Platform.OS !== 'web' && !isLocked;
  const cameraVisibleSv = useSharedValue<number>(1);
  useEffect(() => {
    cameraVisibleSv.value = withTiming(isRecording ? 0 : 1, { duration: 120 });
  }, [isRecording, cameraVisibleSv]);
  const cameraAnimatedStyle = useAnimatedStyle(() => ({
    opacity: cameraVisibleSv.value,
    width: cameraVisibleSv.value * 32,
    marginRight: cameraVisibleSv.value * 4,
  }));
  const recordStartXRef = useRef<number>(0);
  const recordStartYRef = useRef<number>(0);
  const cancelArmedRef = useRef<boolean>(false);
  const lockArmedRef = useRef<boolean>(false);
  const CANCEL_THRESHOLD_PX = 80;
  const LOCK_THRESHOLD_PX = 60;

  const beginVoiceRecord = useCallback(async (pageX: number, pageY: number) => {
    recordStartXRef.current = pageX;
    recordStartYRef.current = pageY;
    cancelArmedRef.current = false;
    lockArmedRef.current = false;
    setIsCancelArmed(false);
    setIsLockArmed(false);
    Keyboard.dismiss();
    await recorder.start();
  }, [recorder]);

  const updateVoicePan = useCallback((pageX: number, pageY: number) => {
    const dx = pageX - recordStartXRef.current;
    const dy = pageY - recordStartYRef.current;
    // Cancel takes precedence over lock — if the user has slid hard left,
    // ignore any vertical component. WhatsApp behaves the same way.
    const cancelArmed = dx <= -CANCEL_THRESHOLD_PX;
    const lockArmed = !cancelArmed && dy <= -LOCK_THRESHOLD_PX;
    if (cancelArmed !== cancelArmedRef.current) {
      cancelArmedRef.current = cancelArmed;
      setIsCancelArmed(cancelArmed);
    }
    if (lockArmed !== lockArmedRef.current) {
      lockArmedRef.current = lockArmed;
      setIsLockArmed(lockArmed);
    }
  }, []);

  const resetGestureFlags = useCallback(() => {
    setIsCancelArmed(false);
    setIsLockArmed(false);
    cancelArmedRef.current = false;
    lockArmedRef.current = false;
  }, []);

  const finishVoiceRecord = useCallback(async () => {
    if (cancelArmedRef.current) {
      await recorder.cancel();
      resetGestureFlags();
      return;
    }
    if (lockArmedRef.current) {
      // Lock — keep the recorder running, swap the composer for the
      // hands-free locked bar. The recorder.state stays 'recording' so
      // stop()/cancel() from the locked bar work without changes.
      resetGestureFlags();
      setIsLocked(true);
      return;
    }
    const result = await recorder.stop();
    resetGestureFlags();
    if (result && onVoiceMessage) {
      onVoiceMessage(result);
    }
  }, [onVoiceMessage, recorder, resetGestureFlags]);

  const cancelLockedRecording = useCallback(async () => {
    await recorder.cancel();
    setIsLocked(false);
  }, [recorder]);

  const sendLockedRecording = useCallback(async () => {
    const result = await recorder.stop();
    setIsLocked(false);
    if (result && onVoiceMessage) {
      onVoiceMessage(result);
    }
  }, [onVoiceMessage, recorder]);

  // Locked recording — entire composer (input + mic + leftAccessory) is
  // replaced by the hands-free bar. Returning early keeps the rest of the
  // render simple.
  if (isLocked) {
    return (
      <View
        style={[
          styles.wrapper,
          keyboardVisible && Platform.OS !== 'web' && { paddingBottom: KEYBOARD_GAP },
        ]}
      >
        <LockedRecordingBar
          durationMs={recorder.durationMs}
          liveWaveform={recorder.liveWaveform}
          primaryColor={primaryColor}
          onCancel={() => { void cancelLockedRecording(); }}
          onSend={() => { void sendLockedRecording(); }}
        />
      </View>
    );
  }

  return (
    <View
      style={[
        styles.wrapper,
        keyboardVisible && Platform.OS !== 'web' && { paddingBottom: KEYBOARD_GAP },
      ]}
    >
      {/* Lock pill — sits above the mic during a held recording. As the user
          slides their finger up past LOCK_THRESHOLD_PX the lock icon flips to
          'closed' to signal that releasing now will lock. pointerEvents=none
          so the touch stream stays on the mic responder underneath. */}
      {isRecording && (
        <View
          pointerEvents="none"
          style={[styles.lockPill, isLockArmed && styles.lockPillArmed]}
        >
          <Ionicons
            name={isLockArmed ? 'lock-closed' : 'lock-open-outline'}
            size={18}
            color={isLockArmed ? colors.brandTeal : colors.textPrimary}
          />
          <Ionicons
            name="chevron-up"
            size={14}
            color={isLockArmed ? colors.brandTeal : colors.textSecondary}
            style={{ marginTop: 4 }}
          />
        </View>
      )}
      {leftAccessory != null && (
        <View style={styles.attachButtonWrapper}>{leftAccessory}</View>
      )}

      <Animated.View
        style={[
          styles.messageInputContainer,
          backgroundColor ? { backgroundColor } : null,
          shrinkAnimatedStyle,
        ]}
      >
        {isRecording ? (
          <RecordingOverlay
            durationMs={recorder.durationMs}
            liveWaveform={recorder.liveWaveform}
            isCancelArmed={isCancelArmed}
          />
        ) : (
          <View style={styles.inputContainer}>
            <View
              style={styles.textWrapper}
              onLayout={(e) => setMeasureWidth(e.nativeEvent.layout.width)}
            >
              {/* Web-only: hidden mirror to measure wrapped text height (onContentSizeChange is unreliable on web) */}
              {Platform.OS === 'web' && measureWidth > 0 && (
                <View
                  style={[styles.webMeasureMirror, { width: measureWidth }]}
                  onLayout={handleWebMeasureLayout}
                >
                  <Text style={styles.webMeasureText} numberOfLines={MAX_LINES}>
                    {value || ' '}
                  </Text>
                </View>
              )}
              <TextInput
                ref={inputRef}
                nativeID={nativeID}
                style={[
                  styles.inputText,
                  {
                    // On web, drive height from mirror measurement; on native, let multiline auto-size.
                    // The container's animated height owns the visible shrink animation.
                    ...(Platform.OS === 'web' ? { height: inputHeight } : {}),
                    minHeight: MIN_INPUT_HEIGHT,
                    maxHeight: MAX_INPUT_HEIGHT,
                    lineHeight: LINE_HEIGHT,
                    // Single line: balance vertical centering on Web (textAlignVertical is ignored there).
                    // Web-only — on iOS the padding flip interacts with onContentSizeChange sub-pixel deltas and produces a visible "shake" (Apple reject 2.1a)
                    ...(Platform.OS === 'web' && inputHeight <= MIN_INPUT_HEIGHT && {
                      paddingTop: 12,
                      paddingBottom: 12,
                    }),
                    ...(textColor ? { color: textColor } : null),
                  },
                ]}
                placeholder={placeholder}
                placeholderTextColor={placeholderColor ?? colors.textSecondary}
                value={value}
                onChangeText={onChangeText}
                multiline
                scrollEnabled={inputHeight >= MAX_INPUT_HEIGHT}
                maxLength={maxLength}
                onContentSizeChange={handleContentSizeChange}
                onBlur={() => {
                  // Auto-refocus if blur fired during the send re-render window.
                  // Synchronous to preempt the native dismiss (deferring with rAF
                  // lets UIKit/IME commit the dismiss visually before we undo it).
                  if (justSentRef.current) {
                    inputRef.current?.focus();
                  }
                }}
                blurOnSubmit={false}
                returnKeyType="default"
                textAlignVertical={inputHeight <= MIN_INPUT_HEIGHT ? 'center' : 'top'}
                testID={testID}
                {...(Platform.OS === 'web' && {
                  outlineStyle: 'none',
                  outlineWidth: 0,
                  outlineColor: 'transparent',
                  boxShadow: 'none',
                  WebkitTapHighlightColor: 'rgba(0, 0, 0, 0)',
                  WebkitAppearance: 'none',
                  MozAppearance: 'none',
                  appearance: 'none',
                })}
              />
            </View>
          </View>
        )}

        {showCamera && (
          // Native-camera affordance. Sits just left of the mic; fades + collapses
          // its width during a held recording so the RecordingOverlay can take
          // over the row. pointerEvents off while recording (taps shouldn't fire
          // mid-fade) and while collapsed.
          <Animated.View
            style={[styles.cameraButton, cameraAnimatedStyle]}
            pointerEvents={isRecording ? 'none' : 'auto'}
          >
            <TouchableOpacity
              onPress={onCameraPress}
              disabled={disabled}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.cameraButtonInner}
              testID={testID ? `${testID}-camera` : undefined}
            >
              <Ionicons name="camera" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
          </Animated.View>
        )}

        {showMic ? (
          // Push-to-talk mic button. We use the React Native responder system
          // directly (not Pressable / TouchableOpacity) because we need pan
          // tracking on BOTH axes (left = cancel, up = lock) — the responder
          // gives us a continuous pageX/pageY stream from press-in to release.
          // Note: never set `transform: undefined`. New-architecture Reanimated
          // does not tolerate it (processTransform → forEach on null). Spread
          // the transform key in only when we actually want to scale.
          <View
            style={[
              styles.sendButton,
              {
                backgroundColor: isRecording
                  ? (isCancelArmed ? '#E74C3C' : primaryColor)
                  : primaryColor,
                ...(isRecording ? { transform: [{ scale: 1.15 }] } : null),
              },
            ]}
            onStartShouldSetResponder={() => true}
            onResponderGrant={(e) => {
              beginVoiceRecord(e.nativeEvent.pageX, e.nativeEvent.pageY);
            }}
            onResponderMove={(e) => {
              if (!isRecording) return;
              updateVoicePan(e.nativeEvent.pageX, e.nativeEvent.pageY);
            }}
            onResponderRelease={() => { void finishVoiceRecord(); }}
            onResponderTerminate={() => { void finishVoiceRecord(); }}
            testID={testID ? `${testID}-mic` : undefined}
          >
            <Ionicons
              name={isCancelArmed ? 'trash' : 'mic'}
              size={20}
              color="#FFFFFF"
            />
          </View>
        ) : (
          <TouchableOpacity
            style={[
              styles.sendButton,
              { backgroundColor: primaryColor },
              isSendDisabled && styles.sendButtonDisabled,
            ]}
            onPressIn={() => {
              // Pre-empt any focus transfer from the touch-down gesture: claim
              // the send window and re-assert focus synchronously on the same
              // run loop as the native touch event.
              if (disabled || (!allowEmpty && !value.trim())) return;
              justSentRef.current = true;
              inputRef.current?.focus();
            }}
            onPress={handleSend}
            activeOpacity={0.7}
            disabled={isSendDisabled}
            testID={testID ? `${testID}-send` : undefined}
          >
            <SendIcon color="#FFFFFF" />
          </TouchableOpacity>
        )}
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    width: '100%',
    ...(Platform.OS === 'web' && ({
      outlineStyle: 'none',
      outlineWidth: 0,
    } as any)),
  },
  attachButtonWrapper: {
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
    paddingBottom: 10,
    marginRight: 8,
  },
  messageInputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingLeft: 10,
    paddingRight: 8,
    paddingTop: 4,
    paddingBottom: 4,
    
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    backgroundColor: colors.white,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 5,
    ...(Platform.OS === 'web' && {
      boxShadow: '0px 0px 20px rgba(0, 0, 0, 0.08)',
    }),
  },
  inputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 0,
    paddingRight: 8,
    paddingVertical: 0,
  },
  textWrapper: {
    flex: 1,
    position: 'relative',
  },
  webMeasureMirror: {
    position: 'absolute',
    left: 0,
    top: 0,
    opacity: 0,
    pointerEvents: 'none',
    paddingVertical: INPUT_PADDING_VERTICAL,
    paddingHorizontal: 8,
    zIndex: -1,
    ...(Platform.OS === 'web' && ({
      visibility: 'hidden' as any,
      overflow: 'hidden' as any,
    })),
  },
  // Mirror uses whiteSpace: pre-wrap on Web so newlines (Enter) are respected and handleWebMeasureLayout sees correct height
  webMeasureText: {
    fontSize: 17,
    lineHeight: LINE_HEIGHT,
    color: colors.textPrimary,
    width: '100%',
    ...(Platform.OS === 'web' && ({
      fontFamily: 'Inter, sans-serif',
      whiteSpace: 'pre-wrap' as any,
      wordBreak: 'break-word' as any,
    })),
  },
  inputText: {
    width: '100%',
    fontSize: 17,
    fontWeight: '400',
    color: colors.textPrimary,
    fontFamily: Platform.OS === 'web' ? undefined : 'Inter',
    padding: 0,
    paddingLeft: 8,
    paddingTop: 12,
    paddingBottom: 8,
    ...(Platform.OS === 'android' && { includeFontPadding: false }),
    margin: 0,
    ...(Platform.OS === 'web' && ({
      outlineStyle: 'none',
      outlineWidth: 0,
      outlineColor: 'transparent',
      WebkitTapHighlightColor: 'rgba(0, 0, 0, 0)',
      border: 'none',
      boxShadow: 'none',
      fontFamily: 'Inter, sans-serif',
      // Suppress the native <textarea> scroll track / resize handle that
      // RN-Web renders for multiline inputs. Most visible on dark backgrounds,
      // where the default gray track reads as a vertical line next to the send button.
      resize: 'none' as any,
      scrollbarWidth: 'none' as any,
      msOverflowStyle: 'none' as any,
    } as any)),
  },
  sendButton: {
    width: 32,
    height: 32,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'flex-end',
    marginBottom: 4,
    marginLeft: 8,
    backgroundColor: '#B72DF2',
  },
  cameraButton: {
    height: 32,
    alignSelf: 'flex-end',
    marginBottom: 4,
    overflow: 'hidden',
  },
  cameraButtonInner: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.4,
    backgroundColor: '#CCCCCC',
  },
  // Lock pill — floats above the mic button while a held recording is in
  // flight. Anchored to the right of the wrapper, going UP via bottom:'100%'.
  lockPill: {
    position: 'absolute',
    right: 4,
    bottom: '100%',
    marginBottom: 8,
    width: 36,
    paddingVertical: 12,
    paddingHorizontal: 6,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
    zIndex: 10,
  },
  lockPillArmed: {
    borderWidth: 1.5,
    borderColor: colors.brandTeal,
  },
});
