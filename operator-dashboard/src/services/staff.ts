/**
 * The crew: the people who RUN a trip, as opposed to the travelers who go on it.
 *
 * Spec: docs/superpowers/specs/2026-08-14-crew-page.md
 * The app does the same job in `src/components/trips/TripStaffSheet.tsx` and
 * `src/services/trips/tripStaffService.ts`. Keep the two honest with each other.
 *
 * ── Three things to know before changing anything here ─────────────────────
 *
 * 1. Crew are NOT in `group_trip_participants`. That table means traveler
 *    everywhere — the capacity trigger counts its rows, payment rows point at
 *    it, requirements attach to it. Crew live in `organized_trip_staff`, and a
 *    database trigger refuses to let one person be both on one trip.
 *
 * 2. Nothing here is a permission check. `ots_write` is `group_trips.host_id`
 *    only, so every write below simply fails for anyone who is not the operator
 *    of record. The page hides the controls so that refusal never has to be
 *    rendered as a raw error.
 *
 * 3. Rule 1 holds: no new table, no new function, no migration. Every read and
 *    write here was already live and already permitted before this page.
 */
import { supabase } from '../lib/supabase';
import type { TripCapability } from './access';

/** The five tiers. Order matters for display only — never for a permission check. */
export type StaffRoleKey = 'listed' | 'crew' | 'guide' | 'manager' | 'operator';

const TIER_ORDER: StaffRoleKey[] = ['listed', 'crew', 'guide', 'manager', 'operator'];

/**
 * A tier definition, read from the database.
 *
 * The capability list is DATA — what a Guide can do changes with an UPDATE, not
 * a release — so nothing in this project may hardcode it. Render what comes
 * back. `services/access.ts` owns only the English for each key.
 */
export type StaffRole = {
  roleKey: StaffRoleKey;
  tier: number;
  label: string;
  blurb: string | null;
  capabilities: TripCapability[];
};

/** One person on one trip's crew. */
export type CrewMember = {
  /** The `organized_trip_staff` row id — what every write below takes. */
  id: string;
  /** Null for a "Listed" credit: a name and a face, with no account behind it. */
  userId: string | null;
  roleKey: StaffRoleKey;
  /**
   * What this person DOES, shown to travelers: "Head guide", "Photographer".
   * Free text. Not the tier — the tier is a permission set the operator reads,
   * and a traveler meets a person.
   */
  title: string | null;
  /** One or two lines introducing them on the trip page. */
  bio: string | null;
  /** Their profile name, or the typed one for a Listed credit. */
  name: string;
  photoUrl: string | null;
  invitedAt: string;
  acceptedAt: string | null;
  /** They have an account but have not accepted the invite yet. */
  pending: boolean;
};

/**
 * The jobs the operator picks from when introducing someone.
 *
 * Chips rather than a database enum on purpose: a shortcut for typing, not a
 * set of values anything branches on. `title` stays free text, so an operator
 * with a job nobody thought of just writes it.
 *
 * Same list as the app's STAFF_PROFESSIONS. If one changes, change both.
 */
export const STAFF_PROFESSIONS = [
  'Surf instructor',
  'Surf guide',
  'Photographer',
  'Videographer',
  'Driver',
  'Cook',
  'Yoga teacher',
  'Physio / massage',
  'Host',
] as const;

/**
 * The five tier definitions. Cached hard by the caller — they change roughly
 * never, and both the list and the editor need them.
 */
export async function fetchStaffRoles(): Promise<StaffRole[]> {
  const { data, error } = await supabase
    .from('organized_trip_staff_roles')
    .select('role_key, tier, label, blurb, capabilities')
    .is('operator_id', null)
    .order('tier', { ascending: true });
  if (error) throw error;

  return (data ?? []).map((r: any) => ({
    roleKey: r.role_key as StaffRoleKey,
    tier: r.tier ?? 0,
    label: r.label ?? r.role_key,
    blurb: r.blurb ?? null,
    capabilities: (r.capabilities ?? []) as TripCapability[],
  }));
}

/**
 * Everyone on this trip's crew, lowest tier first.
 *
 * Two queries, not an embed: `organized_trip_staff.user_id` points at
 * `auth.users`, while names and photos live on `surfers`. There is no foreign
 * key between those two, so PostgREST cannot embed them.
 *
 * `profile_image_url`, not `profile_photo_url` — see the note in
 * `services/travelers.ts`. Both columns exist; only this one is filled.
 */
export async function fetchCrew(tripId: string): Promise<CrewMember[]> {
  const { data, error } = await supabase
    .from('organized_trip_staff')
    .select('id, user_id, role_key, display_name, photo_url, title, bio, invited_at, accepted_at')
    .eq('trip_id', tripId)
    .is('revoked_at', null);
  if (error) throw error;

  const rows = data ?? [];
  const userIds = rows.map((r: any) => r.user_id).filter((id: string | null): id is string => !!id);

  let profiles = new Map<string, { name: string | null; profile_image_url: string | null }>();
  if (userIds.length > 0) {
    const { data: surfers, error: surferError } = await supabase
      .from('surfers')
      .select('user_id, name, profile_image_url')
      .in('user_id', userIds);
    if (surferError) throw surferError;
    profiles = new Map((surfers ?? []).map((s: any) => [s.user_id, s]));
  }

  return rows
    .map((r: any): CrewMember => {
      const profile = r.user_id ? profiles.get(r.user_id) : undefined;
      return {
        id: r.id,
        userId: r.user_id ?? null,
        roleKey: r.role_key as StaffRoleKey,
        title: r.title ?? null,
        bio: r.bio ?? null,
        // The typed name wins for a Listed row, which has no profile. For a real
        // account the profile is the source of truth, so someone who renames
        // themselves does not show a stale name on every trip they crew.
        name: profile?.name ?? r.display_name ?? 'Unnamed',
        photoUrl: profile?.profile_image_url ?? r.photo_url ?? null,
        invitedAt: r.invited_at,
        acceptedAt: r.accepted_at ?? null,
        pending: !!r.user_id && !r.accepted_at,
      };
    })
    .sort((a, b) => TIER_ORDER.indexOf(a.roleKey) - TIER_ORDER.indexOf(b.roleKey));
}

/**
 * Can this person's tier be changed?
 *
 * The test is `userId`, NOT `roleKey === 'listed'`. Those are different
 * questions, and conflating them gets one case wrong: someone who accepted an
 * invite at the Listed tier DOES have an account, and promoting them to Guide
 * is perfectly sensible. What can never be promoted is a row with no account
 * behind it — there is nobody to grant anything to.
 */
export function canChangeTier(member: Pick<CrewMember, 'userId'>): boolean {
  return member.userId !== null;
}

/** Move someone to a different tier. Only meaningful where canChangeTier says so. */
export async function updateCrewRole(staffId: string, roleKey: StaffRoleKey): Promise<void> {
  const { error } = await supabase
    .from('organized_trip_staff')
    .update({ role_key: roleKey })
    .eq('id', staffId);
  if (error) throw error;
}

/**
 * Edit how travelers see this person.
 *
 * `title` and `bio` work on every row: they belong to the OPERATOR, not to the
 * person, and the same guide is "Head guide" on one trip and "Photographer" on
 * the next.
 *
 * `displayName` is for a Listed credit only. Somebody with an account gets
 * their name from `surfers`, and writing `display_name` for them would create a
 * second, quietly disagreeing copy — the read above prefers the profile, so it
 * would not even show. The page does not offer the field; this refuses it too,
 * because a service that trusts its caller is a service that gets it wrong once.
 */
export async function updateCrewMember(
  member: Pick<CrewMember, 'id' | 'userId'>,
  patch: { title?: string; bio?: string; displayName?: string },
): Promise<void> {
  const update: Record<string, string | null> = {};
  if (patch.title !== undefined) update.title = patch.title.trim() || null;
  if (patch.bio !== undefined) update.bio = patch.bio.trim() || null;

  if (patch.displayName !== undefined) {
    if (member.userId) throw new Error('Their name comes from their Swellyo profile.');
    // `ots_listed_needs_name` refuses a row with neither an account nor a name.
    // Caught here so it reads as a sentence rather than a database error.
    const name = patch.displayName.trim();
    if (!name) throw new Error('A listed crew member needs a name.');
    update.display_name = name;
  }

  if (Object.keys(update).length === 0) return;

  const { error } = await supabase.from('organized_trip_staff').update(update).eq('id', member.id);
  if (error) throw error;
}

/**
 * Take someone off the crew.
 *
 * A soft delete: `revoked_at` is stamped rather than the row removed, so "who
 * could see the passports in July" stays answerable. `trip_staff_can()` ignores
 * revoked rows, so their access stops immediately.
 */
export async function removeCrewMember(staffId: string): Promise<void> {
  const { error } = await supabase
    .from('organized_trip_staff')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', staffId);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Adding someone
// ---------------------------------------------------------------------------
// Only the in-app invite is offered here. The other two doors stay in the app:
// an invite LINK is shared over WhatsApp, which is a phone action anyway, and a
// LISTED credit wants a photo upload this project has no path for.

export type StaffSearchResult = {
  userId: string;
  name: string;
  photoUrl: string | null;
  /**
   * Why this person cannot be picked, or 'available'.
   *
   * The three blocked states are things the operator can already read off their
   * own trip, so naming them tells them nothing new and saves them staring at
   * "Nobody found" while the person sits on the trip in front of them. A BLOCK
   * never appears here: those rows are dropped server-side, because whether
   * someone blocked you is exactly what a search endpoint must not confirm.
   */
  state: 'available' | 'traveler' | 'crew' | 'invited';
};

/**
 * People the operator could add as crew.
 *
 * Returns [] under two characters — the server enforces the same floor, this
 * just saves a round trip on every keystroke. Already excluded server-side: the
 * operator, current crew, travelers on this trip, anyone with an invite already
 * waiting, and blocks in both directions.
 */
export async function searchUsersForStaff(
  tripId: string,
  query: string,
): Promise<StaffSearchResult[]> {
  if (query.trim().length < 2) return [];

  const { data, error } = await supabase.rpc('search_users_for_staff', {
    p_trip_id: tripId,
    p_query: query.trim(),
  });
  if (error) throw error;

  return ((data as any[] | null) ?? []).map(r => ({
    userId: r.user_id,
    name: r.name ?? 'Unnamed',
    photoUrl: r.profile_image_url ?? null,
    state: (r.state ?? 'available') as StaffSearchResult['state'],
  }));
}

/**
 * Invite one account. They get a notification with a push; accepting runs the
 * same `accept_staff_invite` path an invite link uses, except this invite is
 * bound to them and nobody else can redeem it.
 *
 * The paperwork rides on the invite and lands when they accept — there is no
 * staff row to assign anything to before that.
 */
export async function inviteStaffMember(params: {
  tripId: string;
  userId: string;
  roleKey: Exclude<StaffRoleKey, 'operator'>;
  title?: string;
  bio?: string;
  requirementIds?: string[];
}): Promise<void> {
  const { error } = await supabase.rpc('invite_staff_member', {
    p_trip_id: params.tripId,
    p_user_id: params.userId,
    p_role_key: params.roleKey,
    p_title: params.title?.trim() || null,
    p_requirement_ids: params.requirementIds ?? [],
    p_bio: params.bio?.trim() || null,
  });
  if (error) throw error;
}
