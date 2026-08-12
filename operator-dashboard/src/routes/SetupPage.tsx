/**
 * Operator setup — the four things settled once, before selling a trip.
 *
 * The same concept as the app's `OperatorSetupScreen`, and the same rule
 * (`domain/operatorSetup.ts`), with one unavoidable difference:
 *
 * ── STRIPE CANNOT BE FINISHED HERE ──────────────────────────────────────────
 * Connect onboarding needs the Stripe secret key and lives behind an edge
 * function the app calls. A second entry point would mean two paths to keep in
 * step with Stripe's six states. So step 1 REPORTS and points at the app — it
 * is the one step this page cannot complete, and it says so plainly rather than
 * offering a button that cannot work.
 *
 * ── A CHECKLIST, NOT A WIZARD ───────────────────────────────────────────────
 * The steps are independent, Stripe can take days, and an operator will leave
 * and come back. A checklist reopens showing what is left; a wizard reopens
 * asking where they were.
 *
 * ── Confirming is the point, not changing ───────────────────────────────────
 * Currency and policy arrive with working defaults, so both steps can be
 * finished without altering anything. That is expected — what setup asks is
 * that they LOOKED. Hence "Use USD" rather than a disabled button waiting for a
 * change that may never be needed.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHead } from '../components/Shell';
import { ErrorBox, Loading } from '../components/StateBits';
import { useAuth } from '../lib/auth';
import { friendlyError } from '../lib/errors';
import {
  EMPTY_SETTINGS,
  fetchOperatorSettings,
  fetchPayoutState,
  saveOperatorSettings,
  uploadDefaultWaiver,
  uploadOperatorInsurance,
  CURRENCIES,
  type OperatorSettings,
  type PayoutState,
} from '../services/settings';
import {
  operatorSetupSteps,
  isOperatorSetupComplete,
  OPERATOR_TERMS_VERSION,
  type SetupStep,
  type SetupStepKey,
} from '../domain/operatorSetup';
import { PRESET_LABEL, summarise } from '../domain/cancellation';

const NO_PAYOUT: PayoutState = {
  hasAccount: false,
  chargesEnabled: false,
  payoutsEnabled: false,
  detailsSubmitted: false,
};

export function SetupPage() {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [settings, setSettings] = useState<OperatorSettings>(EMPTY_SETTINGS);
  const [payout, setPayout] = useState<PayoutState>(NO_PAYOUT);
  const [busy, setBusy] = useState<SetupStepKey | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);
  const [termsChecked, setTermsChecked] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const insuranceRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const [s, p] = await Promise.all([
        fetchOperatorSettings(userId),
        // A missing payout row is a normal state, not a failure to load the
        // page — never let it take the whole screen down.
        fetchPayoutState(userId).catch(() => null),
      ]);
      setSettings(s);
      setPayout(p ?? NO_PAYOUT);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const steps = operatorSetupSteps({ payout, settings });
  const byKey = Object.fromEntries(steps.map(s => [s.key, s])) as Record<SetupStepKey, SetupStep>;
  const done = steps.filter(s => s.done).length;
  const complete = isOperatorSetupComplete({ payout, settings });

  const run = async (key: SetupStepKey, fn: () => Promise<void>) => {
    if (!userId) return;
    setBusy(key);
    setStepError(null);
    try {
      await fn();
      setSettings(await fetchOperatorSettings(userId));
    } catch (e) {
      setStepError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  };

  const confirmCurrency = () =>
    run('currency', () => saveOperatorSettings(userId!, { confirmCurrency: true }));

  const chooseCurrency = (next: string) =>
    run('currency', () =>
      saveOperatorSettings(userId!, {
        defaultCurrency: next || null,
        confirmCurrency: true,
      }),
    );

  const confirmPolicy = () =>
    run('policy', () => saveOperatorSettings(userId!, { confirmPolicy: true }));

  const onWaiverPicked = (file: File | undefined) => {
    if (!file) return;
    void run('waiver', async () => {
      const stored = await uploadDefaultWaiver(
        userId!,
        file,
        settings.defaultWaiver?.path ?? null,
      );
      await saveOperatorSettings(userId!, { defaultWaiver: stored });
    });
  };

  const onInsurancePicked = (file: File | undefined) => {
    if (!file) return;
    void run('insurance', async () => {
      const stored = await uploadOperatorInsurance(
        userId!,
        file,
        settings.insurance?.path ?? null,
      );
      await saveOperatorSettings(userId!, { insurance: stored });
    });
  };

  const acceptTerms = () =>
    run('terms', () =>
      saveOperatorSettings(userId!, { acceptTermsVersion: OPERATOR_TERMS_VERSION }),
    );

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={load} />;

  return (
    <>
      <PageHead
        back="/trips"
        backLabel="Trips"
        title="Set up"
        sub={
          complete
            ? 'You are all set. You can change any of this in Settings.'
            : 'Four things, once. Then you can create trips people pay for.'
        }
        right={
          <span className={complete ? 'tag tag-ok' : 'tag tag-wait'}>
            {complete ? 'All done' : `${done} of ${steps.length} done`}
          </span>
        }
      />

      {stepError && (
        <p className="small" style={{ color: 'var(--danger)', marginBottom: 12 }}>{stepError}</p>
      )}

      {/* ── 1. Stripe — reported, not run ──────────────────────────────── */}
      <StepCard n={1} step={byKey.stripe}>
        <p className="muted small" style={{ marginBottom: 10 }}>
          {byKey.stripe.done
            ? byKey.stripe.pending
              ? 'Stripe has your details and is checking them. Nothing for you to do.'
              : 'Stripe can take payments for your trips.'
            : 'Travelers cannot pay you until this is connected.'}
        </p>
        {/* No button. Stripe's forms are inside the phone app, and a button here
            could only ever open something that does not exist on desktop. */}
        <p className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
          This is the one step you finish in the <strong>Swellyo app</strong>, under
          Settings → Payments. Stripe's forms are built into the app, so they
          cannot run on this site.
        </p>
      </StepCard>

      {/* ── 2. Currency ───────────────────────────────────────────────── */}
      <StepCard n={2} step={byKey.currency}>
        <p style={{ marginBottom: 10 }}>
          <strong>{settings.defaultCurrency ?? 'Automatic — follows your country'}</strong>
        </p>
        <p className="muted small" style={{ marginBottom: 12 }}>
          The currency you type prices in. Travelers still see their own, and you
          are always paid in US dollars.
        </p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {/* Same inline style as the Settings page's picker — there is no
              `.input` class in this project, and inventing one for a single
              control would leave two ways to draw a select. */}
          <select
            value={settings.defaultCurrency ?? ''}
            onChange={e => chooseCurrency(e.target.value)}
            disabled={busy === 'currency'}
            aria-label="Price currency"
            style={{
              padding: '9px 12px',
              borderRadius: 8,
              border: '1px solid var(--line)',
              background: '#fff',
              fontSize: 14,
              minWidth: 220,
            }}
          >
            <option value="">Follow my country</option>
            {CURRENCIES.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          {!byKey.currency.done && (
            <button
              className="btn btn-primary"
              onClick={confirmCurrency}
              disabled={busy === 'currency'}
            >
              {busy === 'currency' ? 'Saving…' : 'Use this'}
            </button>
          )}
        </div>
      </StepCard>

      {/* ── 3. Cancellation policy ────────────────────────────────────── */}
      <StepCard n={3} step={byKey.policy}>
        <p style={{ marginBottom: 4 }}><strong>{PRESET_LABEL[settings.policy.preset]}</strong></p>
        <p className="muted small" style={{ marginBottom: 12 }}>{summarise(settings.policy)}</p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {!byKey.policy.done && (
            <button
              className="btn btn-primary"
              onClick={confirmPolicy}
              disabled={busy === 'policy'}
            >
              {busy === 'policy' ? 'Saving…' : 'Use this'}
            </button>
          )}
          {/* The full editor already exists on Settings — a second copy of a
              form with custom refund steps is a second thing to keep correct. */}
          <Link className="btn btn-ghost" to="/settings">
            {byKey.policy.done ? 'Change in Settings' : 'Pick another'}
          </Link>
        </div>
      </StepCard>

      {/* ── 4. Waiver ─────────────────────────────────────────────────── */}
      <StepCard n={4} step={byKey.waiver}>
        {settings.defaultWaiver && (
          <p style={{ marginBottom: 4 }}>
            <strong>{settings.defaultWaiver.name}</strong>
          </p>
        )}
        <p className="muted small" style={{ marginBottom: 12 }}>
          A PDF every traveler agrees to before they join. Each trip gets its own
          copy, so replacing this never changes a trip you already published.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          hidden
          onChange={e => {
            onWaiverPicked(e.target.files?.[0]);
            // Reset, or picking the SAME file twice after a failure fires no
            // change event and the page looks dead.
            e.target.value = '';
          }}
        />
        <button
          className={settings.defaultWaiver ? 'btn btn-ghost' : 'btn btn-primary'}
          onClick={() => fileRef.current?.click()}
          disabled={busy === 'waiver'}
        >
          {busy === 'waiver'
            ? 'Uploading…'
            : settings.defaultWaiver
              ? 'Replace PDF'
              : 'Upload PDF'}
        </button>
      </StepCard>

      {/* ── 5. Insurance ──────────────────────────────────────────────── */}
      <StepCard n={5} step={byKey.insurance}>
        {settings.insurance && (
          <p style={{ marginBottom: 4 }}><strong>{settings.insurance.name}</strong></p>
        )}
        <p className="muted small" style={{ marginBottom: 12 }}>
          Your liability insurance certificate. A photo of the paper one is fine —
          Swellyo keeps it, travelers never see it.
        </p>
        <input
          ref={insuranceRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/heic"
          hidden
          onChange={e => {
            onInsurancePicked(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <button
          className={settings.insurance ? 'btn btn-ghost' : 'btn btn-primary'}
          onClick={() => insuranceRef.current?.click()}
          disabled={busy === 'insurance'}
        >
          {busy === 'insurance'
            ? 'Uploading…'
            : settings.insurance
              ? 'Replace'
              : 'Upload'}
        </button>
      </StepCard>

      {/* ── 6. Terms ──────────────────────────────────────────────────── */}
      <StepCard n={6} step={byKey.terms}>
        {/* ⚠️ NO TERMS DOCUMENT EXISTS YET, and nothing is invented to fill the
            space. Placeholder legal text is the one kind of placeholder that
            gets mistaken for the real thing. The panel says so plainly, and the
            checkbox says what it actually records. */}
        <div
          style={{
            border: '1px solid var(--line)',
            borderRadius: 'var(--r)',
            background: 'var(--panel)',
            padding: 14,
            marginBottom: 12,
          }}
        >
          <strong style={{ display: 'block', marginBottom: 6 }}>
            The terms are not published yet
          </strong>
          <p className="muted small" style={{ marginBottom: 8 }}>
            Swellyo is still writing the operator terms. This panel is where they
            will appear.
          </p>
          <p className="muted small">
            Agreeing now records that you accept the terms once they are
            published. You will be asked again when they are, so you can read
            them before anything is binding.
          </p>
        </div>

        {byKey.terms.done ? (
          <p className="muted small">
            Agreed{settings.termsAcceptedAt
              ? ` on ${new Date(settings.termsAcceptedAt).toLocaleDateString()}`
              : ''}.
          </p>
        ) : (
          <>
            <label
              className="row"
              style={{ gap: 10, alignItems: 'flex-start', cursor: 'pointer', marginBottom: 12 }}
            >
              <input
                type="checkbox"
                checked={termsChecked}
                onChange={e => setTermsChecked(e.target.checked)}
                style={{ marginTop: 3 }}
              />
              <span className="small">
                I agree to Swellyo's operator terms, and to review them when they
                are published.
              </span>
            </label>
            <button
              className="btn btn-primary"
              onClick={acceptTerms}
              disabled={!termsChecked || busy === 'terms'}
            >
              {busy === 'terms' ? 'Saving…' : 'Agree'}
            </button>
          </>
        )}
      </StepCard>

      {complete && (
        <p className="muted small" style={{ marginTop: 16 }}>
          Trips are created in the Swellyo app. This site is for running the ones
          you have.
        </p>
      )}
    </>
  );
}

function StepCard({
  n,
  step,
  children,
}: {
  n: number;
  step: SetupStep;
  children: React.ReactNode;
}) {
  return (
    <div className="card enter" style={{ marginBottom: 16 }}>
      <div className="card-body">
        <div className="row-between" style={{ marginBottom: 8 }}>
          <div className="row" style={{ gap: 10, alignItems: 'center' }}>
            {/* The number survives after the tick: it is what makes the banner's
                "2 of 4" and this list obviously the same four things. */}
            <span
              aria-hidden
              style={{
                width: 22,
                height: 22,
                borderRadius: 99,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
                fontWeight: 700,
                background: step.done ? 'var(--ok)' : 'var(--cyan-tint)',
                color: step.done ? '#fff' : 'var(--cyan-dark)',
              }}
            >
              {step.done ? '✓' : n}
            </span>
            <strong>{step.title}</strong>
          </div>
          {step.done ? (
            <span className={step.pending ? 'tag tag-wait' : 'tag tag-ok'}>
              {step.pending ? 'Checking' : 'Done'}
            </span>
          ) : step.appOnly ? (
            <span className="tag tag-idle">In the app</span>
          ) : (
            <span className="tag tag-warn">To do</span>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
