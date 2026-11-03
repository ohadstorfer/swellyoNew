import { healDeadUploads, isDeadUpload } from '../deadMediaUploads';
import type { Message } from '../messagingService';

const ME = 'me';
const CLIENT_ID = 'client-1';

const makeRow = (over: Partial<Message> = {}): Message =>
  ({
    id: CLIENT_ID,
    client_id: CLIENT_ID,
    conversation_id: 'conv',
    sender_id: ME,
    body: '',
    type: 'image',
    attachments: [],
    is_system: false,
    edited: false,
    deleted: false,
    created_at: '2026-10-30T18:51:01.000Z',
    updated_at: '2026-10-30T18:51:01.000Z',
    upload_state: 'uploading',
    _localPreviewUri: 'file:///photo.jpg',
    ...over,
  }) as Message;

const makeServerRow = (over: Partial<Message> = {}): Message =>
  makeRow({
    id: 'server-1',
    upload_state: undefined,
    _localPreviewUri: undefined,
    image_metadata: { image_url: 'https://s3/original.jpg' } as Message['image_metadata'],
    ...over,
  });

describe('healDeadUploads', () => {
  it('swaps a dead row for the server row when the upload actually landed', () => {
    const server = makeServerRow();
    expect(healDeadUploads([makeRow()], [server], ME, new Set())).toEqual([server]);
  });

  it('marks the row failed and keeps the preview when the server has nothing', () => {
    const [row] = healDeadUploads([makeRow()], [], ME, new Set());
    expect(row.upload_state).toBe('failed');
    expect(row.upload_error).toBe('Upload interrupted');
    expect(row._localPreviewUri).toBe('file:///photo.jpg');
  });

  it('does not accept a server ghost with no media', () => {
    const ghost = makeServerRow({ image_metadata: undefined });
    const [row] = healDeadUploads([makeRow()], [ghost], ME, new Set());
    expect(row.upload_state).toBe('failed');
  });

  it('leaves uploads that are still in flight alone', () => {
    const rows = [makeRow()];
    expect(healDeadUploads(rows, [], ME, new Set([CLIENT_ID]))).toBe(rows);
  });

  it('returns the same array when nothing is dead', () => {
    const rows = [makeServerRow(), makeRow({ upload_state: 'failed' })];
    expect(healDeadUploads(rows, [], ME, new Set())).toBe(rows);
  });
});

describe('isDeadUpload', () => {
  it('ignores media sent by other people', () => {
    expect(isDeadUpload(makeRow({ sender_id: 'other' }), ME, new Set())).toBe(false);
  });

  it('uses storage_path, not video_url, as the video success signal', () => {
    const video = makeRow({
      type: 'video',
      upload_state: undefined,
      video_metadata: { video_url: '', storage_path: 'videos/a.mp4' } as Message['video_metadata'],
    });
    expect(isDeadUpload(video, ME, new Set())).toBe(false);
  });
});
