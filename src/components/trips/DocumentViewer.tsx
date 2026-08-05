/**
 * DocumentViewer — full-screen look at one traveler document.
 *
 * Used by the traveler (their own passport) and by the host (reviewing, with
 * Approve / Reject).
 *
 * Handles both shapes the bucket can hold. A passport is always an image, but
 * visa / insurance / flights accept a PDF too (see REQUIREMENT_CATALOG.allowPdf),
 * and a PDF fed to <Image> renders as nothing at all — which would have left the
 * operator unable to review the very documents most often sent as PDFs.
 *
 * Five rules, all security-shaped rather than cosmetic:
 *
 * 1. The signed URL is minted here, per open, and lives about 60 seconds. It is
 *    held in local state that dies with the component and is never written to
 *    react-query, AsyncStorage, or a log. A signed URL is a bearer token.
 * 2. `cachePolicy="none"`. `expo-image` disk-caches by default, which would leave
 *    a plain unencrypted copy of a passport in the app's cache directory —
 *    outliving the URL, the 30-day purge, and logout.
 * 3. A PDF has no equivalent of `cachePolicy` — the renderer takes a local path,
 *    so the bytes MUST land on disk. It is written to the cache directory and
 *    deleted the moment the viewer closes, which is the closest a PDF gets to
 *    rule 2. That delete is the only thing keeping someone's insurance policy
 *    out of the cache directory indefinitely; do not remove it.
 *    The PDF renders through FilePreviewBody INSIDE this Modal, never by
 *    swapping in FilePreviewShell — the Shell is a Modal of its own, and
 *    presenting it as this one unmounts is the main-thread race that hangs the
 *    picker elsewhere in this app.
 * 4. No share button, no save button, no "open in". The operator can still
 *    screenshot; we are not building a one-tap export.
 * 5. Pinch and pan to zoom is required, not a nicety — someone is reading a
 *    passport number off a phone screen.
 *
 * Spec: docs/specs/operator-trips/passport-upload-v1.md §4.6
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Modal,
  ActivityIndicator,
  Platform,
  Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { GestureHandlerRootView, Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FilePreviewBody } from '../filePreview/FilePreviewBody';
import { PassportDetailsPanel } from './PassportDetailsPanel';
import { ff } from '../../theme/fonts';
import { getViewUrl } from '../../services/trips/tripDocumentsService';
import { friendlyErrorMessage } from '../../utils/friendlyError';

/**
 * A filename the OS and every share target will accept.
 *
 * Slashes would create directories that do not exist, and a colon is illegal on
 * some targets — so anything outside letters, digits, space, dash and dot goes.
 * Capped because a long trip title plus a long name can otherwise exceed the
 * filesystem's per-component limit and the write fails with nothing useful.
 */
function safeFileName(input: string): string {
  return input
    .replace(/[^\p{L}\p{N} .-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

export const DocumentViewer: React.FC<{
  visible: boolean;
  onClose: () => void;
  storagePath: string | null;
  title?: string;
  /** Host review actions. Omit both to render a read-only viewer. */
  onApprove?: () => void;
  onReject?: () => void;
  busy?: boolean;
  /** Render as a full-bleed layer instead of its own Modal. Required whenever
   *  the caller is ALREADY inside a Modal — see the note at the return. */
  inline?: boolean;
  /**
   * Offer "Copy details" — read the passport's code lines and copy the fields.
   *
   * Passed by the HOST review screen only. A traveler looking at their own
   * passport has no use for it, and the operator is the one who has to type
   * these details into a flight booking.
   */
  isPassport?: boolean;
  /** Shown in the details panel so a copied block is attributable on screen. */
  travelerName?: string | null;
  /**
   * Offer Export — hand the real file to the OS share sheet.
   *
   * ⚠️ This REVERSES rule 4 above, and only for the host. Ohad asked for it on
   * 2026-08-04, and the web dashboard has had it since it shipped: an operator
   * forwards passports to hotels, airlines and visa agents, and doing that from
   * a phone is the entire reason this tab exists. The accepted cost is the same
   * one `docs/SPEC.md` §4.3 already records — a copy the operator saves is
   * theirs, and Swellyo's 30-day delete does not reach it.
   *
   * A traveler viewing their OWN document never gets this. They already have
   * the original; the flag exists to keep the export a host capability.
   */
  allowExport?: boolean;
}> = ({
  visible,
  onClose,
  storagePath,
  title = 'Passport',
  onApprove,
  onReject,
  busy,
  inline = false,
  isPassport = false,
  travelerName,
  allowExport = false,
}) => {
  const insets = useSafeAreaInsets();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pdf, setPdf] = useState<{ uri: string; size: number } | null>(null);
  const [exporting, setExporting] = useState(false);
  const isPdf = !!storagePath && storagePath.toLowerCase().endsWith('.pdf');

  /**
   * Files written for an export, deleted when the viewer closes.
   *
   * NOT deleted the moment `shareAsync` resolves: the receiving app may still
   * be reading the file it was handed, and on iOS the promise settles when the
   * sheet dismisses, not when Mail has finished attaching. Tying the delete to
   * the viewer's own teardown keeps rule 3 (nothing outlives the viewer)
   * without racing the share.
   */
  const exportedPaths = useRef<string[]>([]);

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  const resetZoom = useCallback(() => {
    scale.value = 1;
    savedScale.value = 1;
    tx.value = 0;
    ty.value = 0;
    savedTx.value = 0;
    savedTy.value = 0;
  }, [scale, savedScale, tx, ty, savedTx, savedTy]);

  // Mint a fresh URL every time the viewer opens. Never reuse one.
  useEffect(() => {
    if (!visible || !storagePath) {
      setUrl(null);
      setPdf(null);
      setError(null);
      return;
    }
    let cancelled = false;
    // Captured for the cleanup: `pdf` state is already null by the time the
    // cleanup runs, so the path to delete has to be held here.
    let downloadedPath: string | null = null;
    resetZoom();
    (async () => {
      try {
        const signed = await getViewUrl(storagePath);
        if (cancelled) return;

        if (!isPdf) {
          setUrl(signed);
          return;
        }

        // PdfRendererView takes a local path, so the file has to come down.
        // Named by document id (the storage key's basename), never by anything
        // that identifies the person.
        const FileSystem = require('expo-file-system/legacy');
        const basename = storagePath.split('/').pop() ?? 'document.pdf';
        const target = `${FileSystem.cacheDirectory}doc-${basename}`;
        const res = await FileSystem.downloadAsync(signed, target);
        if (cancelled || !res?.uri) return;
        downloadedPath = res.uri;
        const info = await FileSystem.getInfoAsync(res.uri);
        if (!cancelled) {
          setPdf({ uri: res.uri, size: info?.exists && 'size' in info ? info.size : 0 });
        }
      } catch (e) {
        // Do not log the path or the error object — either can carry the key.
        console.error('[DocumentViewer] could not open the document');
        if (!cancelled) setError(friendlyErrorMessage(e, 'Could not open this document.'));
      }
    })();
    return () => {
      cancelled = true;
      // Drop the token as soon as the viewer goes away.
      setUrl(null);
      setPdf(null);
      // Rule 3: the decrypted PDF must not outlive the viewer.
      if (downloadedPath) {
        const FileSystem = require('expo-file-system/legacy');
        FileSystem.deleteAsync(downloadedPath, { idempotent: true }).catch(() => {
          // Best effort. A failure here leaves one file in the OS-managed cache
          // directory, which is not worth surfacing to the user.
        });
      }
    };
  }, [visible, storagePath, isPdf, resetZoom]);

  /**
   * Hand the real file to the OS share sheet.
   *
   * Its own signed URL and its own download, never the one the viewer is
   * showing: the image path only ever holds a URL (rule 2 keeps the bytes out
   * of the disk cache), and reusing the PDF's copy would let the share hold a
   * file the close handler is about to delete.
   *
   * The filename is what the operator will see in Mail or WhatsApp, so it is
   * built from the traveler and the document — "Maya Cohen - Passport.jpg" —
   * and never from the storage key, which is a bare UUID.
   */
  const handleExport = useCallback(async () => {
    if (!storagePath || exporting) return;
    setExporting(true);
    try {
      const Sharing = require('expo-sharing');
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('Not available', 'Sharing is not available on this device.');
        return;
      }

      const FileSystem = require('expo-file-system/legacy');
      const signed = await getViewUrl(storagePath);
      const ext = isPdf ? 'pdf' : 'jpg';
      const name = safeFileName([travelerName, title].filter(Boolean).join(' - ')) || 'document';
      const target = `${FileSystem.cacheDirectory}${name}.${ext}`;

      const res = await FileSystem.downloadAsync(signed, target);
      if (!res?.uri) throw new Error('download failed');
      exportedPaths.current.push(res.uri);

      await Sharing.shareAsync(res.uri, {
        mimeType: isPdf ? 'application/pdf' : 'image/jpeg',
        // iOS picks the destination app off the UTI, not the extension.
        UTI: isPdf ? 'com.adobe.pdf' : 'public.jpeg',
        dialogTitle: name,
      });
    } catch (e) {
      // Never log the path or the raw error — either can carry the storage key.
      console.error('[DocumentViewer] export failed');
      Alert.alert('Export failed', friendlyErrorMessage(e, 'Could not export this document.'));
    } finally {
      setExporting(false);
    }
  }, [storagePath, exporting, isPdf, travelerName, title]);

  // Rule 3 again: an exported copy must not outlive the viewer either.
  useEffect(
    () => () => {
      const paths = exportedPaths.current;
      exportedPaths.current = [];
      if (paths.length === 0) return;
      const FileSystem = require('expo-file-system/legacy');
      paths.forEach(p => {
        FileSystem.deleteAsync(p, { idempotent: true }).catch(() => {
          // Best effort — a leftover in the OS-managed cache directory is not
          // worth surfacing to the operator.
        });
      });
    },
    [],
  );

  const pinch = Gesture.Pinch()
    .onUpdate(e => {
      scale.value = Math.min(Math.max(savedScale.value * e.scale, 1), 6);
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= 1.01) {
        // Snapping home needs to feel like a release, so it is fast and eased out.
        scale.value = withTiming(1, { duration: 160 });
        tx.value = withTiming(0, { duration: 160 });
        ty.value = withTiming(0, { duration: 160 });
        savedScale.value = 1;
        savedTx.value = 0;
        savedTy.value = 0;
      }
    });

  const pan = Gesture.Pan()
    .onUpdate(e => {
      // Only pans once zoomed in; otherwise it fights the close gesture.
      if (savedScale.value <= 1) return;
      tx.value = savedTx.value + e.translationX;
      ty.value = savedTy.value + e.translationY;
    })
    .onEnd(() => {
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      const zoomed = savedScale.value > 1.01;
      const to = zoomed ? 1 : 2.5;
      scale.value = withTiming(to, { duration: 180 });
      savedScale.value = to;
      if (zoomed) {
        tx.value = withTiming(0, { duration: 180 });
        ty.value = withTiming(0, { duration: 180 });
        savedTx.value = 0;
        savedTy.value = 0;
      }
    });

  const composed = Gesture.Simultaneous(pinch, pan, doubleTap);

  const imageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  // Reading the details is offered independently of Approve / Reject: the
  // operator books the flight AFTER approving, so an already-approved passport
  // is exactly when they need this most.
  const copyDetails =
    isPassport && storagePath && !isPdf ? (
      <View style={styles.detailsRow}>
        <Pressable
          onPress={() => setDetailsOpen(true)}
          style={({ pressed }) => [styles.detailsBtn, pressed && styles.btnPressed]}
        >
          <Ionicons name="text-outline" size={17} color="#FFFFFF" style={styles.detailsIcon} />
          <Text style={styles.detailsText}>Copy details</Text>
        </Pressable>
      </View>
    ) : null;

  // Approve / Reject, shared by both shapes so the two never drift.
  const actions =
    onApprove || onReject ? (
      <View style={[styles.actions, { paddingBottom: insets.bottom + 16 }]}>
        {onReject ? (
          <Pressable
            onPress={onReject}
            disabled={busy}
            style={[styles.rejectBtn, busy && styles.btnDisabled]}
          >
            <Text style={styles.rejectText}>Ask for a new one</Text>
          </Pressable>
        ) : null}
        {onApprove ? (
          <Pressable
            onPress={onApprove}
            disabled={busy}
            style={[styles.approveBtn, busy && styles.btnDisabled]}
          >
            {busy ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.approveText}>Approve</Text>
            )}
          </Pressable>
        ) : null}
      </View>
    ) : null;

  // Android needs its own root for gestures inside a Modal, or pinch is
  // silently dead.
  const inner = (
      <GestureHandlerRootView style={[styles.root, inline && styles.rootInline]}>
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
            <Ionicons name="close" size={26} color="#FFFFFF" />
          </Pressable>
          <Text style={styles.headerTitle}>{title}</Text>
          {/* Export is HOST-ONLY (`allowExport`). Rule 4 above still holds for
              everyone else: no share, no save, no "open in". */}
          {allowExport && !!storagePath && !error ? (
            <Pressable
              onPress={handleExport}
              disabled={exporting}
              hitSlop={12}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Export this document"
            >
              {exporting ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Ionicons name="share-outline" size={24} color="#FFFFFF" />
              )}
            </Pressable>
          ) : (
            <View style={styles.closeBtn} />
          )}
        </View>

        <View style={styles.body}>
          {error ? (
            <Text style={styles.error}>{error}</Text>
          ) : isPdf ? (
            // Deliberately rendered INSIDE this Modal via FilePreviewBody rather
            // than by swapping in FilePreviewShell — the Shell is itself a
            // Modal, so switching to it once the download finished would unmount
            // one Modal in the same commit that presents another. That is the
            // main-thread race that hangs the picker elsewhere in this app.
            // One Modal for every state; only the body changes.
            //
            // FilePreviewBody also degrades to a file card on its own (Expo Go,
            // or a PDF view that throws), so there is no path to a blank pane.
            pdf ? (
              // `body` centers its child for the image case; a PDF has to fill
              // the pane, so it gets its own stretched wrapper.
              <View style={styles.pdfWrap}>
                <FilePreviewBody
                  uri={pdf.uri}
                  displayName={title}
                  ext="pdf"
                  sizeBytes={pdf.size}
                />
              </View>
            ) : (
              <ActivityIndicator color="#FFFFFF" />
            )
          ) : !url ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <GestureDetector gesture={composed}>
              <Animated.View style={[styles.imageWrap, imageStyle]}>
                <Image
                  source={{ uri: url }}
                  style={styles.image}
                  contentFit="contain"
                  cachePolicy="none"
                  transition={140}
                />
              </Animated.View>
            </GestureDetector>
          )}
        </View>

        {copyDetails}
        {actions}

        {/* A LAYER, never a Modal — this component is itself often rendered
            inline inside someone else's Modal. */}
        <PassportDetailsPanel
          visible={detailsOpen}
          onClose={() => setDetailsOpen(false)}
          storagePath={storagePath}
          travelerName={travelerName}
        />
      </GestureHandlerRootView>
  );

  // Rendered as a LAYER, not a Modal, when the caller is already inside one.
  //
  // Nesting a Modal inside a Modal is what strands an invisible view controller
  // on iOS: closing the viewer and its host in overlapping frames leaves a
  // transparent presentation alive, and every touch on the screen underneath
  // dies against it. The screen looks completely healthy — the JS thread is
  // fine, nothing is logged, nothing is drawn.
  //
  // Same rule the PDF branch above follows: one Modal per screen, everything
  // else is a view inside it.
  if (inline) return visible ? inner : null;

  return (
    <Modal
      visible={visible}
      transparent={false}
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      // Android: without this the system nav bar stays opaque over the sheet.
      {...(Platform.OS === 'android' ? { navigationBarTranslucent: true } : {})}
    >
      {inner}
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0B0B' },
  // Covers the host Modal's own content rather than presenting a new window.
  rootInline: { ...StyleSheet.absoluteFillObject, zIndex: 50, flex: undefined },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  closeBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: {
    fontFamily: ff('Inter', '600'),
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  imageWrap: { width: '100%', height: '100%' },
  pdfWrap: { flex: 1, alignSelf: 'stretch', width: '100%' },
  image: { width: '100%', height: '100%' },
  error: {
    fontFamily: ff('Inter', '400'),
    fontSize: 14,
    color: '#FFFFFF',
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  detailsRow: { paddingHorizontal: 20, paddingTop: 12 },
  detailsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  detailsIcon: { marginRight: 8 },
  detailsText: {
    fontFamily: ff('Inter', '600'),
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  // Pressing must be felt. Transform only — never width or margin.
  btnPressed: { transform: [{ scale: 0.97 }] },
  rejectBtn: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#5A5A5A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rejectText: {
    fontFamily: ff('Inter', '600'),
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  approveBtn: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#05BCD3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  approveText: {
    fontFamily: ff('Inter', '600'),
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  btnDisabled: { opacity: 0.6 },
});
