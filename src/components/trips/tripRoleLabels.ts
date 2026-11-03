// Who is who on a trip, for labels next to a person's name: the trip chat's
// sender names and the "who posted this" line on admin updates.
//
// 21 Oct 2026 test: travelers asked "who sent updates in the trip" and staff
// asked for "labels for who is guide, instructor, yoga teacher, etc when in
// chat". The crew member's own title ("Instructor") wins over their tier; the
// host reads "Operator" on an operator trip and "Host" on a peer trip.

const TIER_LABEL: Record<string, string> = {
  operator: 'Operator',
  co_operator: 'Co-operator',
  manager: 'Manager',
  guide: 'Guide',
  crew: 'Crew',
};

export interface TripRoleLabels {
  /** user id → "Operator" / "Guide" / "Instructor". Travelers have no entry. */
  roles: Record<string, string>;
  /** user id → display name, for hosts, travelers and crew with an account. */
  names: Record<string, string>;
}

export function buildTripRoleLabels(
  participants: { user_id: string; role: string; name?: string | null }[],
  crew: { userId: string | null; name: string; title: string | null; roleKey: string }[],
  isOperatorTrip: boolean,
): TripRoleLabels {
  const roles: Record<string, string> = {};
  const names: Record<string, string> = {};
  for (const p of participants) {
    if (p.name) names[p.user_id] = p.name;
    if (p.role === 'host') roles[p.user_id] = isOperatorTrip ? 'Operator' : 'Host';
  }
  for (const c of crew) {
    if (!c.userId) continue;
    if (!names[c.userId]) names[c.userId] = c.name;
    const label = c.title?.trim() || TIER_LABEL[c.roleKey];
    if (label) roles[c.userId] = label;
  }
  return { roles, names };
}

/** "Cam, Operator" / "Cam" / undefined — the author line of an admin update. */
export function authorLabel(labels: TripRoleLabels, userId: string): string | undefined {
  const name = labels.names[userId];
  if (!name) return undefined;
  const role = labels.roles[userId];
  return role ? `${name}, ${role}` : name;
}
