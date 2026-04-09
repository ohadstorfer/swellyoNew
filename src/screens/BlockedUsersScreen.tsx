import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  ScrollView,
  ActivityIndicator,
  Animated,
  Dimensions,
  TouchableWithoutFeedback,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../config/supabase';
import { blockingService } from '../services/blocking/blockingService';
import { ProfileImage } from '../components/ProfileImage';

interface BlockedUser {
  user_id: string;
  name: string;
  profile_image_url: string | null;
  blocked_at: string;
}

interface BlockedUsersScreenProps {
  onBack: () => void;
}

export function BlockedUsersScreen({ onBack }: BlockedUsersScreenProps) {
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<BlockedUser | null>(null);
  const sheetAnim = useRef(new Animated.Value(0)).current;
  const overlayAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    loadBlockedUsers();
  }, []);

  const loadBlockedUsers = async () => {
    try {
      const { data, error } = await supabase.rpc('get_blocked_users_with_profiles');
      if (error) {
        console.error('Error loading blocked users:', error);
        return;
      }
      setBlockedUsers(data || []);
    } catch (error) {
      console.error('Error loading blocked users:', error);
    } finally {
      setLoading(false);
    }
  };

  const openSheet = (user: BlockedUser) => {
    setSelectedUser(user);
    Animated.parallel([
      Animated.timing(overlayAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.spring(sheetAnim, { toValue: 1, tension: 65, friction: 11, useNativeDriver: true }),
    ]).start();
  };

  const closeSheet = () => {
    Animated.parallel([
      Animated.timing(overlayAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(sheetAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => setSelectedUser(null));
  };

  const handleUnblock = async () => {
    if (!selectedUser) return;
    const userId = selectedUser.user_id;
    setUnblockingId(userId);
    closeSheet();
    const success = await blockingService.unblockUser(userId);
    if (success) {
      setBlockedUsers(prev => prev.filter(u => u.user_id !== userId));
    }
    setUnblockingId(null);
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.backButton} onPress={onBack} activeOpacity={0.7}>
        <Ionicons name="chevron-back" size={18} color="#333" />
        <Text style={styles.backButtonText}>Back</Text>
      </TouchableOpacity>

      <View style={styles.bottomCard}>
        <View style={styles.topSpacer} />
        <View style={styles.divider} />

        <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
          <Text style={styles.title}>Blocked accounts</Text>

          {loading ? (
            <ActivityIndicator size="small" color="#333" style={styles.loader} />
          ) : blockedUsers.length === 0 ? (
            <Text style={styles.emptyText}>No blocked users</Text>
          ) : (
            blockedUsers.map(user => (
              <TouchableOpacity
                key={user.user_id}
                style={styles.userRow}
                activeOpacity={0.7}
                onPress={() => openSheet(user)}
                disabled={unblockingId === user.user_id}
              >
                <ProfileImage
                  imageUrl={user.profile_image_url}
                  name={user.name}
                  style={styles.avatar}
                  showLoadingIndicator={false}
                />
                <View style={styles.userInfo}>
                  <Text style={styles.userName} numberOfLines={1}>{user.name}</Text>
                </View>
                {unblockingId === user.user_id && (
                  <ActivityIndicator size="small" color="#333" />
                )}
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      </View>

      {selectedUser && (
        <>
          <TouchableWithoutFeedback onPress={closeSheet}>
            <Animated.View style={[styles.overlay, { opacity: overlayAnim }]} />
          </TouchableWithoutFeedback>
          <Animated.View
            style={[
              styles.sheet,
              {
                transform: [{
                  translateY: sheetAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [300, 0],
                  }),
                }],
              },
            ]}
          >
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetName}>{selectedUser.name}</Text>
            <TouchableOpacity style={styles.sheetOption} activeOpacity={0.7} onPress={handleUnblock}>
              <Text style={styles.sheetOptionText}>Unblock {selectedUser.name.split(' ')[0]}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.sheetOption} activeOpacity={0.7} onPress={closeSheet}>
              <Text style={styles.sheetOptionText}>Keep blocked</Text>
            </TouchableOpacity>
          </Animated.View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F7F7',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EEE',
    borderRadius: 48,
    paddingLeft: 8,
    paddingRight: 12,
    paddingVertical: 10,
    height: 40,
    minWidth: 70,
    position: 'absolute',
    top: 54,
    left: 16,
    zIndex: 10,
  },
  backButtonText: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 12,
    fontWeight: '400' as const,
    color: '#333',
    lineHeight: 15,
  },
  bottomCard: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    top: 102,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  topSpacer: {
    height: 20,
  },
  divider: {
    height: 1,
    backgroundColor: '#E3E3E3',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    paddingTop: 24,
    paddingBottom: 24,
    gap: 16,
  },
  title: {
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat',
    fontSize: 18,
    fontWeight: '700' as const,
    color: '#333',
    lineHeight: 24,
  },
  loader: {
    marginTop: 32,
  },
  emptyText: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 14,
    fontWeight: '400' as const,
    color: '#7B7B7B',
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 32,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 16,
    fontWeight: '500' as const,
    color: '#333',
    lineHeight: 22,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    zIndex: 20,
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingBottom: 40,
    paddingTop: 12,
    zIndex: 30,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D9D9D9',
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetName: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#333',
    lineHeight: 22,
    marginBottom: 8,
  },
  sheetOption: {
    paddingVertical: 12,
  },
  sheetOptionText: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 14,
    fontWeight: '400' as const,
    color: '#333',
    lineHeight: 18,
  },
});
