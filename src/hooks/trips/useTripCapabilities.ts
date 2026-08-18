/**
 * What the current user is allowed to do on one trip.
 *
 * Spec: docs/specs/operator-trips/staff-and-permissions.md
 *
 * ── This is UX ONLY ────────────────────────────────────────────────────────
 * The array this returns exists so the app can hide buttons. It is NOT a
 * permission check. Every capability is also enforced in the database by RLS or
 * an RPC check (migration 20260807000100) — that is the real gate. Someone who
 * never opens the app can call PostgREST directly, and the array cannot stop
 * them. So: never treat a `true` here as authorisation to skip a server check,
 * and never add a capability to the UI that has no matching database rule.
 *
 * ── Why one array instead of a role ────────────────────────────────────────
 * The 5 tiers (Listed / Crew / Guide / Manager / Operator) are labels. What each
 * one can do is a row in `organized_trip_staff_roles` that we can change with an
 * UPDATE, because the permissions are not finally decided. If the client
 * branched on the role name, every change would need an app release — which is
 * the whole thing this design exists to avoid. So the client asks "can I?", not
 * "what am I?".
 *
 * Corollary: do NOT write `tier >= 4` anywhere. The sets are nested today and
 * will not stay that way.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../config/supabase';
import { tripsKeys } from './useTripQueries';
import { listTripStaff, listStaffRoles } from '../../services/trips/tripStaffService';

/**
 * Every capability the database knows about, as of migration 20260807000000.
 * These strings are stable — once a key ships it is never renamed, because rows
 * in `organized_trip_staff_roles.capabilities` refer to it by value.
 */
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
  // Post an admin update without the whole `trip.edit`. Added for the Guide
  // tier (migration 20260817000000): their blurb promises updates, but
  // granting `trip.edit` would hand them the edit screen too.
  | 'updates.send'
  | 'docs.approve'
  | 'travelers.remove'
  | 'data.export'
  | 'money.manage'
  | 'staff.manage'
  | 'trip.cancel';

const EMPTY: TripCapability[] = [];

/**
 * The crew shown to travelers on the Overview.
 *
 * Readable by anyone on the trip — RLS on `organized_trip_staff` allows any
 * participant to select it — so this is not gated on a capability. What IS
 * gated is who ends up in the list: only rows whose tier carries
 * `profile.shown_to_travelers`. Every seeded tier does today, which is the
 * agreed design (all five are "shown to travelers"), but reading it from the
 * role rather than assuming it keeps this correct when the sets are edited.
 */
export function useTripCrew(tripId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: [...tripsKeys.capabilities(tripId ?? ''), 'crew'],
    enabled: !!tripId && enabled,
    queryFn: async () => {
      const [staff, roles] = await Promise.all([
        listTripStaff(tripId as string),
        listStaffRoles(),
      ]);
      const shown = new Set(
        roles
          .filter(r => r.capabilities.includes('profile.shown_to_travelers'))
          .map(r => r.role_key),
      );
      return staff
        .filter(s => shown.has(s.role_key))
        // Someone who has not accepted yet is not on the crew yet. Showing them
        // to travelers would advertise a guide who may never join.
        .filter(s => !s.pending)
        .map(s => ({
          id: s.id,
          name: s.name,
          title: s.title,
          bio: s.bio,
          avatarUrl: s.photo_url,
        }));
    },
    staleTime: 5 * 60 * 1000,
  });
}

async function fetchTripCapabilities(tripId: string): Promise<TripCapability[]> {
  const { data, error } = await supabase.rpc('my_trip_capabilities', {
    p_trip_id: tripId,
  });
  if (error) throw error;
  return (data as TripCapability[] | null) ?? EMPTY;
}

/**
 * Reads `my_trip_capabilities(trip_id)`. Works on ordinary group trips too — the
 * function answers there by falling back to the old host check, so callers do
 * not need to know which kind of trip they are on.
 */
export function useTripCapabilities(tripId: string | null | undefined, enabled = true) {
  const query = useQuery<TripCapability[]>({
    queryKey: tripsKeys.capabilities(tripId ?? ''),
    enabled: !!tripId && enabled,
    queryFn: () => fetchTripCapabilities(tripId as string),
    // Permissions change when an operator edits staff — rare, and a stale
    // button for a few minutes is harmless because the server still refuses.
    staleTime: 5 * 60 * 1000,
  });

  const caps = query.data ?? EMPTY;

  return {
    ...query,
    capabilities: caps,
    /**
     * The only way to ask. Closed over the array so callers cannot accidentally
     * compare against a role name.
     */
    can: (cap: TripCapability) => caps.includes(cap),
    /**
     * True while we genuinely do not know yet. Callers should hide privileged
     * UI in this state rather than flashing it and taking it away.
     */
    unknown: query.isPending,
  };
}
