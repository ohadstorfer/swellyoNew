import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Platform,
  Image,
  ActivityIndicator,
  ImageBackground,
  Alert,
  Animated,
  Modal,
  Dimensions,
  Linking,
  Keyboard,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Reanimated, { useAnimatedStyle, FadeIn, FadeOut, LinearTransition, withTiming, Easing } from 'react-native-reanimated';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { KeyboardGestureArea, isExpoGo } from '../utils/keyboardAvoidingView';
import { TextInput as PaperTextInput } from 'react-native-paper';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { Text } from '../components/Text';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GalleryPermissionOverlay } from '../components/GalleryPermissionOverlay';
import { colors, spacing, typography, borderRadius } from '../styles/theme';
import { messagingService, Message, RealtimeSubscriptionStatus, ReplyToSnapshot } from '../services/messaging/messagingService';
import { supabaseAuthService } from '../services/auth/supabaseAuthService';
import { getImageUrl } from '../services/media/imageService';
import { Images } from '../assets/images';
import { supabase } from '../config/supabase';
import { ProfileImage } from '../components/ProfileImage';
import { analyticsService } from '../services/analytics/analyticsService';
import { chatHistoryCache } from '../services/messaging/chatHistoryCache';
import { messageOutbox } from '../services/messaging/messageOutbox';
import * as Crypto from 'expo-crypto';
import { MessageActionsMenu } from '../components/MessageActionsMenu';
import { ReplyPreviewBanner } from '../components/ReplyPreviewBanner';
import { QuotedMessagePreview } from '../components/QuotedMessagePreview';
import { MessageBubbleHighlight } from '../components/MessageBubbleHighlight';
import { useMessaging } from '../context/MessagingProvider';
import { userPresenceService } from '../services/presence/userPresenceService';
import { avatarCacheService } from '../services/media/avatarCacheService';
import { FullscreenImageViewer } from '../components/FullscreenImageViewer';
import { ImagePreviewModal } from '../components/ImagePreviewModal';
import { VideoPreviewModal } from '../components/VideoPreviewModal';
import { getImageCropPicker, isPickerCancelError } from '../utils/imageCropModule';
import { getSenderColor } from '../utils/senderColor';
import { FullscreenVideoPlayer } from '../components/FullscreenVideoPlayer';
import { ChatTextInput, ChatTextInputRef } from '../components/ChatTextInput';
import { WelcomeIntroMessage } from '../components/WelcomeIntroMessage';
import { useChatKeyboardScroll } from '../hooks/useChatKeyboardScroll';
import { BlockUserOverlay } from '../components/BlockUserOverlay';
import { ReportUserScreen } from './ReportUserScreen';

// WhatsApp-style read receipts for own messages.
// - 'pending'   → no tick (upload in flight / failed; existing UI shows "Sending…" / "Tap to retry")
// - 'delivered' → 2V gris (message in DB, not yet read by other user)
// - 'read'      → 2V azul (other user's last_read_at >= message.created_at)
type ReceiptState = 'pending' | 'delivered' | 'read';

function getReceiptState(msg: Message, otherReadAt: string | null): ReceiptState {
  if (msg.upload_state === 'uploading' || msg.upload_state === 'failed') return 'pending';
  if (!otherReadAt) return 'delivered';
  return new Date(msg.created_at).getTime() <= new Date(otherReadAt).getTime()
    ? 'read'
    : 'delivered';
}

function ReadReceipt({ state, enabled = true }: { state: ReceiptState; onDark?: boolean; enabled?: boolean }) {
  // Group chats pass enabled={isDirect} so the tick is hidden — read state across
  // multiple recipients isn't a single boolean.
  if (!enabled) return null;
  // Gray when delivered (or pending — UI shows "Sending…" alongside it anyway),
  // Swellyo teal when the other user has read up to this message.
  const color = state === 'read' ? '#05BCD3' : '#C2C2C2';
  return (
    <Reanimated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(140)}>
      <Image
        source={Images.doubleTick}
        style={{ width: 16, height: 16, marginLeft: 4, tintColor: color }}
        resizeMode="contain"
      />
    </Reanimated.View>
  );
}

// Drives the bubble slide-up (own + received) AND the existing messages'
// "push-up" layout animation. Set to 2000 to put everything in slow-mo for
// visual debugging (see memory: chat_animation_slowmo_knobs.md).
const SEND_SLIDE_DURATION_MS = 280;

// Send-in animation for OWN messages (current user just hit send). The new
// bubble starts shifted DOWN so its TOP edge is tucked just under the
// composer's top, then translates back to 0 — sliding up from behind the bar.
//
// Per-bubble offset: in the inverted list every bubble's natural bottom sits
// at composer.top, so natural_top = composer.top − targetHeight. To make
// actual_top = composer.top + SEND_SLIDE_TOP_PEEK_DP we need:
//   translateY = targetHeight + SEND_SLIDE_TOP_PEEK_DP
// composer.top cancels out — short and tall bubbles both start with their
// TOP edge at the same visual position relative to the bar, regardless of
// whether the composer is one line or stretched.
const SEND_SLIDE_TOP_PEEK_DP = 8;

const messageSlideUpFromComposer = (values: { targetHeight: number }) => {
  'worklet';
  return {
    initialValues: {
      transform: [{ translateY: values.targetHeight + SEND_SLIDE_TOP_PEEK_DP }],
    },
    animations: {
      transform: [
        {
          translateY: withTiming(0, {
            duration: SEND_SLIDE_DURATION_MS,
            easing: Easing.inOut(Easing.ease),
          }),
        },
      ],
    },
  };
};

// Send-in animation for RECEIVED messages (from another user). The new bubble
// starts with its TOP edge at the typing indicator's TOP — so the swap from
// "typing dots" to "actual message" feels seamless, no vertical jump. We use
// a fixed reference height (TYPING_INDICATOR_HEIGHT_DP) so the start position
// is the same whether or not the typing indicator was visible at the moment
// the message arrives.
//
// Same per-bubble math: natural_top = composer.top − targetHeight. To make
// actual_top = composer.top − TYPING_INDICATOR_HEIGHT_DP:
//   translateY = targetHeight − TYPING_INDICATOR_HEIGHT_DP
//
// CAPPED at 0 (Math.max): for very short bubbles where targetHeight <
// typing-indicator height, the raw formula goes negative — that would mean
// starting ABOVE the natural position and sliding DOWN, which reads as wrong
// ("bubble drops down" instead of rising up). Capping at 0 means short
// bubbles just appear at their natural spot (which is already very close to
// where the typing indicator's top sat).
//
// Constant matches the typing bubble's actual height: bubble paddingV (16) +
// typingContainer paddingV (16) + typingDot height (8) = 40.
const TYPING_INDICATOR_HEIGHT_DP = 40;
// Extra drop below typing's top — bubble starts ~one chat line lower so the
// reveal feels like the bubble is rising up from a hair more under the bar.
const RECEIVED_SLIDE_EXTRA_DROP_DP = 44;

const messageSlideUpFromTypingHeight = (values: { targetHeight: number }) => {
  'worklet';
  const initial = Math.max(
    values.targetHeight - TYPING_INDICATOR_HEIGHT_DP + RECEIVED_SLIDE_EXTRA_DROP_DP,
    0
  );
  return {
    initialValues: {
      transform: [{ translateY: initial }],
    },
    animations: {
      transform: [
        {
          translateY: withTiming(0, {
            duration: SEND_SLIDE_DURATION_MS,
            easing: Easing.inOut(Easing.ease),
          }),
        },
      ],
    },
  };
};

// Detects three URL shapes in message text:
//   1. https://example.com[/path] — explicit protocol
//   2. www.example.com[/path]      — www prefix without protocol
//   3. example.com[/path]          — bare domain (must start with a letter,
//      end in a 2+ alpha TLD, and stand on a word boundary so "1.2.3" and
//      "file.exe" within sentences don't match too aggressively)
const URL_REGEX = /(https?:\/\/[^\s<>]+|www\.[^\s<>]+|\b[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b(?:\/[^\s]*)?)/gi;

const LINK_COLOR = '#1976D2'; // Material Blue 700 — readable on white + light bubbles.

// Per-message text alignment: English (and other LTR scripts) sticks to the
// left of the bubble; Hebrew and Arabic stick to the right. Uses the first
// strong directional character (Unicode bidi convention) so a sentence that
// starts in one language but mixes the other still aligns by its dominant
// direction. Default is 'left' for empty/symbol-only bodies.
function getBodyTextAlign(body: string | null | undefined): 'left' | 'right' {
  if (!body) return 'left';
  for (let i = 0; i < body.length; i++) {
    const code = body.charCodeAt(i);
    // Strong RTL: Hebrew + Arabic ranges (incl. supplements/extensions/forms).
    if (
      (code >= 0x0590 && code <= 0x05FF) ||
      (code >= 0x0600 && code <= 0x06FF) ||
      (code >= 0x0750 && code <= 0x077F) ||
      (code >= 0x08A0 && code <= 0x08FF) ||
      (code >= 0xFB50 && code <= 0xFDFF) ||
      (code >= 0xFE70 && code <= 0xFEFF)
    ) {
      return 'right';
    }
    // Strong LTR: Basic Latin letters + Latin-1 letters.
    if (
      (code >= 0x0041 && code <= 0x005A) ||
      (code >= 0x0061 && code <= 0x007A) ||
      (code >= 0x00C0 && code <= 0x00FF)
    ) {
      return 'left';
    }
  }
  return 'left';
}

// Splits a message body into plain-text and tappable-URL segments.
// Tap → opens the URL in the device's default handler. Returns React nodes
// that can be dropped directly inside a parent <Text>.
function renderMessageBodyWithLinks(body: string): React.ReactNode {
  if (!body) return body;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  // RegExp with /g keeps state across exec calls; reset to be safe.
  URL_REGEX.lastIndex = 0;
  while ((match = URL_REGEX.exec(body)) !== null) {
    if (match.index > lastIndex) {
      parts.push(body.slice(lastIndex, match.index));
    }
    const raw = match[0];
    // Strip a single trailing punctuation char (.,;:!?) that's almost never
    // part of the URL — a sentence like "check this out https://x.com." should
    // open https://x.com, not include the period.
    const trailingPunct = /[.,;:!?]+$/.exec(raw);
    const url = trailingPunct ? raw.slice(0, -trailingPunct[0].length) : raw;
    const tail = trailingPunct ? trailingPunct[0] : '';
    // Bare domain or www prefix → prepend https:// when actually opening.
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    parts.push(
      <Text
        key={`lnk-${match.index}-${url.length}`}
        style={{ color: LINK_COLOR, textDecorationLine: 'underline' }}
        onPress={() => {
          Linking.openURL(href).catch((err) => {
            console.warn('[DirectMessageScreen] failed to open URL:', href, err);
          });
        }}
      >
        {url}
      </Text>
    );
    if (tail) parts.push(tail);
    lastIndex = URL_REGEX.lastIndex;
  }
  if (lastIndex < body.length) {
    parts.push(body.slice(lastIndex));
  }
  return parts.length > 0 ? parts : body;
}

interface DirectGroupChatProps {
  conversationId?: string; // Optional: undefined for pending conversations (will be created on first message)
  otherUserId: string; // Required: the user ID we're messaging
  otherUserName: string;
  otherUserAvatar: string | null;
  isDirect?: boolean; // true for direct messages (2 users), false for group chats
  fromTripPlanning?: boolean; // true if conversation was created from trip planning recommendations
  onBack?: () => void;
  onConversationCreated?: (conversationId: string) => void; // Callback when conversation is created
  onViewProfile?: (userId: string) => void; // Callback when avatar or name is clicked
  // Group-chat specific: when this conversation is linked to a surftrip, tapping the
  // header avatar/name opens that trip's detail screen via this callback.
  tripId?: string;
  onOpenTripDetail?: (tripId: string) => void;
}

export const DirectGroupChat: React.FC<DirectGroupChatProps> = ({
  conversationId,
  otherUserId,
  otherUserName,
  otherUserAvatar,
  isDirect = true, // Default to direct message (2 users)
  fromTripPlanning = false, // Default to false (not from trip planning)
  onBack,
  onConversationCreated,
  onViewProfile,
  tripId,
  onOpenTripDetail,
}) => {
  // Get markAsRead and setCurrentConversationId from MessagingProvider
  const { markAsRead, setCurrentConversationId: setMessagingCurrentConversationId, dispatch: messagingDispatch } = useMessaging();
  
  const [showBlockOverlay, setShowBlockOverlay] = useState(false);
  const [showDmMenu, setShowDmMenu] = useState(false);
  const [showReportUser, setShowReportUser] = useState(false);
  // Composer (input bar) height — measured via onLayout. Passed to
  // KeyboardGestureArea's `offset` prop so the interactive-dismiss zone
  // extends UP to cover the composer, making the gesture feel 1:1.
  const [composerHeight, setComposerHeight] = useState(0);
  const [currentConversationId, setCurrentConversationId] = useState<string | undefined>(conversationId);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState<string>('');
  const [isFetchingMessages, setIsFetchingMessages] = useState(true); // Start as true to prevent WelcomeIntroMessage flash before first fetch
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const hasMoreMessagesRef = useRef(false);
  const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState(false);
  const oldestMessageIdRef = useRef<string | null>(null);
  const isLoadingOlderRef = useRef<boolean>(false); // Ref-based lock to prevent race conditions
  // Seed from the synchronous auth cache so own messages render on the right
  // from the very first paint — otherwise messages briefly appear on the left
  // and drift right once the async session fetch resolves.
  const [currentUserId, setCurrentUserId] = useState<string | null>(
    () => supabaseAuthService.getCachedUserId()
  );
  const [otherUserAdvRole, setOtherUserAdvRole] = useState<'adv_giver' | 'adv_seeker' | null>(null);
  const [otherUserIsOnline, setOtherUserIsOnline] = useState<boolean | null>(null);
  const [hasTrackedFirstMessage, setHasTrackedFirstMessage] = useState(false);
  const [hasTrackedFirstReply, setHasTrackedFirstReply] = useState(false);
  const [firstMessageSentTime, setFirstMessageSentTime] = useState<number | null>(null);
  const [isTyping, setIsTyping] = useState(false); // Typing indicator state
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [realtimeHealthy, setRealtimeHealthy] = useState(true); // Track realtime subscription health
  const [editingText, setEditingText] = useState('');
  const [menuVisible, setMenuVisible] = useState(false);
  const [showPermissionOverlay, setShowPermissionOverlay] = useState(false);
  const pendingPickerRef = useRef<(() => void) | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [resolvingReplyJumpId, setResolvingReplyJumpId] = useState<string | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);
  const [pendingDeleteMessageId, setPendingDeleteMessageId] = useState<string | null>(null);
  const [fullscreenImageUrl, setFullscreenImageUrl] = useState<string | null>(null);
  const [fullscreenThumbnailUrl, setFullscreenThumbnailUrl] = useState<string | null>(null);
  const [fullscreenVideoUrl, setFullscreenVideoUrl] = useState<string | null>(null);
  const [imagePreviewVisible, setImagePreviewVisible] = useState(false);
  const [selectedImageUri, setSelectedImageUri] = useState<string | null>(null);
  const selectedImageUriForUploadRef = useRef<string | null>(null);
  // Source dimensions of the picked image — captured at pick time so the
  // on-demand cropper (Edit button) can pass them to openCropper, avoiding
  // the lib's 200px default-output trap.
  const selectedImageDimensionsRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isPickerOpenRef = useRef(false);
  const pickerFallbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const [selectedVideoUri, setSelectedVideoUri] = useState<string | null>(null);
  const selectedVideoMetadataRef = useRef<{ width?: number; height?: number; duration?: number; fileSize?: number; mimeType?: string } | null>(null);
  const [videoPreviewVisible, setVideoPreviewVisible] = useState(false);
  const [isProcessingVideo, setIsProcessingVideo] = useState(false);
  const insets = useSafeAreaInsets();
  // Keyboard-aware padding for the chat area. Bypasses the measureLayout-based
  // KAV which breaks when nested inside react-native-screen-transitions' transformed
  // ContentLayer. height is negative when keyboard is open on iOS → use abs for
  // padding (defensive: ignore brief sign flips during interactive dismiss).
  const { height: kbHeight, progress: kbProgress } = useReanimatedKeyboardAnimation();
  const animatedKeyboardPadding = useAnimatedStyle(() => ({
    paddingBottom: Math.round(Math.abs(kbHeight.value)),
  }));
  // Composer's own bottom padding: insets.bottom at rest (home indicator safe area),
  // shrinks to 0 as keyboard opens (so the input sits flush against keyboard top).
  // Clamp progress to [0,1] — the lib has occasionally reported a hair past either
  // end during fast focus/dismiss, which leaked a stray pixel of paddingBottom.
  const composerRestPadding = Math.max(insets.bottom, 8);
  const animatedComposerPadding = useAnimatedStyle(() => {
    const p = Math.min(1, Math.max(0, kbProgress.value));
    return { paddingBottom: Math.round(composerRestPadding * (1 - p)) };
  });
  // Send-button color themed by the other user's advice role. Used by the
  // chat composer AND the image/video preview modals so the send button
  // matches across all three surfaces.
  const composerPrimaryColor =
    otherUserAdvRole === 'adv_giver'
      ? '#DBCDBC'
      : otherUserAdvRole === 'adv_seeker'
        ? '#05BCD3'
        : '#B72DF2';
  const flatListRef = useRef<FlatList<Message>>(null);
  const { handleScroll: handleKeyboardScroll, handleLayout, scrollToBottom } = useChatKeyboardScroll(flatListRef, { inverted: true });

  // Track which message IDs have already been rendered, so the slide-up
  // entering animation only fires on genuinely new messages — not on old
  // ones that re-mount when FlatList virtualization scrolls them back on
  // screen, and not on the initial batch when the chat first loads.
  const seenMessageIdsRef = useRef<Set<string>>(new Set());
  const messageAnimationsInitializedRef = useRef(false);

  useEffect(() => {
    if (!messageAnimationsInitializedRef.current && messages.length > 0) {
      seenMessageIdsRef.current = new Set(messages.map((m) => m.id));
      messageAnimationsInitializedRef.current = true;
    }
  }, [messages.length]);

  const chatInputRef = useRef<ChatTextInputRef>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSentAtRef = useRef<number>(0);
  const currentUserIdRef = useRef<string | null>(null);
  const currentConversationIdRef = useRef<string | undefined>(undefined);
  const typingFailsafeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasTriedReconnectRef = useRef(false);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeSubscriptionStatus | null>(null);
  // Other user's last_read_at from conversation_members. Used to derive read receipts
  // (2V gris = delivered, 2V azul = read) for our own messages.
  const [otherUserLastReadAt, setOtherUserLastReadAt] = useState<string | null>(null);
  // Reconnect catch-up: detect SUBSCRIBED after a prior disconnect and pull missed messages.
  const wasDisconnectedRef = useRef(false);
  const lastRealtimeEventAtRef = useRef<number>(Date.now());
  const catchUpInFlightRef = useRef(false);

  // Keep refs in sync so subscription callbacks always see latest values
  useEffect(() => {
    currentUserIdRef.current = currentUserId;
  }, [currentUserId]);
  useEffect(() => {
    currentConversationIdRef.current = currentConversationId;
  }, [currentConversationId]);
  useEffect(() => {
    hasMoreMessagesRef.current = hasMoreMessages;
  }, [hasMoreMessages]);

  // Clean up file input and fallback timeout if user navigates away while picker is open (web only)
  useEffect(() => {
    return () => {
      if (pickerFallbackTimeoutRef.current) {
        clearTimeout(pickerFallbackTimeoutRef.current);
        pickerFallbackTimeoutRef.current = null;
      }
      if (typeof document !== 'undefined' && fileInputRef.current?.parentNode) {
        fileInputRef.current.parentNode.removeChild(fileInputRef.current);
        fileInputRef.current = null;
      }
      isPickerOpenRef.current = false;
    };
  }, []);

  useEffect(() => {
    // Get current user ID - CRITICAL: Get from session first (instant, no database query)
    const getCurrentUser = async () => {
      try {
        // First, try to get user ID from session immediately (no database query)
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.id) {
          setCurrentUserId(session.user.id);
          return; // Success - no need for slow database query
        }
        const user = await supabaseAuthService.getCurrentUser();
        if (user) {
          setCurrentUserId(user.id);
        }
      } catch (error) {
        console.error('Error getting current user:', error);
      }
    };
    getCurrentUser();
  }, []);

  useEffect(() => {
    if (currentConversationId) {
      if (reconnectAttempt === 0) {
        hasTriedReconnectRef.current = false;
      }
      loadMessages();

      // Set current conversation in MessagingProvider
      setMessagingCurrentConversationId(currentConversationId);
      
      // Mark conversation as read (can handle currentUserId being null initially)
      // Will be called again when currentUserId becomes available
      if (currentUserId) {
        markAsRead(currentConversationId).catch(err => {
          console.error('Error marking as read:', err);
        });
      }

      // Fetch the other user's last_read_at to seed receipt state before the first Realtime UPDATE.
      if (otherUserId) {
        messagingService
          .getMemberLastReadAt(currentConversationId, otherUserId)
          .then((ts) => setOtherUserLastReadAt(ts))
          .catch(() => { /* non-fatal; defaults to null → delivered */ });
      }

      // Reset reconnect catch-up refs for this subscription instance.
      wasDisconnectedRef.current = false;
      lastRealtimeEventAtRef.current = Date.now();
      catchUpInFlightRef.current = false;

      // Fetch messages that arrived while the WebSocket was down. Supabase Realtime does not
      // replay missed events on reconnect, so cover the gap with a query against Postgres.
      const runReconnectCatchUp = async () => {
        const convId = currentConversationIdRef.current;
        if (!convId) return;
        if (catchUpInFlightRef.current) return;
        if (Date.now() - lastRealtimeEventAtRef.current < 10_000) return;

        catchUpInFlightRef.current = true;
        try {
          const since = lastRealtimeEventAtRef.current - 2000;
          const missed = await messagingService.getMessagesUpdatedSince(convId, since, 50);
          if (missed.length === 0) return;
          console.log(`[DirectMessageScreen] catch-up found ${missed.length} missed messages (reconnect path)`);
          if (missed.length === 50) {
            console.warn('[DirectMessageScreen] catch-up hit 50-message limit — older gap may require scroll-up pagination');
          }
          setMessages((prev) => {
            const merged = chatHistoryCache.mergeMessages(prev, missed);
            chatHistoryCache.saveMessages(convId, merged).catch(() => {});
            return merged;
          });
          lastRealtimeEventAtRef.current = Date.now();
        } catch (err) {
          console.error('[DirectMessageScreen] reconnect catch-up failed:', err);
        } finally {
          catchUpInFlightRef.current = false;
        }
      };

      // Subscribe to messages (callbacks handle currentUserId being null)
      // Note: We need to track subscription health, but messagingService doesn't expose it directly
      // We'll infer health from message activity (messages received recently = healthy)
      const unsubscribe = messagingService.subscribeToMessages(
        currentConversationId,
        {
          onReadReceiptUpdate: (userId, lastReadAt) => {
            if (userId === otherUserId) {
              setOtherUserLastReadAt(lastReadAt);
            }
          },
          onSubscriptionStatus: (status) => {
            setRealtimeStatus(status);
            if (status === 'SUBSCRIBED') {
              setRealtimeHealthy(true);
              hasTriedReconnectRef.current = false;
              if (wasDisconnectedRef.current) {
                wasDisconnectedRef.current = false;
                runReconnectCatchUp();
              }
            } else if (status === 'CHANNEL_ERROR') {
              wasDisconnectedRef.current = true;
              if (!hasTriedReconnectRef.current) {
                hasTriedReconnectRef.current = true;
                setReconnectAttempt((a) => a + 1);
              } else {
                setRealtimeHealthy(false);
              }
            } else if (status === 'TIMED_OUT' || status === 'CLOSED') {
              wasDisconnectedRef.current = true;
            }
          },
          onNewMessage: (newMessage) => {
            setRealtimeHealthy(true);
            lastRealtimeEventAtRef.current = Date.now();
            const convId = currentConversationIdRef.current;
            const me = currentUserIdRef.current;
            if (!hasTrackedFirstReply && me && newMessage.sender_id !== me) {
              const timeToReplyMinutes = firstMessageSentTime
                ? (Date.now() - firstMessageSentTime) / (1000 * 60)
                : undefined;
              analyticsService.trackReplyReceived(timeToReplyMinutes, convId ?? '');
              setHasTrackedFirstReply(true);
            }
            // Clear the typing indicator immediately when a message arrives
            // from the other user. Otherwise the indicator can briefly remain
            // visible while the new bubble mounts, which throws off the
            // entering animation's natural-position calculation (bubble's
            // anchor is shifted up by ~40dp, so the slide can read as
            // sliding DOWN instead of UP).
            if (me && newMessage.sender_id !== me) {
              setIsTyping(false);
            }
            setMessages((prev) => {
              // Outbox optimistic row lookup: the local row's id is still the
              // clientId (it becomes the server uuid only after our own send
              // resolves). If the server row arrives via Realtime first, swap.
              if (newMessage.client_id) {
                const optimisticIdx = prev.findIndex(m =>
                  m.id !== newMessage.id && (
                    m.id === newMessage.client_id ||
                    m.client_id === newMessage.client_id
                  )
                );
                if (optimisticIdx !== -1) {
                  const updated = prev.map((m, i) => i === optimisticIdx ? newMessage : m);
                  if (convId) {
                    chatHistoryCache.saveMessages(convId, updated).catch(err => {
                      console.error('Error updating cache:', err);
                    });
                  }
                  return updated;
                }
              }

              const existing = prev.find(msg => msg.id === newMessage.id);
              if (existing) {
                // Keep any local-only upload fields already on the message (we may have injected
                // it locally when the sender pressed Send before Realtime delivered it).
                if (existing.upload_state || existing._localPreviewUri) {
                  return prev.map(m => m.id === newMessage.id
                    ? {
                        ...newMessage,
                        upload_state: existing.upload_state,
                        upload_progress: existing.upload_progress,
                        upload_error: existing.upload_error,
                        _localPreviewUri: existing._localPreviewUri,
                      }
                    : m);
                }
                return prev;
              }
              const updated = [...prev, newMessage];
              if (convId) {
                chatHistoryCache.saveMessages(convId, updated).catch(err => {
                  console.error('Error updating cache:', err);
                });
              }
              return updated;
            });
            if (me && convId) {
              markAsRead(convId).catch(err => {
                console.error('Error marking message as read:', err);
              });
            }
            // Piggyback to the provider: the filtered channel is reliable, the unfiltered
            // conversations_list channel often drops INSERT events due to the RLS quirk
            // at messagingService.ts:1741-1779. Mirroring the event here keeps the list
            // preview in sync without depending on that channel. The reducer dedupes.
            if (convId) {
              messagingDispatch({ type: 'NEW_MESSAGE', payload: { conversationId: convId, message: newMessage } });
            }
            scrollToBottom();
          },
          onMessageUpdated: (updatedMessage) => {
            lastRealtimeEventAtRef.current = Date.now();
            // Handle message edit
            // Check if message was being edited locally (concurrent edit from another client)
            if (editingMessageId === updatedMessage.id) {
              // Another client edited - accept server version (last write wins)
              setEditingMessageId(null);
              setEditingText('');
            }
            
            setMessages((prev) => {
              const existingIndex = prev.findIndex(msg => msg.id === updatedMessage.id);
              let updated: typeof prev;

              if (existingIndex !== -1) {
                // Update existing message — preserve client-only upload fields the sender set locally
                const existing = prev[existingIndex];
                const merged: Message = {
                  ...updatedMessage,
                  upload_state: existing.upload_state,
                  upload_progress: existing.upload_progress,
                  upload_error: existing.upload_error,
                  _localPreviewUri: existing._localPreviewUri,
                };
                updated = prev.map(msg =>
                  msg.id === updatedMessage.id ? merged : msg
                );
              } else {
                const convId = currentConversationIdRef.current;
                if (convId && updatedMessage.conversation_id === convId) {
                  updated = [...prev, updatedMessage].sort((a, b) => {
                    const timeDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
                    if (timeDiff !== 0) return timeDiff;
                    return a.id.localeCompare(b.id);
                  });
                } else {
                  updated = prev;
                }
              }
              const convId = currentConversationIdRef.current;
              if (convId) {
                chatHistoryCache.updateMessage(convId, updatedMessage.id, updatedMessage).catch(err => {
                  console.error('Error updating message in cache:', err);
                });
              }
              return updated;
            });
            // Piggyback to the provider so the list reflects edits and soft-deletes
            // instantly. See the onNewMessage piggyback above for rationale.
            const convIdForDispatch = currentConversationIdRef.current;
            if (convIdForDispatch) {
              messagingDispatch({
                type: 'MESSAGE_UPDATED',
                payload: { conversationId: convIdForDispatch, message: updatedMessage },
              });
            }
          },
          onMessageDeleted: (messageId) => {
            lastRealtimeEventAtRef.current = Date.now();
            const convId = currentConversationIdRef.current;
            console.log('[DirectMessageScreen] onMessageDeleted callback triggered', {
              messageId,
              conversationId: convId,
              editingMessageId,
            });
            
            // Handle message deletion (soft delete - keep message but mark as deleted)
            // If message was being edited, cancel edit mode
            if (editingMessageId === messageId) {
              console.log('[DirectMessageScreen] Cancelling edit mode for deleted message');
              setEditingMessageId(null);
              setEditingText('');
            }
            
            setMessages((prev) => {
              const messageExists = prev.find(msg => msg.id === messageId);
              if (!messageExists) {
                console.warn('[DirectMessageScreen] Message not found in state for deletion', { messageId });
                return prev;
              }
              
              console.log('[DirectMessageScreen] Marking message as deleted in state', {
                messageId,
                previousDeleted: messageExists.deleted,
              });
              
              const deletedMessage = { ...messageExists, deleted: true, body: undefined };
              const updated = prev.map(msg =>
                msg.id === messageId ? deletedMessage : msg
              );
              if (convId) {
                chatHistoryCache.updateMessage(convId, messageId, deletedMessage).catch(err => {
                  console.error('[DirectMessageScreen] Error updating deleted message in cache:', err);
                });
              }
              return updated;
            });
            // Piggyback to the provider so the list preview clears the deleted
            // message immediately. See onNewMessage piggyback above for rationale.
            if (convId) {
              messagingDispatch({
                type: 'MESSAGE_DELETED',
                payload: { conversationId: convId, messageId },
              });
            }
          },
          onTyping: (userId, isTyping) => {
            const me = currentUserIdRef.current;
            if (me && userId !== me) {
              if (typingFailsafeRef.current) {
                clearTimeout(typingFailsafeRef.current);
                typingFailsafeRef.current = null;
              }
              if (isTyping) {
                setIsTyping(true);
                typingFailsafeRef.current = setTimeout(() => {
                  typingFailsafeRef.current = null;
                  setIsTyping(false);
                }, 4000);
              } else {
                setIsTyping(false);
              }
            }
          },
        }
      );

      return () => {
        unsubscribe();
        setIsTyping(false);
        if (typingFailsafeRef.current) {
          clearTimeout(typingFailsafeRef.current);
          typingFailsafeRef.current = null;
        }
        if (typingDebounceRef.current) {
          clearTimeout(typingDebounceRef.current);
          typingDebounceRef.current = null;
        }
        if (typingTimeoutRef.current) {
          clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = null;
        }
        messagingService.stopTyping(currentConversationId).catch(() => {});
      };
    } else {
      // No conversation yet - clear messages and stop loading
      setMessages([]);
      setIsFetchingMessages(false);
      setIsTyping(false);
      // Clear current conversation in MessagingProvider
      setMessagingCurrentConversationId(null);
    }
    
    // Cleanup: Clear current conversation when component unmounts or conversation changes
    return () => {
      if (currentConversationId) {
        setMessagingCurrentConversationId(null);
      }
    };
  }, [currentConversationId, markAsRead, setMessagingCurrentConversationId, reconnectAttempt, otherUserId]);

  // Separate useEffect to mark as read when currentUserId becomes available
  useEffect(() => {
    if (currentConversationId && currentUserId) {
      markAsRead(currentConversationId).catch(err => {
        console.error('Error marking as read:', err);
      });
    }
  }, [currentConversationId, currentUserId, markAsRead]);

  // Reconcile UI with outbox on conversation open. Covers the zombie case:
  // an optimistic row with upload_state='failed' persisted in cache, but the
  // outbox entry is gone (auto-flush succeeded while the user was elsewhere).
  // - Server row exists with matching client_id → drop the optimistic.
  // - No server row → clear upload_state so the user isn't told it failed.
  // Also: if the outbox has pending entries for this conversation, kick a
  // flushAll so we don't wait for AppState/NetInfo to drain them (covers
  // Expo Go where NetInfo events may not fire on wifi toggle).
  useEffect(() => {
    const convId = currentConversationId;
    if (!convId) return;
    let cancelled = false;
    // Small delay so the initial loadMessages (cache + catch-up) settles first.
    const t = setTimeout(async () => {
      try {
        const pending = await messageOutbox.getByConversation(convId);
        if (cancelled) return;
        const pendingIds = new Set(pending.map(e => e.clientId));

        // Self-heal: if anything is pending for this conversation, try to
        // send it right now. Idempotency on the server (client_id unique
        // constraint) makes repeated attempts safe.
        if (pending.length > 0) {
          console.log(`[DirectMessageScreen] ${pending.length} pending outbox entries for convo, flushing`);
          messageOutbox
            .flushAll(async (entry) => {
              await messagingService.sendMessage(
                entry.conversationId,
                entry.body,
                [],
                entry.type,
                entry.clientId,
                entry.replyTo ?? undefined
              );
            })
            .catch((err) => console.warn('[DirectMessageScreen] outbox flush failed:', err));
        }
        setMessages(prev => {
          const serverIdsByClientId = new Map<string, string>();
          prev.forEach(m => {
            if (m.client_id && m.id !== m.client_id) {
              serverIdsByClientId.set(m.client_id, m.id);
            }
          });
          let changed = false;
          const next = prev.flatMap(m => {
            if (m.upload_state !== 'failed' || !m.client_id) return [m];
            if (pendingIds.has(m.client_id)) return [m];
            if (serverIdsByClientId.has(m.client_id)) {
              changed = true;
              return [];
            }
            changed = true;
            return [{ ...m, upload_state: undefined, upload_error: undefined }];
          });
          if (!changed) return prev;
          chatHistoryCache.saveMessages(convId, next).catch(() => {});
          return next;
        });
      } catch (err) {
        console.warn('[DirectMessageScreen] outbox reconcile failed:', err);
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [currentConversationId]);

  // Subscribe to other user's online status
  useEffect(() => {
    if (!otherUserId) {
      setOtherUserIsOnline(null);
      return;
    }

    // Subscribe to user status
    const unsubscribe = userPresenceService.subscribeToUserStatus(
      otherUserId,
      (isOnline) => {
        console.log(`[DirectMessageScreen] User ${otherUserId} status updated: ${isOnline ? 'online' : 'offline'}`);
        setOtherUserIsOnline(isOnline);
      }
    );

    // Cleanup on unmount or when otherUserId changes
    return () => {
      unsubscribe();
    };
  }, [otherUserId]);

  // Prefetch avatar when component mounts or avatar URL changes
  useEffect(() => {
    if (otherUserAvatar) {
      avatarCacheService.prefetchAvatar(otherUserAvatar).catch(err => {
        console.error('[DirectMessageScreen] Error prefetching avatar:', err);
      });
    }
  }, [otherUserAvatar]);

  const loadOtherUserAdvRole = async (): Promise<'adv_giver' | 'adv_seeker' | null> => {
    if (!currentConversationId || !otherUserId) return null;
    
    try {
      const { data, error } = await supabase
        .from('conversation_members')
        .select('adv_role')
        .eq('conversation_id', currentConversationId)
        .eq('user_id', otherUserId)
        .single();
      
      if (error) {
        console.error('Error fetching other user adv_role:', error);
        return null;
      }
      
      if (data && (data.adv_role === 'adv_giver' || data.adv_role === 'adv_seeker')) {
        const advRole = data.adv_role as 'adv_giver' | 'adv_seeker';
        setOtherUserAdvRole(advRole);
        return advRole;
      }
      
      return null;
    } catch (error) {
      console.error('Error loading other user adv_role:', error);
      return null;
    }
  };

  const loadMessages = async () => {
    console.log('[DirectMessageScreen] 🔄 loadMessages called for conversation:', currentConversationId);
    
    if (!currentConversationId) {
      console.log('[DirectMessageScreen] ⚠️ No conversation ID, clearing messages');
      setMessages([]);
      setIsFetchingMessages(false);
      // Reset pagination state
      oldestMessageIdRef.current = null;
      setHasMoreMessages(false);
      isLoadingOlderRef.current = false;
      return;
    }
    
    // Reset pagination state when loading new conversation
    oldestMessageIdRef.current = null;
    setHasMoreMessages(false);
    isLoadingOlderRef.current = false; // Cancel any in-flight pagination requests
    
    const loadStartTime = Date.now();
    
    // CRITICAL: Check memory cache FIRST (synchronous, instant)
    const memoryCheckStart = Date.now();
    const cachedMessages = chatHistoryCache.loadCachedMessages(currentConversationId);
    const memoryCheckTime = Date.now() - memoryCheckStart;
    
    console.log('[DirectMessageScreen] 🔍 Memory cache check:', {
      conversationId: currentConversationId,
      checkTime: `${memoryCheckTime}ms`,
      hit: !!cachedMessages,
      messageCount: cachedMessages?.length || 0,
      firstMessageId: cachedMessages?.[0]?.id,
      lastMessageId: cachedMessages?.[cachedMessages.length - 1]?.id
    });
    
    if (cachedMessages && cachedMessages.length > 0) {
      const totalTime = Date.now() - loadStartTime;
      console.log(`[DirectMessageScreen] ✅ MEMORY CACHE HIT - Showing ${cachedMessages.length} messages instantly (${totalTime}ms total)`);
      
      // CRITICAL: Load adv_role BEFORE setting messages to ensure correct color on first render
      // Load in parallel but await it before rendering messages
      const advRolePromise = loadOtherUserAdvRole();
      
      // Set pagination cursor from cache (will be corrected by background sync)
      if (cachedMessages.length > 0) {
        oldestMessageIdRef.current = cachedMessages[0].id;
        // Don't enable pagination yet — wait for background sync to set the correct
        // cursor and hasMore from the server, avoiding race conditions with stale cache data
      }
      
      // Wait for adv_role to load, then set messages
      await advRolePromise;
      
      // Log image messages for debugging
      const imageMessages = cachedMessages.filter(msg => msg.type === 'image' || msg.image_metadata);
      if (imageMessages.length > 0) {
        console.log('[DirectMessageScreen] 🖼️ IMAGE MESSAGES IN CACHE:', {
          totalMessages: cachedMessages.length,
          imageMessageCount: imageMessages.length,
          imageMessages: imageMessages.map(msg => ({
            id: msg.id,
            type: msg.type,
            hasType: msg.type !== undefined,
            hasImageMetadata: !!msg.image_metadata,
            imageMetadata: msg.image_metadata ? {
              hasImageUrl: !!msg.image_metadata.image_url,
              hasThumbnailUrl: !!msg.image_metadata.thumbnail_url,
              imageUrl: msg.image_metadata.image_url,
              thumbnailUrl: msg.image_metadata.thumbnail_url,
            } : null,
            uploadState: msg.upload_state,
          }))
        });
      } else {
        console.log('[DirectMessageScreen] 📝 No image messages in cache (total messages:', cachedMessages.length, ')');
      }
      
      // Memory cache hit - show instantly (no async delay, no loading state)
      // But only after adv_role is loaded to ensure correct colors
      const deletedCount = cachedMessages.filter(m => m.deleted).length;
      console.log('[DirectMessageScreen] Loading messages from memory cache:', {
        totalMessages: cachedMessages.length,
        deletedMessages: deletedCount,
        deletedMessageIds: cachedMessages.filter(m => m.deleted).map(m => m.id),
      });
      setMessages(cachedMessages);
      setIsFetchingMessages(false);

      setHasMoreMessages(true);

      // Lightweight catch-up: fetch messages newer than the newest cached message
      // This covers messages that arrived while the app was closed (realtime wasn't connected)
      // Typically returns 0 rows — cheap call
      const newestCachedTimestamp = cachedMessages[cachedMessages.length - 1]?.created_at;
      if (newestCachedTimestamp) {
        messagingService.getMessagesUpdatedSince(currentConversationId, new Date(newestCachedTimestamp).getTime(), 50)
          .then((newMessages) => {
            if (newMessages.length > 0) {
              console.log(`[DirectMessageScreen] 📬 Catch-up found ${newMessages.length} missed messages`);
              setMessages((prev) => {
                const merged = chatHistoryCache.mergeMessages(prev, newMessages);
                chatHistoryCache.saveMessages(currentConversationId, merged).catch(() => {});
                return merged;
              });
            }
          })
          .catch((err) => console.error('[DirectMessageScreen] Catch-up sync error:', err));
      }
      return;
    }
    
    console.log('[DirectMessageScreen] ⚠️ Memory cache MISS - checking AsyncStorage');
    setIsFetchingMessages(true);
    
    try {
      const asyncStartTime = Date.now();
      const asyncCachedMessages = await chatHistoryCache.loadCachedMessagesAsync(currentConversationId);
      const asyncTime = Date.now() - asyncStartTime;
      
      console.log('[DirectMessageScreen] 🔍 AsyncStorage check:', {
        conversationId: currentConversationId,
        checkTime: `${asyncTime}ms`,
        hit: !!asyncCachedMessages,
        messageCount: asyncCachedMessages?.length || 0
      });
      
      if (asyncCachedMessages && asyncCachedMessages.length > 0) {
        const totalTime = Date.now() - loadStartTime;
        console.log(`[DirectMessageScreen] ✅ ASYNCSTORAGE CACHE HIT - Showing ${asyncCachedMessages.length} messages (${totalTime}ms total)`);
        
        // Set pagination cursor from cache
        if (asyncCachedMessages.length > 0) {
          oldestMessageIdRef.current = asyncCachedMessages[0].id;
        }
        
        // CRITICAL: Load adv_role BEFORE setting messages to ensure correct color on first render
        await loadOtherUserAdvRole();
        
        // Log image messages for debugging
        const imageMessages = asyncCachedMessages.filter(msg => msg.type === 'image' || msg.image_metadata);
        if (imageMessages.length > 0) {
          console.log('[DirectMessageScreen] 🖼️ IMAGE MESSAGES IN ASYNCSTORAGE CACHE:', {
            totalMessages: asyncCachedMessages.length,
            imageMessageCount: imageMessages.length,
            imageMessages: imageMessages.map(msg => ({
              id: msg.id,
              type: msg.type,
              hasType: msg.type !== undefined,
              hasImageMetadata: !!msg.image_metadata,
              imageMetadata: msg.image_metadata ? {
                hasImageUrl: !!msg.image_metadata.image_url,
                hasThumbnailUrl: !!msg.image_metadata.thumbnail_url,
                imageUrl: msg.image_metadata.image_url,
                thumbnailUrl: msg.image_metadata.thumbnail_url,
              } : null,
              uploadState: msg.upload_state,
            }))
          });
        } else {
          console.log('[DirectMessageScreen] 📝 No image messages in AsyncStorage cache (total messages:', asyncCachedMessages.length, ')');
        }
        
        // AsyncStorage cache hit - show messages (after adv_role is loaded)
        const deletedCount = asyncCachedMessages.filter(m => m.deleted).length;
        console.log('[DirectMessageScreen] Loading messages from AsyncStorage cache:', {
          totalMessages: asyncCachedMessages.length,
          deletedMessages: deletedCount,
          deletedMessageIds: asyncCachedMessages.filter(m => m.deleted).map(m => m.id),
        });
        setMessages(asyncCachedMessages);
        setIsFetchingMessages(false);

        setHasMoreMessages(true);

        // Lightweight catch-up: fetch messages newer than the newest cached message
        const newestCachedTimestamp = asyncCachedMessages[asyncCachedMessages.length - 1]?.created_at;
        if (newestCachedTimestamp) {
          messagingService.getMessagesUpdatedSince(currentConversationId, new Date(newestCachedTimestamp).getTime(), 50)
            .then((newMessages) => {
              if (newMessages.length > 0) {
                console.log(`[DirectMessageScreen] 📬 Catch-up found ${newMessages.length} missed messages (AsyncStorage path)`);
                setMessages((prev) => {
                  const merged = chatHistoryCache.mergeMessages(prev, newMessages);
                  chatHistoryCache.saveMessages(currentConversationId, merged).catch(() => {});
                  return merged;
                });
              }
            })
            .catch((err) => console.error('[DirectMessageScreen] Catch-up sync error:', err));
        }
      } else {
        console.log('[DirectMessageScreen] ⚠️ Both caches MISS - fetching from server');

        const serverStartTime = Date.now();
        const result = await messagingService.getMessages(currentConversationId, 30);
        const serverTime = Date.now() - serverStartTime;
        const totalTime = Date.now() - loadStartTime;
        
        console.log(`[DirectMessageScreen] 📥 SERVER FETCH - Got ${result.messages.length} messages in ${serverTime}ms (${totalTime}ms total, hasMore: ${result.hasMore})`);
        
        const deletedCount = result.messages.filter(m => m.deleted).length;
        console.log('[DirectMessageScreen] Server messages include deleted:', {
          totalMessages: result.messages.length,
          deletedMessages: deletedCount,
          deletedMessageIds: result.messages.filter(m => m.deleted).map(m => m.id),
        });

        setHasMoreMessages(result.hasMore);
        if (result.messages.length > 0) {
          oldestMessageIdRef.current = result.messages[0].id;
        }
        await chatHistoryCache.saveMessages(currentConversationId, result.messages);
        
        // CRITICAL: Load adv_role BEFORE setting messages to ensure correct color on first render
        await loadOtherUserAdvRole();
        
        // Set messages after adv_role is loaded to ensure correct colors.
        // Preserve any local-only messages already present for THIS conversation
        // (e.g. the optimistic first message after createDirectConversation
        // flipped currentConversationId from null → real). At this moment the
        // server has the conversation row but messagingService.sendMessage
        // hasn't run yet, so result.messages is []. A blind replace would wipe
        // the optimistic bubble for a frame and the WelcomeIntroMessage would
        // flash back until the send resolves.
        setMessages((prev) => {
          const localForThisConvo = prev.filter(m => m.conversation_id === currentConversationId);
          if (localForThisConvo.length === 0) return result.messages;
          return chatHistoryCache.mergeMessages(localForThisConvo, result.messages);
        });
        setIsFetchingMessages(false);
      }
    } catch (error) {
      console.error('[DirectMessageScreen] ❌ Error loading messages:', error);
      setIsFetchingMessages(false);
    }
  };
  
  // Load older messages (pagination)
  const loadOlderMessages = async () => {
    // Ref-based lock to prevent race conditions (synchronous check)
    if (!currentConversationId || isLoadingOlderRef.current || !hasMoreMessagesRef.current || !oldestMessageIdRef.current) {
      return;
    }
    
    // Set lock immediately (synchronous) before async state update
    isLoadingOlderRef.current = true;
    setIsLoadingOlderMessages(true);
    
    try {
      // Capture oldestMessageId at call time to prevent stale values
      const beforeMessageId = oldestMessageIdRef.current;
      
      // Find the message in current state to get its created_at (avoids extra query)
      const beforeMessage = messages.find(m => m.id === beforeMessageId);
      const beforeMessageCreatedAt = beforeMessage?.created_at;
      
      const result = await messagingService.getMessages(
        currentConversationId,
        30,
        undefined,
        beforeMessageId,
        beforeMessageCreatedAt
      );
      
      if (result.messages.length > 0) {
        // Prepend older messages to existing array
        setMessages((prev) => {
          // Avoid duplicates
          const existingIds = new Set(prev.map(m => m.id));
          const uniqueNew = result.messages.filter(m => !existingIds.has(m.id));
          const merged = [...uniqueNew, ...prev];
          
          // Update cache
          chatHistoryCache.saveMessages(currentConversationId, merged).catch(err => {
            console.error('Error saving merged messages:', err);
          });
          
          return merged;
        });
        
        // Update pagination state
        setHasMoreMessages(result.hasMore);
        oldestMessageIdRef.current = result.messages[0].id;
      } else {
        setHasMoreMessages(false);
      }
    } catch (error) {
      console.error('[DirectMessageScreen] Error loading older messages:', error);
      // Reset hasMore on error to prevent stuck state
      setHasMoreMessages(false);
    } finally {
      // Release lock
      isLoadingOlderRef.current = false;
      setIsLoadingOlderMessages(false);
    }
  };
  
  // Background server sync (conditional - only if realtime is unhealthy or disconnected)
  const syncWithServerInBackground = async () => {
    if (!currentConversationId) return;
    
    // Skip if realtime is healthy - it should deliver all updates
    if (realtimeHealthy) {
      return;
    }
    
    try {
      // CRITICAL: Only sync if realtime subscription is unhealthy or disconnected >5 minutes
      // Realtime subscription is primary - background sync is fallback only
      
      const lastSync = await chatHistoryCache.getLastSyncTimestamp(currentConversationId);
      
      // Check if we've received messages recently (health check)
      const lastMessageTime = messages.length > 0 ? new Date(messages[messages.length - 1].created_at).getTime() : 0;
      const messageAge = lastMessageTime > 0 ? Date.now() - lastMessageTime : Infinity;
      
      // Only sync if:
      // 1. Realtime is unhealthy (already checked above), AND
      // 2. Last message was >5 minutes ago (no recent activity), OR
      // 3. Last sync was >5 minutes ago (cold start scenario)
      const syncAge = lastSync ? Date.now() - lastSync : Infinity;
      if (messageAge < 5 * 60 * 1000 && syncAge < 5 * 60 * 1000) {
        // Recent activity - skip sync
        return;
      }
      
      // Fetch messages updated after last sync (version-aware)
      // Limit to 20 messages for lightweight sync
      const serverMessages = await messagingService.getMessagesUpdatedSince(
        currentConversationId,
        lastSync || 0,
        20 // Lightweight limit
      );
      
      if (serverMessages.length > 0) {
        // CRITICAL: Use functional setState to avoid stale closure bug
        setMessages((prev) => {
          // Merge with current state (not outer scope variable)
          const merged = chatHistoryCache.mergeMessages(prev, serverMessages);
          
          // Save to cache (non-blocking)
          chatHistoryCache.saveMessages(currentConversationId, merged).catch(err => {
            console.error('Error saving cache:', err);
          });
          
          return merged;
        });
      }
    } catch (error) {
      console.error('Background sync error:', error);
      // Don't show error to user - silent sync failure
    }
  };

  const sendMessage = async () => {
    if (!inputText.trim() || isLoading || !currentUserId) return;

    const messageText = inputText.trim();
    // Client-generated UUID. Acts as both the optimistic row's id (so we can
    // locate it later) and the server-side idempotency key (client_id column).
    const clientId = Crypto.randomUUID();

    // Snapshot the message being replied to (if any), then clear the banner
    // optimistically. The snapshot is frozen at this moment so edits to the
    // original don't mutate the quote — matches WhatsApp.
    const replyToSnapshot: ReplyToSnapshot | undefined = replyingTo
      ? {
          message_id: replyingTo.id,
          sender_id: replyingTo.sender_id,
          sender_name:
            replyingTo.sender_id === currentUserId
              ? 'You'
              : (replyingTo.sender_name || otherUserName || ''),
          type: replyingTo.type ?? 'text',
          body:
            replyingTo.type === 'image'
              ? 'Photo'
              : replyingTo.type === 'video'
                ? 'Video'
                : (replyingTo.body ?? ''),
        }
      : undefined;
    if (replyingTo) setReplyingTo(null);

    // 1. Show message immediately (optimistic) - BEFORE conversation creation
    const tempConversationId = currentConversationId || `temp-conv-${Date.now()}`;
    const optimisticMessage: Message = {
      id: clientId,
      conversation_id: tempConversationId,
      sender_id: currentUserId,
      body: messageText,
      rendered_body: null,
      attachments: [],
      client_id: clientId,
      is_system: false,
      edited: false,
      deleted: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      reply_to_message_id: replyToSnapshot?.message_id ?? null,
      reply_to_snapshot: replyToSnapshot ?? null,
    };

    setMessages((prev) => [...prev, optimisticMessage]);
    setInputText('');

    // Refocus is handled inside ChatTextInput.handleSend (covers rAF + LayoutAnimation timing).

    // Scroll to bottom immediately
    scrollToBottom();

    // Optimistically push the message into the conversations list preview right
    // now — before the network send resolves and before Realtime delivers. The
    // reducer will overwrite last_message again when the real server row arrives
    // via the post-send dispatch and/or the Realtime INSERT, but the preview is
    // already visually correct. Only dispatch when we already have a real
    // conversation id; new-DM flows dispatch after createDirectConversation.
    if (currentConversationId) {
      messagingDispatch({
        type: 'NEW_MESSAGE',
        payload: { conversationId: currentConversationId, message: optimisticMessage },
      });
    }

    // 2. Create conversation if needed (still blocking, but message already visible)
    let targetConversationId = currentConversationId;

    if (!targetConversationId) {
      try {
        setIsLoading(true);
        setLoadingMessage('');

        // Progressive feedback: Show messages at different intervals
        const feedbackTimeout = setTimeout(() => {
          setLoadingMessage('This is taking longer than usual...');
        }, 5000);

        // Final timeout after 30 seconds (generous for DB operations)
        const finalTimeout = setTimeout(() => {
          clearTimeout(feedbackTimeout);
          throw new Error('Connection timeout. Please check your internet connection and try again.');
        }, 30000);

        try {
          const conversation = await messagingService.createDirectConversation(otherUserId, fromTripPlanning);

          // Clear timeouts if successful
          clearTimeout(feedbackTimeout);
          clearTimeout(finalTimeout);
          setLoadingMessage('');

          targetConversationId = conversation.id;
          setCurrentConversationId(targetConversationId);

          // Update optimistic message with real conversation ID
          if (targetConversationId) {
            setMessages((prev) => prev.map(msg =>
              msg.id === clientId
                ? { ...msg, conversation_id: targetConversationId! }
                : msg
            ));
          }

          // Seed the conversation into messaging state with full other_user data
          // BEFORE the optimistic NEW_MESSAGE dispatch fires for the new chat.
          // Without this, the NEW_MESSAGE reducer hits its index===-1 branch and
          // builds a placeholder with sender_id as currentUserId, producing an
          // other_user with empty user_id and the literal name 'Unknown User'.
          messagingDispatch({
            type: 'UPDATE_CONVERSATION',
            payload: {
              conversation: {
                ...conversation,
                other_user: {
                  conversation_id: conversation.id,
                  user_id: otherUserId,
                  role: 'member',
                  joined_at: conversation.created_at,
                  preferences: {},
                  name: otherUserName,
                  profile_image_url: otherUserAvatar || undefined,
                },
                members: [],
                unread_count: 0,
              },
            },
          });

          // Set in MessagingProvider
          setMessagingCurrentConversationId(targetConversationId);

          // Load other user's adv_role for the new conversation
          await loadOtherUserAdvRole();

          // Notify parent component that conversation was created
          if (onConversationCreated) {
            onConversationCreated(targetConversationId);
          }
        } catch (error) {
          // Clear timeouts on error
          clearTimeout(feedbackTimeout);
          clearTimeout(finalTimeout);
          throw error;
        }
      } catch (error: any) {
        console.error('Error creating conversation:', error);
        const errorMessage = error?.message || 'Failed to create conversation. Please try again.';
        // The message never made it off-device — remove it, restore the input,
        // and surface the error. Do not enqueue to the outbox in this branch.
        setMessages((prev) => prev.filter(msg => msg.id !== clientId));
        setInputText(messageText); // Restore input text
        chatInputRef.current?.focus?.();
        Alert.alert('Error', errorMessage);
        setIsLoading(false);
        setLoadingMessage('');
        return;
      }
    }

    setIsLoading(true);

    if (!targetConversationId) {
      setIsLoading(false);
      return;
    }

    // Persist the send intent BEFORE attempting the network call. If the app
    // is killed mid-send or the request fails, the outbox will retry on the
    // next foreground / reconnect and the partial unique index prevents dupes.
    try {
      await messageOutbox.enqueue({
        clientId,
        conversationId: targetConversationId,
        senderId: currentUserId,
        body: messageText,
        type: 'text',
        replyTo: replyToSnapshot ?? null,
      });
    } catch (err) {
      console.warn('[DirectMessageScreen] outbox enqueue failed (proceeding anyway):', err);
    }

    // 3. Send message to server (replace optimistic message with real one)
    try {
      const sentMessage = await messagingService.sendMessage(
        targetConversationId,
        messageText,
        [],
        'text',
        clientId,
        replyToSnapshot
      );

      // Remove from outbox on confirmed delivery.
      messageOutbox.markSent(clientId).catch(() => {});

      // Track first message sent (only if this is a new conversation and we haven't tracked it yet)
      if (!hasTrackedFirstMessage && !conversationId) {
        analyticsService.trackFirstMessageSent(targetConversationId);
        setHasTrackedFirstMessage(true);
        setFirstMessageSentTime(Date.now());
      }

      // Swap optimistic row (id=clientId) for the server row (id=server uuid),
      // or no-op if Realtime already landed it.
      setMessages((prev) => {
        if (prev.some(msg => msg.id === sentMessage.id)) {
          // Realtime beat us — just make sure the optimistic row is gone.
          const filtered = prev.filter(msg => msg.id !== clientId);
          if (filtered.length !== prev.length) {
            chatHistoryCache.saveMessages(targetConversationId!, filtered).catch(err => {
              console.error('Error updating cache:', err);
            });
          }
          return filtered;
        }
        const optimisticIdx = prev.findIndex(m =>
          m.id === clientId || m.client_id === clientId
        );
        const updated = optimisticIdx !== -1
          ? prev.map((m, i) => i === optimisticIdx ? sentMessage : m)
          : [...prev, sentMessage];
        chatHistoryCache.saveMessages(targetConversationId!, updated).catch(err => {
          console.error('Error updating cache:', err);
        });
        return updated;
      });

      // Belt-and-suspenders: push the sent message into the list immediately so
      // the preview updates the moment the send resolves, without waiting for
      // the (flaky) unfiltered Realtime INSERT. The reducer dedupes by id, so
      // if Realtime also delivers, the second dispatch is a no-op.
      messagingDispatch({
        type: 'NEW_MESSAGE',
        payload: { conversationId: targetConversationId, message: sentMessage },
      });

      scrollToBottom();
    } catch (error: any) {
      console.error('Error sending message:', error);
      // Do NOT remove the optimistic row — leave it visible with a failed
      // indicator so the user knows it's retryable. The outbox entry stays
      // enqueued and will be retried on the next flush trigger.
      messageOutbox.markFailed(clientId, error).catch(() => {});
      setMessages((prev) => prev.map(msg =>
        msg.id === clientId
          ? { ...msg, upload_state: 'failed', upload_error: error?.message ?? 'Send failed' }
          : msg
      ));
    } finally {
      setIsLoading(false);
    }
  };

  // Handle typing indicator: send startTyping soon after user starts typing (leading + throttle), stopTyping after 3s idle (trailing)
  useEffect(() => {
    if (!currentConversationId || !inputText.trim()) {
      if (typingDebounceRef.current) {
        clearTimeout(typingDebounceRef.current);
        typingDebounceRef.current = null;
      }
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
      lastTypingSentAtRef.current = 0;
      messagingService.stopTyping(currentConversationId!).catch(() => {});
      return;
    }

    const now = Date.now();
    const timeSinceLastSent = lastTypingSentAtRef.current ? now - lastTypingSentAtRef.current : Infinity;
    // Send startTyping 100ms after they start (or after throttle interval): leading + throttle ~500ms
    if (timeSinceLastSent >= 500) {
      if (typingDebounceRef.current) {
        clearTimeout(typingDebounceRef.current);
      }
      typingDebounceRef.current = setTimeout(() => {
        typingDebounceRef.current = null;
        if (currentConversationId && inputText.trim()) {
          messagingService.startTyping(currentConversationId).catch(() => {});
          lastTypingSentAtRef.current = Date.now();
        }
      }, 100) as ReturnType<typeof setTimeout>;
    }

    // Trailing: clear typing indicator after 3 seconds of no typing
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    typingTimeoutRef.current = setTimeout(() => {
      if (currentConversationId) {
        messagingService.stopTyping(currentConversationId).catch(() => {});
      }
    }, 3000) as ReturnType<typeof setTimeout>;

    return () => {
      if (typingDebounceRef.current) {
        clearTimeout(typingDebounceRef.current);
      }
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, [inputText, currentConversationId]);

  // Handle message edit
  const handleEditMessage = async (messageId: string, newBody: string) => {
    if (!currentConversationId || !newBody.trim()) return;

    // Check if message can still be edited (edit window expiration check)
    const message = messages.find(m => m.id === messageId);
    if (!message || !canEditMessage(message)) {
      Alert.alert('Error', 'This message can no longer be edited');
      setEditingMessageId(null);
      setEditingText('');
      return;
    }

    try {
      // Optimistic update
      setMessages((prev) => {
        const updated = prev.map(msg => 
          msg.id === messageId 
            ? { ...msg, body: newBody, edited: true, updated_at: new Date().toISOString() }
            : msg
        );
        chatHistoryCache.updateMessage(currentConversationId, messageId, updated.find(m => m.id === messageId) || null).catch(() => {});
        return updated;
      });

      const updatedMessage = await messagingService.editMessage(currentConversationId, messageId, newBody);
      
      // Update with server response
      setMessages((prev) => {
        const updated = prev.map(msg => 
          msg.id === messageId ? updatedMessage : msg
        );
        chatHistoryCache.updateMessage(currentConversationId, messageId, updatedMessage).catch(() => {});
        return updated;
      });

      setEditingMessageId(null);
      setEditingText('');
    } catch (error: any) {
      console.error('Error editing message:', error);
      Alert.alert('Error', error?.message || 'Failed to edit message');
      // Rollback optimistic update
      loadMessages();
    }
  };

  // Handle message delete
  const handleDeleteMessage = async (messageId: string) => {
    console.log('[DirectMessageScreen] handleDeleteMessage called', { messageId, currentConversationId });
    
    if (!currentConversationId) {
      console.error('[DirectMessageScreen] Cannot delete message: no conversation ID');
      Alert.alert('Error', 'Conversation not loaded');
      setMenuVisible(false);
      setSelectedMessage(null);
      return;
    }

    // Close menu first
    setMenuVisible(false);
    setSelectedMessage(null);

    // Find the message to get its details for logging
    const messageToDelete = messages.find(msg => msg.id === messageId);
    if (!messageToDelete) {
      console.error('[DirectMessageScreen] Message not found for deletion', { messageId });
      Alert.alert('Error', 'Message not found');
      return;
    }

    console.log('[DirectMessageScreen] Showing delete confirmation dialog', {
      messageId,
      conversationId: currentConversationId,
      messageBody: messageToDelete.body?.substring(0, 50),
      isSystem: messageToDelete.is_system,
      platform: Platform.OS,
    });

    // On web, use custom modal since Alert.alert doesn't support button callbacks properly
    if (Platform.OS === 'web') {
      setPendingDeleteMessageId(messageId);
      setDeleteConfirmVisible(true);
      return;
    }

    // On native platforms, use Alert.alert
    Alert.alert(
      'Delete Message',
      'Are you sure you want to delete this message?',
      [
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            console.log('[DirectMessageScreen] Alert Delete button pressed - START');
            await performDelete(messageId);
          },
        },
        { 
          text: 'Cancel', 
          style: 'cancel',
          onPress: () => {
            console.log('[DirectMessageScreen] Delete cancelled by user');
          }
        },
      ],
      { cancelable: true }
    );
  };

  // Extract delete logic to reusable function
  const performDelete = async (messageId: string) => {
    if (!currentConversationId) {
      console.error('[DirectMessageScreen] Cannot delete message: no conversation ID');
      Alert.alert('Error', 'Conversation not loaded');
      return;
    }

    console.log('[DirectMessageScreen] Delete confirmed, starting deletion process', {
      messageId,
      conversationId: currentConversationId,
    });

    try {
      // Optimistic update - mark message as deleted immediately
      console.log('[DirectMessageScreen] Applying optimistic update');
      setMessages((prev) => {
        const messageToDelete = prev.find(msg => msg.id === messageId);
        if (!messageToDelete) {
          console.warn('[DirectMessageScreen] Message not found for deletion', { messageId });
          return prev;
        }
        
        const deletedMessage = { ...messageToDelete, deleted: true, body: undefined };
        const updated = prev.map(msg => {
          if (msg.id === messageId) {
            console.log('[DirectMessageScreen] Marking message as deleted in UI', { messageId });
            return deletedMessage;
          }
          return msg;
        });
        
        // Update cache with deleted message (not null) so it persists
        chatHistoryCache.updateMessage(currentConversationId, messageId, deletedMessage).catch((err) => {
          console.error('[DirectMessageScreen] Error updating cache:', err);
        });
        
        return updated;
      });

      // Call delete service
      console.log('[DirectMessageScreen] Calling messagingService.deleteMessage', {
        conversationId: currentConversationId,
        messageId,
      });
      
      await messagingService.deleteMessage(currentConversationId, messageId);
      
      console.log('[DirectMessageScreen] Message deleted successfully', { messageId });

      // The real-time subscription will handle updating the UI
      // But we've already done the optimistic update above
      
    } catch (error: any) {
      console.error('[DirectMessageScreen] Error deleting message:', error);
      console.error('[DirectMessageScreen] Error details:', {
        message: error?.message,
        stack: error?.stack,
        conversationId: currentConversationId,
        messageId,
      });
      
      Alert.alert('Error', error?.message || 'Failed to delete message');
      
      // Rollback optimistic update by reloading messages
      console.log('[DirectMessageScreen] Rolling back optimistic update');
      loadMessages();
    }
  };

  // Handle image picker
  const handleImagePicker = async () => {
    if (!currentConversationId) {
      Alert.alert('Error', 'Please wait for the conversation to load');
      return;
    }

    try {
      if (Platform.OS === 'web') {
        if (typeof document === 'undefined' || !document.body) return;
        if (isPickerOpenRef.current) return;
        isPickerOpenRef.current = true;

        // Fallback: if user cancels picker, iOS Safari never fires change; reset flag so next tap can open again.
        if (pickerFallbackTimeoutRef.current) clearTimeout(pickerFallbackTimeoutRef.current);
        pickerFallbackTimeoutRef.current = setTimeout(() => {
          isPickerOpenRef.current = false;
          pickerFallbackTimeoutRef.current = null;
        }, 10000);

        // Append to DOM and use addEventListener so iOS Safari fires change (see e.g. SO 47664777).
        const input = document.createElement('input') as HTMLInputElement;
        input.type = 'file';
        input.accept = 'image/*,video/*';
        Object.assign(input.style, {
          position: 'fixed',
          left: '-9999px',
          opacity: '0',
          pointerEvents: 'none',
        });
        fileInputRef.current = input;

        const handleChange = (e: Event) => {
          if (pickerFallbackTimeoutRef.current) {
            clearTimeout(pickerFallbackTimeoutRef.current);
            pickerFallbackTimeoutRef.current = null;
          }
          const target = e.target as HTMLInputElement | null;
          const file = target?.files?.[0];
          isPickerOpenRef.current = false;
          if (fileInputRef.current?.parentNode) {
            fileInputRef.current.parentNode.removeChild(fileInputRef.current);
            fileInputRef.current = null;
          }
          if (!file) return;
          const isVideo = file.type.startsWith('video/');
          if (isVideo) {
            // Video: create blob URL for preview (avoid base64 for large files)
            const blobUrl = URL.createObjectURL(file);
            selectedVideoMetadataRef.current = {
              fileSize: file.size,
              mimeType: file.type || 'video/mp4',
            };
            setTimeout(() => {
              setSelectedVideoUri(blobUrl);
              setVideoPreviewVisible(true);
            }, 0);
          } else {
            // Image: read as data URL
            const reader = new FileReader();
            reader.onload = (event: ProgressEvent<FileReader>) => {
              const imageUri = event.target?.result as string;
              if (!imageUri) return;
              selectedImageUriForUploadRef.current = imageUri;
              setTimeout(() => {
                setSelectedImageUri(imageUri);
                setImagePreviewVisible(true);
              }, 0);
            };
            reader.onerror = () => {
              console.error('[DirectMessageScreen] FileReader failed to read image');
              Alert.alert('Error', 'Could not read the selected file. Please try another.');
            };
            reader.readAsDataURL(file);
          }
        };

        input.addEventListener('change', handleChange);
        document.body.appendChild(input);
        input.click();
      } else {
        // For native, use expo-image-picker (allowsEditing: true so iOS returns file:// URI instead of ph://)
        const launchNativeImagePicker = async () => {
          try {
            const ImagePicker = require('expo-image-picker');
            const usePhotoPicker = Platform.OS === 'android' && Platform.Version >= 33;

            if (!usePhotoPicker) {
              const { status, canAskAgain } = await ImagePicker.requestMediaLibraryPermissionsAsync();
              if (status !== 'granted') {
                if (!canAskAgain) {
                  Alert.alert(
                    'Permission Required',
                    'Swellyo needs access to your photos. Please enable it in your device settings.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Open Settings', onPress: () => Linking.openSettings() },
                    ]
                  );
                } else {
                  Alert.alert('Permission Required', 'Sorry, we need camera roll permissions to send images!');
                }
                return;
              }
            }

            if (__DEV__) console.log('[DirectMessageScreen] launching native image picker');
            const result = await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ['images', 'videos'],
              quality: 1,
            });

            const asset = result.assets?.[0];
            const uri = asset?.uri ?? (result as { uri?: string }).uri;
            const canceled = result.canceled === true || (result as { cancelled?: boolean }).cancelled === true;
            if (__DEV__) {
              console.log(
                '[DirectMessageScreen] picker result — canceled=', canceled,
                'uri=', typeof uri === 'string' ? uri.slice(0, 80) : uri,
                'assetType=', asset?.type,
              );
            }
            if (uri && !canceled) {
              const isVideo = asset?.type === 'video' || uri.endsWith('.mp4') || uri.endsWith('.mov');
              if (__DEV__) console.log('[DirectMessageScreen] classified as', isVideo ? 'video' : 'image');
              if (isVideo) {
                selectedVideoMetadataRef.current = {
                  width: asset?.width,
                  height: asset?.height,
                  // expo-image-picker gives duration in milliseconds
                  duration: typeof asset?.duration === 'number' ? asset.duration / 1000 : undefined,
                  fileSize: asset?.fileSize,
                  mimeType: asset?.mimeType || (uri.endsWith('.mov') ? 'video/quicktime' : 'video/mp4'),
                };
                setSelectedVideoUri(uri);
                setVideoPreviewVisible(true);
              } else {
                // Always show the preview modal first — caption + edit + send
                // live there. The cropper opens on-demand from the modal's
                // Edit button (handleEditImage), not in this auto-launch path.
                if (__DEV__) {
                  console.log('[DirectMessageScreen] photo picked → ImagePreviewModal, uri=', uri.slice(0, 60));
                }
                selectedImageUriForUploadRef.current = uri;
                selectedImageDimensionsRef.current = {
                  width: asset?.width && asset.width > 0 ? asset.width : 0,
                  height: asset?.height && asset.height > 0 ? asset.height : 0,
                };
                setSelectedImageUri(uri);
                setImagePreviewVisible(true);
              }
            }
          } catch (error) {
            console.warn('expo-image-picker not available:', error);
            Alert.alert(
              'Image Picker Not Available',
              'Please install expo-image-picker for native platforms.'
            );
          }
        };

        const usePhotoPicker = Platform.OS === 'android' && Platform.Version >= 33;
        if (usePhotoPicker) {
          await launchNativeImagePicker();
        } else {
          const primerShown = await AsyncStorage.getItem('@swellyo_gallery_primer_shown');
          if (primerShown) {
            await launchNativeImagePicker();
          } else {
            pendingPickerRef.current = () => launchNativeImagePicker();
            setShowPermissionOverlay(true);
          }
        }
      }
    } catch (error) {
      console.error('Error picking image:', error);
      Alert.alert('Error', 'Failed to open image picker');
    }
  };

  // Open the native crop/edit editor on-demand from inside ImagePreviewModal.
  // Keeps the modal mounted (visible={true}) while the cropper presents on top
  // — dismissing the RN Modal first triggers the iOS "view not in window
  // hierarchy" race seen in react-native-image-crop-picker issues #264 / #659.
  const handleEditImage = async () => {
    const cropper = getImageCropPicker();
    if (!cropper) return;
    const currentUri = selectedImageUriForUploadRef.current ?? selectedImageUri;
    if (!currentUri) return;

    try {
      // Use captured source dims; fall back to a generous cap. Without explicit
      // width/height the lib outputs ~200px regardless of the source.
      const { width: capturedW, height: capturedH } = selectedImageDimensionsRef.current;
      const sourceWidth = capturedW > 0 ? capturedW : 4096;
      const sourceHeight = capturedH > 0 ? capturedH : 4096;

      if (__DEV__) console.log('[DirectMessageScreen] opening cropper from preview, source dims=', sourceWidth, 'x', sourceHeight);
      const edited = await cropper.openCropper({
        path: currentUri,
        mediaType: 'photo',
        width: sourceWidth,
        height: sourceHeight,
        freeStyleCropEnabled: true,
        // iOS only: stops TOCropViewController from auto-zooming to "fill"
        // the crop frame whenever the user drags a handle inward. The image
        // now stays put while only the dark mask moves, which matches how
        // most chat apps' crop UIs behave.
        avoidEmptySpaceAroundImage: false,
        enableRotationGesture: true,
        hideBottomControls: false,
        showCropGuidelines: true,
        showCropFrame: true,
        cropperToolbarTitle: 'Edit Photo',
        cropperChooseText: 'Save',
        compressImageQuality: 0.95,
        compressImageMaxWidth: 2560,
        compressImageMaxHeight: 2560,
        includeExif: false,
      });
      if (__DEV__) console.log('[DirectMessageScreen] cropper done, dims=', edited.width, 'x', edited.height);

      const editedPath = edited.path.startsWith('file://')
        ? edited.path
        : `file://${edited.path}`;

      // Replace the preview's image in-place. The modal stays open so the user
      // can keep typing the caption and tap Send when ready.
      selectedImageUriForUploadRef.current = editedPath;
      selectedImageDimensionsRef.current = {
        width: edited.width || sourceWidth,
        height: edited.height || sourceHeight,
      };
      setSelectedImageUri(editedPath);
    } catch (err) {
      if (isPickerCancelError(err)) {
        if (__DEV__) console.log('[DirectMessageScreen] cropper canceled');
        return;
      }
      console.warn('[DirectMessageScreen] openCropper failed:', err);
      Alert.alert('Error', 'Could not open the photo editor.');
    }
  };

  // Handle image send. `overrideImageUri` is no longer used by the picker
  // (which now always routes through ImagePreviewModal) but is kept for the
  // recovery path that re-uploads pending messages with the cached local URI.
  const handleImageSend = async (caption?: string, overrideImageUri?: string) => {
    const uriToUse = overrideImageUri ?? selectedImageUriForUploadRef.current ?? selectedImageUri;
    if (!uriToUse || !currentConversationId || !currentUserId) {
      return;
    }

    const conversationId = currentConversationId;
    let messageId: string | null = null;

    try {
      // Step 1: Create message record in DB first (to get real message ID)
      const messageRecord = await messagingService.createImageMessage(conversationId, caption);
      messageId = messageRecord.id;

      // Close preview modal immediately — upload continues in background
      selectedImageUriForUploadRef.current = null;
      setImagePreviewVisible(false);
      setSelectedImageUri(null);
      setIsProcessingImage(false);

      // Inject message into local state with uploading flag + local preview
      setMessages((prev) => {
        const existingIdx = prev.findIndex(m => m.id === messageRecord.id);
        if (existingIdx !== -1) {
          return prev.map(m =>
            m.id === messageRecord.id
              ? { ...m, upload_state: 'uploading', _localPreviewUri: uriToUse }
              : m
          );
        }
        return [...prev, { ...messageRecord, upload_state: 'uploading', _localPreviewUri: uriToUse }];
      });
      scrollToBottom();

      // Import image upload service functions
      const { processImage, uploadImageToStorage } = await import('../services/messaging/imageUploadService');

      // Step 2: Process image (compress and generate thumbnail)
      const processed = await processImage(uriToUse);

      // Step 3: Upload original image
      const imageUrl = await uploadImageToStorage(
        processed.originalUri,
        conversationId,
        messageRecord.id,
        false
      );

      // Step 4: Upload thumbnail
      const thumbnailUrl = await uploadImageToStorage(
        processed.thumbnailUri,
        conversationId,
        messageRecord.id,
        true
      );

      // Step 5: Update message with image metadata
      const imageMetadata = {
        image_url: imageUrl,
        thumbnail_url: thumbnailUrl,
        width: processed.width,
        height: processed.height,
        file_size: processed.fileSize,
        mime_type: processed.mimeType,
        storage_path: `${conversationId}/${messageRecord.id}/original.jpg`,
      };

      await messagingService.updateImageMessageMetadata(messageRecord.id, imageMetadata);

      // Upload succeeded — mark message as sent and drop the local preview
      setMessages((prev) => prev.map(m =>
        m.id === messageRecord.id
          ? { ...m, image_metadata: imageMetadata, upload_state: 'sent', _localPreviewUri: undefined }
          : m
      ));
    } catch (error: any) {
      console.error('Error sending image:', error);
      if (messageId) {
        setMessages((prev) => prev.map(m =>
          m.id === messageId
            ? { ...m, upload_state: 'failed', upload_error: error?.message }
            : m
        ));
      } else {
        // Failed before we even got a message ID — make sure the modal closes so the user isn't stuck
        selectedImageUriForUploadRef.current = null;
        setImagePreviewVisible(false);
        setSelectedImageUri(null);
        setIsProcessingImage(false);
      }
      Alert.alert('Error', error?.message || 'Failed to send image');
    }
  };

  // Handle video send
  const handleVideoSend = async (caption?: string, overrideVideoUri?: string) => {
    // Prefer a trimmed URI from the preview modal when the user cut the clip;
    // otherwise fall back to the originally-picked URI.
    const videoUri = overrideVideoUri ?? selectedVideoUri;
    if (!videoUri || !currentConversationId || !currentUserId) {
      return;
    }

    const conversationId = currentConversationId;
    let messageId: string | null = null;
    // Picker hints describe the ORIGINAL file. If the user trimmed, the file
    // changed — let `processVideo` re-read metadata from disk rather than trust
    // stale hints for duration/size.
    const videoHints = overrideVideoUri ? undefined : (selectedVideoMetadataRef.current ?? undefined);

    try {
      // Close preview immediately — upload continues in background
      setVideoPreviewVisible(false);
      setSelectedVideoUri(null);
      selectedVideoMetadataRef.current = null;
      setIsProcessingVideo(false);

      const { processVideo, uploadVideoToS3, uploadThumbnailToStorage, pollForProcessedDmVideo } = await import('../services/messaging/videoUploadService');

      // Generate the thumbnail BEFORE injecting the bubble. <Image> can't render a raw
      // video URI, so without a real poster the bubble would be a black box during
      // upload. Paralleled with createVideoMessage to avoid adding latency.
      const [messageRecord, processed] = await Promise.all([
        messagingService.createVideoMessage(conversationId, caption),
        processVideo(videoUri, videoHints),
      ]);
      messageId = messageRecord.id;

      // Inject dimensions so the poster renders with the correct aspect ratio
      // during the upload phase (prevents portrait videos getting stretched to 16/9).
      const posterMetadata = {
        video_url: '',
        thumbnail_url: '',
        duration: processed.duration,
        width: processed.width,
        height: processed.height,
        file_size: processed.fileSize,
        mime_type: processed.mimeType,
        storage_path: '',
      };

      // Inject message locally with uploading flag + local thumbnail poster
      setMessages((prev) => {
        const existingIdx = prev.findIndex(m => m.id === messageRecord.id);
        if (existingIdx !== -1) {
          return prev.map(m =>
            m.id === messageRecord.id
              ? { ...m, upload_state: 'uploading', _localPreviewUri: processed.thumbnailUri, video_metadata: posterMetadata }
              : m
          );
        }
        return [...prev, { ...messageRecord, upload_state: 'uploading', _localPreviewUri: processed.thumbnailUri, video_metadata: posterMetadata }];
      });
      scrollToBottom();

      // Step 3: Upload video + thumbnail in parallel
      const [uploadResult, thumbnailUrl] = await Promise.all([
        uploadVideoToS3(videoUri, conversationId, messageRecord.id),
        uploadThumbnailToStorage(processed.thumbnailUri, conversationId, messageRecord.id),
      ]);
      const { s3Key, processedKey, originalUrl } = uploadResult;

      // Step 5: Update message with initial video metadata.
      // `original_url` is playable immediately; `video_url` is filled by the
      // server-side Lambda once MediaConvert writes the compressed output.
      const videoMetadata = {
        video_url: '',
        original_url: originalUrl,
        thumbnail_url: thumbnailUrl,
        duration: processed.duration,
        width: processed.width,
        height: processed.height,
        file_size: processed.fileSize,
        mime_type: processed.mimeType,
        storage_path: s3Key,
      };

      await messagingService.updateVideoMessageMetadata(messageRecord.id, videoMetadata);

      // Upload phase done. Receiver can already play the original_url; the compressed
      // video_url will be swapped in via Realtime when the Lambda finishes.
      setMessages((prev) => prev.map(m =>
        m.id === messageRecord.id
          ? { ...m, video_metadata: videoMetadata, upload_state: 'sent', _localPreviewUri: undefined }
          : m
      ));

      // Step 6: Poll for processed video in background
      pollForProcessedDmVideo(messageRecord.id, processedKey, videoMetadata)
        .catch(err => console.error('Background video poll error:', err));

    } catch (error: any) {
      console.error('Error sending video:', error);
      if (messageId) {
        setMessages((prev) => prev.map(m =>
          m.id === messageId
            ? { ...m, upload_state: 'failed', upload_error: error?.message }
            : m
        ));
      } else {
        setVideoPreviewVisible(false);
        setSelectedVideoUri(null);
        selectedVideoMetadataRef.current = null;
        setIsProcessingVideo(false);
      }
      Alert.alert('Error', error?.message || 'Failed to send video');
    }
  };

  // Handle retry upload for failed image messages
  const handleRetryUpload = async (message: Message) => {
    if (!message.image_metadata || !currentConversationId) return;

    // TODO: Implement retry logic
    // This should re-upload the image and update the message
    Alert.alert('Info', 'Retry upload functionality will be implemented in Phase 3');
  };

  const handleRetryTextMessage = async (message: Message) => {
    // The optimistic row's id is the client_id. `message.client_id` is also set
    // defensively in case this is a re-rendered row.
    const clientId = message.client_id ?? (typeof message.id === 'string' ? message.id : null);
    if (!clientId) return;

    // Swap to 'uploading' so the UI shows a spinner instead of the red
    // "Tap to retry" label while the send is in flight.
    setMessages((prev) => prev.map(m =>
      m.id === message.id
        ? { ...m, upload_state: 'uploading', upload_error: undefined }
        : m
    ));

    const result = await messageOutbox.flushOne(clientId, async (entry) => {
      await messagingService.sendMessage(
        entry.conversationId,
        entry.body,
        [],
        entry.type,
        entry.clientId
      );
    });

    if (result.ok) {
      // Realtime INSERT handler will replace the optimistic row with the server
      // row (see onNewMessage: clientId match branch). Nothing to do here.
      return;
    }

    if (result.reason === 'no_entry') {
      // The outbox entry is gone — auto-flush already sent it, or the user
      // deleted it. Clear the stale indicator; the mount-sync effect will
      // reconcile the row against any server copy that arrived.
      setMessages((prev) => prev.map(m =>
        m.id === message.id
          ? { ...m, upload_state: undefined, upload_error: undefined }
          : m
      ));
      return;
    }

    // result.reason === 'send_failed' — restore the failed indicator and
    // surface the real error so the user (and us, debugging) can see why.
    console.error('[DirectMessageScreen] retry failed', result.error);
    const errorMessage =
      (result.error instanceof Error && result.error.message) ||
      (typeof result.error === 'object' && result.error !== null && 'message' in (result.error as any)
        ? String((result.error as any).message)
        : String(result.error));
    setMessages((prev) => prev.map(m =>
      m.id === message.id
        ? { ...m, upload_state: 'failed', upload_error: errorMessage }
        : m
    ));
    Alert.alert('No se pudo reenviar', errorMessage);
  };

  // Remove a failed (never-delivered) message from the UI, outbox, and cache.
  // Only called from the failed-message long-press menu.
  const handleDeleteFailedMessage = async (message: Message) => {
    const clientId = message.client_id ?? (typeof message.id === 'string' ? message.id : null);
    const convId = message.conversation_id || currentConversationIdRef.current;
    setMessages((prev) => {
      const updated = prev.filter(m => m.id !== message.id);
      if (convId) {
        chatHistoryCache.saveMessages(convId, updated).catch(() => {});
      }
      return updated;
    });
    if (clientId) {
      messageOutbox.remove(clientId).catch((err) =>
        console.warn('[DirectMessageScreen] outbox remove failed:', err)
      );
    }
  };

  const handleCopyMessageText = async (message: Message) => {
    if (!message.body) return;
    try {
      // Lazy-require so older dev builds without expo-clipboard compiled in
      // don't crash at module load. Falls back to a warning if unavailable.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Clipboard = require('expo-clipboard');
      await Clipboard.setStringAsync(message.body);
    } catch (err) {
      console.warn('[DirectMessageScreen] clipboard copy failed:', err);
    }
  };

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Tap on a reply preview → scroll the original message to vertical center,
  // then briefly flash it. If the parent is older than what's loaded, page in
  // older messages until found (capped to avoid infinite loops).
  const handleReplyPreviewPress = useCallback(async (parentMessageId: string) => {
    if (resolvingReplyJumpId) return;

    const findInvertedIndex = (id: string): number => {
      const arr = messagesRef.current;
      const chronoIdx = arr.findIndex((m) => m.id === id);
      return chronoIdx === -1 ? -1 : arr.length - 1 - chronoIdx;
    };

    let invertedIndex = findInvertedIndex(parentMessageId);
    if (invertedIndex === -1) {
      setResolvingReplyJumpId(parentMessageId);
      let attempts = 0;
      while (
        invertedIndex === -1 &&
        attempts < 5 &&
        hasMoreMessagesRef.current &&
        !isLoadingOlderRef.current
      ) {
        await loadOlderMessages();
        invertedIndex = findInvertedIndex(parentMessageId);
        attempts++;
      }
      setResolvingReplyJumpId(null);
    }

    if (invertedIndex === -1) {
      Alert.alert('Mensaje no disponible', 'No pudimos encontrar el mensaje original.');
      return;
    }

    flatListRef.current?.scrollToIndex({
      index: invertedIndex,
      viewPosition: 0.5,
      animated: true,
    });
    setTimeout(() => setHighlightedMessageId(parentMessageId), 350);
  }, [resolvingReplyJumpId]);

  // Handle long press on message
  const handleMessageLongPress = (message: Message, event: any) => {
    console.log('[DirectMessageScreen] handleMessageLongPress called', {
      messageId: message.id,
      currentUserId,
      messageSenderId: message.sender_id,
      isOwnMessage: currentUserId === message.sender_id,
      isDeleted: message.deleted,
      isSystem: message.is_system,
      uploadState: message.upload_state,
    });

    if (!currentUserId) {
      return;
    }
    if (message.deleted) {
      return;
    }
    if (message.is_system) {
      return;
    }

    const isOwnMessage = message.sender_id === currentUserId;
    const hasCopyableText = !!message.body && message.body.trim().length > 0;
    const isMedia = message.type === 'image' || message.type === 'video';

    // For other users' messages, only open the menu if there's something to
    // act on: copyable text OR media (which can be replied to).
    if (!isOwnMessage && !hasCopyableText && !isMedia) {
      return;
    }

    // Failed messages have no server row yet — edit/delete-via-server would
    // fail. Offer Retry / Delete (local) / Copy instead.
    if (isOwnMessage && message.upload_state === 'failed') {
      Alert.alert(
        'Mensaje sin enviar',
        message.body || '',
        [
          { text: 'Reenviar', onPress: () => handleRetryTextMessage(message) },
          { text: 'Copiar texto', onPress: () => handleCopyMessageText(message) },
          { text: 'Borrar', style: 'destructive', onPress: () => handleDeleteFailedMessage(message) },
          { text: 'Cancelar', style: 'cancel' },
        ]
      );
      return;
    }

    const { pageX, pageY } = event.nativeEvent;
    
    
    // Set selected message first, then show menu
    // Use a small delay to ensure state is set before menu renders
    setSelectedMessage(message);
    setEditingText(message.body || ''); // Initialize edit text
    setMenuPosition({ x: pageX, y: pageY });
    
    // Use setTimeout to ensure selectedMessage is set before menu becomes visible
    setTimeout(() => {
      setMenuVisible(true);
     
    }, 0);
  };

  // Check if message can be edited (within 15 minutes)
  const canEditMessage = (message: Message): boolean => {
    if (!currentUserId || message.sender_id !== currentUserId) return false;
    if (message.deleted) return false;
    if (message.is_system) return false; // Prevent system message edit
    
    const messageAge = Date.now() - new Date(message.created_at).getTime();
    const fifteenMinutes = 15 * 60 * 1000;
    return messageAge <= fifteenMinutes;
  };

  // Check if message can be deleted
  const canDeleteMessage = (message: Message): boolean => {
   
    
    if (!currentUserId || message.sender_id !== currentUserId) {
      return false;
    }
    if (message.deleted) {
      return false;
    }
    if (message.is_system) {
      return false;
    }
    
    console.log('[DirectMessageScreen] canDeleteMessage: true');
    return true; // No time limit on delete
  };

  // Typing Indicator Component
  const TypingIndicator = () => {
    const dot1 = useRef(new Animated.Value(0)).current;
    const dot2 = useRef(new Animated.Value(0)).current;
    const dot3 = useRef(new Animated.Value(0)).current;

    useEffect(() => {
      if (!isTyping) return;

      const animateDot = (dot: Animated.Value, delay: number) => {
        return Animated.loop(
          Animated.sequence([
            Animated.delay(delay),
            Animated.timing(dot, {
              toValue: 1,
              duration: 400,
              useNativeDriver: true,
            }),
            Animated.timing(dot, {
              toValue: 0,
              duration: 400,
              useNativeDriver: true,
            }),
          ])
        );
      };

      const animations = [
        animateDot(dot1, 0),
        animateDot(dot2, 200),
        animateDot(dot3, 400),
      ];

      animations.forEach(anim => anim.start());

      return () => {
        animations.forEach(anim => anim.stop());
      };
    }, [isTyping]);

    if (!isTyping) return null;

    const opacity1 = dot1.interpolate({
      inputRange: [0, 1],
      outputRange: [0.3, 1],
    });

    const opacity2 = dot2.interpolate({
      inputRange: [0, 1],
      outputRange: [0.3, 1],
    });

    const opacity3 = dot3.interpolate({
      inputRange: [0, 1],
      outputRange: [0.3, 1],
    });

    return (
      <View style={[styles.messageContainer, styles.botMessageContainer]}>
        <View style={[styles.messageBubble, styles.botMessageBubble]}>
          <View style={styles.typingContainer}>
            <Animated.View style={[styles.typingDot, { opacity: opacity1 }]} />
            <Animated.View style={[styles.typingDot, { opacity: opacity2 }]} />
            <Animated.View style={[styles.typingDot, { opacity: opacity3 }]} />
          </View>
        </View>
      </View>
    );
  };

  // For inverted FlatList, data must be newest-first (first item renders at bottom)
  // State keeps messages chronological (oldest-first) for easy append/merge
  const invertedMessages = useMemo(() => [...messages].reverse(), [messages]);

  // FlatList helpers for inverted list
  const renderItem = useCallback(({ item, index }: { item: Message; index: number }) => {
    // Track BOTH `id` and `client_id` so the optimistic→server swap (client_id
    // becomes the row key, server-issued id arrives later) doesn't re-fire the
    // entering animation mid-flight.
    const isInitialized = messageAnimationsInitializedRef.current;
    const idSeen = seenMessageIdsRef.current.has(item.id);
    const clientIdSeen = item.client_id ? seenMessageIdsRef.current.has(item.client_id) : false;
    const isNewMessage = isInitialized && !idSeen && !clientIdSeen;
    if (isInitialized) {
      seenMessageIdsRef.current.add(item.id);
      if (item.client_id) seenMessageIdsRef.current.add(item.client_id);
    }
    // Inverted list: cell[i].marginBottom creates the visible gap between cell[i]
    // (older, above visually) and cell[i-1] (newer, below visually). Compare with
    // the newer neighbor to decide same/different sender. Newest (index 0) sets
    // marginBottom to 0 — the composer's inputWrapper paddingTop owns that gap.
    const newerMessage = invertedMessages[index - 1];
    const sameSender = !!newerMessage && newerMessage.sender_id === item.sender_id;
    const messageGap = index === 0 ? 0 : (sameSender ? 3 : 9);
    // "Last/newest of run" — used in group chats to decide where to show the
    // sender name + avatar (per user spec, on the newest message of a run, not
    // the WhatsApp-default oldest). True when the message after this one (visually
    // below) has a different sender, or this is the newest message overall.
    const isLastInRun = !sameSender;
    // Own sends slide up from behind the composer; received messages slide
    // up from the typing indicator's height so the typing → message swap is
    // seamless even when the typing indicator wasn't visible.
    const isOwnSend = !!currentUserId && item.sender_id === currentUserId;
    const enteringAnim = isNewMessage
      ? (isOwnSend ? messageSlideUpFromComposer : messageSlideUpFromTypingHeight)
      : undefined;
    return (
      <Reanimated.View
        entering={enteringAnim}
        style={{ marginBottom: messageGap }}
      >
        {renderMessage(item, isLastInRun)}
      </Reanimated.View>
    );
  }, [currentUserId, editingMessageId, otherUserAdvRole, isDirect, menuVisible, selectedMessage, otherUserLastReadAt, invertedMessages]);

  // Prefer client_id so the React key stays stable across the optimistic →
  // server-confirmed swap. Without this, FlatList unmounts the old wrapper
  // and mounts a new one mid-flight, cutting the entering animation in half.
  const keyExtractor = useCallback((item: Message) => item.client_id || item.id, []);

  // In inverted FlatList: ListHeaderComponent renders at bottom, ListFooterComponent renders at top
  const listHeaderComponent = useMemo(() => <TypingIndicator />, [isTyping]);

  const listFooterComponent = useMemo(() => {
    if (!isLoadingOlderMessages) return null;
    return (
      <View style={styles.loadOlderContainer}>
        <ActivityIndicator size="small" color="#A0A0A0" />
        <Text style={styles.loadOlderText}>Loading older messages...</Text>
      </View>
    );
  }, [isLoadingOlderMessages]);

  const listEmptyComponent = useMemo(() => {
    if (isFetchingMessages) {
      return null;
    }
    // Group chats skip the "Yo shredders..." welcome — it's a 1-on-1 intro.
    if (!isDirect) {
      return null;
    }
    return (
      <View style={styles.emptyContainerWelcome}>
        <WelcomeIntroMessage />
      </View>
    );
  }, [isFetchingMessages, isDirect]);

  const onlineStatusElement = useMemo(() => {
    // Online presence is per-user — meaningless in a group chat.
    if (!isDirect) return null;
    if (otherUserIsOnline !== true) return null;
    return (
      <Reanimated.View
        entering={FadeIn.duration(220)}
        exiting={FadeOut.duration(160)}
        style={styles.statusContainer}
      >
        <View style={styles.onlineDot} />
        <Text style={styles.profileTagline}>Available</Text>
      </Reanimated.View>
    );
  }, [otherUserIsOnline, isDirect]);

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  };

  const renderMessage = (message: Message, isLastInRun: boolean = true) => {
    // CRITICAL: Render messages even if currentUserId isn't available yet
    // We can determine message alignment from sender_id comparison
    // For now, render all messages as received (will update when currentUserId loads)
    // This allows messages to appear instantly while currentUserId loads in background


    const isOwnMessage = currentUserId ? message.sender_id === currentUserId : false;
    const isEditing = editingMessageId === message.id;
    const canEdit = canEditMessage(message);
    // English/LTR sticks left, Hebrew/Arabic sticks right. Computed once
    // per message and applied to every Text that renders the body content.
    const bodyTextAlign = getBodyTextAlign(message.body);
    // For RTL bodies the timestamp always sits BELOW the body text — body
    // and timestamp stack vertically instead of sharing a row. (LTR keeps
    // the WhatsApp-style inline-when-it-fits, wrap-when-it-doesn't layout.)
    const isRtl = bodyTextAlign === 'right';

    // Group chats: show sender name + avatar on the LAST/newest message of a run from
    // the same sender (per user spec). Mid-run messages reserve avatar space so
    // bubble alignment stays consistent.
    const isGroupReceived = !isOwnMessage && !isDirect;
    const senderName = message.sender_name || message.sender?.name || otherUserName;
    const senderAvatar = message.sender_avatar || message.sender?.avatar || otherUserAvatar;
    const showAvatar = isGroupReceived && isLastInRun && (message.sender_name || message.sender_avatar);
    const showAvatarSpacer = isGroupReceived && !isLastInRun;
    const showSenderName = isGroupReceived && isLastInRun && !!senderName;
    const senderNameColor = isGroupReceived ? getSenderColor(message.sender_id) : undefined;
    
    return (
      <TouchableOpacity
        key={message.id}
        activeOpacity={0.7}
        onPress={() => Keyboard.dismiss()}
        onLongPress={(e) => handleMessageLongPress(message, e)}
        style={[
          styles.messageContainer,
          isOwnMessage ? styles.userMessageContainer : [
            styles.botMessageContainer,
            isDirect && styles.botMessageContainerDirect, // Less padding for direct messages (no avatar)
          ],
        ]}
      >
        {/* Group chat: show avatar only on the last/newest message of a run.
            Mid-run messages render an empty spacer to keep bubble alignment. */}
        {showAvatar && (
          <TouchableOpacity
            style={styles.messageAvatarContainer}
            onPress={() => message.sender_id && onViewProfile?.(message.sender_id)}
            activeOpacity={0.7}
          >
            {senderAvatar ? (
              <Image
                source={{ uri: senderAvatar }}
                style={styles.messageAvatar}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.messageAvatar, styles.messageAvatarPlaceholder]}>
                <Text style={styles.messageAvatarPlaceholderText}>
                  {senderName.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        )}
        {showAvatarSpacer && (
          <View style={styles.messageAvatarSpacer} />
        )}

        <MessageBubbleHighlight
          isHighlighted={highlightedMessageId === message.id}
          onAnimationEnd={() => setHighlightedMessageId(null)}
          style={[
            styles.messageBubble,
            isOwnMessage
              ? styles.userMessageBubble
              : [
                  styles.botMessageBubble,
                  otherUserAdvRole === 'adv_giver' && styles.botMessageBubbleGiveAdv,
                  otherUserAdvRole === 'adv_seeker' && styles.botMessageBubbleGetAdv,
                ],
            // Conditionally apply padding: 0 for images/videos, normal for text
            (message.type === 'image' || message.image_metadata || message.type === 'video' || message.video_metadata) && styles.imageMessageBubble,
            // Remove maxWidth constraint for deleted messages from other user
            message.deleted && !isOwnMessage && {
              maxWidth: Dimensions.get('window').width - 120, // Screen width minus padding
              alignSelf: 'flex-start',
            },
          ]}
        >
          {showSenderName && (
            <TouchableOpacity
              onPress={() => message.sender_id && onViewProfile?.(message.sender_id)}
              activeOpacity={0.7}
              style={styles.groupSenderNameTouchable}
            >
              <Text
                style={[styles.groupSenderName, { color: senderNameColor }]}
                numberOfLines={1}
              >
                {senderName}
              </Text>
            </TouchableOpacity>
          )}
          {message.reply_to_snapshot && !message.deleted && (
            <View
              style={
                (message.type === 'image' || message.image_metadata ||
                 message.type === 'video' || message.video_metadata)
                  ? styles.quotedPreviewMediaWrap
                  : undefined
              }
            >
              <QuotedMessagePreview
                snapshot={message.reply_to_snapshot}
                isOwnBubble={isOwnMessage}
                onPress={() => handleReplyPreviewPress(message.reply_to_snapshot!.message_id)}
                isLoading={resolvingReplyJumpId === message.reply_to_snapshot.message_id}
              />
            </View>
          )}
          {message.type === 'video' || message.video_metadata ? (
            // Video message
            (() => {
              const thumbnailUri = message.video_metadata?.thumbnail_url || message._localPreviewUri || '';
              // Prefer the compressed URL when ready; otherwise play the original
              // so the receiver can watch instantly while MediaConvert processes.
              const playableUrl = message.video_metadata?.video_url || message.video_metadata?.original_url || '';
              const rawAspectRatio = message.video_metadata?.width && message.video_metadata?.height
                ? message.video_metadata.width / message.video_metadata.height : 16 / 9;
              // Clamp portrait videos at 3:4 so the bubble doesn't dominate the screen.
              // Thumbnail uses resizeMode="cover" so the visible frame just crops cleanly.
              const aspectRatio = Math.max(rawAspectRatio, 1);
              const isUploading = message.upload_state === 'uploading';
              const isFailed = message.upload_state === 'failed';

              return (
                <View style={styles.imageMessageWrapper}>
                  <TouchableOpacity
                    activeOpacity={0.9}
                    onPress={() => {
                      if (playableUrl) {
                        setFullscreenVideoUrl(playableUrl);
                      }
                    }}
                    disabled={!playableUrl || isUploading || isFailed}
                    style={styles.imageTouchable}
                  >
                    {thumbnailUri ? (
                      <Image
                        source={{ uri: thumbnailUri }}
                        style={[
                          styles.messageImage,
                          { aspectRatio: aspectRatio && isFinite(aspectRatio) ? aspectRatio : 16 / 9 },
                        ]}
                        resizeMode="cover"
                      />
                    ) : (
                      <View style={[styles.messageImage, { aspectRatio: 16 / 9, backgroundColor: '#1a1a1a' }]} />
                    )}
                    {/* Play button overlay */}
                    {playableUrl && !isUploading && !isFailed ? (
                      <View style={styles.videoPlayOverlay}>
                        <Ionicons name="play-circle" size={48} color="rgba(255,255,255,0.9)" />
                      </View>
                    ) : isFailed ? (
                      <View style={styles.failedOverlay}>
                        <Ionicons name="alert-circle" size={24} color="#FFFFFF" />
                        <Text style={styles.failedText}>Failed to send</Text>
                      </View>
                    ) : (
                      <View style={styles.uploadOverlay}>
                        <ActivityIndicator size="large" color="#FFFFFF" />
                        <Text style={styles.uploadProgressText}>Uploading...</Text>
                      </View>
                    )}
                    {/* Timestamp overlay */}
                    <Reanimated.View
                      style={[styles.imageTimestampOverlay, { flexDirection: 'row', alignItems: 'center' }]}
                      layout={LinearTransition.duration(240)}
                    >
                      <Text style={styles.imageTimestamp}>
                        {formatTime(message.created_at)}
                      </Text>
                      {isOwnMessage && !message.deleted && (
                        <ReadReceipt state={getReceiptState(message, otherUserLastReadAt)} onDark enabled={isDirect} />
                      )}
                    </Reanimated.View>
                  </TouchableOpacity>
                  {message.body && (
                    <Text style={[
                      styles.imageCaption,
                      isOwnMessage ? styles.userMessageText : styles.botMessageText,
                      !isOwnMessage && otherUserAdvRole === 'adv_giver' && styles.botMessageTextGiveAdv,
                      !isOwnMessage && otherUserAdvRole === 'adv_seeker' && styles.botMessageTextGetAdv,
                      { textAlign: bodyTextAlign },
                    ]}>
                      {message.body}
                    </Text>
                  )}
                </View>
              );
            })()
          ) : message.type === 'image' || message.image_metadata ? (
            // Image message - redesigned layout
            (() => {
              const fullImageUri = message.image_metadata?.image_url
                || message._localPreviewUri
                || '';
              const thumbnailUri = message.image_metadata?.thumbnail_url || '';
              const imageWidth = message.image_metadata?.width || 1;
              const imageHeight = message.image_metadata?.height || 1;
              const aspectRatio = imageWidth > 0 && imageHeight > 0 ? imageWidth / imageHeight : 1;

              if (!fullImageUri) {
                console.warn('[DirectMessageScreen] ⚠️ Image message has no URL:', {
                  id: message.id,
                  type: message.type,
                  imageMetadata: message.image_metadata,
                });
              }



              return (
                <View style={styles.imageMessageWrapper}>
                  <TouchableOpacity
                    activeOpacity={0.9}
                    onPress={() => {
                      if (message.image_metadata?.image_url) {
                        setFullscreenImageUrl(message.image_metadata.image_url);
                        setFullscreenThumbnailUrl(message.image_metadata.thumbnail_url || null);
                      }
                    }}
                    disabled={message.upload_state === 'uploading' || message.upload_state === 'failed'}
                    style={styles.imageTouchable}
                  >
                    <ExpoImage
                      source={{ uri: fullImageUri }}
                      placeholder={thumbnailUri ? { uri: thumbnailUri } : undefined}
                      style={[
                        styles.messageImage,
                        {
                          aspectRatio: aspectRatio && aspectRatio > 0 && isFinite(aspectRatio) ? aspectRatio : 1,
                        }
                      ]}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                      transition={150}
                      onError={(error) => {
                        console.error('[DirectMessageScreen] ❌ Image load error:', {
                          messageId: message.id,
                          fullImageUri,
                          error,
                        });
                      }}

                    />
                    {message.upload_state === 'uploading' && (
                      <View style={styles.uploadOverlay}>
                        <ActivityIndicator size="large" color="#FFFFFF" />
                        {message.upload_progress !== undefined && (
                          <Text style={styles.uploadProgressText}>
                            {Math.round(message.upload_progress)}%
                          </Text>
                        )}
                      </View>
                    )}
                    {message.upload_state === 'failed' && (
                      <View style={styles.failedOverlay}>
                        <Ionicons name="alert-circle" size={24} color="#FFFFFF" />
                        <Text style={styles.failedText}>Failed to send</Text>
                        <TouchableOpacity
                          style={styles.retryButton}
                          onPress={() => handleRetryUpload(message)}
                        >
                          <Text style={styles.retryButtonText}>Retry</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                    {/* Timestamp overlay — only when there's no caption.
                        With a caption, the timestamp moves under the image
                        next to the caption text (text-message style). */}
                    {!message.body && (
                      <Reanimated.View
                        style={[styles.imageTimestampOverlay, { flexDirection: 'row', alignItems: 'center' }]}
                        layout={LinearTransition.duration(240)}
                      >
                        <Text style={styles.imageTimestamp}>
                          {formatTime(message.created_at)}
                        </Text>
                        {isOwnMessage && !message.deleted && (
                          <ReadReceipt state={getReceiptState(message, otherUserLastReadAt)} onDark enabled={isDirect} />
                        )}
                      </Reanimated.View>
                    )}
                  </TouchableOpacity>
                  {message.body && (
                    <Reanimated.View
                      style={
                        isRtl
                          ? {
                              flexDirection: 'column',
                              alignItems: 'flex-end',
                              paddingTop: 8,
                              paddingHorizontal: 10,
                              paddingBottom: 8,
                            }
                          : {
                              flexDirection: 'row',
                              // alignItems: flex-end keeps the timestamp at
                              // the bottom-right corner even when the caption
                              // wraps to multiple lines.
                              alignItems: 'flex-end',
                              // Restores the vertical/horizontal breathing
                              // room that imageMessageBubble strips
                              // (paddings: 0) so the image can hit the bubble
                              // edges. Without this the caption row hugs the
                              // bubble and the bubble feels too short.
                              paddingTop: 8,
                              paddingHorizontal: 10,
                              paddingBottom: 8,
                            }
                      }
                      layout={LinearTransition.duration(240)}
                    >
                      {/* flex: 1 lets the caption fill the row and wrap on
                          the left; the timestamp locks to the bottom-right.
                          For RTL we drop the flex (column stack) so the
                          caption sizes to its content. */}
                      <Text style={[
                        isRtl ? null : { flex: 1 },
                        isOwnMessage ? styles.userMessageText : styles.botMessageText,
                        !isOwnMessage && otherUserAdvRole === 'adv_giver' && styles.botMessageTextGiveAdv,
                        !isOwnMessage && otherUserAdvRole === 'adv_seeker' && styles.botMessageTextGetAdv,
                        { textAlign: bodyTextAlign },
                      ]}>
                        {renderMessageBodyWithLinks(message.body || '')}
                      </Text>
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          marginLeft: isRtl ? 0 : 18,
                          marginTop: isRtl ? 2 : 0,
                          marginBottom: -2,
                        }}
                      >
                        <Text style={[
                          styles.timestamp,
                          isOwnMessage ? styles.userTimestamp : styles.botTimestamp,
                        ]}>
                          {formatTime(message.created_at)}
                        </Text>
                        {isOwnMessage && !message.deleted && (
                          <ReadReceipt state={getReceiptState(message, otherUserLastReadAt)} enabled={isDirect} />
                        )}
                      </View>
                    </Reanimated.View>
                  )}
                </View>
              );
            })()
          ) : (
            // Text message
            <>
              <View style={[
                styles.messageTextContainer,
                // Allow full width for deleted messages from other user
                message.deleted && !isOwnMessage && styles.deletedMessageTextContainer,
              ]}>
                {isEditing ? (
                  <View style={styles.editContainer}>
                    <PaperTextInput
                      value={editingText}
                      onChangeText={setEditingText}
                      multiline
                      style={styles.editInput}
                      autoFocus
                    />
                    <View style={styles.editActions}>
                      <TouchableOpacity
                        onPress={() => {
                          setEditingMessageId(null);
                          setEditingText('');
                        }}
                        style={styles.editButton}
                      >
                        <Text style={styles.editButtonText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleEditMessage(message.id, editingText)}
                        style={[styles.editButton, styles.editButtonSave]}
                      >
                        <Text style={[styles.editButtonText, styles.editButtonTextSave]}>Save</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : message.deleted ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <View style={{ opacity: 0.6 }}>
                      <Svg height={16} viewBox="0 -960 960 960" width={16} fill={colors.textDark}>
                        <Path d="M324-111.5Q251-143 197-197t-85.5-127Q80-397 80-480t31.5-156Q143-709 197-763t127-85.5Q397-880 480-880t156 31.5Q709-817 763-763t85.5 127Q880-563 880-480t-31.5 156Q817-251 763-197t-127 85.5Q563-80 480-80t-156-31.5ZM480-160q54 0 104-17.5t92-50.5L228-676q-33 42-50.5 92T160-480q0 134 93 227t227 93Zm252-124q33-42 50.5-92T800-480q0-134-93-227t-227-93q-54 0-104 17.5T284-732l448 448ZM480-480Z" />
                      </Svg>
                    </View>
                    <Text style={[
                      isOwnMessage ? styles.userMessageText : styles.botMessageText,
                      styles.deletedMessageText,
                    ]}>
                      {isOwnMessage 
                        ? 'You deleted this message'
                        : `${message.sender_name || message.sender?.name || otherUserName || 'Someone'} deleted this message`
                      }
                    </Text>
                  </View>
                ) : isRtl ? (
                  // RTL bodies stack vertically (timestamp below body).
                  <Reanimated.View
                    style={{
                      flexDirection: 'column',
                      alignItems: 'flex-end',
                    }}
                    layout={LinearTransition.duration(240)}
                  >
                    <Text style={[
                      isOwnMessage ? styles.userMessageText : styles.botMessageText,
                      !isOwnMessage && otherUserAdvRole === 'adv_giver' && styles.botMessageTextGiveAdv,
                      !isOwnMessage && otherUserAdvRole === 'adv_seeker' && styles.botMessageTextGetAdv,
                      { textAlign: bodyTextAlign },
                    ]}>
                      {renderMessageBodyWithLinks(message.body || '')}
                    </Text>
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        marginTop: 2,
                        marginBottom: -2,
                      }}
                    >
                      <Text style={[
                        styles.timestamp,
                        isOwnMessage ? styles.userTimestamp : styles.botTimestamp,
                      ]}>
                        {formatTime(message.created_at)}
                        {message.edited && !message.deleted && (
                          <Text style={styles.editedBadge}>  (edited)</Text>
                        )}
                      </Text>
                      {isOwnMessage && (
                        <ReadReceipt state={getReceiptState(message, otherUserLastReadAt)} enabled={isDirect} />
                      )}
                    </View>
                  </Reanimated.View>
                ) : (
                  // LTR: WhatsApp-style inline-timestamp layout.
                  // The body Text contains the message + an invisible inline
                  // spacer whose width ≈ the timestamp's width. Result:
                  //  - Short msg: body + spacer fit on one line; bubble
                  //    shrinks; timestamp (absolutely positioned at bottom-
                  //    right) sits inline at the right of the body.
                  //  - Body grows on that line until bubble hits its
                  //    max-width, then text wraps. Wrapped overflow goes to
                  //    new lines ABOVE; the bottom line keeps the spacer +
                  //    visible timestamp anchored at bottom-right.
                  //  - Subsequent wraps add lines above as needed; the
                  //    bottom line's wrap point is `bubble width − spacer`,
                  //    so the visible last line of text never crosses into
                  //    the timestamp's column.
                  <Reanimated.View
                    style={{ position: 'relative' }}
                    layout={LinearTransition.duration(240)}
                  >
                    <Text style={[
                      isOwnMessage ? styles.userMessageText : styles.botMessageText,
                      !isOwnMessage && otherUserAdvRole === 'adv_giver' && styles.botMessageTextGiveAdv,
                      !isOwnMessage && otherUserAdvRole === 'adv_seeker' && styles.botMessageTextGetAdv,
                      { textAlign: bodyTextAlign },
                    ]}>
                      {renderMessageBodyWithLinks(message.body || '')}
                      {/* Invisible spacer rendered at the timestamp's font
                          size so its inline width matches the real
                          timestamp pixel-for-pixel. Mirrors:
                          - leading "  " gap
                          - the formatted time text
                          - "  (edited)" if the badge is shown
                          - 4 figure-spaces approximating the double-tick
                          The real timestamp is absolutely overlaid on top
                          (see <View> below). This is the RN-equivalent of
                          Telegram's float-right .MessageMeta technique. */}
                      <Text style={[
                        styles.timestamp,
                        isOwnMessage ? styles.userTimestamp : styles.botTimestamp,
                        { color: 'transparent' },
                      ]}>
                        {`  ${formatTime(message.created_at)}${message.edited && !message.deleted ? '  (edited)' : ''}${isOwnMessage ? '    ' : ''}`}
                      </Text>
                    </Text>
                    <View
                      style={{
                        position: 'absolute',
                        // Negative bottom pulls the timestamp + ticks a few
                        // pixels lower than the spacer's line box, so they
                        // sit closer to the bubble's bottom edge.
                        bottom: -3,
                        right: 0,
                        flexDirection: 'row',
                        alignItems: 'center',
                      }}
                    >
                      <Text style={[
                        styles.timestamp,
                        isOwnMessage ? styles.userTimestamp : styles.botTimestamp,
                      ]}>
                        {formatTime(message.created_at)}
                        {message.edited && !message.deleted && (
                          <Text style={styles.editedBadge}>  (edited)</Text>
                        )}
                      </Text>
                      {isOwnMessage && (
                        <ReadReceipt state={getReceiptState(message, otherUserLastReadAt)} enabled={isDirect} />
                      )}
                    </View>
                  </Reanimated.View>
                )}
              </View>

              {/* Timestamp row for editing / deleted states only — active text
                  messages render the timestamp inline inside the flex-wrap row
                  above. */}
              {(isEditing || message.deleted) && (
                isOwnMessage ? (
                  <Reanimated.View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      alignSelf: 'flex-end',
                      marginTop: 2,
                    }}
                    layout={LinearTransition.duration(240)}
                  >
                    <Text style={[styles.timestamp, styles.userTimestamp]}>
                      {formatTime(message.created_at)}
                      {message.edited && !message.deleted && (
                        <Text style={styles.editedBadge}>  (edited)</Text>
                      )}
                    </Text>
                    {!message.deleted && !isEditing && (
                      <ReadReceipt state={getReceiptState(message, otherUserLastReadAt)} enabled={isDirect} />
                    )}
                  </Reanimated.View>
                ) : (
                  <View style={[styles.timestampContainer, styles.botTimestampContainer]}>
                    <Text style={[styles.timestamp, styles.botTimestamp]}>
                      {formatTime(message.created_at)}
                      {message.edited && !message.deleted && (
                        <Text style={styles.editedBadge}>  (edited)</Text>
                      )}
                    </Text>
                  </View>
                )
              )}
              {message.upload_state === 'uploading' && !message.deleted && !isEditing && isOwnMessage && (
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2, alignSelf: 'flex-end', gap: 4 }}>
                  <ActivityIndicator size="small" color="#E53935" />
                  <Text style={{ fontSize: 12, color: '#E53935' }}>Sending…</Text>
                </View>
              )}
              {message.upload_state === 'failed' && !message.deleted && !isEditing && isOwnMessage && (
                <TouchableOpacity
                  onPress={() => handleRetryTextMessage(message)}
                  style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2, alignSelf: 'flex-end', gap: 4 }}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Ionicons name="alert-circle" size={14} color="#E53935" />
                  <Text style={{ fontSize: 12, color: '#E53935' }}>Tap to retry</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </MessageBubbleHighlight>
      </TouchableOpacity>
    );
  };

  if (showReportUser) {
    return (
      <ReportUserScreen
        reportedUserId={otherUserId}
        reportedUserName={otherUserName}
        onBack={() => setShowReportUser(false)}
        onReturnHome={() => {
          setShowReportUser(false);
          onBack();
        }}
        onBlocked={() => {
          setShowReportUser(false);
          onBack();
        }}
      />
    );
  }

  return (
    <>
    <SafeAreaView style={[styles.container, { backgroundColor: '#212121' }]} edges={['top']}>
      {/* Header */}
      <View style={styles.headerContainer}>
        <View style={styles.headerGradientBorder} />
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={onBack}
              hitSlop={{ top: 30, bottom: 30, left: 30, right: 12 }}
            >
              <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
            </TouchableOpacity>
            
            <TouchableOpacity
              style={styles.avatar}
              onPress={() => {
                if (isDirect) {
                  if (onViewProfile) onViewProfile(otherUserId);
                } else if (tripId && onOpenTripDetail) {
                  onOpenTripDetail(tripId);
                }
              }}
              activeOpacity={(isDirect || (tripId && onOpenTripDetail)) ? 0.7 : 1}
            >
              {isDirect ? (
                <ProfileImage
                  imageUrl={otherUserAvatar}
                  name={otherUserName}
                  style={styles.avatarImage}
                  showLoadingIndicator={false}
                  advRole={otherUserAdvRole}
                />
              ) : (
                <View style={[styles.avatarImage, styles.groupAvatar]}>
                  <Ionicons name="people" size={22} color="#FFFFFF" />
                </View>
              )}
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.profileInfo}
            onPress={() => {
              if (isDirect) {
                if (onViewProfile) onViewProfile(otherUserId);
              } else if (tripId && onOpenTripDetail) {
                onOpenTripDetail(tripId);
              }
            }}
            activeOpacity={(isDirect || (tripId && onOpenTripDetail)) ? 0.7 : 1}
          >
            <Reanimated.View
              style={styles.profileInfoInner}
              layout={LinearTransition.duration(240)}
            >
              <Reanimated.Text
                style={styles.profileName}
                layout={LinearTransition.duration(240)}
                numberOfLines={1}
              >
                {otherUserName}
              </Reanimated.Text>
              {onlineStatusElement}
            </Reanimated.View>
          </TouchableOpacity>
          
          
        </View>
      </View>

      {/* DM menu dropdown - rendered outside header to avoid overflow clipping */}
      {showDmMenu && (
        <View style={styles.dmMenuDropdown}>
          <TouchableOpacity style={styles.dmMenuItem} activeOpacity={0.7} onPress={() => { setShowDmMenu(false); setShowReportUser(true); }}>
            <Ionicons name="alert-circle-outline" size={20} color="#222B30" />
            <Text style={styles.dmMenuItemText}>Report</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.dmMenuItem} activeOpacity={0.7} onPress={() => { setShowDmMenu(false); setShowBlockOverlay(true); }}>
            <Ionicons name="ban-outline" size={20} color="#222B30" />
            <Text style={styles.dmMenuItemText}>Block</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Dismiss menu on tap outside */}
      {showDmMenu && (
        <TouchableOpacity style={[StyleSheet.absoluteFill, { zIndex: 9998 }]} activeOpacity={1} onPress={() => setShowDmMenu(false)} />
      )}

      {/* Chat Messages */}
      {(() => {
        // The chat area (messages + composer) is wrapped in a Reanimated.View
        // whose paddingBottom tracks keyboard height (via useReanimatedKeyboardAnimation).
        // This is a manual behavior='padding' that avoids measureLayout — so it
        // works correctly even nested inside react-native-screen-transitions'
        // transformed ContentLayer, where the normal KAV fails.
        const useGestureArea = !isExpoGo && KeyboardGestureArea != null;
        // Pairing nativeID + textInputNativeID extends the gesture-sensitive
        // zone up to include the composer, so a drag starting inside the
        // composer area moves the keyboard 1:1 with the finger (WhatsApp
        // feel). Without this the gesture only fires when the touch is
        // already over the keyboard, which makes it feel under-traveled.
        const composerNativeID = 'dm-composer-input';

        const messageList = (
          <Reanimated.FlatList
            ref={flatListRef as any}
            data={invertedMessages}
            extraData={otherUserLastReadAt}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            inverted
            // No itemLayoutAnimation: it also fires when the FlatList's parent
            // shifts due to the keyboard's animated paddingBottom, which causes
            // cells to overshoot/bounce as Reanimated tries to animate them to
            // their new absolute position while the keyboard is independently
            // moving them. New messages still slide up via their `entering`
            // animation; older messages reposition instantly (WhatsApp behavior).
            style={styles.messagesList}
            contentContainerStyle={[
              styles.messagesContent,
              { flexGrow: 1, justifyContent: 'flex-end' },
            ]}
            showsVerticalScrollIndicator={false}
            automaticallyAdjustContentInsets={false}
            contentInsetAdjustmentBehavior="never"
            onScroll={(event) => {
              handleKeyboardScroll(event);
              const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
              const maxOffset = contentSize.height - layoutMeasurement.height;
              const distanceFromTop = maxOffset - contentOffset.y;
              if (distanceFromTop < 200 && hasMoreMessagesRef.current && !isLoadingOlderRef.current) {
                loadOlderMessages();
              }
            }}
            scrollEventThrottle={16}
            onLayout={handleLayout}
            initialNumToRender={50}
            maxToRenderPerBatch={50}
            windowSize={21}
            ListHeaderComponent={listHeaderComponent}
            ListFooterComponent={listFooterComponent}
            ListEmptyComponent={listEmptyComponent}
            keyboardShouldPersistTaps="handled"
            onScrollToIndexFailed={(info) => {
              setTimeout(() => {
                flatListRef.current?.scrollToIndex({
                  index: info.index,
                  viewPosition: 0.5,
                  animated: true,
                });
              }, 200);
            }}
            keyboardDismissMode={
              // iOS handles interactive dismiss natively. On Android, KeyboardGestureArea
              // tracks the drag and the FlatList's "interactive" dismissMode reports it
              // to the keyboard — both are needed for the WhatsApp/Instagram feel where
              // the keyboard follows the finger down. Fallback to "on-drag" on Android <
              // 11 / Expo Go, where KeyboardGestureArea is a no-op fragment.
              useGestureArea ? 'interactive' : Platform.OS === 'ios' ? 'interactive' : 'on-drag'
            }
          />
        );

        const composer = (
          <Reanimated.View style={animatedComposerPadding}>
            {/* Measure just the inner composer (reply banner + input bar),
                NOT the animated keyboard padding above. Otherwise the offset
                changes while the keyboard is sliding, which creates a feedback
                loop and the jumping-up-and-down feel. */}
            <View
              onLayout={(e) => {
                // 2px tolerance — sub-pixel layout deltas were causing stray
                // re-renders that propagated into KeyboardGestureArea's offset
                // and could nudge the composer mid-keyboard-animation.
                const h = Math.round(e.nativeEvent.layout.height);
                if (Math.abs(h - composerHeight) >= 2) setComposerHeight(h);
              }}
            >
            {replyingTo && (
              <ReplyPreviewBanner
                message={replyingTo}
                currentUserId={currentUserId}
                otherUserName={otherUserName}
                onCancel={() => setReplyingTo(null)}
              />
            )}
            <View style={styles.inputWrapper}>
              <ChatTextInput
                ref={chatInputRef}
                nativeID={composerNativeID}
                value={inputText}
                onChangeText={setInputText}
                onSend={sendMessage}
                disabled={isLoading}
                placeholder="Type your message.."
                maxLength={500}
                // Send button tracks the other user's advice-role bubble color so
                // the composer feels "themed" per chat: teal for seekers, beige
                // for givers, Swelly purple (same as Swelly chat user bubbles) otherwise.
                primaryColor={composerPrimaryColor}
                leftAccessory={
                  <TouchableOpacity
                    style={styles.attachButton}
                    onPress={handleImagePicker}
                    hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
                  >
                    <Ionicons name="add" size={28} color="#222B30" />
                  </TouchableOpacity>
                }
              />
            </View>
            </View>
          </Reanimated.View>
        );

        const inner = (
          <View style={{ flex: 1 }}>
            <ImageBackground
              source={Images.chatBackground}
              style={[styles.backgroundImage, { pointerEvents: 'none' }]}
              resizeMode="cover"
            />
            <Reanimated.View style={[{ flex: 1 }, animatedKeyboardPadding]}>
              {messageList}
              {composer}
            </Reanimated.View>
          </View>
        );

        return (
          <View style={styles.chatContainer}>
            {useGestureArea ? (
              <KeyboardGestureArea
                interpolator="linear"
                textInputNativeID={composerNativeID}
                offset={composerHeight}
                style={{ flex: 1 }}
              >
                {inner}
              </KeyboardGestureArea>
            ) : (
              inner
            )}
          </View>
        );
      })()}

      {/* Message Actions Menu */}
      <MessageActionsMenu
        visible={menuVisible}
        onClose={() => {
          setMenuVisible(false);
          setSelectedMessage(null);
        }}
        onEdit={() => {
          if (selectedMessage && canEditMessage(selectedMessage)) {
            setEditingMessageId(selectedMessage.id);
            setEditingText(selectedMessage.body || '');
          }
        }}
        onDelete={() => {
          console.log('[DirectMessageScreen] onDelete callback called', {
            selectedMessage: selectedMessage ? {
              id: selectedMessage.id,
              body: selectedMessage.body?.substring(0, 30),
            } : null,
          });
          if (selectedMessage) {
            console.log('[DirectMessageScreen] Calling handleDeleteMessage', {
              messageId: selectedMessage.id,
            });
            handleDeleteMessage(selectedMessage.id);
          } else {
            console.error('[DirectMessageScreen] No selected message to delete');
          }
        }}
        onCopy={() => {
          if (selectedMessage) {
            handleCopyMessageText(selectedMessage);
          }
        }}
        onReply={() => {
          if (selectedMessage) {
            setReplyingTo(selectedMessage);
            // Focus the input so the keyboard comes up right away.
            chatInputRef.current?.focus?.();
          }
        }}
        canReply={(() => {
          if (!selectedMessage) return false;
          if (selectedMessage.deleted || selectedMessage.is_system) return false;
          if (selectedMessage.upload_state === 'failed') return false;
          return true;
        })()}
        canCopy={!!selectedMessage?.body && selectedMessage.body.trim().length > 0}
        canEdit={selectedMessage ? canEditMessage(selectedMessage) : false}
        canDelete={(() => {
          // Only calculate when menu is visible and message is selected
          if (!menuVisible || !selectedMessage) {
            return false;
          }
          const canDelete = canDeleteMessage(selectedMessage);
          console.log('[DirectMessageScreen] MessageActionsMenu canDelete prop', {
            hasSelectedMessage: !!selectedMessage,
            canDelete,
            menuVisible,
            selectedMessageId: selectedMessage?.id,
            currentUserId,
            messageSenderId: selectedMessage.sender_id,
          });
          return canDelete;
        })()}
        messagePosition={menuPosition}
      />

      {/* Delete Confirmation Modal (Web only) */}
      {Platform.OS === 'web' && (
        <Modal
          visible={deleteConfirmVisible}
          transparent
          animationType="fade"
          onRequestClose={() => {
            setDeleteConfirmVisible(false);
            setPendingDeleteMessageId(null);
          }}
        >
          <TouchableOpacity
            style={styles.deleteModalOverlay}
            activeOpacity={1}
            onPress={() => {
              setDeleteConfirmVisible(false);
              setPendingDeleteMessageId(null);
            }}
          >
            <TouchableOpacity
              activeOpacity={1}
              onPress={(e) => {
                // Prevent overlay from closing when clicking inside modal
                if (e && typeof e.stopPropagation === 'function') {
                  e.stopPropagation();
                }
              }}
              style={styles.deleteModalContent}
            >
              <Text style={styles.deleteModalTitle}>Delete Message</Text>
              <Text style={styles.deleteModalMessage}>
                Are you sure you want to delete this message?
              </Text>
              <View style={styles.deleteModalButtons}>
                <TouchableOpacity
                  style={[styles.deleteModalButton, styles.deleteModalButtonCancel]}
                  onPress={() => {
                    console.log('[DirectMessageScreen] Delete cancelled by user (web modal)');
                    setDeleteConfirmVisible(false);
                    setPendingDeleteMessageId(null);
                  }}
                >
                  <Text style={styles.deleteModalButtonCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.deleteModalButton, styles.deleteModalButtonDelete]}
                  onPress={async () => {
                    console.log('[DirectMessageScreen] Delete confirmed (web modal)');
                    const messageId = pendingDeleteMessageId;
                    setDeleteConfirmVisible(false);
                    setPendingDeleteMessageId(null);
                    if (messageId) {
                      await performDelete(messageId);
                    }
                  }}
                >
                  <Text style={styles.deleteModalButtonDeleteText}>Delete</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      )}

      {/* Fullscreen Image Viewer */}
      <FullscreenImageViewer
        visible={!!fullscreenImageUrl}
        imageUrl={fullscreenImageUrl || ''}
        thumbnailUrl={fullscreenThumbnailUrl || undefined}
        onClose={() => {
          setFullscreenImageUrl(null);
          setFullscreenThumbnailUrl(null);
        }}
      />

      <FullscreenVideoPlayer
        visible={!!fullscreenVideoUrl}
        videoUrl={fullscreenVideoUrl || ''}
        onClose={() => setFullscreenVideoUrl(null)}
      />

      {/* Image Preview Modal */}
      {selectedImageUri && (
        <ImagePreviewModal
          visible={imagePreviewVisible}
          imageUri={selectedImageUri}
          onSend={handleImageSend}
          onCancel={() => {
            selectedImageUriForUploadRef.current = null;
            selectedImageDimensionsRef.current = { width: 0, height: 0 };
            setImagePreviewVisible(false);
            setSelectedImageUri(null);
            setIsProcessingImage(false);
          }}
          // The cropper module is native-only. On web / Expo Go we leave
          // onEdit undefined so the modal hides the Edit button.
          onEdit={Platform.OS !== 'web' && getImageCropPicker() ? handleEditImage : undefined}
          isProcessing={isProcessingImage}
          primaryColor={composerPrimaryColor}
        />
      )}

      {/* Video Preview Modal — video + caption + send; trim button in the
          top-right (only visible when the native video-trim module is available). */}
      {selectedVideoUri && (
        <VideoPreviewModal
          visible={videoPreviewVisible}
          videoUri={selectedVideoUri}
          onSend={handleVideoSend}
          onCancel={() => {
            setVideoPreviewVisible(false);
            setSelectedVideoUri(null);
            selectedVideoMetadataRef.current = null;
            setIsProcessingVideo(false);
          }}
          isProcessing={isProcessingVideo}
          primaryColor={composerPrimaryColor}
        />
      )}
      <BlockUserOverlay
        visible={showBlockOverlay}
        userId={otherUserId}
        userName={otherUserName}
        onClose={() => setShowBlockOverlay(false)}
        onBlocked={() => {
          setShowBlockOverlay(false);
          onBack();
        }}
      />
    </SafeAreaView>
    {Platform.OS !== 'web' && (
      <GalleryPermissionOverlay
        visible={showPermissionOverlay}
        onAllow={async () => {
          await AsyncStorage.setItem('@swellyo_gallery_primer_shown', 'true');
          setShowPermissionOverlay(false);
          pendingPickerRef.current?.();
          pendingPickerRef.current = null;
        }}
        onDismiss={() => {
          setShowPermissionOverlay(false);
          pendingPickerRef.current = null;
        }}
      />
    )}
    </>
  );
};

// Match the bubble max-width to the composer's text-wrapping width so a
// paragraph typed in the input bar wraps at exactly the same line breaks
// when rendered as a message. Math: screenWidth
//   − 16 (inputWrapper paddingHorizontal × 2)
//   − 36 (attach button: 28 icon + 8 marginRight)
//   − 18 (messageInputContainer paddingLeft 10 + paddingRight 8)
//   − 40 (send button 32 + marginLeft 8)
//   − 8  (inputContainer paddingRight)
//   − 8  (TextInput paddingLeft)
//   = screenWidth − 126 → composer text-wrap width.
// Bubble has paddingHorizontal 10 × 2 = 20, so bubble max-width
//   = (screenWidth − 126) + 20 = screenWidth − 106.
const MESSAGE_BUBBLE_MAX_WIDTH = Dimensions.get('window').width - 106;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  headerContainer: {
    backgroundColor: '#212121',
    paddingTop: Platform.OS === 'web' ? 24 : 12,
    paddingBottom: 14,
    paddingHorizontal: 0,
    alignItems: 'center',
    position: 'relative',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: spacing.md,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  backButton: {
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    // overflow: 'hidden', // Keep hidden to maintain circular shape
    // backgroundColor: '#D3D3D3', // Fallback background
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 26,
    ...(Platform.OS === 'web' && {
      objectFit: 'cover' as any,
    }),
  },
  groupAvatar: {
    backgroundColor: '#5E6B73',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarPlaceholder: {
    backgroundColor: '#D3D3D3',
    justifyContent: 'center',
    alignItems: 'center',
    width: 52,
    height: 52,
    borderRadius: 26,
  },
  avatarPlaceholderText: {
    color: colors.white,
    fontSize: 20,
    fontWeight: 'bold',
  },
  profileInfo: {
    flex: 1,
    width: 246,
    marginRight: spacing.sm,
    justifyContent: 'center',
  },
  profileInfoInner: {
    minHeight: 52,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  profileName: {
    fontSize: 20,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter-Bold',
    lineHeight: 28,
    color: '#FFFFFF',
    marginBottom: 2,
  },
  profileTagline: {
    fontSize: 14,
    fontWeight: '400',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    lineHeight: 20,
    color: '#A0A0A0',
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  onlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#4CAF50',
    marginRight: 6,
  },
  headerGradientBorder: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: '#05BCD3', // Teal/cyan color from Figma
  },
  menuButton: {
    width: 36,
    height: 36,
    borderRadius: 40,
    backgroundColor: '#333333',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dmMenuDropdown: {
    position: 'absolute',
    top: 92,
    right: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    minWidth: 180,
    shadowColor: '#596E7C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 999,
    zIndex: 9999,
    paddingVertical: 8,
  },
  dmMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 16,
    paddingRight: 12,
    paddingVertical: 12,
    gap: 10,
  },
  dmMenuItemText: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 14,
    fontWeight: '400' as const,
    color: '#222B30',
    lineHeight: 18,
    flex: 1,
  },
  dmMenuDivider: {
    height: 1,
    backgroundColor: '#E8E8E8',
    marginHorizontal: 0,
  },
  chatContainer: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  backgroundImage: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  messagesList: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  messagesContent: {
    paddingHorizontal: spacing.md,
    paddingTop: 0,
    paddingBottom: spacing.lg,
  },
  loadOlderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 8,
  },
  loadOlderText: {
    fontFamily: Platform.OS === 'web' ? 'var(--Family-Body, Inter), sans-serif' : 'Inter',
    fontSize: 13,
    fontWeight: '400',
    color: '#A0A0A0',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: '#7B7B7B',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainerWelcome: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 12,
  },
  emptyText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  messageContainer: {
    // marginBottom handled by userMessageContainer and botMessageContainer
  },
  userMessageContainer: {
    flexDirection: 'row',
    justifyContent: 'flex-end', // Received messages on RIGHT side
    alignItems: 'flex-end',
    paddingLeft: 48,
    paddingRight: 0,
    marginBottom: 0,
  },
  botMessageContainer: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingLeft: 0,
    paddingRight: 60,
    marginBottom: 0,
  },
  botMessageContainerDirect: {
    // For direct messages (no avatar), reduce right padding
    paddingRight: 16, // Keep same padding since we removed avatar
  },
  messageAvatarContainer: {
    marginRight: 8,
    marginBottom: 0,
  },
  messageAvatarSpacer: {
    width: 32,
    marginRight: 8,
  },
  groupSenderName: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 2,
    textAlign: 'left',
    alignSelf: 'flex-start',
  },
  groupSenderNameTouchable: {
    alignSelf: 'flex-start',
  },
  messageAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  messageAvatarPlaceholder: {
    backgroundColor: '#D3D3D3',
    justifyContent: 'center',
    alignItems: 'center',
  },
  messageAvatarPlaceholderText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: 'bold',
  },
  messageBubble: {
    maxWidth: MESSAGE_BUBBLE_MAX_WIDTH,
    flexDirection: 'column',
  },
  userMessageBubble: {
    maxWidth: MESSAGE_BUBBLE_MAX_WIDTH,
    paddingTop: 8,
    paddingRight: 10,
    paddingBottom: 8,
    paddingLeft: 10,
    flexDirection: 'column',
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
    backgroundColor: '#FFFFFF', // White background for outbound messages
    
    borderTopLeftRadius: 16, // 16px 2px 16px 16px
    borderTopRightRadius: 2,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    ...(Platform.OS === 'web' && {
      boxShadow: '0px 0px 20px rgba(0, 0, 0, 0.08)',
    }),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 5,
  },
  botMessageBubble: {
    backgroundColor: colors.white, // Default, will be overridden by adv_role styles
    paddingTop: 8,
    paddingHorizontal: 10,
    paddingBottom: 8,
    flexDirection: 'column',
    justifyContent: 'flex-end',
    alignItems: 'flex-start', // Changed from flex-end to flex-start for proper alignment
    borderTopLeftRadius: 16, // 16px 16px 2px 16px (pointy corner at bottom left)
    borderTopRightRadius: 16,
    borderBottomLeftRadius: 2, // Pointy corner at bottom left
    borderBottomRightRadius: 16,
    ...(Platform.OS === 'web' && {
      boxShadow: '0px 0px 20px rgba(0, 0, 0, 0.08)',
    }),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 5,
  },
  // Image message bubble - no padding, image touches edges
  imageMessageBubble: {
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    paddingHorizontal: 0,
    overflow: 'hidden', // Ensure image respects border radius
  },
  quotedPreviewMediaWrap: {
    paddingHorizontal: 6,
    paddingTop: 6,
  },
  botMessageBubbleGiveAdv: {
    backgroundColor: '#DBCDBC', // adv_giver color
  },
  botMessageBubbleGetAdv: {
    backgroundColor: '#05BCD3', // adv_seeker color
  },
  messageTextContainer: {
    marginBottom: 0, // Gap is now handled by the flex-wrap body+timestamp row.
    width: '100%',
  },
  userMessageText: {
    color: '#333333', // Dark text on white background for outbound messages
    fontSize: 17,
    fontWeight: '400',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    lineHeight: 22,
  },
  botMessageText: {
    color: '#333333',
    fontSize: 17,
    fontWeight: '400',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    lineHeight: 22,
  },
  botMessageTextGiveAdv: {
    color: '#333333', // Dark text on #DBCDBC (beige) background for adv_giver
  },
  botMessageTextGetAdv: {
    color: '#FFFFFF', // White text on #05BCD3 (teal) background for adv_seeker
  },
  timestampContainer: {
    alignItems: 'flex-start', // Default, will be overridden for user messages
    width: '100%',
  },
  userTimestampContainer: {
    alignItems: 'flex-start', // Align timestamp to left for outbound messages (on left side)
  },
  botTimestampContainer: {
    alignItems: 'flex-end', // Align timestamp to right for received messages (on right side)
    marginTop: 2, // Match sent-message vertical spacing
  },
  timestamp: {
    fontSize: 13,
    fontWeight: '300',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    // Tighter lineHeight pulls the timestamp visually closer to the bubble's
    // bottom edge — at 20 the line box reserved extra space above/below.
    lineHeight: 15,
  },
  userTimestamp: {
    color: 'rgba(60, 60, 60, 0.75)', // Darker timestamp for better contrast on outbound (brown) bubbles
  },
  botTimestamp: {
    color: 'rgba(60, 60, 60, 0.75)', // Match userTimestamp so sent/received times share the same styling
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 8,
   // paddingBottom: Platform.OS === 'android' ? 50 : 35,
    paddingTop: 10,
  },
  attachButtonWrapper: {
    paddingBottom: 15,
    marginRight: 8,
  },
  attachButton: {
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  typingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
  },
  typingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#333333',
  },
  editContainer: {
    width: '100%',
  },
  editInput: {
    backgroundColor: 'transparent',
    padding: 0,
    margin: 0,
    fontSize: 16,
    minHeight: 40,
  },
  editActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  editButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 8,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.textSecondary,
  },
  editButtonSave: {
    backgroundColor: colors.primary || '#B72DF2',
    borderColor: colors.primary || '#B72DF2',
  },
  editButtonText: {
    fontSize: 14,
    color: colors.textDark,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
  },
  editButtonTextSave: {
    color: colors.white,
  },
  editedBadge: {
    fontSize: 12,
    color: colors.textSecondary,
    fontStyle: 'italic',
    marginTop: 4,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
  },
  deletedMessageText: {
    fontStyle: 'italic',
    opacity: 0.6,
  },
  deletedMessageTextContainer: {
    width: '100%', // Ensure container can expand
    flexShrink: 0, // Prevent shrinking
    flexWrap: 'wrap', // Allow text to wrap naturally
  },
  // Image message styles - redesigned
  imageMessageWrapper: {
    width: '100%',
    position: 'relative',
    alignSelf: 'stretch',
  },
  imageTouchable: {
    width: '100%',
    position: 'relative',
    alignSelf: 'stretch',
  },
  messageImage: {
    width: '100%',
    minHeight: 200,
    maxHeight: 500,
    backgroundColor: colors.backgroundGray,
    // aspectRatio will be set dynamically from image metadata
  },
  imageTimestampOverlay: {
    position: 'absolute',
    bottom: 4,
    right: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  imageTimestamp: {
    fontSize: 13,
    fontWeight: '300',
    color: '#FFFFFF',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
  },
  videoPlayOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  uploadOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: borderRadius.medium,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xs,
  },
  uploadProgressText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '600',
  },
  failedOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderRadius: borderRadius.medium,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
  },
  failedText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '500',
  },
  retryButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.medium,
    marginTop: spacing.xs,
  },
  retryButtonText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '600',
  },
  imageCaption: {
    marginTop: 8,
    paddingHorizontal: 12,
    paddingBottom: 4,
    fontSize: 16,
    color: colors.textDark,
  },
  // Delete Confirmation Modal Styles (Web)
  deleteModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteModalContent: {
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: spacing.lg,
    minWidth: 300,
    maxWidth: 400,
    ...(Platform.OS === 'web' && {
      boxShadow: '0px 4px 12px rgba(0, 0, 0, 0.15)',
    }),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
  deleteModalTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.textDark,
    marginBottom: spacing.sm,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
  },
  deleteModalMessage: {
    fontSize: 16,
    color: colors.textDark,
    marginBottom: spacing.lg,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
  },
  deleteModalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  deleteModalButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.medium,
    minWidth: 80,
    alignItems: 'center',
  },
  deleteModalButtonCancel: {
    backgroundColor: colors.backgroundGray,
  },
  deleteModalButtonCancelText: {
    color: colors.textDark,
    fontSize: 16,
    fontWeight: '500',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
  },
  deleteModalButtonDelete: {
    backgroundColor: '#FF3B30',
  },
  deleteModalButtonDeleteText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '600',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
  },
});
