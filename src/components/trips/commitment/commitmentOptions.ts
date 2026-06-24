// Shared commitment options — the single source of truth for the member's
// commitment choices and how a stored item renders. Imported by:
//   • CommitmentScreen          — the member's selectable cards (step 1)
//   • CommitmentMessageBubble    — the chips the host sees in chat
// These two lists used to be duplicated and silently drifted; keep them here.
import { Ionicons } from '@expo/vector-icons';
import type { CommitmentItem } from '../../../services/trips/groupTripsService';

export interface CommitmentOption {
  key: CommitmentItem;
  /** Card title — also the label on the host's chat chip. */
  label: string;
  /** Card subtitle (member screen only). */
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
}

/** The choices a member can pick from, in display order (Figma 13456-46488). */
export const COMMITMENT_OPTIONS: CommitmentOption[] = [
  {
    key: 'flight_booked',
    label: 'Flight booked',
    subtitle: "You're locked in and ready to go",
    icon: 'ticket-outline',
  },
  {
    key: 'accommodation_booked',
    label: 'Accommodation booked',
    subtitle: 'Covered and good to go',
    icon: 'home-outline',
  },
  {
    key: 'something_else',
    label: 'Something else',
    subtitle: 'Share your situation with the group',
    icon: 'chatbubble-ellipses-outline',
  },
];

type ItemMeta = { label: string; icon: keyof typeof Ionicons.glyphMap };

// Label/icon for any stored item — including legacy values we no longer offer
// (e.g. 'insurance_sorted' from before the Accommodation rename) so old chips
// still read nicely instead of surfacing the raw key.
const ITEM_META: Record<string, ItemMeta> = {
  ...COMMITMENT_OPTIONS.reduce<Record<string, ItemMeta>>((acc, o) => {
    acc[o.key] = { label: o.label, icon: o.icon };
    return acc;
  }, {}),
  insurance_sorted: { label: 'Insurance sorted', icon: 'shield-checkmark-outline' },
};

/** Resolve a stored commitment item to its label + icon (safe fallback). */
export function commitmentItemMeta(key: string): ItemMeta {
  return ITEM_META[key] ?? { label: key, icon: 'checkmark-outline' };
}
