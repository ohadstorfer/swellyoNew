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
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { TripBottomSheet, SHEET } from '../../components/trips/TripBottomSheet';
import { CommitmentBadgeIcon } from '../../components/trips/commitment/CommitmentMessageBubble';
import { COMMITMENT_OPTIONS } from '../../components/trips/commitment/commitmentOptions';
import { submitCommitment, type CommitmentItem } from '../../services/trips/groupTripsService';
import { queryClient } from '../../lib/queryClient';
import { tripsKeys } from '../../hooks/trips/useTripQueries';
import { ff } from '../../theme/fonts';

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
    try {
      await submitCommitment(tripId, currentUserId, items, trimmed || null);
      queryClient.invalidateQueries({ queryKey: tripsKeys.detail(tripId) });
      setNoteSheetOpen(false);
      onClose();
    } catch (e: any) {
      rollback();
      setSubmitting(false);
      Alert.alert('Could not submit', e?.message || 'Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      {/* Header — back + trip name (mirrors the EditTrip sub-screen header). */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onClose}
          style={styles.backBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={28} color="#222B30" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {tripTitle || 'Trip'}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* Section title — teal badge + "Trip commitment". */}
        <View style={styles.sectionTitleRow}>
          <CommitmentBadgeIcon size={24} />
          <Text style={styles.sectionTitle}>Trip commitment</Text>
        </View>
        <View style={styles.divider} />

        <Text style={styles.heading}>How committed are you?</Text>
        <Text style={styles.subheading}>Let the group know how ready you are</Text>

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
                <View style={styles.optionIconBox}>
                  <Ionicons name={opt.icon} size={20} color="#222B30" />
                </View>
                <View style={styles.optionText}>
                  <Text style={styles.optionLabel}>{opt.label}</Text>
                  <Text style={styles.optionSubtitle}>{opt.subtitle}</Text>
                </View>
                <View style={[styles.check, isOn && styles.checkOn]}>
                  {isOn ? <Ionicons name="checkmark" size={15} color="#FFFFFF" /> : null}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      {/* Footer — "Select" opens the note sheet (step 2). */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.primaryBtn, !canSelect && styles.primaryBtnDisabled]}
          onPress={() => setNoteSheetOpen(true)}
          disabled={!canSelect}
          activeOpacity={0.9}
          accessibilityRole="button"
          accessibilityLabel="Select"
        >
          <Text style={styles.primaryBtnText}>Select</Text>
        </TouchableOpacity>
      </View>

      {/* Step 2 — note bottom sheet. */}
      <TripBottomSheet
        visible={noteSheetOpen}
        onClose={() => {
          if (!submitting) setNoteSheetOpen(false);
        }}
        title="Trip commitment"
        footer={
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={handleSend}
            disabled={submitting}
            activeOpacity={0.9}
            accessibilityRole="button"
            accessibilityLabel="Send"
          >
            {submitting ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryBtnText}>Send</Text>
            )}
          </TouchableOpacity>
        }
      >
        <Text style={styles.heading}>How committed are you?</Text>
        <TextInput
          style={styles.input}
          value={note}
          onChangeText={setNote}
          placeholder="Waiting for approval at work, booking soon"
          placeholderTextColor={SHEET.textMuted}
          multiline
          editable={!submitting}
        />
      </TripBottomSheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FAFAFA' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 10,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: ff('Montserrat', '700'),
    fontWeight: '700',
    fontSize: 18,
    color: '#222B30',
  },
  headerSpacer: { width: 40 },
  body: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 24 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: {
    fontFamily: ff('Montserrat', '700'),
    fontWeight: '700',
    fontSize: 16,
    color: '#212121',
  },
  divider: { height: 1, backgroundColor: '#EEEEEE', marginTop: 16, marginBottom: 18 },
  heading: {
    fontFamily: ff('Montserrat', '700'),
    fontWeight: '700',
    fontSize: 18,
    lineHeight: 24,
    color: '#212121',
  },
  subheading: {
    fontFamily: ff('Inter', '400'),
    fontSize: 14,
    color: '#7B7B7B',
    marginTop: 6,
  },
  options: { marginTop: 18, gap: 12 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 14,
    // Box Shadow 01 — #596E7C26, offset(0,2), radius 16.
    shadowColor: '#596E7C',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  optionOn: { borderColor: '#05BCD3' },
  optionIconBox: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#F7F7F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionText: { flex: 1 },
  optionLabel: {
    fontFamily: ff('Inter', '600'),
    fontWeight: '600',
    fontSize: 15,
    color: '#212121',
  },
  optionSubtitle: {
    fontFamily: ff('Inter', '400'),
    fontSize: 13,
    color: '#7B7B7B',
    marginTop: 2,
  },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#D5D7DA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { borderColor: '#2BCCBD', backgroundColor: '#2BCCBD' },
  footer: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 8 },
  primaryBtn: {
    width: '100%',
    backgroundColor: '#212121',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnDisabled: { opacity: 0.4 },
  primaryBtnText: {
    color: '#FFFFFF',
    fontFamily: ff('Inter', '700'),
    fontWeight: '700',
    fontSize: 15,
  },
  input: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginTop: 14,
    fontFamily: ff('Inter', '400'),
    fontSize: 14,
    color: '#222B30',
    backgroundColor: '#FFFFFF',
    minHeight: 120,
    textAlignVertical: 'top',
  },
});
