/**
 * Operator-trip staff: the people who RUN a trip, as opposed to the travelers
 * who go on it.
 *
 * Spec: docs/specs/operator-trips/staff-and-permissions.md
 * Schema: supabase/migrations/20260807000000_operator_trip_staff.sql
 *
 * ── Two things to know before changing anything here ───────────────────────
 *
 * 1. Staff are NOT in `group_trip_participants`. That table means traveler
 *    everywhere — the capacity trigger counts its rows, payment rows point at
 *    it, requirements attach to it. Staff live in `organized_trip_staff`, and a
 *    database trigger refuses to let the same person be both on one trip.
 *
 * 2. Nothing here is a permission check. RLS decides what a write is allowed to
 *    do; these calls just fail if the caller is not the operator of record.
 *    Read `useTripCapabilities` for the UI side of the same rule.
 */
import { supabase } from '../../config/supabase';
import type { TripCapability } from '../../hooks/trips/useTripCapabilities';

/** The five tiers. Order matters for display only — never for permission checks. */
export type StaffRoleKey = 'listed' | 'crew' | 'guide' | 'manager' | 'operator';

/**
 * A tier definition, read from the database. The capability list is DATA — we
 * change what a Guide can do with an UPDATE, not a release — so the client must
 * never hardcode it. Render whatever comes back.
 */
export interface StaffRole {
  role_key: StaffRoleKey;
  tier: number;
  label: string;
  blurb: string | null;
  capabilities: TripCapability[];
}

/** One person on one trip's crew. */
export interface TripStaffMember {
  id: string;
  trip_id: string;
  /** Null for a Tier 1 "Listed" credit — a name and a face, with no account. */
  user_id: string | null;
  role_key: StaffRoleKey;
  /** Job title shown to travelers, e.g. "Head Guide". Free text. */
  title: string | null;
  invited_at: string;
  accepted_at: string | null;
  /** Resolved for display: the surfer's profile if they have one, else the
   *  display_name/photo_url stored on the staff row itself. */
  name: string;
  photo_url: string | null;
  /** True when they have an account but have not accepted the invite yet. */
  pending: boolean;
}

const STAFF_COLUMNS =
  'id, trip_id, user_id, role_key, display_name, photo_url, title, invited_at, accepted_at';

/**
 * The five tier definitions. Cache these — they change roughly never, and every
 * staff screen needs them to draw the permission matrix.
 */
export async function listStaffRoles(): Promise<StaffRole[]> {
  const { data, error } = await supabase
    .from('organized_trip_staff_roles')
    .select('role_key, tier, label, blurb, capabilities')
    .is('operator_id', null)
    .order('tier', { ascending: true });
  if (error) throw error;
  return (data ?? []) as StaffRole[];
}

/**
 * Everyone on this trip's crew, lowest tier first.
 *
 * Two queries, not an embed: `organized_trip_staff.user_id` points at
 * `auth.users`, while names and avatars live on `surfers`. There is no foreign
 * key between those two, so PostgREST cannot embed them.
 */
export async function listTripStaff(tripId: string): Promise<TripStaffMember[]> {
  const { data, error } = await supabase
    .from('organized_trip_staff')
    .select(STAFF_COLUMNS)
    .eq('trip_id', tripId)
    .is('revoked_at', null);
  if (error) throw error;

  const rows = data ?? [];
  const userIds = rows.map(r => r.user_id).filter((id): id is string => !!id);

  let profiles = new Map<string, { name: string | null; profile_image_url: string | null }>();
  if (userIds.length > 0) {
    const { data: surfers, error: surferError } = await supabase
      .from('surfers')
      .select('user_id, name, profile_image_url')
      .in('user_id', userIds);
    if (surferError) throw surferError;
    profiles = new Map((surfers ?? []).map(s => [s.user_id, s]));
  }

  const TIER_ORDER: StaffRoleKey[] = ['listed', 'crew', 'guide', 'manager', 'operator'];

  return rows
    .map(r => {
      const profile = r.user_id ? profiles.get(r.user_id) : undefined;
      return {
        id: r.id,
        trip_id: r.trip_id,
        user_id: r.user_id,
        role_key: r.role_key as StaffRoleKey,
        title: r.title,
        invited_at: r.invited_at,
        accepted_at: r.accepted_at,
        // The stored display_name wins for Listed rows (they have no profile);
        // for real accounts the profile is the source of truth so a renamed
        // user does not show a stale name on every trip they crew.
        name: profile?.name ?? r.display_name ?? 'Unnamed',
        photo_url: profile?.profile_image_url ?? r.photo_url ?? null,
        pending: !!r.user_id && !r.accepted_at,
      };
    })
    .sort((a, b) => TIER_ORDER.indexOf(a.role_key) - TIER_ORDER.indexOf(b.role_key));
}

/**
 * Add someone to the crew.
 *
 * Pass `userId` for a real account, or `displayName` for a Tier 1 "Listed"
 * credit with no login. One of the two is required — the database has a CHECK
 * constraint that says so, and it will reject a row with neither.
 *
 * `operatorId` must be the trip's `host_id`; a trigger verifies it, because the
 * "my saved team" read (Phase 3) groups on this column and would otherwise
 * attribute staff to the wrong operator.
 */
export async function addTripStaff(params: {
  tripId: string;
  operatorId: string;
  roleKey: StaffRoleKey;
  userId?: string;
  displayName?: string;
  photoUrl?: string;
  title?: string;
}): Promise<void> {
  const { tripId, operatorId, roleKey, userId, displayName, photoUrl, title } = params;
  if (!userId && !displayName?.trim()) {
    throw new Error('A staff member needs either an account or a name.');
  }

  const { error } = await supabase.from('organized_trip_staff').insert({
    trip_id: tripId,
    operator_id: operatorId,
    role_key: roleKey,
    user_id: userId ?? null,
    display_name: displayName?.trim() || null,
    photo_url: photoUrl ?? null,
    title: title?.trim() || null,
    // A Listed credit has nobody to accept, so it is live immediately.
    // An account has to accept before trip_staff_can() will match them.
    accepted_at: userId ? null : new Date().toISOString(),
  });
  if (error) throw error;
}

/**
 * Move someone to a different tier.
 *
 * Only meaningful for a row with a `user_id`. A Listed credit has nobody who
 * can sign in, so any tier above 1 would be a permission granted to no one —
 * see `canChangeTier` below, which is what the UI gates on.
 */
export async function updateTripStaffRole(staffId: string, roleKey: StaffRoleKey): Promise<void> {
  const { error } = await supabase
    .from('organized_trip_staff')
    .update({ role_key: roleKey })
    .eq('id', staffId);
  if (error) throw error;
}

/**
 * Can this person's tier be changed?
 *
 * The test is `user_id`, NOT `role_key === 'listed'`. Those are different
 * questions, and conflating them gets one case wrong: someone who accepted an
 * invite at the Listed tier DOES have an account, and promoting them to Guide
 * is perfectly sensible. What can never be promoted is a row with no account
 * behind it — there is no one to grant anything to.
 */
export function canChangeTier(member: Pick<TripStaffMember, 'user_id'>): boolean {
  return member.user_id !== null;
}

/**
 * Edit a Listed credit: their name, title and photo. There is no tier here on
 * purpose — see `canChangeTier`.
 */
export async function updateTripStaffListed(
  staffId: string,
  patch: { displayName?: string; title?: string; photoUrl?: string | null },
): Promise<void> {
  const update: Record<string, string | null> = {};
  if (patch.displayName !== undefined) update.display_name = patch.displayName.trim() || null;
  if (patch.title !== undefined) update.title = patch.title.trim() || null;
  if (patch.photoUrl !== undefined) update.photo_url = patch.photoUrl;
  if (Object.keys(update).length === 0) return;

  const { error } = await supabase
    .from('organized_trip_staff')
    .update(update)
    .eq('id', staffId);
  if (error) throw error;
}

/**
 * Take someone off the crew.
 *
 * A soft delete: `revoked_at` is stamped rather than the row being removed, so
 * "who had access to the passports in July" stays answerable. `trip_staff_can()`
 * ignores revoked rows, so access stops immediately.
 */
export async function revokeTripStaff(staffId: string): Promise<void> {
  const { error } = await supabase
    .from('organized_trip_staff')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', staffId);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Invite links — how someone WITH an account joins the crew
// ---------------------------------------------------------------------------
// There is deliberately no "search for a user" call in this file. Searching
// means an endpoint that answers "does an account exist for this person?", on a
// table of real names, countries and photos. A link asks nobody: the operator
// sends it over WhatsApp, and the recipient identifies themselves by signing
// in. See the migration header for the full reasoning.

/** Matches the domain the shipped invite links already use (AppContent). */
const INVITE_BASE = 'https://swellyo-invite.netlify.app/';

export interface StaffInvitePreview {
  trip_id: string;
  trip_title: string | null;
  role_key: StaffRoleKey;
  role_label: string | null;
  title: string | null;
  operator_name: string | null;
}

/**
 * Mint a single-use link for one person at one tier.
 *
 * Single use is the point: a reusable "join as Guide" link is one forward away
 * from four people becoming Guides, and a Guide reads every traveler's profile
 * and emergency contact. One link, one seat, and the operator can see it was
 * taken.
 */
export async function createStaffInviteLink(params: {
  tripId: string;
  roleKey: Exclude<StaffRoleKey, 'operator'>;
  title?: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc('create_staff_invite', {
    p_trip_id: params.tripId,
    p_role_key: params.roleKey,
    p_title: params.title?.trim() || null,
  });
  if (error) throw error;
  return `${INVITE_BASE}?staff=${data as string}`;
}

/**
 * What the accept screen shows before the user commits. Returns null for a
 * token that is wrong, spent, revoked or expired — all four look identical on
 * purpose, so this cannot be used to probe which tokens once existed.
 */
export async function peekStaffInvite(token: string): Promise<StaffInvitePreview | null> {
  const { data, error } = await supabase.rpc('peek_staff_invite', { p_token: token });
  if (error) throw error;
  const rows = (data as StaffInvitePreview[] | null) ?? [];
  return rows[0] ?? null;
}

/** Join the crew. Returns the trip id so the caller can navigate there. */
export async function acceptStaffInvite(token: string): Promise<string> {
  const { data, error } = await supabase.rpc('accept_staff_invite', { p_token: token });
  if (error) throw error;
  return data as string;
}

// ---------------------------------------------------------------------------
// In-app invites — find someone by name and invite them without leaving Swellyo
// ---------------------------------------------------------------------------
// This is the path a link cannot cover well: an operator adding the guide they
// work with every season should not have to switch to WhatsApp. The search is
// narrow by design — see the migration header — and it never returns an email,
// so it cannot be used to confirm an address.
//
// Links are still there, and are still the only way to reach someone whose name
// you cannot find or who has no account yet.

export interface StaffSearchResult {
  user_id: string;
  name: string | null;
  profile_image_url: string | null;
}

/**
 * People the operator could add as crew. Returns [] for queries under two
 * characters — the server enforces the same floor, this just saves a round
 * trip on every keystroke.
 *
 * Already excluded server-side: the operator, current crew, travelers on this
 * trip, anyone with an invite already waiting, and blocks in both directions.
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
  return (data as StaffSearchResult[] | null) ?? [];
}

/**
 * Invite one account, in app. They get a notification with a push; accepting is
 * the same `accept_staff_invite` path a link uses, except the invite is bound
 * to them and nobody else can redeem it.
 */
export async function inviteStaffMember(params: {
  tripId: string;
  userId: string;
  roleKey: Exclude<StaffRoleKey, 'operator'>;
  title?: string;
}): Promise<void> {
  const { error } = await supabase.rpc('invite_staff_member', {
    p_trip_id: params.tripId,
    p_user_id: params.userId,
    p_role_key: params.roleKey,
    p_title: params.title?.trim() || null,
  });
  if (error) throw error;
}
