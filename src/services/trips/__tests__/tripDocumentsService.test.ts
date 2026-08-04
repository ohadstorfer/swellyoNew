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
import { removeRequirement } from '../tripDocumentsService';

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
