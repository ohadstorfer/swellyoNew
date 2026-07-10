import * as fs from 'fs';
import * as path from 'path';
import { parseVCard, parseVCards } from '../vcardParser';

const fixture = (name: string) =>
  fs.readFileSync(path.join(__dirname, 'fixtures', 'vcards', name), 'utf8');

describe('parseVCard', () => {
  it('parses an iOS export with grouped properties and labels', () => {
    const c = parseVCard(fixture('ios-basic.vcf'))!;
    expect(c.display_name).toBe('Dana Cohen');
    expect(c.phone_numbers).toEqual([
      { label: 'Mobile', number: '+972 52-123-4567' },
      { label: 'HOME', number: '03-555-1234' },
    ]);
    expect(c.emails).toEqual([{ label: 'Work', email: 'dana@example.com' }]);
  });

  it('decodes quoted-printable with soft line breaks and composes name from N', () => {
    const c = parseVCard(fixture('android-quoted-printable.vcf'))!;
    expect(c.display_name).toBe('דנה כהן'); // N is family;given → "given family"
    expect(c.phone_numbers).toEqual([{ label: 'CELL', number: '+972521234567' }]);
  });

  it('composes display_name from N when FN is absent', () => {
    const c = parseVCard(fixture('no-fn.vcf'))!;
    expect(c.display_name).toBe('Dr. Big Wave Surfer Jr.');
    expect(c.phone_numbers[0]).toEqual({ label: 'CELL', number: '+61 400 000 000' });
  });

  it('unfolds folded lines', () => {
    const c = parseVCard(fixture('folded-line.vcf'))!;
    expect(c.display_name).toBe('Someone With A Very Long Name');
  });

  it('returns the first card from a multi-card file; parseVCards returns all', () => {
    expect(parseVCard(fixture('multi-card.vcf'))!.display_name).toBe('First Person');
    expect(parseVCards(fixture('multi-card.vcf'))).toHaveLength(2);
  });

  it('rejects a card with no phone and no email', () => {
    expect(parseVCard(fixture('no-phone-no-email.vcf'))).toBeNull();
  });

  it('accepts an emails-only card', () => {
    const c = parseVCard(fixture('emails-only.vcf'))!;
    expect(c.phone_numbers).toEqual([]);
    expect(c.emails).toEqual([{ label: 'WORK', email: 'mail@example.com' }]);
  });

  it('never throws on garbage', () => {
    expect(parseVCard('')).toBeNull();
    expect(parseVCard('BEGIN:VCARD\nEND:VCARD')).toBeNull();
    expect(parseVCard('not a vcard at all  �')).toBeNull();
  });
});
