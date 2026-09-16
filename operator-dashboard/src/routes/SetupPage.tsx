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
  NO_PAYOUT,
  saveOperatorSettings,
  uploadDefaultWaiver,
  uploadOperatorInsurance,
  CURRENCIES,
  type OperatorInsurance,
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
import { IS_DRAFT, LAST_REVIEWED, SECTIONS } from '../domain/operatorAgreement';

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
  const [signedName, setSignedName] = useState('');
  const [insFields, setInsFields] = useState<InsuranceFields>(fieldsOf(null));
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
      setInsFields(fieldsOf(s.insurance));
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
      const fresh = await fetchOperatorSettings(userId);
      setSettings(fresh);
      // Only the insurance step owns these inputs. Refilling them after another
      // step saves would wipe what the operator is still typing.
      if (key === 'insurance') setInsFields(fieldsOf(fresh.insurance));
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
      // The fields go up WITH the file: one save, one submission for review.
      const stored = await uploadOperatorInsurance(
        userId!,
        file,
        settings.insurance?.path ?? null,
        cleanFields(insFields),
      );
      await saveOperatorSettings(userId!, { insurance: stored });
    });
  };

  const insuranceFieldsChanged =
    settings.insurance != null &&
    JSON.stringify(cleanFields(insFields)) !== JSON.stringify(cleanFields(fieldsOf(settings.insurance)));

  // Same file, new details. The database sends it back to review (trigger in
  // the app's migration 20260915000000), which the hint under the button says.
  const saveInsuranceFields = () =>
    run('insurance', async () => {
      if (!settings.insurance) return;
      await saveOperatorSettings(userId!, {
        insurance: { ...settings.insurance, ...cleanFields(insFields) },
      });
    });

  const acceptTerms = () =>
    run('terms', () =>
      saveOperatorSettings(userId!, {
        acceptTermsVersion: OPERATOR_TERMS_VERSION,
        termsSignedName: signedName.trim(),
      }),
    );

  if (loading) return <Loading />;
  if (error) return <ErrorBox what="Your setup" error={error} onRetry={load} />;

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
        <p className="muted small" style={{ marginBottom: 12 }}>
          {byKey.stripe.done
            ? byKey.stripe.pending
              ? 'Stripe has your details and is checking them. Nothing for you to do.'
              : 'Stripe can take payments for your trips.'
            : 'Travelers cannot pay you until this is connected.'}
        </p>
        {/* No button. Stripe's forms are inside the phone app, and a button here
            could only ever open something that does not exist on desktop. */}
        <p className="muted" style={{ fontSize: 'var(--fs-s)', lineHeight: '18px' }}>
          This is the one step you finish in the <strong>Swellyo app</strong>, under
          Settings → Payments. Stripe's forms are built into the app, so they
          cannot run on this site.
        </p>
      </StepCard>

      {/* ── 2. Currency ───────────────────────────────────────────────── */}
      <StepCard n={2} step={byKey.currency}>
        <p style={{ marginBottom: 12 }}>
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
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid var(--line)',
              background: 'var(--surface)',
              fontSize: 'var(--fs-md)',
              lineHeight: '20px',
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
        {byKey.insurance.review && (
          <p
            className="small"
            style={{
              marginBottom: 4,
              color: byKey.insurance.review === 'under_review' ? undefined : 'var(--danger)',
            }}
          >
            {reviewLine(byKey.insurance.review, settings)}
          </p>
        )}
        <p className="muted small" style={{ marginBottom: 12 }}>
          Your liability insurance certificate. A photo of the paper one is fine —
          Swellyo keeps it, travelers never see it. Swellyo checks it before this
          step is done.
        </p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <input
            type="text"
            placeholder="Insurance provider"
            aria-label="Insurance provider"
            maxLength={80}
            value={insFields.provider ?? ''}
            onChange={e => setInsFields(f => ({ ...f, provider: e.target.value }))}
            disabled={busy === 'insurance'}
            style={FIELD_STYLE}
          />
          <input
            type="text"
            placeholder="Policy number"
            aria-label="Policy number"
            maxLength={80}
            value={insFields.policyNumber ?? ''}
            onChange={e => setInsFields(f => ({ ...f, policyNumber: e.target.value }))}
            disabled={busy === 'insurance'}
            style={FIELD_STYLE}
          />
          <label className="row small" style={{ gap: 8, alignItems: 'center' }}>
            <span className="muted">Expiration date</span>
            <input
              type="date"
              aria-label="Expiration date"
              value={insFields.expiresOn ?? ''}
              onChange={e => setInsFields(f => ({ ...f, expiresOn: e.target.value }))}
              disabled={busy === 'insurance'}
              style={FIELD_STYLE}
            />
          </label>
        </div>
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
        {settings.insurance && (
          <>
            <button
              className="btn btn-primary"
              style={{ marginLeft: 8 }}
              onClick={saveInsuranceFields}
              disabled={!insuranceFieldsChanged || busy === 'insurance'}
            >
              Save details
            </button>
            <p className="muted" style={{ fontSize: 'var(--fs-s)', lineHeight: '18px', marginTop: 8 }}>
              Saving new details sends your insurance back to Swellyo for review.
            </p>
          </>
        )}
      </StepCard>

      {/* ── 6. Terms ──────────────────────────────────────────────────── */}
      <StepCard n={6} step={byKey.terms}>
        {/* The same summary the app shows, from the same document
            (domain/operatorAgreement.ts). It is a description of the deal the
            code already implements, not a contract, and it says so first —
            see the header of that file for why a described deal beats both an
            empty panel and invented clauses. The two surfaces must show the
            same words and record the same version, or agreeing here leaves the
            step unfinished on the phone. */}
        <div
          style={{
            border: '1px solid var(--line)',
            borderRadius: 'var(--r)',
            background: 'var(--panel)',
            padding: 16,
            marginBottom: 12,
            maxHeight: 360,
            overflowY: 'auto',
          }}
        >
          {IS_DRAFT && (
            <div
              style={{
                border: '1px solid var(--warn-line, var(--line))',
                borderRadius: 'var(--r)',
                background: 'var(--warn-bg, transparent)',
                padding: '12px 12px',
                marginBottom: 16,
              }}
            >
              <strong style={{ display: 'block', marginBottom: 4 }}>
                This is a summary, not the final contract
              </strong>
              <p className="muted small" style={{ margin: 0 }}>
                It describes how Swellyo works today, in plain language, so you can
                see the arrangement before the formal agreement is written. The full
                legal document is being drafted — you will be asked to read and
                accept it when it is ready.
              </p>
            </div>
          )}
          {SECTIONS.map(section => (
            <section key={section.heading} style={{ marginBottom: 16 }}>
              <strong style={{ display: 'block', marginBottom: 4 }}>{section.heading}</strong>
              {section.paragraphs.map(p => (
                <p key={p} className="small" style={{ margin: '0 0 8px' }}>
                  {p}
                </p>
              ))}
            </section>
          ))}
          <p className="muted small" style={{ margin: 0 }}>
            Last reviewed {LAST_REVIEWED}
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
              style={{ gap: 12, alignItems: 'flex-start', cursor: 'pointer', marginBottom: 12 }}
            >
              <input
                type="checkbox"
                checked={termsChecked}
                onChange={e => setTermsChecked(e.target.checked)}
                style={{ marginTop: 4 }}
              />
              <span className="small">
                {IS_DRAFT
                  ? 'I agree to Swellyo’s operator terms as summarised here, and to review the full agreement when it is published.'
                  : 'I agree to Swellyo’s operator terms.'}
              </span>
            </label>
            <label className="row small" style={{ gap: 8, alignItems: 'center', marginBottom: 12 }}>
              <span>Full name</span>
              <input
                type="text"
                required
                maxLength={120}
                autoComplete="name"
                value={signedName}
                onChange={e => setSignedName(e.target.value)}
                disabled={busy === 'terms'}
                style={FIELD_STYLE}
              />
            </label>
            <button
              className="btn btn-primary"
              onClick={acceptTerms}
              disabled={!termsChecked || !signedName.trim() || busy === 'terms'}
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
          <div className="row" style={{ gap: 12, alignItems: 'center' }}>
            {/* The number survives after the tick: it is what makes the banner's
                "2 of 4" and this list obviously the same four things. */}
            <span
              aria-hidden
              style={{
                width: 22,
                height: 22,
                borderRadius: 999,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 'var(--fs-s)',
                lineHeight: '18px',
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
          ) : step.review === 'under_review' ? (
            <span className="tag tag-wait">Under review</span>
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

type InsuranceFields = Pick<OperatorInsurance, 'provider' | 'policyNumber' | 'expiresOn'>;

function fieldsOf(i: OperatorInsurance | null): InsuranceFields {
  return {
    provider: i?.provider ?? null,
    policyNumber: i?.policyNumber ?? null,
    expiresOn: i?.expiresOn ?? null,
  };
}

/** Empty strings become null, so "typed then cleared" is not a change. */
function cleanFields(f: InsuranceFields): InsuranceFields {
  return {
    provider: f.provider?.trim() || null,
    policyNumber: f.policyNumber?.trim() || null,
    expiresOn: f.expiresOn || null,
  };
}

/** 'YYYY-MM-DD' shown as a local date. Parsed by parts: `new Date('2027-01-01')` is UTC midnight and reads as the day before west of Greenwich. */
function formatDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString();
}

function reviewLine(review: NonNullable<SetupStep['review']>, s: OperatorSettings): string {
  switch (review) {
    case 'under_review':
      return 'Under review';
    case 'rejected':
      return s.insuranceReview?.note ? `Not approved: ${s.insuranceReview.note}` : 'Not approved';
    case 'expired':
      return s.insurance?.expiresOn ? `Expired on ${formatDay(s.insurance.expiresOn)}` : 'Expired';
  }
}

/** Same inline input style as the currency picker above — there is no `.input` class here. */
const FIELD_STYLE: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid var(--line)',
  background: 'var(--surface)',
  fontSize: 'var(--fs-md)',
  lineHeight: '20px',
};
