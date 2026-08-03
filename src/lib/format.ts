/** Small display helpers. No business rules live here. */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-08-02' -> '2 Aug 2026'. Parsed as a plain date, never shifted by timezone. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '—';
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** A trip's date range, collapsing a shared month: '2–14 Aug 2026'. */
export function formatRange(start?: string | null, end?: string | null): string {
  if (!start && !end) return 'Dates not set';
  if (!start) return formatDate(end);
  if (!end) return formatDate(start);
  const [sy, sm, sd] = start.slice(0, 10).split('-').map(Number);
  const [ey, em, ed] = end.slice(0, 10).split('-').map(Number);
  if (sy === ey && sm === em) return `${sd}–${ed} ${MONTHS[sm - 1]} ${sy}`;
  if (sy === ey) return `${sd} ${MONTHS[sm - 1]} – ${ed} ${MONTHS[em - 1]} ${sy}`;
  return `${formatDate(start)} – ${formatDate(end)}`;
}

/** 'Nothing', '1 thing', 'N things' — avoids "1 documents". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function daysUntil(iso: string | null | undefined, today = new Date()): number | null {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  const target = new Date(y, m - 1, d);
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target.getTime() - base.getTime()) / 86_400_000);
}

/** Turn a storage path into something sensible to save on disk. */
export function fileNameFor(path: string | null, fallback: string): string {
  if (!path) return fallback;
  const last = path.split('/').pop() ?? '';
  const ext = last.includes('.') ? last.slice(last.lastIndexOf('.')) : '';
  return `${fallback}${ext}`;
}
