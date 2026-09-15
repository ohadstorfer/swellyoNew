// Type-only import below, but the service module still loads the supabase
// client transitively in some paths — mock it so nothing initialises for real.
jest.mock('../../../config/supabase', () => ({ supabase: { from: jest.fn() } }));

import { withoutMedicalReview } from '../visibleReview';
import type { TripReview, ReviewItem } from '../tripDocumentsService';

const item = (requirementId: string, kind: string, state: string): ReviewItem =>
  ({ requirementId, kind, reqType: 'upload', title: kind, state }) as unknown as ReviewItem;

// The shape seen live on 9 Sep 2026: the medical form was one of the two
// approved items, and a Manager was shown it as not done.
const review = (): TripReview => ({
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
});

describe('withoutMedicalReview', () => {
  it('removes the medical items', () => {
    const out = withoutMedicalReview(review());
    expect(out.travelers[0].items.map(i => i.kind)).not.toContain('medical');
  });

  it('recomputes every count instead of keeping the ones that included it', () => {
    const out = withoutMedicalReview(review());
    expect(out.travelers[0].done).toBe(1);
    expect(out.travelers[0].total).toBe(3);
    expect(out.travelers[0].toReview).toBe(1);
    expect(out.totalToReview).toBe(1);
  });

  it('returns the same object when nobody has a medical item', () => {
    const r = review();
    r.travelers[0].items = r.travelers[0].items.filter(i => i.kind !== 'medical');
    expect(withoutMedicalReview(r)).toBe(r);
  });

  it('never drops anything that is not medical', () => {
    const out = withoutMedicalReview(review());
    expect(out.travelers[0].items.map(i => i.kind)).toEqual(['passport', 'insurance', 'waiver']);
  });
});
