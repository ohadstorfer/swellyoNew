import { useRef, useCallback } from 'react';
import { ScrollView, Platform, NativeSyntheticEvent, NativeScrollEvent, LayoutChangeEvent } from 'react-native';

const AT_BOTTOM_THRESHOLD = 80;

export function useChatKeyboardScroll(scrollViewRef: React.RefObject<ScrollView | null>) {
  const isAtBottomRef = useRef(true);
  const contentHeightRef = useRef(0);
  const scrollViewHeightRef = useRef(0);
  const scrollOffsetRef = useRef(0);

  const updateIsAtBottom = useCallback(() => {
    const maxOffset = contentHeightRef.current - scrollViewHeightRef.current;
    isAtBottomRef.current = maxOffset <= 0 || scrollOffsetRef.current >= maxOffset - AT_BOTTOM_THRESHOLD;
  }, []);

  const scrollToBottom = useCallback((animated = true) => {
    requestAnimationFrame(() => {
      scrollViewRef.current?.scrollToEnd({ animated });
    });
  }, [scrollViewRef]);

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

    // ScrollView shrank (keyboard opened / KAV adjusted)
    if (Platform.OS !== 'web' && prevHeight > 0 && newHeight < prevHeight) {
      if (wasAtBottom) {
        // At bottom (common case with cards) — just stay at bottom
        scrollToBottom();
      } else {
        // Mid-conversation — scroll forward by shrink delta
        const delta = prevHeight - newHeight;
        scrollViewRef.current?.scrollTo({
          y: scrollOffsetRef.current + delta,
          animated: true,
        });
      }
    } else if (isAtBottomRef.current) {
      scrollToBottom();
    }
  }, [updateIsAtBottom, scrollToBottom, scrollViewRef]);

  return { handleScroll, handleContentSizeChange, handleLayout, scrollToBottom };
}
