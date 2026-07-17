import { uploadVideoWithOptionalThumbnail } from '../videoSendOrchestration';

describe('uploadVideoWithOptionalThumbnail', () => {
  const createVideoMessage = jest.fn(async (thumbnailUrl: string) => ({
    id: 'server-message',
    upload_state: 'sent',
    thumbnailUrl,
  }));

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    createVideoMessage.mockClear();
  });

  afterEach(() => jest.restoreAllMocks());

  it('allows message creation when the required video succeeds but the thumbnail fails', async () => {
    const { uploadResult, thumbnailUrl } = await uploadVideoWithOptionalThumbnail(
      Promise.resolve({ s3Key: 'video-key' }),
      Promise.reject(new Error('thumbnail unavailable')),
      1_000,
    );

    const created = await createVideoMessage(thumbnailUrl);

    expect(uploadResult).toEqual({ s3Key: 'video-key' });
    expect(created).toEqual({ id: 'server-message', upload_state: 'sent', thumbnailUrl: '' });
    expect(createVideoMessage).toHaveBeenCalledWith('');
  });

  it('rejects when the required video upload fails, so callers keep the optimistic row failed', async () => {
    await expect(uploadVideoWithOptionalThumbnail(
      Promise.reject(new Error('video PUT failed')),
      Promise.resolve('https://thumbnail.example/poster.jpg'),
      1_000,
    )).rejects.toThrow('video PUT failed');
  });

  it('uses the distinct video PUT timeout label', async () => {
    jest.useFakeTimers();
    const result = uploadVideoWithOptionalThumbnail(
      new Promise(() => {}),
      Promise.resolve(''),
      25,
    );

    const assertion = expect(result).rejects.toThrow('video-s3-upload timed out after 25ms');
    await jest.advanceTimersByTimeAsync(25);
    await assertion;
    jest.useRealTimers();
  });

  it('uses the distinct thumbnail timeout label but resolves without a poster', async () => {
    jest.useFakeTimers();
    const result = uploadVideoWithOptionalThumbnail(
      Promise.resolve({ s3Key: 'video-key' }),
      new Promise(() => {}),
      1_000,
      25,
    );

    await jest.advanceTimersByTimeAsync(25);
    await expect(result).resolves.toEqual({ uploadResult: { s3Key: 'video-key' }, thumbnailUrl: '' });
    // The stage and its result live IN the message, not in an object arg — log
    // collectors drop object payloads, and two identical "upload stage" lines
    // gave no way to tell which upload settled or whether it passed.
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('video-thumbnail-upload FAILED'),
    );
    jest.useRealTimers();
  });
});
