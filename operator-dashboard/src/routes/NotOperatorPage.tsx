/**
 * You are signed in, but this account neither runs a trip nor works on one.
 *
 * Deliberately a dead end with one way out — sign out. There is no "request
 * access" button because there is no request to make. The two ways in are set
 * elsewhere: `surfers.operator` by a Swellyo admin through
 * `set_operator_status`, and a crew place by the operator inviting you from the
 * app. Inventing a self-serve path here would promise something the product
 * cannot do.
 *
 * It names the account it checked. The most likely reason a real operator lands
 * here is signing in with the wrong Google account, and "you are not an
 * operator" is useless advice if you cannot see WHO you are.
 */
import { useAuth } from '../lib/auth';

export function NotOperatorPage() {
  const { user, signOut } = useAuth();

  return (
    <div
      style={{
        minHeight: '100%',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
      }}
    >
      <div className="card enter" style={{ maxWidth: 380, width: '100%' }}>
        <div className="card-body" style={{ padding: '32px 32px', textAlign: 'center' }}>
          <div
            aria-hidden
            style={{
              width: 12,
              height: 12,
              borderRadius: 999,
              background: 'var(--warn)',
              margin: '0 auto 16px',
            }}
          />
          <h1 style={{ fontSize: 'var(--fs-2xl)', lineHeight: '32px', marginBottom: 8 }}>Nothing to run here</h1>
          <p className="muted small" style={{ marginBottom: 24 }}>
            This site is for people running an operator trip — the operator, or the crew they
            put on it. This account is neither yet.
          </p>

          {user?.email && (
            <p
              className="muted"
              style={{ fontSize: 'var(--fs-s)', lineHeight: '18px', marginBottom: 24, wordBreak: 'break-all' }}
            >
              Signed in as <strong>{user.email}</strong>
            </p>
          )}

          <button
            className="btn"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => void signOut()}
          >
            Sign out
          </button>

          <p className="muted" style={{ fontSize: 'var(--fs-s)', marginTop: 24, lineHeight: '18px' }}>
            If this is wrong, check you used the same account as the Swellyo app,
            or ask Swellyo to turn on operator access.
          </p>
        </div>
      </div>
    </div>
  );
}
