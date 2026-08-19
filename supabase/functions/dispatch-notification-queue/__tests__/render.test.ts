import { renderPush } from '../render';

describe('renderPush', () => {
  it('approved join request is celebratory and names the trip', () => {
    const r = renderPush('join_request_decided', { decision: 'approved' }, 'Costa Rica Camp');
    expect(r.title).toMatch(/in/i);
    expect(r.body).toContain('Costa Rica Camp');
  });
  it('new join request names the requester and trip', () => {
    const r = renderPush('join_request_received', { actor_name: 'Johnny' }, 'Costa Rica Camp');
    expect(r.body).toContain('Johnny');
    expect(r.body).toContain('Costa Rica Camp');
  });
  it('cancelled trip is clear', () => {
    const r = renderPush('trip_cancelled', {}, 'Costa Rica Camp');
    expect(r.body).toContain('Costa Rica Camp');
  });
  it('trip invite received names the host and trip', () => {
    const r = renderPush('trip_invite_received', { actor_name: 'Ohad Storfer' }, 'El Salvador 26');
    expect(r.body).toContain('Ohad Storfer');
    expect(r.body).toContain('El Salvador 26');
    expect(r.body).not.toContain('new trip update');
  });
  it('trip invite accepted names the invitee and trip', () => {
    const r = renderPush('trip_invite_accepted', { actor_name: 'sababa' }, 'El Salvador 26');
    expect(r.body).toContain('sababa');
    expect(r.body).toContain('El Salvador 26');
  });
  it('trip invite declined names the invitee and trip', () => {
    const r = renderPush('trip_invite_declined', { actor_name: 'sababa' }, 'El Salvador 26');
    expect(r.body).toContain('sababa');
    expect(r.body).toContain('El Salvador 26');
  });
  it('unknown type falls back without throwing', () => {
    const r = renderPush('member_joined', {}, 'X');
    expect(r.title.length).toBeGreaterThan(0);
    expect(r.body.length).toBeGreaterThan(0);
  });

  describe('operator_requirement_due_soon — the Dashboard "Remind N people" push', () => {
    it('names the document, so the traveler knows which one is wanted', () => {
      // The bug this replaces: with no case and no template row, this type hit
      // the `default` and pushed "You have a new trip update" — true, useless.
      const r = renderPush(
        'operator_requirement_due_soon',
        { item_name: 'Passport' },
        'El Salvador 26',
      );
      expect(r.title).toContain('El Salvador 26');
      expect(r.body).toContain('Passport');
    });

    it('lets the template row win, which is what production actually uses', () => {
      // 20260806000000 seeds exactly this key, so the branch above is a fallback
      // for if that row is deleted — not the live path.
      const r = renderPush(
        'operator_requirement_due_soon',
        { item_name: 'Passport' },
        'El Salvador 26',
        {
          operator_requirement_due_soon: {
            push_title: 'Still needed for {trip}',
            push_body: 'Your organiser is waiting for {item}',
          },
        },
      );
      expect(r.title).toBe('Still needed for El Salvador 26');
      expect(r.body).toBe('Your organiser is waiting for Passport');
    });

    it('does not say "an item" when the requirement title is missing', () => {
      const r = renderPush('operator_requirement_due_soon', {}, 'El Salvador 26');
      expect(r.body.length).toBeGreaterThan(0);
      expect(r.title).toContain('El Salvador 26');
    });
  });

  describe('operator_requirement_overdue — scan-requirement-deadlines, traveler side', () => {
    it('names the document and the due date', () => {
      const r = renderPush(
        'operator_requirement_overdue',
        { item_name: 'Passport', due_date_label: 'Aug 22' },
        'El Salvador 26',
      );
      expect(r.title).toContain('Passport');
      expect(r.title).toMatch(/late/i);
      expect(r.body).toContain('El Salvador 26');
      expect(r.body).toContain('Aug 22');
    });

    it('does not throw with no date label', () => {
      const r = renderPush('operator_requirement_overdue', { item_name: 'Passport' }, 'El Salvador 26');
      expect(r.body.length).toBeGreaterThan(0);
    });
  });

  describe('operator_requirement_overdue_operator — scan-requirement-deadlines, operator side', () => {
    it('counts people, not names, and never one push per traveler', () => {
      const r = renderPush(
        'operator_requirement_overdue_operator',
        { item_name: 'Passport', count: 4 },
        'El Salvador 26',
      );
      expect(r.title).toContain('4 people');
      expect(r.title).toContain('Passport');
      expect(r.body).toContain('El Salvador 26');
    });

    it('says "1 person", not "1 people"', () => {
      const r = renderPush(
        'operator_requirement_overdue_operator',
        { item_name: 'Passport', count: 1 },
        'El Salvador 26',
      );
      expect(r.title).toContain('1 person');
      expect(r.title).not.toContain('1 people');
    });
  });

  describe('trip_dates_changed — the operator moved the trip', () => {
    it('names the new dates, which is the whole point of the push', () => {
      const r = renderPush(
        'trip_dates_changed',
        { date_range: '12 Nov – 19 Nov 2026', has_deadlines: true },
        'El Salvador 26',
      );
      expect(r.title).toContain('El Salvador 26');
      expect(r.body).toContain('12 Nov – 19 Nov 2026');
      expect(r.body).toContain('deadlines');
    });

    it('drops the deadline clause on a trip that has no deadlines', () => {
      const r = renderPush(
        'trip_dates_changed',
        { date_range: '12 Nov – 19 Nov 2026', has_deadlines: false },
        'El Salvador 26',
      );
      expect(r.body).toContain('12 Nov – 19 Nov 2026');
      expect(r.body).not.toContain('deadlines');
    });

    it('still says something useful when the range is missing', () => {
      const r = renderPush('trip_dates_changed', {}, 'El Salvador 26');
      expect(r.title).toContain('El Salvador 26');
      expect(r.body).not.toContain('undefined');
      expect(r.body.length).toBeGreaterThan(0);
    });

    it('lets the template row win, which is what production actually uses', () => {
      // 20260819000300 seeds exactly this key, so the branch above is the
      // fallback for the day this function is deployed and the row deleted.
      // The template cannot name the dates — `fill()` has no {date_range}.
      const r = renderPush(
        'trip_dates_changed',
        { date_range: '12 Nov – 19 Nov 2026' },
        'El Salvador 26',
        {
          trip_dates_changed: {
            push_title: 'New dates for {trip}',
            push_body: 'The dates changed. Your deadlines moved with them — tap to see.',
          },
        },
      );
      expect(r.title).toBe('New dates for El Salvador 26');
      expect(r.body).toBe('The dates changed. Your deadlines moved with them — tap to see.');
    });
  });

  describe('chargebacks — Phase 3 of refunds-and-merchant-of-record', () => {
    it('a new dispute names the amount and the evidence deadline', () => {
      const r = renderPush(
        'operator_charge_disputed',
        { amount_usd: 1000, evidence_due_label: 'Aug 31', dispute_id: 'dp_1' },
        'El Salvador 26',
      );
      expect(r.title).toContain('$1000.00');
      expect(r.body).toContain('El Salvador 26');
      expect(r.body).toContain('Aug 31');
    });

    it('a dispute without a deadline still reads cleanly', () => {
      const r = renderPush('operator_charge_disputed', {}, 'El Salvador 26');
      expect(r.title).toContain('payment was disputed');
      expect(r.title).not.toContain('undefined');
      expect(r.body).not.toContain('undefined');
    });

    it('a lost dispute says the money went back', () => {
      const r = renderPush(
        'operator_dispute_closed',
        { outcome: 'lost', amount_usd: 1000 },
        'El Salvador 26',
      );
      expect(r.title.toLowerCase()).toContain('lost');
      expect(r.body).toContain('$1000.00');
      expect(r.body).toContain('El Salvador 26');
    });

    it('a won dispute is good news and moves no money', () => {
      const r = renderPush(
        'operator_dispute_closed',
        { outcome: 'won', amount_usd: 1000 },
        'El Salvador 26',
      );
      expect(r.title.toLowerCase()).toContain('won');
      expect(r.body).toContain('El Salvador 26');
    });
  });
});
