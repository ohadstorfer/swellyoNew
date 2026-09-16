import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { friendlyError } from '../lib/errors';
import { Spinner } from '../components/StateBits';

export function LoginPage() {
  const { signIn } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      await signIn();
    } catch (e) {
      setError(friendlyError(e));
      setBusy(false);
    }
  }

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
              background: 'var(--cyan)',
              margin: '0 auto 16px',
            }}
          />
          <h1 style={{ fontSize: 'var(--fs-2xl)', lineHeight: '32px', marginBottom: 8 }}>Swellyo Operator</h1>
          <p className="muted small" style={{ marginBottom: 24 }}>
            Review documents and export files for your trips.
          </p>

          <button
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => void go()}
            disabled={busy}
          >
            {busy ? <Spinner /> : null}
            {busy ? 'Opening Google…' : 'Continue with Google'}
          </button>

          {error && (
            <p className="small" style={{ color: 'var(--danger)', marginTop: 16 }}>
              {error}
            </p>
          )}

          <p className="muted" style={{ fontSize: 'var(--fs-s)', marginTop: 24, lineHeight: '18px' }}>
            Use the same account you use in the Swellyo app.
          </p>
        </div>
      </div>
    </div>
  );
}
