import { useRef, useCallback } from 'react';
import { ScrollView, FlatList, Platform, NativeSyntheticEvent, NativeScrollEvent, LayoutChangeEvent } from 'react-native';

const AT_BOTTOM_THRESHOLD = 80;

export function useChatKeyboardScroll(
  scrollRef: React.RefObject<ScrollView | FlatList<any> | null>,
  options?: { inverted?: boolean }
) {
  const inverted = options?.inverted ?? false;
  const isAtBottomRef = useRef(true);
  const contentHeightRef = useRef(0);
  const scrollViewHeightRef = useRef(0);
  const scrollOffsetRef = useRef(0);

  const updateIsAtBottom = useCallback(() => {
    if (inverted) {
      // In inverted FlatList, offset 0 = bottom (newest messages)
      isAtBottomRef.current = scrollOffsetRef.current <= AT_BOTTOM_THRESHOLD;
    } else {
      const maxOffset = contentHeightRef.current - scrollViewHeightRef.current;
      isAtBottomRef.current = maxOffset <= 0 || scrollOffsetRef.current >= maxOffset - AT_BOTTOM_THRESHOLD;
    }
  }, [inverted]);

  const scrollToBottom = useCallback((animated = true) => {
    requestAnimationFrame(() => {
      if (inverted) {
        // In inverted FlatList, offset 0 = bottom
        (scrollRef.current as FlatList<any>)?.scrollToOffset({ offset: 0, animated });
      } else {
        (scrollRef.current as ScrollView)?.scrollToEnd({ animated });
      }
    });
  }, [scrollRef, inverted]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    scrollOffsetRef.current = contentOffset.y;
    contentHeightRef.current = contentSize.height;
    scrollViewHeightRef.current = layoutMeasurement.height;
    updateIsAtBottom();
  }, [updateIsAtBottom]);

  const handleContentSizeChange = useCallback((_w: number, h: number) => {
    contentHeightRef.current = h;
    updateIsAtBottom();
    if (isAtBottomRef.current) {
      scrollToBottom();
    }
  }, [updateIsAtBottom, scrollToBottom]);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const newHeight = event.nativeEvent.layout.height;
    const prevHeight = scrollViewHeightRef.current;
    const wasAtBottom = isAtBottomRef.current;
    scrollViewHeightRef.current = newHeight;
    updateIsAtBottom();

    if (inverted) {
      // Inverted FlatList + KeyboardAvoidingView typically handles keyboard well
      // Just ensure we stay at bottom if we were there
      if (wasAtBottom) {
        scrollToBottom();
      }
    } else {
      // ScrollView shrank (keyboard opened / KAV adjusted)
      if (Platform.OS !== 'web' && prevHeight > 0 && newHeight < prevHeight) {
        if (wasAtBottom) {
          scrollToBottom();
        } else {
          // Mid-conversation — scroll forward by shrink delta
          const delta = prevHeight - newHeight;
          (scrollRef.current as ScrollView)?.scrollTo({
            y: scrollOffsetRef.current + delta,
            animated: true,
          });
        }
      } else if (isAtBottomRef.current) {
        scrollToBottom();
      }
    }
  }, [updateIsAtBottom, scrollToBottom, scrollRef, inverted]);

  return { handleScroll, handleContentSizeChange, handleLayout, scrollToBottom };
}
