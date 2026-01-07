import React, { useState } from 'react';
import {
  View,
  Modal,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  Image,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';
import { colors, spacing, typography, borderRadius } from '../styles/theme';
import { supabase } from '../config/supabase';
import { ProfileImage } from './ProfileImage';

interface User {
  user_id: string;
  name: string;
  profile_image_url: string | null;
  email: string;
}

interface UserSearchModalProps {
  visible: boolean;
  onClose: () => void;
  onUserSelect: (userId: string) => void;
}

export const UserSearchModal: React.FC<UserSearchModalProps> = ({
  visible,
  onClose,
  onUserSelect,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);

  const searchUsers = async (query: string) => {
    if (!query.trim()) {
      setUsers([]);
      return;
    }

    setLoading(true);
    try {
      const { data: currentUser } = await supabase.auth.getUser();
      const currentUserId = currentUser?.user?.id;
      
      if (!currentUserId) {
        console.error('No current user found');
        setUsers([]);
        return;
      }

      console.log('Searching for:', query);
      
      // Search in users table by email
      const { data: usersByEmail, error: usersError } = await supabase
        .from('users')
        .select('id, email')
        .ilike('email', `%${query}%`)
        .neq('id', currentUserId)
        .limit(20);

      if (usersError) {
        console.error('Error searching users by email:', usersError);
      } else {
        console.log('Found users by email:', usersByEmail?.length || 0);
      }

      // Search in surfers table by name
      const { data: surfersByName, error: surfersError } = await supabase
        .from('surfers')
        .select('user_id, name, profile_image_url')
        .ilike('name', `%${query}%`)
        .neq('user_id', currentUserId)
        .limit(20);

      if (surfersError) {
        console.error('Error searching surfers by name:', surfersError);
      } else {
        console.log('Found surfers by name:', surfersByName?.length || 0);
      }

      // Combine results: get all unique user IDs
      const userIdsFromSurfers = (surfersByName || []).map(s => s.user_id);
      const userIdsFromUsers = (usersByEmail || []).map(u => u.id);
      const allUserIds = [...new Set([...userIdsFromSurfers, ...userIdsFromUsers])];

      if (allUserIds.length === 0) {
        setUsers([]);
        return;
      }

      // Get all user emails
      const { data: allUsersData, error: allUsersError } = await supabase
        .from('users')
        .select('id, email')
        .in('id', allUserIds);

      if (allUsersError) {
        console.error('Error fetching user emails:', allUsersError);
      }

      // Get all surfer profiles
      const { data: allSurfersData, error: allSurfersError } = await supabase
        .from('surfers')
        .select('user_id, name, profile_image_url')
        .in('user_id', allUserIds);

      if (allSurfersError) {
        console.error('Error fetching surfer profiles:', allSurfersError);
      }

      // Combine results: prefer surfer data if available, otherwise use email as name
      const combinedUsers: User[] = allUserIds.map(userId => {
        const surferData = (allSurfersData || []).find(s => s.user_id === userId);
        const userData = (allUsersData || []).find(u => u.id === userId);

        return {
          user_id: userId,
          name: surferData?.name || userData?.email?.split('@')[0] || 'User',
          profile_image_url: surferData?.profile_image_url || null,
          email: userData?.email || '',
        };
      });

      // Filter to only include users that match the search query (name or email)
      const queryLower = query.toLowerCase();
      const filteredUsers = combinedUsers.filter(user => 
        user.name.toLowerCase().includes(queryLower) ||
        user.email.toLowerCase().includes(queryLower)
      );

      console.log('Total combined users found:', filteredUsers.length);
      setUsers(filteredUsers);
    } catch (error) {
      console.error('Error searching users:', error);
      setUsers([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (text: string) => {
    setSearchQuery(text);
    searchUsers(text);
  };

  const handleUserPress = (userId: string) => {
    onUserSelect(userId);
    setSearchQuery('');
    setUsers([]);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Search Users</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Ionicons name="close" size={24} color={colors.textDark} />
            </TouchableOpacity>
          </View>

          {/* Search Input */}
          <View style={styles.searchContainer}>
            <Ionicons name="search" size={20} color={colors.textSecondary} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search by name..."
              value={searchQuery}
              onChangeText={handleSearch}
              autoFocus
              placeholderTextColor={colors.textSecondary}
            />
          </View>

          {/* Results */}
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.brandTeal} />
            </View>
          ) : (
            <FlatList
              data={users}
              keyExtractor={(item) => item.user_id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.userItem}
                  onPress={() => handleUserPress(item.user_id)}
                >
                  <ProfileImage
                    imageUrl={item.profile_image_url}
                    name={item.name}
                    style={styles.avatar}
                    showLoadingIndicator={false}
                  />
                  <View style={styles.userInfo}>
                    <Text style={styles.userName}>{item.name}</Text>
                    <Text style={styles.userEmail}>{item.email}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                searchQuery.trim() ? (
                  <View style={styles.emptyContainer}>
                    <Text style={styles.emptyText}>No users found</Text>
                  </View>
                ) : (
                  <View style={styles.emptyContainer}>
                    <Text style={styles.emptyText}>Start typing to search users</Text>
                  </View>
                )
              }
            />
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.white,
    borderTopLeftRadius: borderRadius.large,
    borderTopRightRadius: borderRadius.large,
    height: '80%',
    paddingTop: spacing.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  headerTitle: {
    ...typography.titleLarge,
    color: colors.textDark,
  },
  closeButton: {
    padding: spacing.xs,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.backgroundGray,
    borderRadius: borderRadius.medium,
    paddingHorizontal: spacing.md,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    height: 48,
  },
  searchInput: {
    flex: 1,
    marginLeft: spacing.sm,
    ...typography.body,
    color: colors.textDark,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.backgroundGray,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginRight: spacing.md,
  },
  avatarPlaceholder: {
    backgroundColor: colors.brandTeal,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarPlaceholderText: {
    color: colors.white,
    fontSize: 18,
    fontWeight: 'bold',
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    ...typography.body,
    fontWeight: '600',
    color: colors.textDark,
    marginBottom: 2,
  },
  userEmail: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: spacing.xxl,
  },
  emptyText: {
    ...typography.body,
    color: colors.textSecondary,
  },
});
