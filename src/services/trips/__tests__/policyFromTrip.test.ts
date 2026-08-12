import { policyFromTrip, explain, summarise } from '../cancellationPolicy';

describe('policyFromTrip', () => {
  // The whole point of the feature: a trip that never stated terms must not be
  // given any. toPreset() would coerce every one of these to 'standard'.
  it.each([
    ['null preset (every A/B trip)', { cancellation_preset: null }],
    ['column absent (feed RPCs do not select it)', {}],
    ['undefined row', undefined],
    ['null row', null],
    ['a value the type no longer has', { cancellation_preset: 'flexible' }],
    ['nonsense', { cancellation_preset: 'banana' }],
  ])('is null for %s', (_label, row) => {
    expect(policyFromTrip(row as any)).toBeNull();
  });

  it('reads a fixed preset', () => {
    const p = policyFromTrip({ cancellation_preset: 'non_refundable' });
    expect(p).toEqual({ preset: 'non_refundable', rules: [], notes: null });
    expect(explain(p!)).toEqual(['No refund at any time, whenever you cancel.']);
  });

  it('reads custom rules off the wire and keeps the notes', () => {
    const p = policyFromTrip({
      cancellation_preset: 'custom',
      cancellation_rules: [
        { days_before: 30, refund_pct: 50 },
        { days_before: 90, refund_pct: 100 },
      ],
      cancellation_notes: 'Medical emergencies case by case.',
    });
    expect(p!.notes).toBe('Medical emergencies case by case.');
    // explain() sorts furthest-out first and states the tail case.
    expect(explain(p!)).toEqual([
      'Cancel 90+ days before: 100% back',
      'Cancel 30+ days before: 50% back',
      'Less than 30 days before: nothing',
    ]);
  });

  it('survives a malformed rules blob rather than throwing', () => {
    // The column is jsonb and a trigger normalises it, but a trip row can also
    // arrive from a cache written by an older build.
    const p = policyFromTrip({ cancellation_preset: 'custom', cancellation_rules: 'not-an-array' });
    expect(p!.rules).toEqual([]);
    expect(() => summarise(p!)).not.toThrow();
  });

  it('ignores a non-string note', () => {
    const p = policyFromTrip({ cancellation_preset: 'standard', cancellation_notes: 42 });
    expect(p!.notes).toBeNull();
  });
});
