import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Animated,
  Easing,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ff } from '../../theme/fonts';

/**
 * In-conversation search header (WhatsApp pattern): replaces the normal chat
 * header while search is active. Query input + "N of M" + ▲▼ hit navigation.
 * ▲ (up) walks to OLDER hits, ▼ (down) back toward newer ones.
 */
interface ChatSearchHeaderProps {
  query: string;
  onChangeQuery: (q: string) => void;
  /** 0-based index into the newest-first hit list. */
  currentIndex: number;
  total: number;
  onPrev: () => void; // older (▲)
  onNext: () => void; // newer (▼)
  onClose: () => void;
  loading: boolean;
}

export const ChatSearchHeader: React.FC<ChatSearchHeaderProps> = ({
  query,
  onChangeQuery,
  currentIndex,
  total,
  onPrev,
  onNext,
  onClose,
  loading,
}) => {
  const inputRef = useRef<TextInput>(null);
  // Enter: quick fade + slight rise (strong ease-out); focus rides along so
  // the keyboard opens with the bar.
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 180,
      easing: Easing.bezier(0.23, 1, 0.32, 1),
      useNativeDriver: true,
    }).start();
    const t = setTimeout(() => inputRef.current?.focus(), 40);
    return () => clearTimeout(t);
  }, [enter]);

  const hasHits = total > 0;
  // Newest-first list: "older" moves the index up, "newer" down.
  const canGoOlder = hasHits && currentIndex < total - 1;
  const canGoNewer = hasHits && currentIndex > 0;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          opacity: enter,
          transform: [
            { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
          ],
        },
      ]}
    >
      <TouchableOpacity
        onPress={onClose}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        testID="chat-search-close"
      >
        <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
      </TouchableOpacity>
      <View style={styles.inputWrap}>
        <Ionicons name="search" size={18} color="#7B7B7B" />
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={query}
          onChangeText={onChangeQuery}
          placeholder="Search"
          placeholderTextColor="#A7B8C2"
          autoCorrect={false}
          returnKeyType="search"
          testID="chat-search-input"
        />
        {loading ? (
          <ActivityIndicator size="small" color="#05BCD3" />
        ) : query.length > 0 ? (
          <TouchableOpacity onPress={() => onChangeQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={18} color="#A7B8C2" />
          </TouchableOpacity>
        ) : null}
      </View>
      <Text style={styles.counter}>
        {hasHits ? `${currentIndex + 1} of ${total}` : query.trim().length >= 2 && !loading ? '0 of 0' : ''}
      </Text>
      <TouchableOpacity
        onPress={onPrev}
        disabled={!canGoOlder}
        hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
        testID="chat-search-prev"
      >
        <Ionicons name="chevron-up" size={24} color={canGoOlder ? '#FFFFFF' : 'rgba(255,255,255,0.3)'} />
      </TouchableOpacity>
      <TouchableOpacity
        onPress={onNext}
        disabled={!canGoNewer}
        hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
        testID="chat-search-next"
      >
        <Ionicons name="chevron-down" size={24} color={canGoNewer ? '#FFFFFF' : 'rgba(255,255,255,0.3)'} />
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  // Dark palette — this bar swaps in over the dark chat header (#212121).
  container: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingVertical: 8,
    gap: 10,
    backgroundColor: 'transparent',
  },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'web' ? 8 : 6,
    gap: 6,
  },
  input: {
    flex: 1,
    fontFamily: ff('Inter'),
    fontSize: 15,
    color: '#FFFFFF',
    padding: 0,
  },
  counter: {
    fontFamily: ff('Inter'),
    fontSize: 13,
    color: '#A7B8C2',
    minWidth: 44,
    textAlign: 'center',
  },
});
