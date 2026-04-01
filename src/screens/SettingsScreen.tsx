import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Platform,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface SettingsScreenProps {
  onBack: () => void;
  userName: string;
  userAvatar: string | null;
}

export function SettingsScreen({ onBack, userName, userAvatar }: SettingsScreenProps) {
  return (
    <View style={styles.container}>
      {/* Back button - floating on top */}
      <TouchableOpacity style={styles.backButton} onPress={onBack} activeOpacity={0.7}>
        <Ionicons name="chevron-back" size={18} color="#333" />
        <Text style={styles.backButtonText}>Back</Text>
      </TouchableOpacity>

      {/* Profile image - floating above the white card */}
      <View style={styles.profileImageWrapper}>
        <View style={styles.avatarBorder}>
          {userAvatar ? (
            <Image source={{ uri: userAvatar }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder]}>
              <Ionicons name="person" size={40} color="#ccc" />
            </View>
          )}
        </View>
      </View>

      {/* White bottom card */}
      <View style={styles.bottomCard}>
        {/* Spacer for the avatar overlap */}
        <View style={styles.avatarSpacer} />

        {/* User name */}
        <View style={styles.nameContainer}>
          <Text style={styles.userName}>{userName}</Text>
        </View>

        {/* Divider */}
        <View style={styles.divider} />

        {/* Settings section */}
        <ScrollView style={styles.settingsList} contentContainerStyle={styles.settingsListContent}>
          <Text style={styles.sectionTitle}>Settings</Text>

          <TouchableOpacity style={styles.menuRow} activeOpacity={0.7}>
            <Ionicons name="trash-outline" size={24} color="#222B30" />
            <Text style={styles.menuRowText}>Delete account</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuRow} activeOpacity={0.7}>
            <Ionicons name="document-text-outline" size={24} color="#222B30" />
            <Text style={styles.menuRowText}>Terms of service</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuRow} activeOpacity={0.7}>
            <Ionicons name="shield-checkmark-outline" size={24} color="#222B30" />
            <Text style={styles.menuRowText}>Privacy policy</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuRow} activeOpacity={0.7}>
            <Ionicons name="chatbubble-ellipses-outline" size={24} color="#222B30" />
            <Text style={styles.menuRowText}>Report bug</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuRow} activeOpacity={0.7}>
            <Ionicons name="information-circle-outline" size={24} color="#222B30" />
            <Text style={styles.menuRowText}>About us</Text>
          </TouchableOpacity>
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
    fontSize: 16,
    fontWeight: '400' as const,
    color: '#333',
    lineHeight: 15,
  },
  profileImageWrapper: {
    position: 'absolute',
    top: 88,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 10,
  },
  avatarBorder: {
    width: 120,
    height: 120,
    borderRadius: 80,
    borderWidth: 6,
    borderColor: '#FFFFFF',
    overflow: 'hidden',
  },
  avatar: {
    width: '100%' as any,
    height: '100%' as any,
    borderRadius: 80,
  },
  avatarPlaceholder: {
    backgroundColor: '#F0F0F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomCard: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    top: 139,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  avatarSpacer: {
    height: 76,
  },
  nameContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  userName: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 18,
    fontWeight: '500' as const,
    color: '#333',
    lineHeight: 24,
  },
  divider: {
    height: 1,
    backgroundColor: '#E3E3E3',
    marginTop: 24,
  },
  settingsList: {
    flex: 1,
  },
  settingsListContent: {
    paddingTop: 24,
    paddingBottom: 24,
    gap: 8,
  },
  sectionTitle: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 20,
    fontWeight: '700' as const,
    color: '#333',
    lineHeight: 24,
    marginBottom: 8,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 10,
  },
  menuRowText: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 14,
    fontWeight: '400' as const,
    color: '#222B30',
    lineHeight: 18,
    flex: 1,
  },
});
