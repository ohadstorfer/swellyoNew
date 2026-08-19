// `removeRequirement` — the delete-vs-deactivate decision.
//
// Hard-deleting a requirement CASCADEs its documents and acknowledgements
// away, so the function only deletes when nothing has been sent for it. The
// money ledger (`organized_trip_payment_events`) is the third evidence table
// and the one that cannot be counted the same way: its FK is ON DELETE SET
// NULL, so a delete does not remove the payment — it detaches it. A detached
// row is invisible to `fetchPaidByRequirement` and
// `operator_requirement_pay_state`, both of which key on `requirement_id`, so
// the traveler gets asked to pay a second time for something they already paid.
//
// A pay row always has zero documents and zero acknowledgements, so a
// count-only check sends EVERY pay row down the hard-delete branch. That is
// why the kind check exists rather than a third count.
jest.mock('../../../config/supabase', () => ({ supabase: { from: jest.fn() } }));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('expo-crypto', () => ({}));
jest.mock('../../../utils/imageCompression', () => ({ compressImage: jest.fn() }));

import { supabase } from '../../../config/supabase';
import { removeRequirement, deadlineStepBlocked } from '../tripDocumentsService';

/**
 * Stands in for the three parallel reads plus the write.
 *
 * `requirementRow` is what `organized_trip_requirements` returns for the
 * kind/req_type lookup; `docCount`/`ackCount` are the evidence counts.
 * Returns the `delete`/`update` spies so a test can assert which branch ran —
 * asserting on the return value alone would not catch a function that
 * deletes AND reports 'deactivated'.
 */
function mockTables(opts: {
  requirementRow: { kind: string; req_type: string } | null;
  docCount?: number;
  ackCount?: number;
}) {
  const del = jest.fn(() => ({ eq: jest.fn().mockResolvedValue({ error: null }) }));
  const upd = jest.fn(() => ({ eq: jest.fn().mockResolvedValue({ error: null }) }));

  (supabase.from as jest.Mock).mockImplementation((table: string) => {
    if (table === 'organized_trip_requirements') {
      return {
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            maybeSingle: jest.fn().mockResolvedValue({ data: opts.requirementRow, error: null }),
          })),
        })),
        delete: del,
        update: upd,
      };
    }
    const count = table === 'organized_trip_travelers_documents' ? opts.docCount : opts.ackCount;
    return {
      select: jest.fn(() => ({
        eq: jest.fn().mockResolvedValue({ count: count ?? 0, error: null }),
      })),
    };
  });

  return { del, upd };
}

describe('removeRequirement', () => {
  beforeEach(() => jest.clearAllMocks());

  // The regression this guard exists for. Zero docs, zero acks — exactly what
  // every pay row looks like — and the old count-only check deleted it.
  it.each(['deposit', 'balance'])(
    'never hard-deletes a %s pay row, even with no documents or acknowledgements',
    async kind => {
      const { del, upd } = mockTables({
        requirementRow: { kind, req_type: 'pay' },
        docCount: 0,
        ackCount: 0,
      });

      await expect(removeRequirement('req-pay')).resolves.toBe('deactivated');
      expect(del).not.toHaveBeenCalled();
      expect(upd).toHaveBeenCalledWith({ is_active: false });
    },
  );

  // `req_type` is read first because that is what the database constrains
  // (organized_trip_requirements_pay_kind_match pins req_type and kind
  // together), so it stays correct for a kind this build's catalog has never
  // heard of.
  it('trusts req_type for a pay kind the local catalog does not know', async () => {
    const { del, upd } = mockTables({
      requirementRow: { kind: 'installment_3', req_type: 'pay' },
      docCount: 0,
      ackCount: 0,
    });

    await expect(removeRequirement('req-future')).resolves.toBe('deactivated');
    expect(del).not.toHaveBeenCalled();
    expect(upd).toHaveBeenCalled();
  });

  // The other half: a non-pay row with no evidence must still hard-delete, or
  // "remove it, change your mind, add it back" leaves a graveyard of inactive
  // rows and the insert branch collides on the per-trip unique index.
  it('still hard-deletes an untouched document requirement', async () => {
    const { del, upd } = mockTables({
      requirementRow: { kind: 'passport', req_type: 'document' },
      docCount: 0,
      ackCount: 0,
    });

    await expect(removeRequirement('req-passport')).resolves.toBe('deleted');
    expect(del).toHaveBeenCalled();
    expect(upd).not.toHaveBeenCalled();
  });

  it('deactivates a document requirement once someone has uploaded to it', async () => {
    const { del, upd } = mockTables({
      requirementRow: { kind: 'passport', req_type: 'document' },
      docCount: 3,
      ackCount: 0,
    });

    await expect(removeRequirement('req-passport')).resolves.toBe('deactivated');
    expect(del).not.toHaveBeenCalled();
  });

  it('deactivates a waiver once someone has agreed to it', async () => {
    const { del } = mockTables({
      requirementRow: { kind: 'waiver', req_type: 'acknowledgement' },
      docCount: 0,
      ackCount: 1,
    });

    await expect(removeRequirement('req-waiver')).resolves.toBe('deactivated');
    expect(del).not.toHaveBeenCalled();
  });

  // A failed count reads as null, which must be treated as "there is
  // evidence" — deactivating something empty is recoverable, cascading a real
  // passport away is not.
  it('treats an unreadable count as evidence rather than as zero', async () => {
    const { del } = mockTables({
      requirementRow: { kind: 'passport', req_type: 'document' },
      docCount: undefined,
      ackCount: 0,
    });
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'organized_trip_requirements') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              maybeSingle: jest
                .fn()
                .mockResolvedValue({ data: { kind: 'passport', req_type: 'document' }, error: null }),
            })),
          })),
          delete: del,
          update: jest.fn(() => ({ eq: jest.fn().mockResolvedValue({ error: null }) })),
        };
      }
      return {
        select: jest.fn(() => ({
          eq: jest.fn().mockResolvedValue({ count: null, error: null }),
        })),
      };
    });

    await expect(removeRequirement('req-passport')).resolves.toBe('deactivated');
    expect(del).not.toHaveBeenCalled();
  });
});

/**
 * The past-date rule. Spec: docs/specs/operator-trips/deadline-editing.md §4.
 *
 * Dates are built relative to today so the suite does not rot: a hardcoded
 * 2026 date passes this year and fails next.
 */
describe('deadlineStepBlocked', () => {
  const iso = (daysFromNow: number) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + daysFromNow);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  // Trip in 100 days. 30 days before is +70 from now; the next step up (60)
  // is +40. Both comfortably ahead.
  it('allows a step that still lands in the future', () => {
    expect(deadlineStepBlocked(30, 1, iso(100))).toBe(false);
  });

  // Trip in 10 days. Standing on 7 (three days out), stepping UP to 14 would
  // land four days ago.
  it('blocks a step that lands before today', () => {
    expect(deadlineStepBlocked(7, 1, iso(10))).toBe(true);
  });

  // Minus means FEWER days before, which is a LATER date — always an
  // improvement, so never blocked. Both cases below still RESOLVE to a past
  // date (a trip 10 days out with a 21-day-before deadline is historic either
  // way); blocking them would leave both buttons dead on the one row the
  // operator came to fix. Improving is allowed even when it does not finish
  // the job.
  it('never blocks the minus direction, even when the result is still past', () => {
    expect(deadlineStepBlocked(30, -1, iso(10))).toBe(false);
    expect(deadlineStepBlocked(365, -1, iso(2))).toBe(false);
  });

  // Trip in 30 days, standing on 21. Stepping up to 30 lands exactly today.
  // Today is not the past — the money is due today, and that is a legal thing
  // to ask for.
  //
  // This is the case that caught `new Date('YYYY-MM-DD')` parsing as UTC
  // midnight: west of Greenwich that is the evening before, so "today" read as
  // yesterday and the step was refused. See parseLocalDate.
  it('allows a step that lands exactly today', () => {
    expect(deadlineStepBlocked(21, 1, iso(30))).toBe(false);
  });

  // One day further out. The step now lands yesterday, and must be refused —
  // proving the boundary above is the real edge and not an off-by-one.
  it('blocks the step one day past that boundary', () => {
    expect(deadlineStepBlocked(21, 1, iso(29))).toBe(true);
  });

  // A months-only trip. Nothing resolves to a real date, so there is nothing
  // to compare and nothing to block.
  it('allows everything when the trip has no start date', () => {
    expect(deadlineStepBlocked(7, 1, null)).toBe(false);
    expect(deadlineStepBlocked(365, 1, null)).toBe(false);
  });

  // The ends of the scale belong to isDeadlineAtEnd. Answering true here would
  // disable the button for the wrong reason and make the two guards disagree.
  it('is false at the top of the scale, where no step exists', () => {
    expect(deadlineStepBlocked(365, 1, iso(1))).toBe(false);
  });

  // Not on the scale (an older row). stepDeadline snaps it first; the snapped
  // value is judged, not the original.
  it('judges the snapped value for an off-scale input', () => {
    // 45 snaps to 30 (nearer than 60), which on a trip 10 days out is 20 days
    // ago. Blocked.
    expect(deadlineStepBlocked(45, 1, iso(10))).toBe(true);
  });
});
