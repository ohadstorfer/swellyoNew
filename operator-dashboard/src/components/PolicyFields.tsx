import type { CSSProperties } from 'react';
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

/**
 * The refund-terms form, with no opinion about where it saves.
 *
 * Extracted on 4 September 2026 so the operator's DEFAULT policy (Settings) and
 * ONE TRIP's frozen policy (the trip page) share a single form. Two copies of a
 * refund ladder is exactly the drift this project keeps writing warnings about,
 * and the trip editor is the second caller that made it real.
 *
 * Controlled and pure: the caller owns the draft and the save. The only thing
 * this file decides is what the form looks like and, through `explain()`, what
 * it says the traveler will see.
 */
export function PolicyFields({
  value,
  onChange,
  disabled,
}: {
  value: CancellationPolicy;
  onChange: (next: CancellationPolicy) => void;
  disabled?: boolean;
}) {
  const rules = value.rules.length > 0 ? value.rules : [{ daysBefore: 60, refundPct: 100 }];
  const problems = validate(value);

  const setRule = (i: number, patch: Partial<CancellationRule>) =>
    onChange({ ...value, rules: rules.map((r, n) => (n === i ? { ...r, ...patch } : r)) });

  return (
    <>
      <div style={{ display: 'grid', gap: 12, marginBottom: 16 }}>
        {PRESETS.map(p => (
          <label
            key={p}
            className="row"
            style={{ gap: 12, alignItems: 'flex-start', cursor: disabled ? 'default' : 'pointer' }}
          >
            <input
              type="radio"
              name={`preset-${p}`}
              checked={value.preset === p}
              disabled={disabled}
              onChange={() => onChange({ ...value, preset: p, rules })}
              style={{ marginTop: 4 }}
            />
            <span>
              <strong style={{ fontSize: 'var(--fs-md)', lineHeight: '20px' }}>{PRESET_LABEL[p]}</strong>
              <span className="muted small" style={{ display: 'block' }}>
                {PRESET_BLURB[p]}
              </span>
            </span>
          </label>
        ))}
      </div>

      {value.preset === 'custom' && (
        <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
          {rules.map((r, i) => (
            <div key={i} className="row" style={{ gap: 8 }}>
              <input
                type="number"
                value={r.daysBefore}
                min={0}
                max={3650}
                disabled={disabled}
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
                disabled={disabled}
                onChange={e => setRule(i, { refundPct: Number(e.target.value) })}
                style={numStyle}
                aria-label="Percent refunded"
              />
              <span className="muted small">% back</span>
              {rules.length > 1 && (
                <button
                  className="btn btn-sm"
                  disabled={disabled}
                  onClick={() =>
                    onChange({ ...value, rules: rules.filter((_, n) => n !== i) })
                  }
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
              disabled={disabled}
              onClick={() => {
                // Halfway to the next boundary, or a week out — a sensible
                // second step, never a duplicate of one that already exists.
                const lowest = rules.reduce(
                  (m, r) => Math.min(m, r.daysBefore),
                  Number.MAX_SAFE_INTEGER,
                );
                const next = Number.isFinite(lowest) && lowest > 7 ? Math.floor(lowest / 2) : 7;
                onChange({ ...value, rules: [...rules, { daysBefore: next, refundPct: 50 }] });
              }}
            >
              Add a step
            </button>
          </div>
        </div>
      )}

      {/* The policy in sentences, rebuilt as they type. A refund ladder is easy
          to write backwards and hard to spot in numbers. */}
      {problems.length === 0 && (
        <div
          style={{
            background: 'var(--panel)',
            borderRadius: 8,
            padding: 12,
            marginBottom: 16,
          }}
        >
          <div
            className="muted"
            style={{
              fontSize: 'var(--fs-s)',
              lineHeight: '18px',
              marginBottom: 4,
            }}
          >
            Travelers will see
          </div>
          {explain(value).map((l, i) => (
            <div key={i} className="small" style={{ lineHeight: 1.6 }}>
              • {l}
            </div>
          ))}
        </div>
      )}

      <label className="small" style={{ display: 'block', marginBottom: 8 }}>
        Notes (optional)
      </label>
      <textarea
        value={value.notes ?? ''}
        maxLength={2000}
        disabled={disabled}
        onChange={e => onChange({ ...value, notes: e.target.value })}
        placeholder="Anything the steps above cannot say — for example, medical emergencies handled case by case."
        style={{
          width: '100%',
          minHeight: 76,
          padding: 12,
          borderRadius: 8,
          border: '1px solid var(--line)',
          fontSize: 'var(--fs-md)',
          lineHeight: '20px',
          fontFamily: 'inherit',
          resize: 'vertical',
        }}
      />

      {problems.map((p, i) => (
        <p key={i} className="small" style={{ color: 'var(--danger)', marginTop: 8 }}>
          {p}
        </p>
      ))}
    </>
  );
}

const numStyle: CSSProperties = {
  width: 78,
  padding: '8px 8px',
  borderRadius: 8,
  border: '1px solid var(--line)',
  fontSize: 'var(--fs-md)',
  lineHeight: '20px',
};
