/**
 * You are signed in, but this account is not an operator.
 *
 * Deliberately a dead end with one way out — sign out. There is no "request
 * access" button because there is no request to make: `surfers.operator` is set
 * by a Swellyo admin through `set_operator_status`, and inventing a self-serve
 * path here would promise something the product cannot do yet.
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
        <div className="card-body" style={{ padding: '32px 28px', textAlign: 'center' }}>
          <div
            aria-hidden
            style={{
              width: 12,
              height: 12,
              borderRadius: 99,
              background: 'var(--warn, #E0A94A)',
              margin: '0 auto 18px',
            }}
          />
          <h1 style={{ fontSize: 21, marginBottom: 6 }}>Not an operator account</h1>
          <p className="muted small" style={{ marginBottom: 20, lineHeight: 1.5 }}>
            This site is for trip operators. Your Swellyo account does not have
            operator access yet.
          </p>

          {user?.email && (
            <p
              className="muted"
              style={{ fontSize: 12, marginBottom: 20, wordBreak: 'break-all' }}
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

          <p className="muted" style={{ fontSize: 12, marginTop: 20, lineHeight: 1.5 }}>
            If this is wrong, check you used the same account as the Swellyo app,
            or ask Swellyo to turn on operator access.
          </p>
        </div>
      </div>
    </div>
  );
}
