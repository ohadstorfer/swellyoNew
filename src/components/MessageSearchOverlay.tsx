import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Keyboard,
  Animated,
  Easing,
  BackHandler,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  messagingService,
  Conversation,
  MessageSearchResult,
} from '../services/messaging/messagingService';
import { buildSnippet } from '../utils/messageSearch';
import { ProfileImage } from './ProfileImage';
import { ff } from '../theme/fonts';

/**
 * Full-screen global message search (WhatsApp-style), opened from the
 * Chats-list search bar. Two sections:
 *   • Chats    — in-memory name filter of the already-loaded conversation list
 *   • Messages — search_messages RPC hits across all the user's conversations
 *
 * Transition: the search input starts at the tapped bar's on-screen position
 * (`originY`) and slides up into the header while the page fades in — the
 * WhatsApp "bar rises into search mode" effect. Exit reverses it, faster.
 */

const MIN_QUERY = 2;
const DEBOUNCE_MS = 300;
// Strong ease-out — built-in curves are too weak for this move.
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const ENTER_MS = 300;
const EXIT_MS = 250;
// Search bar / close-circle height — fallback only; the real value is the
// MEASURED height of the list's search bar (originHeight) so the bar lands
// back at exactly its own size, no jump.
const BAR_H = 44;

interface MessageSearchOverlayProps {
  visible: boolean;
  onClose: () => void;
  conversations: Conversation[];
  onOpenConversation: (conv: Conversation) => void;
  onOpenMessage: (result: MessageSearchResult) => void;
  /** Window Y of the Chats-list search bar — the slide-up start position. */
  originY?: number | null;
  /** Measured height of that bar — the overlay bar adopts it exactly. */
  originHeight?: number | null;
}

type Row =
  | { kind: 'header'; key: string; label: string }
  | { kind: 'chat'; key: string; conv: Conversation }
  | { kind: 'message'; key: string; result: MessageSearchResult };

const conversationDisplayName = (c: Conversation): string =>
  c.is_direct ? c.other_user?.name || 'User' : c.title || 'Group Chat';

/** Relative timestamp, WhatsApp-ish: time today, weekday this week, date otherwise. */
const formatResultTime = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (dayDiff === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (dayDiff === 1) return 'Yesterday';
  if (dayDiff < 7) return d.toLocaleDateString([], { weekday: 'long' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'numeric', year: '2-digit' });
};

export const MessageSearchOverlay: React.FC<MessageSearchOverlayProps> = ({
  visible,
  onClose,
  conversations,
  onOpenConversation,
  onOpenMessage,
  originY,
  originHeight,
}) => {
  const barHeight = originHeight && originHeight > 0 ? originHeight : BAR_H;
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MessageSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [errored, setErrored] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const requestIdRef = useRef(0);
  const closingRef = useRef(false);

  // 0 = at the list's search bar, 1 = docked in the header. Native-driven
  // (transform/opacity only).
  const progress = useRef(new Animated.Value(0)).current;
  // JS-driven twin for LAYOUT animation: the close circle's width grows from 0,
  // so the flex bar visibly shrinks from the right to make room for it.
  // Separate value because one Animated node can't mix native + JS drivers.
  const xSpace = useRef(new Animated.Value(0)).current;

  // Where the header input row lands (its top padding) vs where the bar was.
  const headerTop = insets.top + 8;
  const slideDistance = Math.max(0, (originY ?? headerTop + 96) - headerTop);

  // Enter: slide the bar up while the page fades in; focus immediately so the
  // keyboard rises together with the bar (WhatsApp does both at once).
  useEffect(() => {
    if (!visible) return;
    closingRef.current = false;
    setQuery('');
    setResults([]);
    setErrored(false);
    progress.setValue(0);
    xSpace.setValue(0);
    Animated.parallel([
      Animated.timing(progress, {
        toValue: 1,
        duration: ENTER_MS,
        easing: EASE_OUT,
        useNativeDriver: true,
      }),
      Animated.timing(xSpace, {
        toValue: 1,
        duration: ENTER_MS,
        easing: EASE_OUT,
        useNativeDriver: false, // animates width — layout can't run natively
      }),
    ]).start();
    const t = setTimeout(() => inputRef.current?.focus(), 40);
    return () => clearTimeout(t);
  }, [visible, progress, xSpace]);

  // Exit: reverse, faster, then hand control back to the parent.
  const handleClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    Keyboard.dismiss();
    Animated.parallel([
      Animated.timing(progress, {
        toValue: 0,
        duration: EXIT_MS,
        easing: EASE_OUT,
        useNativeDriver: true,
      }),
      Animated.timing(xSpace, {
        toValue: 0,
        duration: EXIT_MS,
        easing: EASE_OUT,
        useNativeDriver: false,
      }),
    ]).start(({ finished }) => {
      if (finished) onClose();
      closingRef.current = false;
    });
  }, [onClose, progress, xSpace]);

  // Android back button closes the search instead of the screen.
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      handleClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, handleClose]);

  // Debounced RPC search. Stale responses are dropped via requestIdRef.
  useEffect(() => {
    if (!visible) return;
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY) {
      setResults([]);
      setLoading(false);
      setErrored(false);
      return;
    }
    setLoading(true);
    const id = ++requestIdRef.current;
    const t = setTimeout(async () => {
      try {
        const hits = await messagingService.searchMessages(trimmed);
        if (requestIdRef.current !== id) return;
        setResults(hits);
        setErrored(false);
      } catch {
        if (requestIdRef.current !== id) return;
        setResults([]);
        setErrored(true);
      } finally {
        if (requestIdRef.current === id) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, visible]);

  const matchingChats = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 1) return [];
    return conversations
      .filter(c => conversationDisplayName(c).toLowerCase().includes(q))
      .slice(0, 10);
  }, [conversations, query]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    if (matchingChats.length > 0) {
      out.push({ kind: 'header', key: 'h-chats', label: 'Chats' });
      matchingChats.forEach(conv => out.push({ kind: 'chat', key: `c-${conv.id}`, conv }));
    }
    if (results.length > 0) {
      out.push({ kind: 'header', key: 'h-messages', label: 'Messages' });
      results.forEach(r => out.push({ kind: 'message', key: `m-${r.messageId}`, result: r }));
    }
    return out;
  }, [matchingChats, results]);

  const conversationById = useMemo(() => {
    const map = new Map<string, Conversation>();
    conversations.forEach(c => map.set(c.id, c));
    return map;
  }, [conversations]);

  const renderSnippet = useCallback(
    (body: string) => {
      const parts = buildSnippet(body, query);
      return (
        <Text style={styles.rowSubtitle} numberOfLines={1}>
          {parts.map((p, i) => (
            <Text key={i} style={p.match ? styles.rowSubtitleMatch : undefined}>
              {p.text}
            </Text>
          ))}
        </Text>
      );
    },
    [query]
  );

  const renderRow = useCallback(
    ({ item }: { item: Row }) => {
      if (item.kind === 'header') {
        return <Text style={styles.sectionHeader}>{item.label}</Text>;
      }
      if (item.kind === 'chat') {
        const conv = item.conv;
        return (
          <TouchableOpacity
            style={styles.row}
            activeOpacity={0.6}
            onPress={() => onOpenConversation(conv)}
          >
            <ProfileImage
              imageUrl={conv.is_direct ? conv.other_user?.profile_image_url : undefined}
              name={conversationDisplayName(conv)}
              style={styles.avatar}
            />
            <View style={styles.rowText}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {conversationDisplayName(conv)}
              </Text>
            </View>
          </TouchableOpacity>
        );
      }
      const r = item.result;
      // Prefer the loaded conversation's avatar (group hero images etc. aren't
      // in the RPC row); fall back to the sender avatar for directs.
      const conv = conversationById.get(r.conversationId);
      const avatarUrl = conv?.is_direct
        ? conv.other_user?.profile_image_url
        : r.conversationIsDirect
          ? r.senderAvatarUrl
          : undefined;
      const title = conv ? conversationDisplayName(conv) : r.conversationName || 'Chat';
      return (
        <TouchableOpacity
          style={styles.row}
          activeOpacity={0.6}
          onPress={() => onOpenMessage(r)}
        >
          <ProfileImage imageUrl={avatarUrl} name={title} style={styles.avatar} />
          <View style={styles.rowText}>
            <View style={styles.rowTitleLine}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {title}
              </Text>
              <Text style={styles.rowTime}>{formatResultTime(r.createdAt)}</Text>
            </View>
            {renderSnippet(r.body)}
          </View>
        </TouchableOpacity>
      );
    },
    [conversationById, onOpenConversation, onOpenMessage, renderSnippet]
  );

  if (!visible) return null;

  const trimmedLen = query.trim().length;
  const showEmpty =
    trimmedLen >= MIN_QUERY && !loading && !errored && rows.length === 0;
  const showIdle = trimmedLen < MIN_QUERY && rows.length === 0;

  // Shared-element illusion: the BAR never fades — it starts fully opaque at
  // the list bar's exact spot (the real bar hides underneath), so it reads as
  // the same bar moving. Only the white page background and content fade in.
  const pageOpacity = progress;
  const barTranslateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [slideDistance, 0],
  });
  // Content trails the bar slightly — fade + small rise.
  const contentOpacity = progress.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0, 0, 1],
  });
  const contentTranslateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [16, 0],
  });
  // Close circle: its width grows from 0 (JS-driven → the flex bar shrinks
  // from the right to make room), while it fades/scales in.
  const closeWidth = xSpace.interpolate({
    inputRange: [0, 1],
    outputRange: [0, barHeight],
  });
  const closeMarginLeft = xSpace.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 12],
  });
  const closeOpacity = xSpace.interpolate({
    inputRange: [0, 0.4, 1],
    outputRange: [0, 0, 1],
  });
  const closeScale = xSpace.interpolate({
    inputRange: [0, 0.4, 1],
    outputRange: [0.7, 0.7, 1],
  });

  return (
    <View style={styles.container}>
      {/* White page fades in UNDER the bar, which stays opaque throughout. */}
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFillObject, styles.pageBackground, { opacity: pageOpacity }]}
      />
      <Animated.View
        style={[
          styles.searchHeader,
          { paddingTop: headerTop, transform: [{ translateY: barTranslateY }] },
        ]}
      >
        <View style={[styles.searchInputWrap, { height: barHeight }]}>
          <Ionicons name="search" size={24} color="#7B7B7B" />
          <TextInput
            ref={inputRef}
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search"
            placeholderTextColor="#A7B8C2"
            autoCorrect={false}
            returnKeyType="search"
            testID="message-search-input"
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={18} color="#A7B8C2" />
            </TouchableOpacity>
          )}
        </View>
        <Animated.View
          style={{
            width: closeWidth,
            marginLeft: closeMarginLeft,
            opacity: closeOpacity,
            transform: [{ scale: closeScale }],
            overflow: 'hidden', // clip the fixed-size circle while its slot grows
          }}
        >
          <TouchableOpacity
            style={[
              styles.closeCircle,
              { width: barHeight, height: barHeight, borderRadius: barHeight / 2 },
            ]}
            activeOpacity={0.6}
            onPress={handleClose}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
            testID="message-search-close"
          >
            <Ionicons name="close" size={22} color="#7B7B7B" />
          </TouchableOpacity>
        </Animated.View>
      </Animated.View>

      <Animated.View
        style={[
          styles.content,
          { opacity: contentOpacity, transform: [{ translateY: contentTranslateY }] },
        ]}
      >
        {loading && rows.length === 0 ? (
          <View style={styles.centerState}>
            <ActivityIndicator color="#05BCD3" />
          </View>
        ) : errored ? (
          <View style={styles.centerState}>
            <Text style={styles.stateText}>Something went wrong. Try again.</Text>
          </View>
        ) : showEmpty ? (
          <View style={styles.centerState}>
            <Text style={styles.stateText}>No results for “{query.trim()}”</Text>
          </View>
        ) : showIdle ? (
          <View style={styles.centerState}>
            <Text style={styles.stateText}>Search your chats and messages</Text>
          </View>
        ) : (
          <FlatList
            data={rows}
            keyExtractor={item => item.key}
            renderItem={renderRow}
            keyboardShouldPersistTaps="handled"
            onScrollBeginDrag={Keyboard.dismiss}
            contentContainerStyle={styles.listContent}
          />
        )}
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
    zIndex: 100,
  },
  pageBackground: {
    backgroundColor: '#FFFFFF',
  },
  searchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  content: {
    flex: 1,
  },
  // Mirrors ConversationsScreen's searchBar exactly (padding/gap/icon/font) —
  // the transition only works as a "same bar" if the geometry is identical.
  searchInputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    height: BAR_H,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D5D7DA',
    borderRadius: 32,
    paddingHorizontal: 16,
    gap: 6,
  },
  closeCircle: {
    width: BAR_H,
    height: BAR_H,
    borderRadius: BAR_H / 2,
    borderWidth: 1,
    borderColor: '#D5D7DA',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchInput: {
    flex: 1,
    fontFamily: ff('Inter'),
    fontSize: 14,
    color: '#212121',
    padding: 0,
  },
  sectionHeader: {
    fontFamily: ff('Inter', '600'),
    ...(Platform.OS === 'web' ? { fontWeight: '600' as const } : null),
    fontSize: 13,
    color: '#7B7B7B',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  rowTitle: {
    flex: 1,
    fontFamily: ff('Inter', '600'),
    ...(Platform.OS === 'web' ? { fontWeight: '600' as const } : null),
    fontSize: 15,
    color: '#212121',
  },
  rowTime: {
    fontFamily: ff('Inter'),
    fontSize: 12,
    color: '#A7B8C2',
  },
  rowSubtitle: {
    fontFamily: ff('Inter'),
    fontSize: 13,
    color: '#7B7B7B',
  },
  rowSubtitleMatch: {
    fontFamily: ff('Inter', '700'),
    ...(Platform.OS === 'web' ? { fontWeight: '700' as const } : null),
    color: '#212121',
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  stateText: {
    fontFamily: ff('Inter'),
    fontSize: 14,
    color: '#7B7B7B',
    textAlign: 'center',
  },
  listContent: {
    paddingBottom: 24,
  },
});
