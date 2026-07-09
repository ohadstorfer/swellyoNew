/**
 * One-line preview for a message — shared by the conversation list and the
 * in-app banner so media/commitment placeholders never drift between the two.
 * Extracted from ConversationsScreen's duplicated inline logic.
 */
type PreviewableMessage = {
  type?: string | null;
  body?: string | null;
  image_metadata?: unknown;
  video_metadata?: unknown;
  audio_metadata?: unknown;
  file_metadata?: { display_name?: string | null } | null;
  contact_metadata?: { display_name?: string | null } | null;
  sender_id?: string | null;
};

export function messagePreviewText(
  m: PreviewableMessage | null | undefined,
  opts?: { currentUserId?: string | null }
): string {
  if (!m) return '';
  if (m.type === 'image' || m.image_metadata) return 'Image';
  if (m.type === 'video' || m.video_metadata) return 'Video';
  if (m.type === 'audio' || m.audio_metadata) return 'Voice message';
  if (m.type === 'file' || m.file_metadata) return `📎 ${m.file_metadata?.display_name ?? 'File'}`;
  if (m.type === 'contact' || m.contact_metadata) return `👤 ${m.contact_metadata?.display_name ?? 'Contact'}`;
  if (m.type === 'commitment_request') {
    return m.sender_id && m.sender_id === opts?.currentUserId
      ? 'You requested to be Committed'
      : 'Requested to be Committed';
  }
  return m.body ?? '';
}
