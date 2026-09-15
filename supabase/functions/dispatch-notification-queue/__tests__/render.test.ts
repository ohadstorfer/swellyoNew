import { renderPush, templateKey } from '../render';

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

  describe('trip_cancelled — a managed cancel refunds everyone in full', () => {
    it('names the refund so nobody has to ask where their money went', () => {
      const r = renderPush('trip_cancelled', { refund_usd: 3000 }, 'El Salvador 26');
      expect(r.body).toContain('$3000.00');
      expect(r.body).toContain('El Salvador 26');
      expect(r.body).toMatch(/5–10 business days/);
    });

    it('says nothing about money when none is coming back', () => {
      // Peer trips, unpaid travelers, and every row written before
      // 20260820000900 — `refund_usd` is omitted, never zeroed.
      const r = renderPush('trip_cancelled', {}, 'Costa Rica Camp');
      expect(r.body).toContain('Costa Rica Camp');
      expect(r.body).not.toContain('$');
      expect(r.body).not.toContain('refund');
    });

    it('never renders a zero refund', () => {
      const r = renderPush('trip_cancelled', { refund_usd: 0 }, 'Costa Rica Camp');
      expect(r.body).not.toContain('$0');
    });
  });

  describe('operator_traveler_confirmed — the operator half of member_joined', () => {
    it('names the traveler and says the place is confirmed', () => {
      const r = renderPush(
        'operator_traveler_confirmed',
        { actor_name: 'sababa' },
        'El Salvador 26',
      );
      expect(r.title).toContain('sababa');
      expect(r.title).toContain('El Salvador 26');
      expect(r.body).not.toContain('new trip update');
    });
  });

  describe('join_request_decided — approval means different things by trip kind', () => {
    it('a peer trip approval still says "you\'re in"', () => {
      const r = renderPush('join_request_decided', { decision: 'approved' }, 'Costa Rica Camp');
      expect(r.title).toContain("You're in");
      expect(r.body).toContain('Costa Rica Camp');
    });

    it('an operator trip approval does NOT claim the spot is held', () => {
      const r = renderPush(
        'join_request_decided',
        { decision: 'approved', needs_onboarding: true },
        'El Salvador 26',
      );
      expect(r.title).toContain('El Salvador 26');
      // The whole bug: approval on a type-C trip is the starting line.
      expect(r.title).not.toContain("You're in");
      expect(r.body).toMatch(/deposit/i);
      expect(r.body).toMatch(/held/i);
    });

    it('a row written before the migration falls back to the peer copy', () => {
      // No `needs_onboarding` key at all — every join_request_decided row
      // created before 20260820000500.
      const r = renderPush('join_request_decided', { decision: 'approved' }, 'El Salvador 26');
      expect(r.title).toContain("You're in");
    });

    it('a decline is the same message on both kinds of trip', () => {
      const peer = renderPush('join_request_decided', { decision: 'declined' }, 'X');
      const op = renderPush('join_request_decided', { decision: 'declined', needs_onboarding: true }, 'X');
      expect(op).toEqual(peer);
    });

    it('the two approvals cannot share a template row', () => {
      expect(templateKey('join_request_decided', { decision: 'approved' }))
        .toBe('join_request_decided:approved');
      expect(templateKey('join_request_decided', { decision: 'approved', needs_onboarding: true }))
        .toBe('join_request_decided:approved_onboarding');
    });

    it('a template row for the peer key does not leak onto operator trips', () => {
      const templates = {
        'join_request_decided:approved': {
          push_title: 'PEER ROW',
          push_body: 'You are a member of {trip}',
        },
      };
      const peer = renderPush('join_request_decided', { decision: 'approved' }, 'X', templates);
      expect(peer.title).toBe('PEER ROW');

      const op = renderPush(
        'join_request_decided',
        { decision: 'approved', needs_onboarding: true },
        'El Salvador 26',
        templates,
      );
      expect(op.title).not.toBe('PEER ROW');
      expect(op.body).toMatch(/deposit/i);
    });
  });

  // The three types that fell to the default until 20 Aug and pushed
  // "You have a new trip update". Each test asserts the absence of that string
  // as well as the presence of the real copy — the bug was silent precisely
  // because the generic text is a perfectly valid-looking push.
  describe('the types that used to fall through to the generic default', () => {
    it('a crew invite names the tier, because Crew and Manager are different jobs', () => {
      const r = renderPush(
        'operator_staff_invited',
        { role_key: 'manager', role_label: 'Manager', actor_name: 'Ohad Storfer' },
        'El Salvador 26',
      );
      expect(r.title).toContain('Manager');
      expect(r.title).toContain('El Salvador 26');
      expect(r.body).toContain('Ohad Storfer');
      expect(r.body).not.toContain('new trip update');
    });

    it('a crew invite with no role label still reads as an invite', () => {
      const r = renderPush('operator_staff_invited', { actor_name: 'Ohad Storfer' }, 'El Salvador 26');
      expect(r.title.toLowerCase()).toContain('join');
      expect(r.title).not.toContain('undefined');
      expect(r.body).not.toContain('new trip update');
    });

    it('operator setup never names a trip — it fires before the first one exists', () => {
      const r = renderPush('operator_setup_required', {}, '');
      expect(r.title).toContain('Swellyo');
      expect(r.body).not.toContain('new trip update');
      // The "your trip" fallback is the specific bug this guards: with no
      // trip_id, `trip` resolves to it and the push reads like a mistake.
      expect(r.title).not.toContain('your trip');
      expect(r.body).not.toContain('your trip');
    });

    it('a requirement added after publish says which one', () => {
      const r = renderPush(
        'operator_requirement_added',
        { requirement_title: 'Travel insurance', item_name: 'Travel insurance' },
        'El Salvador 26',
      );
      expect(r.body).toContain('Travel insurance');
      expect(r.title).toContain('El Salvador 26');
      expect(r.body).not.toContain('new trip update');
    });
  });
});
