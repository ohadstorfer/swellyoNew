// The rung arithmetic, alone in a file so it can be tested without booting the
// scanner. `index.ts` calls `serve()` at module load, so anything left in there
// cannot be imported by a test.
//
// The ladder: 4 hours, 24 hours, then every 24 hours, with no last rung. See
// index.ts for why it repeats and what stops it.

export const FIRST_NUDGE_HOURS = 4;

/**
 * Which rung is due at `stalledHours`, or null if none is yet.
 *
 * 0 is the four-hour nudge; n>=1 is day n. Derived from the stall itself rather
 * than from when we last sent, so it cannot drift and cannot double up: someone
 * who first appears already 8 days stale is at stage 8 and gets ONE message,
 * not eight on eight consecutive runs. Same reasoning as the old ladder's "last
 * threshold passed, not the first", generalised to a ladder with no top.
 */
export function dueStage(stalledHours: number): number | null {
  if (stalledHours >= 24) return Math.floor(stalledHours / 24);
  if (stalledHours >= FIRST_NUDGE_HOURS) return 0;
  return null;
}

/** What the push copy switches on. See dispatch-notification-queue/render.ts. */
export function stageKey(stage: number): string {
  if (stage === 0) return "4h";
  if (stage === 1) return "24h";
  return "repeat";
}

/**
 * The rung we last sent, as far as it still counts.
 *
 * A stage is only meaningful while its anchor matches the traveler's last
 * action. Someone who uploaded a document on day 3 is back at zero, and the
 * stage 3 we stored must not swallow their next 4-hour nudge — without this,
 * one late upload buys permanent silence. Returns -1 for "nothing counts",
 * which is below every real rung including 0.
 */
export function effectiveLastStage(
  storedStage: number | null | undefined,
  storedAnchor: string | null | undefined,
  lastActivityAt: string,
): number {
  if (storedAnchor == null || typeof storedStage !== "number") return -1;
  const sameClock =
    new Date(storedAnchor).getTime() === new Date(lastActivityAt).getTime();
  return sameClock ? storedStage : -1;
}
