// Shared UI for admin-update rows, used by BOTH the Plan-tab preview
// (PlanSections) and the full Updates page (TripUpdatesScreen) so the two stay
// visually and behaviourally identical (Figma node 12933-38204):
//   • AnnouncementIcon — the exact "announcement-02" bullhorn vector.
//   • AdminUpdateRow   — a single-line update card. When the body overflows one
//     line the whole card becomes tappable and surfaces a chevron affordance;
//     tapping asks the parent to open the detail overlay.
//   • UpdateDetailModal — the centered overlay showing the full update text.
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Modal,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { ff } from '../../theme/fonts';
import type { AdminUpdate } from '../../services/trips/groupTripsService';

// Tokens mirror the Figma frame (white card, #EEEEEE border, #F7F7F7 icon box).
const C = {
  surface: '#FFFFFF',
  cardBorder: '#EEEEEE',
  iconBg: '#F7F7F7',
  ink: '#222B30',
  title: '#333333',
  time: '#6A7282',
  muted: '#7B7B7B',
  scrim: 'rgba(17, 24, 28, 0.45)',
} as const;

// Exact "announcement-02" glyph from Figma (node 12933:38205 / 2007:2108).
export const AnnouncementIcon: React.FC<{ size?: number; color?: string }> = ({
  size = 18,
  color = C.ink,
}) => (
  <Svg width={size} height={size} viewBox="0 0 16 15.3366" fill="none">
    <Path
      d="M2 8.83664L3.18099 13.5606C3.2142 13.6934 3.23081 13.7599 3.25045 13.8179C3.44238 14.3845 3.95264 14.7829 4.54889 14.8316C4.60993 14.8366 4.6784 14.8366 4.81534 14.8366C4.98683 14.8366 5.07257 14.8366 5.14481 14.8296C5.85875 14.7604 6.42375 14.1954 6.493 13.4814C6.5 13.4092 6.5 13.3235 6.5 13.152V2.46164M12.875 8.46164C14.3247 8.46164 15.5 7.28639 15.5 5.83664C15.5 4.38689 14.3247 3.21164 12.875 3.21164M6.6875 2.46164H3.875C2.01104 2.46164 0.499999 3.97268 0.5 5.83664C0.500001 7.7006 2.01104 9.21164 3.875 9.21164H6.6875C8.01232 9.21164 9.63294 9.92181 10.8832 10.6034C11.6126 11.001 11.9773 11.1998 12.2162 11.1705C12.4377 11.1434 12.6052 11.044 12.735 10.8625C12.875 10.6668 12.875 10.2751 12.875 9.49192V2.18135C12.875 1.39814 12.875 1.00653 12.735 0.810807C12.6052 0.629316 12.4377 0.529865 12.2162 0.502737C11.9773 0.473482 11.6126 0.67229 10.8832 1.06991C9.63293 1.75147 8.01232 2.46164 6.6875 2.46164Z"
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const AdminUpdateRow: React.FC<{
  update: AdminUpdate;
  formatTime: (iso: string) => string;
  /** Called when a truncated card is tapped — parent opens the detail overlay. */
  onOpenDetail: (u: AdminUpdate) => void;
  /** Host long-press → Edit/Delete menu (Plan tab only). */
  onLongPress?: () => void;
  /** Trailing slot, e.g. the host "Edit" link (Plan tab only). */
  right?: React.ReactNode;
}> = ({ update, formatTime, onOpenDetail, onLongPress, right }) => {
  const [truncated, setTruncated] = useState(false);

  return (
    <Pressable
      onPress={truncated ? () => onOpenDetail(update) : undefined}
      onLongPress={onLongPress}
      style={styles.card}
    >
      <View style={styles.iconBox}>
        <AnnouncementIcon size={18} color={C.ink} />
      </View>
      <View style={styles.textCol}>
        <Text style={styles.title} numberOfLines={1}>
          {update.body}
        </Text>
        {/* Invisible full-text measurer: lays out every line so we can detect
            one-line overflow without any visible layout shift. pointerEvents
            none keeps it from stealing the card's press. */}
        <View style={styles.measure} pointerEvents="none">
          <Text
            style={styles.title}
            onTextLayout={e => setTruncated(e.nativeEvent.lines.length > 1)}
          >
            {update.body}
          </Text>
        </View>
        <Text style={styles.time}>{formatTime(update.created_at)}</Text>
      </View>
      {right}
      {truncated ? <Ionicons name="chevron-forward" size={16} color={C.muted} /> : null}
    </Pressable>
  );
};

export const UpdateDetailModal: React.FC<{
  update: AdminUpdate | null;
  formatTime: (iso: string) => string;
  onClose: () => void;
}> = ({ update, formatTime, onClose }) => (
  <Modal
    visible={!!update}
    transparent
    animationType="fade"
    statusBarTranslucent
    onRequestClose={onClose}
  >
    {/* Backdrop tap closes; inner press is swallowed so the card stays open. */}
    <TouchableOpacity style={styles.scrim} activeOpacity={1} onPress={onClose}>
      <TouchableOpacity activeOpacity={1} style={styles.sheet} onPress={() => {}}>
        <View style={styles.sheetHeader}>
          <View style={styles.iconBox}>
            <AnnouncementIcon size={18} color={C.ink} />
          </View>
          <Text style={styles.sheetTime}>{update ? formatTime(update.created_at) : ''}</Text>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="close" size={22} color={C.ink} />
          </TouchableOpacity>
        </View>
        <ScrollView
          style={styles.sheetScroll}
          contentContainerStyle={styles.sheetScrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.sheetBody}>{update?.body}</Text>
        </ScrollView>
      </TouchableOpacity>
    </TouchableOpacity>
  </Modal>
);

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 8,
    paddingRight: 16,
    paddingVertical: 18,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.cardBorder,
    borderRadius: 20,
  },
  iconBox: {
    padding: 10,
    borderRadius: 8,
    backgroundColor: C.iconBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textCol: { flex: 1 },
  title: { fontFamily: ff('Inter', '700'), fontSize: 12, lineHeight: 18, fontWeight: '700', color: C.title },
  time: { fontFamily: ff('Inter', '400'), fontSize: 10, lineHeight: 20, color: C.time, marginTop: 2 },
  measure: { position: 'absolute', left: 0, right: 0, top: 0, opacity: 0 },

  // Detail overlay
  scrim: {
    flex: 1,
    backgroundColor: C.scrim,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  sheet: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '70%',
    backgroundColor: C.surface,
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 24,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  sheetTime: { flex: 1, fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18, color: C.time },
  sheetScroll: { flexGrow: 0 },
  sheetScrollContent: { paddingBottom: 4 },
  sheetBody: { fontFamily: ff('Inter', '400'), fontSize: 15, lineHeight: 22, color: C.title },
});
