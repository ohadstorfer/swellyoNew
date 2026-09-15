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

/**
 * The six tiers. Order matters for display only — never for permission checks.
 *
 * 'operator' is the creator, the operator of record — they hold it by owning
 * the trip (group_trips.host_id), never by having a row assigned. 'co_operator'
 * is a real, assignable tier: a second person who runs the trip, appointed by
 * the creator alone. See 20260901000000_co_operator_role.sql.
 */
export type StaffRoleKey =
  | 'listed'
  | 'crew'
  | 'guide'
  | 'manager'
  | 'co_operator'
  | 'operator';

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
  /**
   * What this person DOES, shown to travelers: "Instructor", "Photographer".
   * Free text, usually one of STAFF_PROFESSIONS. Not the tier — the tier is a
   * permission set the operator reads, and a traveler meets a person.
   */
  title: string | null;
  /** One or two lines introducing them on the trip page. */
  bio: string | null;
  invited_at: string;
  accepted_at: string | null;
  /** Resolved for display: the surfer's profile if they have one, else the
   *  display_name/photo_url stored on the staff row itself. */
  name: string;
  photo_url: string | null;
  /** From the surfer's profile. Null for a Listed credit or an unset profile. */
  country_from: string | null;
  /** True when they have an account but have not accepted the invite yet. */
  pending: boolean;
}

const STAFF_COLUMNS =
  'id, trip_id, user_id, role_key, display_name, photo_url, title, bio, invited_at, accepted_at';

/**
 * The jobs an operator picks from when introducing a crew member.
 *
 * A list of chips rather than a database enum on purpose: it is a shortcut for
 * typing, not a set of values anything branches on. `title` stays free text, so
 * an operator with a job nobody thought of just writes it.
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
 * The six tier definitions. Cache these — they change roughly never, and every
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

  let profiles = new Map<
    string,
    { name: string | null; profile_image_url: string | null; country_from: string | null }
  >();
  if (userIds.length > 0) {
    const { data: surfers, error: surferError } = await supabase
      .from('surfers')
      .select('user_id, name, profile_image_url, country_from')
      .in('user_id', userIds);
    if (surferError) throw surferError;
    profiles = new Map((surfers ?? []).map(s => [s.user_id, s]));
  }

  const TIER_ORDER: StaffRoleKey[] = [
    'listed', 'crew', 'guide', 'manager', 'co_operator', 'operator',
  ];

  return rows
    .map(r => {
      const profile = r.user_id ? profiles.get(r.user_id) : undefined;
      return {
        id: r.id,
        trip_id: r.trip_id,
        user_id: r.user_id,
        role_key: r.role_key as StaffRoleKey,
        title: r.title,
        bio: r.bio ?? null,
        invited_at: r.invited_at,
        accepted_at: r.accepted_at,
        // The stored display_name wins for Listed rows (they have no profile);
        // for real accounts the profile is the source of truth so a renamed
        // user does not show a stale name on every trip they crew.
        name: profile?.name ?? r.display_name ?? 'Unnamed',
        photo_url: profile?.profile_image_url ?? r.photo_url ?? null,
        country_from: profile?.country_from ?? null,
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
  bio?: string;
}): Promise<void> {
  const { tripId, operatorId, roleKey, userId, displayName, photoUrl, title, bio } = params;
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
    bio: bio?.trim() || null,
    // A Listed credit has nobody to accept, so it is live immediately.
    // An account has to accept before trip_staff_can() will match them.
    accepted_at: userId ? null : new Date().toISOString(),
  });
  if (error) throw error;
}

/**
 * Put the operator on their own crew list.
 *
 * Product Specs §3 removed the "About the operator" section from the trip
 * overview, and §7b says the operator edits "your own description" — so the
 * people running the trip, the operator included, live in the Crew section
 * now. Nothing used to create that row: staff rows only ever came from
 * invites, and nobody invites themselves.
 *
 * THREE THINGS MAKE THIS ROW LEGAL WHERE ANY OTHER WOULD BE REJECTED:
 *
 * 1. The operator is a participant on their own trip (every type-C trip
 *    carries its host as one), and staff and travelers are exclusive — but
 *    both `enforce_staff_not_traveler` and its mirror explicitly exempt
 *    `t.host_id`. The rule was written to allow exactly this.
 * 2. `accepted_at` is set NOW. Every other account row waits for the person to
 *    accept, and `useTripCrew` hides anyone still pending. There is nobody to
 *    accept an invitation from yourself, so an unaccepted row would simply
 *    never appear.
 * 3. RLS lets only the operator of record write staff — which is who is
 *    calling this, at publish.
 *
 * Idempotent. `ots_one_live_row_per_user` already guarantees one live row per
 * person per trip, so a duplicate insert comes back 23505 and is swallowed:
 * this is called from a publish path that must never fail over a nice-to-have,
 * and it makes the function safe to use for backfilling older trips.
 */
export async function ensureOperatorOnCrew(params: {
  tripId: string;
  operatorId: string;
  bio?: string | null;
}): Promise<void> {
  const { tripId, operatorId, bio } = params;
  const { error } = await supabase.from('organized_trip_staff').insert({
    trip_id: tripId,
    operator_id: operatorId,
    user_id: operatorId,
    role_key: 'operator',
    // Name and photo come from the profile (see listTripStaff), so only the
    // line under the name is ours to write.
    title: 'Operator',
    bio: bio?.trim() || null,
    accepted_at: new Date().toISOString(),
  });
  if (error && (error as { code?: string }).code !== '23505') throw error;
}

/**
 * Keep the operator's crew bio in step with the trip's "about you" note.
 *
 * The note is written on `group_trips.host_lead_note` and shown on the crew
 * card, which is a copy on `organized_trip_staff.bio`. One editor, two rows —
 * so the editor calls this. Silent when there is no crew row yet (an operator
 * trip published before this existed): nothing to keep in step.
 */
export async function syncOperatorCrewBio(
  tripId: string,
  operatorId: string,
  bio: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('organized_trip_staff')
    .update({ bio: bio?.trim() || null })
    .eq('trip_id', tripId)
    .eq('user_id', operatorId)
    .eq('role_key', 'operator')
    .is('revoked_at', null);
  if (error) throw error;
}

/**
 * The signed-in person's OWN crew row on this trip, or null if they are not crew.
 *
 * `ots_select` has always allowed `user_id = auth.uid()`, so this needed no
 * migration to READ. What 20260904000300 added is the right to write it — see
 * `updateTripStaffProfile`.
 *
 * Live rows only, and a revoked row is not "no row" by accident: somebody taken
 * off a trip should stop seeing an editor for how they are introduced on it.
 */
export async function fetchMyStaffRow(tripId: string): Promise<TripStaffMember | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('organized_trip_staff')
    .select(STAFF_COLUMNS)
    .eq('trip_id', tripId)
    .eq('user_id', user.id)
    .is('revoked_at', null)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id as string,
    trip_id: data.trip_id as string,
    user_id: data.user_id as string | null,
    role_key: data.role_key as StaffRoleKey,
    title: (data.title as string | null) ?? null,
    bio: (data.bio as string | null) ?? null,
    invited_at: data.invited_at as string,
    accepted_at: (data.accepted_at as string | null) ?? null,
    // Their own row, so the display fallbacks the crew list applies are not
    // needed: whoever is asking already knows who they are.
    name: (data.display_name as string | null) ?? '',
    photo_url: (data.photo_url as string | null) ?? null,
    country_from: null,
    pending: !data.accepted_at,
  };
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
 * Edit how travelers see this person: what they do, and the line about them.
 *
 * Works for every row, unlike `updateTripStaffListed`.
 *
 * ⚠️ TWO PEOPLE MAY CALL THIS NOW, and that is the point. The operator writes
 * anyone's job and blurb — that is what makes the crew section one coherent
 * piece of copy — and since 20260904000300 the person themselves may write
 * their own two fields as well (Product Specs §"Manage self", decision D3).
 * Last write wins, which is the right outcome for two people editing one
 * sentence about one of them.
 *
 * The database decides which of the two you are: `ots_write` (staff.manage) or
 * `ots_self_profile` (your own live row), with `trg_guard_ots_self_edit`
 * refusing every column but these two to the second. So this function stays a
 * plain UPDATE and needs no caller flag.
 *
 * The original note is still worth keeping, because it is why the operator
 * keeps the power at all: an account-holding guide's job and blurb are how the
 * trip introduces its crew, and the same person can be "Head guide" on one trip
 * and "Photographer" on the next.
 */
export async function updateTripStaffProfile(
  staffId: string,
  patch: { title?: string; bio?: string },
): Promise<void> {
  const update: Record<string, string | null> = {};
  if (patch.title !== undefined) update.title = patch.title.trim() || null;
  if (patch.bio !== undefined) update.bio = patch.bio.trim() || null;
  if (Object.keys(update).length === 0) return;

  const { error } = await supabase
    .from('organized_trip_staff')
    .update(update)
    .eq('id', staffId);
  if (error) throw error;
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
  /** The operator's line introducing them, if they wrote one. */
  bio: string | null;
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
  /**
   * Staff-audience requirement ids to ask this person for. Applied when they
   * accept — there is no staff row to assign them to before that. See
   * 20260813160000_staff_invite_requirements.sql.
   */
  requirementIds?: string[];
  /** The line travelers read under their name. Copied onto the staff row when
   *  the link is used — see 20260813170000_staff_profile_for_travelers.sql. */
  bio?: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc('create_staff_invite', {
    p_trip_id: params.tripId,
    p_role_key: params.roleKey,
    p_title: params.title?.trim() || null,
    p_requirement_ids: params.requirementIds ?? [],
    p_bio: params.bio?.trim() || null,
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
  /**
   * Why this person cannot be picked, or 'available'.
   *
   * The three blocked states are things the operator can already read off their
   * own trip — the roster, the crew list, the pending invites — so naming them
   * tells them nothing new and saves them staring at "Nobody found" while the
   * person sits on the trip in front of them. A BLOCK never appears here: those
   * rows are still dropped server-side, because whether someone blocked you is
   * exactly what a search endpoint must not confirm.
   */
  state: 'available' | 'traveler' | 'crew' | 'invited';
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
  // `state` defaults to 'available' for a build talking to a database that
  // predates 20260813210000 — the row is pickable, and the server refuses it if
  // it is not.
  return ((data as StaffSearchResult[] | null) ?? []).map(r => ({
    ...r,
    state: r.state ?? 'available',
  }));
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
  /** See createStaffInviteLink — the ask rides on the invite and lands on
   *  acceptance, because there is no staff row to assign before then. */
  requirementIds?: string[];
  /** See createStaffInviteLink. */
  bio?: string;
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
