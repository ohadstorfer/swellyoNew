import type { Message } from './messagingService';

/**
 * "Has real uploaded media" per type. Video's video_url stays '' until the
 * MediaConvert Lambda finishes, so its success signal is storage_path (set the
 * moment the S3 upload + create succeed), NOT video_url.
 */
export function hasRealMedia(m: Message): boolean {
  if (m.type === 'image') return !!m.image_metadata?.image_url;
  if (m.type === 'video') return !!m.video_metadata?.storage_path;
  if (m.type === 'audio') return !!m.audio_metadata?.audio_url;
  if (m.type === 'file') return !!m.file_metadata?.storage_path;
  return true;
}

/**
 * The user's OWN media row with no usable media that isn't actively uploading:
 * a leftover 'uploading' row (still cached, not in this session's in-flight
 * set) or an old pre-fix ghost (real server row with null metadata,
 * upload_state undefined). Never received, in-flight, sent or already-failed.
 */
export function isDeadUpload(
  m: Message,
  currentUserId: string | null | undefined,
  inFlightUploads: Set<string>,
): boolean {
  const isMedia = m.type === 'image' || m.type === 'video' || m.type === 'audio' || m.type === 'file';
  return (
    isMedia &&
    m.sender_id === currentUserId &&
    !hasRealMedia(m) &&
    !inFlightUploads.has(m.id) &&
    m.upload_state !== 'sent' &&
    m.upload_state !== 'failed'
  );
}

/**
 * Resolve dead rows against what the server actually has. An upload can finish
 * after the screen that started it unmounted (the trip chat unmounts on every
 * tab switch), and that screen's setMessages is then a no-op, so the cache
 * keeps the 'uploading' row of a message that really was sent. Those rows swap
 * to the server row; only rows the server doesn't have become 'failed' (Retry
 * still works: _localPreviewUri is kept). Returns the same array if unchanged.
 */
export function healDeadUploads(
  messages: Message[],
  serverRows: Message[],
  currentUserId: string | null | undefined,
  inFlightUploads: Set<string>,
): Message[] {
  const serverByClientId = new Map(
    serverRows.filter((r) => r.client_id && hasRealMedia(r)).map((r) => [r.client_id!, r]),
  );
  let changed = false;
  const next = messages.map((m) => {
    if (!isDeadUpload(m, currentUserId, inFlightUploads)) return m;
    changed = true;
    const server = m.client_id ? serverByClientId.get(m.client_id) : undefined;
    return server ?? { ...m, upload_state: 'failed' as const, upload_error: 'Upload interrupted' };
  });
  return changed ? next : messages;
}
