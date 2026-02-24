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

// Height constants (WhatsApp/Instagram pattern): padding + (lineCount × line height)
const INPUT_PADDING_VERTICAL = 10;
const LINE_HEIGHT = 20;
const BASE_HEIGHT = INPUT_PADDING_VERTICAL * 2;
const MIN_LINES = 1;
const MAX_LINES = 5;
const MIN_INPUT_HEIGHT = BASE_HEIGHT + MIN_LINES * LINE_HEIGHT; // 40
const MAX_INPUT_HEIGHT = BASE_HEIGHT + MAX_LINES * LINE_HEIGHT;   // 120

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
    testID,
  },
  ref
) {
  const inputRef = useRef<TextInput>(null);
  const [inputHeight, setInputHeight] = useState<number>(MIN_INPUT_HEIGHT);
  const [measureWidth, setMeasureWidth] = useState<number>(0);

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
      setInputHeight(MIN_INPUT_HEIGHT);
    }
  }, [value]);

  const handleContentSizeChange = useCallback(
    (event: any) => {
      const height = event?.nativeEvent?.contentSize?.height;
      if (height == null || height < 0) return;
      const cappedHeight = Math.max(
        MIN_INPUT_HEIGHT,
        Math.min(MAX_INPUT_HEIGHT, Math.ceil(height))
      );
      if (cappedHeight !== inputHeight) {
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
    if (!value.trim() || disabled) return;
    setInputHeight(MIN_INPUT_HEIGHT);
    onSend();
  };

  const isSendDisabled = !value.trim() || disabled;

  return (
    <View style={styles.wrapper}>
      {leftAccessory != null && (
        <View style={styles.attachButtonWrapper}>{leftAccessory}</View>
      )}

      <View style={styles.messageInputContainer}>
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
                  height: inputHeight,
                  minHeight: MIN_INPUT_HEIGHT,
                  maxHeight: MAX_INPUT_HEIGHT,
                  lineHeight: LINE_HEIGHT,
                  // Single line: nudge text up so it looks vertically centered (helps when textAlignVertical is ignored, e.g. Web)
                  ...(inputHeight <= MIN_INPUT_HEIGHT && {
                    paddingTop: 8,
                    paddingBottom: 12,
                  }),
                },
              ]}
              placeholder={placeholder}
              placeholderTextColor={colors.textSecondary}
              value={value}
              onChangeText={onChangeText}
              editable={!disabled}
              multiline
              scrollEnabled={inputHeight >= MAX_INPUT_HEIGHT}
              maxLength={maxLength}
              onContentSizeChange={handleContentSizeChange}
              blurOnSubmit={false}
              returnKeyType="default"
              textAlignVertical={inputHeight <= MIN_INPUT_HEIGHT ? 'center' : 'top'}
              selectionColor={primaryColor}
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
            isSendDisabled && styles.sendButtonDisabled,
          ]}
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
    alignItems: 'center',
    width: '100%',
    ...(Platform.OS === 'web' && ({
      outlineStyle: 'none',
      outlineWidth: 0,
    } as any)),
  },
  attachButtonWrapper: {
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
    paddingBottom: 6,
    marginRight: 8,
  },
  messageInputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingLeft: 10,
    paddingRight: 8,
    paddingTop: 8,
    paddingBottom: 8,
    minHeight: 48,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 32,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 32,
    backgroundColor: colors.white,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: Platform.OS === 'android' ? 0.08 : Platform.OS === 'web' ? 0.08 : 0,
    shadowRadius: Platform.OS === 'android' ? 20 : Platform.OS === 'web' ? 20 : 0,
    elevation: Platform.OS === 'android' ? 5 : Platform.OS === 'web' ? 5 : 0,
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
    fontSize: Platform.OS === 'web' ? 16 : 16,
    fontWeight: '400',
    color: colors.textPrimary,
    padding: 0,
    paddingLeft: 8,
    paddingVertical: INPUT_PADDING_VERTICAL,
    margin: 0,
    ...(Platform.OS === 'web' && ({
      outlineStyle: 'none',
      outlineWidth: 0,
      outlineColor: 'transparent',
      WebkitTapHighlightColor: 'rgba(0, 0, 0, 0)',
      border: 'none',
      boxShadow: 'none',
      fontFamily: 'Inter, sans-serif',
    } as any)),
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
    marginBottom: 2,
    backgroundColor: '#B72DF2',
  },
  sendButtonDisabled: {
    opacity: 0.4,
    backgroundColor: '#CCCCCC',
  },
});
