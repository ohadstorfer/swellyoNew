/**
 * Renders a local file:// for both file preview surfaces: the outgoing
 * pre-send review (FilePreviewModal) and the incoming viewer (FileViewerModal).
 *
 * Security: rendering an INCOMING file here is a deliberate reversal of the old
 * "received files are never rendered in-app" posture — see the note in
 * FileBubble.tsx. Images already decode in-process via expo-image; text has no
 * parser; a PDF runs through the system parsers (PDFKit / PDFium), the same ones
 * the OS share sheet would use.
 *
 * Every branch degrades to FileCard: unrenderable type, text over the cap, a
 * failed read, Expo Go, or a PDF view that throws. There is no path to a blank
 * pane.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { Image } from 'expo-image';
import {
  previewKindForExt,
  isQuickLookExt,
  MAX_TEXT_PREVIEW_BYTES,
} from '../../services/messaging/fileAttachmentPolicy';
import { previewFile } from '../../../modules/swellyo-quicklook';
import { PdfRendererView, type PdfRendererProps } from './pdfRenderer';
import { FileCard } from './FileCard';
import { fs } from '../../theme/fonts';

/**
 * iOS Office docs (docx/xlsx/pptx/…) can't render in the dark in-app viewer, but
 * QuickLook can. Hand the local file to the same QLPreviewController the receive
 * side uses. If the native module can't present (shouldn't happen while
 * foregrounded), fall back to the OS share sheet so the tap is never inert.
 */
async function openInQuickLook(uri: string): Promise<void> {
  const shown = await previewFile(uri);
  if (shown) return;
  try {
    const Sharing = require('expo-sharing');
    if (Sharing && (await Sharing.isAvailableAsync())) {
      await Sharing.shareAsync(uri);
    }
  } catch {
    /* expo-sharing unavailable — nothing left to try; the card stays put. */
  }
}

interface FilePreviewBodyProps {
  uri: string;
  displayName: string;
  ext: string;
  sizeBytes: number;
}

/** A native view that throws on mount can only be caught by a class boundary. */
class RenderBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.warn('[FilePreviewBody] renderer failed, falling back to the card:', error);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function ImagePreview({ uri }: { uri: string }) {
  const [failed, setFailed] = useState(false);

  // expo-image does NOT throw on a decode failure — it renders an empty box
  // and calls onError. RenderBoundary only catches render-phase throws, so a
  // corrupt image needs its own failure state to reach the card.
  if (failed) throw new Error('image decode failed'); // caught by RenderBoundary

  return (
    <Image
      source={{ uri }}
      style={styles.image}
      contentFit="contain"
      transition={120}
      onError={() => setFailed(true)}
    />
  );
}

function PdfPreview({
  uri,
  Renderer,
}: {
  uri: string;
  /** Non-null here — the caller already branched on PdfRendererView. */
  Renderer: React.ComponentType<PdfRendererProps>;
}) {
  const [failed, setFailed] = useState(false);

  // A mount throw is caught by the parent RenderBoundary. A native-reported
  // error arrives only via onError, so it needs the same throw-on-state-change
  // path to reach the same boundary.
  if (failed) throw new Error('pdf render failed'); // caught by RenderBoundary

  return (
    // borderRadius on this native view is ignored on Android and CRASHES on
    // iOS — never round it directly; wrap it if you ever need rounding.
    // No singlePage: multi-page files scroll vertically. The shell's
    // pan-to-dismiss yields to the renderer's native scroll; the X still closes.
    <Renderer
      source={uri}
      maxZoom={1}
      maxPageResolution={2048}
      style={styles.pdf}
      onError={() => setFailed(true)}
    />
  );
}

function TextPreview({ uri }: { uri: string }) {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Safe to read whole: the caller already gated on MAX_TEXT_PREVIEW_BYTES.
        // The byte-capped alternative (file.open().readBytes) needs TextDecoder,
        // which this project does not polyfill.
        const { File } = await import('expo-file-system');
        const contents = await new File(uri).text();
        if (!cancelled) setText(contents);
      } catch (e) {
        console.warn('[FilePreviewBody] could not read text file:', e);
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uri]);

  if (failed) throw new Error('text read failed'); // caught by RenderBoundary
  if (text === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#FFFFFF" />
      </View>
    );
  }
  return (
    <ScrollView style={styles.textScroll} contentContainerStyle={styles.textContent}>
      <Text style={styles.text} selectable>
        {text}
      </Text>
    </ScrollView>
  );
}

export function FilePreviewBody({ uri, displayName, ext, sizeBytes }: FilePreviewBodyProps) {
  const card = <FileCard displayName={displayName} ext={ext} sizeBytes={sizeBytes} />;
  const kind = previewKindForExt(ext);

  if (kind === 'image') {
    return (
      <RenderBoundary key={uri} fallback={card}>
        <ImagePreview uri={uri} />
      </RenderBoundary>
    );
  }

  if (kind === 'pdf') {
    // Expo Go, or a build without the native view.
    if (!PdfRendererView) return card;
    return (
      <RenderBoundary key={uri} fallback={card}>
        <PdfPreview uri={uri} Renderer={PdfRendererView} />
      </RenderBoundary>
    );
  }

  if (kind === 'text') {
    if (sizeBytes > MAX_TEXT_PREVIEW_BYTES) {
      return (
        <FileCard
          displayName={displayName}
          ext={ext}
          sizeBytes={sizeBytes}
          note="Too large to preview"
        />
      );
    }
    return (
      <RenderBoundary key={uri} fallback={card}>
        <TextPreview uri={uri} />
      </RenderBoundary>
    );
  }

  // iOS Office docs: not renderable in-app, but QuickLook can preview them.
  // Show the card as a tap target that opens QLPreviewController over this
  // modal. Non-iOS keeps the plain card (no in-app Office viewer there).
  if (Platform.OS === 'ios' && isQuickLookExt(ext)) {
    return (
      <FileCard
        displayName={displayName}
        ext={ext}
        sizeBytes={sizeBytes}
        onPress={() => { void openInQuickLook(uri); }}
        actionLabel="Tap to preview"
      />
    );
  }

  return card;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  image: { flex: 1, width: '100%' },
  pdf: { flex: 1, width: '100%', backgroundColor: '#1A1A1A' },
  textScroll: { flex: 1, backgroundColor: '#FFFFFF' },
  textContent: { padding: 16 },
  text: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: fs(12),
    lineHeight: 18,
    color: '#1A1A1A',
    includeFontPadding: false,
  },
});
