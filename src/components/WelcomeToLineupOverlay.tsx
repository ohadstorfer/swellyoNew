import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Platform,
  Image,
  ScrollView,
  Animated,
  Easing,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
const CAROUSEL_CARD_WIDTH = 274 // ~234
const CAROUSEL_CARD_SPACING = 10;

const TEAL = '#2B8C96';
const BACKDROP_COLOR = 'rgba(33, 33, 33, 0.8)';

const coverImageUrl = getImageUrl('/COVER IMAGE.jpg');
const swellyImageUrl = getImageUrl('/swelly-welcome-to-lineup.png');

export const WelcomeToLineupOverlay: React.FC<WelcomeToLineupOverlayProps> = ({
  visible,
  matches,
  onClose,
  onConnect,
  onViewProfile,
  onMoreMatches,
}) => {
  console.log('[WelcomeToLineupOverlay] Rendered with', matches.length, 'matches:', matches.map(m => ({ user_id: m.user_id, name: m.name, profile_image_url: m.profile_image_url })));

  const [activeIndex, setActiveIndex] = useState(1);
  const scrollViewRef = useRef<ScrollView>(null);
  const swipeTouchStartX = useRef(0);
  const swipeHandledRef = useRef(false);
  const activeIndexRef = useRef(1);
  const swellySlideAnim = useRef(new Animated.Value(-200)).current;
  const slideOutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const carouselContainerRef = useRef<View>(null);

  // Keep ref in sync with state
  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  // Swelly character slide-in animation (2s delay), then slide out after 2s
  useEffect(() => {
    if (visible) {
      swellySlideAnim.setValue(-200);
      const slideInTimer = setTimeout(() => {
        Animated.timing(swellySlideAnim, {
          toValue: 0,
          duration: 500,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start(() => {
          // After slide-in completes, wait 2s then slide out
          const slideOutTimer = setTimeout(() => {
            Animated.timing(swellySlideAnim, {
              toValue: -200,
              duration: 500,
              easing: Easing.in(Easing.cubic),
              useNativeDriver: true,
            }).start();
          }, 2000);
          slideOutTimerRef.current = slideOutTimer;
        });
      }, 2000);
      return () => {
        clearTimeout(slideInTimer);
        if (slideOutTimerRef.current) clearTimeout(slideOutTimerRef.current);
      };
    } else {
      swellySlideAnim.setValue(-200);
    }
  }, [visible]);

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

  // Web: attach native DOM touch/mouse listeners for reliable swipe in mobile emulation
  useEffect(() => {
    if (Platform.OS !== 'web' || !visible) return;
    const node = (carouselContainerRef.current as any);
    if (!node) return;
    // React Native Web exposes the DOM node directly or via a property
    const domNode: HTMLElement | null = node instanceof HTMLElement ? node : node._nativeTag ?? null;
    if (!domNode) return;

    const onStart = (pageX: number) => {
      swipeTouchStartX.current = pageX;
      swipeHandledRef.current = false;
    };
    const onMove = (pageX: number) => {
      if (swipeHandledRef.current) return;
      const dx = pageX - swipeTouchStartX.current;
      if (Math.abs(dx) >= 20) {
        swipeHandledRef.current = true;
        const clamped = Math.max(0, Math.min(
          dx < 0 ? activeIndexRef.current + 1 : activeIndexRef.current - 1,
          matches.length - 1
        ));
        const offset = clamped * (CAROUSEL_CARD_WIDTH + CAROUSEL_CARD_SPACING);
        scrollViewRef.current?.scrollTo({ x: offset, animated: true });
        setActiveIndex(clamped);
      }
    };

    const handleTouchStartWeb = (e: TouchEvent) => onStart(e.touches[0].pageX);
    const handleTouchMoveWeb = (e: TouchEvent) => onMove(e.touches[0].pageX);
    const handleMouseDownWeb = (e: MouseEvent) => onStart(e.pageX);
    const handleMouseMoveWeb = (e: MouseEvent) => { if (e.buttons > 0) onMove(e.pageX); };

    domNode.addEventListener('touchstart', handleTouchStartWeb, { passive: true });
    domNode.addEventListener('touchmove', handleTouchMoveWeb, { passive: true });
    domNode.addEventListener('mousedown', handleMouseDownWeb);
    domNode.addEventListener('mousemove', handleMouseMoveWeb);

    return () => {
      domNode.removeEventListener('touchstart', handleTouchStartWeb);
      domNode.removeEventListener('touchmove', handleTouchMoveWeb);
      domNode.removeEventListener('mousedown', handleMouseDownWeb);
      domNode.removeEventListener('mousemove', handleMouseMoveWeb);
    };
  }, [visible, matches.length]);

  const scrollToIndex = (index: number) => {
    const clamped = Math.max(0, Math.min(index, matches.length - 1));
    const offset = clamped * (CAROUSEL_CARD_WIDTH + CAROUSEL_CARD_SPACING);
    scrollViewRef.current?.scrollTo({ x: offset, animated: true });
    setActiveIndex(clamped);
  };

  const handleSwipeStart = (pageX: number) => {
    swipeTouchStartX.current = pageX;
    swipeHandledRef.current = false;
  };

  const handleSwipeMove = (pageX: number) => {
    if (swipeHandledRef.current) return;
    const dx = pageX - swipeTouchStartX.current;
    if (Math.abs(dx) >= 20) {
      swipeHandledRef.current = true;
      const nextIndex = dx < 0
        ? activeIndexRef.current + 1
        : activeIndexRef.current - 1;
      scrollToIndex(nextIndex);
    }
  };

  const handleTouchStart = (e: any) => {
    const touch = e.nativeEvent?.touches?.[0] ?? e.nativeEvent;
    handleSwipeStart(touch?.pageX ?? 0);
  };

  const handleTouchMove = (e: any) => {
    const touch = e.nativeEvent?.touches?.[0] ?? e.nativeEvent;
    handleSwipeMove(touch?.pageX ?? 0);
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
        {/* Swelly character slide-in */}
        <Animated.Image
          source={{ uri: swellyImageUrl }}
          style={[
            styles.swellyImage,
            { transform: [{ translateX: swellySlideAnim }] },
          ]}
          pointerEvents="none"
        />
        <View style={styles.card} onStartShouldSetResponder={() => true}>
          <View style={styles.content}>
            <Text style={styles.title}>Stoked!</Text>
            <Text style={styles.subtitle}>
              Found strong matches{'\n'}for you
            </Text>
            <Text style={styles.subText}>
              You and these {matches.length || 3}  are on the same wave!
            </Text>

            {matches.length > 0 ? (
              <View style={styles.carouselClip} ref={carouselContainerRef}>
              <ScrollView
                ref={scrollViewRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                scrollEnabled={false}
                contentContainerStyle={styles.carouselContent}
                style={styles.carousel}
                {...(Platform.OS !== 'web' ? {
                  onTouchStart: handleTouchStart,
                  onTouchMove: handleTouchMove,
                } : {})}
              >
                {matches.map((item) => {
                  const profileImageUri = item.profile_image_url || undefined;
                  return (
                    <View key={item.user_id} style={styles.userCard}>
                      <View style={styles.userCardInner}>
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
                        </View>
                        <View style={styles.viewProfileDivider} />
                        <TouchableOpacity
                          style={styles.viewProfileButton}
                          onPress={() => onViewProfile(item.user_id)}
                        >
                          <Text style={styles.viewProfileLink}>View Profile</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
              </View>
            ) : null}

            {/* Pagination dots */}
            {matches.length > 1 && (
              <View style={styles.paginationContainer}>
                {matches.map((_, index) => (
                  <View
                    key={index}
                    style={[
                      styles.paginationDot,
                      index === activeIndex && styles.paginationDotActive,
                    ]}
                  />
                ))}
              </View>
            )}

            {activeMatch && (
              <TouchableOpacity
                style={styles.connectButton}
                onPress={() => onConnect(activeMatch)}
                activeOpacity={0.8}
              >
                <Text style={styles.connectButtonText}>
  Connect to {(activeMatch?.name?.trim().split(' ')[0]) || 'User'}
</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.bottomLinkContainer} onPress={onMoreMatches}>
              <Ionicons name="sync-outline" size={18} color="#333" style={styles.bottomLinkIcon} />
              <Text style={styles.bottomLink}>find others</Text>
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
  swellyImage: {
    position: 'absolute',
    top: 25,
    left: -70,
    width: 331 * 1.2,  // 496.5
height: 221 * 1.2, // 331.5
    resizeMode: 'contain',
    zIndex: 20,
  },
  card: {
    width: CARD_CONTAINER_WIDTH,
    backgroundColor: '#FFFFFF',
    borderRadius: borderRadius.medium,
    paddingBottom: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 10,
  },
  content: {
    alignItems: 'center',
    paddingHorizontal: CARD_HORIZONTAL_PADDING,
    paddingTop: 40,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: TEAL,
    textAlign: 'center',
    marginBottom: 8,
    lineHeight: 28.8,
    ...(Platform.OS === 'web' ? { fontFamily: 'Montserrat, sans-serif' } : {}),
  },
  subtitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#222',
    textAlign: 'center',
    marginBottom: 12,
    lineHeight: 28,
    ...(Platform.OS === 'web' ? { fontFamily: 'Montserrat, sans-serif' } : {}),
  },
  subText: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
    marginBottom: 16,
    ...(Platform.OS === 'web' ? { fontFamily: 'Inter, sans-serif' } : {}),
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
    paddingVertical: 14,
  },
  userCard: {
    width: CAROUSEL_CARD_WIDTH,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 10,
    marginRight: CAROUSEL_CARD_SPACING,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  userCardInner: {
    overflow: 'hidden',
    borderRadius: 12,
  },
  coverImage: {
    width: '100%',
    height: 102,
    resizeMode: 'cover',
  },
  profilePicContainer: {
    alignItems: 'center',
    marginTop: -75,
  },
  profilePic: {
    width: 99,
    height: 99,
    borderRadius: 64,
    borderWidth: 3.5,
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
  viewProfileDivider: {
    height: 1,
    backgroundColor: '#E5E5E5',
    marginHorizontal: 4,
  },
  viewProfileButton: {
    alignItems: 'center',
    top:14,
    marginBottom: 16,
  },
  viewProfileLink: {
    fontSize: 15,
    color: '#333',
    ...(Platform.OS === 'web' ? { fontFamily: 'Inter, sans-serif' } : {}),
  },
  paginationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
    marginBottom: 20,
    gap: 6,
  },
  paginationDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#D1D1D1',
  },
  paginationDotActive: {
    width: 20,
    borderRadius: 4,
    backgroundColor: TEAL,
  },
  connectButton: {
    backgroundColor: TEAL,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    marginBottom: 16,
    width: '100%',
  },
  connectButtonText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    ...(Platform.OS === 'web' ? { fontFamily: 'Montserrat, sans-serif' } : {}),
  },
  bottomLinkContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  bottomLinkIcon: {
    marginRight: 6,
  },
  bottomLink: {
    fontSize: 14,
    fontWeight: '700',
    color: '#333',
    textDecorationLine: 'underline',
    ...(Platform.OS === 'web' ? { fontFamily: 'Inter, sans-serif' } : {}),
  },
});
