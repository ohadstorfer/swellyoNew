// TripItinerarySection — "Trip itinerary" on the trip Overview. Figma 18437:22350
// (closed) and 18437:22173 (open), sizes from get_variable_defs. The opened card
// is the "Trip itinerary — operator flow" canvas, board 6b: where Figma lists the
// activities under the closed row, the photo now grows to the full card width and
// turns into a carousel while the header slides under it.
//
// One progress value (0 closed, 1 open) drives the whole card on the UI thread,
// and stays interruptible. The opacity ranges below are written against the
// EASED value, so they are not fractions of the time: on OPEN_EASING, 0.5 is
// reached at about 100ms of 360ms and 0.9 at about 210ms.
//
// The header is two layers that crossfade, not one that travels. A single block
// moving from beside the thumbnail to under the photo crosses the photo as it
// grows, dark text on an image for a few frames. So the closed text leaves almost
// at once, and the open text rides the photo's bottom edge down on a transform,
// which also avoids re-laying out the text every frame.
//
// The cover renders at its open size for the whole morph, and only its scale
// changes while the box around it clips. Refitting an image to a resizing box
// steps; a scale does not.
//
// Data: a 1280 weighs about ten times a 320 (216–456KB against 22–47KB on real
// photos), so a 1280 loads only for a photo somebody actually looks at. A closed
// card loads the 320. Opening a day loads the cover's 1280. The carousel keeps one
// slide ahead on the 320, and a slide gets its 1280 once it is reached. Nothing
// loads on press-in: a finger starting a scroll lands on these cards too.
//
// The 320 and the 1280 are different crops, so stacked naively the photo jumps
// about a third bigger. `ItineraryPhoto` gives them one geometry: the 320 is the
// centre square of the original, so it is drawn exactly where that square falls
// inside the 1280 (`coverSquareSide`), and the 1280 only sharpens the same picture.
// That needs the ratio stored at pick time.
//
// A day with no photo shows the trip cover, whose 1280 is already on screen as the
// hero. It goes straight to that: no second download, and no ratio needed.
//
// The carousel only exists at full size, and fades in on top of the cover at the
// very end. Slide 0 is the same image at the same size, so the swap does not show.
// Closing fades it back out, which also hides a jump from slide 3.
//
// A day near the bottom of the screen would open out of view, so the card asks the
// screen to scroll. It waits for the tail of the morph, once the content has grown
// enough to scroll into, and the scroll reads as the end of the same motion.
//
// Heights are measured, not assumed: place names wrap, and Dynamic Type grows the
// header.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  type LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Reanimated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Thumb } from '../../Thumb';
import { textStyle, textStyles } from '../../../theme/typography';
import {
  coverSquareSide,
  dayHighlights,
  dayLabel,
  tripRangeLabel,
  type ItineraryDay,
} from '../../../services/trips/itinerary';

const C = {
  accent: '#05BCD3',
  ink: '#333333',
  muted: '#7B7B7B',
  faint: '#A0A0A0',
  white: '#FFFFFF',
  loading: '#EEEEEE',
  dotOff: 'rgba(255,255,255,0.5)',
};

/** Days listed before "View all" (Figma 18437:22350). */
const PREVIEW_DAYS = 5;

// A soft start so the eye can follow something growing 150px, and a quicker exit
// that answers the tap at once. The first version used the close curve both ways:
// it is 77% done after a quarter of its time, so the morph read as a jump followed
// by a long, invisible settle.
const OPEN_MS = 360;
const OPEN_EASING = Easing.bezier(0.3, 0, 0.1, 1);
const CLOSE_MS = 260;
const CLOSE_EASING = Easing.bezier(0.32, 0.72, 0, 1);

// Closed card (Figma): 76 tall, 8 inset, a 68×60 photo, then a 16 gap.
const CLOSED_H = 76;
const THUMB_W = 68;
const THUMB_H = 60;
const THUMB_INSET = 8;
const CLOSED_TEXT_LEFT = THUMB_INSET + THUMB_W + 16;
const CHEVRON = 24;
const CHEVRON_RIGHT = 6;

// Open card.
const PHOTO_H = 210;
const OPEN_INSET = 12;
const OPEN_TEXT_TOP = PHOTO_H + OPEN_INSET;
const LINES_GAP = 12;
const OPEN_BOTTOM = 14;
const HEADER_H_ESTIMATE = 56;
// How far the open layers sit above their final place when closed: the distance
// the photo's bottom edge travels.
const RIDE = PHOTO_H - (THUMB_INSET + THUMB_H);

/** Closed card: the largest square variant. There is no small width variant. */
const THUMB_SIZE_PX = 320;
/** Open card: the width ladder's 1280, generated for `hero-` uploads. */
const PHOTO_WIDTH_PX = 1280;
const THUMB_FADE_MS = 150;
const HI_RES_FADE_MS = 180;

// When an opened day should scroll into view. The clearances keep it off the
// floating top bar and the bottom bar or wizard footer.
const REVEAL_DELAY_MS = 200;
const REVEAL_TOP_CLEARANCE = 100;
const REVEAL_BOTTOM_CLEARANCE = 130;
const REVEAL_MIN_PX = 8;

export interface TripItinerarySectionProps {
  /** Already filtered to what guests may see — see `guestDays`. */
  days: ItineraryDay[];
  startISO: string | null;
  endISO: string | null;
  /** Used for a day with no photo, so the card never has a hole. */
  fallbackPhoto: string | null;
  /** Scrolls the screen down by this many points. Without it, nothing scrolls. */
  onRevealBy?: (dy: number) => void;
}

export const TripItinerarySection: React.FC<TripItinerarySectionProps> = ({
  days,
  startISO,
  endISO,
  fallbackPhoto,
  onRevealBy,
}) => {
  const [openDay, setOpenDay] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [width, setWidth] = useState(0);

  const shown = showAll ? days : days.slice(0, PREVIEW_DAYS);
  const range = tripRangeLabel(startISO, endISO);

  return (
    <View>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>Trip itinerary</Text>
          {range ? <Text style={styles.range}>{range}</Text> : null}
        </View>
        {days.length > PREVIEW_DAYS ? (
          <TouchableOpacity
            onPress={() => setShowAll(v => !v)}
            activeOpacity={0.7}
            accessibilityRole="button"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Text style={styles.viewAll}>{showAll ? 'Show less' : 'View all'}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <View
        style={styles.list}
        onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      >
        {width > 0
          ? shown.map(day => (
              <ItineraryDayCard
                key={day.day}
                day={day}
                label={dayLabel(startISO, day.day)}
                photos={
                  day.photos.length > 0 ? day.photos : fallbackPhoto ? [fallbackPhoto] : []
                }
                ratios={day.photoRatios}
                onHero={day.photos.length === 0}
                width={width}
                open={openDay === day.day}
                onToggle={() => setOpenDay(v => (v === day.day ? null : day.day))}
                onRevealBy={onRevealBy}
              />
            ))
          : null}
      </View>
    </View>
  );
};

/**
 * One photo in a width × PHOTO_H frame: the square 320 lined up with where it
 * falls inside the full image, then the 1280 fading over it once `loadFull` is on.
 */
const ItineraryPhoto: React.FC<{
  uri: string;
  width: number;
  ratio: number | null;
  loadFull: boolean;
  fullOnly?: boolean;
}> = ({ uri, width, ratio, loadFull, fullOnly = false }) => {
  const side = coverSquareSide(width, PHOTO_H, ratio);
  const full = loadFull ? (
    <Thumb
      uri={uri}
      widthPx={PHOTO_WIDTH_PX}
      contentFit="cover"
      cachePolicy="memory-disk"
      transition={fullOnly ? 0 : HI_RES_FADE_MS}
      style={StyleSheet.absoluteFill}
    />
  ) : null;
  if (fullOnly) return full;
  return (
    <>
      {/* The square is narrower than the frame on a landscape photo. Until the
          1280 lands, this fills the sides, from the same file. */}
      {loadFull && side < width ? (
        <Thumb
          uri={uri}
          size={THUMB_SIZE_PX}
          contentFit="cover"
          cachePolicy="memory-disk"
          blurRadius={16}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      <Thumb
        uri={uri}
        size={THUMB_SIZE_PX}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={THUMB_FADE_MS}
        style={{
          position: 'absolute',
          left: (width - side) / 2,
          top: (PHOTO_H - side) / 2,
          width: side,
          height: side,
        }}
      />
      {full}
    </>
  );
};

const ItineraryDayCard: React.FC<{
  day: ItineraryDay;
  label: string;
  photos: string[];
  ratios?: Record<string, number>;
  /** The photo is the trip cover, already loaded by the hero. */
  onHero: boolean;
  width: number;
  open: boolean;
  onToggle: () => void;
  onRevealBy?: (dy: number) => void;
}> = ({ day, label, photos, ratios, onHero, width, open, onToggle, onRevealBy }) => {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(open ? 1 : 0);
  const headerH = useSharedValue(HEADER_H_ESTIMATE);
  const linesH = useSharedValue(0);

  const [slide, setSlide] = useState(0);
  // Set on first open and kept: a day nobody opens never loads a 1280.
  const [opened, setOpened] = useState(open);
  // The furthest slide reached, which is what has earned its 1280.
  const [furthestSlide, setFurthestSlide] = useState(0);
  const carouselRef = useRef<ScrollView>(null);
  // Measured for the reveal. It must stay free of transforms, which measureInWindow
  // would report: the animated views are all inside it.
  const cardRef = useRef<View>(null);

  const resetCarousel = useCallback(() => {
    carouselRef.current?.scrollTo({ x: 0, animated: false });
    setSlide(0);
  }, []);

  useEffect(() => {
    if (open) setOpened(true);
    progress.value = withTiming(
      open ? 1 : 0,
      {
        duration: reduceMotion ? 0 : open ? OPEN_MS : CLOSE_MS,
        easing: open ? OPEN_EASING : CLOSE_EASING,
      },
      finished => {
        if (finished && !open) runOnJS(resetCarousel)();
      },
    );
  }, [open, progress, reduceMotion, resetCarousel]);

  useEffect(() => {
    if (!open || !onRevealBy) return;
    const timer = setTimeout(() => {
      cardRef.current?.measureInWindow((_x, y) => {
        const openH = OPEN_TEXT_TOP + headerH.value + LINES_GAP + linesH.value + OPEN_BOTTOM;
        const visibleBottom = Dimensions.get('window').height - REVEAL_BOTTOM_CLEARANCE;
        const overflow = y + openH - visibleBottom;
        // A card taller than the screen keeps its top in view, not its bottom.
        const dy = Math.min(overflow, y - REVEAL_TOP_CLEARANCE);
        if (dy > REVEAL_MIN_PX) onRevealBy(dy);
      });
    }, reduceMotion ? 0 : REVEAL_DELAY_MS);
    return () => clearTimeout(timer);
  }, [open, onRevealBy, reduceMotion, headerH, linesH]);

  const cardStyle = useAnimatedStyle(() => ({
    height: interpolate(
      progress.value,
      [0, 1],
      [CLOSED_H, OPEN_TEXT_TOP + headerH.value + LINES_GAP + linesH.value + OPEN_BOTTOM],
    ),
  }));

  const photoStyle = useAnimatedStyle(() => {
    const inset = interpolate(progress.value, [0, 1], [THUMB_INSET, 0]);
    return {
      left: inset,
      top: inset,
      width: interpolate(progress.value, [0, 1], [THUMB_W, width]),
      height: interpolate(progress.value, [0, 1], [THUMB_H, PHOTO_H]),
      borderTopLeftRadius: interpolate(progress.value, [0, 1], [8, 16]),
      borderTopRightRadius: interpolate(progress.value, [0, 1], [8, 16]),
      borderBottomLeftRadius: interpolate(progress.value, [0, 1], [8, 0]),
      borderBottomRightRadius: interpolate(progress.value, [0, 1], [8, 0]),
    };
  }, [width]);

  const coverRatio = ratios?.[photos[0]] ?? null;
  const squareSide = coverSquareSide(width, PHOTO_H, coverRatio);
  // The closed scale fills the thumbnail with what is loaded there: the square, or
  // the full frame for the trip cover. Scale and box are both linear in progress,
  // so filling it at the two ends means it is filled all the way through.
  const closedScale = onHero
    ? Math.max(THUMB_W / width, THUMB_H / PHOTO_H)
    : Math.max(THUMB_W, THUMB_H) / Math.min(squareSide, width);

  const coverStyle = useAnimatedStyle(() => {
    const boxW = interpolate(progress.value, [0, 1], [THUMB_W, width]);
    const boxH = interpolate(progress.value, [0, 1], [THUMB_H, PHOTO_H]);
    return {
      transform: [
        { translateX: (boxW - width) / 2 },
        { translateY: (boxH - PHOTO_H) / 2 },
        { scale: interpolate(progress.value, [0, 1], [closedScale, 1]) },
      ],
    };
  }, [width, closedScale]);

  const closedHeaderStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.2], [1, 0], 'clamp'),
  }));

  const openHeaderStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.35, 0.85], [0, 1], 'clamp'),
    transform: [{ translateY: interpolate(progress.value, [0, 1], [-RIDE, 0]) }],
  }));

  // Shared by both chevrons, so the turn reads as one continuous rotation across
  // the crossfade.
  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${progress.value * 90}deg` }],
  }));

  const linesStyle = useAnimatedStyle(() => ({
    top: OPEN_TEXT_TOP + headerH.value + LINES_GAP,
    opacity: interpolate(progress.value, [0.6, 1], [0, 1], 'clamp'),
    transform: [{ translateY: interpolate(progress.value, [0, 1], [-RIDE, 0]) }],
  }));

  // Late on purpose: a slide sits at full size, so showing it while the cover is
  // still growing would pop.
  const carouselStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.99, 1], [0, 1], 'clamp'),
  }));

  const many = photos.length > 1;
  const highlights = dayHighlights(day);
  const header = (
    <View style={styles.text}>
      <Text style={styles.day} numberOfLines={1}>
        {label}
      </Text>
      <View>
        <Text style={styles.dayTitle} numberOfLines={1}>
          {day.title}
        </Text>
        {highlights ? (
          <Text style={styles.highlights} numberOfLines={1}>
            {highlights}
          </Text>
        ) : null}
      </View>
    </View>
  );
  const chevron = (
    <Reanimated.View style={chevronStyle}>
      <Ionicons name="chevron-forward" size={CHEVRON} color={C.ink} />
    </Reanimated.View>
  );

  return (
    <View ref={cardRef} collapsable={false} style={styles.cardShadow}>
      <Reanimated.View style={[styles.cardClip, cardStyle]}>
        <Pressable
          onPress={onToggle}
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel={`${label}, ${day.title}`}
          accessibilityState={{ expanded: open }}
        />

        <Reanimated.View style={[styles.photo, photoStyle]} pointerEvents="box-none">
          {photos[0] ? (
            <Reanimated.View
              style={[styles.cover, { width }, coverStyle]}
              pointerEvents="none"
            >
              <ItineraryPhoto
                uri={photos[0]}
                width={width}
                ratio={coverRatio}
                loadFull={opened || onHero}
                fullOnly={onHero}
              />
            </Reanimated.View>
          ) : null}

          {many && opened ? (
            <Reanimated.View
              style={[styles.carousel, { width }, carouselStyle]}
              pointerEvents={open ? 'auto' : 'none'}
            >
              <ScrollView
                ref={carouselRef}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                scrollEventThrottle={32}
                onScroll={e => {
                  const next = Math.round(e.nativeEvent.contentOffset.x / width);
                  if (next !== slide) setSlide(next);
                  setFurthestSlide(v => Math.max(v, next));
                }}
              >
                {photos.map((uri, index) => (
                  <View
                    key={`${uri}-${index}`}
                    style={[styles.slide, { width }]}
                    accessibilityLabel={`Photo ${index + 1} of ${photos.length}`}
                  >
                    {index <= furthestSlide + 1 ? (
                      <ItineraryPhoto
                        uri={uri}
                        width={width}
                        ratio={ratios?.[uri] ?? null}
                        loadFull={index <= furthestSlide}
                      />
                    ) : null}
                  </View>
                ))}
              </ScrollView>
              <View style={styles.dots} pointerEvents="none">
                {photos.map((uri, index) => (
                  <View
                    key={`${uri}-${index}`}
                    style={[styles.dot, index === slide && styles.dotOn]}
                  />
                ))}
              </View>
            </Reanimated.View>
          ) : null}
        </Reanimated.View>

        <Reanimated.View
          style={[styles.closedHeader, closedHeaderStyle]}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {header}
          {chevron}
        </Reanimated.View>

        <Reanimated.View
          style={[styles.openHeader, openHeaderStyle]}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onLayout={e => {
            headerH.value = e.nativeEvent.layout.height;
          }}
        >
          {header}
          {chevron}
        </Reanimated.View>

        <Reanimated.View
          style={[styles.lines, linesStyle]}
          pointerEvents="none"
          onLayout={e => {
            linesH.value = e.nativeEvent.layout.height;
          }}
        >
          {day.activities.map((activity, index) => (
            <View key={index}>
              <Text style={styles.lineHead}>
                {activity.time ? `${activity.time} - ${activity.name}` : activity.name}
              </Text>
              {activity.place ? (
                <Text style={[styles.linePlace, activity.time ? styles.linePlaceIndent : null]}>
                  {activity.place}
                </Text>
              ) : null}
            </View>
          ))}
        </Reanimated.View>
      </Reanimated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 16 },
  headerText: { flex: 1, minWidth: 0 },
  title: { ...textStyle('MB1', '700'), color: C.ink },
  range: { ...textStyles.B3, color: C.muted },
  viewAll: { ...textStyles.MB2, color: C.accent },
  list: { gap: 8 },

  // The shadow and the clip cannot share a view: overflow hidden would cut the
  // shadow off on iOS.
  cardShadow: {
    borderRadius: 16,
    backgroundColor: C.white,
    shadowColor: '#596E7C',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardClip: { borderRadius: 16, overflow: 'hidden' },
  // The color shows while a photo loads, so a card never opens on a white hole.
  photo: { position: 'absolute', overflow: 'hidden', backgroundColor: C.loading },
  slide: { height: PHOTO_H, overflow: 'hidden', backgroundColor: C.loading },
  cover: { position: 'absolute', left: 0, top: 0, height: PHOTO_H },
  carousel: { position: 'absolute', left: 0, top: 0, height: PHOTO_H },
  dots: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 14,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.dotOff },
  dotOn: { backgroundColor: C.white },
  closedHeader: {
    position: 'absolute',
    left: CLOSED_TEXT_LEFT,
    right: CHEVRON_RIGHT,
    top: 0,
    height: CLOSED_H,
    flexDirection: 'row',
    alignItems: 'center',
  },
  openHeader: {
    position: 'absolute',
    left: OPEN_INSET,
    right: CHEVRON_RIGHT,
    top: OPEN_TEXT_TOP,
    flexDirection: 'row',
    alignItems: 'center',
  },
  text: { flex: 1, minWidth: 0, gap: 4 },
  day: { ...textStyles.B4, color: C.faint },
  dayTitle: { ...textStyle('MB2', '700'), color: C.ink },
  highlights: { ...textStyles.B4, color: C.muted },
  lines: { position: 'absolute', left: OPEN_INSET, right: OPEN_INSET },
  lineHead: { ...textStyle('B4', '700'), color: C.ink },
  linePlace: { ...textStyles.B4, color: C.muted },
  linePlaceIndent: { paddingLeft: 38 },
});

export default TripItinerarySection;
