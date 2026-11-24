import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Logo } from './Logo';

/** Page frame: brand on the left, who you are on the right. */
export function Shell({ children }: { children: ReactNode }) {
  const { user, isOperator, signOut } = useAuth();

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/trips" className="brand" aria-label="Swellyo Operator — your trips">
            <Logo size={32} />
            <span className="brand-name">
              Swellyo <span className="brand-sub">Operator</span>
            </span>
          </Link>

          {user && (
            <div className="row" style={{ gap: 8 }}>
              {/* Settings is the operator's own defaults — waiver, cancellation
                  policy, Stripe. Crew have none of that. */}
              {isOperator && (
                <Link to="/settings" className="btn btn-sm btn-ghost">
                  Settings
                </Link>
              )}
              {/* The address is who you are — useful on a desk with two
                  Google accounts, noise on a phone header. */}
              <span className="muted small hide-sm">{user.email}</span>
              <button className="btn btn-sm" onClick={() => void signOut()}>
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="wrap">{children}</main>
    </>
  );
}

/** Back link + title, used at the top of every inner page. */
export function PageHead({
  back,
  backLabel,
  title,
  sub,
  right,
}: {
  back?: string;
  backLabel?: string;
  title: string;
  sub?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div style={{ marginBottom: 24 }}>
      {back && (
        <Link to={back} className="small" style={{ display: 'inline-block', marginBottom: 8 }}>
          ← {backLabel ?? 'Back'}
        </Link>
      )}
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <h1>{title}</h1>
          {sub && (
            <p className="muted small" style={{ marginTop: 4 }}>
              {sub}
            </p>
          )}
        </div>
        {right && <div className="page-head-actions">{right}</div>}
      </div>
    </div>
  );
}
