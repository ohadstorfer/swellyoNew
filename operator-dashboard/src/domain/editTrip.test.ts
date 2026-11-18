import { describe, expect, it } from 'vitest';
import {
  TRIP_STRUCTURE_MUTEX,
  ageLabel,
  boardsForSave,
  canCollectPayments,
  datesConfirmMessage,
  datesPatch,
  datesRule,
  depositForSave,
  describeDeadlineShift,
  destinationConfirmMessage,
  destinationFromPlace,
  extractCityAndCountry,
  offlineDeadlineLabel,
  optionalArrayForSave,
  parseWhole,
  paymentModeBlocker,
  privateRoomForSave,
  sameStringSet,
  selectableLevels,
  stayPatch,
  toggleSingle,
  toggleWithMutex,
  validateAgeRange,
  validateDates,
  validatePriceSet,
  validateSpots,
  validateStay,
  validateTitle,
  validateWave,
  type DeadlineRow,
  type StayDraft,
} from './editTrip';
import {
  inclusionsForSave,
  normalizePriceInclusions,
  pruneBlankCustomInclusions,
  readPriceInclusions,
  summarizeCategory,
} from './priceInclusions';
import {
  cleanItinerary,
  dayLabel,
  dayNeedsTitle,
  dayNumbersToShow,
  normalizeItinerary,
  tripCalendarDays,
  upsertDay,
} from './itinerary';

describe('spots', () => {
  it('allows 2..50 and nothing under who is aboard', () => {
    expect(validateSpots(12, 3)).toBeNull();
    expect(validateSpots(1, 1)).toMatch(/at least 2/);
    expect(validateSpots(51, 1)).toMatch(/50/);
    expect(validateSpots(4, 6)).toMatch(/6 people/);
    expect(validateSpots(6, 6)).toBeNull();
    expect(validateSpots(null, 6)).toBeNull();
    expect(validateSpots(4.5, 1)).toMatch(/whole/);
  });
});

describe('age range', () => {
  it('bounds each end 16-99 before the pair rules', () => {
    expect(validateAgeRange(15, null)).toMatch(/16-99/);
    expect(validateAgeRange(null, 100)).toMatch(/16-99/);
    expect(validateAgeRange(20, null)).toBeNull();
  });
  it('needs the window to be at least 4 years', () => {
    expect(validateAgeRange(20, 23)).toMatch(/4 years/);
    expect(validateAgeRange(20, 24)).toBeNull();
    expect(validateAgeRange(30, 20)).toMatch(/older/);
  });
  it('labels every combination', () => {
    expect(ageLabel(null, null)).toBe('All ages');
    expect(ageLabel(18, null)).toBe('18+');
    expect(ageLabel(null, 40)).toBe('Up to 40');
    expect(ageLabel(18, 40)).toBe('18 – 40');
  });
});

describe('multi-select', () => {
  it('drops the other half of a mutex pair', () => {
    expect(toggleWithMutex(['structured_schedule', 'shared_decisions'], 'loose_schedule', TRIP_STRUCTURE_MUTEX))
      .toEqual(['shared_decisions', 'loose_schedule']);
  });
  it('untoggles a selected option', () => {
    expect(toggleWithMutex(['a', 'b'], 'a')).toEqual(['b']);
  });
  it('vibe is single-select and clearable', () => {
    expect(toggleSingle(['explore'], 'vacation')).toEqual(['vacation']);
    expect(toggleSingle(['explore'], 'explore')).toEqual([]);
  });
  it('compares as sets', () => {
    expect(sameStringSet(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameStringSet(['a'], ['a', 'b'])).toBe(false);
  });
  it('writes empty boards as all, empty structure as null', () => {
    expect(boardsForSave([])).toEqual(['all']);
    expect(boardsForSave(['longboard'])).toEqual(['longboard']);
    expect(optionalArrayForSave([])).toBeNull();
  });
  it('hides the stored "all" marker from the picker', () => {
    expect(selectableLevels(['all'])).toEqual([]);
    expect(selectableLevels(['beginner', 'all'])).toEqual(['beginner']);
  });
});

describe('title and wave', () => {
  it('refuses a blank title', () => {
    expect(validateTitle('  ')).toMatch(/name/);
    expect(validateTitle('Bali')).toBeNull();
  });
  it('needs a shape and a sane size', () => {
    expect(validateWave(null, 2, 4)).toMatch(/shape/);
    expect(validateWave('soft', 5, 4)).not.toBeNull();
    expect(validateWave('barrel', 4, 8)).toBeNull();
  });
});

describe('price set', () => {
  it('mirrors the deposit and private-room CHECKs', () => {
    expect(validatePriceSet(null, null, null)).toMatch(/price per person/);
    expect(validatePriceSet(1000, 1200, null)).toMatch(/deposit cannot/);
    expect(validatePriceSet(1000, 600, 500)).toMatch(/private room/);
    expect(validatePriceSet(1000, 300, 1500)).toBeNull();
  });
  it('treats 0 as none for private room and deposit', () => {
    expect(privateRoomForSave(0)).toBeNull();
    expect(privateRoomForSave(1500)).toBe(1500);
    expect(depositForSave(0)).toBeNull();
  });
});

describe('stay', () => {
  const base: StayDraft = {
    kind: 'villa',
    name: 'Casa Azul',
    url: ' https://x.y ',
    imageUrl: 'https://img/1.jpg',
    galleryUrls: ['a', 'b'],
    stokeCertified: true,
    ciSurfConservation: false,
  };
  it('needs a type and a name', () => {
    expect(validateStay({ ...base, kind: null })).toMatch(/type/);
    expect(validateStay({ ...base, name: ' ' })).toMatch(/name/);
    expect(validateStay(base)).toBeNull();
  });
  it('drops the gallery without a main photo', () => {
    expect(stayPatch({ ...base, imageUrl: null }).accommodation_gallery_urls).toBeNull();
    expect(stayPatch(base)).toMatchObject({
      accommodation_type: ['villa'],
      accommodation_url: 'https://x.y',
      accommodation_gallery_urls: ['a', 'b'],
      specific_stay_selected: true,
      stoke_certified: true,
      ci_surf_conservation: false,
    });
  });
});

describe('dates', () => {
  const initial = { startDate: '2027-03-10', endDate: '2027-03-17', dateMonths: [], durationDays: 8 };
  it('holds the length to ±5 days of the original', () => {
    expect(datesRule(initial)).toMatchObject({ minDays: 3, maxDays: 13 });
    expect(validateDates('2027-04-01', '2027-04-08', initial, '2026-11-18')).toBeNull();
    expect(validateDates('2027-04-01', '2027-04-30', initial, '2026-11-18')).toMatch(/3-13 days/);
    expect(validateDates('2027-04-08', '2027-04-01', initial, '2026-11-18')).toMatch(/after/);
    expect(validateDates(null, '2027-04-01', initial)).toMatch(/Pick/);
  });
  it('keeps a loose-month window and never before today', () => {
    const loose = { ...initial, dateMonths: ['2026-12', '2026-11'] };
    expect(datesRule(loose, '2026-11-18')).toMatchObject({ minStart: '2026-11-18', maxEnd: '2026-12-31' });
    expect(validateDates('2026-11-10', '2026-11-17', loose, '2026-11-18')).toMatch(/months/);
    expect(validateDates('2026-12-20', '2027-01-02', loose, '2026-11-18')).toMatch(/months/);
  });
  it('writes the app patch', () => {
    expect(datesPatch('2027-04-01', '2027-04-08', { ...initial, dateMonths: ['2027-04'] })).toEqual({
      start_date: '2027-04-01',
      end_date: '2027-04-08',
      dates_set_in_stone: true,
      date_months: ['2027-04'],
      duration_days: 8,
    });
  });
});

describe('describeDeadlineShift', () => {
  const rows: DeadlineRow[] = [
    { id: 'b', kind: 'balance', skippable: true, daysBefore: 30, isActive: true },
    { id: 'p', kind: 'passport', skippable: true, daysBefore: 14, isActive: true },
    { id: 'w', kind: 'waiver', skippable: false, daysBefore: 30, isActive: true },
    { id: 'v', kind: 'visa', skippable: true, daysBefore: 7, isActive: false },
  ];
  it('names the payment date then counts documents', () => {
    expect(
      describeDeadlineShift({
        currentStart: '2027-03-10',
        nextStart: '2027-04-10',
        paymentMode: 'managed',
        offlineDaysBefore: null,
        requirements: rows,
        today: '2026-11-18',
      }),
    ).toBe('The final payment moves to 11 Mar 2027. 1 document deadline moves with it.');
  });
  it('uses the offline column on an offline trip and counts the past', () => {
    expect(
      describeDeadlineShift({
        currentStart: '2027-03-10',
        nextStart: '2026-12-01',
        paymentMode: 'offline',
        offlineDaysBefore: 30,
        // An offline trip's pay rows are inactive (trg_deactivate_pay_rows_when_offline).
        requirements: rows.map(r => (r.kind === 'balance' ? { ...r, isActive: false } : r)),
        today: '2026-11-18',
      }),
    ).toBe('The final payment moves to 1 Nov 2026. 1 document deadline moves with it. 2 land in the past.');
  });
  it('says nothing when the start does not move, and says loading', () => {
    const base = { currentStart: '2027-03-10', paymentMode: 'managed', offlineDaysBefore: null };
    expect(describeDeadlineShift({ ...base, nextStart: '2027-03-10', requirements: rows })).toBe('');
    expect(describeDeadlineShift({ ...base, nextStart: '2027-03-11', requirements: undefined })).toMatch(/loading/);
  });
});

describe('confirms', () => {
  it('skip when nobody is on the trip', () => {
    expect(datesConfirmMessage(0, 'x')).toBeNull();
    expect(destinationConfirmMessage(0)).toBeNull();
  });
  it('word the count', () => {
    expect(datesConfirmMessage(1, '')).toMatch(/^1 traveler signed up.*let them know/);
    expect(datesConfirmMessage(3, 'Shift.')).toMatch(/them all.*\n\nShift\.$/s);
    expect(destinationConfirmMessage(2)).toMatch(/2 travelers joined/);
  });
});

describe('getting paid', () => {
  it('lets a reviewing account turn collection on, not a blocked one', () => {
    expect(canCollectPayments('under_review')).toBe(true);
    expect(canCollectPayments('incomplete')).toBe(false);
  });
  it('checks price, then loading, then Stripe', () => {
    const base = { next: 'managed' as const, costPerPerson: 1000, connectLoading: false };
    expect(paymentModeBlocker({ ...base, next: 'offline', connectState: null })).toBeNull();
    expect(paymentModeBlocker({ ...base, costPerPerson: null, connectState: 'ready' })).toMatch(/price/);
    expect(paymentModeBlocker({ ...base, connectLoading: true, connectState: null })).toMatch(/Checking/);
    expect(paymentModeBlocker({ ...base, connectState: 'blocked' })).toMatch(/could not approve/);
    expect(paymentModeBlocker({ ...base, connectState: 'not_started' })).toMatch(/Connect Stripe/);
    expect(paymentModeBlocker({ ...base, connectState: 'ready' })).toBeNull();
  });
  it('labels the offline deadline', () => {
    expect(offlineDeadlineLabel(null)).toBe('None');
    expect(offlineDeadlineLabel(1)).toBe('1 day before the trip');
    expect(offlineDeadlineLabel(30)).toBe('30 days before the trip');
  });
});

describe('destination', () => {
  it('falls back through the city chain and takes the ISO country', () => {
    expect(
      extractCityAndCountry([
        { types: ['administrative_area_level_2'], longText: 'Badung Regency' },
        { types: ['country'], longText: 'Indonesia', shortText: 'ID' },
      ]),
    ).toEqual({ locality: 'Badung Regency', country: 'ID' });
  });
  it('maps a Places details response', () => {
    expect(
      destinationFromPlace(
        {
          id: 'pid',
          displayName: { text: 'Uluwatu' },
          location: { latitude: -8.8, longitude: 115.1 },
          addressComponents: [{ types: ['locality'], longText: 'Pecatu' }],
        },
        { placeId: 'x', mainText: 'Uluwatu', secondaryText: 'Bali' },
      ),
    ).toEqual({
      place_id: 'pid',
      name: 'Uluwatu',
      short_label: 'Uluwatu, Pecatu',
      formatted_address: 'Uluwatu, Bali',
      locality: 'Pecatu',
      country: null,
      lat: -8.8,
      lng: 115.1,
    });
  });
});

describe('parseWhole', () => {
  it('reads digits only', () => {
    expect(parseWhole(' 12 ')).toBe(12);
    expect(parseWhole('')).toBeNull();
    expect(parseWhole('1.5')).toBeNull();
  });
});

describe('price inclusions', () => {
  it('prunes blank custom rows and stores null for an empty object', () => {
    expect(pruneBlankCustomInclusions({ custom: [{ title: ' ' }, { title: 'Hat' }] }).custom).toEqual([
      { title: 'Hat' },
    ]);
    expect(inclusionsForSave({ custom: [{ title: '' }] })).toBeNull();
    expect(normalizePriceInclusions({ meals: [] })).toBeNull();
    expect(inclusionsForSave({ meals: ['lunch'] })).toEqual({ meals: ['lunch'], custom: [] });
  });
  it('reads legacy string wellness', () => {
    expect(readPriceInclusions({ wellness: ['yoga'] }).wellness).toEqual([{ key: 'yoga', payment: 'included' }]);
    expect(readPriceInclusions(null)).toEqual({});
  });
  it('summarises like the app', () => {
    expect(summarizeCategory({ surfFilm: { media: ['video', 'photo'], count: 2, filmTypes: ['drone'] } }, 'surfFilm'))
      .toBe('Video and photo, 2 sessions of drone');
    expect(summarizeCategory({ wellness: [{ key: 'yoga', payment: 'extra' }] }, 'wellness')).toBe('Yoga (extra)');
    expect(summarizeCategory({ videoAnalysis: { included: true } }, 'videoAnalysis')).toBe('Included');
  });
});

describe('itinerary', () => {
  it('counts calendar days, both ends', () => {
    expect(tripCalendarDays('2027-06-15', '2027-06-22')).toBe(8);
    expect(tripCalendarDays(null, '2027-06-22')).toBe(0);
  });
  it('labels a day from the start date', () => {
    expect(dayLabel('2027-06-15', 2)).toBe('Day 2 · Wed, Jun 16');
    expect(dayLabel(null, 2)).toBe('Day 2');
  });
  it('stores only titled days, activities timed first', () => {
    const stored = cleanItinerary([
      { day: 2, title: ' Reef ', photos: [], activities: [
        { time: null, name: 'Lunch', place: null },
        { time: '06:00', name: 'Dawn', place: ' Ulu ' },
        { time: null, name: ' ', place: null },
      ] },
      { day: 1, title: '', photos: ['p'], activities: [] },
    ]);
    expect(stored).toEqual([
      { day: 2, title: 'Reef', photos: [], activities: [
        { time: '06:00', name: 'Dawn', place: 'Ulu' },
        { time: null, name: 'Lunch', place: null },
      ] },
    ]);
  });
  it('flags a day with photos and no title', () => {
    expect(dayNeedsTitle({ day: 1, title: '', photos: ['p'], activities: [] })).toBe(true);
  });
  it('removes a day left blank on upsert', () => {
    const days = [{ day: 1, title: 'A', photos: [], activities: [] }];
    expect(upsertDay(days, { day: 1, title: '', photos: [], activities: [] })).toEqual([]);
  });
  it('reads junk defensively and keeps ratios', () => {
    expect(normalizeItinerary([null, { day: 0 }, { day: 3, title: 7, photos: ['u', 4], photoRatios: { u: 1.5, v: -1 } }]))
      .toEqual([{ day: 3, title: '', photos: ['u'], photoRatios: { u: 1.5 }, activities: [] }]);
  });
  it('shows every trip day plus planned days past the end', () => {
    expect(dayNumbersToShow([{ day: 5, title: 'x', photos: [], activities: [] }], 3)).toEqual([1, 2, 3, 5]);
  });
});
