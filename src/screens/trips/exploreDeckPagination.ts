export type ExploreCursor = { created_at: string; id: string };

/** Cursor for the next page: only when the last page came back FULL (else we're at the end). */
export function nextCursorFrom(
  lastPage: { created_at: string; id: string }[],
  limit: number,
): ExploreCursor | undefined {
  if (lastPage.length !== limit || lastPage.length === 0) return undefined;
  const last = lastPage[lastPage.length - 1];
  return { created_at: last.created_at, id: last.id };
}

/** True when the snapped card index is within 2 of the end (load-more trigger for a snap deck). */
export function isNearEnd(focusedIndex: number, length: number): boolean {
  return length > 0 && focusedIndex >= length - 2;
}

/** True when `next` is `prev` with extra items appended (page load), not a replacement (filter/invalidation). */
export function isAppend(prev: { id: string }[], next: { id: string }[]): boolean {
  if (next.length <= prev.length) return false;
  for (let i = 0; i < prev.length; i++) if (prev[i].id !== next[i].id) return false;
  return true;
}
