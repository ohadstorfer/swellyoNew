import { messagePreviewText } from '../messagePreviewText';

describe('messagePreviewText', () => {
  it('maps media types to placeholders', () => {
    expect(messagePreviewText({ type: 'image' })).toBe('Image');
    expect(messagePreviewText({ image_metadata: { w: 1 } })).toBe('Image');
    expect(messagePreviewText({ type: 'video' })).toBe('Video');
    expect(messagePreviewText({ video_metadata: {} })).toBe('Video');
    expect(messagePreviewText({ type: 'audio' })).toBe('Voice message');
    expect(messagePreviewText({ audio_metadata: {} })).toBe('Voice message');
  });

  it('maps commitment requests by sender', () => {
    expect(
      messagePreviewText({ type: 'commitment_request', sender_id: 'me' }, { currentUserId: 'me' })
    ).toBe('You requested to be Committed');
    expect(
      messagePreviewText({ type: 'commitment_request', sender_id: 'other' }, { currentUserId: 'me' })
    ).toBe('Requested to be Committed');
  });

  it('falls back to body, then empty string', () => {
    expect(messagePreviewText({ type: 'text', body: 'hola' })).toBe('hola');
    expect(messagePreviewText(null)).toBe('');
    expect(messagePreviewText({})).toBe('');
  });
});
