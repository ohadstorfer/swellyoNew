// Reusable info card for the Who-is-it-for / Basic-deets / Vibez wizard steps.
// Matches Figma node 12216:25261 — white surface, 16pt radius, soft drop
// shadow, image on one side, title + value text on the other.
//
// Two variants:
//   • 'standard' — image LEFT (96×112), text right. Height ~128pt.
//   • 'board'    — image RIGHT (131×209) for the board composition. Height ~229pt.

import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ImageSourcePropType,
  Platform,
  Animated,
  Easing,
} from 'react-native';

const FONT_INTER = Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter';
const FONT_MONTSERRAT =
  Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat';

const C = {
  surface: '#FFFFFF',
  inkDark: '#212121',         // value — the eye-catcher
  text: '#333333',
  textMuted: '#9A9A9A',
  textLabel: '#7B7B7B',       // title — quiet section label
  shadow: 'rgba(89, 110, 124, 0.15)',
  imagePlaceholder: '#F2F2F2',
};

export interface InfoCardProps {
  title: string;
  /** Value shown under the title. Empty / null = renders the "Tap to set" hint instead. */
  value?: string | null;
  /** Hint shown when value is empty. Default "Tap to set". */
  emptyHint?: string;
  onPress?: () => void;
  /** Image source for variants that use a photo (standard, photo-top). */
  image?: ImageSourcePropType;
  /** Custom content rendered inside the image slot (board / photo-bottom variants). */
  imageContent?: React.ReactNode;
  /**
   * 'standard' — image LEFT (104×128), text right. Card 128pt tall, full width.
   * 'board' — legacy image-right variant (kept for back-compat).
   * 'photo-top' — image on TOP, text below. Card ~302pt tall, narrow column.
   * 'photo-bottom' — title on TOP, custom image content below. ~302pt tall, narrow.
   */
  variant?: 'standard' | 'board' | 'photo-top' | 'photo-bottom';
  /** Disabled cards still render but don't trigger onPress and show muted treatment. */
  disabled?: boolean;
  /** Scale factor applied to the image. >1 zooms in (cropping via overflow:hidden). Default 1. */
  imageZoom?: number;
}

// Photo-top inner content. Extracted from InfoCard's render so we can use
// hooks (Animated.Value for the smooth image-height transition).
//
// The image's vertical share of the card animates between two states
// based on how many lines the displayed value occupies:
//   • 1 line of text (e.g. "Advanced", "Any") → image = 72% of card
//   • 2+ lines (e.g. "Beginner\nIntermediate") → image = 50% of card
// Transition takes 2s in each direction with an ease-in-out curve, so the
// image visibly slides up / down rather than snapping.
//
// Layout: image wrap has an animated `height` in pixels; text block stays
// `flex: 1` and naturally fills the remaining space below.
const CARD_TOTAL_H = 340; // matches styles.shadowWrapVertical.height
const IMAGE_H_ONE_LINE = Math.round(CARD_TOTAL_H * 0.72); // 245
const IMAGE_H_MULTI_LINE = Math.round(CARD_TOTAL_H * 0.65); // 221
const IMAGE_TRANSITION_MS = 2000;

const PhotoTopInner: React.FC<{
  title: string;
  value?: string | null;
  showHint: boolean;
  emptyHint: string;
  image?: ImageSourcePropType;
  imageZoom: number;
}> = ({ title, value, showHint, emptyHint, image, imageZoom }) => {
  const displayedText = showHint ? emptyHint : (value ?? '');
  const lineCount = displayedText.split('\n').length;
  const targetHeight = lineCount <= 1 ? IMAGE_H_ONE_LINE : IMAGE_H_MULTI_LINE;

  const imageHeight = useRef(new Animated.Value(targetHeight)).current;

  useEffect(() => {
    Animated.timing(imageHeight, {
      toValue: targetHeight,
      duration: IMAGE_TRANSITION_MS,
      easing: Easing.inOut(Easing.cubic),
      // Animating a layout prop (height) — must run on the JS thread.
      useNativeDriver: false,
    }).start();
  }, [targetHeight, imageHeight]);

  return (
    <View style={[styles.cardInner, styles.cardInnerPhotoTop]}>
      <Animated.View
        style={[styles.photoTopImageWrap, { height: imageHeight }]}
      >
        {image ? (
          <Image
            source={image}
            style={[
              styles.photoTopImage,
              imageZoom !== 1 && { transform: [{ scale: imageZoom }] },
            ]}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.photoTopImage, styles.imagePlaceholder]} />
        )}
      </Animated.View>
      <View style={styles.photoVerticalTextBlock}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        <Text
          style={[styles.value, showHint && styles.valueHint]}
          numberOfLines={4}
        >
          {showHint ? emptyHint : value}
        </Text>
      </View>
    </View>
  );
};

export const InfoCard: React.FC<InfoCardProps> = ({
  title,
  value,
  emptyHint = 'Tap to set',
  onPress,
  image,
  imageContent,
  variant = 'standard',
  disabled = false,
  imageZoom = 1,
}) => {
  const showHint = !value || value.trim().length === 0;
  const Wrap: React.ComponentType<any> = onPress && !disabled ? TouchableOpacity : View;

  const shadowWrapStyle =
    variant === 'board'
      ? styles.shadowWrapBoard
      : variant === 'photo-top' || variant === 'photo-bottom'
        ? styles.shadowWrapVertical
        : styles.shadowWrapStandard;

  // Render content based on variant — three distinct layouts.
  const renderInner = () => {
    if (variant === 'photo-top') {
      return <PhotoTopInner
        title={title}
        value={value}
        showHint={showHint}
        emptyHint={emptyHint}
        image={image}
        imageZoom={imageZoom}
      />;
    }

    if (variant === 'photo-bottom') {
      // Title (top) + image content (bottom). Used for the Board Style card.
      // Value text intentionally omitted — the boards composition is the
      // selection visual; no need to also list names underneath.
      return (
        <View style={[styles.cardInner, styles.cardInnerPhotoBottom]}>
          <View style={styles.photoBottomTextBlock}>
            <Text style={styles.title} numberOfLines={1}>{title}</Text>
          </View>
          <View style={styles.photoBottomImageWrap}>
            {imageContent ?? (
              <View style={[styles.photoBottomImageFallback, styles.imagePlaceholder]} />
            )}
          </View>
        </View>
      );
    }

    if (variant === 'board') {
      // Legacy variant — image right, text left.
      return (
        <View style={[styles.cardInner, styles.cardInnerBoard]}>
          <View style={styles.textBlock}>
            <Text style={styles.title} numberOfLines={1}>{title}</Text>
            <Text
              style={[styles.value, showHint && styles.valueHint]}
              numberOfLines={4}
            >
              {showHint ? emptyHint : value}
            </Text>
          </View>
          <View style={styles.imageRightWrap}>
            {imageContent ?? (
              <View style={[styles.imageRight, styles.imagePlaceholder]} />
            )}
          </View>
        </View>
      );
    }

    // Standard variant — image LEFT (104×128 flush, no padding), text right.
    return (
      <View style={[styles.cardInner, styles.cardInnerStandard]}>
        <View style={styles.imageLeftWrap}>
          {image ? (
            <Image
              source={image}
              style={[
                styles.imageLeft,
                imageZoom !== 1 && { transform: [{ scale: imageZoom }] },
              ]}
              resizeMode="cover"
            />
          ) : (
            <View style={[styles.imageLeft, styles.imagePlaceholder]} />
          )}
        </View>
        <View style={styles.textBlock}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          <Text
            style={[styles.value, showHint && styles.valueHint]}
            numberOfLines={4}
          >
            {showHint ? emptyHint : value}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <Wrap
      activeOpacity={0.85}
      onPress={disabled ? undefined : onPress}
      // Outer carries the shadow ONLY — no overflow:hidden here so the shadow
      // can render on all sides on iOS.
      style={[styles.shadowWrap, shadowWrapStyle]}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${title}${value ? `: ${value}` : ''}`}
    >
      {renderInner()}
    </Wrap>
  );
};

const styles = StyleSheet.create({
  // Outer shadow wrap — diffuse + low-opacity = "floating" feel. Bigger
  // vertical offset (12pt) suggests the card hovers over the surface; the
  // 24pt blur softens the edges so adjacent shadows blend gracefully.
  shadowWrap: {
    backgroundColor: C.surface,
    borderRadius: 16,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 12,
  },
  shadowWrapStandard: {
    height: 128,
  },
  shadowWrapBoard: {
    height: 229,
  },
  shadowWrapVertical: {
    height: 340,
    flex: 1,
  },
  // Inner card — owns the rounded clipping and the flex layout.
  // Padding intentionally lives on the text side only so the image can hug
  // the card's bottom edge (with just 8pt of vertical breathing inset).
  cardInner: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
    flexDirection: 'row',
    backgroundColor: C.surface,
  },
  cardInnerStandard: {
    paddingLeft: 0,
    paddingRight: 16,
    paddingVertical: 0,
    alignItems: 'stretch',
    gap: 24,
  },
  cardInnerPhotoTop: {
    flexDirection: 'column',
    paddingRight: 0,
    paddingLeft: 0,
    paddingVertical: 0,
    alignItems: 'stretch',
    gap: 16,
  },
  cardInnerPhotoBottom: {
    flexDirection: 'column',
    paddingHorizontal: 12,
    paddingTop: 22,
    paddingBottom: 8,
    alignItems: 'stretch',
    gap: 12,
  },
  cardInnerBoard: {
    paddingLeft: 19,
    paddingRight: 16,
    paddingTop: 8,
    paddingBottom: 0,
    alignItems: 'flex-end',
    gap: 16,
  },
  // Standard variant — image LEFT, flush to card edge, full card height.
  // 30% width: image reads as a clear thumbnail while the value text on
  // the right gets the majority of the card.
  imageLeftWrap: {
    width: '30%',
    alignSelf: 'stretch',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  imageLeft: {
    width: '100%',
    height: '100%',
  },
  // Photo-top variant — image fills the top portion of the card (full
  // width). Vertical share is set via `flex` at the call site so it can
  // adapt to the value's line count (50% for multi-line, 66% for 1-line).
  photoTopImageWrap: {
    width: '100%',
    overflow: 'hidden',
  },
  photoTopImage: {
    width: '100%',
    height: '100%',
  },
  // Anchored to the bottom of the card — title + value grow UPWARD as more
  // lines are added (e.g. one level → 2 levels → 3 levels selected).
  photoVerticalTextBlock: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 12,
    paddingBottom: 16,
    gap: 4,
  },
  // Photo-bottom variant — title top, image content below.
  photoBottomTextBlock: {
    paddingTop: 4,
    paddingHorizontal: 4,
    gap: 4,
  },
  photoBottomImageWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  photoBottomImageFallback: {
    width: '90%',
    height: '90%',
    borderRadius: 8,
  },
  // Board variant — boards take ~85% of card height per Eyal's spec.
  // 229 * 0.85 ≈ 195pt for the board composition slot.
  imageRightWrap: {
    width: 131,
    height: 195,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  imageRight: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
  },
  imagePlaceholder: {
    backgroundColor: C.imagePlaceholder,
  },
  textBlock: {
    flex: 1,
    height: '100%',
    justifyContent: 'center',
    gap: 6,
  },
  // Title — quiet section label sitting above the value. Uppercase + tracked
  // so it reads as "metadata", not content.
  title: {
    fontFamily: FONT_INTER,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: C.textLabel,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  // Value — the eye-catcher. Montserrat 20/26 Bold — present without dominating.
  value: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
    color: C.inkDark,
  },
  valueHint: {
    fontFamily: FONT_INTER,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '400',
    color: C.textMuted,
    fontStyle: 'italic',
    letterSpacing: 0,
    textTransform: 'none',
  },
  // Small value variant — used inside photo-bottom card (Board Style) where
  // the BIG content is the image and the text plays a secondary role.
  valueSmall: {
    fontFamily: FONT_INTER,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '600',
    color: C.text,
  },
});

export default InfoCard;
