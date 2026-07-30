import React from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ImageBackground,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../components/Text';
import { Images } from '../assets/images';
import { ff, fs } from '../theme/fonts';

interface SwellyoTeamWelcomeProps {
  onBack?: () => void;
}

export const SwellyoTeamWelcome: React.FC<SwellyoTeamWelcomeProps> = ({
  onBack,
}) => {
  const welcomeMessage = `Hey! Welcome to Swellyo 🤙

Stoked you're here. Swellyo began as a wild idea between friends who believed travel could be deeper — more connected to culture, nature, and each other.

Over time, that idea became a shared vision for a new kind of travel ecosystem, one shaped by community and the environments we move through.

We're grateful to be building this with you.

Drop in with Swelly, start connecting and help us grow the Swellyo community.

 - Jake & Eyal`;

  return (
    
    <SafeAreaView style={{flex: 1, backgroundColor: '#212121' }} edges={['top']}>
      <View style={{ flex: 1, backgroundColor: '#F7F7F7' }}>
      {/* Header */}
      <View style={styles.headerContainer}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <TouchableOpacity 
              style={styles.backButton}
              onPress={onBack}
            >
              <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
            </TouchableOpacity>
            
            {/* Two 52px avatars — the left one sits ON TOP, ringed in the
                header's own #212121, and overlaps the one behind it by 20px
                (Figma 14351:55280). */}
            <View style={styles.avatarContainer}>
              <View style={[styles.avatar, styles.avatarFront]}>
                <Image
                  source={Images.userAvatar1}
                  style={styles.avatarImage}
                  resizeMode="cover"
                />
              </View>
              <View style={[styles.avatar, styles.avatarBack]}>
                <Image
                  source={Images.userAvatar2}
                  style={styles.avatarImage}
                  resizeMode="cover"
                />
              </View>
            </View>
          </View>
          
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>Swellyo Team</Text>
            {/* <Text style={styles.profileStatus}>Update</Text> */}
          </View>
          
          {/* <TouchableOpacity style={styles.menuButton}>
            <Ionicons name="ellipsis-vertical" size={24} color="#FFFFFF" />
          </TouchableOpacity> */}
        </View>
        {/* Gradient border at bottom */}
        <LinearGradient
          colors={['#05BCD3', '#DBCDBC']}
          locations={[0, 0.7]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.headerGradientBorder}
        />
      </View>

      {/* Chat Messages */}
      <View style={styles.chatContainer}>
        <ImageBackground
          source={Images.chatBackground}
          style={styles.backgroundImage}
          resizeMode="cover"
        >
          <ScrollView
            style={styles.messagesList}
            contentContainerStyle={styles.messagesContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Welcome Message */}
            <View style={styles.messageContainer}>
              <View style={styles.receivedMessageContainer}>
                <View style={styles.messageBubble}>
                  <View style={styles.messageTextContainer}>
                    <Text style={styles.messageText}>{welcomeMessage}</Text>
                  </View>
                  <View style={styles.timestampContainer}>
                    <Text style={styles.timestamp}>10:45</Text>
                  </View>
                </View>
              </View>
            </View>
            
            {/* Keeps the last line clear of the floating Swelly avatar + its
                "Tap to get started" hint, which the nav layer draws on top. */}
            <View style={styles.spacer} />
          </ScrollView>
        </ImageBackground>
      </View>
    </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F7F7',
  },
  headerContainer: {
    backgroundColor: '#212121',
    paddingTop: Platform.OS === 'ios' ? 0 : 20,
    paddingBottom: 20,
  },
  headerGradientBorder: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 16,
    paddingTop: Platform.OS === 'web' ? 0 : 30,
  
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  backButton: {
    padding: 4,
  },
  avatarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    overflow: 'hidden',
  },
  avatarFront: {
    borderWidth: 1.5,
    borderColor: '#212121', // Surface/M 07 — the header's own background
    marginRight: -20,
    zIndex: 2,
  },
  avatarBack: {
    zIndex: 1,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  profileInfo: {
    flex: 1,
    flexDirection: 'column',
    gap: 4,
  },
  // Inter SemiBold, Size/md (14) / Size/xl (18) — ff() so native gets the real
  // SemiBold cut instead of silently falling back to Regular.
  profileName: {
    fontFamily: ff('Inter', '600'),
    fontSize: fs(14),
    lineHeight: 18,
    color: '#FFFFFF',
    ...(Platform.OS === 'web' && { fontWeight: '600' as const }),
    ...(Platform.OS === 'android' && { includeFontPadding: false }),
  },
  profileStatus: {
    fontSize: 13,
    color: '#A0A0A0',
    fontFamily: Platform.OS === 'web' ? 'var(--Family-Body, Inter), sans-serif' : 'Inter',
  },
  menuButton: {
    padding: 4,
  },
  chatContainer: {
    flex: 1,
  },
  backgroundImage: {
    flex: 1,
  },
  messagesList: {
    flex: 1,
  },
  messagesContent: {
    paddingTop: 24,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  messageContainer: {
    marginBottom: 16,
  },
  receivedMessageContainer: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingLeft: 0,
    paddingRight: 48,
  },
  messageBubble: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 16,
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 8,
    maxWidth: 300,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  messageTextContainer: {
    marginBottom: 10,
  },
  messageText: {
    fontSize: 14,
    lineHeight: 17,
    color: '#333333',
    fontFamily: Platform.OS === 'web' ? 'var(--Family-Body, Inter), sans-serif' : 'Inter',
  },
  timestampContainer: {
    alignItems: 'flex-start',
  },
  timestamp: {
    fontSize: 14,
    color: '#7B7B7B',
    opacity: 0.5,
    fontFamily: Platform.OS === 'web' ? 'var(--Family-Body, Inter), sans-serif' : 'Inter',
  },
  // Clears the floating Swelly avatar (97pt) and its hint.
  spacer: {
    height: 160,
  },
});

