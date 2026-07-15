import { describeAlbum } from '../mediaAlbums';
import type { Message } from '../../services/messaging/messagingService';

const img = (): Message => ({ id: 'i', conversation_id: 'c', sender_id: 's', type: 'image' } as Message);
const vid = (): Message => ({ id: 'v', conversation_id: 'c', sender_id: 's', type: 'video' } as Message);
// video detected via metadata even when type is missing
const vidMeta = (): Message =>
  ({ id: 'v2', conversation_id: 'c', sender_id: 's', video_metadata: { thumbnail_url: 'x' } } as unknown as Message);

describe('describeAlbum', () => {
  it('counts all photos', () => {
    expect(describeAlbum([img(), img(), img(), img()])).toBe('4 photos');
  });
  it('counts all videos', () => {
    expect(describeAlbum([vid(), vid(), vid()])).toBe('3 videos');
  });
  it('detects videos by metadata', () => {
    expect(describeAlbum([vidMeta(), vidMeta()])).toBe('2 videos');
  });
  it('formats mixed', () => {
    expect(describeAlbum([img(), img(), img(), img(), vid(), vid()])).toBe('4 photos, 2 videos');
  });
  it('is singular-aware in a mixed set', () => {
    expect(describeAlbum([img(), vid()])).toBe('1 photo, 1 video');
  });
});
