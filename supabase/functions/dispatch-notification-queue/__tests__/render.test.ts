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
});
