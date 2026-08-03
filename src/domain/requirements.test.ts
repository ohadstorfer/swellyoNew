import { describe, it, expect } from 'vitest';
import {
  deriveState,
  compareRequirements,
  todayISO,
  type Requirement,
} from './requirements';

const TODAY = '2026-08-02';

const req = (o: Partial<Requirement> = {}): Requirement => ({
  id: 'r1',
  kind: 'passport',
  reqType: 'upload',
  title: 'Passport',
  dueDate: null,
  sortOrder: 0,
  skipAtOnboarding: 'must_have',
  ...o,
});

const doc = (o: Record<string, unknown> = {}) => ({
  id: 'd1',
  userId: 'u1',
  requirementId: 'r1',
  storagePath: 'trip/u1/d1.jpg',
  uploadedAt: '2026-08-01',
  approvedAt: null,
  rejectedAt: null,
  note: null,
  fileDeletedAt: null,
  ...o,
});

describe('deriveState — uploads', () => {
  it('is not_started with no evidence', () => {
    expect(deriveState(req(), {}, TODAY)).toBe('not_started');
  });

  it('is submitted when a document exists but is unapproved', () => {
    expect(deriveState(req(), { doc: doc() }, TODAY)).toBe('submitted');
  });

  it('is approved when the document is approved', () => {
    expect(deriveState(req(), { doc: doc({ approvedAt: '2026-08-01' }) }, TODAY))
      .toBe('approved');
  });

  it('is rejected when the document is rejected', () => {
    expect(deriveState(req(), { doc: doc({ rejectedAt: '2026-08-01' }) }, TODAY))
      .toBe('rejected');
  });

  it('prefers rejected over approved when both are somehow set', () => {
    const both = doc({ approvedAt: '2026-08-01', rejectedAt: '2026-08-02' });
    expect(deriveState(req(), { doc: both }, TODAY)).toBe('rejected');
  });

  it('is overdue past the due date with no evidence', () => {
    expect(deriveState(req({ dueDate: '2026-07-01' }), {}, TODAY)).toBe('overdue');
  });

  it('is NOT overdue when something was submitted late', () => {
    expect(deriveState(req({ dueDate: '2026-07-01' }), { doc: doc() }, TODAY))
      .toBe('submitted');
  });

  it('is not overdue on the due date itself', () => {
    expect(deriveState(req({ dueDate: TODAY }), {}, TODAY)).toBe('not_started');
  });

  it('keeps its state after the file is purged', () => {
    const purged = doc({ approvedAt: '2026-08-01', fileDeletedAt: '2026-09-01' });
    expect(deriveState(req(), { doc: purged }, TODAY)).toBe('approved');
  });
});

describe('deriveState — acknowledge is checked BEFORE medical', () => {
  it('treats a medical-kind acknowledge item as an agreement, not a form', () => {
    const r = req({ kind: 'medical', reqType: 'acknowledge' });
    const ack = { userId: 'u1', requirementId: 'r1', agreedAt: '2026-08-01', operatorDocumentId: null };
    // If `medical` were tested first this would read the (absent) medical form
    // and wrongly return not_started.
    expect(deriveState(r, { ack }, TODAY)).toBe('approved');
  });

  it('counts a waiver agreement only against the current version', () => {
    const r = req({ kind: 'waiver', reqType: 'acknowledge' });
    const stale = {
      ack: { userId: 'u1', requirementId: 'r1', agreedAt: '2026-07-01', operatorDocumentId: 'v1' },
      currentWaiverId: 'v2',
    };
    expect(deriveState(r, stale, TODAY)).toBe('not_started');
  });

  it('accepts a waiver agreement on the current version', () => {
    const r = req({ kind: 'waiver', reqType: 'acknowledge' });
    const fresh = {
      ack: { userId: 'u1', requirementId: 'r1', agreedAt: '2026-08-01', operatorDocumentId: 'v2' },
      currentWaiverId: 'v2',
    };
    expect(deriveState(r, fresh, TODAY)).toBe('approved');
  });

  it('does not version-check a non-waiver agreement', () => {
    const r = req({ kind: 'house_rules', reqType: 'acknowledge' });
    const ack = { userId: 'u1', requirementId: 'r1', agreedAt: '2026-08-01', operatorDocumentId: null };
    expect(deriveState(r, { ack, currentWaiverId: 'v2' }, TODAY)).toBe('approved');
  });
});

describe('deriveState — medical form', () => {
  it('is approved once the form is completed', () => {
    const r = req({ kind: 'medical', reqType: 'fill' });
    expect(deriveState(r, { medical: { userId: 'u1', completedAt: '2026-08-01' } }, TODAY))
      .toBe('approved');
  });

  it('is not_started when the form row exists but was never completed', () => {
    const r = req({ kind: 'medical', reqType: 'fill' });
    expect(deriveState(r, { medical: { userId: 'u1', completedAt: null } }, TODAY))
      .toBe('not_started');
  });

  it('ignores any document row on a medical requirement', () => {
    const r = req({ kind: 'medical', reqType: 'fill' });
    expect(deriveState(r, { doc: doc({ approvedAt: '2026-08-01' }) }, TODAY))
      .toBe('not_started');
  });
});

describe('compareRequirements', () => {
  it('puts must-haves before skippable ones', () => {
    const must = req({ id: 'a', skipAtOnboarding: 'must_have' });
    const later = req({ id: 'b', skipAtOnboarding: 'can_skip' });
    expect([later, must].sort(compareRequirements).map(r => r.id)).toEqual(['a', 'b']);
  });

  it('orders by deadline within the same group', () => {
    const soon = req({ id: 'a', dueDate: '2026-08-10' });
    const late = req({ id: 'b', dueDate: '2026-09-10' });
    expect([late, soon].sort(compareRequirements).map(r => r.id)).toEqual(['a', 'b']);
  });
});

describe('todayISO', () => {
  it('uses the local calendar date, not UTC', () => {
    // 00:30 local on 2 Aug is still 1 Aug in UTC. Using UTC here would mark
    // deadlines overdue a day early for anyone west of Greenwich.
    const localMidnightish = new Date(2026, 7, 2, 0, 30);
    expect(todayISO(localMidnightish)).toBe('2026-08-02');
  });

  it('zero-pads months and days', () => {
    expect(todayISO(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
