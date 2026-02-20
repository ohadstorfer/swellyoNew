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
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../styles/theme';

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
            <Ionicons name="arrow-up" size={20} color="#FFFFFF" />
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
      scrollbarColor: 'rgba(123, 123, 123, 0.4) transparent' as any,
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
