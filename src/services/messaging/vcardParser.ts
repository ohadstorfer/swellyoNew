/**
 * vcardParser — maps raw .vcf text (what the OS share sheet actually hands us)
 * onto the existing ContactMetadata shape. Used by the Android share intake and
 * the iOS fallback path; the iOS extension has a Swift twin (VCardMapper.swift)
 * that must produce identical JSON for the fixture corpus in
 * __tests__/fixtures/vcards/.
 *
 * Handles the real-address-book cases: line folding, QUOTED-PRINTABLE (old
 * Android), CHARSET params, item1.-grouped properties with X-ABLabel (iOS),
 * TYPE=CELL,VOICE multi-token labels, FN absent (compose from N), multiple
 * VCARD blocks. Never throws — a malformed card returns null/[].
 */

import type { ContactMetadata } from './messagingService';

interface VLine {
  group?: string; // "item1" of "item1.TEL;..."
  name: string; // "TEL"
  params: Record<string, string[]>; // upper-cased keys; bare params land in TYPE
  value: string; // decoded value
}

export function parseVCards(raw: string): ContactMetadata[] {
  try {
    const blocks = splitCards(unfold(raw ?? ''));
    const out: ContactMetadata[] = [];
    for (const block of blocks) {
      const c = cardToMetadata(block);
      if (c) out.push(c);
    }
    return out;
  } catch {
    return [];
  }
}

export function parseVCard(raw: string): ContactMetadata | null {
  return parseVCards(raw)[0] ?? null;
}

/** RFC 6350 unfolding: a newline followed by ONE space/tab continues the line. */
function unfold(raw: string): string[] {
  const lines = raw.split(/\r\n|\r|\n/);
  const out: string[] = [];
  for (const line of lines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

function splitCards(lines: string[]): VLine[][] {
  const cards: VLine[][] = [];
  let current: VLine[] | null = null;
  let pendingQP: VLine | null = null; // QP soft-break continuation target

  for (const rawLine of lines) {
    // QUOTED-PRINTABLE soft line break: the encoded value ended with '=' and the
    // next physical line continues it. vCard 2.1 only — folding rules don't apply.
    if (pendingQP) {
      const softBreak = rawLine.endsWith('=');
      pendingQP.value += decodeQP(softBreak ? rawLine.slice(0, -1) : rawLine);
      if (!softBreak) pendingQP = null;
      continue;
    }

    const line = parseLine(rawLine);
    if (!line) continue;

    if (line.name === 'BEGIN' && line.value.toUpperCase() === 'VCARD') {
      current = [];
      continue;
    }
    if (line.name === 'END' && line.value.toUpperCase() === 'VCARD') {
      if (current) cards.push(current);
      current = null;
      continue;
    }
    if (!current) continue;

    const isQP = (line.params.ENCODING ?? []).includes('QUOTED-PRINTABLE');
    if (isQP) {
      const softBreak = line.value.endsWith('=');
      line.value = decodeQP(softBreak ? line.value.slice(0, -1) : line.value);
      if (softBreak) pendingQP = line;
    }
    current.push(line);
  }
  return cards;
}

function parseLine(raw: string): VLine | null {
  const colon = raw.indexOf(':');
  if (colon < 0) return null;
  const head = raw.slice(0, colon);
  const value = raw.slice(colon + 1);

  const segs = head.split(';');
  let nameSeg = segs[0] ?? '';
  let group: string | undefined;
  const dot = nameSeg.indexOf('.');
  if (dot > 0) {
    group = nameSeg.slice(0, dot);
    nameSeg = nameSeg.slice(dot + 1);
  }
  const name = nameSeg.toUpperCase().trim();
  if (!name) return null;

  const params: Record<string, string[]> = {};
  for (const seg of segs.slice(1)) {
    const eq = seg.indexOf('=');
    const key = (eq >= 0 ? seg.slice(0, eq) : 'TYPE').toUpperCase().trim();
    const val = (eq >= 0 ? seg.slice(eq + 1) : seg).trim();
    if (!val) continue;
    const tokens = val
      .split(',')
      .map(v => v.trim().toUpperCase())
      .filter(Boolean);
    (params[key] ??= []).push(...tokens);
  }

  return { group, name, params, value };
}

/** Quoted-printable decode, assuming UTF-8 (the only charset seen in the wild here). */
function decodeQP(s: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '=') {
      const hex = s.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 2;
        continue;
      }
    }
    const code = s.charCodeAt(i);
    // Literal non-ASCII shouldn't appear in a QP value, but if it does, pass the
    // UTF-8 bytes through rather than truncating to a single byte.
    if (code < 0x80) {
      bytes.push(code);
    } else {
      for (const b of utf8Bytes(s[i])) bytes.push(b);
    }
  }
  try {
    // TextDecoder exists in Hermes (RN >= 0.71) and in jest-expo's node env.
    return new TextDecoder('utf-8').decode(Uint8Array.from(bytes));
  } catch {
    return s;
  }
}

function utf8Bytes(ch: string): number[] {
  try {
    return Array.from(new TextEncoder().encode(ch));
  } catch {
    return [ch.charCodeAt(0) & 0xff];
  }
}

function cardToMetadata(lines: VLine[]): ContactMetadata | null {
  // iOS emits `item1.TEL:…` + `item1.X-ABLabel:Mobile` — the label lives on a
  // sibling line sharing the group prefix.
  const labelByGroup = new Map<string, string>();
  for (const l of lines) {
    if (l.name === 'X-ABLABEL' && l.group) {
      labelByGroup.set(l.group, unescapeValue(l.value).replace(/^_\$!<|>!\$_$/g, ''));
    }
  }

  const labelFor = (l: VLine): string | undefined => {
    if (l.group && labelByGroup.has(l.group)) return labelByGroup.get(l.group);
    const types = (l.params.TYPE ?? []).filter(t => !['PREF', 'VOICE', 'INTERNET'].includes(t));
    return types[0];
  };

  const phone_numbers = lines
    .filter(l => l.name === 'TEL')
    .map(l => ({ label: labelFor(l), number: unescapeValue(l.value).trim() }))
    .filter(p => p.number.length > 0)
    .map(p => (p.label ? p : { number: p.number }));

  const emails = lines
    .filter(l => l.name === 'EMAIL')
    .map(l => ({ label: labelFor(l), email: unescapeValue(l.value).trim() }))
    .filter(e => e.email.length > 0)
    .map(e => (e.label ? e : { email: e.email }));

  if (phone_numbers.length === 0 && emails.length === 0) return null;

  const fn = lines.find(l => l.name === 'FN');
  let display_name = fn ? unescapeValue(fn.value).trim() : '';
  if (!display_name) {
    const n = lines.find(l => l.name === 'N');
    if (n) {
      // N is family;given;middle;prefix;suffix — display prefix given middle family suffix
      const [family, given, middle, prefix, suffix] = n.value
        .split(';')
        .map(part => unescapeValue(part).trim());
      display_name = [prefix, given, middle, family, suffix].filter(Boolean).join(' ');
    }
  }
  if (!display_name) display_name = 'Contact';

  return { display_name, phone_numbers, ...(emails.length ? { emails } : {}) };
}

/** vCard value unescaping: \n, \, \; \\ */
function unescapeValue(v: string): string {
  return v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}
