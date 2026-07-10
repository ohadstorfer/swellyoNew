import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Pressable,
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
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { Text } from '../components/Text';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GalleryPermissionOverlay } from '../components/GalleryPermissionOverlay';
import { colors, spacing, typography, borderRadius } from '../styles/theme';
import { messagingService, Message, RealtimeSubscriptionStatus, ReplyToSnapshot, MUTE_ALWAYS_UNTIL, getMuteUntilFromMember, FileMetadata, ContactMetadata } from '../services/messaging/messagingService';
import { AttachPanel } from '../components/AttachPanel';
import { useAttachPanel } from '../hooks/useAttachPanel';
import { FileBubble } from '../components/messages/FileBubble';
import { ContactBubble } from '../components/messages/ContactBubble';
import { capMessages, MAX_IN_MEMORY_MESSAGES } from '../services/messaging/messageWindow';
import { supabaseAuthService } from '../services/auth/supabaseAuthService';
import { getImageUrl, getStorageThumbUrl } from '../services/media/imageService';
import { Images } from '../assets/images';
import { supabase } from '../config/supabase';
import { ProfileImage } from '../components/ProfileImage';
import { analyticsService } from '../services/analytics/analyticsService';
import { chatHistoryCache } from '../services/messaging/chatHistoryCache';
import { messageOutbox } from '../services/messaging/messageOutbox';
import { loadCachedConversationList, saveCachedConversationList } from '../services/messaging/conversationListCache';
import * as Crypto from 'expo-crypto';
import { MessageActionsMenu, type BubbleRadii } from '../components/MessageActionsMenu';
import { MessageReactionsRow } from '../components/MessageReactionsRow';
import { JumboEmojiMessage, jumboBubbleStyle } from '../components/JumboEmojiMessage';
import { getEmojiOnlyInfo, getEmojiFontSize } from '../utils/emoji';
import { friendlyErrorMessage } from '../utils/friendlyError';
import { useMessageReactions } from '../hooks/useMessageReactions';
import { ReplyPreviewBanner } from '../components/ReplyPreviewBanner';
import { QuotedMessagePreview } from '../components/QuotedMessagePreview';
import { MessageBubbleHighlight } from '../components/MessageBubbleHighlight';
import { SwipeToReplyWrapper } from '../components/SwipeToReplyWrapper';
import { useMessaging } from '../context/MessagingProvider';
import { useUserProfile } from '../context/UserProfileContext';
import { userPresenceService } from '../services/presence/userPresenceService';
import { avatarCacheService } from '../services/media/avatarCacheService';
import { FullscreenImageViewer } from '../components/FullscreenImageViewer';
import { ImagePreviewModal } from '../components/ImagePreviewModal';
import { FilePreviewModal, type PickedFilePreview } from '../components/FilePreviewModal';
import { ContactPreviewModal } from '../components/ContactPreviewModal';
import { VideoPreviewModal } from '../components/VideoPreviewModal';
import { ChatCameraModal, type CapturedAsset } from '../components/ChatCameraModal';
import { getImageCropPicker, isPickerCancelError } from '../utils/imageCropModule';
import { getSenderColor } from '../utils/senderColor';
import { FullscreenVideoPlayer } from '../components/FullscreenVideoPlayer';
import { ChatTextInput, ChatTextInputRef } from '../components/ChatTextInput';
import { AudioMessageBubble } from '../components/AudioMessageBubble';
import { WelcomeIntroMessage } from '../components/WelcomeIntroMessage';
import { useChatKeyboardScroll } from '../hooks/useChatKeyboardScroll';
import { useDismissKeyboardOnBlur } from '../hooks/useDismissKeyboardOnBlur';
import { BlockUserOverlay } from '../components/BlockUserOverlay';
import { logEventThrottled } from '../services/analytics/eventLogger';
import { ReportUserScreen, ReportedMessageContext } from './ReportUserScreen';
import { ReportMessageSheet } from '../components/ReportMessageSheet';
import { ReactionsDetailSheet, ReactorInfo } from '../components/ReactionsDetailSheet';
import { withTimeout } from '../services/messaging/withTimeout';
import { sanitizeMessage } from '../services/messaging/messageSanitizer';
import { ChatErrorBoundary } from '../components/chat/ChatErrorBoundary';
import { BubbleSpotlightDim, type SpotlightRect } from '../components/chat/BubbleSpotlightDim';
import { SafeMessageBubble } from '../components/chat/SafeMessageBubble';

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

// Module-scoped so an in-flight upload survives a screen unmount/remount
// (navigate away & back) — prevents the zombie-heal from failing a still-uploading message.
const inFlightUploads = new Set<string>();

// Window in which a second send of the same media URI is treated as an
// accidental duplicate and ignored (see lastMediaSendRef).
const MEDIA_SEND_DEDUP_MS = 4000;

// Lifecycle rank used by dedupeMessages — a more-advanced row wins a merge.
const uploadRank = (m: Message): number => {
  if (m.upload_state === 'failed') return 0;
  if (m.upload_state === 'uploading') return 1;
  // An un-reconciled optimistic row still carries its temporary client id
  // (id === client_id). It must rank BELOW its confirmed server row (id !==
  // client_id → rank 2) so a client_id collision in dedupeMessages always
  // resolves to the real message, never the stale local echo. Text no longer
  // sets upload_state:'failed', so without this a failed-then-resent text could
  // tie a server row and mask it permanently.
  if (!!m.client_id && m.id === m.client_id) return 0;
  return 2; // 'sent' or undefined (a normal server row)
};

// Collapse rows that represent the same logical message. Concurrent paths
// (optimistic insert, the realtime echo, retry, cache merge) can briefly leave
// two rows sharing a client_id — one 'failed'/'uploading', one 'sent' — which
// renders a duplicate bubble AND trips React's "two children with the same key"
// warning (keyExtractor is client_id || id). Deduping at the single render
// chokepoint fixes both, race-proof regardless of which path created the dupe.
// Rows are matched on EITHER client_id or id, so an optimistic row (id ===
// client_id) collapses into its server row (id === server uuid, same client_id).
const dedupeMessages = (list: Message[]): Message[] => {
  const slotByIdentity = new Map<string, number>();
  const result: Message[] = [];
  for (const m of list) {
    const identities = [m.client_id, m.id].filter(Boolean) as string[];
    let slot = -1;
    for (const key of identities) {
      const found = slotByIdentity.get(key);
      if (found !== undefined) { slot = found; break; }
    }
    if (slot === -1) {
      slot = result.length;
      result.push(m);
    } else if (uploadRank(m) > uploadRank(result[slot])) {
      // Keep whichever row is further along the send lifecycle; ties keep the
      // existing (earlier) row so list ordering stays stable.
      result[slot] = m;
    }
    for (const key of identities) slotByIdentity.set(key, slot);
  }
  return result;
};

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
  // Group-chat specific: when this conversation is linked to a surftrip / legacy trip,
  // tapping the header avatar/name opens the corresponding detail screen via the
  // matching callback. Surftrips take priority — `tripId` is the legacy `group_trips`
  // path and only fires when no `surftripId` is present.
  tripId?: string;
  onOpenTripDetail?: (tripId: string) => void;
  surftripId?: string;
  onOpenSurftripDetail?: (surftripId: string) => void;
  // Accepted only so the ChatCard routing union type-checks — group chats never
  // review individual commitments, so this is ignored here.
  reviewCommitment?: boolean;
  // OS-share handoff ("Share to Swellyo" → picked this chat): prefill the media
  // preview composer on mount so caption + Send reuse the upload-first pipeline.
  sharedMedia?: { uri: string; mimeType: string; kind: 'image' | 'video' };
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
  surftripId,
  onOpenSurftripDetail,
  sharedMedia,
}) => {
  // Get markAsRead and setCurrentConversationId from MessagingProvider
  const { markAsRead, markReadRealtime, flushReadWatermark, setCurrentConversationId: setMessagingCurrentConversationId, dispatch: messagingDispatch, conversations: providerConversations } = useMessaging();
  // Current user's avatar — used for own voice-message bubbles (optimistic rows
  // have no enriched sender_avatar yet).
  const { profile: myProfile } = useUserProfile();
  
  const [showBlockOverlay, setShowBlockOverlay] = useState(false);
  const [showChatMenu, setShowChatMenu] = useState(false);
  const [showReportUser, setShowReportUser] = useState(false);
  // When reporting a specific message, target that message's sender (groups can
  // have many senders) and carry the message details into the report flow.
  const [reportMessageContext, setReportMessageContext] = useState<ReportedMessageContext | null>(null);
  const [reportTarget, setReportTarget] = useState<{ userId: string; name: string } | null>(null);
  // Message reports use an in-chat bottom sheet (the whole-user report still uses the full ReportUserScreen).
  const [reportSheetVisible, setReportSheetVisible] = useState(false);
  // "Who reacted" sheet — opened by tapping a reaction pill under a message.
  const [reactionsSheet, setReactionsSheet] = useState<{ messageId: string; emoji: string } | null>(null);
  const [showMuteModal, setShowMuteModal] = useState(false);
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
  // Whether the user is near the visual bottom (inverted list → small contentOffset.y).
  // Used to decide whether to cap-on-append (trim oldest) vs leave history alone.
  const isNearBottomRef = useRef(true);
  // True once the user has actually dragged the list. Until then we keep
  // isNearBottomRef pinned true, so a stray onScroll during initial layout can't
  // flip it false — otherwise a message that lands via realtime right after a
  // notification-open (index 0, below the fold with maintainVisibleContentPosition)
  // wouldn't auto-scroll and the user would have to scroll down to see it.
  const hasUserScrolledRef = useRef(false);
  // True once we've trimmed the NEWEST messages off the in-memory window (because
  // the user scrolled far up). "Scroll to bottom" must reload the latest window.
  const hasNewerTrimmedRef = useRef(false);
  // Image message ids whose upload is genuinely in-flight, so the zombie-heal
  // effect doesn't mark an active upload as failed. Module-scoped (see
  // `inFlightUploads` above) so it survives unmount/remount mid-upload.
  // Seed from the synchronous auth cache so own messages render on the right
  // from the very first paint — otherwise messages briefly appear on the left
  // and drift right once the async session fetch resolves.
  const [currentUserId, setCurrentUserId] = useState<string | null>(
    () => supabaseAuthService.getCachedUserId()
  );
  const [otherUserIsOnline, setOtherUserIsOnline] = useState<boolean | null>(null);
  const [hasTrackedFirstMessage, setHasTrackedFirstMessage] = useState(false);
  const [hasTrackedFirstReply, setHasTrackedFirstReply] = useState(false);
  const [firstMessageSentTime, setFirstMessageSentTime] = useState<number | null>(null);
  const [isTyping, setIsTyping] = useState(false); // Any peer currently typing
  const [typingCount, setTypingCount] = useState(0); // How many distinct peers are typing (group "N people are typing")
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [realtimeHealthy, setRealtimeHealthy] = useState(true); // Track realtime subscription health
  const [editingText, setEditingText] = useState('');
  // Bubble bounds for the edit-mode spotlight dim (same "lift" as long-press).
  const [editDimRect, setEditDimRect] = useState<SpotlightRect | null>(null);
  // Per-corner radii captured at long-press, so the edit-mode re-measure reuses
  // the same tail/no-tail cutout instead of assuming the bubble always has a tail.
  const editDimRadiiRef = useRef<BubbleRadii>({ topLeft: 16, topRight: 2, bottomLeft: 16, bottomRight: 16 });
  // Host view the dim is drawn inside — used to measure the bubble in the dim's
  // LOCAL coords (not window), so the carved hole isn't offset by the header.
  const dimHostRef = useRef<any>(null);
  const [menuVisible, setMenuVisible] = useState(false);
  // Keyboard height captured when the long-press menu opens, so the in-tree menu
  // positions itself above the keyboard (which now stays up).
  const [menuKeyboardHeight, setMenuKeyboardHeight] = useState(0);
  // Last *full* keyboard height (from the native event); used as the snapshot at
  // long-press time because `kbHeight.value` can already be mid-collapse.
  const keyboardFullHeightRef = useRef(0);
  useEffect(() => {
    const onShow = (e: any) => {
      const h = e?.endCoordinates?.height;
      if (typeof h === 'number' && h > 0) keyboardFullHeightRef.current = h;
    };
    const s1 = Keyboard.addListener('keyboardDidShow', onShow);
    const s2 = Keyboard.addListener('keyboardWillShow', onShow);
    return () => { s1.remove(); s2.remove(); };
  }, []);
  const [showPermissionOverlay, setShowPermissionOverlay] = useState(false);
  const pendingPickerRef = useRef<(() => void) | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const [bubbleRect, setBubbleRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
    radii?: { topLeft: number; topRight: number; bottomLeft: number; bottomRight: number };
    isOwn?: boolean;
  } | null>(null);
  const bubbleRefsRef = useRef<Map<string, any>>(new Map());
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [resolvingReplyJumpId, setResolvingReplyJumpId] = useState<string | null>(null);
  const [showReturnToLatest, setShowReturnToLatest] = useState(false);
  const messagesRef = useRef<Message[]>([]);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const { setReaction, removeReaction } = useMessageReactions(
    currentConversationId,
    currentUserId,
    messages,
    setMessages,
  );
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);
  const [pendingDeleteMessageId, setPendingDeleteMessageId] = useState<string | null>(null);
  const [fullscreenImageUrl, setFullscreenImageUrl] = useState<string | null>(null);
  const [fullscreenThumbnailUrl, setFullscreenThumbnailUrl] = useState<string | null>(null);
  const [fullscreenVideoUrl, setFullscreenVideoUrl] = useState<string | null>(null);
  // Message id whose DM video is currently being signed on-demand (shows a spinner)
  const [signingVideoId, setSigningVideoId] = useState<string | null>(null);
  const { panelOpen, panelHeight, showKeyboardIcon, togglePanel, closePanel, requestKeyboard } = useAttachPanel();
  const [imagePreviewVisible, setImagePreviewVisible] = useState(false);
  const [selectedImageUri, setSelectedImageUri] = useState<string | null>(null);
  const selectedImageUriForUploadRef = useRef<string | null>(null);
  // Source dimensions of the picked image — captured at pick time so the
  // on-demand cropper (Edit button) can pass them to openCropper, avoiding
  // the lib's 200px default-output trap.
  const selectedImageDimensionsRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  // Dedup guard for media sends. Each send mints a fresh clientId, so any
  // duplicate invocation — a fast double-tap, an OS-delivered duplicate touch,
  // or a modal remount that resets the modal's own per-tap guard — yields two
  // optimistic rows and two uploads (one usually fails, as seen in the wild).
  // This blocks a repeat send of the same URI within a short window, at the one
  // function every image/video send must pass through.
  const lastMediaSendRef = useRef<{ uri: string | null; at: number }>({ uri: null, at: 0 });
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isPickerOpenRef = useRef(false);
  const pickerFallbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const [selectedVideoUri, setSelectedVideoUri] = useState<string | null>(null);
  const selectedVideoMetadataRef = useRef<{ width?: number; height?: number; duration?: number; fileSize?: number; mimeType?: string } | null>(null);
  const [videoPreviewVisible, setVideoPreviewVisible] = useState(false);
  const [isProcessingVideo, setIsProcessingVideo] = useState(false);
  const [cameraVisible, setCameraVisible] = useState(false);
  const [pendingFile, setPendingFile] = useState<PickedFilePreview | null>(null);
  const [filePreviewVisible, setFilePreviewVisible] = useState(false);
  const [pendingContact, setPendingContact] = useState<ContactMetadata | null>(null);
  const [contactPreviewVisible, setContactPreviewVisible] = useState(false);

  // OS-share media handoff ("Share to Swellyo" → picked this chat). Enter exactly
  // the preview state the pickers set, so caption + Send flow through the existing
  // upload-first pipeline. Guarded so a re-render can't re-open the preview.
  const sharedMediaConsumedRef = useRef(false);
  useEffect(() => {
    if (!sharedMedia || sharedMediaConsumedRef.current) return;
    sharedMediaConsumedRef.current = true;

    if (sharedMedia.kind === 'video') {
      selectedVideoMetadataRef.current = { mimeType: sharedMedia.mimeType };
      setSelectedVideoUri(sharedMedia.uri);
      setVideoPreviewVisible(true);
      return;
    }

    selectedImageUriForUploadRef.current = sharedMedia.uri;
    selectedImageDimensionsRef.current = { width: 0, height: 0 };
    setSelectedImageUri(sharedMedia.uri);
    setImagePreviewVisible(true);
    // A shared file carries no dimensions (the pickers read them off the asset),
    // so resolve them for the bubble's aspect ratio. 0×0 stays as the fallback —
    // it's what the native picker writes when the asset omits them.
    Image.getSize(
      sharedMedia.uri,
      (width, height) => {
        selectedImageDimensionsRef.current = { width, height };
      },
      () => {},
    );
  }, [sharedMedia]);

  const insets = useSafeAreaInsets();
  // Keyboard-aware padding for the chat area. Bypasses the measureLayout-based
  // KAV which breaks when nested inside react-native-screen-transitions' transformed
  // ContentLayer. height is negative when keyboard is open on iOS → use abs for
  // padding (defensive: ignore brief sign flips during interactive dismiss).
  const { height: kbHeight, progress: kbProgress } = useReanimatedKeyboardAnimation();
  // The panel occupies the keyboard's rectangle, so the reserved space is whichever
  // of the two is present. Deliberately a max(), not a branch: while the panel mounts
  // UNDER the still-visible keyboard both are `panelHeight`, and after the keyboard
  // goes only the panel is. The value never changes across the swap, so no frame can
  // catch the JS and UI threads disagreeing. (The panel is absolutely positioned and
  // fills this padding rather than adding to the column — see AttachPanel.)
  const animatedKeyboardPadding = useAnimatedStyle(() => ({
    paddingBottom: Math.max(
      Math.round(Math.abs(kbHeight.value)),
      panelOpen ? panelHeight : 0,
    ),
  }), [panelOpen, panelHeight]);
  // Composer's own bottom padding: insets.bottom at rest (home indicator safe area),
  // shrinks to 0 as keyboard opens (so the input sits flush against keyboard top).
  // Clamp progress to [0,1] — the lib has occasionally reported a hair past either
  // end during fast focus/dismiss, which leaked a stray pixel of paddingBottom.
  const composerRestPadding = Math.max(insets.bottom, 8);
  const animatedComposerPadding = useAnimatedStyle(() => {
    // An open panel stands in for a fully-open keyboard: same rectangle, same rule.
    // Without this, kbProgress falls to 0 as the keyboard leaves and insets.bottom
    // reappears BETWEEN the composer and the panel.
    const p = panelOpen ? 1 : Math.min(1, Math.max(0, kbProgress.value));
    return { paddingBottom: Math.round(composerRestPadding * (1 - p)) };
  }, [panelOpen]);
  const composerPrimaryColor = '#05BCD3';
  const flatListRef = useRef<FlatList<Message>>(null);
  const { handleScroll: handleKeyboardScroll, handleLayout, scrollToBottom: scrollToBottomBase } = useChatKeyboardScroll(flatListRef, { inverted: true });
  // Wrap the hook's scrollToBottom so "go to bottom" reloads the latest window
  // when we've trimmed the newest messages out of memory (user was scrolled up).
  // Kept synchronous (same signature as the hook's) so existing callers — and the
  // hook's own internal scrollToBottom usage — are unaffected; the reload runs as
  // a fire-and-forget IIFE before the actual scroll.
  const reloadLatestWindow = useCallback(async () => {
    if (!hasNewerTrimmedRef.current || !currentConversationId) return;
    try {
      const result = await messagingService.getMessages(currentConversationId, 30);
      setMessages(result.messages);
      setHasMoreMessages(result.hasMore);
      oldestMessageIdRef.current = result.messages[0]?.id ?? null;
      hasNewerTrimmedRef.current = false;
      setShowReturnToLatest(false);
    } catch (e) {
      console.warn('[reloadLatestWindow] failed:', e);
    }
  }, [currentConversationId]);
  // Internal callers (post-send, layout) keep the sync signature; reload is fire-and-forget.
  const scrollToBottom = useCallback((animated = true) => {
    void reloadLatestWindow();
    scrollToBottomBase(animated);
  }, [reloadLatestWindow, scrollToBottomBase]);
  // The "Return to latest" pill awaits the reload THEN scrolls, so it lands on the
  // fresh window instead of the stale one.
  const handleReturnToLatest = useCallback(async () => {
    await reloadLatestWindow();
    requestAnimationFrame(() => scrollToBottomBase(true));
  }, [reloadLatestWindow, scrollToBottomBase]);
  useDismissKeyboardOnBlur();

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
  // Per-typer receiver-side state for groups: map each typing peer to its own
  // 6s auto-expiry timer (stop events are best-effort — a backgrounded peer may
  // never send one). Re-armed on each "typing" event; cleared on explicit stop.
  const typingUsersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
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
  // Timers for the staggered post-reconnect catch-up (see scheduleReconnectCatchUp).
  const reconnectCatchUpTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

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

  // Measure the edited bubble so the spotlight dim carves its hole over the right
  // spot. The keyboard now STAYS open through long-press → Edit, so the list
  // doesn't reflow and we can measure quickly: once right after the edit bar
  // mounts, and once more to catch the small composer→edit-bar height swap.
  // Auto-clear the shared spotlight dim once neither the menu nor edit needs it.
  useEffect(() => {
    if (!menuVisible && !editingMessageId) setEditDimRect(null);
  }, [menuVisible, editingMessageId]);

  // Keep the long-press menu, reactions bar, and spotlight dim GLUED to the
  // selected bubble while the menu is open. The bubble lives in the message list,
  // not in the overlay, so anything that reflows the list — the keyboard opening/
  // closing, an image above finishing loading, layout animations — slides the
  // bubble out from under a one-shot measurement. We re-measure every frame while
  // the menu is visible and update bubbleRect (window coords → bar/menu placement)
  // and editDimRect (host-local coords → dim cutout) only when the position
  // actually changes, so a settled menu stops triggering re-renders.
  useEffect(() => {
    if (!menuVisible || !selectedMessage) return;
    const id = selectedMessage.id;
    const isOwn = selectedMessage.sender_id === currentUserId;
    let raf = 0;
    let cancelled = false;
    const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
    const tick = () => {
      if (cancelled) return;
      const node = bubbleRefsRef.current.get(id);
      const host = dimHostRef.current;
      if (node?.measureInWindow) {
        node.measureInWindow((x: number, y: number, w: number, h: number) => {
          if (cancelled || w <= 0 || h <= 0) return;
          const radii = editDimRadiiRef.current;
          setBubbleRect((prev) =>
            prev && near(prev.x, x) && near(prev.y, y) && near(prev.width, w) && near(prev.height, h)
              ? prev
              : { x, y, width: w, height: h, radii, isOwn },
          );
          if (host?.measureInWindow) {
            host.measureInWindow((hx: number, hy: number) => {
              if (cancelled) return;
              const ex = x - hx;
              const ey = y - hy;
              setEditDimRect((prev) =>
                prev && near(prev.x, ex) && near(prev.y, ey) && near(prev.width, w) && near(prev.height, h)
                  ? prev
                  : { x: ex, y: ey, width: w, height: h, radii },
              );
            });
          }
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelled = true; cancelAnimationFrame(raf); };
  }, [menuVisible, selectedMessage, currentUserId]);

  useEffect(() => {
    // Don't clear here — the menu also uses editDimRect; the effect above clears
    // it. While editing, re-measure to refine after the composer→edit-bar swap.
    if (!editingMessageId) return;
    let cancelled = false;
    const measure = () => {
      const host = dimHostRef.current;
      const node = bubbleRefsRef.current.get(editingMessageId);
      if (host && node && typeof host.measureInWindow === 'function' && typeof node.measureInWindow === 'function') {
        host.measureInWindow((hx: number, hy: number) => {
          node.measureInWindow((bx: number, by: number, w: number, h: number) => {
            if (!cancelled && w > 0 && h > 0) {
              setEditDimRect({
                x: bx - hx, y: by - hy, width: w, height: h,
                radii: editDimRadiiRef.current,
              });
            }
          });
        });
      }
    };
    const t1 = setTimeout(measure, 50);
    const t2 = setTimeout(measure, 250);
    return () => { cancelled = true; clearTimeout(t1); clearTimeout(t2); };
  }, [editingMessageId]);

  // Analytics: opening a trip's group chat = "active in this trip today"
  // (charts B + C). Throttled per (user, trip); DMs (no tripId) don't log.
  useEffect(() => {
    if (tripId) logEventThrottled('trip_chat_opened', { tripId });
  }, [tripId]);

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
        markAsRead(currentConversationId, false);
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
      const runReconnectCatchUp = async (force = false) => {
        const convId = currentConversationIdRef.current;
        if (!convId) return;
        if (catchUpInFlightRef.current) return;
        // The forced (network-reconnect) path must run even if a Realtime event
        // arrived recently — its whole purpose is to pull our own just-resent
        // message whose INSERT echo may have been missed during the reconnect.
        if (!force && Date.now() - lastRealtimeEventAtRef.current < 10_000) return;

        catchUpInFlightRef.current = true;
        try {
          // Widen the lookback on the forced path so a message the outbox
          // resent a moment ago is reliably inside the window.
          const since = force
            ? Date.now() - 60_000
            : lastRealtimeEventAtRef.current - 2000;
          const missed = await messagingService.getMessagesUpdatedSince(convId, since, 50);
          if (missed.length === 0) return;
          console.log(`[DirectGroupChat] catch-up found ${missed.length} missed messages (reconnect path)`);
          if (missed.length === 50) {
            console.warn('[DirectGroupChat] catch-up hit 50-message limit — older gap may require scroll-up pagination');
          }
          setMessages((prev) => {
            const merged = chatHistoryCache.mergeMessages(prev, missed);
            chatHistoryCache.saveMessages(convId, merged).catch(() => {});
            return merged;
          });
          lastRealtimeEventAtRef.current = Date.now();
        } catch (err) {
          console.error('[DirectGroupChat] reconnect catch-up failed:', err);
        } finally {
          catchUpInFlightRef.current = false;
        }
      };

      // Staggered catch-up after a network reconnect. When connectivity returns,
      // MessagingProvider's NetInfo listener drains the outbox — resending any
      // text queued while offline — but the resulting Realtime INSERT echo can be
      // missed while THIS screen's socket is itself resubscribing, leaving our
      // optimistic row on its temporary client id (no "sent" tick) until the next
      // screen reload. Pull missed messages directly, staggered because the
      // resend may only land a second or two after we resubscribe.
      const scheduleReconnectCatchUp = () => {
        reconnectCatchUpTimersRef.current.forEach(clearTimeout);
        reconnectCatchUpTimersRef.current = [];
        runReconnectCatchUp(true);
        // Retry a few times because the outbox resend may land a moment after we
        // resubscribe — but stop as soon as no own optimistic row (id ===
        // client_id) is left un-reconciled, so a healthy send doesn't keep
        // re-fetching.
        const hasUnackedOwn = () => messagesRef.current.some(
          (m) => m.sender_id === currentUserIdRef.current && !!m.client_id && m.id === m.client_id
        );
        [1500, 3500, 6000].forEach((delay) => {
          reconnectCatchUpTimersRef.current.push(
            setTimeout(() => { if (hasUnackedOwn()) runReconnectCatchUp(true); }, delay)
          );
        });
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
                scheduleReconnectCatchUp();
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
          onNewMessage: (rawMessage) => {
            const newMessage = sanitizeMessage(rawMessage);
            if (!newMessage) { console.warn('[DirectGroupChat] dropped malformed realtime message'); return; }
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
              const appended = [...prev, newMessage];
              // At the bottom: cap by dropping the OLDEST (off-screen top). If the
              // user is scrolled up reading history, leave the array untrimmed.
              const updated = isNearBottomRef.current
                ? capMessages(appended, MAX_IN_MEMORY_MESSAGES, 'head')
                : appended;
              if (convId) {
                chatHistoryCache.saveMessages(convId, updated).catch(err => {
                  console.error('Error updating cache:', err);
                });
              }
              return updated;
            });
            if (me && convId) {
              markReadRealtime(convId, newMessage.id, false);
            }
            // Piggyback to the provider: the filtered channel is reliable, the unfiltered
            // conversations_list channel often drops INSERT events due to the RLS quirk
            // at messagingService.ts:1741-1779. Mirroring the event here keeps the list
            // preview in sync without depending on that channel. The reducer dedupes.
            if (convId) {
              messagingDispatch({ type: 'NEW_MESSAGE', payload: { conversationId: convId, message: newMessage } });
            }
            // Only auto-scroll if the user is already near the bottom. When they're
            // scrolled up reading history, an incoming message must not yank them
            // down (and scrollToBottom now reloads the latest window if trimmed).
            // Sending a message keeps you at the bottom, so this still scrolls then.
            if (isNearBottomRef.current) scrollToBottom();
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
              
              const deletedMessage = { ...messageExists, deleted: true, body: undefined, reactions: [] };
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
            if (!me || userId === me) return;
            const timers = typingUsersRef.current;
            const existing = timers.get(userId);
            if (existing) clearTimeout(existing);
            if (isTyping) {
              // (Re)arm this peer's 6s receiver-side expiry. Must exceed the 3s
              // sender keepalive so a still-typing peer never flickers off.
              timers.set(userId, setTimeout(() => {
                timers.delete(userId);
                setTypingCount(timers.size);
                setIsTyping(timers.size > 0);
              }, 6000));
            } else {
              timers.delete(userId);
            }
            setTypingCount(timers.size);
            setIsTyping(timers.size > 0);
          },
        }
      );

      return () => {
        unsubscribe();
        setIsTyping(false);
        reconnectCatchUpTimersRef.current.forEach(clearTimeout);
        reconnectCatchUpTimersRef.current = [];
        setTypingCount(0);
        typingUsersRef.current.forEach(t => clearTimeout(t));
        typingUsersRef.current.clear();
        if (typingDebounceRef.current) {
          clearTimeout(typingDebounceRef.current);
          typingDebounceRef.current = null;
        }
        if (typingTimeoutRef.current) {
          clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = null;
        }
        messagingService.stopTyping(currentConversationId, currentUserIdRef.current ?? undefined).catch(() => {});
      };
    } else {
      // No conversation yet - clear messages and stop loading
      setMessages([]);
      setIsFetchingMessages(false);
      setIsTyping(false);
      setTypingCount(0);
      typingUsersRef.current.forEach(t => clearTimeout(t));
      typingUsersRef.current.clear();
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
      markAsRead(currentConversationId, false);
    }
  }, [currentConversationId, currentUserId, markAsRead]);

  // Flush the pending read watermark when the screen unmounts or the conversation changes.
  useEffect(() => {
    return () => {
      if (currentConversationId) flushReadWatermark(currentConversationId);
    };
  }, [currentConversationId, flushReadWatermark]);

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

  // Heal stuck image uploads left over from a previous session: a cached image
  // still in 'uploading' with no real URL can never resume → flip it to 'failed'
  // so it shows Retry/Remove instead of a permanent spinner ghost. Skips uploads
  // that are genuinely in-flight in THIS session.
  useEffect(() => {
    const convId = currentConversationId;
    if (!convId) return;
    const t = setTimeout(() => {
      setMessages((prev) => {
        let changed = false;
        const next = prev.map(m => {
          // Catch the user's OWN images that have no usable image and aren't
          // actively uploading — covers both leftover 'uploading' rows from a
          // killed session AND old pre-fix ghosts (real server rows with null
          // metadata, upload_state undefined). Never touch received messages,
          // genuinely in-flight uploads, or already-sent rows.
          const mine = m.sender_id === currentUserId;
          const isMedia = m.type === 'image' || m.type === 'video' || m.type === 'audio' || m.type === 'file';
          // "Has real uploaded media" per type. Video's video_url stays '' until
          // the MediaConvert Lambda finishes, so its success signal is storage_path
          // (set the moment the S3 upload + create succeed), NOT video_url.
          const hasRealMedia =
            m.type === 'image' ? !!m.image_metadata?.image_url :
            m.type === 'video' ? !!m.video_metadata?.storage_path :
            m.type === 'audio' ? !!m.audio_metadata?.audio_url :
            m.type === 'file' ? !!m.file_metadata?.storage_path :
            true;
          // A dead upload from a previous session (still 'uploading' but not in
          // this session's in-flight set — the local preview may still be cached),
          // or an old pre-fix ghost (real server row with null metadata,
          // upload_state undefined). Flip to 'failed' so it shows Retry/Remove;
          // keep _localPreviewUri so Retry can re-upload. Never touch received,
          // in-flight, sent, or already-failed rows.
          if (
            isMedia &&
            mine &&
            !hasRealMedia &&
            !inFlightUploads.has(m.id) &&
            m.upload_state !== 'sent' &&
            m.upload_state !== 'failed'
          ) {
            changed = true;
            return { ...m, upload_state: 'failed' as const, upload_error: 'Upload interrupted' };
          }
          return m;
        });
        if (!changed) return prev;
        chatHistoryCache.saveMessages(convId, next).catch(() => {});
        return next;
      });
    }, 800);
    return () => clearTimeout(t);
  }, [currentConversationId, currentUserId]);

  // Mute state derived synchronously from the provider so the menu opens with the
  // correct Mute/Unmute label immediately — no async fetch on mount.
  const mutedUntil = useMemo(() => {
    if (!currentConversationId || !currentUserId) return null;
    const conv = providerConversations.find(c => c.id === currentConversationId);
    const meMember = conv?.members?.find(m => m.user_id === currentUserId);
    return getMuteUntilFromMember(meMember);
  }, [providerConversations, currentConversationId, currentUserId]);

  const applyMute = useCallback(async (until: Date | null) => {
    if (!currentConversationId || !currentUserId) return;
    const effective = until && until.getTime() > Date.now() ? until : null;
    const newMutedUntil = effective?.toISOString() ?? null;

    // Optimistic dispatch first so the menu and the conversations list reflect
    // the change instantly. UPDATE_MEMBER_PREFERENCES does NOT reorder the list.
    const currentConv = providerConversations.find(c => c.id === currentConversationId);
    const existingPrefs = currentConv?.members?.find(m => m.user_id === currentUserId)?.preferences ?? {};
    messagingDispatch({
      type: 'UPDATE_MEMBER_PREFERENCES',
      payload: {
        conversationId: currentConversationId,
        userId: currentUserId,
        preferences: { ...existingPrefs, muted_until: newMutedUntil },
      },
    });

    try {
      await messagingService.setMuteUntil(currentConversationId, until);
      // Re-dispatch after server confirms — guarantees the state survives any
      // concurrent REPLACE_ALL / SYNC_FROM_SERVER that may have raced with the
      // optimistic update.
      messagingDispatch({
        type: 'UPDATE_MEMBER_PREFERENCES',
        payload: {
          conversationId: currentConversationId,
          userId: currentUserId,
          preferences: { ...existingPrefs, muted_until: newMutedUntil },
        },
      });
      // Persist to the conversation list cache so reload + useFocusEffect that
      // re-loads from cache don't revert to stale preferences. Without this,
      // REPLACE_ALL from cache overwrites the optimistic dispatch.
      try {
        const cached = await loadCachedConversationList();
        if (cached) {
          const updated = cached.map((c) =>
            c.id === currentConversationId
              ? {
                  ...c,
                  members: (c.members ?? []).map((m) =>
                    m.user_id === currentUserId
                      ? { ...m, preferences: { ...(m.preferences ?? {}), muted_until: newMutedUntil } }
                      : m
                  ),
                }
              : c
          );
          await saveCachedConversationList(updated);
        }
      } catch (cacheErr) {
        console.warn('[DirectMessageScreen] cache update after mute failed:', cacheErr);
      }
    } catch (err) {
      console.warn('[DirectMessageScreen] setMuteUntil failed:', err);
      // Roll back the optimistic dispatch on failure.
      messagingDispatch({
        type: 'UPDATE_MEMBER_PREFERENCES',
        payload: {
          conversationId: currentConversationId,
          userId: currentUserId,
          preferences: existingPrefs,
        },
      });
      Alert.alert('Error', 'Could not update mute settings. Please try again.');
    }
  }, [currentConversationId, providerConversations, currentUserId, messagingDispatch]);

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
      
      // Set pagination cursor from cache (will be corrected by background sync)
      if (cachedMessages.length > 0) {
        oldestMessageIdRef.current = cachedMessages[0].id;
        // Don't enable pagination yet — wait for background sync to set the correct
        // cursor and hasMore from the server, avoiding race conditions with stale cache data
      }

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
      const deletedCount = cachedMessages.filter(m => m.deleted).length;
      console.log('[DirectMessageScreen] Loading messages from memory cache:', {
        totalMessages: cachedMessages.length,
        deletedMessages: deletedCount,
        deletedMessageIds: cachedMessages.filter(m => m.deleted).map(m => m.id),
      });
      // Preserve any local-only (un-acked optimistic) messages for THIS
      // conversation across a reconnect-triggered reload (CHANNEL_ERROR bumps
      // reconnectAttempt). Mirrors the server-fetch guard below.
      setMessages((prev) => {
        const localForThisConvo = prev.filter(m => m.conversation_id === currentConversationId);
        if (localForThisConvo.length === 0) return cachedMessages;
        return chatHistoryCache.mergeMessages(localForThisConvo, cachedMessages);
      });
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
              // These newest messages came from a fetch, not a live realtime INSERT,
              // so the INSERT handler's auto-scroll never fires and
              // maintainVisibleContentPosition keeps them below the fold. On a fresh
              // open (e.g. tapping an in-app banner) the user is still pinned to the
              // bottom — land them on the newest message instead of above it.
              if (isNearBottomRef.current) {
                requestAnimationFrame(() => scrollToBottom(false));
              }
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
        
        // AsyncStorage cache hit - show messages
        const deletedCount = asyncCachedMessages.filter(m => m.deleted).length;
        console.log('[DirectMessageScreen] Loading messages from AsyncStorage cache:', {
          totalMessages: asyncCachedMessages.length,
          deletedMessages: deletedCount,
          deletedMessageIds: asyncCachedMessages.filter(m => m.deleted).map(m => m.id),
        });
        // Preserve any local-only (un-acked optimistic) messages for THIS
        // conversation across a reconnect-triggered reload. Mirrors the
        // server-fetch guard.
        setMessages((prev) => {
          const localForThisConvo = prev.filter(m => m.conversation_id === currentConversationId);
          if (localForThisConvo.length === 0) return asyncCachedMessages;
          return chatHistoryCache.mergeMessages(localForThisConvo, asyncCachedMessages);
        });
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
                // Fresh open (e.g. in-app banner tap): pin to the newest fetched
                // message — the realtime INSERT auto-scroll won't fire for it.
                if (isNearBottomRef.current) {
                  requestAnimationFrame(() => scrollToBottom(false));
                }
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
          // Scrolling UP: keep the OLDEST window, drop the newest (visual-bottom) end.
          const merged = capMessages([...uniqueNew, ...prev], MAX_IN_MEMORY_MESSAGES, 'tail');
          if (merged.length === MAX_IN_MEMORY_MESSAGES && (uniqueNew.length + prev.length) > MAX_IN_MEMORY_MESSAGES) {
            hasNewerTrimmedRef.current = true;
          }

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
          // Store the real name; QuotedMessagePreview decides "You" at render
          // time based on whether snapshot.sender_id matches the viewer.
          // In groups, otherUserName is the group title — fall back to the
          // per-sender map first so a self-reply doesn't end up labeled with
          // the group name.
          sender_name:
            replyingTo.sender_name ||
            replyingTo.sender?.name ||
            senderNamesById.get(replyingTo.sender_id) ||
            '',
          type: replyingTo.type ?? 'text',
          body:
            replyingTo.type === 'image'
              ? 'Photo'
              : replyingTo.type === 'video'
                ? 'Video'
                : replyingTo.type === 'audio'
                  ? 'Voice message'
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
        const errorMessage = friendlyErrorMessage(error, 'Failed to create conversation. Please try again.');
        // The message never made it off-device — remove it, restore the input,
        // and surface the error. Do not enqueue to the outbox in this branch.
        setMessages((prev) => prev.filter(msg => msg.id !== clientId));
        setInputText(messageText); // Restore input text
        chatInputRef.current?.focus?.();
        Alert.alert('Could not create conversation', errorMessage);
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
      // Text messages show no failed/retry UI. Leave the optimistic bubble
      // untouched (Fix #1 keeps it visible) and let the persistent outbox resend
      // it silently on the next flush trigger. markFailed only bumps attempt
      // bookkeeping; the entry stays enqueued.
      messageOutbox.markFailed(clientId, error).catch(() => {});
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
      messagingService.stopTyping(currentConversationId!, currentUserIdRef.current ?? undefined).catch(() => {});
      return;
    }

    const now = Date.now();
    const timeSinceLastSent = lastTypingSentAtRef.current ? now - lastTypingSentAtRef.current : Infinity;
    // Keepalive cadence: re-send "typing" at most once every 3s while composing
    // (WhatsApp-style). The first event still fires ~100ms after the first
    // keystroke; subsequent ones are throttled to 3s, cutting broadcast volume ~6x.
    if (timeSinceLastSent >= 3000) {
      if (typingDebounceRef.current) {
        clearTimeout(typingDebounceRef.current);
      }
      typingDebounceRef.current = setTimeout(() => {
        typingDebounceRef.current = null;
        if (currentConversationId && inputText.trim()) {
          messagingService.startTyping(currentConversationId, currentUserIdRef.current ?? undefined).catch(() => {});
          lastTypingSentAtRef.current = Date.now();
        }
      }, 100) as ReturnType<typeof setTimeout>;
    }

    // Trailing: clear typing indicator after 5 seconds of no typing (WhatsApp ~5s idle stop)
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    typingTimeoutRef.current = setTimeout(() => {
      if (currentConversationId) {
        messagingService.stopTyping(currentConversationId, currentUserIdRef.current ?? undefined).catch(() => {});
      }
    }, 5000) as ReturnType<typeof setTimeout>;

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

      // Tear the spotlight down in the same commit as the optimistic body change.
      // Held open across the await, the dim's cutout still has the pre-edit
      // bubble's geometry and there's nothing re-measuring it once the menu closed.
      setEditingMessageId(null);
      setEditingText('');

      const updatedMessage = await messagingService.editMessage(currentConversationId, messageId, newBody);

      // Update with server response
      setMessages((prev) => {
        const updated = prev.map(msg =>
          msg.id === messageId ? updatedMessage : msg
        );
        chatHistoryCache.updateMessage(currentConversationId, messageId, updatedMessage).catch(() => {});
        return updated;
      });
    } catch (error: any) {
      console.error('Error editing message:', error);
      Alert.alert('Could not edit message', friendlyErrorMessage(error, 'Failed to edit message'));
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
        
        const deletedMessage = { ...messageToDelete, deleted: true, body: undefined, reactions: [] };
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
      
      Alert.alert('Could not delete message', friendlyErrorMessage(error, 'Failed to delete message'));
      
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

  // Open the in-app camera (ChatCameraModal): live preview with a WhatsApp-style
  // filmstrip of recent gallery media above the shutter. Captures and filmstrip
  // picks both land in routeCapturedAsset below, which feeds the same preview
  // modals that gallery picks use (ImagePreviewModal for photos,
  // VideoPreviewModal for videos). Upload pipelines downstream are unchanged.
  const handleCameraCapture = () => {
    if (!currentConversationId) {
      Alert.alert('Error', 'Please wait for the conversation to load');
      return;
    }
    if (Platform.OS === 'web') return;
    setCameraVisible(true);
  };

  // Shared landing for camera captures and filmstrip picks — the same block
  // that used to follow launchCameraAsync. The camera Modal must finish
  // dismissing before the preview Modal presents: presenting a second RN Modal
  // while the first is mid-dismiss gets silently dropped on iOS.
  const routeCapturedAsset = (asset: CapturedAsset) => {
    setCameraVisible(false);
    const route = () => {
      if (asset.isVideo) {
        selectedVideoMetadataRef.current = {
          width: asset.width,
          height: asset.height,
          duration: asset.duration,
          mimeType: asset.mimeType || (asset.uri.endsWith('.mov') ? 'video/quicktime' : 'video/mp4'),
        };
        setSelectedVideoUri(asset.uri);
        setVideoPreviewVisible(true);
      } else {
        selectedImageUriForUploadRef.current = asset.uri;
        selectedImageDimensionsRef.current = {
          width: asset.width && asset.width > 0 ? asset.width : 0,
          height: asset.height && asset.height > 0 ? asset.height : 0,
        };
        setSelectedImageUri(asset.uri);
        setImagePreviewVisible(true);
      }
    };
    setTimeout(route, Platform.OS === 'ios' ? 400 : 50);
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
  // Shared upload-first helper used by both the initial send and retry. Processes
  // the local image, uploads original + thumbnail, then creates the message row
  // WITH metadata (idempotent via clientId). Throws on any failure — the caller is
  // responsible for marking the optimistic row failed. Nothing is written to the
  // server unless the upload fully succeeded (WhatsApp model).
  const uploadAndCreateImage = async (
    convId: string,
    clientId: string,
    localUri: string,
    caption: string | undefined
  ): Promise<{ created: Message; imageMetadata: any }> => {
    const { processImage, uploadImageToStorage } = await import('../services/messaging/imageUploadService');
    const processed = await processImage(localUri);
    const imageUrl = await withTimeout(
      uploadImageToStorage(processed.originalUri, convId, clientId, false),
      60000,
      'media-upload'
    );
    const thumbnailUrl = await withTimeout(
      uploadImageToStorage(processed.thumbnailUri, convId, clientId, true),
      60000,
      'media-upload'
    );
    const imageMetadata = {
      image_url: imageUrl,
      thumbnail_url: thumbnailUrl,
      width: processed.width,
      height: processed.height,
      file_size: processed.fileSize,
      mime_type: processed.mimeType,
      storage_path: `${convId}/${clientId}/original.jpg`,
    };
    const created = await messagingService.createImageMessageWithMetadata(
      convId,
      caption,
      imageMetadata,
      clientId
    );
    return { created, imageMetadata };
  };

  const handleImageSend = async (caption?: string, overrideImageUri?: string) => {
    const uriToUse = overrideImageUri ?? selectedImageUriForUploadRef.current ?? selectedImageUri;
    if (!uriToUse || !currentConversationId || !currentUserId) {
      return;
    }

    // Block an accidental duplicate send of the same image (double-tap / OS
    // double-touch / modal remount). Without this, each call mints a new
    // clientId and the photo is sent twice.
    const sendAt = Date.now();
    if (
      lastMediaSendRef.current.uri === uriToUse &&
      sendAt - lastMediaSendRef.current.at < MEDIA_SEND_DEDUP_MS
    ) {
      return;
    }
    lastMediaSendRef.current = { uri: uriToUse, at: sendAt };

    const conversationId = currentConversationId;
    // Client-generated UUID. Acts as the optimistic row's id (so we can locate it
    // later) AND the server-side idempotency key (client_id) used at create time.
    const clientId = Crypto.randomUUID();

    // Optimistic LOCAL row — id = clientId, NOT a server id. Upload-first means no
    // server row exists yet; if the upload fails this never touches the server.
    const optimistic: Message = {
      id: clientId,
      client_id: clientId,
      conversation_id: conversationId,
      sender_id: currentUserId,
      body: caption ?? '',
      type: 'image',
      attachments: [],
      is_system: false,
      edited: false,
      deleted: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      upload_state: 'uploading',
      _localPreviewUri: uriToUse,
    } as Message;

    inFlightUploads.add(clientId);

    // Close preview modal immediately — upload continues in background
    selectedImageUriForUploadRef.current = null;
    setImagePreviewVisible(false);
    setSelectedImageUri(null);
    setIsProcessingImage(false);

    setMessages((prev) => {
      const next = [...prev, optimistic];
      chatHistoryCache.saveMessages(conversationId, next).catch(() => {});
      return next;
    });
    scrollToBottom();

    try {
      // Upload FIRST; only create the message row if the upload succeeded.
      const { created, imageMetadata } = await uploadAndCreateImage(conversationId, clientId, uriToUse, caption);

      // Success — swap the optimistic row (id === clientId) for the server row.
      // The Realtime INSERT carrying client_id will be deduped by onNewMessage.
      setMessages((prev) => {
        const next = prev.map(m =>
          m.id === clientId
            ? { ...created, image_metadata: created.image_metadata ?? imageMetadata, upload_state: 'sent' as const, _localPreviewUri: undefined }
            : m
        );
        chatHistoryCache.saveMessages(conversationId, next).catch(() => {});
        return next;
      });
    } catch (error: any) {
      console.error('Error sending image:', error);
      // Nothing was created on the server — just mark the optimistic row failed so
      // the user can Retry/Remove. No ghost row is left for the recipient.
      setMessages((prev) => {
        const next = prev.map(m =>
          m.id === clientId
            ? { ...m, upload_state: 'failed' as const, upload_error: error?.message }
            : m
        );
        chatHistoryCache.saveMessages(conversationId, next).catch(() => {});
        return next;
      });
      Alert.alert('Could not send photo', friendlyErrorMessage(error, 'Failed to send image'));
    } finally {
      inFlightUploads.delete(clientId);
    }
  };

  // ─── File attachments ─────────────────────────────────────────────────────
  const uploadAndCreateFile = async (
    convId: string,
    clientId: string,
    localUri: string,
    baseMeta: { display_name: string; ext: string; mime_type: string; size_bytes: number },
    caption?: string,
  ): Promise<{ created: Message; fileMetadata: FileMetadata }> => {
    const { uploadFileToStorage } = await import('../services/messaging/fileUploadService');
    const { storagePath } = await withTimeout(
      uploadFileToStorage(localUri, convId, clientId, baseMeta.ext),
      60000,
      'file-upload',
    );
    const fileMetadata: FileMetadata = {
      storage_path: storagePath,
      display_name: baseMeta.display_name,
      mime_type: baseMeta.mime_type,
      ext: baseMeta.ext,
      size_bytes: baseMeta.size_bytes,
    };
    const created = await messagingService.createFileMessageWithMetadata(convId, fileMetadata, clientId, caption ?? '');
    return { created, fileMetadata };
  };

  const handleFileSend = async (
    localUri: string,
    baseMeta: { display_name: string; ext: string; mime_type: string; size_bytes: number },
    caption?: string,
  ) => {
    if (!currentConversationId || !currentUserId) return;
    const conversationId = currentConversationId;
    const clientId = Crypto.randomUUID();

    const optimistic: Message = {
      id: clientId,
      client_id: clientId,
      conversation_id: conversationId,
      sender_id: currentUserId,
      body: caption ?? '',
      type: 'file',
      file_metadata: { ...baseMeta, storage_path: '' },
      attachments: [],
      is_system: false,
      edited: false,
      deleted: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      upload_state: 'uploading',
      _localPreviewUri: localUri,
    } as Message;

    inFlightUploads.add(clientId);
    setMessages((prev) => {
      const next = [...prev, optimistic];
      chatHistoryCache.saveMessages(conversationId, next).catch(() => {});
      return next;
    });
    scrollToBottom();

    try {
      const { created, fileMetadata } = await uploadAndCreateFile(conversationId, clientId, localUri, baseMeta, caption);
      setMessages((prev) => {
        const next = prev.map(m =>
          m.id === clientId
            ? { ...created, file_metadata: created.file_metadata ?? fileMetadata, upload_state: 'sent' as const, _localPreviewUri: undefined }
            : m
        );
        chatHistoryCache.saveMessages(conversationId, next).catch(() => {});
        return next;
      });
    } catch (error: any) {
      console.error('Error sending file:', error);
      setMessages((prev) => {
        const next = prev.map(m =>
          m.id === clientId ? { ...m, upload_state: 'failed' as const, upload_error: error?.message } : m
        );
        chatHistoryCache.saveMessages(conversationId, next).catch(() => {});
        return next;
      });
      Alert.alert('Could not send file', friendlyErrorMessage(error, 'Failed to send file'));
    } finally {
      inFlightUploads.delete(clientId);
    }
  };

  const handlePickDocument = async () => {
    if (!currentConversationId) {
      Alert.alert('Error', 'Please wait for the conversation to load');
      return;
    }
    const { pickDocument } = await import('../services/messaging/documentPicker');
    const picked = await pickDocument();
    if (!picked) return;
    // Review before sending — nothing is uploaded until the user hits send.
    setPendingFile(picked);
    setFilePreviewVisible(true);
  };

  // ─── Shared contacts (display-only) ───────────────────────────────────────
  const handlePickContact = async () => {
    if (!currentConversationId || !currentUserId) {
      Alert.alert('Error', 'Please wait for the conversation to load');
      return;
    }
    try {
      const { pickContact } = await import('../services/messaging/contactPicker');
      const contact = await pickContact();
      if (!contact) return;
      // Review before sending — the user chooses which numbers to share.
      setPendingContact(contact);
      setContactPreviewVisible(true);
    } catch (error: any) {
      console.error('Error picking contact:', error);
      Alert.alert('Error', friendlyErrorMessage(error, 'Failed to pick a contact'));
    }
  };

  const sendContact = async (contact: ContactMetadata) => {
    if (!currentConversationId || !currentUserId) return;
    const conversationId = currentConversationId;
    const clientId = Crypto.randomUUID();

    const optimistic: Message = {
      id: clientId,
      client_id: clientId,
      conversation_id: conversationId,
      sender_id: currentUserId,
      body: '',
      type: 'contact',
      contact_metadata: contact,
      attachments: [],
      is_system: false,
      edited: false,
      deleted: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      upload_state: 'sent',
    } as Message;

    setMessages((prev) => {
      const next = [...prev, optimistic];
      chatHistoryCache.saveMessages(conversationId, next).catch(() => {});
      return next;
    });
    scrollToBottom();

    try {
      const created = await messagingService.createContactMessageWithMetadata(conversationId, contact, clientId);
      setMessages((prev) => {
        const next = prev.map(m =>
          m.id === clientId
            ? { ...created, contact_metadata: created.contact_metadata ?? contact, upload_state: 'sent' as const }
            : m
        );
        chatHistoryCache.saveMessages(conversationId, next).catch(() => {});
        return next;
      });
    } catch (error: any) {
      console.error('Error sending contact:', error);
      setMessages((prev) => {
        const next = prev.map(m =>
          m.id === clientId ? { ...m, upload_state: 'failed' as const, upload_error: error?.message } : m
        );
        chatHistoryCache.saveMessages(conversationId, next).catch(() => {});
        return next;
      });
      Alert.alert('Could not send contact', friendlyErrorMessage(error, 'Failed to send contact'));
    }
  };

  // Upload-first video helper (mirrors uploadAndCreateImage). Processes + uploads
  // the video and thumbnail, then creates the message row ONLY on success. Returns
  // the created server row, the built metadata, the local thumbnail poster, and the
  // processedKey so the caller can kick off the background MediaConvert poll using
  // the real server id. Storage paths key off clientId (stable across retries).
  const uploadAndCreateVideo = async (
    convId: string,
    clientId: string,
    localUri: string,
    caption: string | undefined,
    videoHints?: any
  ): Promise<{ created: Message; videoMetadata: any; thumbnailUri: string; processedKey: string }> => {
    const { processVideo, uploadVideoToS3, uploadThumbnailToStorage } = await import('../services/messaging/videoUploadService');
    const processed = await processVideo(localUri, videoHints);
    const [uploadResult, thumbnailUrl] = await withTimeout(Promise.all([
      uploadVideoToS3(localUri, convId, clientId),
      uploadThumbnailToStorage(processed.thumbnailUri, convId, clientId),
    ]), 60000, 'media-upload');
    const { s3Key, processedKey, originalUrl } = uploadResult;
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
    const created = await messagingService.createVideoMessageWithMetadata(
      convId,
      caption,
      videoMetadata,
      clientId
    );
    return { created, videoMetadata, thumbnailUri: processed.thumbnailUri, processedKey };
  };

  // Handle video send (upload-first, mirrors handleImageSend). The message row is
  // only created AFTER the upload succeeds, so a failed send leaves nothing on the
  // server. Because <Image> can't render a raw video URI, we generate a thumbnail
  // poster up front and show it on the optimistic bubble during upload.
  const handleVideoSend = async (caption?: string, overrideVideoUri?: string) => {
    // Prefer a trimmed URI from the preview modal when the user cut the clip;
    // otherwise fall back to the originally-picked URI.
    const videoUri = overrideVideoUri ?? selectedVideoUri;
    if (!videoUri || !currentConversationId || !currentUserId) {
      return;
    }

    // Block an accidental duplicate send of the same video (mirrors handleImageSend).
    const sendAt = Date.now();
    if (
      lastMediaSendRef.current.uri === videoUri &&
      sendAt - lastMediaSendRef.current.at < MEDIA_SEND_DEDUP_MS
    ) {
      return;
    }
    lastMediaSendRef.current = { uri: videoUri, at: sendAt };

    const conversationId = currentConversationId;
    // Client-generated UUID — optimistic row id AND server idempotency key.
    const clientId = Crypto.randomUUID();
    // Picker hints describe the ORIGINAL file. If the user trimmed, the file
    // changed — let `processVideo` re-read metadata from disk rather than trust
    // stale hints for duration/size.
    const videoHints = overrideVideoUri ? undefined : (selectedVideoMetadataRef.current ?? undefined);

    // Close preview immediately — upload continues in background
    setVideoPreviewVisible(false);
    setSelectedVideoUri(null);
    selectedVideoMetadataRef.current = null;
    setIsProcessingVideo(false);

    inFlightUploads.add(clientId);

    // Generate the thumbnail BEFORE injecting the bubble so the poster renders
    // with the correct aspect ratio (no black box / stretched portrait).
    let processed: any;
    try {
      const { processVideo } = await import('../services/messaging/videoUploadService');
      processed = await processVideo(videoUri, videoHints);
    } catch (error: any) {
      console.error('Error processing video:', error);
      inFlightUploads.delete(clientId);
      Alert.alert('Could not send video', friendlyErrorMessage(error, 'Failed to send video'));
      return;
    }

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

    // Optimistic LOCAL row — id = clientId, no server row exists yet.
    const optimistic: Message = {
      id: clientId,
      client_id: clientId,
      conversation_id: conversationId,
      sender_id: currentUserId,
      body: caption ?? '',
      type: 'video',
      attachments: [],
      is_system: false,
      edited: false,
      deleted: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      upload_state: 'uploading',
      _localPreviewUri: processed.thumbnailUri,
      video_metadata: posterMetadata,
    } as Message;

    setMessages((prev) => {
      const next = [...prev, optimistic];
      chatHistoryCache.saveMessages(conversationId, next).catch(() => {});
      return next;
    });
    scrollToBottom();

    try {
      // Upload FIRST; only create the message row if the upload succeeded.
      const { created, videoMetadata, processedKey } = await uploadAndCreateVideo(
        conversationId, clientId, videoUri, caption, videoHints
      );

      // Success — swap the optimistic row (id === clientId) for the server row.
      setMessages((prev) => {
        const next = prev.map(m =>
          m.id === clientId
            ? { ...created, video_metadata: created.video_metadata ?? videoMetadata, upload_state: 'sent' as const, _localPreviewUri: undefined }
            : m
        );
        chatHistoryCache.saveMessages(conversationId, next).catch(() => {});
        return next;
      });

      // Poll for the processed (compressed) video in the background using the REAL
      // server id; the compressed video_url is swapped in via Realtime when ready.
      const { pollForProcessedDmVideo } = await import('../services/messaging/videoUploadService');
      pollForProcessedDmVideo(created.id, processedKey, videoMetadata)
        .catch(err => console.error('Background video poll error:', err));
    } catch (error: any) {
      console.error('Error sending video:', error);
      // Nothing was created on the server — just mark the optimistic row failed.
      setMessages((prev) => {
        const next = prev.map(m =>
          m.id === clientId
            ? { ...m, upload_state: 'failed' as const, upload_error: error?.message }
            : m
        );
        chatHistoryCache.saveMessages(conversationId, next).catch(() => {});
        return next;
      });
      Alert.alert('Could not send video', friendlyErrorMessage(error, 'Failed to send video'));
    } finally {
      inFlightUploads.delete(clientId);
    }
  };

  // Upload-first voice helper (mirrors uploadAndCreateImage). Uploads the
  // recording, then creates the message row ONLY on success. Storage path keys
  // off clientId (stable across retries). `recording` carries the locally-known
  // duration/waveform/mime/size so the row can render its waveform immediately.
  const uploadAndCreateVoice = async (
    convId: string,
    clientId: string,
    localUri: string,
    recording: { durationMs: number; waveform: number[]; mimeType: string; sizeBytes: number },
    replyTo: ReplyToSnapshot | null
  ): Promise<{ created: Message; audioMetadata: any }> => {
    const { uploadAudioToStorage } = await import('../services/messaging/audioUploadService');
    const { audio_url, storage_path } = await withTimeout(uploadAudioToStorage(
      localUri,
      convId,
      clientId,
      recording.mimeType
    ), 60000, 'media-upload');
    const audioMetadata = {
      audio_url,
      storage_path,
      duration_ms: recording.durationMs,
      waveform: recording.waveform,
      mime_type: recording.mimeType,
      size_bytes: recording.sizeBytes,
    };
    const created = await messagingService.createAudioMessageWithMetadata(
      convId,
      audioMetadata,
      clientId,
      replyTo
    );
    return { created, audioMetadata };
  };

  // Handle voice message send (upload-first, mirrors handleImageSend). The row is
  // only created AFTER the upload succeeds, so a failed send leaves nothing on the
  // server. We seed the optimistic row's audio_metadata with the locally-known
  // waveform/duration so the bubble renders immediately and stays playable
  // (via _localPreviewUri) during upload.
  const handleVoiceMessage = async (audio: import('../components/ChatTextInput').VoiceRecording) => {
    if (!currentConversationId || !currentUserId) return;
    const conversationId = currentConversationId;
    const replyTo: ReplyToSnapshot | null = replyingTo
      ? {
          message_id: replyingTo.id,
          sender_id: replyingTo.sender_id,
          // Store the real name; QuotedMessagePreview decides "You" at render
          // time based on whether snapshot.sender_id matches the viewer.
          // In groups, otherUserName is the group title — fall back to the
          // per-sender map first so a self-reply doesn't end up labeled with
          // the group name.
          sender_name:
            replyingTo.sender_name ||
            replyingTo.sender?.name ||
            senderNamesById.get(replyingTo.sender_id) ||
            '',
          type: replyingTo.type || 'text',
          body:
            replyingTo.type === 'image'
              ? 'Photo'
              : replyingTo.type === 'video'
                ? 'Video'
                : replyingTo.type === 'audio'
                  ? 'Voice message'
                  : replyingTo.body,
        }
      : null;

    // Client-generated UUID — optimistic row id AND server idempotency key.
    const clientId = Crypto.randomUUID();

    if (replyingTo) setReplyingTo(null);

    const recording = {
      durationMs: audio.durationMs,
      waveform: audio.waveform,
      mimeType: audio.mimeType,
      sizeBytes: audio.sizeBytes,
    };

    const optimisticMetadata = {
      audio_url: '',
      storage_path: '',
      duration_ms: audio.durationMs,
      waveform: audio.waveform,
      mime_type: audio.mimeType,
      size_bytes: audio.sizeBytes,
    };

    // Optimistic LOCAL row — id = clientId, no server row exists yet.
    const optimistic: Message = {
      id: clientId,
      client_id: clientId,
      conversation_id: conversationId,
      sender_id: currentUserId,
      body: '',
      type: 'audio',
      attachments: [],
      is_system: false,
      edited: false,
      deleted: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      upload_state: 'uploading',
      _localPreviewUri: audio.uri,
      audio_metadata: optimisticMetadata,
      reply_to_message_id: replyTo?.message_id ?? null,
      reply_to_snapshot: replyTo,
    } as Message;

    inFlightUploads.add(clientId);

    setMessages((prev) => {
      const next = [...prev, optimistic];
      chatHistoryCache.saveMessages(conversationId, next).catch(() => {});
      return next;
    });
    scrollToBottom();

    try {
      // Upload FIRST; only create the message row if the upload succeeded.
      const { created, audioMetadata } = await uploadAndCreateVoice(
        conversationId, clientId, audio.uri, recording, replyTo
      );

      setMessages((prev) => {
        const next = prev.map(m =>
          m.id === clientId
            ? { ...created, audio_metadata: created.audio_metadata ?? audioMetadata, upload_state: 'sent' as const, _localPreviewUri: undefined }
            : m
        );
        chatHistoryCache.saveMessages(conversationId, next).catch(() => {});
        return next;
      });
    } catch (error: any) {
      console.error('Error sending voice message:', error);
      // Nothing was created on the server — just mark the optimistic row failed.
      setMessages((prev) => {
        const next = prev.map(m =>
          m.id === clientId
            ? { ...m, upload_state: 'failed' as const, upload_error: error?.message }
            : m
        );
        chatHistoryCache.saveMessages(conversationId, next).catch(() => {});
        return next;
      });
      Alert.alert('Could not send voice message', friendlyErrorMessage(error, 'Failed to send voice message'));
    } finally {
      inFlightUploads.delete(clientId);
    }
  };

  // Re-upload a failed media message (image/video/audio) using the locally-kept
  // original. Branches on message.type and calls the matching upload-first helper.
  // If the local file is gone (e.g. app was restarted), offer to remove the broken
  // message. Upload-first: nothing on the server until the re-upload succeeds.
  const handleRetryUpload = async (message: Message) => {
    const convId = currentConversationId;
    if (!convId) return;
    const localUri = message._localPreviewUri;

    // File attachments retry through their own upload-first path.
    if (message.type === 'file') {
      if (!localUri || !message.file_metadata) {
        Alert.alert(
          'File unavailable',
          'The original file is no longer available on this device. Remove this message?',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Remove', style: 'destructive', onPress: () => handleRemoveFailedMedia(message) },
          ],
        );
        return;
      }
      const fm = message.file_metadata;
      const midF = message.id;
      const clientIdF = message.client_id ?? midF;
      inFlightUploads.add(midF);
      setMessages((prev) => prev.map(m =>
        m.id === midF ? { ...m, upload_state: 'uploading' as const, upload_error: undefined } : m
      ));
      try {
        const { created, fileMetadata } = await uploadAndCreateFile(convId, clientIdF, localUri, {
          display_name: fm.display_name, ext: fm.ext, mime_type: fm.mime_type, size_bytes: fm.size_bytes,
        }, message.body || undefined);
        setMessages((prev) => {
          const next = prev.map(m =>
            m.id === midF ? { ...created, file_metadata: created.file_metadata ?? fileMetadata, upload_state: 'sent' as const, _localPreviewUri: undefined } : m
          );
          chatHistoryCache.saveMessages(convId, next).catch(() => {});
          return next;
        });
      } catch (error: any) {
        setMessages((prev) => {
          const next = prev.map(m =>
            m.id === midF ? { ...m, upload_state: 'failed' as const, upload_error: error?.message } : m
          );
          chatHistoryCache.saveMessages(convId, next).catch(() => {});
          return next;
        });
        Alert.alert('Could not send file', friendlyErrorMessage(error, 'Failed to send file'));
      } finally {
        inFlightUploads.delete(midF);
      }
      return;
    }

    const mediaType = message.type === 'video' || message.video_metadata
      ? 'video'
      : message.type === 'audio'
        ? 'audio'
        : 'image';
    if (!localUri) {
      const label = mediaType === 'video' ? 'video' : mediaType === 'audio' ? 'voice message' : 'photo';
      Alert.alert(
        `${mediaType === 'audio' ? 'Voice message' : mediaType === 'video' ? 'Video' : 'Photo'} unavailable`,
        `The original ${label} is no longer available on this device. Remove this message?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: () => handleRemoveFailedMedia(message) },
        ]
      );
      return;
    }
    const mid = message.id;
    // The optimistic/failed row id IS the clientId. Reuse it (or message.client_id)
    // so the re-create stays idempotent against any prior partial attempt.
    const clientId = message.client_id ?? mid;
    inFlightUploads.add(mid);
    setMessages((prev) => prev.map(m =>
      m.id === mid ? { ...m, upload_state: 'uploading' as const, upload_error: undefined } : m
    ));
    try {
      if (mediaType === 'video') {
        const { created, videoMetadata, processedKey } = await uploadAndCreateVideo(
          convId, clientId, localUri, message.body || undefined
        );
        setMessages((prev) => {
          const next = prev.map(m =>
            m.id === mid ? { ...created, video_metadata: created.video_metadata ?? videoMetadata, upload_state: 'sent' as const, _localPreviewUri: undefined } : m
          );
          chatHistoryCache.saveMessages(convId, next).catch(() => {});
          return next;
        });
        const { pollForProcessedDmVideo } = await import('../services/messaging/videoUploadService');
        pollForProcessedDmVideo(created.id, processedKey, videoMetadata)
          .catch(err => console.error('Background video poll error:', err));
      } else if (mediaType === 'audio') {
        const md = message.audio_metadata;
        const recording = {
          durationMs: md?.duration_ms ?? 0,
          waveform: md?.waveform ?? [],
          mimeType: md?.mime_type ?? 'audio/m4a',
          sizeBytes: md?.size_bytes ?? 0,
        };
        const { created, audioMetadata } = await uploadAndCreateVoice(
          convId, clientId, localUri, recording, message.reply_to_snapshot ?? null
        );
        setMessages((prev) => {
          const next = prev.map(m =>
            m.id === mid ? { ...created, audio_metadata: created.audio_metadata ?? audioMetadata, upload_state: 'sent' as const, _localPreviewUri: undefined } : m
          );
          chatHistoryCache.saveMessages(convId, next).catch(() => {});
          return next;
        });
      } else {
        const { created, imageMetadata } = await uploadAndCreateImage(convId, clientId, localUri, message.body || undefined);
        setMessages((prev) => {
          const next = prev.map(m =>
            m.id === mid ? { ...created, image_metadata: created.image_metadata ?? imageMetadata, upload_state: 'sent' as const, _localPreviewUri: undefined } : m
          );
          chatHistoryCache.saveMessages(convId, next).catch(() => {});
          return next;
        });
      }
    } catch (error: any) {
      console.error('[retryUpload] failed:', error);
      setMessages((prev) => {
        const next = prev.map(m =>
          m.id === mid ? { ...m, upload_state: 'failed' as const, upload_error: error?.message } : m
        );
        chatHistoryCache.saveMessages(convId, next).catch(() => {});
        return next;
      });
      Alert.alert('Could not send media', friendlyErrorMessage(error, 'Failed to send media'));
    } finally {
      inFlightUploads.delete(mid);
    }
  };

  // Remove a failed media message: drop it locally + from cache. Upload-first means
  // there's usually NO server row, but a stale/pre-fix ghost might exist, so we
  // best-effort delete the server row too (no-op if it never existed).
  const handleRemoveFailedMedia = async (message: Message) => {
    const convId = currentConversationId;
    setMessages((prev) => {
      const next = prev.filter(m => m.id !== message.id);
      if (convId) chatHistoryCache.saveMessages(convId, next).catch(() => {});
      return next;
    });
    try {
      if (convId) await messagingService.deleteMessage(convId, message.id);
    } catch (e) {
      console.warn('[removeFailedMedia] server delete failed:', e);
    }
  };

  // Remove a failed image: drop it locally + from cache, and delete the empty
  // server row so it doesn't linger as a broken message for the other person.
  const handleRemoveFailedImage = async (message: Message) => {
    const convId = currentConversationId;
    setMessages((prev) => {
      const next = prev.filter(m => m.id !== message.id);
      if (convId) chatHistoryCache.saveMessages(convId, next).catch(() => {});
      return next;
    });
    try {
      if (convId) await messagingService.deleteMessage(convId, message.id);
    } catch (e) {
      console.warn('[removeFailedImage] server delete failed:', e);
    }
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
    const errorMessage = friendlyErrorMessage(result.error, 'Could not resend. Please try again.');
    setMessages((prev) => prev.map(m =>
      m.id === message.id
        ? { ...m, upload_state: 'failed', upload_error: errorMessage }
        : m
    ));
    Alert.alert('Could not resend', errorMessage);
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
    if (resolvingReplyJumpId || !currentConversationId) return;

    const findInvertedIndex = (id: string): number => {
      const arr = messagesRef.current;
      const chronoIdx = arr.findIndex((m) => m.id === id);
      return chronoIdx === -1 ? -1 : arr.length - 1 - chronoIdx;
    };

    let invertedIndex = findInvertedIndex(parentMessageId);

    if (invertedIndex === -1) {
      // Not in the current window: re-anchor via a centered fetch instead of
      // paging through history (keeps memory bounded).
      setResolvingReplyJumpId(parentMessageId);
      try {
        const result = await messagingService.getMessagesAround(currentConversationId, parentMessageId, 20);
        if (result.messages.length === 0) {
          Alert.alert('Message not available', 'We couldn’t find the original message.');
          return;
        }
        setMessages(result.messages);
        setHasMoreMessages(result.hasMoreOlder);
        oldestMessageIdRef.current = result.messages[0]?.id ?? null;
        hasNewerTrimmedRef.current = true;       // window no longer ends at latest
        setShowReturnToLatest(true);
        await new Promise<void>((r) => setTimeout(r, 0)); // let the new window lay out
        invertedIndex = findInvertedIndex(parentMessageId);
      } catch {
        Alert.alert('Message not available', 'We couldn’t find the original message.');
        return;
      } finally {
        setResolvingReplyJumpId(null);
      }
    }

    if (invertedIndex === -1) return;
    setHighlightedMessageId(parentMessageId);
    flatListRef.current?.scrollToIndex({ index: invertedIndex, viewPosition: 0.5, animated: true });
  }, [resolvingReplyJumpId, currentConversationId]);

  // Build the report context for a message: a stable id/type plus a
  // human-readable snippet (text body, or a media label + storage path so a
  // reviewer can locate the file).
  const describeMessageForReport = (message: Message): ReportedMessageContext => {
    const type = message.type || 'text';
    let snippet: string | undefined;
    if (type === 'image') {
      snippet = `[Image]${message.image_metadata?.storage_path ? ` (${message.image_metadata.storage_path})` : ''}`;
    } else if (type === 'video') {
      snippet = `[Video]${message.video_metadata?.storage_path ? ` (${message.video_metadata.storage_path})` : ''}`;
    } else if (type === 'audio') {
      snippet = `[Voice message]${message.audio_metadata?.storage_path ? ` (${message.audio_metadata.storage_path})` : ''}`;
    } else {
      snippet = message.body || undefined;
    }
    return { id: message.id, type, snippet };
  };

  // Handle long press on message
  const handleMessageLongPress = (message: Message, event: any, isLastInRun: boolean = true) => {
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

    // For other users' messages we always open the menu — at minimum the
    // "Report" action is available, plus Reply/Copy when there's text or media.

    // Failed messages have no server row yet — edit/delete-via-server would
    // fail. Offer Retry / Delete (local) / Copy instead.
    if (isOwnMessage && message.upload_state === 'failed') {
      Alert.alert(
        'Message not sent',
        message.body || '',
        [
          { text: 'Resend', onPress: () => handleRetryTextMessage(message) },
          { text: 'Copy text', onPress: () => handleCopyMessageText(message) },
          { text: 'Delete', style: 'destructive', onPress: () => handleDeleteFailedMessage(message) },
          { text: 'Cancel', style: 'cancel' },
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
    // Was the keyboard up at long-press? If so we keep it up (re-focus below) and
    // budget its height so the in-tree menu sits above it.
    const wasKeyboardOpen = Math.abs(kbHeight.value) > 1;
    setMenuKeyboardHeight(
      wasKeyboardOpen
        ? Math.round(keyboardFullHeightRef.current || Math.abs(kbHeight.value))
        : 0,
    );

    // Only the last/newest bubble in a consecutive run keeps its sharp 2px tail
    // corner — earlier messages in the run are fully rounded (see the render-side
    // `!isLastInRun` override). The cutout must mirror that or the dim peeks past
    // the rounded corner of a tail-less bubble.
    const tailCorner = isLastInRun ? 2 : 16;
    // Mirror the bubble's real tail corner: own bubbles are pointy at
    // bottom-right (userMessageBubble borderBottomRightRadius: 2), other
    // bubbles at bottom-left (botMessageBubble borderBottomLeftRadius: 2).
    const radii = isOwnMessage
      ? { topLeft: 16, topRight: 16, bottomLeft: 16, bottomRight: tailCorner }
      : { topLeft: 16, topRight: 16, bottomLeft: tailCorner, bottomRight: 16 };
    // Remember it so the edit-mode re-measure keeps the same tail/no-tail cutout.
    editDimRadiiRef.current = radii;
    // Measure the bubble ONCE while the long-pressed row's ref is correct.
    // - Window coords (bubbleRect) feed the menu items' placement.
    // - Host-local coords (editDimRect = bubble − dim-host origin) feed the SINGLE
    //   in-tree BubbleSpotlightDim shared by the menu AND edit mode, so tapping
    //   Edit only removes the menu items while the dim stays put (no redraw).
    setBubbleRect(null);
    setEditDimRect(null);
    const bubbleRef = bubbleRefsRef.current.get(message.id);
    const dimHost = dimHostRef.current;
    if (bubbleRef && typeof bubbleRef.measureInWindow === 'function') {
      bubbleRef.measureInWindow((x: number, y: number, width: number, height: number) => {
        if (width > 0 && height > 0) {
          setBubbleRect({ x, y, width, height, radii, isOwn: isOwnMessage });
          if (dimHost && typeof dimHost.measureInWindow === 'function') {
            dimHost.measureInWindow((hx: number, hy: number) => {
              setEditDimRect({ x: x - hx, y: y - hy, width, height, radii });
            });
          }
        }
      });
    }

    // Use setTimeout to ensure selectedMessage is set before menu becomes visible
    setTimeout(() => {
      setMenuVisible(true);
      if (wasKeyboardOpen) chatInputRef.current?.focus?.();
    }, 0);
  };

  // Check if message can be edited (within 15 minutes)
  const canEditMessage = (message: Message): boolean => {
    if (!currentUserId || message.sender_id !== currentUserId) return false;
    if (message.deleted) return false;
    if (message.is_system) return false; // Prevent system message edit
    // Not yet confirmed by the server (id is still the temporary client id):
    // an edit would target a non-existent DB row and error out.
    if (!!message.client_id && message.id === message.client_id) return false;

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
    
    // Not yet confirmed by the server (id is still the temporary client id):
    // a delete would target a non-existent DB row and error out.
    if (!!message.client_id && message.id === message.client_id) {
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
            {typingCount > 1 && (
              <Text style={styles.typingCountText}>{typingCount} people typing…</Text>
            )}
          </View>
        </View>
      </View>
    );
  };

  // For inverted FlatList, data must be newest-first (first item renders at bottom)
  // State keeps messages chronological (oldest-first) for easy append/merge
  const invertedMessages = useMemo(() => dedupeMessages(messages).reverse(), [messages]);

  // Reacting to the newest message grows its cell — the badge hangs below the
  // bubble (MessageReactionsRow pulls itself up with a negative marginTop). The
  // list doesn't re-pin to the bottom, so that overhang lands under the composer
  // and the user has to scroll to see it. Re-pin whenever the newest message's
  // reactions change, but only if we were already at the bottom, so someone
  // reading history never gets yanked.
  const newestMessage = invertedMessages[0];
  const newestReactionSignature = newestMessage
    ? `${newestMessage.id}:${(newestMessage.reactions ?? []).reduce((n, r) => n + r.count, 0)}`
    : '';
  useEffect(() => {
    if (!newestMessage?.reactions?.length) return;
    if (!isNearBottomRef.current) return;
    scrollToBottomBase(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newestReactionSignature]);

  // Map of sender_id → display name, harvested from any message we have that
  // was already enriched. Lets reply previews resolve the original author's
  // name even when the stored snapshot is missing it (or has the legacy 'You'
  // value). Groups use this instead of `otherUserName`, which is the group
  // title, not a user's name.
  const senderNamesById = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of messages) {
      const name = m.sender_name || m.sender?.name;
      if (m.sender_id && name && !map.has(m.sender_id)) {
        map.set(m.sender_id, name);
      }
    }
    return map;
  }, [messages]);

  // user_id -> { name, avatar } for the reactions sheet. Message senders give
  // avatars for anyone who has posted; conversation members are authoritative
  // (covers reactors who haven't sent a message in the loaded window).
  const reactorInfoById = useMemo(() => {
    const map = new Map<string, ReactorInfo>();
    for (const m of messages) {
      if (m.sender_id && !map.has(m.sender_id)) {
        map.set(m.sender_id, {
          name: m.sender_name || m.sender?.name,
          avatar: m.sender_avatar || m.sender?.avatar || undefined,
        });
      }
    }
    const conv = providerConversations.find(c => c.id === currentConversationId);
    for (const mem of conv?.members ?? []) {
      map.set(mem.user_id, { name: mem.name, avatar: mem.profile_image_url });
    }
    return map;
  }, [messages, providerConversations, currentConversationId]);

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
    // "Last/newest of run" (visually bottom): keeps the avatar + the bubble tail.
    // True when the message below has a different sender, or this is the newest.
    const isLastInRun = !sameSender;
    // "First/oldest of run" (visually top): the sender name renders here now
    // (WhatsApp-style), while the avatar stays on the last/newest below.
    const olderMessage = invertedMessages[index + 1];
    const isFirstInRun = !olderMessage || olderMessage.sender_id !== item.sender_id;
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
        <SafeMessageBubble messageId={item.id}>
          {renderMessage(item, isLastInRun, isFirstInRun)}
        </SafeMessageBubble>
      </Reanimated.View>
    );
  }, [currentUserId, editingMessageId, isDirect, menuVisible, selectedMessage, otherUserLastReadAt, invertedMessages, highlightedMessageId, resolvingReplyJumpId]);

  // Prefer client_id so the React key stays stable across the optimistic →
  // server-confirmed swap. Without this, FlatList unmounts the old wrapper
  // and mounts a new one mid-flight, cutting the entering animation in half.
  const keyExtractor = useCallback((item: Message) => item.client_id || item.id, []);

  // In inverted FlatList: ListHeaderComponent renders at bottom, ListFooterComponent renders at top
  const listHeaderComponent = useMemo(() => <TypingIndicator />, [isTyping, typingCount]);

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

  const renderMessage = (message: Message, isLastInRun: boolean = true, isFirstInRun: boolean = true) => {
    // System banner (e.g. "X left the group", "Y removed X", "X joined the group").
    // Renders as a centered pill — no avatar, no sender name, no timestamp, no
    // reply/edit affordance. Bypasses every interaction handler below.
    if (message.is_system) {
      return (
        <View style={styles.systemBannerRow}>
          <Text style={styles.systemBannerText}>{message.body}</Text>
        </View>
      );
    }

    // CRITICAL: Render messages even if currentUserId isn't available yet
    // We can determine message alignment from sender_id comparison
    // For now, render all messages as received (will update when currentUserId loads)
    // This allows messages to appear instantly while currentUserId loads in background


    const isOwnMessage = currentUserId ? message.sender_id === currentUserId : false;
    const isEditing = editingMessageId === message.id;
    // Emoji-only bodies (no reply, not deleted) render at an enlarged font that
    // shrinks as the count grows. A single emoji also drops the bubble (jumbo);
    // 2-3 emoji keep the bubble and only take the bigger font.
    const jumbo = getEmojiOnlyInfo(message.body);
    const bigEmojiOk = !message.deleted && !message.reply_to_snapshot;
    const isJumbo = jumbo.isJumbo && bigEmojiOk;
    const bigEmojiSize = bigEmojiOk && !isJumbo ? getEmojiFontSize(jumbo.count) : null;
    const bigEmojiTextStyle = bigEmojiSize
      ? { fontSize: bigEmojiSize, lineHeight: Math.round(bigEmojiSize * 1.2) }
      : null;
    const canEdit = canEditMessage(message);
    // English/LTR sticks left, Hebrew/Arabic sticks right. Computed once
    // per message and applied to every Text that renders the body content.
    const bodyTextAlign = getBodyTextAlign(message.body);
    // For RTL bodies the timestamp always sits BELOW the body text — body
    // and timestamp stack vertically instead of sharing a row. (LTR keeps
    // the WhatsApp-style inline-when-it-fits, wrap-when-it-doesn't layout.)
    const isRtl = bodyTextAlign === 'right';

    // Group chats: sender name on the FIRST/oldest message of a run (top), avatar on
    // the LAST/newest message (bottom). Mid-run messages reserve avatar space so
    // bubble alignment stays consistent.
    const isGroupReceived = !isOwnMessage && !isDirect;
    const senderName = message.sender_name || message.sender?.name || otherUserName;
    // Avatar source is the SENDER's own photo only — never fall back to
    // otherUserAvatar (in a group that's the group cover, which would wrongly show
    // as a member's avatar). No photo → initials placeholder (the default avatar).
    const senderAvatar = message.sender_avatar || message.sender?.avatar || null;
    // Group received messages show the sender avatar OUTSIDE on the left (last of
    // a run). Audio bubbles additionally render an inside avatar (WhatsApp-style),
    // so group voice notes intentionally show both — per product decision.
    const showAvatar = isGroupReceived && isLastInRun && (message.sender_name || message.sender_avatar);
    const showAvatarSpacer = isGroupReceived && !isLastInRun;
    const showSenderName = isGroupReceived && isFirstInRun && !!senderName;
    const senderNameColor = isGroupReceived ? getSenderColor(message.sender_id) : undefined;

    // Photo/video bubbles get a thin visible bubble frame around the media
    // (WhatsApp-style) instead of the image bleeding to the bubble edges.
    const isPhotoOrVideo =
      message.type === 'image' || !!message.image_metadata ||
      message.type === 'video' || !!message.video_metadata;
    
    const canSwipeReply =
      !message.deleted &&
      !message.is_system &&
      message.upload_state !== 'failed';

    return (
      <SwipeToReplyWrapper
        key={message.id}
        enabled={canSwipeReply}
        onReply={() => {
          setReplyingTo(message);
          chatInputRef.current?.focus?.();
        }}
      >
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => Keyboard.dismiss()}
        onLongPress={(e) => handleMessageLongPress(message, e, isLastInRun)}
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
              // Render the 32px thumbnail (memory-disk cached via expo-image),
              // not the full profile image. ProfileImage falls back to the
              // original when the best-effort thumb is missing.
              <ProfileImage
                imageUrl={getStorageThumbUrl(senderAvatar, 32)}
                fallbackImageUrl={senderAvatar}
                name={senderName}
                style={styles.messageAvatar}
                showLoadingIndicator={false}
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
          ref={(node) => {
            if (node) bubbleRefsRef.current.set(message.id, node);
            else bubbleRefsRef.current.delete(message.id);
          }}
          isHighlighted={highlightedMessageId === message.id}
          onAnimationEnd={() => setHighlightedMessageId(null)}
          style={[
            styles.messageBubble,
            isOwnMessage ? styles.userMessageBubble : styles.botMessageBubble,
            // Consecutive run: only the last/newest bubble keeps its tail (the sharp
            // 2px corner). Earlier messages in the run are fully rounded. overflow:hidden
            // on media bubbles makes this clip photos/videos to the rounded corner too.
            !isLastInRun && (isOwnMessage
              ? { borderBottomRightRadius: 16 }
              : { borderBottomLeftRadius: 16 }),
            // Conditionally apply padding: 0 for images/videos/audio, normal for text.
            // `!message.deleted &&`: a deleted media message renders the text-style
            // placeholder, so it must NOT get the media-frame styling.
            !message.deleted && (message.type === 'image' || message.image_metadata || message.type === 'video' || message.video_metadata || message.type === 'audio') && styles.imageMessageBubble,
            // Photo/video: thin bubble frame visible around the media (WhatsApp-style)
            !message.deleted && isPhotoOrVideo && styles.mediaFrameBubble,
            // Remove maxWidth constraint for deleted messages from other user
            message.deleted && !isOwnMessage && {
              maxWidth: Dimensions.get('window').width - 120, // Screen width minus padding
              alignSelf: 'flex-start',
            },
            // Jumbo emoji: strip the bubble (transparent, no padding/shadow).
            isJumbo && jumboBubbleStyle,
          ]}
        >
          {showSenderName && (
            <TouchableOpacity
              onPress={() => message.sender_id && onViewProfile?.(message.sender_id)}
              activeOpacity={0.7}
              style={[
                styles.groupSenderNameTouchable,
                // Photo/video are padding-0; a small inset keeps the name off the
                // corner. Audio is padding-0 too, but its content sits at 10px, so
                // align the name to 10px to match the waveform start + normal messages.
                isPhotoOrVideo && styles.groupSenderNameTouchableMedia,
                message.type === 'audio' && styles.groupSenderNameTouchableAudio,
              ]}
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
              style={[
                // Stretch to the full bubble width so the grey quote bubble
                // reaches the end (matches the body container's width:100%).
                // QuotedMessagePreview's own alignSelf:'stretch' can only fill
                // this wrapper, so the wrapper itself must span the bubble.
                styles.quotedPreviewWrap,
                (message.type === 'image' || message.image_metadata ||
                 message.type === 'video' || message.video_metadata ||
                 message.type === 'audio') && styles.quotedPreviewMediaWrap,
              ]}
            >
              <QuotedMessagePreview
                snapshot={message.reply_to_snapshot}
                isOwnBubble={isOwnMessage}
                currentUserId={currentUserId}
                fallbackName={
                  senderNamesById.get(message.reply_to_snapshot.sender_id) || ''
                }
                onPress={() => handleReplyPreviewPress(message.reply_to_snapshot!.message_id)}
                isLoading={resolvingReplyJumpId === message.reply_to_snapshot.message_id}
              />
            </View>
          )}
          {/* Deleted check FIRST: a deleted media message (type still
              'image'/'video'/'audio', metadata cleared) must NOT hit the media
              branches and render a blank frame — fall through to the text
              branch which renders the deleted placeholder. */}
          {!message.deleted && message.type === 'file' ? (
            <View>
              <FileBubble
                message={message}
                isOwn={isOwnMessage}
                onLongPress={(e) => handleMessageLongPress(message, e, isLastInRun)}
                textAlign={getBodyTextAlign(message.body)}
              />
              <View style={styles.attachmentFooter}>
                <Text style={[styles.timestamp, isOwnMessage ? styles.userTimestamp : styles.botTimestamp]}>
                  {formatTime(message.created_at)}
                </Text>
                {isOwnMessage && !message.deleted && (
                  <ReadReceipt state={getReceiptState(message, otherUserLastReadAt)} enabled={isDirect} />
                )}
              </View>
              {message.upload_state === 'uploading' && (
                <View style={styles.attachmentStatusRow}>
                  <ActivityIndicator size="small" color={isOwnMessage ? '#FFFFFF' : '#05BCD3'} />
                  <Text style={[styles.attachmentStatusText, { color: isOwnMessage ? 'rgba(255,255,255,0.9)' : '#6B7076' }]}>Uploading…</Text>
                </View>
              )}
              {message.upload_state === 'failed' && (
                <View style={styles.attachmentStatusRow}>
                  <TouchableOpacity onPress={() => handleRetryUpload(message)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                    <Text style={[styles.attachmentActionText, { color: isOwnMessage ? '#FFFFFF' : '#05BCD3' }]}>Retry</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => handleRemoveFailedMedia(message)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                    <Text style={[styles.attachmentActionText, { color: '#E53935' }]}>Remove</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          ) : !message.deleted && message.type === 'contact' ? (
            <Pressable onLongPress={(e) => handleMessageLongPress(message, e, isLastInRun)} delayLongPress={300}>
              <ContactBubble message={message} isOwn={isOwnMessage} />
              <View style={styles.attachmentFooter}>
                <Text style={[styles.timestamp, isOwnMessage ? styles.userTimestamp : styles.botTimestamp]}>
                  {formatTime(message.created_at)}
                </Text>
                {isOwnMessage && !message.deleted && (
                  <ReadReceipt state={getReceiptState(message, otherUserLastReadAt)} enabled={isDirect} />
                )}
              </View>
            </Pressable>
          ) : !message.deleted && message.type === 'audio' ? (
            <View>
              <AudioMessageBubble
                message={message}
                isOwn={isOwnMessage}
                onLongPress={(e) => handleMessageLongPress(message, e, isLastInRun)}
                avatarUrl={isOwnMessage ? (senderAvatar || myProfile?.profile_image_url || null) : (senderAvatar || otherUserAvatar)}
                senderName={isOwnMessage ? (myProfile?.name || undefined) : (message.sender_name || message.sender?.name || otherUserName || undefined)}
                timeText={formatTime(message.created_at)}
                receipt={isOwnMessage && !message.deleted ? (
                  <ReadReceipt state={getReceiptState(message, otherUserLastReadAt)} enabled={isDirect} />
                ) : undefined}
              />
              {isOwnMessage && message.upload_state === 'failed' && !message.deleted && (
                <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', gap: 12, paddingHorizontal: 10, paddingBottom: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Ionicons name="alert-circle" size={14} color="#E53935" />
                    <Text style={{ fontSize: 12, color: '#E53935' }}>Failed to send</Text>
                  </View>
                  <TouchableOpacity onPress={() => handleRetryUpload(message)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                    <Text style={{ fontSize: 12, fontWeight: '600', color: colors.brandTeal }}>Retry</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => handleRemoveFailedMedia(message)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                    <Text style={{ fontSize: 12, fontWeight: '600', color: '#E53935' }}>Remove</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          ) : !message.deleted && (message.type === 'video' || message.video_metadata) ? (
            // Video message
            (() => {
              const thumbnailUri = message.video_metadata?.thumbnail_url || message._localPreviewUri || '';
              // DM videos are private — we never store a playable URL. The S3 key is
              // stored in storage_path and signed on-demand at tap time. (playableUrl
              // is kept only as a fallback for any legacy non-S3 message.)
              const storagePath = message.video_metadata?.storage_path || '';
              const playableUrl = message.video_metadata?.video_url || message.video_metadata?.original_url || '';
              const videoReady = !!(storagePath || playableUrl);
              const isSigning = signingVideoId === message.id;
              const rawAspectRatio = message.video_metadata?.width && message.video_metadata?.height
                ? message.video_metadata.width / message.video_metadata.height : 16 / 9;
              // Clamp portrait videos at 3:4 so the bubble doesn't dominate the screen.
              // Thumbnail uses resizeMode="cover" so the visible frame just crops cleanly.
              // Clamp both extremes (WhatsApp-style): portrait floors at 1:1,
              // very-wide/panorama caps at 2:1 — beyond that the media center-crops
              // (cover) instead of rendering as a thin sliver. Tap opens the full image.
              const aspectRatio = Math.min(Math.max(rawAspectRatio, 1), 2);
              const isUploading = message.upload_state === 'uploading';
              const isFailed = message.upload_state === 'failed';

              const openVideo = async () => {
                if (!videoReady || isUploading || isFailed || isSigning) return;
                if (storagePath) {
                  try {
                    setSigningVideoId(message.id);
                    const { signDmVideoUrl } = await import('../services/messaging/videoUploadService');
                    const signedUrl = await signDmVideoUrl(storagePath);
                    setFullscreenVideoUrl(signedUrl || playableUrl || null);
                  } finally {
                    setSigningVideoId(null);
                  }
                } else if (playableUrl) {
                  setFullscreenVideoUrl(playableUrl);
                }
              };

              return (
                <View style={styles.imageMessageWrapper}>
                  <TouchableOpacity
                    activeOpacity={0.9}
                    onPress={openVideo}
                    onLongPress={(e) => handleMessageLongPress(message, e, isLastInRun)}
                    disabled={!videoReady || isUploading || isFailed || isSigning}
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
                    {isSigning ? (
                      <View style={styles.videoPlayOverlay}>
                        <ActivityIndicator size="large" color="#FFFFFF" />
                      </View>
                    ) : videoReady && !isUploading && !isFailed ? (
                      <View style={styles.videoPlayOverlay}>
                        <Ionicons name="play-circle" size={48} color="rgba(255,255,255,0.9)" />
                      </View>
                    ) : isFailed ? (
                      <View style={styles.failedOverlay}>
                        <Ionicons name="alert-circle" size={26} color="#FFFFFF" />
                        <Text style={styles.failedText}>Failed to send</Text>
                        <TouchableOpacity
                          style={styles.retryButton}
                          onPress={() => handleRetryUpload(message)}
                          activeOpacity={0.8}
                        >
                          <Ionicons name="refresh" size={15} color="#FFFFFF" style={styles.retryIcon} />
                          <Text style={styles.retryButtonText}>Retry</Text>
                        </TouchableOpacity>
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
                      { textAlign: bodyTextAlign },
                    ]}>
                      {message.body}
                    </Text>
                  )}
                </View>
              );
            })()
          ) : !message.deleted && (message.type === 'image' || message.image_metadata) ? (
            // Image message - redesigned layout
            (() => {
              const fullImageUri = message.image_metadata?.image_url
                || message._localPreviewUri
                || '';
              const thumbnailUri = message.image_metadata?.thumbnail_url || '';
              const imageWidth = message.image_metadata?.width || 1;
              const imageHeight = message.image_metadata?.height || 1;
              const rawAspectRatio = imageWidth > 0 && imageHeight > 0 ? imageWidth / imageHeight : 1;
              // Clamp portrait images at 1:1 so the bubble doesn't dominate the screen.
              // Matches the video bubble behavior; contentFit="cover" crops cleanly.
              // Clamp both extremes (WhatsApp-style): portrait floors at 1:1,
              // very-wide/panorama caps at 2:1 — beyond that the media center-crops
              // (cover) instead of rendering as a thin sliver. Tap opens the full image.
              const aspectRatio = Math.min(Math.max(rawAspectRatio, 1), 2);

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
                    onLongPress={(e) => handleMessageLongPress(message, e, isLastInRun)}
                    disabled={message.upload_state === 'uploading' || message.upload_state === 'failed'}
                    style={styles.imageTouchable}
                  >
                    <ExpoImage
                      // Inline bubble renders the 600px thumbnail (~40-80KB), not
                      // the full 2560px original — the original is only fetched on
                      // tap (fullscreen). Legacy messages with no thumbnail_url fall
                      // back to the original so they still render.
                      source={{ uri: thumbnailUri || fullImageUri }}
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
                        <Ionicons name="alert-circle" size={26} color="#FFFFFF" />
                        <Text style={styles.failedText}>Failed to send</Text>
                        <TouchableOpacity
                          style={styles.retryButton}
                          onPress={() => handleRetryUpload(message)}
                          activeOpacity={0.8}
                        >
                          <Ionicons name="refresh" size={15} color="#FFFFFF" style={styles.retryIcon} />
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
          ) : isJumbo ? (
            <JumboEmojiMessage
              body={message.body || ''}
              count={jumbo.count}
              isOwn={isOwnMessage}
              timeText={formatTime(message.created_at)}
              receipt={isOwnMessage ? (
                <ReadReceipt state={getReceiptState(message, otherUserLastReadAt)} enabled={isDirect} />
              ) : undefined}
            />
          ) : (
            // Text message
            <>
              <View style={[
                styles.messageTextContainer,
                // Allow full width for deleted messages from other user
                message.deleted && !isOwnMessage && styles.deletedMessageTextContainer,
              ]}>
                {message.deleted ? (
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
                ) : isRtl || bigEmojiSize ? (
                  // Stacked layout (timestamp below the body), used for:
                  //  - RTL bodies, whose inline spacer trick doesn't hold up.
                  //  - Emoji-only bodies of 2-3 emoji, which render at 42/34px:
                  //    an inline timestamp next to a glyph that tall reads as a
                  //    caption stuck to its side. WhatsApp drops it underneath.
                  <Reanimated.View
                    style={{
                      flexDirection: 'column',
                      alignItems: 'flex-end',
                    }}
                    layout={LinearTransition.duration(240)}
                  >
                    <Text style={[
                      isOwnMessage ? styles.userMessageText : styles.botMessageText,
                      { textAlign: bodyTextAlign },
                      bigEmojiTextStyle,
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
                          <Text style={[styles.editedBadge, isOwnMessage && styles.editedBadgeOwn]}>  (edited)</Text>
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
                      { textAlign: bodyTextAlign },
                      bigEmojiTextStyle,
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
                        // Match the bubble background instead of using
                        // `color: 'transparent'`. Android's nested-Text
                        // renderer treats fully-transparent foreground spans
                        // as "unset" and falls back to the parent color, so
                        // the spacer ends up visible (duplicate timestamp).
                        // Background-matched color is invisible to the eye
                        // but rendered as a concrete value Android respects.
                        { color: isOwnMessage ? '#05BCD3' : '#FFFFFF' },
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
                          <Text style={[styles.editedBadge, isOwnMessage && styles.editedBadgeOwn]}>  (edited)</Text>
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
              {message.deleted && (
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
                        <Text style={[styles.editedBadge, isOwnMessage && styles.editedBadgeOwn]}>  (edited)</Text>
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
                        <Text style={[styles.editedBadge, isOwnMessage && styles.editedBadgeOwn]}>  (edited)</Text>
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
      {!message.deleted && message.reactions && message.reactions.length > 0 && (
        <MessageReactionsRow
          reactions={message.reactions}
          ownAlignment={isOwnMessage ? 'right' : 'left'}
          // Group incoming bubbles are offset by the avatar lane (32 + 8);
          // align the badge to the bubble's left edge, not the avatar.
          leftInset={isDirect ? 2 : 42}
          // Fade the pill out while THIS bubble is the one lifted by the
          // spotlight — it sits outside the cutout, so it would read as a
          // blurred smear hanging off a sharp bubble.
          hidden={
            (menuVisible && selectedMessage?.id === message.id) ||
            editingMessageId === message.id
          }
          // Tapping a reaction pill opens the WhatsApp-style "who reacted" sheet
          // (add/remove happens inside it), instead of toggling inline.
          onPress={(emoji) => setReactionsSheet({ messageId: message.id, emoji })}
        />
      )}
      </SwipeToReplyWrapper>
    );
  };

  // The header "report user" action still uses the full-screen flow. Message
  // reports use the in-chat ReportMessageSheet (rendered below) instead.
  if (showReportUser) {
    return (
      <ReportUserScreen
        reportedUserId={otherUserId}
        reportedUserName={otherUserName}
        onBack={() => setShowReportUser(false)}
        onReturnHome={() => {
          setShowReportUser(false);
          onBack?.();
        }}
        onBlocked={() => {
          setShowReportUser(false);
          onBack?.();
        }}
      />
    );
  }

  return (
    <ChatErrorBoundary resetKeys={[currentConversationId]} onGoBack={onBack}>
    <View style={{ flex: 1 }}>
    <SafeAreaView style={[styles.container, { backgroundColor: '#212121' }]} edges={['top']}>
      {/* Header */}
      <View style={[styles.headerContainer, { paddingTop: insets.top + (Platform.OS === 'web' ? 24 : 12) }]}>
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
                } else if (surftripId && onOpenSurftripDetail) {
                  onOpenSurftripDetail(surftripId);
                } else if (tripId && onOpenTripDetail) {
                  onOpenTripDetail(tripId);
                }
              }}
              activeOpacity={(isDirect || (surftripId && onOpenSurftripDetail) || (tripId && onOpenTripDetail)) ? 0.7 : 1}
            >
              {isDirect ? (
                <ProfileImage
                  imageUrl={otherUserAvatar}
                  name={otherUserName}
                  style={styles.avatarImage}
                  showLoadingIndicator={false}
                />
              ) : otherUserAvatar ? (
                <ProfileImage
                  imageUrl={otherUserAvatar}
                  name={otherUserName}
                  style={styles.avatarImage}
                  showLoadingIndicator={false}
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
              } else if (surftripId && onOpenSurftripDetail) {
                onOpenSurftripDetail(surftripId);
              } else if (tripId && onOpenTripDetail) {
                onOpenTripDetail(tripId);
              }
            }}
            activeOpacity={(isDirect || (surftripId && onOpenSurftripDetail) || (tripId && onOpenTripDetail)) ? 0.7 : 1}
          >
            <View style={styles.profileInfoInner}>
              <Text style={styles.profileName} numberOfLines={1}>
                {otherUserName}
              </Text>
              {onlineStatusElement}
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.headerMenuButton}
            onPress={() => setShowChatMenu(true)}
            hitSlop={{ top: 16, bottom: 16, left: 12, right: 16 }}
          >
            <Ionicons name="ellipsis-vertical" size={22} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Chat menu dropdown - rendered outside header to avoid overflow clipping */}
      {showChatMenu && (
        <View style={styles.dmMenuDropdown}>
          {mutedUntil ? (
            <TouchableOpacity
              style={styles.dmMenuItem}
              activeOpacity={0.7}
              onPress={() => { setShowChatMenu(false); applyMute(null); }}
            >
              <Ionicons name="notifications-outline" size={20} color="#222B30" />
              <Text style={styles.dmMenuItemText}>Unmute</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.dmMenuItem}
              activeOpacity={0.7}
              onPress={() => { setShowChatMenu(false); setShowMuteModal(true); }}
            >
              <Ionicons name="notifications-off-outline" size={20} color="#222B30" />
              <Text style={styles.dmMenuItemText}>Mute notifications</Text>
            </TouchableOpacity>
          )}
          {isDirect && (
            <>
              <TouchableOpacity style={styles.dmMenuItem} activeOpacity={0.7} onPress={() => { setShowChatMenu(false); setShowReportUser(true); }}>
                <Ionicons name="alert-circle-outline" size={20} color="#222B30" />
                <Text style={styles.dmMenuItemText}>Report</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.dmMenuItem} activeOpacity={0.7} onPress={() => { setShowChatMenu(false); setShowBlockOverlay(true); }}>
                <Ionicons name="ban-outline" size={20} color="#222B30" />
                <Text style={styles.dmMenuItemText}>Block</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

      {/* Dismiss menu on tap outside */}
      {showChatMenu && (
        <TouchableOpacity style={[StyleSheet.absoluteFill, { zIndex: 9998 }]} activeOpacity={1} onPress={() => setShowChatMenu(false)} />
      )}

      {/* Mute duration picker */}
      <Modal
        visible={showMuteModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowMuteModal(false)}
      >
        <TouchableOpacity
          style={styles.muteModalBackdrop}
          activeOpacity={1}
          onPress={() => setShowMuteModal(false)}
        >
          <TouchableOpacity activeOpacity={1} style={styles.muteModalCard}>
            <Text style={styles.muteModalTitle}>Mute notifications</Text>
            <TouchableOpacity
              style={styles.muteOption}
              activeOpacity={0.7}
              onPress={() => { setShowMuteModal(false); applyMute(new Date(Date.now() + 8 * 60 * 60 * 1000)); }}
            >
              <Text style={styles.muteOptionText}>8 hours</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.muteOption}
              activeOpacity={0.7}
              onPress={() => { setShowMuteModal(false); applyMute(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)); }}
            >
              <Text style={styles.muteOptionText}>1 week</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.muteOption}
              activeOpacity={0.7}
              onPress={() => { setShowMuteModal(false); applyMute(MUTE_ALWAYS_UNTIL); }}
            >
              <Text style={styles.muteOptionText}>Always</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.muteOption, styles.muteCancel]}
              activeOpacity={0.7}
              onPress={() => setShowMuteModal(false)}
            >
              <Text style={[styles.muteOptionText, styles.muteCancelText]}>Cancel</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Chat Messages */}
      {(() => {
        // The chat area (messages + composer) is wrapped in a Reanimated.View
        // whose paddingBottom tracks keyboard height (via useReanimatedKeyboardAnimation).
        // This is a manual behavior='padding' that avoids measureLayout — so it
        // works correctly even nested inside react-native-screen-transitions'
        // transformed ContentLayer, where the normal KAV fails.
        // KeyboardGestureArea is only useful on Android — iOS already supports
        // interactive keyboard dismiss natively via FlatList's keyboardDismissMode.
        // On iOS in react-native-keyboard-controller v1.18.5, wrapping the chat
        // in KeyboardGestureArea was leaving a phantom gap between the input bar
        // and the keyboard top, AND opening this screen polluted the native
        // KeyboardController state so the gap then appeared in DMs too — same
        // gating as DirectMessageScreen.tsx.
        const useGestureArea = !isExpoGo && KeyboardGestureArea != null && Platform.OS === 'android';
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
            onScrollBeginDrag={() => {
              // The user physically grabbed the list — from now on onScroll may
              // mark them "away from bottom". (Before this, a layout-driven
              // onScroll must not un-pin a fresh mount; see hasUserScrolledRef.)
              hasUserScrolledRef.current = true;
              // Dragging the chat dismisses the keyboard (keyboardDismissMode); the
              // panel follows the same rule. iOS's 'interactive' mode has no analogue
              // here — we can't drag the panel down with the finger — so closing at the
              // start of the drag is as close as it gets. CLOSE is a no-op when the
              // panel is already shut, so this costs nothing the rest of the time.
              closePanel();
            }}
            onScroll={(event) => {
              handleKeyboardScroll(event);
              const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
              const maxOffset = contentSize.height - layoutMeasurement.height;
              const distanceFromTop = maxOffset - contentOffset.y;
              // Inverted list → small contentOffset.y means at the visual bottom.
              const nearBottom = contentOffset.y < 200;
              // Always allow re-pinning when we're actually at the bottom, but only
              // allow UN-pinning once the user has really scrolled — so a stray
              // onScroll during initial layout can't leave a fresh mount un-pinned.
              if (nearBottom) {
                isNearBottomRef.current = true;
              } else if (hasUserScrolledRef.current) {
                isNearBottomRef.current = false;
              }
              if (distanceFromTop < 200 && hasMoreMessagesRef.current && !isLoadingOlderRef.current) {
                loadOlderMessages();
              }
            }}
            scrollEventThrottle={16}
            onLayout={handleLayout}
            initialNumToRender={20}
            maxToRenderPerBatch={15}
            windowSize={7}
            // iOS-native scroll anchoring so prepend/trim don't jump the viewport.
            // Android anchoring (via @stream-io/flat-list-mvcp) is a deferred follow-up.
            maintainVisibleContentPosition={{ minIndexForVisible: 1 }}
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
              {/* ONE input for composing AND editing. Editing flips ChatTextInput to
                  editMode (⊗ cancel + ✓ save, message body as value) — the SAME
                  native input is reused, so the keyboard never dismisses/reopens on
                  Edit (swapping to a separate editor did). */}
              <ChatTextInput
                ref={chatInputRef}
                testID="group-chat-input"
                nativeID={composerNativeID}
                editMode={!!editingMessageId}
                value={editingMessageId ? editingText : inputText}
                onChangeText={editingMessageId ? setEditingText : setInputText}
                onSend={sendMessage}
                onSaveEdit={() => { if (editingMessageId) handleEditMessage(editingMessageId, editingText); }}
                disabled={isLoading}
                placeholder={editingMessageId ? 'Edit message' : 'Type your message..'}
                maxLength={500}
                // Send button tracks the other user's advice-role bubble color so
                // the composer feels "themed" per chat: teal for seekers, beige
                // for givers, Swelly purple (same as Swelly chat user bubbles) otherwise.
                primaryColor={composerPrimaryColor}
                onVoiceMessage={handleVoiceMessage}
                onCameraPress={handleCameraCapture}
                leftAccessory={
                  editingMessageId ? (
                    <TouchableOpacity
                      style={styles.editCancelButton}
                      onPress={() => { setEditingMessageId(null); setEditingText(''); }}
                      hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
                    >
                      <Ionicons name="close" size={22} color="#3A3A3A" />
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={styles.attachButton}
                      onPress={() => {
                        // Closed → open the panel. Open → the icon says "keyboard",
                        // so give them the keyboard: focusing raises it over the
                        // panel, and keyboardDidShow unmounts the panel behind it.
                        // Merely toggling shut would leave neither, which the icon
                        // does not promise. requestKeyboard() flips the glyph back to
                        // "+" now rather than when the keyboard finishes rising.
                        if (panelOpen) {
                          requestKeyboard();
                          chatInputRef.current?.focus?.();
                        } else {
                          togglePanel();
                        }
                      }}
                      hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
                      accessibilityRole="button"
                      accessibilityLabel={showKeyboardIcon ? 'Show keyboard' : 'Add attachment'}
                    >
                      {/* The button always names where it takes you: the attachment
                          menu, or back to the keyboard it replaced. Ionicons has no
                          keyboard glyph — only `keypad`, which is a dialpad. */}
                      {showKeyboardIcon ? (
                        <MaterialCommunityIcons name="keyboard-outline" size={26} color="#222B30" />
                      ) : (
                        <Ionicons name="add" size={28} color="#222B30" />
                      )}
                    </TouchableOpacity>
                  )
                }
              />
            </View>
            </View>
          </Reanimated.View>
        );

        const inner = (
          <View ref={dimHostRef} style={{ flex: 1 }}>
            <ImageBackground
              source={Images.chatBackground}
              style={[styles.backgroundImage, { pointerEvents: 'none' }]}
              resizeMode="cover"
            />
            <Reanimated.View style={[{ flex: 1 }, animatedKeyboardPadding]}>
              {/* A tap on the chat's background closes the attach panel, mirroring the
                  keyboard's own dismiss. Not a full-screen backdrop: that would swallow
                  bubble taps and block scrolling. RN's responder negotiation runs from
                  the deepest node up, so a bubble's Touchable claims the touch first and
                  this only sees what nothing else wanted — exactly what
                  keyboardShouldPersistTaps="handled" means for the keyboard. The
                  ScrollView can still steal the responder when a drag begins. */}
              <View
                style={{ flex: 1 }}
                onStartShouldSetResponder={() => panelOpen}
                onResponderRelease={closePanel}
              >
                {messageList}
              </View>
              {showReturnToLatest && (
                <TouchableOpacity style={styles.returnToLatestPill} onPress={handleReturnToLatest}>
                  <Text style={styles.returnToLatestText}>Return to latest ↓</Text>
                </TouchableOpacity>
              )}
              {editDimRect && (menuVisible || editingMessageId) && (
                <BubbleSpotlightDim
                  rect={editDimRect}
                  onPress={() => { setEditingMessageId(null); setEditingText(''); }}
                />
              )}
              {composer}
              {panelOpen && (
                <AttachPanel
                  height={panelHeight}
                  onPhotos={handleImagePicker}
                  onCamera={handleCameraCapture}
                  onDocument={handlePickDocument}
                  onContact={handlePickContact}
                />
              )}
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


      {/* WhatsApp-style attach menu (Photos / Camera / Document / Contact) */}
      {/* In-chat "report this message" bottom sheet */}
      <ReportMessageSheet
        visible={reportSheetVisible}
        reportedUserId={reportTarget?.userId ?? otherUserId}
        reportedUserName={reportTarget?.name ?? otherUserName}
        reportedMessage={reportMessageContext}
        onClose={() => {
          setReportSheetVisible(false);
          setReportMessageContext(null);
          setReportTarget(null);
        }}
        onBlocked={() => {
          setReportSheetVisible(false);
          setReportMessageContext(null);
          setReportTarget(null);
          onBack?.();
        }}
      />

      {/* WhatsApp-style "who reacted" sheet. Reactions are re-derived from the
          live message so add/remove inside the sheet updates it in place. */}
      <ReactionsDetailSheet
        visible={!!reactionsSheet}
        onClose={() => setReactionsSheet(null)}
        reactions={
          (reactionsSheet && messages.find(m => m.id === reactionsSheet.messageId)?.reactions) || []
        }
        currentUserId={currentUserId}
        membersById={reactorInfoById}
        initialEmoji={reactionsSheet?.emoji}
        onRemoveOwn={() => reactionsSheet && removeReaction(reactionsSheet.messageId)}
        onAddReaction={(emoji) => reactionsSheet && setReaction(reactionsSheet.messageId, emoji)}
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

      {/* File Preview Modal — review the document, add a comment, then send. */}
      {pendingFile && (
        <FilePreviewModal
          visible={filePreviewVisible}
          file={pendingFile}
          onSend={(caption) => {
            const f = pendingFile;
            setFilePreviewVisible(false);
            setPendingFile(null);
            if (f) {
              void handleFileSend(f.uri, {
                display_name: f.display_name,
                ext: f.ext,
                mime_type: f.mime_type,
                size_bytes: f.size_bytes,
              }, caption);
            }
          }}
          onCancel={() => {
            setFilePreviewVisible(false);
            setPendingFile(null);
          }}
          primaryColor={composerPrimaryColor}
        />
      )}

      {/* Contact Preview Modal — choose which numbers/emails to share. */}
      {pendingContact && (
        <ContactPreviewModal
          visible={contactPreviewVisible}
          contact={pendingContact}
          onSend={(filtered) => {
            setContactPreviewVisible(false);
            setPendingContact(null);
            void sendContact(filtered);
          }}
          onCancel={() => {
            setContactPreviewVisible(false);
            setPendingContact(null);
          }}
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

      {/* In-app chat camera: WhatsApp-style shutter + recent-media filmstrip */}
      {Platform.OS !== 'web' && (
        <ChatCameraModal
          visible={cameraVisible}
          onCancel={() => setCameraVisible(false)}
          onCapture={routeCapturedAsset}
          onOpenGallery={() => {
            setCameraVisible(false);
            setTimeout(() => { void handleImagePicker(); }, Platform.OS === 'ios' ? 400 : 50);
          }}
        />
      )}
      <BlockUserOverlay
        visible={showBlockOverlay}
        userId={otherUserId}
        userName={otherUserName}
        onClose={() => setShowBlockOverlay(false)}
        onBlocked={() => {
          setShowBlockOverlay(false);
          onBack?.();
        }}
      />
    </SafeAreaView>
      {/* Message Actions Menu */}
      <MessageActionsMenu
        visible={menuVisible}
        onClose={() => {
          setMenuVisible(false);
          setSelectedMessage(null);
          setBubbleRect(null);
        }}
        onEdit={() => {
          if (selectedMessage && canEditMessage(selectedMessage)) {
            // Flip the SAME composer input into edit mode — no input swap, so the
            // keyboard never moves. Focus it so the keyboard is up for editing
            // (no-op/seamless if it's already up from the menu re-focus).
            setEditingText(selectedMessage.body || '');
            setEditingMessageId(selectedMessage.id);
            chatInputRef.current?.focus?.();
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
        onReport={() => {
          if (selectedMessage) {
            const senderName =
              selectedMessage.sender_name ||
              selectedMessage.sender?.name ||
              senderNamesById.get(selectedMessage.sender_id) ||
              'this user';
            setReportTarget({ userId: selectedMessage.sender_id, name: senderName });
            setReportMessageContext(describeMessageForReport(selectedMessage));
            // The actions menu is a Modal and the report sheet is a Modal too
            // (BottomSheetShell). Opening the second in the same frame the first
            // dismisses makes iOS drop the presentation, so the sheet never shows.
            // Wait for the menu's fade-out to finish, then present the sheet.
            setTimeout(() => setReportSheetVisible(true), 320);
          }
        }}
        canReport={(() => {
          if (!selectedMessage) return false;
          // You can't report your own messages.
          if (selectedMessage.sender_id === currentUserId) return false;
          if (selectedMessage.deleted || selectedMessage.is_system) return false;
          if (selectedMessage.upload_state === 'failed') return false;
          return true;
        })()}
        canReply={(() => {
          if (!selectedMessage) return false;
          if (selectedMessage.deleted || selectedMessage.is_system) return false;
          if (selectedMessage.upload_state === 'failed') return false;
          // Not yet confirmed by the server (id is still the temporary client
          // id): it can't anchor a reply reference yet.
          if (!!selectedMessage.client_id && selectedMessage.id === selectedMessage.client_id) return false;
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
        bubbleRect={bubbleRect}
        isOwnSelected={!!selectedMessage && selectedMessage.sender_id === currentUserId}
        keyboardHeight={menuKeyboardHeight}
        showReactionsBar={
          !!selectedMessage &&
          selectedMessage.sender_id !== currentUserId &&
          !selectedMessage.deleted &&
          !selectedMessage.is_system &&
          selectedMessage.upload_state !== 'failed'
        }
        currentReaction={
          selectedMessage?.reactions?.find(r => r.hasMine)?.emoji
        }
        onReact={(emoji) => {
          if (!selectedMessage) return;
          const mine = selectedMessage.reactions?.find(r => r.hasMine);
          if (mine?.emoji === emoji) {
            removeReaction(selectedMessage.id);
          } else {
            setReaction(selectedMessage.id, emoji);
          }
        }}
      />
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
    </View>
    </ChatErrorBoundary>
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
  returnToLatestPill: { position: 'absolute', alignSelf: 'center', bottom: 90, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: '#111' },
  returnToLatestText: { fontWeight: '600', color: '#fff', fontSize: 13 },
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  systemBannerRow: {
    alignSelf: 'center',
    maxWidth: '85%',
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginVertical: 6,
    borderRadius: 12,
    backgroundColor: '#E8F4F5',
  },
  systemBannerText: {
    fontSize: 13,
    color: '#555',
    textAlign: 'center',
    ...(Platform.OS === 'web' ? { fontFamily: 'Inter, sans-serif' } : {}),
  },
  headerContainer: {
    backgroundColor: '#212121',
    paddingTop: Platform.OS === 'web' ? 24 : 12,
    paddingBottom: 14,
    paddingHorizontal: 0,
    alignItems: 'center',
    // Pin to the top so the chat body can't visually displace the header
    // mid-transition (heavy FlatList commits on screens with many messages
    // were leaving the header rendered at the wrong place until the slide-in
    // settled — pinning + high zIndex keeps it stable from the first frame).
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    elevation: 100,
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
  headerMenuButton: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 4,
  },
  muteModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  muteModalCard: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 8,
  },
  muteModalTitle: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter-Bold',
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#222B30',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  muteOption: {
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  muteOptionText: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 15,
    fontWeight: '400' as const,
    color: '#222B30',
  },
  muteCancel: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E8E8E8',
    marginTop: 4,
  },
  muteCancelText: {
    color: '#7A7A7A',
    fontWeight: '500' as const,
  },
  chatContainer: {
    flex: 1,
    backgroundColor: '#F5F5F5',
    // Leave room for the absolute headerContainer above.
    // headerContainer height = paddingTop + content (avatar 52) + paddingBottom 14.
    paddingTop: (Platform.OS === 'web' ? 24 : 12) + 52 + 14,
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
  // Photo/video bubbles strip their padding to 0 (then re-add a thin 3px frame),
  // so the sender name needs its own breathing room above the image.
  groupSenderNameTouchableMedia: {
    paddingTop: 3,
    paddingBottom: 5,
    paddingHorizontal: 7,
  },
  // Audio: name left-aligned at 10px to match the waveform/avatar start and the
  // inset of normal (text) messages.
  groupSenderNameTouchableAudio: {
    paddingTop: 6,
    paddingHorizontal: 10,
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
    backgroundColor: '#05BCD3', // Celeste background for outbound messages

    borderTopLeftRadius: 16, // 16px 16px 16px 2px (pointy corner at bottom right)
    borderTopRightRadius: 16,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 2, // Pointy corner at bottom right
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
    backgroundColor: colors.white,
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
  // Photo/video: thin uniform inset so a sliver of the bubble shows around the
  // media (WhatsApp-style). Pairs with messageImage's borderRadius for concentric
  // rounded corners.
  mediaFrameBubble: {
    // Must use per-edge props: imageMessageBubble sets paddingLeft/Right/etc to 0,
    // and those specific props beat a `padding` shorthand regardless of array order.
    paddingTop: 3,
    paddingRight: 3,
    paddingBottom: 3,
    paddingLeft: 3,
  },
  quotedPreviewWrap: {
    alignSelf: 'stretch',
  },
  quotedPreviewMediaWrap: {
    paddingHorizontal: 6,
    paddingTop: 6,
  },
  messageTextContainer: {
    marginBottom: 0, // Gap is now handled by the flex-wrap body+timestamp row.
    width: '100%',
  },
  userMessageText: {
    color: '#FFFFFF', // White text on celeste background for outbound messages
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
  attachmentFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    marginTop: 4,
    gap: 4,
  },
  attachmentStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    marginTop: 4,
    gap: 12,
  },
  attachmentStatusText: {
    fontSize: 12,
  },
  attachmentActionText: {
    fontSize: 12,
    fontWeight: '600',
  },
  userTimestamp: {
    color: 'rgba(255, 255, 255, 0.85)', // Light timestamp for contrast on celeste outbound bubbles
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
  // Edit-mode ⊗ cancel circle (replaces the + accessory while editing).
  editCancelButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#D9DCE1',
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
  typingCountText: {
    marginLeft: 6,
    fontSize: 11,
    color: '#666666',
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
  // Own (celeste) bubbles: keep "(edited)" white like the timestamp.
  editedBadgeOwn: {
    color: 'rgba(255, 255, 255, 0.85)', // Same as userTimestamp
  },
  deletedMessageText: {
    fontStyle: 'italic',
    opacity: 0.6,
    fontSize: 14,
    lineHeight: 19,
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
    // Fill the bubble's content box exactly via stretch (no percentage-width
    // rounding) and never exceed it, so the 3px frame stays symmetric on all
    // sides. width:'100%' could resolve a hair wider than the content box and
    // get clipped on the right by the bubble's overflow:hidden — eating the
    // right frame on short/wide images.
    alignSelf: 'stretch',
    width: '100%',
    maxWidth: '100%',
    // No minHeight: width:'100%' already fills the bubble width, so a floor would
    // only override the dynamic aspectRatio and force wide/panorama images into a
    // too-tall box (then cover-crop zooms them). Let the clamped aspectRatio
    // govern the height; maxHeight caps tall images.
    maxHeight: 500,
    backgroundColor: colors.backgroundGray,
    // Concentric with the bubble's 16px radius minus the 3px frame inset.
    borderRadius: 13,
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
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    borderRadius: borderRadius.medium,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
  },
  failedText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '600',
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.brandTeal,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    marginTop: spacing.xs,
  },
  retryIcon: {
    marginRight: 5,
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
