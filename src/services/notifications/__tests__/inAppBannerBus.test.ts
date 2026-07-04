import {
  showInAppBanner,
  subscribeInAppBanner,
  __resetInAppBannerBusForTests,
} from '../inAppBannerBus';

const payload = (id: string) => ({ id, title: 'T', body: 'B' });

describe('inAppBannerBus', () => {
  beforeEach(() => __resetInAppBannerBusForTests());

  it('delivers a shown banner to the subscriber', () => {
    const seen: string[] = [];
    subscribeInAppBanner((p) => seen.push(p.id));
    showInAppBanner(payload('a'));
    expect(seen).toEqual(['a']);
  });

  it('dedupes consecutive same-id shows', () => {
    const seen: string[] = [];
    subscribeInAppBanner((p) => seen.push(p.id));
    showInAppBanner(payload('a'));
    showInAppBanner(payload('a'));
    showInAppBanner(payload('b'));
    showInAppBanner(payload('a')); // non-consecutive: allowed again
    expect(seen).toEqual(['a', 'b', 'a']);
  });

  it('is silent with no subscriber and unsubscribe works', () => {
    expect(() => showInAppBanner(payload('a'))).not.toThrow();
    const seen: string[] = [];
    const unsub = subscribeInAppBanner((p) => seen.push(p.id));
    unsub();
    showInAppBanner(payload('b'));
    expect(seen).toEqual([]);
  });

  it('last subscriber wins (single host)', () => {
    const a: string[] = [];
    const b: string[] = [];
    subscribeInAppBanner((p) => a.push(p.id));
    subscribeInAppBanner((p) => b.push(p.id));
    showInAppBanner(payload('x'));
    expect(a).toEqual([]);
    expect(b).toEqual(['x']);
  });
});
