/**
 * Pure helpers for message search.
 *
 * Wildcard escaping happens SERVER-SIDE in the search_messages RPC (so the
 * client sends the raw trimmed query) — these helpers only cover the
 * client-rendered snippet around a match.
 */

export interface SnippetPart {
  text: string;
  match: boolean;
}

/**
 * Build a display snippet for a message body: centers the first
 * case-insensitive occurrence of `query`, ellipsizing both sides so long
 * messages stay one-line-ish. If the query doesn't occur (e.g. the DB matched
 * differently than our simple scan), returns the head of the body unmatched.
 */
export function buildSnippet(body: string, query: string, radius: number = 40): SnippetPart[] {
  const normalizedBody = body.replace(/\s+/g, ' ').trim();
  const q = query.trim();
  if (!q) return [{ text: truncateEnd(normalizedBody, radius * 2), match: false }];

  const idx = normalizedBody.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) {
    return [{ text: truncateEnd(normalizedBody, radius * 2), match: false }];
  }

  const matchEnd = idx + q.length;
  const start = Math.max(0, idx - radius);
  const end = Math.min(normalizedBody.length, matchEnd + radius);

  const parts: SnippetPart[] = [];
  const prefix = (start > 0 ? '…' : '') + normalizedBody.slice(start, idx);
  if (prefix) parts.push({ text: prefix, match: false });
  parts.push({ text: normalizedBody.slice(idx, matchEnd), match: true });
  const suffix = normalizedBody.slice(matchEnd, end) + (end < normalizedBody.length ? '…' : '');
  if (suffix) parts.push({ text: suffix, match: false });
  return parts;
}

function truncateEnd(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + '…';
}
