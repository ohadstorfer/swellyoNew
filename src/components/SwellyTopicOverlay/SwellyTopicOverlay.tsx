import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Animated,
  Easing,
  TouchableOpacity,
  Image,
  Platform,
  Dimensions,
  ImageSourcePropType,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Images } from '../../assets/images';

export type SwellyTopicId = 'share_wisdom' | 'find_crew' | 'plan_trip' | 'just_waves';

type Topic = {
  id: SwellyTopicId;
  title: string;
  image: string;
  seed: string;
};

// URLs mirror CARD_IMAGES in OnboardingWelcomeScreen.tsx — kept inline to avoid a cross-screen
// import dependency.
const TOPICS: Topic[] = [
  {
    id: 'share_wisdom',
    title: 'Share your surf wisdom',
    image: 'https://rfdhtvcmagsbxqntnepv.supabase.co/storage/v1/object/public/onboarding-welcome-images/b0d7956780bd01fbfac42c1db76ed27df34c3fcf.jpg',
    seed: "Hey Swelly, I wanna share my surf wisdom.",
  },
  {
    id: 'find_crew',
    title: 'Connect with Like-Minded Travelers',
    image: 'https://rfdhtvcmagsbxqntnepv.supabase.co/storage/v1/object/public/onboarding-welcome-images/63ee08f6a46333084911295e23748727ebc90198.jpg',
    seed: "Hey Swelly, I wanna get connected with like-minded travelers.",
  },
  {
    id: 'plan_trip',
    title: 'Meet Potential Travel Partners',
    image: 'https://rfdhtvcmagsbxqntnepv.supabase.co/storage/v1/object/public/onboarding-welcome-images/6cbafc07268184703dff606b6cb48836431babec.jpg',
    seed: "Hey Swelly, I wanna meet potential travel partners.",
  },
  {
    id: 'just_waves',
    title: 'General Surf Guidance',
    image: 'https://rfdhtvcmagsbxqntnepv.supabase.co/storage/v1/object/public/onboarding-welcome-images/082aedec1b3d12fa462436f56cd5af2e3d6ad236.jpg',
    seed: "Hey Swelly, I'm looking for general surf guidance.",
  },
];

type Props = {
  visible: boolean;
  onSelect: (topicId: SwellyTopicId, seedMessage: string) => void;
};

export const SwellyTopicOverlay: React.FC<Props> = ({ visible, onSelect }) => {
  const screenHeight = Dimensions.get('window').height;
  const [mounted, setMounted] = useState(visible);
  const [selectedId, setSelectedId] = useState<SwellyTopicId | null>(null);
  const translateY = useRef(new Animated.Value(screenHeight)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  // Mount/unmount: flip `mounted` true before the slide-up, and flip false only after the
  // slide-down finishes so the Modal stays in the tree while animating away.
  useEffect(() => {
    if (visible && !mounted) {
      setMounted(true);
      setSelectedId(null);
      translateY.setValue(screenHeight);
      backdropOpacity.setValue(0);
    }
  }, [visible, mounted, screenHeight]);

  // Drive the animation after the Modal has actually rendered. A DOUBLE requestAnimationFrame
  // gives the native Modal time to mount + paint its initial state before the slide starts,
  // which avoids the sheet "teleporting" partway through the animation on iOS.
  useEffect(() => {
    if (!mounted) return;

    if (visible) {
      let raf2: number | null = null;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => {
          Animated.parallel([
            Animated.timing(backdropOpacity, {
              toValue: 1,
              duration: 320,
              useNativeDriver: true,
            }),
            Animated.timing(translateY, {
              toValue: 0,
              duration: 520,
              // ease-out-quart — deceleration is smooth and perceivable across the whole
              // travel, unlike ease-out-cubic which finishes ~85% of the motion in the first
              // third of the duration.
              easing: Easing.bezier(0.22, 1, 0.36, 1),
              useNativeDriver: true,
            }),
          ]).start();
        });
      });
      return () => {
        cancelAnimationFrame(raf1);
        if (raf2 != null) cancelAnimationFrame(raf2);
      };
    }

    Animated.parallel([
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: screenHeight,
        duration: 320,
        easing: Easing.bezier(0.64, 0, 0.78, 0),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) setMounted(false);
    });
  }, [mounted, visible, screenHeight]);

  const handleConfirm = () => {
    if (!selectedId) return;
    const topic = TOPICS.find(t => t.id === selectedId);
    if (topic) onSelect(topic.id, topic.seed);
  };

  if (!mounted) return null;

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      statusBarTranslucent
      hardwareAccelerated
    >
      <View style={styles.root}>
        <Animated.View
          style={[styles.backdrop, { opacity: backdropOpacity }]}
          pointerEvents="none"
        />
        <Animated.View
          style={[styles.sheet, { transform: [{ translateY }] }]}
        >
          <View style={styles.handleRow}>
            <View style={styles.handle} />
          </View>

          <View style={styles.avatarBubble}>
            <Image
              source={Images.swellyAvatar as ImageSourcePropType}
              style={styles.avatarImage}
              resizeMode="cover"
            />
          </View>

          <Text style={styles.title}>{`Yo!  What are we\nfocusing on today?`}</Text>

          <View style={styles.grid}>
            {TOPICS.map((topic) => {
              const selected = selectedId === topic.id;
              return (
                <TouchableOpacity
                  key={topic.id}
                  activeOpacity={0.85}
                  onPress={() => setSelectedId(topic.id)}
                  style={[styles.card, selected && styles.cardSelected]}
                >
                  <Image
                    source={{ uri: topic.image }}
                    style={styles.cardImage}
                    resizeMode="cover"
                  />
                  <View style={styles.cardTitleWrap}>
                    <Text style={styles.cardTitle} numberOfLines={2}>
                      {topic.title}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.checkbox,
                      selected ? styles.checkboxSelected : styles.checkboxUnselected,
                    ]}
                  >
                    {selected && (
                      <Ionicons name="checkmark" size={14} color="#FFFFFF" />
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.subtext}>Select only 1 option</Text>

          <TouchableOpacity
            activeOpacity={0.85}
            onPress={handleConfirm}
            disabled={!selectedId}
            style={[styles.cta, !selectedId && styles.ctaDisabled]}
          >
            <Text style={styles.ctaText}>Let's go!</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 8,
    paddingBottom: 24,
    paddingHorizontal: 16,
    alignItems: 'center',
    width: '100%',
  },
  handleRow: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    width: '100%',
  },
  handle: {
    width: 80,
    height: 4,
    borderRadius: 20,
    backgroundColor: '#7B7B7B',
  },
  avatarBubble: {
    width: 79,
    height: 86,
    borderRadius: 40,
    borderWidth: 1,
    borderColor: '#B72DF2',
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 12,
    ...Platform.select({
      ios: {
        shadowColor: 'rgba(183, 45, 242, 0.24)',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 1,
        shadowRadius: 14,
      },
      android: { elevation: 4 },
      web: {
        // @ts-ignore web-only style
        boxShadow: '0px 2px 14px rgba(183, 45, 242, 0.24)',
      },
    }),
  },
  avatarImage: {
    width: 75,
    height: 82,
    borderRadius: 37,
  },
  title: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat',
    color: '#212121',
    textAlign: 'center',
    marginBottom: 20,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
    width: '100%',
    maxWidth: 345,
    marginBottom: 20,
  },
  card: {
    width: 163,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 8,
    borderWidth: 1,
    borderColor: 'transparent',
    ...Platform.select({
      ios: {
        shadowColor: 'rgba(89, 110, 124, 0.15)',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 1,
        shadowRadius: 16,
      },
      android: { elevation: 3 },
      web: {
        // @ts-ignore web-only style
        boxShadow: '0px 2px 16px rgba(89, 110, 124, 0.15)',
      },
    }),
  },
  cardSelected: {
    borderColor: '#0788B0',
  },
  cardImage: {
    width: '100%',
    height: 104,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
  },
  cardTitleWrap: {
    paddingTop: 12,
    minHeight: 42,
    justifyContent: 'flex-start',
  },
  cardTitle: {
    fontSize: 16,
    lineHeight: 18,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    color: '#333333',
    textAlign: 'left',
  },
  checkbox: {
    position: 'absolute',
    top: 13,
    right: 13,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxUnselected: {
    backgroundColor: '#F7F7F7',
    borderWidth: 1,
    borderColor: '#CFCFCF',
  },
  checkboxSelected: {
    backgroundColor: '#05BCD3',
  },
  subtext: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '400',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    color: '#7B7B7B',
    textAlign: 'center',
    marginBottom: 16,
  },
  cta: {
    backgroundColor: '#212121',
    borderRadius: 12,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    minWidth: 150,
    paddingHorizontal: 24,
  },
  ctaDisabled: {
    opacity: 0.5,
  },
  ctaText: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600',
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat',
    color: '#FFFFFF',
    textAlign: 'center',
  },
});

export default SwellyTopicOverlay;
