/**
 * ChatTextInput – WhatsApp-style chat input bar.
 *
 * Design decisions:
 * - Return key always inserts newline; send only via the Send button. This keeps behavior
 *   predictable and accessible and matches product goal (dedicated Send button).
 * - Height is driven by onContentSizeChange with a small threshold to avoid jitter and
 *   excessive re-renders; no hacky line counting or manual measurement.
 * - We do not dismiss the keyboard on send so the user can send multiple messages in a row
 *   without re-focusing the input.
 */

import React, { useState, useCallback, forwardRef, useImperativeHandle, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { TextInput as PaperTextInput } from 'react-native-paper';
import Svg, { Path } from 'react-native-svg';
import { colors } from '../styles/theme';

const SEND_ICON_SIZE = 20;
const SendIcon = ({ size = SEND_ICON_SIZE, color = '#FFFFFF' }: { size?: number; color?: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M10.4995 13.5001L20.9995 3.00005M10.6271 13.8281L13.2552 20.5861C13.4867 21.1815 13.6025 21.4791 13.7693 21.566C13.9139 21.6414 14.0862 21.6415 14.2308 21.5663C14.3977 21.4796 14.5139 21.1821 14.7461 20.587L21.3364 3.69925C21.5461 3.16207 21.6509 2.89348 21.5935 2.72185C21.5437 2.5728 21.4268 2.45583 21.2777 2.40604C21.1061 2.34871 20.8375 2.45352 20.3003 2.66315L3.41258 9.25349C2.8175 9.48572 2.51997 9.60183 2.43326 9.76873C2.35809 9.91342 2.35819 10.0857 2.43353 10.2303C2.52043 10.3971 2.81811 10.5128 3.41345 10.7444L10.1715 13.3725C10.2923 13.4195 10.3527 13.443 10.4036 13.4793C10.4487 13.5114 10.4881 13.5509 10.5203 13.596C10.5566 13.6468 10.5801 13.7073 10.6271 13.8281Z"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

const LINE_HEIGHT = 22;
const MAX_LINES = 5;
const MIN_INPUT_HEIGHT = 25;
const MAX_INPUT_HEIGHT = LINE_HEIGHT * MAX_LINES; // 110
const HEIGHT_UPDATE_THRESHOLD = 1;
const MIN_SEND_TOUCH_TARGET = 44;
const CONTAINER_VERTICAL_PADDING = 16;

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
  const inputRef = useRef<any>(null);
  const [inputHeight, setInputHeight] = useState(MIN_INPUT_HEIGHT);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus?.(),
  }), []);

  const handleContentSizeChange = useCallback(
    (event: any) => {
      const { height } = event.nativeEvent?.contentSize ?? {};
      if (height == null || height < 0) return;
      const calculated = Math.max(MIN_INPUT_HEIGHT, Math.ceil(height));
      const capped = Math.min(calculated, MAX_INPUT_HEIGHT);
      setInputHeight((prev) => {
        if (Math.abs(capped - prev) < HEIGHT_UPDATE_THRESHOLD) return prev;
        return capped;
      });
    },
    []
  );

  const hasContent = value.trim().length > 0;
  const sendDisabled = !hasContent || disabled;

  return (
    <View style={styles.root}>
      {leftAccessory != null ? (
        <View style={styles.attachButtonWrapper}>{leftAccessory}</View>
      ) : null}
      <View
        style={[
          styles.inputContainer,
          { minHeight: Math.max(48, inputHeight + CONTAINER_VERTICAL_PADDING) },
        ]}
      >
        <View style={styles.inputInnerContainer}>
          <PaperTextInput
            ref={inputRef}
            mode="flat"
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            multiline
            maxLength={maxLength}
            blurOnSubmit={false}
            returnKeyType="default"
            onContentSizeChange={handleContentSizeChange}
            scrollEnabled={inputHeight >= MAX_INPUT_HEIGHT}
            textAlignVertical={inputHeight <= MIN_INPUT_HEIGHT ? 'center' : 'top'}
            style={[
              styles.paperTextInput,
              {
                height: inputHeight,
                maxHeight: MAX_INPUT_HEIGHT,
                ...(inputHeight <= MIN_INPUT_HEIGHT && { paddingTop: 5 }),
              },
            ]}
            contentStyle={[
              styles.paperTextInputContent,
              { paddingTop: 0, paddingBottom: 0, minHeight: MIN_INPUT_HEIGHT },
            ]}
            underlineColor="transparent"
            activeUnderlineColor="transparent"
            selectionColor={primaryColor}
            placeholderTextColor="#7B7B7B"
            textColor="#333333"
            theme={{
              colors: {
                primary: primaryColor,
                text: '#333333',
                placeholder: '#7B7B7B',
                background: 'transparent',
              },
            }}
            testID={testID}
          />
        </View>
        <View style={styles.sendButtonWrapper}>
          <TouchableOpacity
            style={[styles.sendButton, sendDisabled && styles.sendButtonDisabled]}
            onPress={onSend}
            disabled={sendDisabled}
            activeOpacity={0.7}
            testID={testID ? `${testID}-send` : undefined}
          >
            <SendIcon size={SEND_ICON_SIZE} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  attachButtonWrapper: {
    paddingBottom: 15,
    marginRight: 8,
  },
  inputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    paddingLeft: 10,
    paddingRight: 8,
    paddingTop: 8,
    paddingBottom: 8,
    minHeight: 48,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 32,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 32,
    ...(Platform.OS === 'web' && {
      boxShadow: '0px 0px 20px rgba(0, 0, 0, 0.08)',
      transition: 'min-height 0.2s ease' as any,
    }),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 5,
  },
  inputInnerContainer: {
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 0,
    justifyContent: 'center',
    minHeight: 25,
    position: 'relative',
    alignSelf: 'stretch',
  },
  paperTextInput: {
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
    paddingVertical: 0,
    margin: 0,
    fontSize: 18,
    fontWeight: '400',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    lineHeight: LINE_HEIGHT,
    minHeight: MIN_INPUT_HEIGHT,
    textAlign: 'left',
    ...(Platform.OS === 'web' && {
      outline: 'none' as any,
      resize: 'none' as any,
      overflow: 'auto' as any,
      overflowY: 'auto' as any,
      textAlign: 'left' as any,
      // Improved scrollbar: thin, subtle grey thumb; transparent track for a cleaner look
      scrollbarWidth: 'thin' as any,
      //scrollbarColor: 'rgba(123, 123, 123, 0.4) transparent' as any,
    }),
  },
  paperTextInputContent: {
    paddingHorizontal: 0,
    paddingVertical: 0,
    margin: 0,
    minHeight: MIN_INPUT_HEIGHT,
    fontSize: 18,
    lineHeight: LINE_HEIGHT,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    textAlign: 'left',
    ...(Platform.OS === 'web' && {
      outline: 'none' as any,
      textAlign: 'left' as any,
    }),
  },
  sendButtonWrapper: {
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  sendButton: {
    width: MIN_SEND_TOUCH_TARGET,
    height: MIN_SEND_TOUCH_TARGET,
    borderRadius: MIN_SEND_TOUCH_TARGET / 2,
    backgroundColor: '#B72DF2',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
});
