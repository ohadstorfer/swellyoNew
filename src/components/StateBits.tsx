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

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="card enter" style={{ borderColor: 'var(--danger)' }}>
      <div className="card-body">
        <h3 style={{ marginBottom: 6 }}>That did not load</h3>
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

export function Empty({ title, note }: { title: string; note?: ReactNode }) {
  return (
    <div className="card enter">
      <div className="card-body" style={{ padding: '40px 16px', textAlign: 'center' }}>
        <h3 style={{ marginBottom: 6 }}>{title}</h3>
        {note && <p className="muted small">{note}</p>}
      </div>
    </div>
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
}: {
  received: number;
  approved: number;
  expected: number;
}) {
  return (
    <span>
      <strong>
        {received}/{expected} in
      </strong>
      <span className="muted"> · {approved}/{expected} approved</span>
    </span>
  );
}
