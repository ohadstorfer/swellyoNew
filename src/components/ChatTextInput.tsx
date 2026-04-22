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
  LayoutAnimation,
  UIManager,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
import { colors } from '../styles/theme';
import { useKeyboardVisible } from '../hooks/useKeyboardVisible';

const KEYBOARD_GAP = 4;

// Height constants (WhatsApp/Instagram pattern): padding + (lineCount × line height)
// Ensure BASE_HEIGHT + (1 * LINE_HEIGHT) === MIN_INPUT_HEIGHT to avoid twitch between effect and onContentSizeChange
const INPUT_PADDING_VERTICAL = 10;
const LINE_HEIGHT = 20;
const BASE_HEIGHT = INPUT_PADDING_VERTICAL * 2;
const MIN_LINES = 1;
const MAX_LINES = 5;
const MIN_INPUT_HEIGHT = BASE_HEIGHT + LINE_HEIGHT; // 40, same as BASE_HEIGHT + (1 * LINE_HEIGHT)
const MAX_INPUT_HEIGHT = BASE_HEIGHT + MAX_LINES * LINE_HEIGHT; // 120

const SEND_ICON_SIZE = 20;

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
  },
  ref
) {
  const inputRef = useRef<TextInput>(null);
  const justSentRef = useRef<boolean>(false);
  const lastLineCountRef = useRef<number>(1);
  const [inputHeight, setInputHeight] = useState<number>(MIN_INPUT_HEIGHT);
  const [measureWidth, setMeasureWidth] = useState<number>(0);
  const keyboardVisible = useKeyboardVisible();

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
        if (Platform.OS !== 'web') {
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        }
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
    setInputHeight(MIN_INPUT_HEIGHT);
    onSend();
    // Synchronous refocus — UIKit collapses this with any pending
    // resignFirstResponder on the same run loop, so no visual dismiss occurs.
    inputRef.current?.focus();
  };

  const isSendDisabled = disabled || (!allowEmpty && !value.trim());

  return (
    <View
      style={[
        styles.wrapper,
        keyboardVisible && Platform.OS !== 'web' && { paddingBottom: KEYBOARD_GAP },
      ]}
    >
      {leftAccessory != null && (
        <View style={styles.attachButtonWrapper}>{leftAccessory}</View>
      )}

      <View
        style={[
          styles.messageInputContainer,
          backgroundColor ? { backgroundColor } : null,
        ]}
      >
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
              style={[
                styles.inputText,
                {
                  // On web, drive height from mirror measurement; on native, let multiline auto-size
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
      </View>
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
    fontSize: 16,
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
    fontSize: 16,
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
  sendButtonDisabled: {
    opacity: 0.4,
    backgroundColor: '#CCCCCC',
  },
});
