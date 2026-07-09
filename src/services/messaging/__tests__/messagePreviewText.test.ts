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
    it('returns the body for text', () => {
      expect(messagePreviewText({ type: 'text', body: 'hola' })).toBe('hola');
    });
    it('returns empty for nothing', () => {
      expect(messagePreviewText(null)).toBe('');
    });
  });
});
