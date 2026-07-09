import { messagePreviewText } from '../messagePreviewText';

describe('messagePreviewText', () => {
  describe('file messages', () => {
    it('shows the filename when there is no caption', () => {
      expect(
        messagePreviewText({ type: 'file', body: '', file_metadata: { display_name: 'trip.pdf' } }),
      ).toBe('📎 trip.pdf');
    });
    it('prefers the caption when one was typed', () => {
      expect(
        messagePreviewText({
          type: 'file',
          body: 'here is the itinerary',
          file_metadata: { display_name: 'trip.pdf' },
        }),
      ).toBe('here is the itinerary');
    });
    it('falls back when the metadata has no name', () => {
      expect(messagePreviewText({ type: 'file', body: '', file_metadata: {} })).toBe('📎 File');
    });
  });

  describe('contact messages', () => {
    it('shows the contact name', () => {
      expect(
        messagePreviewText({ type: 'contact', contact_metadata: { display_name: 'Ana' } }),
      ).toBe('👤 Ana');
    });
  });

  describe('other types are unchanged', () => {
    it('labels media', () => {
      expect(messagePreviewText({ type: 'image' })).toBe('Image');
      expect(messagePreviewText({ type: 'video' })).toBe('Video');
      expect(messagePreviewText({ type: 'audio' })).toBe('Voice message');
    });
    it('infers media type from metadata alone', () => {
      expect(messagePreviewText({ image_metadata: { w: 1 } })).toBe('Image');
      expect(messagePreviewText({ video_metadata: {} })).toBe('Video');
      expect(messagePreviewText({ audio_metadata: {} })).toBe('Voice message');
    });
    it('returns the body for text', () => {
      expect(messagePreviewText({ type: 'text', body: 'hola' })).toBe('hola');
    });
    it('returns empty for nothing', () => {
      expect(messagePreviewText(null)).toBe('');
      expect(messagePreviewText({})).toBe('');
    });
  });

  describe('commitment requests', () => {
    it('maps commitment requests by sender', () => {
      expect(
        messagePreviewText({ type: 'commitment_request', sender_id: 'me' }, { currentUserId: 'me' })
      ).toBe('You requested to be Committed');
      expect(
        messagePreviewText({ type: 'commitment_request', sender_id: 'other' }, { currentUserId: 'me' })
      ).toBe('Requested to be Committed');
    });
  });
});
