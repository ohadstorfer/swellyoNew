// Exact commitment card icons from Figma 13456-46488 (Untitled UI stroke set:
// ticket-01 / home-03 / luggage-01). Rendered as real vectors so the screen
// matches the design pixel-for-pixel instead of approximating with Ionicons.
// Shared by CommitmentScreen (cards) and CommitmentMessageBubble (host chips)
// so the two never drift. Legacy / unknown keys fall back to their Ionicons.
import React from 'react';
import Svg, { Path } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { commitmentItemMeta } from './commitmentOptions';

type Props = { itemKey: string; size?: number; color?: string };

// viewBox + path copied verbatim from the Figma export (stroke-width was
// dropped on export; 1.0 matches the intended weight at these small viewBoxes).
const PATHS: Record<string, { vb: string; d: string }> = {
  flight_booked: {
    vb: '0 0 16 13',
    d: 'M6.5 3.5V2.75M6.5 6.875V6.125M6.5 10.25V9.5M2.9 0.5H13.1C13.9401 0.5 14.3601 0.5 14.681 0.663491C14.9632 0.807301 15.1927 1.03677 15.3365 1.31901C15.5 1.63988 15.5 2.05992 15.5 2.9V3.875C14.0503 3.875 12.875 5.05025 12.875 6.5C12.875 7.94975 14.0503 9.125 15.5 9.125V10.1C15.5 10.9401 15.5 11.3601 15.3365 11.681C15.1927 11.9632 14.9632 12.1927 14.681 12.3365C14.3601 12.5 13.9401 12.5 13.1 12.5H2.9C2.05992 12.5 1.63988 12.5 1.31901 12.3365C1.03677 12.1927 0.807301 11.9632 0.663491 11.681C0.5 11.3601 0.5 10.9401 0.5 10.1V9.125C1.94975 9.125 3.125 7.94975 3.125 6.5C3.125 5.05025 1.94975 3.875 0.5 3.875V2.9C0.5 2.05992 0.5 1.63988 0.663491 1.31901C0.807301 1.03677 1.03677 0.807301 1.31901 0.663491C1.63988 0.5 2.05992 0.5 2.9 0.5Z',
  },
  accommodation_booked: {
    vb: '0 0 16.0001 15.0625',
    d: 'M5.75003 14.5625V9.0125C5.75003 8.59246 5.75003 8.38244 5.83178 8.22201C5.90368 8.08089 6.01842 7.96615 6.15954 7.89425C6.31997 7.8125 6.52999 7.8125 6.95003 7.8125H9.05003C9.47007 7.8125 9.68009 7.8125 9.84053 7.89425C9.98165 7.96615 10.0964 8.08089 10.1683 8.22201C10.25 8.38244 10.25 8.59246 10.25 9.0125V14.5625M0.500029 5.9375L7.28003 0.8525C7.53823 0.658854 7.66732 0.562032 7.80911 0.524709C7.93426 0.491764 8.06581 0.491764 8.19096 0.524709C8.33274 0.562032 8.46184 0.658855 8.72003 0.8525L15.5 5.9375M2.00003 4.8125V12.1625C2.00003 13.0026 2.00003 13.4226 2.16352 13.7435C2.30733 14.0257 2.5368 14.2552 2.81905 14.399C3.13991 14.5625 3.55995 14.5625 4.40003 14.5625H11.6C12.4401 14.5625 12.8602 14.5625 13.181 14.399C13.4633 14.2552 13.6927 14.0257 13.8365 13.7435C14 13.4226 14 13.0026 14 12.1625V4.8125L9.44003 1.3925C8.92364 1.00521 8.66545 0.811564 8.38188 0.736918C8.13158 0.671028 7.86849 0.671028 7.61818 0.736918C7.33461 0.811564 7.07642 1.00521 6.56003 1.3925L2.00003 4.8125Z',
  },
  something_else: {
    vb: '0 0 13 16',
    d: 'M3.5 15.5V14M4.625 10.25V4.25M9.5 15.5V14M8.375 10.25V4.25M4.1 14H8.9C10.1601 14 10.7902 14 11.2715 13.7548C11.6948 13.539 12.039 13.1948 12.2548 12.7715C12.5 12.2902 12.5 11.6601 12.5 10.4V4.1C12.5 2.83988 12.5 2.20982 12.2548 1.72852C12.039 1.30516 11.6948 0.960951 11.2715 0.745236C10.7902 0.5 10.1601 0.5 8.9 0.5H4.1C2.83988 0.5 2.20982 0.5 1.72852 0.745236C1.30516 0.960951 0.960951 1.30516 0.745236 1.72852C0.5 2.20982 0.5 2.83988 0.5 4.1V10.4C0.5 11.6601 0.5 12.2902 0.745236 12.7715C0.960951 13.1948 1.30516 13.539 1.72852 13.7548C2.20982 14 2.83988 14 4.1 14Z',
  },
};

export const CommitmentCardIcon: React.FC<Props> = ({ itemKey, size = 18, color = '#222B30' }) => {
  const p = PATHS[itemKey];
  if (!p) {
    return <Ionicons name={commitmentItemMeta(itemKey).icon} size={size} color={color} />;
  }
  return (
    <Svg width={size} height={size} viewBox={p.vb} fill="none">
      <Path d={p.d} stroke={color} strokeWidth={1} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
};

export default CommitmentCardIcon;
