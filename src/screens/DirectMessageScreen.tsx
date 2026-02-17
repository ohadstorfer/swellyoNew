import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  View,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Image,
  ActivityIndicator,
  ImageBackground,
  Alert,
  Animated,
} from 'react-native';
import { TextInput as PaperTextInput } from 'react-native-paper';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../components/Text';
import { colors, spacing, typography, borderRadius } from '../styles/theme';
import { messagingService, Message } from '../services/messaging/messagingService';
import { supabaseAuthService } from '../services/auth/supabaseAuthService';
import { getImageUrl } from '../services/media/imageService';
import { supabase } from '../config/supabase';
import { ProfileImage } from '../components/ProfileImage';
import { MessageListSkeleton } from '../components/skeletons';
import { SKELETON_DELAY_MS } from '../constants/loading';
import { analyticsService } from '../services/analytics/analyticsService';
import { chatHistoryCache } from '../services/messaging/chatHistoryCache';
import { MessageActionsMenu } from '../components/MessageActionsMenu';
import { useMessaging } from '../context/MessagingProvider';
import { userPresenceService } from '../services/presence/userPresenceService';
import { avatarCacheService } from '../services/media/avatarCacheService';
import { FullscreenImageViewer } from '../components/FullscreenImageViewer';
import { ImagePreviewModal } from '../components/ImagePreviewModal';

interface DirectMessageScreenProps {
  conversationId?: string; // Optional: undefined for pending conversations (will be created on first message)
  otherUserId: string; // Required: the user ID we're messaging
  otherUserName: string;
  otherUserAvatar: string | null;
  isDirect?: boolean; // true for direct messages (2 users), false for group chats
  fromTripPlanning?: boolean; // true if conversation was created from trip planning recommendations
  onBack?: () => void;
  onConversationCreated?: (conversationId: string) => void; // Callback when conversation is created
  onViewProfile?: (userId: string) => void; // Callback when avatar or name is clicked
}

export const DirectMessageScreen: React.FC<DirectMessageScreenProps> = ({
  conversationId,
  otherUserId,
  otherUserName,
  otherUserAvatar,
  isDirect = true, // Default to direct message (2 users)
  fromTripPlanning = false, // Default to false (not from trip planning)
  onBack,
  onConversationCreated,
  onViewProfile,
}) => {
  // Get markAsRead and setCurrentConversationId from MessagingProvider
  const { markAsRead, setCurrentConversationId: setMessagingCurrentConversationId } = useMessaging();
  
  const [currentConversationId, setCurrentConversationId] = useState<string | undefined>(conversationId);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState<string>('');
  const [isFetchingMessages, setIsFetchingMessages] = useState(false); // Start as false, only set true when actually fetching
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState(false);
  const oldestMessageIdRef = useRef<string | null>(null);
  const isLoadingOlderRef = useRef<boolean>(false); // Ref-based lock to prevent race conditions
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [otherUserAdvRole, setOtherUserAdvRole] = useState<'adv_giver' | 'adv_seeker' | null>(null);
  const [otherUserIsOnline, setOtherUserIsOnline] = useState<boolean | null>(null);
  const [inputHeight, setInputHeight] = useState(25); // Initial height for one line
  const [showSkeletons, setShowSkeletons] = useState(false);
  const [hasTrackedFirstMessage, setHasTrackedFirstMessage] = useState(false);
  const [hasTrackedFirstReply, setHasTrackedFirstReply] = useState(false);
  const [firstMessageSentTime, setFirstMessageSentTime] = useState<number | null>(null);
  const [isTyping, setIsTyping] = useState(false); // Typing indicator state
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [menuVisible, setMenuVisible] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const [fullscreenImageUrl, setFullscreenImageUrl] = useState<string | null>(null);
  const [fullscreenThumbnailUrl, setFullscreenThumbnailUrl] = useState<string | null>(null);
  const [imagePreviewVisible, setImagePreviewVisible] = useState(false);
  const [selectedImageUri, setSelectedImageUri] = useState<string | null>(null);
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);
  const textInputRef = useRef<any>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const typingDebounceRef = useRef<NodeJS.Timeout | null>(null);

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

    // Only show skeletons if fetching AND no messages
    // This is now redundant since we handle it in render, but keep for safety
    if (isFetchingMessages && messages.length === 0) {
      setShowSkeletons(true);
    } else {
      setShowSkeletons(false);
    }
  }, [isFetchingMessages, messages.length]);

  useEffect(() => {
    // Only load messages and subscribe if conversation exists
    if (currentConversationId) {
      // CRITICAL: Load messages IMMEDIATELY (doesn't need currentUserId)
      // currentUserId is only needed for markAsRead and subscription callbacks
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

      // Subscribe to messages (callbacks handle currentUserId being null)
      const unsubscribe = messagingService.subscribeToMessages(
        currentConversationId,
        {
          onNewMessage: (newMessage) => {
            // Track first reply received (only once, and only if message is from other user)
            if (!hasTrackedFirstReply && currentUserId && newMessage.sender_id !== currentUserId) {
              const timeToReplyMinutes = firstMessageSentTime 
                ? (Date.now() - firstMessageSentTime) / (1000 * 60)
                : undefined;
              analyticsService.trackReplyReceived(timeToReplyMinutes, currentConversationId);
              setHasTrackedFirstReply(true);
            }
        
            // Check if message already exists (avoid duplicates)
            setMessages((prev) => {
              const exists = prev.some(msg => msg.id === newMessage.id);
              if (exists) {
                return prev;
              }
              const updated = [...prev, newMessage];
              // Update cache
              chatHistoryCache.saveMessages(currentConversationId, updated).catch(err => {
                console.error('Error updating cache:', err);
              });
              return updated;
            });
            // Mark as read only if currentUserId is available
            if (currentUserId) {
              markAsRead(currentConversationId).catch(err => {
                console.error('Error marking message as read:', err);
              });
            }
            setTimeout(() => scrollToBottom(), 100);
          },
          onMessageUpdated: (updatedMessage) => {
            // #region agent log
            // Log when message is updated via WebSocket
            fetch('http://127.0.0.1:7242/ingest/6b4e2d69-2c76-430d-914a-aa3116b97922',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'DirectMessageScreen.tsx:174',message:'Message updated via WebSocket',data:{id:updatedMessage.id,type:updatedMessage.type,hasType:updatedMessage.type!==undefined,hasImageMetadata:!!updatedMessage.image_metadata,imageMetadata:updatedMessage.image_metadata,body:updatedMessage.body?.substring(0,50),allKeys:Object.keys(updatedMessage)},timestamp:Date.now()})}).catch(()=>{});
            // #endregion
            // Handle message edit
            setMessages((prev) => {
              const updated = prev.map(msg => 
                msg.id === updatedMessage.id ? updatedMessage : msg
              );
              // Update cache
              chatHistoryCache.updateMessage(currentConversationId, updatedMessage.id, updatedMessage).catch(err => {
                console.error('Error updating message in cache:', err);
              });
              return updated;
            });
          },
          onMessageDeleted: (messageId) => {
            // Handle message deletion
            setMessages((prev) => {
              const updated = prev.filter(msg => msg.id !== messageId);
              // Update cache
              chatHistoryCache.updateMessage(currentConversationId, messageId, null).catch(err => {
                console.error('Error updating deleted message in cache:', err);
              });
              return updated;
            });
          },
          onTyping: (userId, isTyping) => {
            // Only show typing indicator for other user (if currentUserId is available)
            if (currentUserId && userId !== currentUserId) {
              setIsTyping(isTyping);
            }
          },
        }
      );

      return () => {
        unsubscribe();
        setIsTyping(false);
        // Clean up typing indicators
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
      setShowSkeletons(false);
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
  }, [currentConversationId, markAsRead, setMessagingCurrentConversationId]); // Removed currentUserId from deps

  // Separate useEffect to mark as read when currentUserId becomes available
  useEffect(() => {
    if (currentConversationId && currentUserId) {
      markAsRead(currentConversationId).catch(err => {
        console.error('Error marking as read:', err);
      });
    }
  }, [currentConversationId, currentUserId, markAsRead]);

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
      setShowSkeletons(false);
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
      
      // Set pagination state
      if (cachedMessages.length > 0) {
        oldestMessageIdRef.current = cachedMessages[0].id;
        // Assume there might be more messages if we have exactly the cache limit
        setHasMoreMessages(cachedMessages.length >= 30);
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
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/6b4e2d69-2c76-430d-914a-aa3116b97922',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'DirectMessageScreen.tsx:382',message:'Inspecting all cached messages for image fields',data:{totalMessages:cachedMessages.length,allMessages:cachedMessages.map((msg,idx)=>({index:idx,id:msg.id,type:msg.type,typeValue:msg.type,hasType:msg.type!==undefined,hasImageMetadata:!!msg.image_metadata,imageMetadataKeys:msg.image_metadata?Object.keys(msg.image_metadata):null,imageMetadata:msg.image_metadata,body:msg.body?.substring(0,50)})),messageKeys:cachedMessages.length>0?Object.keys(cachedMessages[0]):[]},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
      }
      
      // Memory cache hit - show instantly (no async delay, no loading state)
      // But only after adv_role is loaded to ensure correct colors
      setMessages(cachedMessages);
      setIsFetchingMessages(false);
      setShowSkeletons(false);  // Binary: cache exists = no skeleton
      
      setTimeout(() => scrollToBottom(), 200);
      
      // CRITICAL: Always check server for updated messages when loading from cache
      // This ensures image messages are loaded even if cache is stale
      // Do this in background so it doesn't block UI
      (async () => {
        try {
          const lastSync = await chatHistoryCache.getLastSyncTimestamp(currentConversationId);
          const serverMessages = await messagingService.getMessagesUpdatedSince(
            currentConversationId,
            lastSync || 0,
            30 // Check all recent messages
          );
          
          if (serverMessages.length > 0) {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/6b4e2d69-2c76-430d-914a-aa3116b97922',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'DirectMessageScreen.tsx:400',message:'Found updated messages from server after cache load',data:{totalMessages:serverMessages.length,imageMessages:serverMessages.filter(m=>m.type==='image'||m.image_metadata).length,allMessages:serverMessages.map((msg,idx)=>({index:idx,id:msg.id,type:msg.type,hasImageMetadata:!!msg.image_metadata}))},timestamp:Date.now()})}).catch(()=>{});
            // #endregion
            
            // Merge server messages with cache
            setMessages((prev) => {
              const merged = chatHistoryCache.mergeMessages(prev, serverMessages);
              chatHistoryCache.saveMessages(currentConversationId, merged).catch(() => {});
              return merged;
            });
          }
        } catch (error) {
          console.error('Error checking for updated messages:', error);
        }
      })();
      
      // Also run regular background sync
      syncWithServerInBackground();
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
        
        // Set pagination state
        if (asyncCachedMessages.length > 0) {
          oldestMessageIdRef.current = asyncCachedMessages[0].id;
          // Assume there might be more messages if we have exactly the cache limit
          setHasMoreMessages(asyncCachedMessages.length >= 30);
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
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/6b4e2d69-2c76-430d-914a-aa3116b97922',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'DirectMessageScreen.tsx:454',message:'Inspecting all AsyncStorage cached messages for image fields',data:{totalMessages:asyncCachedMessages.length,allMessages:asyncCachedMessages.map((msg,idx)=>({index:idx,id:msg.id,type:msg.type,typeValue:msg.type,hasType:msg.type!==undefined,hasImageMetadata:!!msg.image_metadata,imageMetadataKeys:msg.image_metadata?Object.keys(msg.image_metadata):null,imageMetadata:msg.image_metadata,body:msg.body?.substring(0,50)})),messageKeys:asyncCachedMessages.length>0?Object.keys(asyncCachedMessages[0]):[]},timestamp:Date.now()})}).catch(()=>{});
          // #endregion
        }
        
        // AsyncStorage cache hit - show messages (after adv_role is loaded)
        setMessages(asyncCachedMessages);
        setIsFetchingMessages(false);
        setShowSkeletons(false);  // Binary: cache exists = no skeleton
        
        setTimeout(() => scrollToBottom(), 200);
        
        // Sync with server in background
        syncWithServerInBackground();
      } else {
        console.log('[DirectMessageScreen] ⚠️ Both caches MISS - fetching from server');
        setShowSkeletons(true);  // Binary: no cache = show skeleton
        
        const serverStartTime = Date.now();
        const result = await messagingService.getMessages(currentConversationId, 30);
        const serverTime = Date.now() - serverStartTime;
        const totalTime = Date.now() - loadStartTime;
        
        console.log(`[DirectMessageScreen] 📥 SERVER FETCH - Got ${result.messages.length} messages in ${serverTime}ms (${totalTime}ms total, hasMore: ${result.hasMore})`);
        
        // #region agent log
        // Log ALL server messages to check for image messages
        fetch('http://127.0.0.1:7242/ingest/6b4e2d69-2c76-430d-914a-aa3116b97922',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'DirectMessageScreen.tsx:475',message:'Inspecting all server messages for image fields',data:{totalMessages:result.messages.length,allMessages:result.messages.map((msg,idx)=>({index:idx,id:msg.id,type:msg.type,typeValue:msg.type,hasType:msg.type!==undefined,hasImageMetadata:!!msg.image_metadata,imageMetadataKeys:msg.image_metadata?Object.keys(msg.image_metadata):null,imageMetadata:msg.image_metadata,body:msg.body?.substring(0,50)})),messageKeys:result.messages.length>0?Object.keys(result.messages[0]):[]},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        
        setHasMoreMessages(result.hasMore);
        if (result.messages.length > 0) {
          oldestMessageIdRef.current = result.messages[0].id;
        }
        await chatHistoryCache.saveMessages(currentConversationId, result.messages);
        
        // CRITICAL: Load adv_role BEFORE setting messages to ensure correct color on first render
        await loadOtherUserAdvRole();
        
        // Set messages after adv_role is loaded to ensure correct colors
        setMessages(result.messages);
        setIsFetchingMessages(false);
        setShowSkeletons(false);
        
        setTimeout(() => scrollToBottom(), 200);
      }
    } catch (error) {
      console.error('[DirectMessageScreen] ❌ Error loading messages:', error);
      setIsFetchingMessages(false);
      setShowSkeletons(false);
    }
  };
  
  // Load older messages (pagination)
  const loadOlderMessages = async () => {
    // Ref-based lock to prevent race conditions (synchronous check)
    if (!currentConversationId || isLoadingOlderRef.current || isLoadingOlderMessages || !hasMoreMessages || !oldestMessageIdRef.current) {
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
  
  // Background server sync (lightweight, since realtime is active)
  const syncWithServerInBackground = async () => {
    if (!currentConversationId) return;
    
    try {
      // CRITICAL: Since realtime subscription is active while in chat,
      // background sync is mainly for cold re-entry gaps
      // Keep it lightweight - only fetch recent messages (last 20)
      
      const lastSync = await chatHistoryCache.getLastSyncTimestamp(currentConversationId);
      
      // Only sync if lastSync is old (> 5 minutes) or doesn't exist
      // If recent, realtime should have already delivered updates
      const syncAge = lastSync ? Date.now() - lastSync : Infinity;
      if (syncAge < 5 * 60 * 1000) {
        // Recent sync - realtime should handle updates
        return;
      }
      
      // Fetch messages updated after last sync (version-aware)
      // Limit to 20 messages for lightweight sync
      const serverMessages = await messagingService.getMessagesUpdatedSince(
        currentConversationId,
        lastSync || 0,
        20 // Lightweight limit
      );
      
      // #region agent log
      // Log background sync messages to check for image updates
      if (serverMessages.length > 0) {
        fetch('http://127.0.0.1:7242/ingest/6b4e2d69-2c76-430d-914a-aa3116b97922',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'DirectMessageScreen.tsx:590',message:'Background sync messages from server',data:{totalMessages:serverMessages.length,allMessages:serverMessages.map((msg,idx)=>({index:idx,id:msg.id,type:msg.type,typeValue:msg.type,hasType:msg.type!==undefined,hasImageMetadata:!!msg.image_metadata,imageMetadataKeys:msg.image_metadata?Object.keys(msg.image_metadata):null,imageMetadata:msg.image_metadata,body:msg.body?.substring(0,50)})),lastSync},timestamp:Date.now()})}).catch(()=>{});
      }
      // #endregion
      
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
    const tempId = `temp-${Date.now()}`;
    
    // 1. Show message immediately (optimistic) - BEFORE conversation creation
    const tempConversationId = currentConversationId || `temp-conv-${Date.now()}`;
    const optimisticMessage: Message = {
      id: tempId,
      conversation_id: tempConversationId,
      sender_id: currentUserId,
      body: messageText,
      rendered_body: null,
      attachments: [],
      is_system: false,
      edited: false,
      deleted: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, optimisticMessage]);
    setInputText('');
    
    // Scroll to bottom immediately
    setTimeout(() => scrollToBottom(), 50);
    
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
          setMessages((prev) => prev.map(msg => 
            msg.id === tempId 
              ? { ...msg, conversation_id: targetConversationId }
              : msg
          ));
          
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
        // Remove optimistic message on error
        setMessages((prev) => prev.filter(msg => msg.id !== tempId));
        setInputText(messageText); // Restore input text
        Alert.alert('Error', errorMessage);
        setIsLoading(false);
        setLoadingMessage('');
        return;
      }
    }
    
    setIsLoading(true);

    // 3. Send message to server (replace optimistic message with real one)
    try {
      // At this point, targetConversationId should always be defined
      if (!targetConversationId) {
        throw new Error('Conversation ID is required to send message');
      }
      
      // Send message to server
      const sentMessage = await messagingService.sendMessage(targetConversationId, messageText);
      
      // Track first message sent (only if this is a new conversation and we haven't tracked it yet)
      if (!hasTrackedFirstMessage && !conversationId) {
        analyticsService.trackFirstMessageSent(targetConversationId);
        setHasTrackedFirstMessage(true);
        setFirstMessageSentTime(Date.now());
      }
      
      // Replace optimistic message with real message from server
      setMessages((prev) => {
        const filtered = prev.filter(msg => msg.id !== tempId);
        // Check if message already exists (from subscription)
        const exists = filtered.some(msg => msg.id === sentMessage.id);
        const updated = exists ? filtered : [...filtered, sentMessage];
        // Update cache
        chatHistoryCache.saveMessages(targetConversationId, updated).catch(err => {
          console.error('Error updating cache:', err);
        });
        return updated;
      });
      
      setTimeout(() => scrollToBottom(), 100);
    } catch (error) {
      console.error('Error sending message:', error);
      // Remove optimistic message on error
      setMessages((prev) => prev.filter(msg => msg.id !== tempId));
      setInputText(messageText); // Restore input text
      Alert.alert('Error', 'Failed to send message. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const scrollToBottom = () => {
    // Use requestAnimationFrame for better timing
    requestAnimationFrame(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    });
  };

  // Handle typing indicator (debounced)
  useEffect(() => {
    if (!currentConversationId || !inputText.trim()) {
      // Clear typing indicator when input is empty
      if (typingDebounceRef.current) {
        clearTimeout(typingDebounceRef.current);
        typingDebounceRef.current = null;
      }
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
      messagingService.stopTyping(currentConversationId!).catch(() => {});
      return;
    }

    // Debounce: send typing indicator after 300ms of inactivity
    if (typingDebounceRef.current) {
      clearTimeout(typingDebounceRef.current);
    }

    typingDebounceRef.current = setTimeout(() => {
      if (currentConversationId && inputText.trim()) {
        messagingService.startTyping(currentConversationId).catch(() => {});
      }
    }, 300);

    // Clear typing indicator after 3 seconds of no typing
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    typingTimeoutRef.current = setTimeout(() => {
      if (currentConversationId) {
        messagingService.stopTyping(currentConversationId).catch(() => {});
      }
    }, 3000);

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
    if (!currentConversationId) return;

    Alert.alert(
      'Delete Message',
      'Are you sure you want to delete this message?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              // Optimistic update
              setMessages((prev) => {
                const updated = prev.map(msg => 
                  msg.id === messageId 
                    ? { ...msg, deleted: true, body: null }
                    : msg
                );
                chatHistoryCache.updateMessage(currentConversationId, messageId, null).catch(() => {});
                return updated;
              });

              await messagingService.deleteMessage(currentConversationId, messageId);
            } catch (error: any) {
              console.error('Error deleting message:', error);
              Alert.alert('Error', error?.message || 'Failed to delete message');
              // Rollback optimistic update
              loadMessages();
            }
          },
        },
      ]
    );
  };

  // Handle image picker
  const handleImagePicker = async () => {
    if (!currentConversationId) {
      Alert.alert('Error', 'Please wait for the conversation to load');
      return;
    }

    try {
      if (Platform.OS === 'web') {
        // For web, use a file input
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = async (e: any) => {
          const file = e.target.files[0];
          if (file) {
            const reader = new FileReader();
            reader.onload = async (event: any) => {
              const imageUri = event.target.result as string;
              setSelectedImageUri(imageUri);
              setImagePreviewVisible(true);
            };
            reader.readAsDataURL(file);
          }
        };
        input.click();
      } else {
        // For native, use expo-image-picker
        try {
          const ImagePicker = require('expo-image-picker');
          const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (status !== 'granted') {
            Alert.alert(
              'Permission Required',
              'Sorry, we need camera roll permissions to send images!'
            );
            return;
          }

          const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: false,
            quality: 1,
          });

          if (!result.canceled && result.assets[0]) {
            const imageUri = result.assets[0].uri;
            setSelectedImageUri(imageUri);
            setImagePreviewVisible(true);
          }
        } catch (error) {
          console.warn('expo-image-picker not available:', error);
          Alert.alert(
            'Image Picker Not Available',
            'Please install expo-image-picker for native platforms.'
          );
        }
      }
    } catch (error) {
      console.error('Error picking image:', error);
      Alert.alert('Error', 'Failed to open image picker');
    }
  };

  // Handle image send
  const handleImageSend = async (caption?: string) => {
    if (!selectedImageUri || !currentConversationId || !currentUserId) {
      return;
    }

    setIsProcessingImage(true);

    try {
      // Import image upload service functions
      const { processImage, uploadImageToStorage } = await import('../services/messaging/imageUploadService');
      
      // Step 1: Create message record in DB first (to get real message ID)
      const messageRecord = await messagingService.createImageMessage(currentConversationId, caption);
      
      // Step 2: Process image (compress and generate thumbnail)
      const processed = await processImage(selectedImageUri);
      
      // Step 3: Upload original image
      const imageUrl = await uploadImageToStorage(
        processed.originalUri,
        currentConversationId,
        messageRecord.id,
        false
      );
      
      // Step 4: Upload thumbnail
      const thumbnailUrl = await uploadImageToStorage(
        processed.thumbnailUri,
        currentConversationId,
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
        storage_path: `${currentConversationId}/${messageRecord.id}/original.jpg`,
      };
      
      await messagingService.updateImageMessageMetadata(messageRecord.id, imageMetadata);
      
      // Close preview modal
      setImagePreviewVisible(false);
      setSelectedImageUri(null);
      setIsProcessingImage(false);
      
      // Scroll to bottom to show new message
      setTimeout(() => scrollToBottom(), 200);
    } catch (error: any) {
      console.error('Error sending image:', error);
      Alert.alert('Error', error?.message || 'Failed to send image');
      setIsProcessingImage(false);
    }
  };

  // Handle retry upload for failed image messages
  const handleRetryUpload = async (message: Message) => {
    if (!message.image_metadata || !currentConversationId) return;
    
    // TODO: Implement retry logic
    // This should re-upload the image and update the message
    Alert.alert('Info', 'Retry upload functionality will be implemented in Phase 3');
  };

  // Handle long press on message
  const handleMessageLongPress = (message: Message, event: any) => {
    if (!currentUserId || message.sender_id !== currentUserId) return;
    if (message.deleted) return;

    const { pageX, pageY } = event.nativeEvent;
    setSelectedMessage(message);
    setEditingText(message.body || ''); // Initialize edit text
    setMenuPosition({ x: pageX, y: pageY });
    setMenuVisible(true);
  };

  // Check if message can be edited (within 15 minutes)
  const canEditMessage = (message: Message): boolean => {
    if (!currentUserId || message.sender_id !== currentUserId) return false;
    if (message.deleted) return false;
    
    const messageAge = Date.now() - new Date(message.created_at).getTime();
    const fifteenMinutes = 15 * 60 * 1000;
    return messageAge <= fifteenMinutes;
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

  // Reset input height when text is cleared
  useEffect(() => {
    if (!inputText.trim()) {
      setInputHeight(25); // Reset to single line height
    }
  }, [inputText]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messages.length > 0 && !isFetchingMessages) {
      setTimeout(() => scrollToBottom(), 100);
    }
  }, [messages.length, isFetchingMessages]);

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  };

  const renderMessage = (message: Message) => {
    // CRITICAL: Render messages even if currentUserId isn't available yet
    // We can determine message alignment from sender_id comparison
    // For now, render all messages as received (will update when currentUserId loads)
    // This allows messages to appear instantly while currentUserId loads in background
    
    // Debug: Log image messages being rendered
    if (message.type === 'image' || message.image_metadata) {
      console.log('[DirectMessageScreen] 🖼️ RENDERING IMAGE MESSAGE:', {
        id: message.id,
        type: message.type,
        hasType: message.type !== undefined,
        hasImageMetadata: !!message.image_metadata,
        imageMetadata: message.image_metadata ? {
          hasImageUrl: !!message.image_metadata.image_url,
          hasThumbnailUrl: !!message.image_metadata.thumbnail_url,
          imageUrl: message.image_metadata.image_url,
          thumbnailUrl: message.image_metadata.thumbnail_url,
        } : null,
        uploadState: message.upload_state,
        willRenderImage: !!(message.image_metadata?.image_url || message.image_metadata?.thumbnail_url),
      });
    }
    // #region agent log
    // Log ALL messages to check for potential image messages that aren't being detected
    if (message.body && (message.body.includes('image') || message.body.includes('photo') || message.body.includes('picture'))) {
      fetch('http://127.0.0.1:7242/ingest/6b4e2d69-2c76-430d-914a-aa3116b97922',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'DirectMessageScreen.tsx:1018',message:'Message with image-related body text found',data:{id:message.id,type:message.type,hasType:message.type!==undefined,hasImageMetadata:!!message.image_metadata,imageMetadata:message.image_metadata,body:message.body,allKeys:Object.keys(message)},timestamp:Date.now()})}).catch(()=>{});
    }
    // #endregion
    const isOwnMessage = currentUserId ? message.sender_id === currentUserId : false;
    const isEditing = editingMessageId === message.id;
    const canEdit = canEditMessage(message);
    
    // For group chats, show avatar for received messages
    // For direct messages (2 users), don't show avatar since it's always the same person
    const showAvatar = !isOwnMessage && !isDirect && (message.sender_name || message.sender_avatar);
    const senderName = message.sender_name || message.sender?.name || otherUserName;
    const senderAvatar = message.sender_avatar || message.sender?.avatar || otherUserAvatar;
    
    return (
      <TouchableOpacity
        key={message.id}
        activeOpacity={0.7}
        onLongPress={(e) => handleMessageLongPress(message, e)}
        style={[
          styles.messageContainer,
          isOwnMessage ? styles.userMessageContainer : [
            styles.botMessageContainer,
            isDirect && styles.botMessageContainerDirect, // Less padding for direct messages (no avatar)
          ],
        ]}
      >
        {/* Show avatar only for group chats (not direct messages) */}
        {showAvatar && (
          <View style={styles.messageAvatarContainer}>
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
          </View>
        )}
        
        <View
          style={[
            styles.messageBubble,
            isOwnMessage 
              ? styles.userMessageBubble 
              : [
                  styles.botMessageBubble,
                  otherUserAdvRole === 'adv_giver' && styles.botMessageBubbleGiveAdv,
                  otherUserAdvRole === 'adv_seeker' && styles.botMessageBubbleGetAdv,
                ],
            // Conditionally apply padding: 0 for images, normal for text
            (message.type === 'image' || message.image_metadata) && styles.imageMessageBubble,
          ]}
        >
          {message.type === 'image' || message.image_metadata ? (
            // Image message - redesigned layout
            (() => {
              const imageUri = message.image_metadata?.thumbnail_url || message.image_metadata?.image_url || '';
              const imageWidth = message.image_metadata?.width || 1;
              const imageHeight = message.image_metadata?.height || 1;
              const aspectRatio = imageWidth > 0 && imageHeight > 0 ? imageWidth / imageHeight : 1;
              
              if (!imageUri) {
                console.warn('[DirectMessageScreen] ⚠️ Image message has no URL:', {
                  id: message.id,
                  type: message.type,
                  imageMetadata: message.image_metadata,
                });
              }
              
              console.log('[DirectMessageScreen] 🖼️ Image render details:', {
                messageId: message.id,
                imageUri: imageUri ? `${imageUri.substring(0, 50)}...` : 'NO URI',
                imageWidth,
                imageHeight,
                aspectRatio,
                hasImageMetadata: !!message.image_metadata,
              });
              
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
                    <Image
                      source={{ uri: imageUri }}
                      style={[
                        styles.messageImage,
                        { 
                          aspectRatio: aspectRatio && aspectRatio > 0 && isFinite(aspectRatio) ? aspectRatio : 1,
                        }
                      ]}
                      resizeMode="cover"
                      onError={(error) => {
                        console.error('[DirectMessageScreen] ❌ Image load error:', {
                          messageId: message.id,
                          imageUri,
                          error,
                        });
                      }}
                      onLoad={() => {
                        console.log('[DirectMessageScreen] ✅ Image loaded successfully:', {
                          messageId: message.id,
                          imageUri,
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
                    {/* Timestamp overlay on image */}
                    <View style={styles.imageTimestampOverlay}>
                      <Text style={styles.imageTimestamp}>
                        {formatTime(message.created_at)}
                      </Text>
                    </View>
                  </TouchableOpacity>
                  {message.body && (
                    <Text style={[
                      styles.imageCaption,
                      isOwnMessage ? styles.userMessageText : styles.botMessageText,
                      !isOwnMessage && otherUserAdvRole === 'adv_giver' && styles.botMessageTextGiveAdv,
                      !isOwnMessage && otherUserAdvRole === 'adv_seeker' && styles.botMessageTextGetAdv,
                    ]}>
                      {message.body}
                    </Text>
                  )}
                </View>
              );
            })()
          ) : (
            // Text message
            <>
              <View style={styles.messageTextContainer}>
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
                  <Text style={[
                    isOwnMessage ? styles.userMessageText : styles.botMessageText,
                    styles.deletedMessageText,
                  ]}>
                    This message was deleted
                  </Text>
                ) : (
                  <>
                    <Text style={[
                      isOwnMessage ? styles.userMessageText : styles.botMessageText,
                      !isOwnMessage && otherUserAdvRole === 'adv_giver' && styles.botMessageTextGiveAdv,
                      !isOwnMessage && otherUserAdvRole === 'adv_seeker' && styles.botMessageTextGetAdv,
                    ]}>
                      {message.body || ''}
                    </Text>
                    {message.edited && !message.deleted && (
                      <Text style={styles.editedBadge}>(edited)</Text>
                    )}
                  </>
                )}
              </View>
              
              {/* Timestamp container for text messages */}
              <View style={[
                styles.timestampContainer,
                isOwnMessage ? styles.userTimestampContainer : styles.botTimestampContainer,
              ]}>
                <Text style={[
                  styles.timestamp,
                  isOwnMessage ? styles.userTimestamp : styles.botTimestamp,
                ]}>
                  {formatTime(message.created_at)}
                </Text>
              </View>
            </>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.headerContainer}>
        <View style={styles.headerGradientBorder} />
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <TouchableOpacity 
              style={styles.backButton}
              onPress={onBack}
            >
              <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={styles.avatar}
              onPress={() => {
                if (onViewProfile) {
                  onViewProfile(otherUserId);
                }
              }}
              activeOpacity={0.7}
            >
              <ProfileImage
                imageUrl={otherUserAvatar}
                name={otherUserName}
                style={styles.avatarImage}
                showLoadingIndicator={false}
                isOnline={otherUserIsOnline === true}
                advRole={otherUserAdvRole}
              />
            </TouchableOpacity>
          </View>
          
          <TouchableOpacity 
            style={styles.profileInfo}
            onPress={() => {
              if (onViewProfile) {
                onViewProfile(otherUserId);
              }
            }}
            activeOpacity={0.7}
          >
            <Text style={styles.profileName}>{otherUserName}</Text>
            {useMemo(() => {
              if (otherUserIsOnline === true) {
                return (
                  <View style={styles.statusContainer}>
                    <View style={styles.onlineDot} />
                    <Text style={styles.profileTagline}>Available</Text>
                  </View>
                );
              } else if (otherUserIsOnline === false) {
                return <Text style={styles.profileTagline}>Offline</Text>;
              }
              return null; // Don't show anything while loading
            }, [otherUserIsOnline])}
          </TouchableOpacity>
          
          {/* <TouchableOpacity style={styles.menuButton}>
            <Ionicons name="ellipsis-vertical" size={24} color="#FFFFFF" />
          </TouchableOpacity> */}
        </View>
      </View>

      {/* Chat Messages */}
      <KeyboardAvoidingView 
        style={styles.chatContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <ImageBackground
          source={{ uri: getImageUrl('/chat background.png') }}
          style={styles.backgroundImage}
          resizeMode="cover"
        >
          <ScrollView
            ref={scrollViewRef}
            style={styles.messagesList}
            contentContainerStyle={styles.messagesContent}
            showsVerticalScrollIndicator={false}
            onScroll={(event) => {
              const { contentOffset } = event.nativeEvent;
              // Trigger when scrolled near top (within 200px)
              if (contentOffset.y <= 200 && hasMoreMessages && !isLoadingOlderMessages) {
                loadOlderMessages();
              }
            }}
            scrollEventThrottle={400}
          >
          {messages.length === 0 && isFetchingMessages ? (
            // Show skeletons only when fetching AND no messages
            <MessageListSkeleton count={5} />
          ) : messages.length === 0 && !isFetchingMessages ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>
                {currentConversationId 
                  ? 'No messages yet. Say hi! 👋' 
                  : 'Start the conversation by sending a message!'}
              </Text>
            </View>
          ) : (
            <>
              {/* Loading indicator for older messages */}
              {isLoadingOlderMessages && (
                <View style={styles.loadOlderContainer}>
                  <ActivityIndicator size="small" color="#A0A0A0" />
                  <Text style={styles.loadOlderText}>Loading older messages...</Text>
                </View>
              )}
              {messages
                .map(renderMessage)
                .filter(msg => msg !== null) // Filter out null messages (when variables not ready)
              }
              <TypingIndicator />
            </>
          )}
          {/* {isLoading && (
            <View style={[styles.messageContainer, styles.botMessageContainer]}>
              <View style={[styles.messageBubble, styles.botMessageBubble]}>
                <Text style={styles.botMessageText}>
                  {loadingMessage || (currentConversationId ? 'Sending...' : 'Creating conversation...')}
                </Text>
              </View>
            </View>
          )} */}
          </ScrollView>
        </ImageBackground>

        {/* Input Area */}
        <View style={styles.inputWrapper}>
          <View style={styles.attachButtonWrapper}>
            <TouchableOpacity 
              style={styles.attachButton}
              onPress={handleImagePicker}
            >
              <Ionicons name="add" size={28} color="#222B30" />
            </TouchableOpacity>
          </View>
          
          <View style={[
            styles.inputContainer,
            // Dynamically adjust container height based on input height
            // Container height = inputHeight + vertical padding (8px top + 8px bottom = 16px)
            // Minimum 48px for single line
            { minHeight: Math.max(48, inputHeight + 16) }
          ]}>
            <View style={styles.inputInnerContainer}>
              <PaperTextInput
                ref={textInputRef}
                mode="flat"
                value={inputText}
                onChangeText={setInputText}
                placeholder="Type your message.."
                multiline={true}
                maxLength={500}
                onSubmitEditing={undefined} // Disable default submit on Enter (we handle it manually)
                returnKeyType="default" // Always default to allow multiline
                blurOnSubmit={false}
                onContentSizeChange={(event: any) => {
                  // Best practice: Smooth expansion based on actual content size
                  const { height } = event.nativeEvent.contentSize;
                  
                  if (!height || height < 0) return; // Guard against invalid values
                  
                  // Calculate proper height:
                  // - Minimum: 34px (single line with proper line height)
                  // - Maximum: 120px (~6 lines, approximately 5-6 lines of text)
                  // - Use content height if it's larger than minimum
                  const calculatedHeight = Math.max(25, Math.ceil(height));
                  const cappedHeight = Math.min(calculatedHeight, 120);
                  
                  // Only update if height actually changed (prevents unnecessary re-renders)
                  // Use a small threshold to avoid jittery updates
                  if (Math.abs(cappedHeight - inputHeight) >= 1) {
                    setInputHeight(cappedHeight);
                  }
                }}
                onKeyPress={(e: any) => {
                  // On web: Enter sends, Shift+Enter creates new line
                  // On native: Enter always creates new line (no send on Enter)
                  if (Platform.OS === 'web' && e.nativeEvent.key === 'Enter') {
                    const isShiftPressed = (e.nativeEvent as any).shiftKey;
                    
                    if (!isShiftPressed) {
                      // Enter without Shift: send message (web only)
                      e.preventDefault();
                      sendMessage();
                    }
                    // Shift+Enter: allow new line (default behavior, don't prevent)
                  }
                  // On native: Enter key always creates new line (default behavior)
                }}
                // Enable scrolling only when we've reached max height
                scrollEnabled={inputHeight >= 120}
                // Center text vertically for single line, top for multiline
                textAlignVertical={inputHeight <= 25 ? "center" : "top"}
                style={[
                  styles.paperTextInput,
                  { 
                    // Dynamic height: starts at 34px, expands up to 120px
                    height: inputHeight,
                    maxHeight: 120,
                    // Center placeholder vertically for single line
                    ...(inputHeight <= 25 && {
                      paddingTop: 5,// Center based on line height (22px)
                      // paddingBottom: (34 - 22) / 2,
                    }),
                  }
                ]}
                contentStyle={[
                  styles.paperTextInputContent,
                  {
                    // Ensure content has proper padding and alignment
                    paddingTop: 0,
                    paddingBottom: 0,
                    minHeight: 25,
                  }
                ]}
                underlineColor="transparent"
                activeUnderlineColor="transparent"
                selectionColor={colors.primary || '#B72DF2'}
                placeholderTextColor="#7B7B7B"
                textColor="#333333"
                theme={{
                  colors: {
                    primary: colors.primary || '#B72DF2',
                    text: '#333333',
                    placeholder: '#7B7B7B',
                    background: 'transparent',
                  },
                }}
              />
            </View>
            
            <View style={styles.sendButtonWrapper}>
              <TouchableOpacity 
                style={[styles.sendButton, (!inputText.trim() || isLoading) && styles.sendButtonDisabled]}
                onPress={sendMessage}
                disabled={!inputText.trim() || isLoading}
              >
                {/* <Ionicons 
                  name={inputText.trim() ? "arrow-up" : "mic"} 
                  size={20} 
                  color="#FFFFFF" 
                /> */}
                <Ionicons 
                  name="arrow-up" 
                  size={20} 
                  color="#FFFFFF" 
                />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>

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
          if (selectedMessage) {
            handleDeleteMessage(selectedMessage.id);
          }
        }}
        canEdit={selectedMessage ? canEditMessage(selectedMessage) : false}
        messagePosition={menuPosition}
      />

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

      {/* Image Preview Modal */}
      {selectedImageUri && (
        <ImagePreviewModal
          visible={imagePreviewVisible}
          imageUri={selectedImageUri}
          onSend={handleImageSend}
          onCancel={() => {
            setImagePreviewVisible(false);
            setSelectedImageUri(null);
            setIsProcessingImage(false);
          }}
          isProcessing={isProcessingImage}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  headerContainer: {
    backgroundColor: '#212121',
    paddingTop: Platform.OS === 'web' ? 35 : 35,
    paddingBottom: 24,
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
  },
  profileName: {
    fontSize: 20,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter-Bold',
    lineHeight: 28,
    color: '#FFFFFF',
    marginBottom: 4,
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
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chatContainer: {
    flex: 1,
  },
  backgroundImage: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  messagesList: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  messagesContent: {
    padding: spacing.md,
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
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
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
    paddingRight: 16, 
    marginBottom: 16,
  },
  botMessageContainer: {
    flexDirection: 'row',
    justifyContent: 'flex-start', 
    alignItems: 'flex-end',
    paddingLeft: 0,
    paddingRight: 60,
    marginBottom: 16,
  },
  botMessageContainerDirect: {
    // For direct messages (no avatar), reduce right padding
    paddingRight: 16, // Keep same padding since we removed avatar
  },
  messageAvatarContainer: {
    marginRight: 8,
    marginBottom: 0,
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
    maxWidth: 268,
    flexDirection: 'column',
  },
  userMessageBubble: {
    maxWidth: 268,
    paddingTop: 16,
    paddingRight: 16,
    paddingBottom: 8,
    paddingLeft: 16,
    flexDirection: 'column',
    justifyContent: 'flex-end',
    alignItems: 'flex-start',
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
    paddingTop: 16,
    paddingHorizontal: 16,
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
  botMessageBubbleGiveAdv: {
    backgroundColor: '#DBCDBC', // adv_giver color
  },
  botMessageBubbleGetAdv: {
    backgroundColor: '#05BCD3', // adv_seeker color
  },
  messageTextContainer: {
    marginBottom: 10, // Gap between text and timestamp (Figma: gap-[10px])
    width: '100%',
  },
  userMessageText: {
    color: '#333333', // Dark text on white background for outbound messages
    fontSize: 16,
    fontWeight: '500',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    lineHeight: 21,
  },
  botMessageText: {
    color: '#333333', // Figma: text-[color:var(--text\/primary,#333333)]
    fontSize: 16, // Figma: text-[length:var(--size\/xs,16px)]
    fontWeight: '500', // Figma: font-medium
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    lineHeight: 21, // Figma: leading-[normal]
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
  },
  timestamp: {
    fontSize: 14, // Figma: text-[length:var(--size\/xxs,14px)]
    fontWeight: '400', // Figma: font-normal
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    lineHeight: 20, // Figma: leading-[20px]
  },
  userTimestamp: {
    color: 'rgba(123, 123, 123, 0.5)', // Dark timestamp on white background for outbound messages
  },
  botTimestamp: {
    color: 'rgba(123, 123, 123, 1)', 
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 8,
    paddingBottom: 35,
    paddingTop: 0,
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
  inputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center', // Center align items vertically to prevent send button from affecting line height
    backgroundColor: colors.white,
    paddingLeft: 10,
    paddingRight: 8,
    paddingTop: 8,
    paddingBottom: 8,
    // Dynamic minHeight: 48px for single line (34px text + 14px padding)
    // Will expand as inputHeight grows
    minHeight: 48,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 32,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 32,
    ...(Platform.OS === 'web' && {
      boxShadow: '0px 0px 20px rgba(0, 0, 0, 0.08)',
      transition: 'min-height 0.2s ease' as any, // Smooth height transitions
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
    // Center content vertically for single line, flex-start for multiline
    justifyContent: 'center',
    minHeight: 25, // Minimum single line height
    position: 'relative',
    // Ensure proper alignment for placeholder
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
    lineHeight: 22, // Line height for proper text spacing
    minHeight: 25, // Single line minimum
    textAlign: 'left', // Ensure text aligns to left
    ...(Platform.OS === 'web' && {
      outline: 'none' as any,
      resize: 'none' as any, // Prevent manual resizing on web
      overflow: 'auto' as any, // Allow scrolling when content exceeds max height
      textAlign: 'left' as any, // Left align text on web
    }),
  },
  paperTextInputContent: {
    paddingHorizontal: 0,
    paddingVertical: 0,
    margin: 0,
    minHeight: 25, // Single line minimum
    fontSize: 18,
    lineHeight: 22, // Consistent line height
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    textAlign: 'left', // Left align text
    ...(Platform.OS === 'web' && {
      outline: 'none' as any,
      textAlign: 'left' as any, // Left align text on web
    }),
  },
  sendButtonWrapper: {
    // Isolate send button to prevent it from affecting input line height
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  sendButton: {
    width: 35,
    height: 35,
    borderRadius: 48,
    backgroundColor: '#B72DF2',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 10,
  },
  sendButtonDisabled: {
    opacity: 0.5,
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
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
  },
  editButtonTextSave: {
    color: colors.white,
  },
  editedBadge: {
    fontSize: 12,
    color: colors.textSecondary,
    fontStyle: 'italic',
    marginTop: 4,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
  },
  deletedMessageText: {
    fontStyle: 'italic',
    opacity: 0.6,
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
    bottom: 6,
    right: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  imageTimestamp: {
    fontSize: 11,
    fontWeight: '400',
    color: '#FFFFFF',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
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
});
