/**
 * Extension → Ionicons glyph. Shared by the sent-message FileBubble and the
 * pre-send FileCard so a file wears the same icon before and after sending.
 */
import { Ionicons } from '@expo/vector-icons';

export function iconForExt(ext: string): keyof typeof Ionicons.glyphMap {
  if (['pdf'].includes(ext)) return 'document-text';
  if (['doc', 'docx', 'rtf', 'txt'].includes(ext)) return 'document';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'grid';
  if (['ppt', 'pptx'].includes(ext)) return 'easel';
  if (['zip'].includes(ext)) return 'archive';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic'].includes(ext)) return 'image';
  if (['mp3', 'm4a', 'wav'].includes(ext)) return 'musical-notes';
  if (['mp4', 'mov'].includes(ext)) return 'videocam';
  return 'document-attach';
}
