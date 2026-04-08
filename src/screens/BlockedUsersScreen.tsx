import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  ScrollView,
  ActivityIndicator,
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

  const handleUnblock = async (userId: string) => {
    setUnblockingId(userId);
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
          <Text style={styles.title}>Blocked users</Text>

          {loading ? (
            <ActivityIndicator size="small" color="#333" style={styles.loader} />
          ) : blockedUsers.length === 0 ? (
            <Text style={styles.emptyText}>No blocked users</Text>
          ) : (
            blockedUsers.map(user => (
              <View key={user.user_id} style={styles.userRow}>
                <ProfileImage
                  imageUrl={user.profile_image_url}
                  name={user.name}
                  style={styles.avatar}
                  showLoadingIndicator={false}
                />
                <Text style={styles.userName} numberOfLines={1}>{user.name}</Text>
                <TouchableOpacity
                  style={styles.unblockButton}
                  onPress={() => handleUnblock(user.user_id)}
                  activeOpacity={0.7}
                  disabled={unblockingId === user.user_id}
                >
                  {unblockingId === user.user_id ? (
                    <ActivityIndicator size="small" color="#333" />
                  ) : (
                    <Text style={styles.unblockText}>Unblock</Text>
                  )}
                </TouchableOpacity>
              </View>
            ))
          )}
        </ScrollView>
      </View>
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
  userName: {
    flex: 1,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 16,
    fontWeight: '500' as const,
    color: '#333',
    lineHeight: 22,
  },
  unblockButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E3E3E3',
    minWidth: 80,
    alignItems: 'center',
  },
  unblockText: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 13,
    fontWeight: '500' as const,
    color: '#333',
    lineHeight: 16,
  },
});
