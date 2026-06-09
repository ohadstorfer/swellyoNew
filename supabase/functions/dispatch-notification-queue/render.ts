// Pure push-text renderer. No DB/network — easy to unit test.
// `data` is the frozen notifications.data snapshot; `tripTitle` is fetched by the
// dispatcher (some triggers don't store the title in data).
type PushText = { title: string; body: string };

export function renderPush(type: string, data: Record<string, any>, tripTitle: string): PushText {
  const trip = tripTitle || 'your trip';
  const actor = data?.actor_name || 'Someone';
  const item = data?.item_name || data?.gear_name || 'an item';
  const decision = data?.decision;

  switch (type) {
    case 'join_request_received':
      return { title: 'New trip request', body: `${actor} wants to join ${trip}` };
    case 'join_request_decided':
      return decision === 'approved'
        ? { title: "You're in! 🌊", body: `Your request to join ${trip} was approved` }
        : { title: 'Trip request update', body: `Your request for ${trip} wasn't accepted this time` };
    case 'commitment_request_received':
      return { title: 'Commit request', body: `${actor} wants to commit to ${trip}` };
    case 'commitment_decided': // only the approved path reaches push (see mapping)
      return { title: "You're locked in 🤙", body: `Your commitment to ${trip} was approved` };
    case 'member_committed':
      return { title: `${trip}`, body: `${actor} just committed — the group is filling up` };
    case 'gear_request_received':
      return { title: 'Gear request', body: `${actor} proposed "${item}" for ${trip}` };
    case 'gear_request_decided':
      return decision === 'approved'
        ? { title: 'Gear approved', body: `"${item}" was added — claim it in ${trip}` }
        : { title: 'Gear update', body: `"${item}" wasn't added to ${trip}` };
    case 'admin_update_posted':
      return { title: `Update in ${trip}`, body: data?.preview || 'The host posted an update' };
    case 'group_gear_updated':
      return { title: 'Gear list updated', body: `The group gear list changed in ${trip}` };
    case 'personal_gear_updated':
      return { title: 'Your packing list', body: `Your packing list for ${trip} was updated` };
    case 'member_left':
      return { title: 'A spot opened', body: `${actor} left ${trip} — invite or refill` };
    case 'trip_cancelled':
      return { title: 'Trip cancelled', body: `${trip} was cancelled — see why` };
    case 'member_removed':
      return { title: 'Trip update', body: `You're no longer part of ${trip}` };
    case 'trip_reminder': {
      const s = data?.stage || '';
      if (s === 'week')     return { title: `${trip} — 1 week to go`, body: 'Get ready — packing list inside' };
      if (s === 'tomorrow') return { title: `${trip} is tomorrow!`, body: 'Final details + meeting point inside' };
      if (s === 'today')    return { title: `${trip} starts today`, body: 'Have a great trip' };
      if (s.startsWith('commit_')) return { title: `Lock your spot in ${trip}`, body: `${s.split('_')[1]} days out — commit now` };
      if (s.startsWith('gear_'))   return { title: `${trip}: gear still needed`, body: 'Some items still need an owner' };
      return { title: trip, body: 'Trip update' };
    }
    case 'trip_ended':
      return { title: `${trip} — that's a wrap`, body: 'Share your photos & memories' };
    default:
      return { title: trip, body: 'You have a new trip update' };
  }
}
