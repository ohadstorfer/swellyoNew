import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Text as RNText,
  Animated,
  StyleSheet,
  Platform,
  ActivityIndicator,
  PanResponder,
  Dimensions,
} from 'react-native';

const ITEM_HEIGHT = 50;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const getDaysInMonth = (month: number, year: number) => new Date(year, month + 1, 0).getDate();

const isoFromDate = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const parseISOOrDefault = (iso: string | null | undefined, fallback: Date): Date => {
  if (!iso) return fallback;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return fallback;
  return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
};

type Props = {
  visible: boolean;
  initialDOB?: string | null; // ISO YYYY-MM-DD
  onClose: () => void;
  onSave: (dobISO: string) => void;
  saving?: boolean;
  title?: string;
  subtitle?: string;
  saveLabel?: string;
};

/**
 * Bottom-sheet date-of-birth picker — same UX as the Welcome / age-gate
 * sheet (3 scrolling wheels: month / day / year). Used for both initial
 * sign-up age verification and editing DOB later from the profile.
 */
export const DateOfBirthSheet: React.FC<Props> = ({
  visible,
  initialDOB,
  onClose,
  onSave,
  saving = false,
  title = 'Date of birth',
  subtitle = 'Please enter your date of birth.',
  saveLabel = 'Save',
}) => {
  const currentYear = new Date().getFullYear();
  const defaultDate = parseISOOrDefault(initialDOB, new Date(currentYear - 18, 0, 1));

  const [pickerDate, setPickerDate] = useState<Date>(defaultDate);
  const overlayAnim = useRef(new Animated.Value(0)).current;
  const sheetAnim = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(visible);

  const monthScrollRef = useRef<ScrollView>(null);
  const dayScrollRef = useRef<ScrollView>(null);
  const yearScrollRef = useRef<ScrollView>(null);

  // Swipe-down to dismiss. Drag the handle/title area; sheet follows the
  // finger and snaps closed past a velocity/distance threshold.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gs) => gs.dy > 4,
      onPanResponderMove: (_, gs) => {
        if (gs.dy > 0) {
          const sheetH = Math.round(Dimensions.get('window').height * 0.65);
          sheetAnim.setValue(Math.max(0, 1 - gs.dy / sheetH));
        }
      },
      onPanResponderRelease: (_, gs) => {
        if (gs.dy > 100 || gs.vy > 0.5) {
          onCloseRef.current();
        } else {
          Animated.spring(sheetAnim, {
            toValue: 1,
            tension: 65,
            friction: 11,
            useNativeDriver: true,
          }).start();
        }
      },
    }),
  ).current;
  const isSnapping = useRef(false);
  const monthScrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dayScrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const yearScrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (visible) {
      const fresh = parseISOOrDefault(initialDOB, new Date(currentYear - 18, 0, 1));
      setPickerDate(fresh);
      setMounted(true);
      Animated.parallel([
        Animated.timing(overlayAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
        Animated.spring(sheetAnim, { toValue: 1, tension: 65, friction: 11, useNativeDriver: true }),
      ]).start();
      // Scroll wheels to fresh values once mounted
      setTimeout(() => {
        const monthIndex = fresh.getMonth();
        const dayIndex = fresh.getDate() - 1;
        const yearIndex = fresh.getFullYear() - (currentYear - 120);
        isSnapping.current = true;
        monthScrollRef.current?.scrollTo({ y: monthIndex * ITEM_HEIGHT, animated: false });
        dayScrollRef.current?.scrollTo({ y: dayIndex * ITEM_HEIGHT, animated: false });
        yearScrollRef.current?.scrollTo({ y: yearIndex * ITEM_HEIGHT, animated: false });
        setTimeout(() => { isSnapping.current = false; }, 100);
      }, 300);
    } else if (mounted) {
      Animated.parallel([
        Animated.timing(overlayAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
        Animated.timing(sheetAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start(() => setMounted(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const snapToItem = (ref: React.RefObject<ScrollView | null>, index: number) => {
    if (ref.current) {
      isSnapping.current = true;
      ref.current.scrollTo({ y: index * ITEM_HEIGHT, animated: true });
      setTimeout(() => { isSnapping.current = false; }, 350);
    }
  };

  const handleScrollEnd = (
    ref: React.RefObject<ScrollView | null>,
    timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
    type: 'month' | 'day' | 'year',
    offsetY: number,
  ) => {
    if (isSnapping.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const index = Math.round(offsetY / ITEM_HEIGHT);
      snapToItem(ref, index);
      setPickerDate(prev => {
        const next = new Date(prev);
        if (type === 'month') {
          next.setMonth(index);
          const maxDay = getDaysInMonth(index, next.getFullYear());
          if (next.getDate() > maxDay) next.setDate(maxDay);
        } else if (type === 'day') {
          next.setDate(index + 1);
        } else {
          next.setFullYear((currentYear - 120) + index);
          const maxDay = getDaysInMonth(next.getMonth(), (currentYear - 120) + index);
          if (next.getDate() > maxDay) next.setDate(maxDay);
        }
        return next;
      });
    }, 80);
  };

  if (!mounted) return null;

  return (
    <View style={styles.absoluteFill} pointerEvents="box-none">
      <TouchableWithoutFeedback onPress={onClose}>
        <Animated.View style={[styles.overlay, { opacity: overlayAnim }]} />
      </TouchableWithoutFeedback>
      <Animated.View
        style={[
          styles.sheet,
          {
            transform: [
              {
                translateY: sheetAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [600, 0],
                }),
              },
            ],
          },
        ]}
      >
        {/* Drag area — swipe down on the handle/title to dismiss */}
        <View {...pan.panHandlers}>
          <View style={styles.handle} />
          <RNText style={styles.title}>{title}</RNText>
          {subtitle ? <RNText style={styles.subtitle}>{subtitle}</RNText> : null}
        </View>
        <View style={styles.divider} />
        <RNText style={styles.pickerLabel}>What's your date of birth?</RNText>

        <View style={styles.pickerContainer}>
          {/* Month */}
          <View style={styles.pickerColumn}>
            <ScrollView
              ref={monthScrollRef}
              showsVerticalScrollIndicator={false}
              snapToInterval={ITEM_HEIGHT}
              decelerationRate="fast"
              onScroll={e => handleScrollEnd(monthScrollRef, monthScrollTimer, 'month', e.nativeEvent.contentOffset.y)}
              scrollEventThrottle={16}
              contentContainerStyle={{ paddingVertical: ITEM_HEIGHT * 2 }}
            >
              {MONTHS.map((m, i) => (
                <View key={m} style={styles.pickerItem}>
                  <RNText style={[styles.pickerItemText, i === pickerDate.getMonth() && styles.pickerItemSelected]}>
                    {m}
                  </RNText>
                </View>
              ))}
            </ScrollView>
          </View>

          {/* Day */}
          <View style={styles.pickerColumn}>
            <ScrollView
              ref={dayScrollRef}
              showsVerticalScrollIndicator={false}
              snapToInterval={ITEM_HEIGHT}
              decelerationRate="fast"
              onScroll={e => handleScrollEnd(dayScrollRef, dayScrollTimer, 'day', e.nativeEvent.contentOffset.y)}
              scrollEventThrottle={16}
              contentContainerStyle={{ paddingVertical: ITEM_HEIGHT * 2 }}
            >
              {Array.from({ length: getDaysInMonth(pickerDate.getMonth(), pickerDate.getFullYear()) }, (_, i) => (
                <View key={i} style={styles.pickerItem}>
                  <RNText style={[styles.pickerItemText, i === pickerDate.getDate() - 1 && styles.pickerItemSelected]}>
                    {i + 1}
                  </RNText>
                </View>
              ))}
            </ScrollView>
          </View>

          {/* Year */}
          <View style={styles.pickerColumn}>
            <ScrollView
              ref={yearScrollRef}
              showsVerticalScrollIndicator={false}
              snapToInterval={ITEM_HEIGHT}
              decelerationRate="fast"
              onScroll={e => handleScrollEnd(yearScrollRef, yearScrollTimer, 'year', e.nativeEvent.contentOffset.y)}
              scrollEventThrottle={16}
              contentContainerStyle={{ paddingVertical: ITEM_HEIGHT * 2 }}
            >
              {Array.from({ length: 121 }, (_, i) => {
                const y = (currentYear - 120) + i;
                return (
                  <View key={y} style={styles.pickerItem}>
                    <RNText style={[styles.pickerItemText, y === pickerDate.getFullYear() && styles.pickerItemSelected]}>
                      {y}
                    </RNText>
                  </View>
                );
              })}
            </ScrollView>
          </View>

          <View style={styles.pickerHighlight} pointerEvents="none" />
        </View>

        <TouchableOpacity
          style={styles.continueButton}
          activeOpacity={0.8}
          onPress={() => onSave(isoFromDate(pickerDate))}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <RNText style={styles.continueButtonText}>{saveLabel}</RNText>
          )}
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  absoluteFill: { ...StyleSheet.absoluteFillObject, zIndex: 1000 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    zIndex: 50,
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingBottom: 40,
    paddingTop: 12,
    zIndex: 60,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D9D9D9',
    alignSelf: 'center',
    marginBottom: 20,
  },
  title: {
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat',
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
    lineHeight: 24,
  },
  subtitle: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 14,
    fontWeight: '400',
    color: '#333',
    lineHeight: 18,
    marginTop: 4,
  },
  divider: { height: 1, backgroundColor: '#E3E3E3', marginVertical: 20 },
  pickerLabel: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 16,
  },
  pickerContainer: {
    flexDirection: 'row',
    height: ITEM_HEIGHT * 5,
    overflow: 'hidden',
    marginBottom: 24,
  },
  pickerColumn: { flex: 1 },
  pickerItem: { height: ITEM_HEIGHT, justifyContent: 'center', alignItems: 'center' },
  pickerItemText: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 16,
    fontWeight: '400',
    color: '#AAAAAA',
    lineHeight: 22,
  },
  pickerItemSelected: { color: '#333', fontWeight: '700', fontSize: 18 },
  pickerHighlight: {
    position: 'absolute',
    left: 16,
    right: 16,
    top: ITEM_HEIGHT * 2,
    height: ITEM_HEIGHT,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E3E3E3',
    backgroundColor: 'transparent',
  },
  continueButton: {
    backgroundColor: '#222B30',
    borderRadius: 16,
    height: 54,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 16,
  },
  continueButtonText: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    lineHeight: 20,
  },
});
