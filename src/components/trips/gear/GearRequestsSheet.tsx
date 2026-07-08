// GearRequestsSheet — host reviews members' gear *suggestions* (Figma
// 13455-…: "{name} Suggestion / Suggested to add {item} to Group Gear").
//
// The host can edit the item name AND the quantity before approving, then taps
// "Add" to turn the suggestion into a Group Gear item, or "Decline suggestion".
// Used in two places: the trip Plan tab (host's pending list) and the bell
// "Review suggestion" action (a single suggestion). Motion is the shared sheet
// transition — backdrop FADES while the sheet SLIDES up; swipe-down to dismiss.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Modal,
  Pressable,
  KeyboardAvoidingView,
  Animated,
  ScrollView,
  TextInput,
  Dimensions,
  Platform,
  Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SHEET } from '../TripBottomSheet';
import { TripIcon } from '../tripIcons';
import { ff } from '../../../theme/fonts';
import { useSheetTransition } from '../../../hooks/useSheetTransition';
import Thumb from '../../Thumb';
import type { EnrichedGearRequest } from '../../../services/trips/groupTripsService';

const SCREEN_H = Dimensions.get('window').height;
const NAME_MAX = 21; // matches the member-side suggest sheet + the design's counter

interface Props {
  visible: boolean;
  requests: EnrichedGearRequest[];
  processingId: string | null;
  onClose: () => void;
  /** Approve = add to Group Gear. The host may have edited the name + quantity. */
  onApprove: (request: EnrichedGearRequest, neededQty: number, itemName: string) => void;
  onDecline: (request: EnrichedGearRequest) => void;
}

export const GearRequestsSheet: React.FC<Props> = ({
  visible,
  requests,
  processingId,
  onClose,
  onApprove,
  onDecline,
}) => {
  // Per-suggestion staged edits the host can tweak before approving: the item
  // name (defaults to what the member suggested) and the quantity (defaults to
  // needed_qty, not 1).
  const [names, setNames] = useState<Record<string, string>>({});
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const bumpQty = (id: string, delta: number, base: number) =>
    setQtys(prev => ({ ...prev, [id]: Math.max(1, (prev[id] ?? base) + delta) }));

  // Fade the backdrop, slide the sheet (matches the other bottom sheets).
  const { mounted, backdropOpacity, translateY, onSheetLayout, panHandlers } = useSheetTransition(visible, onClose);
  // Android: pad past the system nav/gesture bar (iOS keeps the static 24).
  const insets = useSafeAreaInsets();

  // Lift the WHOLE sheet (not its inner scroll) just enough that the focused
  // input clears the keyboard, leaving ~4px visible below it. Keeps the header
  // intact (no internal scroll). Recompute on BOTH keyboard-show and focus so it
  // works regardless of which fires first (and when switching inputs).
  const GAP_BELOW_INPUT = 4;
  const inputRefs = useRef<Record<string, TextInput | null>>({});
  const focusedId = useRef<string | null>(null);
  const kbTopRef = useRef(SCREEN_H); // keyboard top in window coords (SCREEN_H = hidden)
  const liftRef = useRef(0); // currently-applied lift in px (positive = up)
  const kbLift = useRef(new Animated.Value(0)).current;

  const animateLift = useCallback(
    (lift: number) => {
      liftRef.current = lift;
      Animated.timing(kbLift, { toValue: -lift, duration: 220, useNativeDriver: true }).start();
    },
    [kbLift]
  );

  const recomputeLift = useCallback(() => {
    const id = focusedId.current;
    const input = id ? inputRefs.current[id] : null;
    if (!input || kbTopRef.current >= SCREEN_H) return;
    // measureInWindow returns the position WITH the current lift applied — add it
    // back to recover the resting bottom, so re-measures while lifted stay correct.
    input.measureInWindow((_x, y, _w, h) => {
      const restingBottom = y + h + liftRef.current;
      animateLift(Math.max(0, restingBottom + GAP_BELOW_INPUT - kbTopRef.current));
    });
  }, [animateLift]);

  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = Keyboard.addListener(showEvt, e => {
      kbTopRef.current = e.endCoordinates?.screenY ?? SCREEN_H;
      recomputeLift();
    });
    const onHide = Keyboard.addListener(hideEvt, () => {
      kbTopRef.current = SCREEN_H;
      animateLift(0);
    });
    return () => {
      onShow.remove();
      onHide.remove();
    };
  }, [recomputeLift, animateLift]);

  // Reset staged edits whenever the sheet (re)opens so a fresh suggestion isn't
  // pre-seeded with a previous one's edited name.
  useEffect(() => {
    if (visible) {
      setQtys({});
      setNames({});
    }
  }, [visible]);

  // Single suggestion (the bell flow, or one pending) renders borderless to match
  // the Figma; multiple are separated into cards under a list title.
  const single = requests.length === 1;

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      {/* avoidKeyboard={false}: let the keyboard overlay the (frozen) sheet
          instead of pushing it up. */}
      <KeyboardAvoidingView behavior={undefined} enabled={false} style={s.kavRoot}>
        <Pressable style={s.container} onPress={onClose}>
          <Animated.View pointerEvents="none" style={[s.backdrop, { opacity: backdropOpacity }]} />
          <Animated.View
            style={{ transform: [{ translateY }, { translateY: kbLift }] }}
            onLayout={onSheetLayout}
          >
            <Pressable
              style={[s.sheet, Platform.OS === 'android' && { paddingBottom: Math.max(insets.bottom, 24) }]}
              onPress={e => e.stopPropagation()}
            >
              {/* Grabber */}
              <View style={s.grabberRow} {...panHandlers}>
                <View style={s.grabber} />
              </View>

              {/* List title only when there's more than one to review — a single
                  suggestion leads with its own header (Figma). */}
              {!single && (
                <View style={s.titleRow}>
                  <View style={s.titleCol}>
                    <Text style={s.title}>Gear suggestions</Text>
                    <Text style={s.subtitle}>Approve or decline what members suggested</Text>
                  </View>
                </View>
              )}

              {requests.length === 0 ? (
                <Text style={s.empty}>No pending suggestions.</Text>
              ) : (
                <ScrollView
                  style={[s.body, single && s.bodySingle]}
                  contentContainerStyle={s.bodyContent}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                >
                  {requests.map(r => {
                    const isProcessing = processingId === r.id;
                    const qty = qtys[r.id] ?? r.needed_qty ?? 1;
                    const name = names[r.id] ?? r.item_name ?? '';
                    const firstName = (r.requester.name || 'Someone').split(' ')[0];
                    const canAdd = !!name.trim() && !isProcessing;
                    return (
                      <View key={r.id} style={[s.card, !single && s.cardBordered]}>
                        {/* Suggester header */}
                        <View style={s.headerRow}>
                          {r.requester.profile_image_url ? (
                            <Thumb
                              uri={r.requester.profile_image_url}
                              size={144}
                              style={s.avatar}
                              contentFit="cover"
                              cachePolicy="memory-disk"
                            />
                          ) : (
                            <View style={[s.avatar, s.avatarPlaceholder]}>
                              <Ionicons name="person" size={18} color="#FFFFFF" />
                            </View>
                          )}
                          <View style={s.headerText}>
                            <Text style={s.suggester} numberOfLines={1}>
                              {firstName} Suggestion
                            </Text>
                            <Text style={s.suggestedTo} numberOfLines={2}>
                              Suggested to add <Text style={s.suggestedItem}>{r.item_name}</Text> to Group Gear
                            </Text>
                          </View>
                        </View>

                        {/* What should we add? — editable name */}
                        <View style={s.labelRow}>
                          <Text style={s.label}>What should we add?</Text>
                          <Text style={s.counter}>
                            {name.length} /{NAME_MAX}
                          </Text>
                        </View>
                        <View style={s.field}>
                          <TripIcon name="edit-03" size={24} color="#333333" />
                          <TextInput
                            ref={el => {
                              inputRefs.current[r.id] = el;
                            }}
                            style={s.input}
                            value={name}
                            onChangeText={t => setNames(prev => ({ ...prev, [r.id]: t }))}
                            onFocus={() => {
                              focusedId.current = r.id;
                              recomputeLift();
                            }}
                            placeholder="Item name"
                            placeholderTextColor={SHEET.textMuted}
                            maxLength={NAME_MAX}
                            editable={!isProcessing}
                            returnKeyType="done"
                          />
                        </View>

                        {/* Why is this needed? — the member's note (read-only) */}
                        {r.note ? (
                          <>
                            <Text style={s.sectionLabel}>Why is this needed?</Text>
                            <Text style={s.note}>{r.note}</Text>
                          </>
                        ) : null}

                        {/* How many needed? */}
                        <Text style={s.qtyLabel}>How many needed?</Text>
                        <View style={s.stepper}>
                          <TouchableOpacity
                            style={s.stepBtn}
                            onPress={() => bumpQty(r.id, -1, r.needed_qty ?? 1)}
                            disabled={qty <= 1 || isProcessing}
                            accessibilityLabel="Decrease quantity"
                          >
                            <Ionicons name="remove" size={22} color={qty <= 1 ? SHEET.textMuted : '#333333'} />
                          </TouchableOpacity>
                          <View style={s.stepValue}>
                            <Text style={s.stepValueText}>{qty}</Text>
                          </View>
                          <TouchableOpacity
                            style={s.stepBtn}
                            onPress={() => bumpQty(r.id, 1, r.needed_qty ?? 1)}
                            disabled={isProcessing}
                            accessibilityLabel="Increase quantity"
                          >
                            <Ionicons name="add" size={22} color="#333333" />
                          </TouchableOpacity>
                        </View>

                        {/* Add (approve) */}
                        <TouchableOpacity
                          style={[s.add, !canAdd && s.addDisabled]}
                          onPress={() => onApprove(r, qty, name.trim())}
                          disabled={!canAdd}
                          activeOpacity={0.85}
                        >
                          {isProcessing ? (
                            <ActivityIndicator color="#FFFFFF" />
                          ) : (
                            <Text style={s.addText}>Add</Text>
                          )}
                        </TouchableOpacity>

                        {/* Decline suggestion */}
                        <TouchableOpacity
                          style={s.decline}
                          onPress={() => onDecline(r)}
                          disabled={isProcessing}
                          hitSlop={8}
                        >
                          <Text style={s.declineText}>Decline suggestion</Text>
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </ScrollView>
              )}
            </Pressable>
          </Animated.View>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
};

export default GearRequestsSheet;

const s = StyleSheet.create({
  kavRoot: { flex: 1 },
  container: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(33,33,33,0.7)' },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 2,
    paddingBottom: 24,
    paddingHorizontal: 16,
  },
  grabberRow: { alignItems: 'center', paddingTop: 8, paddingBottom: 16 },
  grabber: { width: 80, height: 4, borderRadius: 20, backgroundColor: '#7B7B7B' },

  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#EEEEEE',
  },
  titleCol: { flex: 1, justifyContent: 'center', gap: 4, paddingBottom: 16 },
  title: { fontFamily: ff('Inter', '700'), fontSize: 18, lineHeight: 24, color: '#333333' },
  subtitle: { fontFamily: ff('Inter', '400'), fontSize: 14, lineHeight: 18, color: '#4A5565' },

  body: { maxHeight: SCREEN_H * 0.7, marginTop: 16 },
  bodySingle: { marginTop: 0 },
  bodyContent: { paddingBottom: 0 },
  empty: {
    color: SHEET.textMuted,
    fontFamily: SHEET.fontBody,
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 24,
  },

  card: { paddingBottom: 0 },
  cardBordered: {
    borderWidth: 1,
    borderColor: SHEET.border,
    borderRadius: 14,
    padding: 14,
    paddingBottom: 14,
    marginBottom: 12,
  },

  // Suggester header (avatar + "{name} Suggestion" / "Suggested to add … to Group Gear")
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: SHEET.border },
  avatarPlaceholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#9CB6C0' },
  headerText: { flex: 1, gap: 2 },
  suggester: { fontFamily: ff('Inter', '700'), fontSize: 16, lineHeight: 22, color: '#333333' },
  suggestedTo: { fontFamily: ff('Inter', '400'), fontSize: 14, lineHeight: 18, color: SHEET.textMuted },
  suggestedItem: { fontFamily: ff('Inter', '700'), color: '#333333' },

  // "What should we add?" label + counter + editable field
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 24,
  },
  label: { fontFamily: ff('Inter', '700'), fontSize: 14, lineHeight: 18, color: '#333333' },
  counter: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18, color: SHEET.textMuted },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 56,
    marginTop: 8,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: SHEET.hairline,
    borderRadius: 12,
    backgroundColor: SHEET.surface,
  },
  input: {
    flex: 1,
    fontFamily: ff('Inter', '400'),
    fontSize: 14,
    color: SHEET.inkBody,
    paddingVertical: 0,
  },

  // "Why is this needed?" note
  sectionLabel: {
    fontFamily: ff('Inter', '700'),
    fontSize: 14,
    lineHeight: 18,
    color: '#333333',
    marginTop: 24,
  },
  note: { fontFamily: ff('Inter', '400'), fontSize: 14, lineHeight: 20, color: SHEET.inkBody, marginTop: 6 },

  // "How many needed?" stepper (mirrors the member-side suggest sheet)
  qtyLabel: { fontFamily: ff('Inter', '700'), fontSize: 14, lineHeight: 18, color: '#333333', marginTop: 24 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  stepBtn: {
    width: 56,
    height: 56,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: SHEET.hairline,
    backgroundColor: SHEET.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: {
    flex: 1,
    height: 56,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: SHEET.hairline,
    backgroundColor: SHEET.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValueText: { fontFamily: ff('Inter', '600'), fontSize: 16, color: '#333333' },

  // Add (approve) + Decline suggestion
  add: {
    height: 56,
    borderRadius: 12,
    backgroundColor: SHEET.inkDark,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 32,
  },
  addDisabled: { opacity: 0.35 },
  addText: { fontFamily: ff('Montserrat', '600'), fontSize: 16, lineHeight: 24, color: '#FFFFFF' },
  decline: { alignItems: 'center', justifyContent: 'center', paddingTop: 14, paddingBottom: 0, marginTop: 4 },
  declineText: { fontFamily: ff('Inter', '600'), fontSize: 14, lineHeight: 20, color: '#333333' },
});
