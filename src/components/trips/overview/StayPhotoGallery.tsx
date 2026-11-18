// StayPhotoGallery — the stay's photos on the trip page, one per page,
// swiped sideways. Main photo first, then the gallery extras.
//
// With a single photo it renders just that image, exactly as before. With
// more, a small "2 / 5" counter sits on the photo and dots run under it.
import React, { useCallback, useState } from 'react';
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { Image as CachedImage } from 'expo-image';
import { textStyles } from '../../../theme/typography';

interface Props {
  uris: string[];
  /** The stay card's image box (size, aspect ratio, radius). */
  imageStyle: StyleProp<ViewStyle>;
}

export const StayPhotoGallery: React.FC<Props> = ({ uris, imageStyle }) => {
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (width <= 0) return;
      const next = Math.round(e.nativeEvent.contentOffset.x / width);
      setIndex(prev => (prev === next ? prev : next));
    },
    [width],
  );

  if (uris.length <= 1) {
    return (
      <CachedImage
        source={{ uri: uris[0] }}
        style={imageStyle as any}
        contentFit="cover"
        cachePolicy="memory-disk"
      />
    );
  }

  return (
    <View style={styles.root}>
      <View
        style={[imageStyle, styles.clip]}
        onLayout={e => setWidth(e.nativeEvent.layout.width)}
      >
        {width > 0 && (
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onScroll={onScroll}
            scrollEventThrottle={32}
            // The stay card itself is a link: a swipe must win over its tap.
            nestedScrollEnabled
            accessibilityLabel={`Stay photos, ${index + 1} of ${uris.length}`}
          >
            {uris.map((uri, i) => (
              <CachedImage
                key={`${uri}-${i}`}
                source={{ uri }}
                style={{ width, height: '100%' }}
                contentFit="cover"
                cachePolicy="memory-disk"
              />
            ))}
          </ScrollView>
        )}
        <View style={styles.counter} pointerEvents="none">
          <Text style={styles.counterText}>
            {index + 1} / {uris.length}
          </Text>
        </View>
      </View>
      <View style={styles.dots} pointerEvents="none">
        {uris.map((_, i) => (
          <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { gap: 8 },
  clip: { overflow: 'hidden' },
  counter: {
    position: 'absolute',
    top: 10,
    right: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  counterText: { ...textStyles.B3, color: '#FFFFFF' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#D9D9D9' },
  dotActive: { backgroundColor: '#333333' },
});
