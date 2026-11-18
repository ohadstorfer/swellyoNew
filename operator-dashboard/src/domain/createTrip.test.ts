import { describe, expect, it } from 'vitest';
import {
  INITIAL_STATE,
  buildTripInsert,
  cleanItinerary,
  defaultOperatorCurrency,
  firstInvalidStep,
  normalizePriceInclusions,
  requirementKindsToCreate,
  restoreDraft,
  toUsd,
  toggleStructure,
  uploadItineraryPhotos,
  validateAgeRange,
  validateStep,
  type ValidateContext,
  type WizardState,
} from './createTrip';
import { DEFAULT_POLICY } from './cancellation';

const ctx: ValidateContext = {
  connect: { loading: false, canCollect: true, blocked: false },
  hasDefaultWaiver: false,
  hasWaiverFile: true,
};

const filled: WizardState = {
  ...INITIAL_STATE,
  audienceDone: ['levels', 'boards', 'wave'],
  destination: 'Ericeira',
  startDateISO: '2027-03-01',
  endDateISO: '2027-03-08',
  title: 'Ericeira week',
  heroImage: 'https://cdn/hero.jpg',
  description: 'Waves and food',
  accommodationKind: 'villa',
  accommodationName: 'Casa Mar',
  accommodationUrl: 'https://casa.example',
  accommodationImage: 'https://cdn/stay.jpg',
  costPerPerson: '1000',
};

describe('validateStep', () => {
  it('audience needs the three required cards opened', () => {
    expect(validateStep('audience', INITIAL_STATE, ctx).audience).toBeTruthy();
    expect(validateStep('audience', filled, ctx)).toEqual({});
  });

  it('age range rules match the app', () => {
    expect(validateAgeRange(15, null)).toBe('Ages must be 16-99.');
    expect(validateAgeRange(30, 20)).toMatch(/older/);
    expect(validateAgeRange(20, 22)).toMatch(/4 years/);
    expect(validateAgeRange(20, 24)).toBeNull();
    expect(validateAgeRange(null, 30)).toBeNull();
  });

  it('basics requires destination, dates, title, cover, description', () => {
    const e = validateStep('basics', INITIAL_STATE, ctx);
    expect(Object.keys(e).sort()).toEqual(['description', 'destination', 'heroImage', 'title', 'when']);
    expect(validateStep('basics', { ...filled, endDateISO: '2027-02-01' }, ctx).when).toMatch(/end date/);
  });

  it('vibez requires the stay name, link and photo for an operator', () => {
    expect(validateStep('vibez', { ...filled, accommodationUrl: '' }, ctx).specificStay).toBe(
      'Add a link to the stay.',
    );
  });

  it('budget: price required, private room optional but positive', () => {
    expect(validateStep('budget', { ...filled, costPerPerson: '' }, ctx).price).toBeTruthy();
    expect(validateStep('budget', { ...filled, privateRoomPrice: '0' }, ctx).privatePrice).toBeTruthy();
    expect(validateStep('budget', { ...filled, privateRoomPrice: '1400' }, ctx)).toEqual({});
  });

  it('managed payments respect the Stripe Connect state', () => {
    const managed = { ...filled, paymentMode: 'managed' as const, depositAmount: '200' };
    expect(validateStep('budget', managed, ctx)).toEqual({});
    expect(
      validateStep('budget', managed, { ...ctx, connect: { loading: false, canCollect: false, blocked: false } })
        .deposit,
    ).toMatch(/Connect Stripe/);
    expect(
      validateStep('budget', managed, { ...ctx, connect: { loading: false, canCollect: false, blocked: true } })
        .deposit,
    ).toMatch(/could not approve/);
    expect(validateStep('budget', { ...managed, depositAmount: '1200' }, ctx).deposit).toMatch(/more than the price/);
    expect(
      validateStep('budget', { ...managed, depositAmount: '600', privateRoomPrice: '500' }, ctx).deposit,
    ).toMatch(/private room/);
  });

  it('requirements block without a waiver PDF or default', () => {
    expect(
      validateStep('requirements', filled, { ...ctx, hasWaiverFile: false, hasDefaultWaiver: false }).waiver,
    ).toBeTruthy();
    expect(validateStep('requirements', filled, { ...ctx, hasWaiverFile: false, hasDefaultWaiver: true })).toEqual({});
  });

  it('firstInvalidStep walks in order', () => {
    expect(firstInvalidStep(INITIAL_STATE, ctx)).toBe('audience');
    expect(firstInvalidStep(filled, ctx)).toBeNull();
  });
});

describe('money', () => {
  it('converts to USD with cents, passes USD and null through', () => {
    expect(toUsd(370, 'ILS', 3.7)).toBe(100);
    expect(toUsd(100, 'EUR', 0.9)).toBe(111.11);
    expect(toUsd(100, 'USD', 1)).toBe(100);
    expect(toUsd(null, 'EUR', 0.9)).toBeNull();
  });

  it('defaults the currency from setting, then country', () => {
    expect(defaultOperatorCurrency('EUR', 'Israel')).toBe('EUR');
    expect(defaultOperatorCurrency('BRL', 'Israel')).toBe('ILS');
    expect(defaultOperatorCurrency(null, 'Portugal')).toBe('EUR');
    expect(defaultOperatorCurrency(null, 'Brazil')).toBe('USD');
  });
});

describe('requirementKindsToCreate', () => {
  it('offline: documents + locked waiver, no pay rows', () => {
    const kinds = requirementKindsToCreate({ ...filled, requirementKinds: ['passport'] });
    expect(kinds.sort()).toEqual(['passport', 'waiver']);
  });
  it('managed with deposit adds deposit + balance; without, balance only', () => {
    expect(
      requirementKindsToCreate({ ...filled, paymentMode: 'managed', depositAmount: '100' }),
    ).toEqual(expect.arrayContaining(['deposit', 'balance']));
    const noDep = requirementKindsToCreate({ ...filled, paymentMode: 'managed', depositAmount: '0' });
    expect(noDep).toContain('balance');
    expect(noDep).not.toContain('deposit');
  });
});

describe('buildTripInsert', () => {
  const media = { heroUrl: 'https://h', accommodationImageUrl: 'https://a', galleryUrls: [], itinerary: [] };

  it('writes a public, active operator trip with amounts in USD', () => {
    const row = buildTripInsert(
      { ...filled, paymentMode: 'managed', depositAmount: '200', privateRoomPrice: '1500' },
      { currency: 'EUR', rate: 0.8, policy: DEFAULT_POLICY, rulesWire: [], media },
    );
    expect(row).toMatchObject({
      hosting_style: 'C',
      status: 'active',
      visibility: 'public',
      cost_per_person: 1250,
      deposit_amount: 250,
      private_room_price_usd: 1875,
      budget_currency: 'EUR',
      budget_fx_rate: 0.8,
      offline_payment_due_days_before: null,
      dates_set_in_stone: true,
      specific_stay_selected: true,
      price_inclusions: null,
      target_surf_levels: ['beginner', 'intermediate', 'advanced'],
    });
    expect(row).not.toHaveProperty('itinerary');
    expect(row).not.toHaveProperty('accommodation_gallery_urls');
  });

  it('offline stores the balance due days and no deposit', () => {
    const row = buildTripInsert(
      { ...filled, depositAmount: '200' },
      { currency: 'USD', rate: 1, policy: DEFAULT_POLICY, rulesWire: [], media },
    );
    expect(row.deposit_amount).toBeNull();
    expect(row.offline_payment_due_days_before).toBe(30);
    expect(row.payment_mode).toBe('offline');
  });
});

describe('helpers', () => {
  it('structure toggles drop the opposite tag', () => {
    expect(toggleStructure(['loose_schedule'], 'structured_schedule')).toEqual(['structured_schedule']);
    expect(toggleStructure(['structured_schedule'], 'structured_schedule')).toEqual([]);
  });

  it('empty inclusions become null', () => {
    expect(normalizePriceInclusions({ meals: [] })).toBeNull();
    expect(normalizePriceInclusions({ custom: [{ title: ' ' }] })).toBeNull();
    expect(normalizePriceInclusions({ meals: ['breakfast'] })).toEqual({ meals: ['breakfast'] });
  });

  it('itinerary keeps only titled days, sorted, activities by time', () => {
    const out = cleanItinerary([
      { day: 3, title: ' Boat ', photos: [], activities: [{ time: '10:00', name: 'b', place: '' }, { time: '08:00', name: 'a', place: null }] },
      { day: 1, title: '', photos: ['x'], activities: [] },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('Boat');
    expect(out[0].activities.map(a => a.name)).toEqual(['a', 'b']);
  });

  it('uploads only local itinerary photos', async () => {
    const days = await uploadItineraryPhotos(
      [{ day: 1, title: 'x', photos: ['local:1', 'https://kept'], photoRatios: { 'local:1': 1.5 }, activities: [] }],
      async uri => `https://up/${uri}`,
    );
    expect(days[0].photos).toEqual(['https://up/local:1', 'https://kept']);
    expect(days[0].photoRatios).toEqual({ 'https://up/local:1': 1.5 });
  });

  it('a restored draft drops local images and rejects other versions', () => {
    const d = restoreDraft({ ...filled, heroImage: 'local:9', accommodationGallery: ['local:1', 'https://g'] });
    expect(d?.heroImage).toBeNull();
    expect(d?.accommodationGallery).toEqual(['https://g']);
    expect(restoreDraft({ ...filled, version: 99 })).toBeNull();
  });
});
