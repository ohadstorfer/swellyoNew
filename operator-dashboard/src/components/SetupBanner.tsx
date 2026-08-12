/**
 * "Finish your setup" — the standing prompt, on every page.
 *
 * The desktop twin of the app's `OperatorSetupBanner`, and the same reasoning:
 *
 * ── On every page, not just Trips ───────────────────────────────────────────
 * It renders inside `Shell`, above the routes. Confining it to one page would
 * hide it from the operator who never visits that page *because* they do not
 * know why their trips cannot be sold.
 *
 * ── Quiet, because it is permanent ──────────────────────────────────────────
 * No dismiss button, and it can sit there for days — Stripe review alone can
 * take that long. Something that shouts every session gets tuned out, so this
 * is the same neutral card the rest of the site uses, with colour spent only on
 * the progress bar.
 *
 * ── It disappears by being finished ─────────────────────────────────────────
 * Not dismissable on purpose: while it shows, the operator cannot sell a trip,
 * and a dismissed banner would bury the only explanation.
 *
 * ── Silent until it is sure ─────────────────────────────────────────────────
 * Renders nothing while loading, so a finished operator never sees a "finish
 * your setup" flash on every page load.
 */
import { Link } from 'react-router-dom';

export function SetupBanner({
  summary,
  done,
  total,
}: {
  /** From `setupSummary` — always names the NEXT step, never a count. */
  summary: string;
  done: number;
  total: number;
}) {
  return (
    <Link
      to="/setup"
      className="enter"
      style={{
        display: 'block',
        textDecoration: 'none',
        color: 'inherit',
        border: '1px solid var(--line)',
        background: 'var(--panel)',
        borderRadius: 'var(--r-lg)',
        padding: '12px 14px',
        marginBottom: 18,
      }}
    >
      <div className="row-between" style={{ gap: 12, marginBottom: 10 }}>
        <div className="row" style={{ gap: 10, alignItems: 'center', minWidth: 0 }}>
          <span
            aria-hidden
            style={{
              width: 28,
              height: 28,
              flex: '0 0 auto',
              borderRadius: 99,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--cyan-tint)',
              fontSize: 14,
            }}
          >
            🚀
          </span>
          <span style={{ minWidth: 0 }}>
            <strong style={{ display: 'block', fontSize: 14.5 }}>Finish your setup</strong>
            {/* Names the next step rather than counting what is left — the bar
                below already answers "how many". */}
            <span
              className="muted small"
              style={{
                display: 'block',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {summary}
            </span>
          </span>
        </div>
        <span className="muted small" style={{ flex: '0 0 auto' }}>{`${done} of ${total}`} →</span>
      </div>

      {/* Segments, not a continuous bar: there are exactly four discrete steps,
          and a smooth bar would imply a percentage of something measurable. */}
      <div className="row" style={{ gap: 4 }} aria-hidden>
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            style={{
              flex: 1,
              height: 3,
              borderRadius: 99,
              background: i < done ? 'var(--cyan)' : 'var(--line-strong)',
            }}
          />
        ))}
      </div>
    </Link>
  );
}
