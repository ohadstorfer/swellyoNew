import React, { useRef, useEffect } from 'react';
import { View, TextInput, Pressable, StyleSheet, Platform, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ff } from '../../theme/fonts';

interface Props {
  value: string;
  onChangeText: (t: string) => void;
  onCancel: () => void;
  onSave: () => void;
  /** Brand/per-chat color for the confirm (✓) circle. */
  primaryColor?: string;
  maxLength?: number;
  /**
   * Reuse the composer's nativeID so the screen's KeyboardGestureArea keeps
   * tracking this input when it replaces the normal composer — otherwise the
   * gesture area loses its tracked input and iOS drops the keyboard.
   */
  nativeID?: string;
}

/**
 * WhatsApp-style inline message editor that sits in the COMPOSER slot (not in the
 * bubble): [⊗ cancel] · [rounded pill input] · [✓ confirm]. The message being
 * edited stays visible in the list above. Replaces the old in-bubble TextInput +
 * Cancel/Save buttons so editing matches the rest of the app's composer.
 */
export function MessageEditBar({
  value,
  onChangeText,
  onCancel,
  onSave,
  primaryColor = '#8A5A2B',
  maxLength = 500,
  nativeID,
}: Props) {
  const inputRef = useRef<TextInput>(null);

  // Entrance animation: fade + slight slide-up as the bar replaces the composer
  // (Emil: enter ease-out, transform+opacity on the native driver, <300ms).
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [enter]);
  const enterTranslateY = enter.interpolate({ inputRange: [0, 1], outputRange: [8, 0] });

  // The screen swaps the composer → this bar in the SAME commit it closes the
  // in-tree menu, while the composer still holds the keyboard. `autoFocus` moves
  // first responder straight from the composer's input to this one (input → input,
  // never to nothing) so the keyboard never dips. The next-frame focus is just a
  // fallback for a slow mount — kept immediate so it can't cause a visible reopen.
  useEffect(() => {
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, []);

  const canSave = value.trim().length > 0;

  return (
    <Animated.View style={[styles.row, { opacity: enter, transform: [{ translateY: enterTranslateY }] }]}>
      {/* Cancel — outline circle. Instant press feedback (scale + dim). */}
      <Pressable
        onPress={onCancel}
        hitSlop={8}
        style={({ pressed }) => [styles.circle, styles.cancel, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Cancel edit"
      >
        <Ionicons name="close" size={22} color="#3A3A3A" />
      </Pressable>

      <TextInput
        ref={inputRef}
        nativeID={nativeID}
        autoFocus
        value={value}
        onChangeText={onChangeText}
        style={styles.input}
        multiline
        maxLength={maxLength}
        returnKeyType="done"
        blurOnSubmit={false}
        placeholder="Edit message"
        placeholderTextColor="#9AA0A6"
      />

      {/* Save — filled brand circle. Disabled (dimmed) when empty. */}
      <Pressable
        onPress={canSave ? onSave : undefined}
        disabled={!canSave}
        hitSlop={8}
        style={({ pressed }) => [
          styles.circle,
          { backgroundColor: primaryColor },
          !canSave && styles.saveDisabled,
          pressed && canSave && styles.pressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Save edit"
      >
        <Ionicons name="checkmark" size={24} color="#FFFFFF" />
      </Pressable>
    </Animated.View>
  );
}

const CIRCLE = 40;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    width: '100%',
  },
  circle: {
    width: CIRCLE,
    height: CIRCLE,
    borderRadius: CIRCLE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancel: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#D9DCE1',
  },
  // Instant press feedback — Emil: pressables must feel responsive.
  pressed: {
    transform: [{ scale: 0.92 }],
    opacity: 0.85,
  },
  saveDisabled: {
    opacity: 0.45,
  },
  input: {
    flex: 1,
    minHeight: CIRCLE,
    maxHeight: 120,
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 10 : 8,
    paddingBottom: Platform.OS === 'ios' ? 10 : 8,
    fontSize: 16,
    color: '#1A1A1A',
    fontFamily: ff('Inter', '400'),
  },
});
