/**
 * WaiverAgreeSheet — the traveler reads the operator's waiver and agrees by
 * typing their full name.
 *
 * This is a legal record, not a checkbox. `operator_requirement_acknowledge`
 * writes the row and captures the IP address and user-agent SERVER-SIDE from the
 * request headers, so the client cannot forge them, and stamps which waiver
 * VERSION was agreed to. That is what makes it hold up under ESIGN/UETA.
 *
 * Two shapes, because the table allows either:
 *   • a PDF (`storage_path`) — what the wizard publishes. Shown full screen via
 *     FilePreviewShell, with the agree block in its footer slot: a legal
 *     document deserves the whole screen, not a cramped sheet.
 *   • plain text (`body_text`) — no longer authored anywhere, but rows may
 *     exist. Rendered in a scrolling bottom sheet.
 *
 * If no waiver has been published, this refuses to show an Agree button. The
 * state RPC only counts an agreement pointing at the current waiver document,
 * so agreeing to nothing would leave the requirement stuck forever.
 *
 * Spec: docs/specs/operator-trips/waiver-legal-record.md
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheetShell } from '../BottomSheetShell';
import { FilePreviewShell } from '../filePreview/FilePreviewShell';
import { ff } from '../../theme/fonts';
import {
  fetchWaiver,
  getViewUrl,
  acknowledgeRequirement,
} from '../../services/trips/tripDocumentsService';
import { showErrorAlert } from '../../utils/friendlyError';

type Waiver = {
  version: number;
  bodyText: string | null;
  storagePath: string | null;
};

export const WaiverAgreeSheet: React.FC<{
  visible: boolean;
  onClose: () => void;
  tripId: string;
  requirementId: string;
  /** Already agreed — show it read-only. */
  agreed?: boolean;
  onAgreed: () => void;
}> = ({ visible, onClose, tripId, requirementId, agreed = false, onAgreed }) => {
  const insets = useSafeAreaInsets();
  const [waiver, setWaiver] = useState<Waiver | null>(null);
  const [localPdf, setLocalPdf] = useState<{ uri: string; size: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    setLocalPdf(null);
    (async () => {
      try {
        const w = await fetchWaiver(tripId);
        if (cancelled) return;
        setWaiver(w);

        // The PDF renderer takes a local path only, so the file has to come down
        // first. The signed URL is used once, here, and never stored.
        if (w?.storagePath) {
          const url = await getViewUrl(w.storagePath);
          const FileSystem = require('expo-file-system/legacy');
          const target = `${FileSystem.cacheDirectory}waiver-${tripId}-v${w.version}.pdf`;
          const res = await FileSystem.downloadAsync(url, target);
          if (!cancelled && res?.uri) {
            const info = await FileSystem.getInfoAsync(res.uri);
            setLocalPdf({
              uri: res.uri,
              size: info?.exists && 'size' in info ? info.size : 0,
            });
          }
        }
      } catch (e) {
        console.error('[WaiverAgreeSheet] could not load the waiver');
        if (!cancelled) setWaiver(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, tripId]);

  const handleAgree = useCallback(async () => {
    if (saving || name.trim().length < 2) return;
    setSaving(true);
    try {
      await acknowledgeRequirement(requirementId, name);
      setName('');
      setSaving(false);
      onAgreed();
    } catch (e) {
      console.error('[WaiverAgreeSheet] acknowledge failed:', e);
      setSaving(false);
      showErrorAlert('Could not save', e, 'Could not record your agreement. Please try again.');
    }
  }, [saving, name, requirementId, onAgreed]);

  const canAgree = !!waiver && name.trim().length >= 2 && !saving;

  // Shared between both shapes so the wording of the legal record is identical.
  const agreeBlock = (dark: boolean) =>
    agreed ? (
      <View style={styles.agreedBox}>
        <Text style={styles.agreedText}>You already agreed to this waiver.</Text>
      </View>
    ) : (
      <View
        style={[
          styles.agreeBlock,
          // The shell's footer sits on black, right above the home indicator.
          dark && { paddingBottom: insets.bottom + 12, backgroundColor: '#000000' },
        ]}
      >
        <Text style={[styles.label, dark && styles.labelDark]}>
          Type your full name to agree
        </Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Your full name"
          placeholderTextColor="#9A9A9A"
          autoCapitalize="words"
          style={[styles.input, dark && styles.inputDark]}
        />
        <Text style={styles.legal}>
          By typing your name you agree to this waiver. We record your name, the date, and
          which version you agreed to.
        </Text>
        <Pressable
          onPress={handleAgree}
          disabled={!canAgree}
          style={[styles.primaryBtn, !canAgree && styles.btnDisabled]}
        >
          {saving ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Text style={styles.primaryBtnText}>I agree</Text>
          )}
        </Pressable>
      </View>
    );

  // ── PDF waiver: full screen, agree block in the footer slot ───────────────
  if (visible && !loading && waiver?.storagePath && localPdf) {
    return (
      <FilePreviewShell
        visible
        title="Trip waiver"
        uri={localPdf.uri}
        ext="pdf"
        sizeBytes={localPdf.size}
        onDismiss={onClose}
        dismissDisabled={saving}
      >
        {agreeBlock(true)}
      </FilePreviewShell>
    );
  }

  // ── Text waiver, loading, or nothing published ────────────────────────────
  return (
    <BottomSheetShell visible={visible} onClose={onClose} avoidKeyboard>
      {({ panHandlers }) => (
        <View style={styles.surface}>
          <View {...panHandlers} style={styles.grabWrap}>
            <View style={styles.grabber} />
            <Text style={styles.title}>Trip waiver</Text>
          </View>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator />
            </View>
          ) : !waiver ? (
            <View style={styles.center}>
              <Text style={styles.empty}>
                Your organiser has not published the waiver yet. You will be able to agree
                once they do.
              </Text>
            </View>
          ) : waiver.storagePath ? (
            // A PDF that would not come down — offer no Agree button. Agreeing to
            // a document you could not read is exactly what this must not do.
            <View style={styles.center}>
              <Text style={styles.empty}>
                Could not open the waiver document. Check your connection and try again.
              </Text>
            </View>
          ) : (
            <>
              <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
                <Text style={styles.waiverText}>{waiver.bodyText}</Text>
              </ScrollView>
              {agreeBlock(false)}
            </>
          )}
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
    paddingBottom: 28,
    maxHeight: '88%',
  },
  grabWrap: { alignItems: 'center', paddingTop: 10, paddingBottom: 8, gap: 10 },
  grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#E4E4E4' },
  title: {
    fontFamily: ff('Inter', '700'),
    fontSize: 18,
    fontWeight: '700',
    color: '#212121',
  },
  center: { padding: 32, alignItems: 'center' },
  empty: {
    fontFamily: ff('Inter', '400'),
    fontSize: 13,
    lineHeight: 19,
    color: '#7B7B7B',
    textAlign: 'center',
  },
  body: { maxHeight: 320, borderTopWidth: 1, borderTopColor: '#EEEEEE' },
  bodyContent: { padding: 20 },
  waiverText: {
    fontFamily: ff('Inter', '400'),
    fontSize: 13,
    lineHeight: 20,
    color: '#333333',
  },
  agreeBlock: { paddingHorizontal: 20, paddingTop: 14, gap: 8 },
  label: {
    fontFamily: ff('Inter', '600'),
    fontSize: 13,
    fontWeight: '600',
    color: '#212121',
  },
  labelDark: { color: '#FFFFFF' },
  input: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E4E4E4',
    paddingHorizontal: 14,
    fontFamily: ff('Inter', '400'),
    fontSize: 15,
    color: '#212121',
    backgroundColor: '#FFFFFF',
  },
  inputDark: { borderColor: '#3A3A3A' },
  legal: {
    fontFamily: ff('Inter', '400'),
    fontSize: 11,
    lineHeight: 16,
    color: '#9A9A9A',
  },
  agreedBox: {
    margin: 20,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#E8F5EE',
  },
  agreedText: {
    fontFamily: ff('Inter', '600'),
    fontSize: 13,
    fontWeight: '600',
    color: '#1F7A4D',
    textAlign: 'center',
  },
  primaryBtn: {
    height: 48,
    borderRadius: 24,
    backgroundColor: '#05BCD3',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  primaryBtnText: {
    fontFamily: ff('Inter', '600'),
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  btnDisabled: { opacity: 0.45 },
});
