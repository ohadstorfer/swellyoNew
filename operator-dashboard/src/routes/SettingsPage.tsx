/**
 * Operator settings: payments, the currency you price in, and the cancellation
 * policy new trips start from.
 *
 * These are DEFAULTS. Changing one here does not touch a trip that is already
 * published — a policy someone agreed to in January must not be rewritten in
 * March. The copy says so, because "default" alone does not tell an operator
 * whether their live trips just changed.
 *
 * Stripe Connect is REPORTED here, not run here. The onboarding flow needs the
 * Stripe secret key and lives behind an edge function the app calls; building a
 * second entry point would mean two paths to keep in step with Stripe's six
 * states. So this says where the account stands and sends them to the app.
 */
import { useCallback, useEffect, useState } from 'react';
import { PageHead } from '../components/Shell';
import { ErrorBox, Loading } from '../components/StateBits';
import { useAuth } from '../lib/auth';
import { friendlyError } from '../lib/errors';
import {
  CURRENCIES,
  EMPTY_SETTINGS,
  fetchOperatorSettings,
  connectStatusOf,
  fetchPayoutState,
  NO_PAYOUT,
  saveOperatorSettings,
  type OperatorSettings,
  type PayoutState,
} from '../services/settings';
import { deriveConnectState, describeConnectState } from '../domain/connect';
import {
  PRESET_BLURB,
  PRESET_LABEL,
  explain,
  validate,
  type CancellationPolicy,
  type CancellationPreset,
  type CancellationRule,
} from '../domain/cancellation';

const PRESETS: CancellationPreset[] = ['standard', 'non_refundable', 'custom'];

export function SettingsPage() {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [settings, setSettings] = useState<OperatorSettings>(EMPTY_SETTINGS);
  const [payout, setPayout] = useState<PayoutState | null>(null);

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
      setPayout(p);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <Loading what="Loading your settings" />;
  if (error) return <ErrorBox error={error} onRetry={() => void load()} />;

  return (
    <>
      <PageHead
        back="/trips"
        backLabel="Trips"
        title="Settings"
        sub="Defaults for new trips. Trips you have already published keep the terms they were published with."
      />

      <PaymentsCard payout={payout} />

      <CurrencyCard
        userId={userId!}
        value={settings.defaultCurrency}
        onSaved={s => setSettings(s)}
      />

      <PolicyCard
        userId={userId!}
        value={settings.policy}
        onSaved={s => setSettings(s)}
      />
    </>
  );
}

// ── Payments ───────────────────────────────────────────────────────────────

function PaymentsCard({ payout }: { payout: PayoutState | null }) {
  // Deliberately not collapsed into a single "connected" boolean, and no longer
  // a ladder of if/else here either. Both halves of that were bugs: an account
  // that submitted details and is under review is NOT one that never started,
  // and an account Stripe REFUSED is neither — it used to read as "Stripe still
  // needs information from you", sending the operator to fill in a form that
  // could not help them. `deriveConnectState` is the one rule, shared with the
  // app, and the only thing allowed to read `disabled_reason`.
  const status = connectStatusOf(payout ?? NO_PAYOUT);
  const state = deriveConnectState(status);
  const copy = describeConnectState(state, status);
  // Only when there is something to go and do. Telling a live operator — or one
  // Stripe has refused — to "finish Stripe in the app" is an instruction that
  // leads nowhere.
  const showAppNote = state !== 'ready' && state !== 'blocked';

  return (
    <div className="card enter" style={{ marginBottom: 16 }}>
      <div className="card-body">
        <div className="row-between" style={{ marginBottom: 6 }}>
          <h3>Payments</h3>
          <span className={`tag tag-${copy.tone}`}>{copy.tag}</span>
        </div>
        <p className="muted small" style={{ marginBottom: 10 }}>{copy.line}</p>
        {showAppNote && (
          <p className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
            Connect and finish Stripe in the Swellyo app, under Settings →
            Payments. It has to be done there because Stripe's forms are built
            into the app.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Default price currency ─────────────────────────────────────────────────

function CurrencyCard({
  userId,
  value,
  onSaved,
}: {
  userId: string;
  value: string | null;
  onSaved: (s: OperatorSettings) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function change(next: string | null) {
    setSaving(true);
    setErr(null);
    try {
      await saveOperatorSettings(userId, { defaultCurrency: next });
      onSaved(await fetchOperatorSettings(userId));
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card enter" style={{ marginBottom: 16 }}>
      <div className="card-body">
        <h3 style={{ marginBottom: 6 }}>Default price currency</h3>
        <p className="muted small" style={{ marginBottom: 12 }}>
          New trips start priced in this. You can change it on any single trip.
        </p>

        <select
          value={value ?? ''}
          disabled={saving}
          onChange={e => void change(e.target.value === '' ? null : e.target.value)}
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

        {err && <p className="small" style={{ color: 'var(--danger)', marginTop: 10 }}>{err}</p>}
      </div>
    </div>
  );
}

// ── Cancellation policy ────────────────────────────────────────────────────

function PolicyCard({
  userId,
  value,
  onSaved,
}: {
  userId: string;
  value: CancellationPolicy;
  onSaved: (s: OperatorSettings) => void;
}) {
  const [preset, setPreset] = useState<CancellationPreset>(value.preset);
  const [rules, setRules] = useState<CancellationRule[]>(
    value.rules.length > 0 ? value.rules : [{ daysBefore: 60, refundPct: 100 }],
  );
  const [notes, setNotes] = useState(value.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const draft: CancellationPolicy = { preset, rules, notes: notes.trim() || null };
  const problems = validate(draft);

  function setRule(i: number, patch: Partial<CancellationRule>) {
    setRules(prev => prev.map((r, n) => (n === i ? { ...r, ...patch } : r)));
    setSaved(false);
  }

  async function save() {
    if (problems.length > 0) return;
    setSaving(true);
    setErr(null);
    try {
      await saveOperatorSettings(userId, { policy: draft });
      const fresh = await fetchOperatorSettings(userId);
      onSaved(fresh);
      // Re-seed from what the server stored: the database sorts custom rules
      // and clears them for a non-custom preset, so the form must show the
      // stored policy, not the draft that was sent.
      setPreset(fresh.policy.preset);
      if (fresh.policy.rules.length > 0) setRules(fresh.policy.rules);
      setNotes(fresh.policy.notes ?? '');
      setSaved(true);
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card enter">
      <div className="card-body">
        <h3 style={{ marginBottom: 6 }}>Cancellation policy</h3>
        <p className="muted small" style={{ marginBottom: 14 }}>
          Travelers see this before they pay their deposit.
        </p>

        <div style={{ display: 'grid', gap: 10, marginBottom: 14 }}>
          {PRESETS.map(p => (
            <label key={p} className="row" style={{ gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
              <input
                type="radio"
                name="preset"
                checked={preset === p}
                onChange={() => { setPreset(p); setSaved(false); }}
                style={{ marginTop: 3 }}
              />
              <span>
                <strong style={{ fontSize: 14 }}>{PRESET_LABEL[p]}</strong>
                <span className="muted small" style={{ display: 'block' }}>{PRESET_BLURB[p]}</span>
              </span>
            </label>
          ))}
        </div>

        {preset === 'custom' && (
          <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
            {rules.map((r, i) => (
              <div key={i} className="row" style={{ gap: 8 }}>
                <input
                  type="number"
                  value={r.daysBefore}
                  min={0}
                  max={3650}
                  onChange={e => setRule(i, { daysBefore: Number(e.target.value) })}
                  style={numStyle}
                  aria-label="Days before the trip"
                />
                <span className="muted small">days before →</span>
                <input
                  type="number"
                  value={r.refundPct}
                  min={0}
                  max={100}
                  onChange={e => setRule(i, { refundPct: Number(e.target.value) })}
                  style={numStyle}
                  aria-label="Percent refunded"
                />
                <span className="muted small">% back</span>
                {rules.length > 1 && (
                  <button
                    className="btn btn-sm"
                    onClick={() => { setRules(prev => prev.filter((_, n) => n !== i)); setSaved(false); }}
                    aria-label="Remove this step"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
            <div>
              <button
                className="btn btn-sm"
                onClick={() => {
                  const lowest = rules.reduce((m, r) => Math.min(m, r.daysBefore), Number.MAX_SAFE_INTEGER);
                  const next = Number.isFinite(lowest) && lowest > 7 ? Math.floor(lowest / 2) : 7;
                  setRules(prev => [...prev, { daysBefore: next, refundPct: 50 }]);
                  setSaved(false);
                }}
              >
                Add a step
              </button>
            </div>
          </div>
        )}

        {/* The policy in sentences, rebuilt as they type. A refund ladder is
            easy to write backwards and hard to spot in numbers. */}
        {problems.length === 0 && (
          <div
            style={{
              background: 'var(--bg, #F6F8F9)',
              borderRadius: 8,
              padding: 12,
              marginBottom: 14,
            }}
          >
            <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 4 }}>
              Travelers will see
            </div>
            {explain(draft).map((l, i) => (
              <div key={i} className="small" style={{ lineHeight: 1.6 }}>• {l}</div>
            ))}
          </div>
        )}

        <label className="small" style={{ display: 'block', marginBottom: 6 }}>
          Notes (optional)
        </label>
        <textarea
          value={notes}
          maxLength={2000}
          onChange={e => { setNotes(e.target.value); setSaved(false); }}
          placeholder="Anything the steps above cannot say — for example, medical emergencies handled case by case."
          style={{
            width: '100%',
            minHeight: 76,
            padding: 10,
            borderRadius: 8,
            border: '1px solid var(--line)',
            fontSize: 14,
            fontFamily: 'inherit',
            resize: 'vertical',
          }}
        />

        {problems.map((p, i) => (
          <p key={i} className="small" style={{ color: 'var(--danger)', marginTop: 8 }}>{p}</p>
        ))}
        {err && <p className="small" style={{ color: 'var(--danger)', marginTop: 8 }}>{err}</p>}

        <div className="row" style={{ gap: 10, marginTop: 14 }}>
          <button
            className="btn btn-primary"
            disabled={problems.length > 0 || saving}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save policy'}
          </button>
          {saved && <span className="muted small">Saved</span>}
        </div>

        <p className="muted" style={{ fontSize: 12, marginTop: 14, lineHeight: 1.5 }}>
          You refund travelers from your own Stripe account. Swellyo shows this
          policy but does not process refunds.
        </p>
      </div>
    </div>
  );
}

const numStyle: React.CSSProperties = {
  width: 72,
  padding: '7px 9px',
  borderRadius: 8,
  border: '1px solid var(--line)',
  fontSize: 14,
};
