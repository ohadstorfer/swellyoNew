import { buildSnippet } from '../messageSearch';

const joined = (parts: { text: string }[]) => parts.map(p => p.text).join('');

describe('buildSnippet', () => {
  it('bolds the match in a short body without ellipses', () => {
    const parts = buildSnippet('see you at the beach', 'beach');
    expect(parts).toEqual([
      { text: 'see you at the ', match: false },
      { text: 'beach', match: true },
    ]);
  });

  it('is case-insensitive', () => {
    const parts = buildSnippet('Surf Board for sale', 'board');
    expect(parts.find(p => p.match)?.text).toBe('Board');
  });

  it('ellipsizes both sides of a match deep inside a long body', () => {
    const body = 'a'.repeat(100) + ' needle ' + 'b'.repeat(100);
    const parts = buildSnippet(body, 'needle');
    expect(parts[0].text.startsWith('…')).toBe(true);
    expect(parts[parts.length - 1].text.endsWith('…')).toBe(true);
    expect(parts.find(p => p.match)?.text).toBe('needle');
    expect(joined(parts).length).toBeLessThan(body.length);
  });

  it('does not lead with an ellipsis when the match is at the start', () => {
    const body = 'needle ' + 'x'.repeat(100);
    const parts = buildSnippet(body, 'needle');
    expect(parts[0]).toEqual({ text: 'needle', match: true });
  });

  it('falls back to the head of the body when the query is absent', () => {
    const body = 'z'.repeat(200);
    const parts = buildSnippet(body, 'missing');
    expect(parts).toHaveLength(1);
    expect(parts[0].match).toBe(false);
    expect(parts[0].text.endsWith('…')).toBe(true);
  });

  it('matches Hebrew text', () => {
    const parts = buildSnippet('נתראה בחוף מחר בבוקר', 'בחוף');
    expect(parts.find(p => p.match)?.text).toBe('בחוף');
  });

  it('collapses newlines/whitespace into single spaces', () => {
    const parts = buildSnippet('line one\n\nline   two beach', 'beach');
    expect(joined(parts)).toBe('line one line two beach');
  });
});
