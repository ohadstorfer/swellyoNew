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
    const approved = data?.decision === 'approved';
    // An approved request on an operator trip is a DIFFERENT message from an
    // approved request on a peer trip — see the switch below. They must not
    // share a template key: a row added for `join_request_decided:approved`
    // wins over the switch (line ~44) and would silently put the peer copy
    // back on operator trips, which is the exact bug the split exists to fix.
    if (type === 'join_request_decided' && approved && data?.needs_onboarding) {
      return 'join_request_decided:approved_onboarding';
    }
    return `${type}:${approved ? 'approved' : 'declined'}`;
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
      if (decision !== 'approved') {
        return { title: 'Trip request update', body: `Your request for ${trip} wasn't accepted this time` };
      }
      // ⚠️ On an OPERATOR trip, approval is the starting line, not the finish
      // line. `enforce_participant_status` puts them in `status='onboarding'`,
      // they owe a deposit and every must_have requirement, and
      // `activate_trip_membership` will not promote them until those are done.
      // "You're in" is simply false there, and it is the push people act on.
      //
      // `needs_onboarding` is written by `tg_notify_join_request_decided`
      // (20260820000500). A row created before that migration has no such key
      // and falls to the peer copy below — today's behaviour, the safe half,
      // same fallback rule as `has_deadlines` on trip_dates_changed.
      //
      // Still celebrates: they WERE approved, and burying that would read as a
      // rejection. It just refuses to say the spot is held when it is not —
      // the same sentence `onboarding_unfinished` has to say at 24 hours,
      // moved to where the traveler first needs it.
      if (data?.needs_onboarding) {
        return {
          title: `You're approved for ${trip} 🌊`,
          body: 'Your spot is held once you pay the deposit and send what the trip needs.',
        };
      }
      return { title: "You're in! 🌊", body: `Your request to join ${trip} was approved` };
    case 'commitment_request_received':
      return { title: 'Commit request', body: `${actor} wants to commit to ${trip}` };
    case 'commitment_decided': // only the approved path reaches push (see mapping)
      return { title: "You're locked in 🤙", body: `Your commitment to ${trip} was approved` };
    case 'member_committed':
      return { title: `${trip}`, body: `${actor} just committed — the trip is coming up!` };
    case 'gear_request_received':
      return { title: 'Gear suggestion', body: `${actor} suggested adding "${item}" to the group gear` };
    case 'gear_request_decided':
      return decision === 'approved'
        ? { title: 'Gear approved ✅', body: `Your "${item}" suggestion was added to the group gear list — go claim it!` }
        : { title: 'Gear update', body: `Your "${item}" suggestion wasn't added to ${trip}` };
    case 'admin_update_posted':
      return { title: `New update in ${trip}`, body: data?.preview || 'The host posted an update' };
    case 'group_gear_updated':
      return { title: 'Group gear update', body: `The group gear list changed in ${trip} — go check it out!` };
    case 'personal_gear_updated':
      return { title: 'Personal packing list', body: `Your packing list for ${trip} was updated` };
    case 'member_left': {
      // Same convention as `trip_cancelled` and `member_removed` below:
      // `paid_usd` is only written when there is money sitting with the
      // operator, so its absence is the "say nothing about money" case. Never
      // render a zero.
      //
      // On an operator trip this is the ONLY signal that money went quiet —
      // the traveler keeps nothing back, nothing is refunded automatically,
      // and a sad face about a free seat is not a prompt to decide a refund.
      // fn_notify_member_left sends it to whoever holds `money.manage`
      // (20260906000400), so everyone who reads this line can act on it.
      const paid = Number(data?.paid_usd);
      if (Number.isFinite(paid) && paid > 0) {
        return {
          title: `${actor} left ${trip}`,
          body: `They paid $${paid.toFixed(2)}, and it is still with you. Decide their refund from their page.`,
        };
      }
      return { title: 'Oh no! Someone left your trip 📉', body: `A member left ${trip}` };
    }
    case 'trip_cancelled': {
      // Same convention as `member_removed` right below, and for the same
      // reason: `refund_usd` is only written when money is actually coming
      // back, so its absence is the "say nothing about money" case. Never
      // render a zero.
      //
      // On a managed trip, cancelling refunds everyone in full (`trip-cancel`,
      // 2026-08-19) — and until 20 Aug this push did not mention it, leaving
      // someone who had paid $3,000 to work it out for themselves. The amount
      // is written by `tg_notify_trip_cancelled` (20260820000900), read off the
      // ledger before the refunds run.
      const refund = typeof data?.refund_usd === 'number' && data.refund_usd > 0 ? data.refund_usd : null;
      return {
        title: 'Your trip was cancelled',
        body: refund
          ? `${trip} was cancelled. $${refund.toFixed(2)} is being refunded — it reaches you in 5–10 business days`
          : `${trip} was cancelled by the admin — see why`,
      };
    }
    case 'member_removed': {
      // `refund_usd` is only written when money actually went back, so its
      // absence is the "say nothing about money" case — never render a zero.
      const refund = typeof data?.refund_usd === 'number' && data.refund_usd > 0 ? data.refund_usd : null;
      return {
        title: 'Trip update',
        body: refund
          ? `The admin decided to remove you from ${trip}. $${refund.toFixed(2)} is being refunded — it reaches you in 5–10 business days`
          : `The admin decided to remove you from ${trip}`,
      };
    }
    case 'trip_reminder': {
      const s = stage;
      if (s === 'week')     return { title: `${trip} — 1 week to go!`, body: 'Check out your packing gear and get ready' };
      if (s === 'tomorrow') return { title: `${trip} is tomorrow!`, body: "Make your final checks and make sure you're ready" };
      if (s === 'today')    return { title: `${trip} starts today 🤩`, body: 'Have a great trip — Team Swellyo' };
      if (s.startsWith('commit_')) return { title: `Lock your spot in ${trip}`, body: `${s.split('_')[1]} days out — commit now` };
      if (s.startsWith('gear_'))   return { title: `${trip}: gear still needed`, body: 'Some items still need an owner' };
      return { title: trip, body: 'Trip update' };
    }
    case 'trip_ended':
      return { title: `${trip} has come to an end 🌅`, body: 'Share your photos & memories' };
    case 'trip_invite_received':
      return { title: "You're invited! 🌊", body: `${actor} invited you to join ${trip}` };
    case 'trip_invite_accepted':
      return { title: 'Invite accepted 🎉', body: `${actor} accepted your invite to ${trip}` };
    case 'trip_invite_declined':
      return { title: 'Invite update', body: `${actor} declined your invite to ${trip}` };
    case 'operator_document_rejected': {
      // The operator's note is the whole point — it is the only thing that tells
      // the traveler what to send instead. It leads the body, and the document
      // name leads the title so someone with several outstanding items knows
      // which one to redo. No emoji: this is a chore, not good news.
      const what = data?.requirement_title || 'document';
      return {
        title: `Send a new ${String(what).toLowerCase()}`,
        body: data?.note
          ? `${data.note}`
          : `Your organiser asked for a new one for ${trip}`,
      };
    }
    case 'operator_requirement_due_soon':
      // The operator tapped "Remind N people" on their Dashboard. Names the
      // document, for the same reason the rejection above does: someone with
      // three outstanding items needs to know which one is being asked for.
      //
      // NOT REACHED IN PRODUCTION TODAY — `notification_templates` carries a row
      // for this key (20260806000000) and the template wins at line 44. This is
      // the fallback if that row is ever deleted, and it closes the TODO that
      // 20260724000500 left ("copy for these types still has to be added to
      // dispatch-notification-queue/render.ts"). It is also why shipping this
      // needed no deploy of this function, whose live copy is behind the repo.
      return {
        title: `Still needed for ${trip}`,
        body: `Your organiser is waiting for ${item}`,
      };
    case 'operator_requirement_overdue': {
      // Written by scan-requirement-deadlines (20260820000000) — the FIRST
      // producer this type has ever had. No template row on purpose: the copy
      // needs a formatted due date, and neither `fill()` above knows a {date}
      // var. Priority 0 (notification_push_priority) — this one bypasses
      // quiet hours, because a missed deadline is the urgent case its sibling
      // due_soon is not.
      const label = data?.due_date_label ? ` It was due ${data.due_date_label}.` : '';
      return {
        title: `${item} is late`,
        body: `${trip} is still waiting.${label}`,
      };
    }
    case 'operator_requirement_overdue_operator': {
      // Same producer, the operator's half. One push per REQUIREMENT, never
      // one per stuck traveler — `data.count` is why it can say that plainly
      // instead of naming everyone.
      const count = typeof data?.count === 'number' ? data.count : null;
      const who = count === 1 ? '1 person' : `${count ?? 'Some'} people`;
      return {
        title: `${who} late on ${item}`,
        body: `Open ${trip} to chase them`,
      };
    }
    case 'operator_payment_stuck':
      // NOT REACHED IN PRODUCTION TODAY — 20260819000100 seeds a
      // `notification_templates` row for this key and the template wins at
      // line 44, which is what let the type ship with no deploy of this
      // function (whose live copy is behind the repo). This is the fallback if
      // that row is ever deleted. Same arrangement as
      // `operator_requirement_due_soon` above.
      //
      // "Nothing was charged" leads for the same reason it does in the bell
      // copy: it answers the fear before giving the instruction.
      return {
        title: `Your payment for ${trip} did not go through`,
        body: 'Nothing was charged — you can try again',
      };
    case 'operator_payment_landed': {
      // ACH (ach-bank-payments.md): the bank payment the traveler made three
      // days ago has cleared. No template row on purpose — the copy carries
      // the amount and `fill()` knows no {amount}. The step is named from
      // `item_name` ("Deposit") so it reads as the thing they paid, not "a
      // payment". 🎉 is earned here: three days of "on its way" ends now.
      const landedAmount =
        typeof data?.amount_usd === 'number' ? `$${Math.round(data.amount_usd).toLocaleString('en-US')} ` : '';
      const step = (data?.item_name || 'payment').toString().toLowerCase();
      // Operator-facing variant: the payment cleared AFTER the trip was
      // cancelled, so the recipient is the OPERATOR and the message is a
      // to-do, not a celebration.
      if (data?.on_cancelled_trip === true) {
        return {
          title: `A ${landedAmount}bank payment landed on ${trip}`,
          body: "It cleared after the trip was cancelled — refund it from the traveler's Money card.",
        };
      }
      return {
        title: `Your ${landedAmount}${step} for ${trip} arrived 🎉`,
        body: "The bank transfer cleared — you're all set on this one.",
      };
    }
    case 'operator_charge_disputed': {
      // Phase 3 (refunds-and-merchant-of-record.md): a traveler's bank opened
      // a chargeback. No template row on purpose — the copy needs the amount
      // and the evidence deadline, and fill() knows neither {amount} nor
      // {date}. Same arrangement as operator_requirement_overdue.
      //
      // The deadline is the whole message: it is the only dispute moment with
      // a clock on it, and the reason this type bypasses quiet hours
      // (priority 0). No emoji — this is a fight, not news.
      const amount = typeof data?.amount_usd === 'number' ? `$${data.amount_usd.toFixed(2)} ` : '';
      const due = data?.evidence_due_label ? ` Evidence is due by ${data.evidence_due_label}.` : '';
      return {
        title: `A ${amount}payment was disputed`,
        body: `A traveler's bank is taking back a payment on ${trip}.${due}`,
      };
    }
    case 'operator_dispute_closed': {
      // Same case, resolved. `outcome` decides everything: 'lost' means the
      // money really left (a negative ledger row exists by now), 'won' means
      // nothing moved and the wait is over.
      const amount = typeof data?.amount_usd === 'number' ? `$${data.amount_usd.toFixed(2)}` : 'The payment';
      return data?.outcome === 'lost'
        ? {
            title: 'The dispute was lost',
            body: `${amount} went back to the traveler's bank for ${trip}.`,
          }
        : {
            title: 'You won the dispute 🎉',
            body: `The bank ruled in your favor — the payment on ${trip} stands.`,
          };
    }
    case 'trip_dates_changed': {
      // ⚠️ THIS BRANCH ONLY RUNS ONCE THE TEMPLATE ROW IS GONE. 20260819000300
      // seeds a `trip_dates_changed` row, and a template wins at line 44 — so
      // deploying this function alone changes nothing for this type. The row
      // has to be deleted too, and that is the whole point of doing both:
      //
      //   • `fill()` has no `{date_range}` var, so the TEMPLATE CANNOT NAME THE
      //     DATES. It says "The dates changed" and leaves the reader to go and
      //     find out what they changed to — on the one push whose entire job is
      //     to tell them.
      //   • The template also states "Your deadlines moved with them"
      //     unconditionally, which is simply false on a trip with no deadlines.
      //
      // Both of those are fixed here, where the data is actually available.
      //
      // `date_range` is formatted by the TRIGGER, not here, so the bell and the
      // push name the dates identically — see the note in
      // notificationsService.ts, which carries the same two branches.
      const range = typeof data?.date_range === 'string' ? data.date_range : '';
      // A row written before the key existed falls back to the vaguer sentence
      // rather than printing "undefined" at somebody.
      const moved = data?.has_deadlines ? ' Your deadlines moved with them.' : '';
      return {
        title: `New dates for ${trip}`,
        body: range ? `It now runs ${range}.${moved}` : `The dates changed.${moved}`,
      };
    }
    case 'operator_traveler_confirmed':
      // Feed-only today — `notification_push_priority` returns -1, so this is
      // never reached. Written anyway: the three cases directly below spent a
      // month pushing "You have a new trip update" for exactly this reason, and
      // a one-line priority change is all it would take to repeat it.
      return {
        title: `${actor} is on ${trip}`,
        body: 'Deposit paid and paperwork done — their place is confirmed.',
      };
    case 'operator_staff_invited': {
      // ⚠️ Until 20 Aug this type had NO case here and no template row, so it
      // fell to the default at the bottom and every crew invite went out as
      // "You have a new trip update" — verified on a real device 20 Aug. It is
      // the worst type to lose: priority 0, so it always pushes and always
      // bypasses quiet hours, and it is a QUESTION, not news.
      //
      // The tier leads, matching the bell row word for word. "Ohad invited you
      // to El Salvador 26" says nothing about what is being handed over, and
      // Crew and Manager are very different jobs — a Manager can read every
      // traveler's passport. Naming it means the answer is informed before the
      // accept sheet is even open.
      const tier = data?.role_label || data?.item_name || 'crew';
      return {
        title: `Join ${trip} as ${tier}?`,
        body: `${actor} wants you on the crew.`,
      };
    }
    case 'operator_setup_required':
      // Same 20 Aug gap as above. Never about a trip — it fires when a Swellyo
      // admin flips `surfers.operator`, usually long before the operator's
      // first trip exists, so `trip` here would render as the "your trip"
      // fallback and read like a bug. Same arrangement as
      // `operator_stripe_ready` below.
      //
      // Says what they GET, not what we need, word for word with the bell row:
      // "Finish your setup" is a chore; being told you can now sell trips is
      // the reason to open it.
      return {
        title: 'You can now run trips on Swellyo',
        body: 'Four quick things to set up before you create your first one.',
      };
    case 'operator_requirement_added':
      // The third of the 20 Aug gap. NOTHING PRODUCES THIS TYPE YET — the enum
      // value and its push priority (1) have existed since July with no writer,
      // so this case is here so that whoever adds the producer does not ship
      // "You have a new trip update" with it. Reads `item_name` /
      // `requirement_title`, the pair every other requirement type already
      // writes, so a producer that follows the existing shape works with no
      // change here.
      return {
        title: `Something new to send for ${trip}`,
        body: `Your organiser added ${data?.requirement_title || item} to what the trip needs.`,
      };
    case 'operator_stripe_ready':
      // The one push here that deliberately never mentions a trip: it fires on
      // the operator's ACCOUNT, usually before their first trip exists, so
      // `trip` would render as the "your trip" fallback and read like a bug.
      return {
        title: 'Stripe approved you 🎉',
        body: 'You can now collect payment for your trips in Swellyo.',
      };
    case 'operator_stripe_action_needed':
      // The other direction, and the one that used to be silent: an operator
      // whose account Stripe switched off learned about it from a traveler
      // whose payment failed.
      //
      // Also never about a trip — it fires on the ACCOUNT, so `trip` would
      // render as the "your trip" fallback and read like a bug.
      //
      // No emoji anywhere in here. Two of the four are an outage.
      switch (data?.reason) {
        case 'blocked':
          return {
            title: 'Stripe closed your payout account',
            body: 'You can no longer collect payments in Swellyo. Contact Stripe support to find out why.',
          };
        case 'charges_disabled':
          return {
            title: 'Your payments have stopped',
            body: 'Stripe switched off payments on your account. Travelers cannot pay you until it is fixed.',
          };
        case 'payouts_disabled':
          return {
            title: 'Stripe paused your payouts',
            body: 'You can still take payments, but the money is not reaching your bank yet.',
          };
        default:
          // 'past_due', and the fallback — a reason we do not recognise is
          // still a reason to look.
          return {
            title: 'Stripe needs something from you',
            body: 'Some details are past their deadline. Send them now, or Stripe will stop your payments.',
          };
      }
    case 'onboarding_unfinished': {
      // Paid the deposit, never finished. Three voices, not three sends: the
      // first at 4 hours, the second at 24, and then one that repeats daily for
      // as long as they stay stuck. See scan-stalled-onboarding for the timing.
      //
      // The repeating one is the hardest to write, because it is the only push
      // in the app a person can receive ten times. It stays a question rather
      // than a reminder, and never counts the days back at them — "day 6" reads
      // as a scolding, and the traveler already knows how long it has been.
      //
      // The list of outstanding steps leads the body wherever it fits. Someone
      // who stopped BECAUSE they were unsure which step it was is not helped by
      // "you have steps left", and it is the same reasoning that puts the
      // document name in operator_document_rejected. `missing` is must_have
      // only, so every item named really does block them.
      //
      // No emoji: this is a chore, even when the tone is friendly.
      const missing: string[] = Array.isArray(data?.missing) ? data.missing : [];
      const names = missing.length
        ? missing.slice(0, 2).map(m => String(m).toLowerCase()).join(' and ')
        : null;

      if (stage === '24h') {
        // A day in, the missing step is no longer news to them — the thing they
        // do not know is that the money did not buy the seat.
        return {
          title: "You're not on the list yet",
          body: `Your deposit for ${trip} is paid, but your spot isn't held until the last steps are done.`,
        };
      }
      if (stage === 'repeat') {
        return {
          title: `Still want your place on ${trip}?`,
          body: names
            ? `Your deposit is paid and waiting. We still need your ${names}.`
            : 'Your deposit is paid and waiting. Finishing up takes a few minutes.',
        };
      }
      // '4h', and the fallback. Four hours in they were probably still at the
      // form, so this is the one that names what to go back to.
      return {
        title: 'Nearly on the trip',
        body: names
          ? `Your deposit for ${trip} is paid. Still need your ${names}.`
          : `Your deposit for ${trip} is paid. A few steps are left before your spot is held.`,
      };
    }
    case 'operator_onboarding_stalled': {
      // One digest per trip, never one push per stuck traveler. The count is
      // the whole message; who they are is a tap away on the trip.
      const n = Number(data?.count) || 0;
      return {
        title: n === 1 ? "1 traveler hasn't finished" : `${n} travelers haven't finished`,
        body: `They've paid for ${trip} but still have steps left. Open the trip to see who.`,
      };
    }
    default:
      return { title: trip, body: 'You have a new trip update' };
  }
}
