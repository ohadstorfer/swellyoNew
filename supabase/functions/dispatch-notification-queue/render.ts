// Pure push-text renderer. No DB/network — easy to unit test.
// `data` is the frozen notifications.data snapshot; `tripTitle` is fetched by the
// dispatcher (some triggers don't store the title in data).
// `templates` (optional) comes from public.notification_templates — when a row
// exists for the key, its text wins; otherwise the hardcoded default applies.
type PushText = { title: string; body: string };

export type PushTemplate = { push_title: string | null; push_body: string | null };
export type PushTemplateMap = Record<string, PushTemplate>;

/** Template row key for a notification: type, or type:variant for splits. */
export function templateKey(type: string, data: Record<string, any>): string {
  if (type === 'join_request_decided' || type === 'commitment_decided' || type === 'gear_request_decided') {
    return `${type}:${data?.decision === 'approved' ? 'approved' : 'declined'}`;
  }
  if (type === 'trip_reminder') {
    const s = data?.stage || '';
    if (s === 'tomorrow' || s === 'today') return `trip_reminder:${s}`;
    if (s.startsWith('commit_')) return 'trip_reminder:commit';
    if (s.startsWith('gear_')) return 'trip_reminder:gear';
    return 'trip_reminder:week';
  }
  return type;
}

/** Replace {placeholders}; unknown ones are left as-is. */
function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
}

export function renderPush(
  type: string,
  data: Record<string, any>,
  tripTitle: string,
  templates?: PushTemplateMap,
): PushText {
  const trip = tripTitle || 'your trip';
  const actor = data?.actor_name || 'Someone';
  const item = data?.item_name || data?.gear_name || 'an item';
  const decision = data?.decision;
  const stage = data?.stage || '';

  // Editable template takes precedence when both fields are set.
  const tpl = templates?.[templateKey(type, data)];
  if (tpl?.push_title && tpl?.push_body) {
    const vars: Record<string, string> = {
      trip,
      actor,
      item,
      qty: data?.qty != null ? String(data.qty) : '',
      preview: data?.preview || 'The host posted an update',
      days: stage.includes('_') ? stage.split('_')[1] : '',
    };
    return { title: fill(tpl.push_title, vars), body: fill(tpl.push_body, vars) };
  }

  switch (type) {
    case 'join_request_received':
      return { title: 'New trip request', body: `${actor} requested to join ${trip}` };
    case 'join_request_decided':
      return decision === 'approved'
        ? { title: "You're in! 🌊", body: `Your request to join ${trip} was approved` }
        : { title: 'Trip request update', body: `Your request for ${trip} wasn't accepted this time` };
    case 'commitment_request_received':
      return { title: 'Commit request', body: `${actor} wants to commit to ${trip}` };
    case 'commitment_decided': // only the approved path reaches push (see mapping)
      return { title: "You're locked in 🤙", body: `Your commitment to ${trip} was approved` };
    case 'member_committed':
      return { title: `${trip}`, body: `${actor} just committed - the trip is coming up!` };
    case 'gear_request_received':
      return { title: 'Gear suggestion', body: `${actor} suggested to add "${item}" to the group gear` };
    case 'gear_request_decided':
      return decision === 'approved'
        ? { title: 'Gear approved ✅', body: `Your "${item}" suggestion was added to the group gear list - go claim it!` }
        : { title: 'Gear update', body: `Your "${item}" suggestion wasn't added to ${trip}` };
    case 'admin_update_posted':
      return { title: `New update in ${trip}`, body: data?.preview || 'The host posted an update' };
    case 'group_gear_updated':
      return { title: 'Group gear update', body: `The group gear list changed in ${trip} - go check it out!` };
    case 'personal_gear_updated':
      return { title: 'Personal packing list', body: `Your packing list for ${trip} was updated` };
    case 'member_left':
      return { title: 'Oh no! Someone left your trip 📉', body: `A member left ${trip}` };
    case 'trip_cancelled':
      return { title: 'Wow! Your trip was cancelled', body: `${trip} was cancelled by the admin - see why` };
    case 'member_removed':
      return { title: 'Trip update', body: `The admin decided to remove you from ${trip}` };
    case 'trip_reminder': {
      const s = stage;
      if (s === 'week')     return { title: `${trip} - 1 week to go!!`, body: 'Check out your packing gear and get ready' };
      if (s === 'tomorrow') return { title: `${trip} is tomorrow!`, body: 'Make your final checks, make sure you are ready' };
      if (s === 'today')    return { title: `${trip} starts today 🤩`, body: 'Have a great trip - team Swellyo' };
      if (s.startsWith('commit_')) return { title: `Lock your spot in ${trip}`, body: `${s.split('_')[1]} days out - commit now` };
      if (s.startsWith('gear_'))   return { title: `${trip}: gear still needed`, body: 'Some items still need an owner' };
      return { title: trip, body: 'Trip update' };
    }
    case 'trip_ended':
      return { title: `${trip} has come to an end 🌅`, body: 'Share your photos & memories' };
    default:
      return { title: trip, body: 'You have a new trip update' };
  }
}
