/**
 * An error whose message was written for the operator and may be shown as is
 * (upload limits, "pick another place", a refused edit). Everything else still
 * goes through `friendlyError`.
 */
export class SayError extends Error {}

/**
 * The sentence to show for a failed edit.
 *
 * The guards on `group_trips` (capacity floor, dates, money, cancellation
 * policy) `RAISE EXCEPTION` with a sentence meant for people — Postgres code
 * P0001. Those are shown verbatim, the way TripPolicyCard already does: "6
 * people are on this trip" is the whole point of the guard. Anything else is a
 * raw message and gets the friendly fallback.
 */
export function editErrorMessage(e: unknown, friendly: (e: unknown) => string): string {
  if (e instanceof SayError) return e.message;
  const o = e as { code?: unknown; message?: unknown } | null;
  if (o && o.code === 'P0001' && typeof o.message === 'string' && o.message.trim()) return o.message;
  return friendly(e);
}
