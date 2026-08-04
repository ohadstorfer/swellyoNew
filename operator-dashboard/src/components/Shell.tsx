import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';

/** Page frame: brand on the left, who you are on the right. */
export function Shell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();

  return (
    <>
      <header
        style={{
          borderBottom: '1px solid var(--line)',
          background: '#fff',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <div
          className="row-between"
          style={{ maxWidth: 1080, margin: '0 auto', padding: '12px 20px' }}
        >
          <Link to="/trips" className="row" style={{ gap: 9, color: 'var(--text)' }}>
            <span
              aria-hidden
              style={{
                width: 9,
                height: 9,
                borderRadius: 99,
                background: 'var(--cyan)',
                display: 'inline-block',
              }}
            />
            <strong style={{ fontSize: 15 }}>Swellyo Operator</strong>
          </Link>

          {user && (
            <div className="row" style={{ gap: 12 }}>
              <span className="muted small">{user.email}</span>
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
    <div style={{ marginBottom: 20 }}>
      {back && (
        <Link to={back} className="small" style={{ display: 'inline-block', marginBottom: 8 }}>
          ← {backLabel ?? 'Back'}
        </Link>
      )}
      <div className="row-between">
        <div>
          <h1>{title}</h1>
          {sub && (
            <p className="muted small" style={{ marginTop: 3 }}>
              {sub}
            </p>
          )}
        </div>
        {right}
      </div>
    </div>
  );
}
