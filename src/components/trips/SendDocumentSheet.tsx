/**
 * Hand a document to a traveler — or to the whole trip.
 *
 * Spec: docs/staff-requirements-and-wallet-delivery-spec-and-plan.html, Part B.
 *
 * ── What this is for, and what it is not ───────────────────────────────────
 * FOR: documents the operator issues. Tickets, itineraries, hotel
 * confirmations, a packing list, the trip's own insurance certificate.
 *
 * NOT FOR: documents the traveler owes. Their passport, their signed waiver,
 * their medical form. There is no way to reach those from this sheet, and no
 * column in the table behind it that could express one — an operator-signed
 * waiver is not a waiver, and a passport somebody else uploaded proves nothing
 * about who chose to hand it over. The copy below says so out loud, because the
 * person most likely to try is the one being helpful.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheetShell } from '../BottomSheetShell';
import { ff } from '../../theme/fonts';
import { showErrorAlert } from '../../utils/friendlyError';
import { deliverDocument } from '../../services/trips/deliveredDocumentsService';

const ACCENT = '#05BCD3';
const INK = '#181D27';
const MUTED = '#717680';

interface PickedFile {
  uri: string;
  name: string;
  size: number;
  mime: string;
}

export const SendDocumentSheet: React.FC<{
  visible: boolean;
  tripId: string;
  /** The signed-in operator/staff member. */
  uploadedBy: string;
  /**
   * null = deliver to everyone on the trip. Set = one traveler, and their name
   * is shown so nobody sends a personal booking to the whole group by accident.
   */
  recipientId: string | null;
  recipientName?: string | null;
  onClose: () => void;
  onSent?: () => void;
  /** See BottomSheetShell — set when opened from a screen that is a Modal. */
  inline?: boolean;
}> = ({ visible, tripId, uploadedBy, recipientId, recipientName, onClose, onSent, inline }) => {
  const insets = useSafeAreaInsets();
  const [file, setFile] = useState<PickedFile | null>(null);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);

  // A fresh open starts empty. Carrying the last file over would let a second
  // send deliver the first one's attachment under a new name.
  useEffect(() => {
    if (visible) {
      setFile(null);
      setTitle('');
      setNote('');
      setSending(false);
    }
  }, [visible]);

  const pick = async () => {
    try {
      const DocumentPicker = require('expo-document-picker');
      const res = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      const asset = !res.canceled ? res.assets?.[0] : null;
      if (!asset?.uri) return;
      const mime = asset.mimeType ?? 'application/pdf';
      setFile({ uri: asset.uri, name: asset.name ?? 'document', size: asset.size ?? 0, mime });
      // Seed the title from the filename — it is nearly always what they would
      // have typed, and an empty required field is friction for no gain.
      if (!title.trim()) setTitle((asset.name ?? '').replace(/\.[^.]+$/, ''));
    } catch (e) {
      showErrorAlert('Something went wrong', e, 'Could not open your files. Please try again.');
    }
  };

  const send = async () => {
    if (!file || !title.trim() || sending) return;
    setSending(true);
    try {
      await deliverDocument({
        tripId,
        recipientId,
        uploadedBy,
        title,
        note,
        localUri: file.uri,
        contentType: file.mime.startsWith('image/') ? 'image/jpeg' : 'application/pdf',
      });
      onSent?.();
      onClose();
    } catch (e) {
      showErrorAlert('Could not send', e, 'The document was not delivered. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const audience = recipientId
    ? `${recipientName ?? 'this traveler'} only`
    : 'everyone on this trip';

  return (
    <BottomSheetShell visible={visible} onClose={onClose} inline={inline} avoidKeyboard>
      <View style={[styles.surface, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
        <View style={styles.grabWrap}>
          <View style={styles.grabber} />
        </View>

        <Text style={styles.heading}>Send a document</Text>
        <Text style={styles.sub}>
          Goes to <Text style={styles.audience}>{audience}</Text>. It lands in their travel
          wallet, marked as coming from you.
        </Text>

        <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
          <Pressable
            onPress={pick}
            disabled={sending}
            style={({ pressed }) => [styles.picker, pressed && styles.pressed]}
          >
            <Ionicons
              name={file ? 'document-text-outline' : 'cloud-upload-outline'}
              size={20}
              color={file ? INK : MUTED}
            />
            <View style={styles.pickerText}>
              <Text style={styles.pickerTitle} numberOfLines={1}>
                {file ? file.name : 'Choose a PDF or photo'}
              </Text>
              {file ? (
                <Text style={styles.pickerSub}>{Math.max(1, Math.round(file.size / 1024))} KB</Text>
              ) : (
                <Text style={styles.pickerSub}>Tickets, itineraries, confirmations</Text>
              )}
            </View>
            {file ? <Text style={styles.replace}>Change</Text> : null}
          </Pressable>

          <Text style={styles.fieldLabel}>Name</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. Flight confirmation"
            placeholderTextColor="#B9BEC3"
            editable={!sending}
            returnKeyType="next"
          />

          <Text style={styles.fieldLabel}>Note (optional)</Text>
          <TextInput
            style={[styles.input, styles.inputMulti]}
            value={note}
            onChangeText={setNote}
            placeholder="Anything they should know about it"
            placeholderTextColor="#B9BEC3"
            editable={!sending}
            multiline
          />

          {/* The person most likely to misuse this is the one trying to help a
              traveler who is struggling with an upload. Say it here, once. */}
          <View style={styles.warn}>
            <Ionicons name="information-circle-outline" size={16} color={MUTED} />
            <Text style={styles.warnText}>
              For documents you are giving them. You cannot upload a traveler's passport, waiver
              or medical form on their behalf — those only count when the traveler provides them
              themselves.
            </Text>
          </View>
        </ScrollView>

        <Pressable
          onPress={send}
          disabled={!file || !title.trim() || sending}
          style={({ pressed }) => [
            styles.cta,
            (!file || !title.trim() || sending) && styles.ctaOff,
            pressed && file && !!title.trim() && !sending && styles.pressed,
          ]}
        >
          {sending ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.ctaText}>Send</Text>
          )}
        </Pressable>
      </View>
    </BottomSheetShell>
  );
};

const styles = StyleSheet.create({
  surface: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    maxHeight: '88%',
  },
  grabWrap: { alignItems: 'center', paddingTop: 10, paddingBottom: 4 },
  grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#E4E4E4' },
  heading: {
    fontFamily: ff('Montserrat', '700'),
    fontWeight: '700',
    fontSize: 18,
    color: INK,
    marginTop: 8,
  },
  sub: {
    fontFamily: ff('Inter', '400'),
    fontSize: 13,
    lineHeight: 18,
    color: MUTED,
    marginTop: 4,
    marginBottom: 14,
  },
  audience: { fontFamily: ff('Inter', '600'), fontWeight: '600', color: INK },

  body: { flexShrink: 1 },

  picker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#EAECF0',
    borderStyle: 'dashed',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  pickerText: { flex: 1 },
  pickerTitle: {
    fontFamily: ff('Inter', '500'),
    fontWeight: '500',
    fontSize: 14,
    color: INK,
  },
  pickerSub: {
    fontFamily: ff('Inter', '400'),
    fontSize: 12,
    color: MUTED,
    marginTop: 1,
  },
  replace: { fontFamily: ff('Inter', '600'), fontWeight: '600', fontSize: 13, color: ACCENT },

  fieldLabel: {
    fontFamily: ff('Inter', '600'),
    fontWeight: '600',
    fontSize: 12.5,
    color: INK,
    marginTop: 16,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#EAECF0',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: ff('Inter', '400'),
    fontSize: 14,
    color: INK,
  },
  inputMulti: { minHeight: 74, textAlignVertical: 'top' },

  warn: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#FAFAFA',
    borderRadius: 10,
    padding: 12,
    marginTop: 16,
    marginBottom: 8,
  },
  warnText: {
    flex: 1,
    fontFamily: ff('Inter', '400'),
    fontSize: 12,
    lineHeight: 17,
    color: MUTED,
  },

  cta: {
    height: 56,
    borderRadius: 12,
    backgroundColor: '#212121',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  ctaOff: { opacity: 0.5 },
  ctaText: {
    fontFamily: ff('Montserrat', '600'),
    fontWeight: '600',
    fontSize: 16,
    color: '#FFFFFF',
  },
  pressed: { transform: [{ scale: 0.98 }] },
});

export default SendDocumentSheet;
