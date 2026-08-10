/**
 * WaiverStepInline — the waiver, rendered INSIDE the onboarding step.
 *
 * There is no sheet and no second screen. The traveler lands on the document
 * itself and the agree button is under it. The previous shape charged them two
 * navigations for one action: a step screen whose only content was a button,
 * which opened a full-screen viewer, which carried its own footer.
 *
 * THREE THINGS HERE ARE NOT STYLE CHOICES:
 *
 * 1. `PdfRendererView` IS NULL IN EXPO GO. It is a native Fabric view, so the
 *    module resolves to null wherever the native side is absent, and mounting
 *    null throws inside render rather than somewhere catchable. Every path
 *    below branches on it and degrades to a readable card — the traveler must
 *    still be able to agree, because the waiver gates the whole trip.
 *
 * 2. NEVER PUT borderRadius ON THE RENDERER. It is ignored on Android and
 *    CRASHES on iOS. The rounding lives on a wrapper with overflow: 'hidden'.
 *
 * 3. THE NAME IS NOT TYPED. It comes from the profile and is shown as
 *    "Agreeing as <name>". The typed input survives only for a profile with no
 *    name, because `operator_requirement_acknowledge` rejects an empty one.
 *    See the header of WaiverAgreeSheet, which stays for the Plan tab.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PdfRendererView } from '../filePreview/pdfRenderer';
import { FilePreviewShell } from '../filePreview/FilePreviewShell';
import { ff } from '../../theme/fonts';
import { supabase } from '../../config/supabase';
import {
  fetchWaiver,
  getViewUrl,
  acknowledgeRequirement,
} from '../../services/trips/tripDocumentsService';
import { showErrorAlert } from '../../utils/friendlyError';

const C = {
  accent: '#05BCD3',
  ink: '#212121',
  muted: '#7B7B7B',
  faint: '#8A8A84',
  surface: '#FFFFFF',
  hairline: '#EFEFEF',
  border: '#E4E4E4',
} as const;

export const WaiverStepInline: React.FC<{
  tripId: string;
  requirementId: string;
  /** Already agreed — the document stays readable, the button does not. */
  agreed?: boolean;
  onAgreed: () => void;
}> = ({ tripId, requirementId, agreed = false, onAgreed }) => {
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [renderFailed, setRenderFailed] = useState(false);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  /** Only for the full-screen shell's header, which prints the file size. */
  const [sizeBytes, setSizeBytes] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMissing(false);
    setRenderFailed(false);

    // Their own name, so agreeing is a tap. Fired alongside the download rather
    // than before it — a slow profile read must not delay the document.
    supabase.auth.getSession().then(async ({ data }) => {
      const uid = data.session?.user?.id;
      if (!uid) return;
      const { data: me } = await supabase
        .from('surfers')
        .select('name')
        .eq('user_id', uid)
        .maybeSingle();
      if (!cancelled) setProfileName(((me as any)?.name ?? '').trim());
    });

    (async () => {
      try {
        const w = await fetchWaiver(tripId);
        if (cancelled) return;
        if (!w?.storagePath) {
          setMissing(true);
          return;
        }
        // The renderer takes a local path only, so the file comes down first.
        // The signed URL is used once, here, and never stored — it is a bearer
        // token with a ~60s life.
        const url = await getViewUrl(w.storagePath);
        const FileSystem = require('expo-file-system/legacy');
        const target = `${FileSystem.cacheDirectory}waiver-${tripId}-v${w.version}.pdf`;
        const res = await FileSystem.downloadAsync(url, target);
        if (!cancelled && res?.uri) {
          setLocalUri(res.uri);
          const info = await FileSystem.getInfoAsync(res.uri);
          if (!cancelled) {
            setSizeBytes(info?.exists && 'size' in info ? info.size : 0);
          }
        }
      } catch (e) {
        console.error('[WaiverStepInline] could not load the waiver');
        if (!cancelled) setMissing(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tripId]);

  const signingName = (profileName || name).trim();
  const needsTypedName = profileName !== null && profileName === '';
  const canAgree = !missing && signingName.length >= 2 && !saving && !loading;

  const handleAgree = useCallback(async () => {
    if (!canAgree) return;
    setSaving(true);
    try {
      await acknowledgeRequirement(requirementId, signingName);
      setSaving(false);
      onAgreed();
    } catch (e) {
      console.error('[WaiverStepInline] acknowledge failed:', e);
      setSaving(false);
      showErrorAlert('Could not save', e, 'Could not record your agreement. Please try again.');
    }
  }, [canAgree, requirementId, signingName, onAgreed]);

  // ── The document ─────────────────────────────────────────────────────────
  const body = (() => {
    if (loading) {
      return (
        <View style={styles.centre}>
          <ActivityIndicator color={C.accent} />
        </View>
      );
    }
    if (missing) {
      return (
        <View style={styles.centre}>
          <Ionicons name="alert-circle-outline" size={26} color={C.faint} />
          <Text style={styles.fallbackText}>
            The organiser has not published a waiver yet. You will be able to agree once they do.
          </Text>
        </View>
      );
    }
    // Expo Go, or the native view reported a failure. The traveler can still
    // agree — the waiver gates the trip, and blocking on a preview would
    // strand them.
    if (!PdfRendererView || renderFailed) {
      return (
        <View style={styles.centre}>
          <Ionicons name="document-text-outline" size={26} color={C.faint} />
          <Text style={styles.fallbackText}>
            {renderFailed
              ? 'This waiver could not be displayed here.'
              : 'The document preview is not available in this build.'}
          </Text>
          <Text style={styles.fallbackSub}>
            Ask the organiser for a copy before you agree.
          </Text>
        </View>
      );
    }
    return (
      // Rounding lives HERE, never on the renderer — see the header.
      <View style={styles.pdfFrame}>
        <PdfRendererView
          source={localUri!}
          maxZoom={1}
          maxPageResolution={2048}
          style={styles.pdf}
          onError={() => setRenderFailed(true)}
        />
        {/* Full screen. The inline frame is a preview sized to leave room for
            the agree block; small print in a real waiver needs the whole
            display. Floated over the top-right corner of the document rather
            than placed in the step header, because it acts on THIS document —
            and the header's right slot is already the dev Reset. */}
        <Pressable
          onPress={() => setFullScreen(true)}
          style={styles.expandBtn}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Open the waiver full screen"
        >
          <Ionicons name="expand-outline" size={16} color={C.ink} />
        </Pressable>
      </View>
    );
  })();

  return (
    <View style={styles.root}>
      {body}

      {agreed ? (
        <View style={styles.agreedBox}>
          <Ionicons name="checkmark-circle" size={16} color="#1F7A4D" />
          <Text style={styles.agreedText}>You already agreed to this waiver.</Text>
        </View>
      ) : (
        <View style={styles.agreeBlock}>
          {needsTypedName ? (
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Type your full name to agree"
              placeholderTextColor="#9A9A9A"
              autoCapitalize="words"
              style={styles.input}
            />
          ) : (
            <Text style={styles.signing}>Agreeing as {signingName || '…'}</Text>
          )}
          <Text style={styles.legal}>
            We record your name, the date, and which version you agreed to.
          </Text>
          <Pressable
            onPress={handleAgree}
            disabled={!canAgree}
            style={[styles.primaryBtn, !canAgree && styles.btnDisabled]}
            accessibilityRole="button"
            accessibilityLabel="I agree to this waiver"
          >
            {saving ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.primaryBtnText}>I agree</Text>
            )}
          </Pressable>
        </View>
      )}

      {/* Reading only — no agree block in here. Agreeing stays anchored to the
          step, so there is exactly one place that action lives and no way to
          end up agreeing from a screen the flow does not know you are on. */}
      {fullScreen && localUri ? (
        <FilePreviewShell
          visible
          title="Trip waiver"
          uri={localUri}
          ext="pdf"
          sizeBytes={sizeBytes}
          onDismiss={() => setFullScreen(false)}
        />
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },

  pdfFrame: {
    flex: 1,
    marginTop: 14,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.hairline,
  },
  pdf: { flex: 1, backgroundColor: C.surface },
  expandBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 30,
    height: 30,
    borderRadius: 99,
    alignItems: 'center',
    justifyContent: 'center',
    // Opaque, not translucent: it sits on a white page, and a see-through
    // control over text is harder to read than the text it covers.
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: C.hairline,
    // A small lift so it reads as floating ABOVE the page rather than printed
    // on it.
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },

  centre: {
    flex: 1,
    marginTop: 14,
    borderRadius: 12,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.hairline,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 28,
  },
  fallbackText: {
    fontFamily: ff('Inter', '400'),
    fontSize: 13,
    lineHeight: 20,
    color: C.faint,
    textAlign: 'center',
  },
  fallbackSub: {
    fontFamily: ff('Inter', '400'),
    fontSize: 12,
    color: '#B0B0AA',
    textAlign: 'center',
  },

  agreeBlock: { paddingTop: 14 },
  signing: { fontFamily: ff('Inter', '600'), fontSize: 14, color: C.ink },
  input: {
    height: 46,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
    paddingHorizontal: 14,
    fontFamily: ff('Inter', '400'),
    fontSize: 15,
    color: C.ink,
  },
  legal: {
    fontFamily: ff('Inter', '400'),
    fontSize: 11.5,
    lineHeight: 17,
    color: C.muted,
    marginTop: 6,
    marginBottom: 12,
  },
  primaryBtn: {
    height: 50,
    borderRadius: 99,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDisabled: { opacity: 0.5 },
  primaryBtnText: { fontFamily: ff('Inter', '700'), fontSize: 15, color: '#FFFFFF' },

  agreedBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
    backgroundColor: '#E8F5EE',
    borderRadius: 12,
    padding: 14,
  },
  agreedText: { fontFamily: ff('Inter', '500'), fontSize: 13, color: '#1F7A4D' },
});
