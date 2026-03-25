import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Platform,
  Image,
  ScrollView,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { Text } from './Text';
import { borderRadius } from '../styles/theme';
import { getImageUrl } from '../services/media/imageService';
import type { OnboardingMatch } from '../services/matching/onboardingMatchingService';

interface WelcomeToLineupOverlayProps {
  visible: boolean;
  matches: OnboardingMatch[];
  onClose: () => void;
  onConnect: (match: OnboardingMatch) => void;
  onViewProfile: (userId: string) => void;
  onMoreMatches: () => void;
}

const CARD_CONTAINER_WIDTH = 350;
const CARD_HORIZONTAL_PADDING = 19;
const INNER_WIDTH = CARD_CONTAINER_WIDTH - CARD_HORIZONTAL_PADDING * 2; // 312
const CAROUSEL_CARD_WIDTH = INNER_WIDTH * 0.75; // ~234
const CAROUSEL_CARD_SPACING = 10;

const TEAL = '#2B8C96';
const CONNECT_BTN_COLOR = '#B8A88A';
const BACKDROP_COLOR = 'rgba(33, 33, 33, 0.8)';

const coverImageUrl = getImageUrl('/COVER IMAGE.jpg');

export const WelcomeToLineupOverlay: React.FC<WelcomeToLineupOverlayProps> = ({
  visible,
  matches,
  onClose,
  onConnect,
  onViewProfile,
  onMoreMatches,
}) => {
  const [activeIndex, setActiveIndex] = useState(1);
  const scrollViewRef = useRef<ScrollView>(null);

  // Scroll to middle card on mount (contentOffset doesn't work on web)
  useEffect(() => {
    if (visible && matches.length > 1) {
      const timer = setTimeout(() => {
        scrollViewRef.current?.scrollTo({
          x: 1 * (CAROUSEL_CARD_WIDTH + CAROUSEL_CARD_SPACING),
          animated: false,
        });
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [visible, matches.length]);

  

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = e.nativeEvent.contentOffset.x;
    const index = Math.round(offset / (CAROUSEL_CARD_WIDTH + CAROUSEL_CARD_SPACING));
    if (index >= 0 && index < matches.length) {
      setActiveIndex(index);
    }
  };

  const activeMatch = matches[activeIndex] || matches[0];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent={Platform.OS === 'android'}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          {/* Close button */}
          <TouchableOpacity style={styles.closeButton} onPress={onClose} activeOpacity={0.7}>
            <Text style={styles.closeButtonText}>✕</Text>
          </TouchableOpacity>

          <View style={styles.content}>
            <Text style={styles.title}>
              {'Congrats!\nYour first connection is\nhappening right now!'}
            </Text>

            {matches.length > 0 ? (
              <View style={styles.carouselClip}>
              <ScrollView
                ref={scrollViewRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                snapToInterval={CAROUSEL_CARD_WIDTH + CAROUSEL_CARD_SPACING}
                decelerationRate="fast"
                contentContainerStyle={styles.carouselContent}
                onScroll={onScroll}
                scrollEventThrottle={16}
                style={styles.carousel}
              >
                {matches.map((item) => {
                  const profileImageUri = item.profile_image_url || undefined;
                  return (
                    <View key={item.user_id} style={styles.userCard}>
                      <Image source={{ uri: coverImageUrl }} style={styles.coverImage} />
                      <View style={styles.profilePicContainer}>
                        {profileImageUri ? (
                          <Image source={{ uri: profileImageUri }} style={styles.profilePic} />
                        ) : (
                          <View style={[styles.profilePic, styles.profilePicPlaceholder]}>
                            <Text style={styles.profilePicInitial}>
                              {(item.name || 'U').charAt(0).toUpperCase()}
                            </Text>
                          </View>
                        )}
                      </View>
                      <View style={styles.cardInfo}>
                        <Text style={styles.cardName}>{item.name || 'User'}</Text>
                        <Text style={styles.cardDetails}>
                          {item.age != null ? `${item.age} yo` : ''}
                          {item.age != null && item.country_from ? ' | ' : ''}
                          {item.country_from || ''}
                        </Text>
                        <TouchableOpacity onPress={() => onViewProfile(item.user_id)}>
                          <Text style={styles.viewProfileLink}>View Profile</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
              </View>
            ) : null}

            <Text style={styles.subtitle}>
              {'You and these 3 are\nEXTRA aligned!'}
            </Text>

            {activeMatch && (
              <TouchableOpacity
                style={styles.connectButton}
                onPress={() => onConnect(activeMatch)}
                activeOpacity={0.8}
              >
                <Text style={styles.connectButtonText}>Connect to {activeMatch.name || 'User'}</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity onPress={onMoreMatches}>
              <Text style={styles.bottomLink}>More Matches</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: BACKDROP_COLOR,
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    width: CARD_CONTAINER_WIDTH,
    height: 713,
    backgroundColor: '#FFFFFF',
    borderRadius: borderRadius.medium,
    paddingBottom: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 10,
  },
  closeButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButtonText: {
    fontSize: 16,
    color: '#666',
    fontWeight: '600',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: CARD_HORIZONTAL_PADDING,
    paddingTop: 40,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: TEAL,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 30,
    ...(Platform.OS === 'web' ? { fontFamily: 'Montserrat, sans-serif' } : {}),
  },
  carouselClip: {
    width: CARD_CONTAINER_WIDTH,
    overflow: 'hidden',
    alignSelf: 'center',
    marginHorizontal: -CARD_HORIZONTAL_PADDING,
  },
  carousel: {
    flexGrow: 0,
    maxHeight: 280,
  },
  carouselContent: {
    paddingHorizontal: (CARD_CONTAINER_WIDTH - CAROUSEL_CARD_WIDTH) / 2,
  },
  userCard: {
    width: CAROUSEL_CARD_WIDTH,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 2.5,
    borderColor: '#A8DDE0',
    marginRight: CAROUSEL_CARD_SPACING,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  coverImage: {
    width: '100%',
    height: 110,
    resizeMode: 'cover',
  },
  profilePicContainer: {
    alignItems: 'center',
    marginTop: -35,
  },
  profilePic: {
    width: 70,
    height: 70,
    borderRadius: 35,
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  profilePicPlaceholder: {
    backgroundColor: '#A8DDE0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  profilePicInitial: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  cardInfo: {
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  cardName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#222',
    marginBottom: 2,
    ...(Platform.OS === 'web' ? { fontFamily: 'Montserrat, sans-serif' } : {}),
  },
  cardDetails: {
    fontSize: 13,
    color: '#888',
    marginBottom: 6,
    ...(Platform.OS === 'web' ? { fontFamily: 'Inter, sans-serif' } : {}),
  },
  viewProfileLink: {
    fontSize: 13,
    color: '#333',
    textDecorationLine: 'underline',
    ...(Platform.OS === 'web' ? { fontFamily: 'Inter, sans-serif' } : {}),
  },
  subtitle: {
    fontSize: 20,
    fontWeight: '700',
    color: TEAL,
    textAlign: 'center',
    marginTop: 20,
    marginBottom: 20,
    lineHeight: 28,
    ...(Platform.OS === 'web' ? { fontFamily: 'Montserrat, sans-serif' } : {}),
  },
  connectButton: {
    backgroundColor: CONNECT_BTN_COLOR,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    marginBottom: 16,
    minWidth: 200,
  },
  connectButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    ...(Platform.OS === 'web' ? { fontFamily: 'Montserrat, sans-serif' } : {}),
  },
  bottomLink: {
    fontSize: 14,
    color: '#333',
    textDecorationLine: 'underline',
    ...(Platform.OS === 'web' ? { fontFamily: 'Inter, sans-serif' } : {}),
  },
});
