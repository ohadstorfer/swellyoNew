import { describe, it, expect } from 'vitest';
import { withoutMedical } from './visibleReview';
import type { TripReview, ReviewItem } from '../services/review';
import type { Requirement } from '../domain/requirements';

const req = (id: string, kind: string): Requirement =>
  ({ id, kind, reqType: kind === 'waiver' ? 'acknowledge' : 'upload', title: kind }) as unknown as Requirement;

const item = (requirementId: string, kind: string, state: string): ReviewItem =>
  ({ requirementId, kind, reqType: 'upload', title: kind, state }) as unknown as ReviewItem;

// The shape seen live on 9 Sep 2026: six items, two approved — one of them the
// medical form. A Manager was shown "1/6 approved" and "Medical form 0/1".
const review = (): TripReview => ({
  requirements: [
    req('passport', 'passport'),
    req('insurance', 'insurance'),
    req('waiver', 'waiver'),
    req('medical', 'medical'),
  ],
  travelers: [
    {
      userId: 'u1',
      items: [
        item('passport', 'passport', 'submitted'),
        item('insurance', 'insurance', 'not_started'),
        item('waiver', 'waiver', 'approved'),
        item('medical', 'medical', 'approved'),
      ],
      toReview: 1,
      done: 2,
      total: 4,
    },
  ],
  totalToReview: 1,
  currentWaiverId: null,
});

describe('withoutMedical', () => {
  it('removes the medical requirement and its items', () => {
    const out = withoutMedical(review());
    expect(out.requirements.map(r => r.id)).not.toContain('medical');
    expect(out.travelers[0].items.map(i => i.kind)).not.toContain('medical');
  });

  it('recomputes the per-traveler counts instead of keeping the ones that included it', () => {
    // The false "1/6" came from counting medical as not done. Removing the
    // item without recomputing would leave a denominator that includes it.
    const out = withoutMedical(review());
    expect(out.travelers[0].done).toBe(1);
    expect(out.travelers[0].total).toBe(3);
    expect(out.travelers[0].toReview).toBe(1);
    expect(out.totalToReview).toBe(1);
  });

  it('records which requirement it hid, so a page reached by URL can say so', () => {
    expect(withoutMedical(review()).hiddenRequirementIds).toEqual(['medical']);
  });

  it('returns the review untouched when the trip asks for no medical form', () => {
    const r = review();
    r.requirements = r.requirements.filter(x => x.kind !== 'medical');
    r.travelers[0].items = r.travelers[0].items.filter(i => i.kind !== 'medical');
    expect(withoutMedical(r)).toBe(r);
  });

  it('never drops anything that is not medical', () => {
    const out = withoutMedical(review());
    expect(out.requirements.map(r => r.id)).toEqual(['passport', 'insurance', 'waiver']);
  });
});
