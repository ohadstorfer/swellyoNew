import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { PageHead } from '../components/Shell';
import { ErrorBox, Loading } from '../components/StateBits';
import { fetchConnectState, fetchOperatorSettings } from '../services/settings';
import { fetchProfiles } from '../services/travelers';
import { publishTrip } from '../services/createTrip';
import { DEFAULT_POLICY, summarise } from '../domain/cancellation';
import {
  INITIAL_STATE,
  STEPS,
  STEP_META,
  canCollectPayments,
  defaultOperatorCurrency,
  firstInvalidStep,
  isDraftWorthKeeping,
  isRemoteUrl,
  requirementKindsToCreate,
  restoreDraft,
  validateStep,
  type FieldErrors,
  type OperatorCurrency,
  type StepKey,
  type ValidateContext,
  type WizardState,
} from '../domain/createTrip';
import {
  AboutYouStep,
  AudienceStep,
  BasicsStep,
  BudgetStep,
  ItineraryStep,
  PreviewStep,
  RequirementsStep,
  VibezStep,
  type StepProps,
} from '../components/createTrip/steps';
import '../styles/createTrip.css';

/**
 * /trips/new — the app's operator create flow (CreateTripFlowA, style C) on
 * the web. Same steps, fields, defaults and validation; the writes live in
 * services/createTrip.ts in the app's order.
 */

const draftKey = (userId: string) => `swellyo.dash.createTripDraft.v1.${userId}`;

function readDraft(userId: string): WizardState | null {
  try {
    const raw = localStorage.getItem(draftKey(userId));
    return raw ? restoreDraft(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
function writeDraft(userId: string, s: WizardState) {
  try {
    localStorage.setItem(draftKey(userId), JSON.stringify(s));
  } catch {
    /* storage full or blocked — the wizard still works, it just won't resume */
  }
}
function clearDraft(userId: string) {
  try {
    localStorage.removeItem(draftKey(userId));
  } catch {
    /* ignore */
  }
}

export function CreateTripPage() {
  const { user } = useAuth();
  const userId = user!.id;
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [s, setS] = useState<WizardState>(INITIAL_STATE);
  const [step, setStep] = useState<StepKey>('audience');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [resumable, setResumable] = useState<WizardState | null>(() => readDraft(userId));
  const [saving, setSaving] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [waiverFile, setWaiverFile] = useState<File | null>(null);
  // Autosave starts after the first successful Next, like useTripWizardDraft.
  const [autosave, setAutosave] = useState(false);

  // Picked files live here, never in the draft. Keyed by the `local:<id>` ref.
  const files = useRef(new Map<string, File>());
  const previews = useRef(new Map<string, string>());
  useEffect(
    () => () => {
      previews.current.forEach(url => URL.revokeObjectURL(url));
    },
    [],
  );
  const addFiles = useCallback((picked: File[]) => {
    return picked.map(f => {
      const ref = `local:${crypto.randomUUID()}`;
      files.current.set(ref, f);
      previews.current.set(ref, URL.createObjectURL(f));
      return ref;
    });
  }, []);
  const src = useCallback((ref: string) => (isRemoteUrl(ref) ? ref : previews.current.get(ref) ?? ''), []);

  const settingsQ = useQuery({
    queryKey: ['operator-settings', userId],
    queryFn: () => fetchOperatorSettings(userId),
  });
  const profileQ = useQuery({
    queryKey: ['profile', userId],
    queryFn: async () => (await fetchProfiles([userId])).get(userId) ?? null,
  });
  // Like useConnectStatus({ enabled: paymentMode === 'managed' }).
  const connectQ = useQuery({
    queryKey: ['connect-state', userId],
    queryFn: () => fetchConnectState(userId),
    enabled: s.paymentMode === 'managed',
  });

  const currency: OperatorCurrency =
    s.currency ?? defaultOperatorCurrency(settingsQ.data?.defaultCurrency, profileQ.data?.countryFrom);
  const policy = s.cancellation ?? settingsQ.data?.policy ?? DEFAULT_POLICY;
  const defaultWaiver = settingsQ.data?.defaultWaiver ?? null;

  const ctx: ValidateContext = useMemo(
    () => ({
      connect: {
        loading: s.paymentMode === 'managed' && connectQ.isPending,
        canCollect: !!connectQ.data && canCollectPayments(connectQ.data.state),
        blocked: connectQ.data?.state === 'blocked',
      },
      hasDefaultWaiver: !!defaultWaiver,
      hasWaiverFile: !!waiverFile,
    }),
    [s.paymentMode, connectQ.isPending, connectQ.data, defaultWaiver, waiverFile],
  );

  const set = useCallback((fn: (st: WizardState) => WizardState) => {
    setS(fn);
  }, []);

  // Clear a field's error as soon as the step validates for it again.
  useEffect(() => {
    if (Object.keys(errors).length === 0) return;
    const now = validateStep(step, s, ctx);
    const kept = Object.fromEntries(Object.entries(errors).filter(([k]) => k in now));
    if (Object.keys(kept).length !== Object.keys(errors).length) setErrors(kept);
  }, [s, ctx, step, errors]);

  useEffect(() => {
    if (!autosave || !isDraftWorthKeeping(s)) return;
    const t = setTimeout(() => writeDraft(userId, s), 400);
    return () => clearTimeout(t);
  }, [s, autosave, userId]);

  const idx = STEPS.indexOf(step);
  const top = useRef<HTMLDivElement>(null);
  const go = (next: StepKey) => {
    setStep(next);
    setErrors({});
    top.current?.scrollIntoView({ block: 'start' });
  };

  const next = () => {
    const e = validateStep(step, s, ctx);
    setErrors(e);
    if (Object.keys(e).length > 0) {
      requestAnimationFrame(() =>
        document.querySelector('.ct [role="alert"]')?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
      );
      return;
    }
    if (!autosave) setAutosave(true);
    const n = STEPS[idx + 1];
    if (n) go(n);
  };

  const publish = async () => {
    const bad = firstInvalidStep(s, ctx);
    if (bad) {
      go(bad);
      setErrors(validateStep(bad, s, ctx));
      return;
    }
    setSaving(true);
    setPublishError(null);
    try {
      const res = await publishTrip({
        state: s,
        hostId: userId,
        currency,
        policy,
        files: files.current,
        waiverFile,
        defaultWaiver,
      });
      clearDraft(userId);
      await qc.invalidateQueries({ queryKey: ['operator-trips'] });
      if (res.warnings.length) alert(res.warnings.join('\n\n'));
      navigate(`/trips/${res.tripId}`, { replace: true });
    } catch (e) {
      setPublishError(e instanceof Error ? e.message : 'Something went wrong while publishing your trip. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (settingsQ.isPending) return <Loading what="Loading your settings" />;
  if (settingsQ.isError) return <ErrorBox what="Your settings" error={settingsQ.error} onRetry={() => void settingsQ.refetch()} />;

  const props: StepProps = { s, set, errors, src, addFiles };
  const meta = STEP_META[step];

  return (
    <div className="ct" ref={top}>
      <PageHead back="/trips" backLabel="Your trips" title="New trip" />

      {resumable && (
        <div className="banner" style={{ marginBottom: 16 }}>
          <div className="row-between" style={{ gap: 12, flexWrap: 'wrap' }}>
            <span>
              You have an unfinished trip{resumable.title ? ` — “${resumable.title}”` : ''}. Photos need picking again.
            </span>
            <span className="row" style={{ gap: 8 }}>
              <button type="button" className="btn btn-sm" onClick={() => { clearDraft(userId); setResumable(null); }}>
                Start fresh
              </button>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => { setS(resumable); setResumable(null); setAutosave(true); }}
              >
                Resume
              </button>
            </span>
          </div>
        </div>
      )}

      <div className="ct-progress" aria-hidden>
        {STEPS.map((k, i) => (
          <span key={k} data-on={i <= idx} />
        ))}
      </div>
      <div key={step} className="ct-enter">
        <span className="ct-stepcount">Step {idx + 1} of {STEPS.length}</span>
        <h2 className="ct-steptitle">{meta.title}</h2>
        <p className="muted small" style={{ margin: 0 }}>{meta.subtitle}</p>

        {step === 'audience' && <AudienceStep {...props} />}
        {step === 'basics' && <BasicsStep {...props} />}
        {step === 'vibez' && <VibezStep {...props} />}
        {step === 'budget' && (
          <BudgetStep
            {...props}
            extra={{
              currency,
              setCurrency: c => set(st => ({ ...st, currency: c })),
              connectState: connectQ.data?.state ?? null,
              connectLoading: s.paymentMode === 'managed' && connectQ.isPending,
              policy,
            }}
          />
        )}
        {step === 'aboutYou' && (
          <AboutYouStep {...props} profile={profileQ.data ? { name: profileQ.data.name, photoUrl: profileQ.data.photoUrl } : null} />
        )}
        {step === 'requirements' && (
          <RequirementsStep {...props} defaultWaiver={defaultWaiver} waiverFile={waiverFile} setWaiverFile={setWaiverFile} />
        )}
        {step === 'itinerary' && <ItineraryStep {...props} />}
        {step === 'preview' && (
          <PreviewStep {...props} currency={currency} policyLabel={summarise(policy)} kinds={requirementKindsToCreate(s)} />
        )}

        {publishError && (
          <p className="ct-error" role="alert" style={{ marginTop: 16 }}>
            Could not publish: {publishError}
          </p>
        )}
      </div>

      <div className="ct-footer">
        <div className="ct-footer-inner">
          <button type="button" className="btn" onClick={() => (idx === 0 ? navigate('/trips') : go(STEPS[idx - 1]))} disabled={saving}>
            {idx === 0 ? 'Cancel' : 'Back'}
          </button>
          {step === 'preview' ? (
            <button type="button" className="btn btn-primary" onClick={() => void publish()} disabled={saving}>
              {saving ? 'Publishing…' : 'Publish trip'}
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={next}>
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
