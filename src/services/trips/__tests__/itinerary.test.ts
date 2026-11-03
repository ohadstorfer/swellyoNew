import {
  cleanDay,
  cleanItinerary,
  coverSquareSide,
  dayHighlights,
  dayLabel,
  daysPastEnd,
  emptyDay,
  guestDays,
  normalizeItinerary,
  tripCalendarDays,
  tripRangeLabel,
  upsertDay,
  uploadItineraryPhotos,
  type ItineraryDay,
} from '../itinerary';

const planned = (day: number, title = `Day ${day}`): ItineraryDay => ({
  ...emptyDay(day),
  title,
});

describe('tripCalendarDays', () => {
  it('counts both ends, so Jun 15 – 22 is 8 days', () => {
    expect(tripCalendarDays('2026-06-15', '2026-06-22')).toBe(8);
  });

  it('is 1 for a single-day trip', () => {
    expect(tripCalendarDays('2026-06-15', '2026-06-15')).toBe(1);
  });

  it('is 0 without both dates, or when they are reversed', () => {
    expect(tripCalendarDays(null, '2026-06-22')).toBe(0);
    expect(tripCalendarDays('2026-06-22', '2026-06-15')).toBe(0);
  });

  it('is not thrown off by a daylight saving change', () => {
    expect(tripCalendarDays('2026-03-01', '2026-03-31')).toBe(31);
  });
});

describe('labels', () => {
  it('names the weekday and date of each day', () => {
    expect(dayLabel('2026-06-15', 1)).toBe('Day 1 · Mon, Jun 15');
    expect(dayLabel('2026-06-15', 2)).toBe('Day 2 · Tue, Jun 16');
  });

  it('crosses a month', () => {
    expect(dayLabel('2026-06-29', 3)).toBe('Day 3 · Wed, Jul 1');
  });

  it('falls back to the day number with no start date', () => {
    expect(dayLabel(null, 3)).toBe('Day 3');
  });

  it('shortens the range when the month or year repeats', () => {
    expect(tripRangeLabel('2026-06-15', '2026-06-22')).toBe('8 days · Jun 15 – 22, 2026');
    expect(tripRangeLabel('2026-06-29', '2026-07-02')).toBe('4 days · Jun 29 – Jul 2, 2026');
    expect(tripRangeLabel('2026-12-30', '2027-01-02')).toBe(
      '4 days · Dec 30, 2026 – Jan 2, 2027',
    );
  });
});

describe('cleanDay', () => {
  it('trims, drops blank rows and sorts timed activities first', () => {
    const day = cleanDay({
      ...emptyDay(1),
      title: '  Surf  ',
      activities: [
        { time: null, name: 'Free afternoon', place: null },
        { time: '16:00', name: ' Check-in ', place: '  ' },
        { time: '09:00', name: 'Breakfast', place: null },
        { time: '10:00', name: '   ', place: 'Nowhere' },
      ],
    });
    expect(day.title).toBe('Surf');
    expect(day.activities).toEqual([
      { time: '09:00', name: 'Breakfast', place: null },
      { time: '16:00', name: 'Check-in', place: null },
      { time: null, name: 'Free afternoon', place: null },
    ]);
  });

  it('caps the photos', () => {
    const photos = Array.from({ length: 9 }, (_, i) => `p${i}`);
    expect(cleanDay({ ...emptyDay(1), photos }).photos).toHaveLength(6);
  });
});

describe('upsertDay', () => {
  it('replaces a day and keeps the order', () => {
    const days = upsertDay([planned(1), planned(3)], planned(2));
    expect(days.map(d => d.day)).toEqual([1, 2, 3]);
    expect(upsertDay(days, planned(2, 'New'))[1].title).toBe('New');
  });

  it('removes a day left blank', () => {
    expect(upsertDay([planned(1)], emptyDay(1))).toEqual([]);
  });

  it('keeps a day with content but no title yet', () => {
    const draft = { ...emptyDay(1), photos: ['a.jpg'] };
    expect(upsertDay([], draft)).toHaveLength(1);
  });
});

describe('what guests see', () => {
  it('stores only days with a title', () => {
    expect(cleanItinerary([planned(1), { ...emptyDay(2), photos: ['a.jpg'] }])).toHaveLength(1);
  });

  it('hides days past the end of the trip', () => {
    const days = [planned(1), planned(7)];
    expect(guestDays(days, '2026-06-15', '2026-06-20').map(d => d.day)).toEqual([1]);
    expect(daysPastEnd(days, 6).map(d => d.day)).toEqual([7]);
  });

  it('shows everything when the trip has no dates to check against', () => {
    expect(guestDays([planned(9)], null, null)).toHaveLength(1);
    expect(daysPastEnd([planned(9)], 0)).toEqual([]);
  });

  it('joins activity names into the highlights line', () => {
    const day = {
      ...emptyDay(1),
      activities: [
        { time: null, name: 'Surf', place: null },
        { time: null, name: 'Yoga', place: null },
      ],
    };
    expect(dayHighlights(day)).toBe('Surf · Yoga');
  });
});

describe('normalizeItinerary', () => {
  it('survives anything that is not a list', () => {
    expect(normalizeItinerary(null)).toEqual([]);
    expect(normalizeItinerary({ day: 1 })).toEqual([]);
  });

  it('drops bad rows and fills missing fields', () => {
    const days = normalizeItinerary([
      { day: 0, title: 'No' },
      { title: 'No day' },
      null,
      { day: 2, title: 'Second', photos: ['a', 3], activities: [{ name: 'Surf' }, { time: '09:00' }] },
      { day: 1 },
    ]);
    expect(days).toEqual([
      { day: 1, title: '', photos: [], activities: [] },
      {
        day: 2,
        title: 'Second',
        photos: ['a'],
        activities: [{ time: null, name: 'Surf', place: null }],
      },
    ]);
  });
});

describe('photo ratios', () => {
  it('drops the ratio of a photo that is gone', () => {
    const day = cleanDay({ ...emptyDay(1), photos: ['a'], photoRatios: { a: 1.5, b: 2 } });
    expect(day.photoRatios).toEqual({ a: 1.5 });
  });

  it('survives a round trip through the column, ignoring bad values', () => {
    const [day] = normalizeItinerary([{ day: 1, photos: ['a'], photoRatios: { a: 1.5, b: 'x', c: 0 } }]);
    expect(day.photoRatios).toEqual({ a: 1.5 });
  });

  it('follows a photo from its local file to its uploaded URL', async () => {
    const [day] = await uploadItineraryPhotos(
      [{ ...emptyDay(1), photos: ['file:///a.jpg'], photoRatios: { 'file:///a.jpg': 1.5 } }],
      async () => 'https://s3/a.jpg',
    );
    expect(day.photoRatios).toEqual({ 'https://s3/a.jpg': 1.5 });
  });
});

describe('coverSquareSide', () => {
  it('is the drawn height of a landscape photo wider than the frame needs', () => {
    expect(coverSquareSide(358, 210, 4 / 3)).toBeCloseTo(268.5);
  });

  it('is the frame height for a panorama', () => {
    expect(coverSquareSide(358, 210, 3)).toBe(210);
  });

  it('is the frame width for a portrait photo', () => {
    expect(coverSquareSide(358, 210, 0.75)).toBe(358);
  });

  it('fills the frame when the ratio is unknown', () => {
    expect(coverSquareSide(358, 210, null)).toBe(358);
  });
});

describe('uploadItineraryPhotos', () => {
  it('uploads local files one at a time and leaves remote URLs alone', async () => {
    let running = 0;
    let peak = 0;
    const upload = jest.fn(async (uri: string) => {
      running += 1;
      peak = Math.max(peak, running);
      await Promise.resolve();
      running -= 1;
      return `https://s3/${uri}`;
    });
    const days = await uploadItineraryPhotos(
      [
        { ...emptyDay(1), photos: ['file:///a.jpg', 'https://s3/old.jpg'] },
        { ...emptyDay(2), photos: ['file:///b.jpg'] },
      ],
      upload,
    );
    expect(upload).toHaveBeenCalledTimes(2);
    expect(peak).toBe(1);
    expect(days[0].photos).toEqual(['https://s3/file:///a.jpg', 'https://s3/old.jpg']);
    expect(days[1].photos).toEqual(['https://s3/file:///b.jpg']);
  });

  it('fails the whole upload rather than dropping a photo', async () => {
    const upload = jest.fn().mockRejectedValue(new Error('nope'));
    await expect(
      uploadItineraryPhotos([{ ...emptyDay(1), photos: ['file:///a.jpg'] }], upload),
    ).rejects.toThrow('nope');
  });
});
