import React, { useRef, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Dimensions,
} from 'react-native';
import { MatchedUser } from '../types/tripPlanning';
import { MatchedUserCard } from './MatchedUserCard';

const CAROUSEL_CARD_WIDTH = 274;
const CAROUSEL_CARD_SPACING = 10;

interface MatchedUsersCarouselProps {
  users: MatchedUser[];
  onViewProfile: (userId: string) => void;
}

export const MatchedUsersCarousel: React.FC<MatchedUsersCarouselProps> = ({
  users,
  onViewProfile,
}) => {
  const containerWidth = Math.min(Dimensions.get('window').width, 400);
  const isFewCards = users.length < 3;
  const sidePadding = isFewCards
    ? 16
    : (containerWidth - CAROUSEL_CARD_WIDTH) / 2;

  const scrollRef = useRef<ScrollView>(null);
  const hasScrolledRef = useRef(false);

  // Scroll to middle card once the ScrollView lays out
  const handleLayout = useCallback(() => {
    if (hasScrolledRef.current || users.length < 3) return;
    hasScrolledRef.current = true;
    const middleIndex = Math.floor(users.length / 2);
    const offset = middleIndex * (CAROUSEL_CARD_WIDTH + CAROUSEL_CARD_SPACING);
    scrollRef.current?.scrollTo({ x: offset, animated: false });
  }, [users.length]);

  if (users.length === 0) return null;

  // Single card — no carousel needed
  if (users.length === 1) {
    return (
      <View style={styles.singleCardContainer}>
        <MatchedUserCard user={users[0]} onViewProfile={onViewProfile} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.carouselClip, { width: containerWidth }]}>
        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          scrollEnabled
          snapToInterval={CAROUSEL_CARD_WIDTH + CAROUSEL_CARD_SPACING}
          decelerationRate="fast"
          contentContainerStyle={[
            styles.carouselContent,
            { paddingHorizontal: sidePadding },
          ]}
          style={styles.carousel}
          onLayout={handleLayout}
        >
          {users.map((user) => (
            <MatchedUserCard
              key={user.user_id}
              user={user}
              onViewProfile={onViewProfile}
              isCarousel
            />
          ))}
        </ScrollView>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginTop: 12,
    alignItems: 'center',
  },
  singleCardContainer: {
    marginTop: 12,
    alignItems: 'center',
  },
  carouselClip: {
    overflow: 'hidden',
    alignSelf: 'center',
  },
  carousel: {
    flexGrow: 0,
    maxHeight: 320,
  },
  carouselContent: {
    paddingVertical: 14,
  },
});
