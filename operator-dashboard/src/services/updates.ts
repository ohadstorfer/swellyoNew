import { supabase } from '../lib/supabase';

/**
 * Admin updates — the operator talking to everyone on the trip at once.
 *
 * Product Specs lists "admin updates — view + send" in the crew, manager and
 * operator columns of both the Plan screen and the dashboard. The site has had
 * neither.
 *
 * ── This is also the answer to "chat on the desktop", for now ──────────────
 * Decision D5, 4 September 2026: a full messaging client on this site is a
 * realtime socket, a conversation list, attachments, read state and typing —
 * a second app, not a page. An admin update is the broadcast half of what an
 * operator actually uses the chat for ("the boat leaves at six, bring a
 * towel"), it is one table with no realtime, and it reaches every traveler's
 * phone through the notification the trigger already sends. Ship this, then
 * decide whether the one-to-one half earns its own build.
 *
 * ── Rule 1 ─────────────────────────────────────────────────────────────────
 * No new table, no new function, no migration. `group_trip_admin_updates` is
 * the app's table and its RLS is the boundary: reading is roster-level, posting
 * needs `updates.send` (20260817000000).
 */
export type AdminUpdate = {
  id: string;
  tripId: string;
  authorId: string | null;
  title: string;
  body: string | null;
  createdAt: string | null;
};

function toUpdate(u: any): AdminUpdate {
  return {
    id: u.id as string,
    tripId: u.trip_id as string,
    authorId: (u.author_id as string | null) ?? null,
    title: (u.title as string) ?? '',
    body: (u.body as string | null) ?? null,
    createdAt: (u.created_at as string | null) ?? null,
  };
}

export async function fetchAdminUpdates(tripId: string): Promise<AdminUpdate[]> {
  const { data, error } = await supabase
    .from('group_trip_admin_updates')
    .select('id, trip_id, author_id, title, body, created_at')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toUpdate);
}

/**
 * Post one.
 *
 * A title is required and a body is not — the same rule the app enforces
 * (`addAdminUpdate` throws on an empty title). An update with no title is a
 * notification with nothing on the lock screen.
 */
export async function postAdminUpdate(args: {
  tripId: string;
  title: string;
  body: string;
}): Promise<AdminUpdate> {
  const title = args.title.trim();
  const body = args.body.trim();
  if (!title) throw new Error('Give the update a title.');

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('You are signed out. Sign in and try again.');

  const { data, error } = await supabase
    .from('group_trip_admin_updates')
    .insert({ trip_id: args.tripId, author_id: user.id, title, body })
    .select('id, trip_id, author_id, title, body, created_at')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'Could not post that update.');
  return toUpdate(data);
}

export async function editAdminUpdate(
  updateId: string,
  title: string,
  body: string,
): Promise<void> {
  const t = title.trim();
  if (!t) throw new Error('Give the update a title.');
  const { error } = await supabase
    .from('group_trip_admin_updates')
    .update({ title: t, body: body.trim() })
    .eq('id', updateId);
  if (error) throw error;
}

export async function deleteAdminUpdate(updateId: string): Promise<void> {
  const { error } = await supabase
    .from('group_trip_admin_updates')
    .delete()
    .eq('id', updateId);
  if (error) throw error;
}
