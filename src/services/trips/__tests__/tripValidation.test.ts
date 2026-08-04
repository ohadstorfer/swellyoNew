// Pure rules — no supabase mock needed, the module imports nothing from config.
import {
  validateAgeRange,
  validateDates,
  validateStay,
  validatePrice,
  validateDeposit,
  validateSpots,
} from '../tripValidation';

describe('validateAgeRange', () => {
  it('accepts a range wider than the window', () => {
    expect(validateAgeRange(25, 35, 4)).toBeNull();
  });

  it('accepts a range exactly the window wide', () => {
    expect(validateAgeRange(25, 29, 4)).toBeNull();
  });

  it('rejects a range narrower than the window', () => {
    expect(validateAgeRange(25, 27, 4)).toMatch(/4 years/);
  });

  it('rejects max below min', () => {
    expect(validateAgeRange(35, 25, 4)).toMatch(/older/);
  });

  it('rejects ages outside 16-99', () => {
    expect(validateAgeRange(15, 30, 4)).toMatch(/16/);
    expect(validateAgeRange(20, 100, 4)).toMatch(/99/);
  });

  // An operator who has not opened the age sheet yet has nulls. That is not an
  // error on its own — the screen decides whether the field is required.
  it('accepts nulls', () => {
    expect(validateAgeRange(null, null, 4)).toBeNull();
  });

  // Half-filled sheet. Nothing in the database enforces the 16-99 floor, so a
  // one-sided value has to be caught here or not at all.
  it('still bounds a lone minimum', () => {
    expect(validateAgeRange(5, null, 4)).toMatch(/16/);
  });

  it('still bounds a lone maximum', () => {
    expect(validateAgeRange(null, 120, 4)).toMatch(/99/);
  });

  it('accepts an in-range lone value', () => {
    expect(validateAgeRange(25, null, 4)).toBeNull();
    expect(validateAgeRange(null, 40, 4)).toBeNull();
  });
});

describe('validateDates', () => {
  it('accepts an end date after the start', () => {
    expect(validateDates({
      mode: 'exact', startDate: '2026-09-01', endDate: '2026-09-08',
      months: [], durationDays: null,
    })).toBeNull();
  });

  it('accepts a one-day trip (same start and end)', () => {
    expect(validateDates({
      mode: 'exact', startDate: '2026-09-01', endDate: '2026-09-01',
      months: [], durationDays: null,
    })).toBeNull();
  });

  it('rejects an end date before the start', () => {
    expect(validateDates({
      mode: 'exact', startDate: '2026-09-08', endDate: '2026-09-01',
      months: [], durationDays: null,
    })).toMatch(/after/);
  });

  it('rejects exact mode with no dates', () => {
    expect(validateDates({
      mode: 'exact', startDate: null, endDate: null, months: [], durationDays: null,
    })).toMatch(/dates/);
  });

  it('accepts month mode with a month and a length', () => {
    expect(validateDates({
      mode: 'months', startDate: null, endDate: null,
      months: ['2026-09'], durationDays: 7,
    })).toBeNull();
  });

  it('rejects month mode with no month', () => {
    expect(validateDates({
      mode: 'months', startDate: null, endDate: null, months: [], durationDays: 7,
    })).toMatch(/month/);
  });

  it('rejects month mode with no trip length', () => {
    expect(validateDates({
      mode: 'months', startDate: null, endDate: null,
      months: ['2026-09'], durationDays: null,
    })).toMatch(/long/);
  });
});

describe('validateStay', () => {
  // The gate is off — the operator is not naming a specific place, so the three
  // detail fields are irrelevant even when empty.
  it('accepts anything when the specific-stay gate is off', () => {
    expect(validateStay({
      specificStaySelected: false, name: null, url: null, imageUrl: null,
    })).toBeNull();
  });

  it('accepts a complete stay when the gate is on', () => {
    expect(validateStay({
      specificStaySelected: true,
      name: 'Casa Surf',
      url: 'https://casasurf.example',
      imageUrl: 'https://cdn.example/a.jpg',
    })).toBeNull();
  });

  it('rejects a stay missing its name', () => {
    expect(validateStay({
      specificStaySelected: true, name: '  ', url: 'https://x.example',
      imageUrl: 'https://cdn.example/a.jpg',
    })).toMatch(/name/i);
  });

  it('rejects a stay missing its link', () => {
    expect(validateStay({
      specificStaySelected: true, name: 'Casa Surf', url: null,
      imageUrl: 'https://cdn.example/a.jpg',
    })).toMatch(/link/i);
  });

  it('rejects a stay missing its photo', () => {
    expect(validateStay({
      specificStaySelected: true, name: 'Casa Surf',
      url: 'https://x.example', imageUrl: null,
    })).toMatch(/photo/i);
  });
});

describe('validatePrice', () => {
  it('accepts a positive price', () => {
    expect(validatePrice(1200)).toBeNull();
  });

  it('rejects zero', () => {
    expect(validatePrice(0)).toMatch(/more than/);
  });

  it('rejects a negative price', () => {
    expect(validatePrice(-5)).toMatch(/more than/);
  });

  it('rejects an unset price', () => {
    expect(validatePrice(null)).toMatch(/price/i);
  });
});

describe('validateDeposit', () => {
  // Mirrors the DB CHECK group_trips_deposit_not_over_price. Catching it here
  // gives the operator a sentence instead of a Postgres constraint error.
  it('accepts a deposit below the price', () => {
    expect(validateDeposit(300, 1200)).toBeNull();
  });

  it('accepts a deposit equal to the price', () => {
    expect(validateDeposit(1200, 1200)).toBeNull();
  });

  it('rejects a deposit above the price', () => {
    expect(validateDeposit(1500, 1200)).toMatch(/more than the price/);
  });

  it('rejects a negative deposit', () => {
    expect(validateDeposit(-1, 1200)).toMatch(/negative|zero or more/i);
  });

  // No deposit is a valid trip — the traveler pays in one go.
  it('accepts no deposit', () => {
    expect(validateDeposit(null, 1200)).toBeNull();
  });

  // The DB CHECK also passes when the price is null, so this must too.
  it('accepts a deposit when no price is set yet', () => {
    expect(validateDeposit(300, null)).toBeNull();
  });
});

describe('validateSpots', () => {
  it('accepts raising the cap', () => {
    expect(validateSpots(20, 12)).toBeNull();
  });

  it('accepts lowering the cap to exactly the participant count', () => {
    expect(validateSpots(12, 12)).toBeNull();
  });

  // The whole point of the floor: the join trigger only fires on INSERT into
  // group_trip_participants, so the DB would happily accept 4 on a 12-person
  // trip and leave it permanently unjoinable.
  it('rejects lowering the cap below the participant count', () => {
    expect(validateSpots(4, 12)).toMatch(/12 people/);
  });

  it('accepts an unset cap', () => {
    expect(validateSpots(null, 12)).toBeNull();
  });

  it('rejects a cap below 2', () => {
    expect(validateSpots(1, 0)).toMatch(/at least 2/);
  });

  it('rejects a cap above 50', () => {
    expect(validateSpots(51, 0)).toMatch(/50/);
  });
});
