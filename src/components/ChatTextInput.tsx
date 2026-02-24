import React, {
  useState,
  useCallback,
  useEffect,
  forwardRef,
  useImperativeHandle,
  useRef,
  useLayoutEffect,
} from 'react';
import { View, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { TextInput as PaperTextInput } from 'react-native-paper';
import Svg, { Path } from 'react-native-svg';
import { colors } from '../styles/theme';

const LINE_HEIGHT = 22;
const MAX_LINES = 5;
const MIN_INPUT_HEIGHT = 25;
const MAX_INPUT_HEIGHT = LINE_HEIGHT * MAX_LINES;
const MIN_SEND_TOUCH_TARGET = 44;
const CONTAINER_VERTICAL_PADDING = 16;
const SEND_ICON_SIZE = 20;

const SendIcon = ({ size = SEND_ICON_SIZE, color = '#FFFFFF' }) => (
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

export const ChatTextInput = forwardRef(function ChatTextInput(
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
  }: any,
  ref
) {
  const inputRef = useRef<any>(null);
  const prevValueLengthRef = useRef(value.length);
  const prevLineCountRef = useRef(1);
  const [inputHeight, setInputHeight] = useState(MIN_INPUT_HEIGHT);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus?.(),
  }), []);

  function heightFromLineCount(lineCount: number): number {
    return Math.max(
      MIN_INPUT_HEIGHT,
      Math.min(MAX_INPUT_HEIGHT, lineCount * LINE_HEIGHT)
    );
  }

  /**
   * Keep height in sync with content:
   * - Empty → 1 line height.
   * - User deleted (length or line count decreased) → shrink to estimated height.
   * - Line count increased (user added newlines) → grow to at least estimated height (so we reach 5 lines even if platform doesn't report contentSize).
   * Wrapped lines (no newlines) still rely on onContentSizeChange / useLayoutEffect to grow.
   */
  useEffect(() => {
    const prevLen = prevValueLengthRef.current;
    const trimmed = value.trim();

    if (trimmed === '') {
      setInputHeight(MIN_INPUT_HEIGHT);
      prevValueLengthRef.current = 0;
      prevLineCountRef.current = 1;
      return;
    }

    const lineCount = (value.match(/\n/g)?.length ?? 0) + 1;
    const estimatedHeight = heightFromLineCount(lineCount);

    if (value.length < prevLen || lineCount < prevLineCountRef.current) {
      setInputHeight((prev) => Math.min(prev, estimatedHeight));
    } else if (lineCount > prevLineCountRef.current) {
      setInputHeight((prev) => Math.max(prev, estimatedHeight));
    }

    prevValueLengthRef.current = value.length;
    prevLineCountRef.current = lineCount;
  }, [value]);

  /**
   * WEB — measure textarea so height tracks content (expand + shrink)
   */
  useLayoutEffect(() => {
    if (Platform.OS !== 'web') return;

    const paperRef = inputRef.current;
    if (!paperRef) return;

    const textarea =
      paperRef._inputElement ||
      paperRef._root?.querySelector?.('textarea') ||
      null;

    if (!textarea) return;

    if (value.trim() === '') {
      setInputHeight(MIN_INPUT_HEIGHT);
      return;
    }

    textarea.style.height = 'auto';
    const newHeight = Math.min(
      MAX_INPUT_HEIGHT,
      Math.max(MIN_INPUT_HEIGHT, textarea.scrollHeight)
    );
    setInputHeight((prev) => (prev === newHeight ? prev : newHeight));
  }, [value]);

  /**
   * NATIVE — contentSize drives height (expand + shrink when platform reports it)
   */
  const handleContentSizeChange = useCallback((event: any) => {
    if (Platform.OS === 'web') return;

    const height = event?.nativeEvent?.contentSize?.height;
    if (!height) return;

    const newHeight = Math.min(
      MAX_INPUT_HEIGHT,
      Math.max(MIN_INPUT_HEIGHT, Math.ceil(height))
    );

    setInputHeight(prev =>
      prev === newHeight ? prev : newHeight
    );
  }, []);

  const isMaxHeight = inputHeight >= MAX_INPUT_HEIGHT;
  const hasContent = value.trim().length > 0;
  const sendDisabled = !hasContent || disabled;

  return (
    <View style={styles.root}>
      {leftAccessory && (
        <View style={styles.attachButtonWrapper}>
          {leftAccessory}
        </View>
      )}

      <View
        style={[
          styles.inputContainer,
          {
            minHeight: Math.max(
              48,
              inputHeight + CONTAINER_VERTICAL_PADDING
            ),
          },
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
            onContentSizeChange={handleContentSizeChange}
            scrollEnabled={isMaxHeight}
            style={[
              styles.paperTextInput,
              { height: inputHeight, maxHeight: MAX_INPUT_HEIGHT },
            ]}
            underlineColor="transparent"
            activeUnderlineColor="transparent"
            selectionColor={primaryColor}
            placeholderTextColor="#7B7B7B"
            textColor="#333333"
            testID={testID}
          />
        </View>

        <View style={styles.sendButtonWrapper}>
          <TouchableOpacity
            style={[
              styles.sendButton,
              sendDisabled && styles.sendButtonDisabled,
            ]}
            onPress={onSend}
            disabled={sendDisabled}
            activeOpacity={0.7}
          >
            <SendIcon />
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
    alignItems: 'flex-end',
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
    minHeight: MIN_INPUT_HEIGHT,
    alignSelf: 'stretch',
  },
  paperTextInput: {
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
    paddingVertical: 0,
    margin: 0,
    fontSize: 18,
    lineHeight: LINE_HEIGHT,
    minHeight: MIN_INPUT_HEIGHT,
    ...(Platform.OS === 'web' && {
      outline: 'none' as any,
      resize: 'none' as any,
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