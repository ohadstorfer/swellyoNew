/**
 * RejectDocumentSheet — the operator sends a document back and says why.
 *
 * Free text, no preset reasons (Ohad, 30 Jul).
 *
 * The note is REQUIRED, and that is a deliberate bit of friction. A rejection
 * with no reason puts the traveler in a loop — they resend the same photo, it
 * comes back again, and the operator ends up explaining it in chat anyway. The
 * cheapest place to say "the bottom line is cut off" is here, once.
 *
 * The note is the only thing the traveler is shown about the decision, and it
 * rides along in the push, so it is written to be read by them, not filed.
 */
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheetShell } from '../BottomSheetShell';
import { ff } from '../../theme/fonts';

const MIN_NOTE = 3;
const MAX_NOTE = 300;

export const RejectDocumentSheet: React.FC<{
  visible: boolean;
  onClose: () => void;
  /** The document being sent back, e.g. "Passport". */
  title: string;
  busy?: boolean;
  onSend: (note: string) => void;
  /**
   * Render as a layer instead of a Modal — REQUIRED here, and the only reason
   * this prop exists: this sheet is opened from DocumentReviewScreen, which is
   * itself a presented Modal. See the note on BottomSheetShell's `inline`.
   */
  inline?: boolean;
}> = ({ visible, onClose, title, busy = false, onSend, inline = false }) => {
  const insets = useSafeAreaInsets();
  const [note, setNote] = useState('');

  // A note belongs to one decision. Carrying it into the next traveler's
  // rejection would be a real mistake, so it resets on every open.
  useEffect(() => {
    if (visible) setNote('');
  }, [visible]);

  const canSend = note.trim().length >= MIN_NOTE && !busy;

  return (
    <BottomSheetShell visible={visible} onClose={onClose} avoidKeyboard inline={inline}>
      {({ panHandlers }) => (
        <View style={[styles.surface, { paddingBottom: Math.max(insets.bottom, 16) + 12 }]}>
          <View {...panHandlers} style={styles.grabWrap}>
            <View style={styles.grabber} />
            <Text style={styles.title}>Ask for a new one</Text>
            <Text style={styles.sub} numberOfLines={1}>
              {title}
            </Text>
          </View>

          <View style={styles.body}>
            <Text style={styles.label}>What should they fix?</Text>
            <TextInput
              value={note}
              onChangeText={t => setNote(t.slice(0, MAX_NOTE))}
              placeholder="The bottom line is cut off — send the whole page."
              placeholderTextColor="#9A9A9A"
              multiline
              autoFocus
              style={styles.input}
            />
            <Text style={styles.hint}>
              They will see this, so write it for them. The file they sent is deleted.
            </Text>

            <Pressable
              onPress={() => onSend(note)}
              disabled={!canSend}
              style={({ pressed }) => [
                styles.sendBtn,
                !canSend && styles.btnDisabled,
                pressed && canSend && styles.btnPressed,
              ]}
            >
              {busy ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.sendText}>Send it back</Text>
              )}
            </Pressable>
          </View>
        </View>
      )}
    </BottomSheetShell>
  );
};

const styles = StyleSheet.create({
  surface: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  grabWrap: { alignItems: 'center', paddingTop: 10, paddingBottom: 12, gap: 4 },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E4E4E4',
    marginBottom: 6,
  },
  title: {
    fontFamily: ff('Inter', '700'),
    fontSize: 18,
    fontWeight: '700',
    color: '#212121',
  },
  sub: { fontFamily: ff('Inter', '400'), fontSize: 12, color: '#7B7B7B' },
  body: {
    paddingHorizontal: 20,
    paddingTop: 14,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#EEEEEE',
  },
  label: {
    fontFamily: ff('Inter', '600'),
    fontSize: 13,
    fontWeight: '600',
    color: '#212121',
  },
  input: {
    minHeight: 88,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E4E4E4',
    padding: 12,
    fontFamily: ff('Inter', '400'),
    fontSize: 14,
    lineHeight: 20,
    color: '#212121',
    textAlignVertical: 'top',
  },
  hint: { fontFamily: ff('Inter', '400'), fontSize: 11, lineHeight: 16, color: '#9A9A9A' },
  sendBtn: {
    height: 48,
    borderRadius: 24,
    backgroundColor: '#C4361E',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  sendText: {
    fontFamily: ff('Inter', '600'),
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  btnDisabled: { opacity: 0.45 },
  // 100ms, no easing to specify — a press-down should register as instantly as
  // the finger lands.
  btnPressed: { opacity: 0.85 },
});
