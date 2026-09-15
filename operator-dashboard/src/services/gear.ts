import { supabase } from '../lib/supabase';

/**
 * Gear — the group's shared kit, the operator's packing suggestions, and the
 * items travelers ask for.
 *
 * Product Specs lists "personal gear (for self)", "group gear (maybe)" and
 * "Edit personal gear — admin suggestions" in the dashboard columns, and its
 * rule is that every function exists on both surfaces. The site had none of it.
 *
 * ── Three separate things that all get called "gear" ───────────────────────
 *
 *   GROUP GEAR — `group_trip_gear_items`, with `group_trip_gear_claims`
 *     against it. One tent, somebody brings it. The operator adds and removes
 *     items; travelers claim them.
 *
 *   PACKING SUGGESTIONS — `group_trips.personal_gear_host_suggestion`, a plain
 *     text array. What the operator tells everybody to bring for themselves. A
 *     database trigger fans each change out into every participant's own
 *     checklist, preserving what they had already ticked — which is why this is
 *     ONE array write and never a loop over travelers.
 *
 *   REQUESTS — `group_trip_gear_requests`. A traveler asking for an item to be
 *     added to the group list. Approving one creates the group item.
 *
 * ── Rule 1 ─────────────────────────────────────────────────────────────────
 * No new table, no new function, no migration. All three are the app's, and
 * their RLS is the boundary: `trip.edit` covers the operator's writes.
 */

export type GearItem = {
  id: string;
  name: string;
  neededQty: number;
  claimedQty: number;
  /** Names of the people bringing it, for a one-line summary. */
  contributors: string[];
};

export type GearRequest = {
  id: string;
  requesterId: string;
  itemName: string;
  neededQty: number;
  note: string | null;
  createdAt: string | null;
};

/** The group list, with who has claimed what. */
export async function fetchGearItems(tripId: string): Promise<GearItem[]> {
  const { data: items, error } = await supabase
    .from('group_trip_gear_items')
    .select('id, name, needed_qty')
    .eq('trip_id', tripId)
    // Saved drag order first; created_at breaks ties and orders any row whose
    // sort_order was never backfilled — those fall last.
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });
  if (error) throw error;
  if (!items?.length) return [];

  const ids = items.map((i: any) => i.id as string);
  const { data: claims } = await supabase
    .from('group_trip_gear_claims')
    .select('item_id, user_id, quantity')
    .in('item_id', ids);

  const userIds = [...new Set((claims ?? []).map((c: any) => c.user_id as string))];
  const names = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: surfers } = await supabase
      .from('surfers')
      .select('user_id, name')
      .in('user_id', userIds);
    (surfers ?? []).forEach((s: any) => names.set(s.user_id, s.name ?? 'Someone'));
  }

  return (items as any[]).map(i => {
    const mine = (claims ?? []).filter((c: any) => c.item_id === i.id);
    return {
      id: i.id as string,
      name: (i.name as string) ?? '',
      neededQty: Number(i.needed_qty) || 1,
      claimedQty: mine.reduce((n: number, c: any) => n + (Number(c.quantity) || 0), 0),
      contributors: mine.map((c: any) => names.get(c.user_id) ?? 'Someone'),
    };
  });
}

export async function addGearItem(
  tripId: string,
  name: string,
  neededQty: number,
): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Give the item a name.');
  const { error } = await supabase
    .from('group_trip_gear_items')
    .insert({ trip_id: tripId, name: trimmed, needed_qty: Math.max(1, neededQty) });
  if (error) throw error;
}

/**
 * Remove an item from the group list.
 *
 * The claims go with it, by cascade. That is right: a claim on an item nobody
 * needs any more is not a promise anybody should still be holding.
 */
export async function removeGearItem(itemId: string): Promise<void> {
  const { error } = await supabase.from('group_trip_gear_items').delete().eq('id', itemId);
  if (error) throw error;
}

/** What the operator tells everyone to bring for themselves. */
export async function fetchPackingSuggestions(tripId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('group_trips')
    .select('personal_gear_host_suggestion')
    .eq('id', tripId)
    .single();
  if (error) throw error;
  const list = data?.personal_gear_host_suggestion;
  return Array.isArray(list) ? (list as string[]) : [];
}

/**
 * Replace the whole suggestion list.
 *
 * ⚠️ ONE array write, never a loop. A database trigger fans this out into every
 * participant's own `personal_gear_by_host` checklist and preserves the done
 * state of items that survive the edit. Writing per traveler from here would
 * both duplicate that logic and lose their ticks.
 */
export async function setPackingSuggestions(tripId: string, names: string[]): Promise<void> {
  const cleaned = names.map(n => n.trim()).filter(Boolean);
  const { error } = await supabase
    .from('group_trips')
    .update({ personal_gear_host_suggestion: cleaned })
    .eq('id', tripId);
  if (error) throw error;
}

/** Items travelers have asked to add to the group list. */
export async function fetchGearRequests(tripId: string): Promise<GearRequest[]> {
  const { data, error } = await supabase
    .from('group_trip_gear_requests')
    .select('id, requester_id, item_name, needed_qty, note, created_at')
    .eq('trip_id', tripId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id as string,
    requesterId: r.requester_id as string,
    itemName: (r.item_name as string) ?? '',
    neededQty: Number(r.needed_qty) || 1,
    note: (r.note as string | null) ?? null,
    createdAt: (r.created_at as string | null) ?? null,
  }));
}

/**
 * Say yes or no to a request.
 *
 * Approving ALSO creates the group item — the request is the ask, the item is
 * the thing. Order matters: the item is inserted first, so a failure leaves a
 * request still pending rather than an approved request with nothing behind it.
 */
export async function decideGearRequest(args: {
  tripId: string;
  request: GearRequest;
  decision: 'approved' | 'declined';
  /** Approvals only. The operator may change what the traveler asked for. */
  neededQty?: number;
}): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (args.decision === 'approved') {
    await addGearItem(args.tripId, args.request.itemName, args.neededQty ?? args.request.neededQty);
  }

  const { error } = await supabase
    .from('group_trip_gear_requests')
    .update({
      status: args.decision,
      reviewed_at: new Date().toISOString(),
      reviewed_by: user?.id ?? null,
    })
    .eq('id', args.request.id)
    // Only one still waiting — two managers with the page open must not both
    // "succeed", with the second overwriting the first's decision.
    .eq('status', 'pending');
  if (error) throw error;
}
