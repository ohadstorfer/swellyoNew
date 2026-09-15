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
 *
 * The one thing it DOES open is Stripe's own Express Dashboard, once
 * onboarding is finished — a single link out to a page Stripe renders, so
 * there is no second flow to keep in step. That is where an operator changes
 * the bank account they get paid into. See `openStripeDashboard`.
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
  openStripeDashboard,
  saveOperatorSettings,
  type OperatorSettings,
  type PayoutState,
} from '../services/settings';
import {
  canManageStripeAccount,
  deriveConnectState,
  describeConnectState,
  MANAGE_STRIPE_CTA,
} from '../domain/connect';
import {
  INTERVALS,
  INTERVAL_BLURB,
  INTERVAL_LABEL,
  WEEKDAYS,
  amountIn,
  canPayOutNow,
  describeClearing,
  describeNothingToPayOut,
  describeSweep,
  firstPayoutCaveat,
  formatMoney,
  type PayoutInterval,
  type PayoutStatus,
} from '../domain/payoutSchedule';
import { fetchPayoutStatus, payOutNow, savePayoutSchedule } from '../services/payouts';
import {
  validate,
  type CancellationPolicy,
  type CancellationPreset,
  type CancellationRule,
} from '../domain/cancellation';
import { PolicyFields } from '../components/PolicyFields';


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
  if (error) return <ErrorBox what="Your settings" error={error} onRetry={() => void load()} />;

  return (
    <>
      <PageHead
        back="/trips"
        backLabel="Trips"
        title="Settings"
        sub="Defaults for new trips. Trips you have already published keep the terms they were published with."
      />

      <PaymentsCard payout={payout} />

      <PayoutScheduleCard />

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
  // Editing details you already gave is a different job from finishing
  // onboarding, and it outlives it — including on an account Stripe switched
  // off. See canManageStripeAccount.
  const canManage = canManageStripeAccount(status);

  const [opening, setOpening] = useState(false);
  const [openErr, setOpenErr] = useState<string | null>(null);

  async function openDashboard() {
    setOpening(true);
    setOpenErr(null);
    try {
      await openStripeDashboard();
    } catch (e) {
      // The message from `openStripeDashboard` is already written for a
      // person — the pop-up-blocker line and the edge function's own copy
      // both are — so it is shown as-is, and only genuinely unexpected
      // failures fall back to friendlyError's generic sentence.
      const msg = e instanceof Error ? e.message : '';
      setOpenErr(msg && !msg.toLowerCase().includes('non-2xx') ? msg : friendlyError(e));
    } finally {
      setOpening(false);
    }
  }

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
        {canManage && (
          <>
            <button
              className="btn btn-sm"
              style={{ marginTop: 10 }}
              onClick={() => void openDashboard()}
              disabled={opening}
            >
              {opening ? 'Opening Stripe…' : MANAGE_STRIPE_CTA}
            </button>
            <p className="muted" style={{ fontSize: 12, lineHeight: 1.5, marginTop: 8 }}>
              Opens Stripe in a new tab. Your bank account, payout schedule,
              business details and tax documents all live there.
            </p>
          </>
        )}
        {openErr && (
          <p className="small" style={{ color: 'var(--danger)', marginTop: 8 }}>{openErr}</p>
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
          Travelers see this before they pay their deposit. It is the DEFAULT new trips start
          from — a published trip keeps the terms it was published with.
        </p>

        {/* Shared with the trip page's own policy card. One form, two places it
            can save to; two copies of a refund ladder is exactly the drift this
            project keeps writing warnings about. */}
        <PolicyFields
          value={draft}
          onChange={next => {
            setPreset(next.preset);
            setRules(next.rules);
            setNotes(next.notes ?? '');
            setSaved(false);
          }}
          disabled={saving}
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

// ── Payouts: when the money reaches the bank ───────────────────────────────

/**
 * The two clocks are shown SEPARATELY and in order (clear, then sweep) because
 * an operator asking "where is my money" has to be able to tell which one is
 * holding it. See the header of `domain/payoutSchedule.ts`.
 *
 * The Pay out button appears ONLY on a manual schedule. On an automatic one the
 * available balance is swept the moment it clears, so the button would read
 * "Pay out $0.00" almost always — which reads as money gone missing, not as a
 * healthy account. Stripe's own Express Dashboard hides it for the same reason.
 */
function PayoutScheduleCard() {
  const [status, setStatus] = useState<PayoutStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [noAccount, setNoAccount] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [paying, setPaying] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // The draft. Seeded from the server and re-seeded after every save, because
  // Stripe may not store what we sent — it clamps `delay_days` to the account's
  // country minimum, so the form must show what is true, not what was asked.
  const [mode, setMode] = useState<PayoutInterval>('daily');
  const [weekly, setWeekly] = useState('friday');
  const [monthly, setMonthly] = useState(1);
  const [delay, setDelay] = useState('');

  const seed = useCallback((s: PayoutStatus) => {
    setStatus(s);
    setMode(s.schedule.interval ?? 'daily');
    setWeekly(s.schedule.weeklyAnchor ?? 'friday');
    setMonthly(s.schedule.monthlyAnchor ?? 1);
    setDelay(s.schedule.delayDays === null ? '' : String(s.schedule.delayDays));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const res = await fetchPayoutStatus();
    if (!res.ok) {
      // Not connected is not an error worth a red box — the Payments card
      // directly above already explains it. Hide this card entirely.
      if (res.code === 'no_account') setNoAccount(true);
      else setErr(res.error);
    } else {
      seed(res.status);
    }
    setLoading(false);
  }, [seed]);

  useEffect(() => {
    void load();
  }, [load]);

  if (noAccount) return null;

  async function save() {
    if (!status) return;
    setSaving(true);
    setErr(null);
    setNote(null);
    const parsed = Number(delay);
    const res = await savePayoutSchedule({
      interval: mode,
      // Sent only when it is both applicable and actually different. Echoing
      // the value back on every save turns a display into a write, and Stripe
      // rejects the field outright on a manual schedule.
      ...(mode !== 'manual' &&
      delay.trim() !== '' &&
      Number.isInteger(parsed) &&
      parsed !== status.schedule.delayDays
        ? { delayDays: parsed }
        : {}),
      ...(mode === 'weekly' ? { weeklyAnchor: weekly } : {}),
      ...(mode === 'monthly' ? { monthlyAnchor: monthly } : {}),
    });
    setSaving(false);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    setNote('Saved.');
    await load();
  }

  async function payNow() {
    setPaying(true);
    setErr(null);
    setNote(null);
    const res = await payOutNow();
    setPaying(false);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    setNote(`${res.formatted} is on its way to your bank.`);
    await load();
  }

  // An emptied number box parses as 0. Sending that earns a Stripe rejection
  // the operator cannot act on, so an invalid anchor blocks the save instead.
  const monthlyOk = Number.isInteger(monthly) && monthly >= 1 && monthly <= 31;

  const dirty =
    !!status &&
    (mode !== 'monthly' || monthlyOk) &&
    (mode !== (status.schedule.interval ?? 'daily') ||
      (mode === 'weekly' && weekly !== (status.schedule.weeklyAnchor ?? 'friday')) ||
      (mode === 'monthly' && monthly !== (status.schedule.monthlyAnchor ?? 1)) ||
      (mode !== 'manual' &&
        delay.trim() !== '' &&
        Number(delay) !== status.schedule.delayDays));

  const clearing = status ? describeClearing(status.schedule) : null;
  const caveat = status ? firstPayoutCaveat(status.hasEverPaidOut) : null;
  const availableNow = status ? amountIn(status.available, status.currency) : 0;

  return (
    <div className="card enter" style={{ marginBottom: 16 }}>
      <div className="card-body">
        <h3 style={{ marginBottom: 6 }}>Payouts</h3>

        {loading && <p className="muted small">Reading your schedule from Stripe…</p>}

        {!loading && status && (
          <>
            <p className="muted small" style={{ marginBottom: 4 }}>
              {clearing ?? 'Stripe has not told us how long money takes to clear on this account yet.'}
            </p>
            <p className="muted small" style={{ marginBottom: caveat ? 8 : 16 }}>
              {describeSweep(status.schedule)}
            </p>

            {caveat && (
              <p className="small" style={{ marginBottom: 16, lineHeight: 1.5 }}>
                {caveat}
              </p>
            )}

            {!status.payoutsEnabled && (
              <p className="small" style={{ color: 'var(--danger)', marginBottom: 14 }}>
                Stripe is not paying out to this account yet, so the schedule cannot be changed.
              </p>
            )}

            <fieldset
              disabled={!status.payoutsEnabled || saving}
              style={{ border: 0, padding: 0, margin: 0 }}
            >
              <div style={{ display: 'grid', gap: 10, marginBottom: 14 }}>
                {INTERVALS.map(i => (
                  <label
                    key={i}
                    className="row"
                    style={{ gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}
                  >
                    <input
                      type="radio"
                      name="payout-interval"
                      checked={mode === i}
                      onChange={() => { setMode(i); setNote(null); }}
                      style={{ marginTop: 3 }}
                    />
                    <span>
                      <strong style={{ fontSize: 14 }}>{INTERVAL_LABEL[i]}</strong>
                      <span className="muted small" style={{ display: 'block' }}>
                        {INTERVAL_BLURB[i]}
                      </span>
                    </span>
                  </label>
                ))}
              </div>

              {mode === 'weekly' && (
                <div className="row" style={{ gap: 8, marginBottom: 14, alignItems: 'center' }}>
                  <span className="muted small">Send on</span>
                  <select
                    value={weekly}
                    onChange={e => { setWeekly(e.target.value); setNote(null); }}
                    style={selectStyle}
                  >
                    {WEEKDAYS.map(d => (
                      <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>
                    ))}
                  </select>
                </div>
              )}

              {mode === 'monthly' && (
                <div className="row" style={{ gap: 8, marginBottom: 14, alignItems: 'center' }}>
                  <span className="muted small">Send on day</span>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={monthly}
                    onChange={e => {
                      const v = clampDay(e.target.value, 1, 31);
                      setMonthly(v === '' ? 1 : Number(v));
                      setNote(null);
                    }}
                    style={numStyle}
                    aria-label="Day of the month, 1 to 31"
                  />
                  <span className="muted small">of each month, 1–31 (29–31 becomes the last day)</span>
                </div>
              )}

              {mode !== 'manual' && (
                <div className="row" style={{ gap: 8, marginBottom: 14, alignItems: 'center' }}>
                  <span className="muted small">Hold money for</span>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={delay}
                    onChange={e => { setDelay(clampDay(e.target.value, 1, 31)); setNote(null); }}
                    style={numStyle}
                    aria-label="Days before money becomes available, 1 to 31"
                  />
                  {/* The range is stated because it is not guessable. Stripe
                      also enforces its own country floor on top of this and
                      returns a precise message; we do not duplicate that rule
                      here, we just stop the values that are never valid. */}
                  <span className="muted small">days after a traveler pays (1–31)</span>
                </div>
              )}

              <button className="btn btn-primary" onClick={() => void save()} disabled={!dirty || saving}>
                {saving ? 'Saving…' : 'Save schedule'}
              </button>
            </fieldset>

            {status.schedule.interval === 'manual' && (
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
                {canPayOutNow(status) ? (
                  <>
                    <p className="small" style={{ marginBottom: 10 }}>
                      <strong>{formatMoney(availableNow, status.currency ?? 'usd')}</strong> is
                      cleared and ready to send.
                    </p>
                    <button className="btn" onClick={() => void payNow()} disabled={paying}>
                      {paying
                        ? 'Sending…'
                        : `Pay out ${formatMoney(availableNow, status.currency ?? 'usd')} now`}
                    </button>
                  </>
                ) : (
                  <p className="muted small">{describeNothingToPayOut(status)}</p>
                )}
              </div>
            )}
          </>
        )}

        {note && <p className="small" style={{ color: 'var(--ok, inherit)', marginTop: 12 }}>{note}</p>}
        {err && <p className="small" style={{ color: 'var(--danger)', marginTop: 12 }}>{err}</p>}
      </div>
    </div>
  );
}

/**
 * Keep a typed day-number inside its range as it is typed.
 *
 * `min`/`max` on `<input type="number">` do NOT prevent typing — they only drive
 * the spinner arrows and native form validation. Without this, an operator could
 * type 42, press Save, and get a rejection from the server for something the
 * form should never have accepted.
 *
 * Empty stays empty so the field can be cleared and retyped.
 */
function clampDay(raw: string, min: number, max: number): string {
  const digits = raw.replace(/[^0-9]/g, '');
  if (digits === '') return '';
  return String(Math.min(max, Math.max(min, Number(digits))));
}

const selectStyle: React.CSSProperties = {
  padding: '7px 10px',
  borderRadius: 8,
  border: '1px solid var(--line)',
  background: '#fff',
  fontSize: 14,
};
