import { sanitizeMessage, sanitizeMessages } from '../messageSanitizer';

describe('sanitizeMessage', () => {
  const valid = {
    id: 'm1',
    conversation_id: 'c1',
    sender_id: 'u1',
    created_at: '2026-06-17T00:00:00.000Z',
    type: 'text',
    body: 'hi',
  };

  it('returns the message when all required fields are present', () => {
    expect(sanitizeMessage(valid)).toEqual(valid);
  });

  it('returns null when a required field is missing', () => {
    expect(sanitizeMessage({ ...valid, id: undefined })).toBeNull();
    expect(sanitizeMessage({ ...valid, conversation_id: null })).toBeNull();
    expect(sanitizeMessage({ ...valid, created_at: '' })).toBeNull();
    expect(sanitizeMessage({ ...valid, type: undefined })).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(sanitizeMessage(null)).toBeNull();
    expect(sanitizeMessage(undefined)).toBeNull();
    expect(sanitizeMessage('nope')).toBeNull();
  });

  it('drops invalid rows from an array and keeps valid ones', () => {
    const out = sanitizeMessages([valid, { ...valid, id: undefined }, { ...valid, id: 'm2' }]);
    expect(out.map(m => m.id)).toEqual(['m1', 'm2']);
  });

  it('returns [] for non-array input', () => {
    expect(sanitizeMessages(null as any)).toEqual([]);
  });
});
