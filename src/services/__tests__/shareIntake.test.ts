import {
  normalizeStagedPayload,
  setPendingShare,
  consumePendingShare,
  hasPendingShare,
} from '../shareIntake';

const NOW = 1_800_000_000_000;

describe('normalizeStagedPayload', () => {
  it('maps a staged vcard payload to a contact share', () => {
    const p = normalizeStagedPayload(
      {
        version: 1,
        createdAt: new Date(NOW - 1000).toISOString(),
        kind: 'contact',
        vcardRaw: 'BEGIN:VCARD\nVERSION:3.0\nFN:Dana\nTEL:+972521234567\nEND:VCARD',
      },
      NOW,
    );
    expect(p).toEqual({
      kind: 'contact',
      contact: { display_name: 'Dana', phone_numbers: [{ number: '+972521234567' }] },
    });
  });

  it('discards payloads older than 24h', () => {
    const p = normalizeStagedPayload(
      { version: 1, createdAt: new Date(NOW - 25 * 3600_000).toISOString(), kind: 'text', text: 'hi' },
      NOW,
    );
    expect(p).toBeNull();
  });

  it('classifies a bare URL text as url', () => {
    const p = normalizeStagedPayload(
      { version: 1, createdAt: new Date(NOW).toISOString(), kind: 'text', text: ' https://swellyo.com/x ' },
      NOW,
    );
    expect(p).toEqual({ kind: 'url', url: 'https://swellyo.com/x' });
  });

  it('returns null for unparseable vcard, unknown kind, or empty media', () => {
    const base = { version: 1, createdAt: new Date(NOW).toISOString() };
    expect(normalizeStagedPayload({ ...base, kind: 'contact', vcardRaw: 'junk' }, NOW)).toBeNull();
    expect(normalizeStagedPayload({ ...base, kind: 'nope' }, NOW)).toBeNull();
    expect(normalizeStagedPayload({ ...base, kind: 'media', files: [] }, NOW)).toBeNull();
    expect(normalizeStagedPayload(null, NOW)).toBeNull();
  });

  it('maps media files to uri+mimeType', () => {
    const p = normalizeStagedPayload(
      {
        version: 1,
        createdAt: new Date(NOW).toISOString(),
        kind: 'media',
        files: [{ path: '/shared/share/pending/x/a.jpg', mimeType: 'image/jpeg' }],
      },
      NOW,
    );
    expect(p).toEqual({
      kind: 'media',
      files: [{ uri: 'file:///shared/share/pending/x/a.jpg', mimeType: 'image/jpeg' }],
    });
  });

  it('rejects a payload with a missing or unparseable createdAt', () => {
    expect(normalizeStagedPayload({ version: 1, kind: 'text', text: 'hi' }, NOW)).toBeNull();
    expect(
      normalizeStagedPayload({ version: 1, createdAt: 'not-a-date', kind: 'text', text: 'hi' }, NOW),
    ).toBeNull();
  });
});

describe('pending store', () => {
  beforeEach(() => {
    consumePendingShare(); // drain between tests
  });

  it('set → has → consume → empty', () => {
    expect(hasPendingShare()).toBe(false);
    setPendingShare({ kind: 'text', text: 'hi' });
    expect(hasPendingShare()).toBe(true);
    expect(consumePendingShare()).toEqual({ kind: 'text', text: 'hi' });
    expect(hasPendingShare()).toBe(false);
    expect(consumePendingShare()).toBeNull();
  });
});
