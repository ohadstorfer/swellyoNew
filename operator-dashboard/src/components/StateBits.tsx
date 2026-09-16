import type { ReactNode } from 'react';
import { friendlyError } from '../lib/errors';
import { STATE_LABEL, type RequirementState } from '../domain/requirements';

export function Spinner() {
  return <div className="spinner" role="status" aria-label="Loading" />;
}

export function Loading({ what = 'Loading' }: { what?: string }) {
  return (
    <div className="row" style={{ padding: '32px 0', gap: 12 }}>
      <Spinner />
      <span className="muted">{what}…</span>
    </div>
  );
}

/**
 * A read failed.
 *
 * `what` names the thing that failed — "This trip", "The money". Test W-10
 * asks that the page say WHAT failed, and "That did not load" over a generic
 * "Something went wrong" told the operator nothing about which of the five
 * reads on the page had broken. Optional so nothing that has not been updated
 * reads worse than before.
 */
export function ErrorBox({
  error,
  onRetry,
  what,
}: {
  error: unknown;
  onRetry?: () => void;
  what?: string;
}) {
  return (
    <div className="card enter" style={{ borderColor: 'var(--danger)' }}>
      <div className="card-body">
        <h3 style={{ marginBottom: 8 }}>{what ? `${what} did not load` : 'That did not load'}</h3>
        <p className="muted small" style={{ marginBottom: onRetry ? 12 : 0 }}>
          {friendlyError(error)}
        </p>
        {onRetry && (
          <button className="btn btn-sm" onClick={onRetry}>
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Somebody on the crew, below Manager, reached a paperwork page.
 *
 * One component because four pages need the same sentence. It started inline
 * on TripPage only, so a Guide who typed a traveler's URL got "That person is
 * not on this trip" instead — about a traveler who IS on it. The roster read is
 * refused to them, the page found nobody, and reported that as a fact about the
 * traveler. Found 9 Sep 2026. Not a security boundary: every read behind these
 * pages is already refused by the database. This just says so in words.
 */
export function NoPaperworkAccess() {
  return (
    <div className="card">
      <div className="card-body">
        <p>You're on this trip's crew, but not for the paperwork.</p>
        <p className="muted small" style={{ marginTop: 8 }}>
          Reviewing documents needs the Manager tier. Everything you can do on this trip is in
          the Swellyo app — ask the operator if you think this is wrong.
        </p>
      </div>
    </div>
  );
}

export function Empty({ title, note }: { title: string; note?: ReactNode }) {
  return (
    <div className="card enter">
      <div className="card-body" style={{ padding: '40px 16px', textAlign: 'center' }}>
        <h3 style={{ marginBottom: 8 }}>{title}</h3>
        {note && <p className="muted small">{note}</p>}
      </div>
    </div>
  );
}

/**
 * Profile photo, or the first letter when there is none.
 *
 * A letter rather than a silhouette: on a list of eight people the silhouettes
 * are identical and the letters are not, so the fallback still helps you find
 * the row you came for.
 */
export function Avatar({ url, name, size = 34 }: { url: string | null; name: string; size?: number }) {
  const box = { width: size, height: size, borderRadius: 999, flexShrink: 0 } as const;

  if (url) return <img src={url} alt="" style={{ ...box, objectFit: 'cover' }} />;

  return (
    <span
      aria-hidden
      style={{
        ...box,
        display: 'grid',
        placeItems: 'center',
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        color: 'var(--muted)',
        fontSize: Math.round(size * 0.38),
        fontWeight: 600,
      }}
    >
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}

const STATE_TAG: Record<RequirementState, string> = {
  approved: 'tag-ok',
  submitted: 'tag-wait',
  rejected: 'tag-danger',
  overdue: 'tag-warn',
  not_started: 'tag-idle',
};

export function StateTag({ state }: { state: RequirementState }) {
  return <span className={`tag ${STATE_TAG[state]}`}>{STATE_LABEL[state]}</span>;
}

/**
 * Received and approved, always together.
 *
 * Showing only "approved" would make the operator's own review backlog look
 * like a traveler problem. The gap is the point.
 */
export function CountPair({
  received,
  approved,
  expected,
  late = 0,
}: {
  received: number;
  approved: number;
  expected: number;
  /**
   * How many travelers are past this deadline.
   *
   * NOT the complement of `received`: a rejected upload past its due date
   * counts here and in neither of the other two. Zero is not printed — "0 late"
   * is not information, it is noise beside the counts that are.
   */
  late?: number;
}) {
  return (
    <span>
      <strong>
        {received}/{expected} in
      </strong>
      <span className="muted"> · {approved}/{expected} approved</span>
      {late > 0 && <span style={{ color: 'var(--danger)' }}> · {late} late</span>}
    </span>
  );
}
