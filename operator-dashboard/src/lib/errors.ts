/**
 * Turn any thrown thing into a sentence a person can act on.
 *
 * Raw error text is never shown. Supabase messages say things like
 * "JWT expired" or "new row violates row-level security policy", which tell
 * the operator nothing and look like a crash.
 */
export function friendlyError(e: unknown): string {
  const raw = messageOf(e).toLowerCase();

  if (!raw) return 'Something went wrong. Please try again.';

  if (raw.includes('failed to fetch') || raw.includes('networkerror') || raw.includes('load failed')) {
    return 'Cannot reach Swellyo. Check your internet connection and try again.';
  }
  if (raw.includes('jwt expired') || raw.includes('token is expired') || raw.includes('refresh_token')) {
    return 'Your session has ended. Please sign in again.';
  }
  if (raw.includes('row-level security') || raw.includes('not your trip') || raw.includes('permission denied')) {
    return 'You do not have access to this trip.';
  }
  if (raw.includes('not found') || raw.includes('pgrst116')) {
    return 'That item no longer exists. It may have been removed.';
  }
  if (raw.includes('object not found') || raw.includes('the resource was not found')) {
    return 'That file is no longer stored. It may have passed the 30-day limit.';
  }
  if (raw.includes('rate limit') || raw.includes('too many')) {
    return 'Too many requests. Wait a moment and try again.';
  }

  return 'Something went wrong. Please try again.';
}

function messageOf(e: unknown): string {
  if (!e) return '';
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message;
  if (typeof e === 'object') {
    const o = e as Record<string, unknown>;
    return [o.message, o.error_description, o.details, o.hint, o.code]
      .filter(v => typeof v === 'string')
      .join(' ');
  }
  return '';
}
