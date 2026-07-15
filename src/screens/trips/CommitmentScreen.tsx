// CommitmentScreen — the member's "How committed are you?" flow.
//
//   Step 1 (this full-screen page, Figma 13456-46488): multi-select commitment
//          options + a "Select" CTA.
//   Step 2 (a bottom sheet, Figma 13459-49493): an optional note + "Send".
//
// On Send it submits a *pending* commitment (which posts the request into the
// host DM — see submitCommitment) and pops back to the trip. The trip's
// CommitPill is flipped to "Commitment request sent" optimistically via the
// react-query cache so it's already correct when the card dismisses.
import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Image,
  Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { TripBottomSheet, SHEET } from '../../components/trips/TripBottomSheet';
import { CommitmentBadgeIcon } from '../../components/trips/commitment/CommitmentMessageBubble';
import { COMMITMENT_OPTIONS } from '../../components/trips/commitment/commitmentOptions';
import { CommitmentCardIcon } from '../../components/trips/commitment/CommitmentCardIcon';
import { submitCommitment, type CommitmentItem } from '../../services/trips/groupTripsService';
import { queryClient } from '../../lib/queryClient';
import { tripsKeys } from '../../hooks/trips/useTripQueries';
import { ff } from '../../theme/fonts';
import { Images } from '../../assets/images';
import { friendlyErrorMessage } from '../../utils/friendlyError';
import { hapticSuccess, hapticError } from '../../utils/haptics';

type TripCoreData = import('../../hooks/trips/useTripDetail').TripCoreData;

interface Props {
  tripId: string;
  currentUserId: string | null;
  tripTitle?: string | null;
  /** Prefill when re-submitting after a decline. */
  initialItems?: string[];
  initialNote?: string | null;
  /** Pops back to the trip detail. */
  onClose: () => void;
}

export default function CommitmentScreen({
  tripId,
  currentUserId,
  tripTitle,
  initialItems,
  initialNote,
  onClose,
}: Props) {
  const [selected, setSelected] = useState<Set<CommitmentItem>>(() => {
    const seed = new Set<CommitmentItem>();
    (initialItems ?? []).forEach(it => {
      if (COMMITMENT_OPTIONS.some(o => o.key === it)) seed.add(it as CommitmentItem);
    });
    return seed;
  });
  const [noteSheetOpen, setNoteSheetOpen] = useState(false);
  const [note, setNote] = useState(initialNote ?? '');
  const [submitting, setSubmitting] = useState(false);
  const insets = useSafeAreaInsets();
  const noteInputRef = useRef<TextInput>(null);

  // Open the note sheet with the keyboard already up + cursor in the box. The
  // delay lets the sheet mount/lay out first so the keyboard rises with it.
  useEffect(() => {
    if (!noteSheetOpen) return;
    const t = setTimeout(() => noteInputRef.current?.focus(), 300);
    return () => clearTimeout(t);
  }, [noteSheetOpen]);

  const toggle = (k: CommitmentItem) => {
    if (submitting) return;
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const canSelect = selected.size > 0;

  // Optimistically flip the member's cached participant row to 'pending' so the
  // trip's CommitPill already reads "Commitment request sent" when we pop back.
  // Returns a rollback that restores the prior cache on failure.
  const markPending = (items: string[], noteVal: string | null) => {
    const prev = queryClient.getQueryData<TripCoreData>(tripsKeys.detail(tripId));
    queryClient.setQueryData<TripCoreData>(tripsKeys.detail(tripId), cur =>
      cur
        ? {
            ...cur,
            participants: cur.participants.map(p =>
              p.user_id === currentUserId
                ? { ...p, commitment_status: 'pending', commitment_items: items, commitment_note: noteVal }
                : p
            ),
          }
        : cur
    );
    return () => queryClient.setQueryData<TripCoreData>(tripsKeys.detail(tripId), prev);
  };

  const handleSend = async () => {
    if (!currentUserId || submitting) return;
    const items = Array.from(selected);
    const trimmed = note.trim();
    setSubmitting(true);
    const rollback = markPending(items, trimmed || null);

    // The cache is already patched to 'pending', so pop straight back — the trip
    // screen reads "Commitment request sent" immediately instead of waiting for
    // the REST round trip. The write finishes in the background; on failure we
    // roll the cache back and surface the error.
    hapticSuccess();
    setNoteSheetOpen(false);
    onClose();

    try {
      await submitCommitment(tripId, currentUserId, items, trimmed || null);
      queryClient.invalidateQueries({ queryKey: tripsKeys.detail(tripId) });
    } catch (e: any) {
      hapticError();
      rollback();
      setSubmitting(false);
      Alert.alert('Could not submit', friendlyErrorMessage(e, 'Please try again.'));
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      {/* Header — dark trip chrome (Figma 13456:47018): back + left-aligned
          trip name. Root paints the status-bar inset dark; the scroll body
          below paints itself light with rounded top corners. */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onClose}
          style={styles.backBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={28} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {tripTitle || 'Trip'}
        </Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* Section title — teal badge + "Trip commitment". */}
        <View style={styles.sectionTitleRow}>
          <CommitmentBadgeIcon size={24} />
          <Text style={styles.sectionTitle}>Trip commitment</Text>
        </View>
        <View style={styles.divider} />

        <Text style={styles.heading}>In what way did you commit to the trip?</Text>
        <Text style={styles.subheading}>Let the admin know how you committed yourself</Text>

        <View style={styles.options}>
          {COMMITMENT_OPTIONS.map(opt => {
            const isOn = selected.has(opt.key);
            return (
              <TouchableOpacity
                key={opt.key}
                style={[styles.option, isOn && styles.optionOn]}
                onPress={() => toggle(opt.key)}
                activeOpacity={0.85}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: isOn }}
                accessibilityLabel={opt.label}
              >
                <View style={styles.optionMain}>
                  <View style={styles.optionIconBox}>
                    <CommitmentCardIcon itemKey={opt.key} size={18} color="#222B30" />
                  </View>
                  <View style={styles.optionText}>
                    <Text style={styles.optionLabel}>{opt.label}</Text>
                    <Text style={styles.optionSubtitle}>{opt.subtitle}</Text>
                  </View>
                </View>
                <View style={[styles.check, isOn && styles.checkOn]}>
                  {isOn ? <MaterialCommunityIcons name="check-bold" size={14} color="#FFFFFF" /> : null}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      {/* Footer — "Select" opens the note sheet (step 2). Gradient fade lets the
          option list scroll out under the CTA (Figma 13459:49487). */}
      <View style={[styles.footerWrap, { paddingBottom: insets.bottom + 8 }]} pointerEvents="box-none">
        <LinearGradient
          colors={['rgba(250,250,250,0)', '#FAFAFA']}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <TouchableOpacity
          style={[styles.selectBtn, !canSelect && styles.primaryBtnDisabled]}
          onPress={() => setNoteSheetOpen(true)}
          disabled={!canSelect}
          activeOpacity={0.9}
          accessibilityRole="button"
          accessibilityLabel="Select"
        >
          <Text style={styles.selectBtnText}>Select</Text>
        </TouchableOpacity>
      </View>

      {/* Step 2 — note bottom sheet. */}
      <TripBottomSheet
        visible={noteSheetOpen}
        hideClose
        footerDivider={false}
        onClose={() => {
          if (!submitting) setNoteSheetOpen(false);
        }}
        title="Trip commitment"
        footer={
          <TouchableOpacity
            style={[styles.selectBtn, styles.sendBtn]}
            onPress={handleSend}
            disabled={submitting}
            activeOpacity={0.9}
            accessibilityRole="button"
            accessibilityLabel="Send"
          >
            {submitting ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.selectBtnText}>Send</Text>
            )}
          </TouchableOpacity>
        }
      >
        <Text style={[styles.heading, styles.noteHeading]}>Please explain.</Text>
        <Text style={styles.subheading}>Let the admin know how you committed yourself</Text>
        <View style={styles.inputWrap}>
          <Image source={Images.tripDeets.pencil} style={styles.inputPencil} resizeMode="contain" />
          <TextInput
            ref={noteInputRef}
            style={styles.input}
            value={note}
            onChangeText={setNote}
            placeholder="e.g. Flights are booked and I've paid the deposit on our stay"
            placeholderTextColor={SHEET.textMuted}
            multiline
            editable={!submitting}
          />
        </View>
      </TripBottomSheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#212121' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#212121',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 28,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: {
    flex: 1,
    textAlign: 'left',
    marginLeft: 4,
    fontFamily: ff('Montserrat', '700'),
    fontWeight: '700',
    fontSize: 18,
    color: '#FFFFFF',
  },
  // Flush with the dark header (no rounded corners) so it reads as a screen,
  // not a bottom sheet.
  scroll: {
    flex: 1,
    backgroundColor: '#FAFAFA',
  },
  // paddingTop adds the breathing room above "Trip commitment" (Figma);
  // paddingBottom clears the absolutely-positioned gradient footer.
  body: { paddingHorizontal: 18, paddingTop: 28, paddingBottom: 150 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: {
    fontFamily: ff('Montserrat', '700'),
    fontWeight: '700',
    fontSize: 16,
    color: '#212121',
  },
  divider: { height: 1, backgroundColor: '#EEEEEE', marginTop: 24, marginBottom: 16 },
  heading: {
    fontFamily: ff('Inter', '700'),
    fontWeight: '700',
    fontSize: 16,
    lineHeight: 24,
    color: '#333333',
  },
  // No gap below the heading — subtitle sits directly under it (Figma).
  subheading: {
    fontFamily: ff('Inter', '400'),
    fontSize: 12,
    lineHeight: 18,
    color: '#7B7B7B',
    marginTop: 0,
  },
  options: { marginTop: 16, gap: 16 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#FFFFFF',
    borderRadius: 20,
    paddingVertical: 16,
    paddingHorizontal: 12,
    // Box Shadow 01 — #596E7C26, offset(0,2), blur 8 (matches the create-trip
    // "Yes/No" gate cards this view mirrors).
    shadowColor: '#596E7C',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  optionOn: { borderColor: '#05BCD3' },
  optionMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 16 },
  optionIconBox: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: '#F7F7F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionText: { flex: 1, gap: 4 },
  optionLabel: {
    fontFamily: ff('Inter', '700'),
    fontWeight: '700',
    fontSize: 16,
    lineHeight: 22,
    color: '#222B30',
  },
  optionSubtitle: {
    fontFamily: ff('Inter', '400'),
    fontSize: 12,
    lineHeight: 18,
    color: '#7B7B7B',
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#F7F7F7',
    borderWidth: 1,
    borderColor: '#CFCFCF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { borderColor: '#05BCD3', backgroundColor: '#05BCD3' },
  footerWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 40,
    paddingTop: 48,
    paddingBottom: 8,
  },
  primaryBtnDisabled: { opacity: 0.4 },
  // Mirrors the create-trip "Select" footer button (sheetSelectBtn) — dark pill,
  // 62 tall, radius 16, Montserrat 16/600.
  selectBtn: {
    width: '100%',
    backgroundColor: '#212121',
    height: 62,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectBtnText: {
    fontFamily: ff('Montserrat', '600'),
    fontWeight: '600',
    fontSize: 16,
    lineHeight: 24,
    color: '#FFFFFF',
  },
  // Send sits in the sheet footer (18px pad) vs Select's footer (40px pad) — drop
  // the 100% width and add 22px margins so it stretches to the same width as
  // Select (100% + margins would overflow and shove the button right).
  sendBtn: { width: 'auto', marginHorizontal: 22 },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginTop: 24,
    backgroundColor: '#FFFFFF',
    minHeight: 120,
  },
  // Note sheet: extra breathing room below the "Trip commitment" sheet title.
  noteHeading: { marginTop: 12 },
  inputPencil: { width: 22, height: 22, marginRight: 8, marginTop: 1 },
  input: {
    flex: 1,
    padding: 0,
    fontFamily: ff('Inter', '400'),
    fontSize: 14,
    color: '#222B30',
    textAlignVertical: 'top',
  },
});
