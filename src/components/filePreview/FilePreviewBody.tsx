/**
 * Renders a locally-picked file for the pre-send review screen.
 *
 * Security: this renders only the OUTGOING file the sender just chose in their
 * own picker, before upload. FileBubble's rule — a RECEIVED file is never
 * rendered in-app, it opens through the OS share sheet — is unchanged.
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
  MAX_TEXT_PREVIEW_BYTES,
} from '../../services/messaging/fileAttachmentPolicy';
import { PdfRendererView, type PdfRendererProps } from './pdfRenderer';
import { FileCard } from './FileCard';
import { ff, fs } from '../../theme/fonts';

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
    <Renderer
      source={uri}
      singlePage
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
