import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

/**
 * Who is allowed in here, and what they may do once inside.
 *
 * ── Two different people use this site ──────────────────────────────────────
 * The operator of record — the account Stripe pays — and, since 13 August, the
 * crew they put on a trip. A Manager reviewing sixty passports has exactly the
 * problem this site exists to solve, and telling them "do it on your phone"
 * while the person who hired them has a desktop screen is not a rule, it is an
 * oversight.
 *
 * ── Ask "can I?", never "what tier am I?" ───────────────────────────────────
 * Same rule the app follows. The five tiers are labels; what each one can do is
 * a row in `organized_trip_staff_roles` that can be changed with an UPDATE. So
 * nothing here branches on 'manager'. Today `docs.view` happens to mean Manager
 * and up — that is the answer, not the question.
 *
 * ── This is UX, not security ────────────────────────────────────────────────
 * Every capability is also enforced in the database, by RLS or by a check
 * inside the RPC. The array below exists so the site can hide a button that
 * would otherwise fail with a raw server error. Someone who forces `can()` to
 * true still gets refused by Postgres.
 */

/** Every capability the database knows about. Values are stable — a shipped
 *  key is never renamed, because role rows refer to it by value. */
export type TripCapability =
  | 'profile.shown_to_travelers'
  | 'roster.view'
  | 'travelers.view_profiles'
  | 'travelers.view_stats'
  | 'chat.participate'
  | 'payments.view_status'
  | 'docs.view'
  | 'medical.view'
  | 'trip.edit'
  | 'docs.approve'
  | 'travelers.remove'
  | 'data.export'
  | 'money.manage'
  | 'staff.manage'
  | 'trip.cancel';

/**
 * The English for each key. The ONLY thing this project may hardcode about
 * capabilities — which tier holds which one is a row in the database, and the
 * crew page renders that row, never this list.
 *
 * Same wording as the app's CAPABILITY_LABELS, so an operator who reads the
 * tier on their phone and again here is told the same thing.
 */
export const CAPABILITY_LABELS: Record<TripCapability, string> = {
  'profile.shown_to_travelers': 'Shown to travelers',
  'roster.view': 'Logs in · sees the roster',
  'travelers.view_profiles': 'Traveler profiles + emergency contact',
  'travelers.view_stats': 'Surf & travel stats',
  'chat.participate': 'Group chat · updates · 1:1',
  'payments.view_status': 'Payment status',
  'docs.view': 'Documents · flights · passports',
  'medical.view': 'Medical status',
  'trip.edit': 'Edit trip, gear and required docs',
  'docs.approve': 'Approve documents',
  'travelers.remove': 'Remove a traveler',
  'data.export': 'Export traveler data',
  'money.manage': 'Money: amounts, refunds, payouts',
  'staff.manage': 'Invite and edit staff',
  'trip.cancel': 'Cancel the trip',
};

/**
 * What this site needs before it is worth opening at all.
 *
 * Document review is the whole product. A Crew or Guide tier — roster and
 * profiles, no documents — would land on a page of empty cards and conclude the
 * site is broken, so they are kept out of the trip rather than shown a shell of
 * it. They still have everything they need in the app.
 */
export const DASHBOARD_CAPABILITY: TripCapability = 'docs.view';

/** The signed-in user's capabilities on one trip. `[]` for a stranger — the
 *  function answers for everyone and reveals nothing. */
export async function fetchMyCapabilities(tripId: string): Promise<TripCapability[]> {
  const { data, error } = await supabase.rpc('my_trip_capabilities', { p_trip_id: tripId });
  if (error) throw error;
  return (data as TripCapability[] | null) ?? [];
}

/**
 * Trip ids where the signed-in user is live crew.
 *
 * `accepted_at` matters: an invite that was sent and never accepted grants
 * nothing, and `my_trip_capabilities` agrees — it requires the same two
 * conditions. A list built without them would show a trip whose every page then
 * came back empty.
 */
export async function fetchMyStaffTripIds(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('organized_trip_staff')
    .select('trip_id')
    .eq('user_id', userId)
    .not('accepted_at', 'is', null)
    .is('revoked_at', null);
  if (error) throw error;
  return [...new Set((data ?? []).map((r: { trip_id: string }) => r.trip_id))];
}

export type TripAccess = {
  capabilities: TripCapability[];
  can: (capability: TripCapability) => boolean;
  /** True once the answer is known. Gate destructive UI on this, not on `can`
   *  alone — an unresolved query says "no" to everything, and a button that
   *  appears a beat late is better than one that flashes and vanishes. */
  ready: boolean;
  isPending: boolean;
};

/** What the signed-in user may do on this trip. Cached per trip. */
export function useTripAccess(tripId: string): TripAccess {
  const q = useQuery({
    queryKey: ['capabilities', tripId],
    queryFn: () => fetchMyCapabilities(tripId),
    enabled: !!tripId,
    // Capabilities change when someone is promoted, which is rare and never
    // while they are staring at this page. Five minutes keeps every page on one
    // read instead of one each.
    staleTime: 5 * 60 * 1000,
  });

  const capabilities = q.data ?? [];
  return {
    capabilities,
    can: (capability: TripCapability) => capabilities.includes(capability),
    ready: q.isSuccess,
    isPending: q.isPending,
  };
}
