// Plan-tab presentational sections (Figma nodes 12557-5860 / 12716-6927).
// These are the redesigned blocks shown under the Overview/Plan toggle when
// "Plan" is active: the commit pill, recent admin updates, and Packing & Gear
// (Group Gear + Your Gear). All data + handlers live in TripDetailScreen — this
// file is pure presentation so the screen stays lean and the layout is testable
// in isolation. Operational sections (join requests, breakdown, destructive
// actions) stay in TripDetailScreen below these blocks.

import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  Pressable,
  Animated,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type {
  AdminUpdate,
  EnrichedGearItem,
  CommitmentStatus,
} from '../../../services/trips/groupTripsService';

// ---------------------------------------------------------------------------
// Tokens — mirror the Figma frames (accent #05BCD3, dark #212121, muted greys).
const T = {
  accent: '#05BCD3', // links, checks, Trip Chat button
  ink: '#212121', // commit pill, primary text
  inkBody: '#222B30',
  muted: '#7B7B7B',
  bg: '#FAFAFA',
  surface: '#FFFFFF',
  hairline: '#EFEFEF',
  border: '#E4E4E4',
  done: '#34C759',
  fontHead: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat',
  fontBody: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
} as const;

// ---------------------------------------------------------------------------
// PressableScale — tactile press feedback (Emil: buttons must feel responsive).
// Subtle 0.97 scale on press-in, springs back on release. Native-driven.
const PressableScale: React.FC<{
  onPress?: () => void;
  disabled?: boolean;
  style?: any;
  children: React.ReactNode;
  scaleTo?: number;
  accessibilityLabel?: string;
}> = ({ onPress, disabled, style, children, scaleTo = 0.97, accessibilityLabel }) => {
  const scale = useRef(new Animated.Value(1)).current;
  const animate = (to: number) =>
    Animated.spring(scale, {
      toValue: to,
      useNativeDriver: true,
      speed: 50,
      bounciness: 0,
    }).start();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      onPressIn={() => !disabled && animate(scaleTo)}
      onPressOut={() => animate(1)}
      accessibilityLabel={accessibilityLabel}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
};

// ---------------------------------------------------------------------------
// Avatar + stack (gear contributors)
const initialsOf = (name: string | null): string =>
  (name || '?').trim().charAt(0).toUpperCase() || '?';

const Avatar: React.FC<{ url: string | null; name: string | null; size?: number }> = ({
  url,
  name,
  size = 24,
}) => {
  const dim = { width: size, height: size, borderRadius: size / 2 };
  if (url) return <Image source={{ uri: url }} style={[styles.avatarImg, dim]} />;
  return (
    <View style={[styles.avatarImg, styles.avatarFallback, dim]}>
      <Text style={[styles.avatarInitial, { fontSize: size * 0.42 }]}>{initialsOf(name)}</Text>
    </View>
  );
};

const AvatarStack: React.FC<{
  people: { name: string | null; profile_image_url: string | null }[];
  max?: number;
}> = ({ people, max = 3 }) => {
  if (people.length === 0) {
    // Mirror Figma's faint "+0" chip when nobody has claimed the item yet.
    return (
      <View style={styles.zeroChip}>
        <Ionicons name="add" size={12} color={T.muted} />
        <Text style={styles.zeroChipText}>0</Text>
      </View>
    );
  }
  const shown = people.slice(0, max);
  const overflow = people.length - shown.length;
  return (
    <View style={styles.avatarStack}>
      {shown.map((p, i) => (
        <View key={i} style={[styles.avatarWrap, i > 0 && styles.avatarOverlap]}>
          <Avatar url={p.profile_image_url} name={p.name} />
        </View>
      ))}
      {overflow > 0 ? <Text style={styles.avatarMore}>+{overflow}</Text> : null}
    </View>
  );
};

// ---------------------------------------------------------------------------
// SectionCard — white rounded surface used by every Plan block.
const SectionCard: React.FC<{ children: React.ReactNode; style?: any }> = ({ children, style }) => (
  <View style={[styles.card, style]}>{children}</View>
);

const SectionHeader: React.FC<{
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  /** Top-level section (20px) vs sub-section (18px). */
  large?: boolean;
}> = ({ title, subtitle, right, large }) => (
  <View style={styles.sectionHeader}>
    <View style={{ flex: 1 }}>
      <Text style={[styles.sectionTitle, large && styles.sectionTitleLarge]}>{title}</Text>
      {subtitle ? <Text style={styles.sectionSub}>{subtitle}</Text> : null}
    </View>
    {right}
  </View>
);

const LinkText: React.FC<{ label: string; onPress?: () => void }> = ({ label, onPress }) => (
  <Pressable onPress={onPress} hitSlop={8}>
    <Text style={styles.link}>{label}</Text>
  </Pressable>
);

// ===========================================================================
// 1) Commit pill (approved members only)
export const CommitPill: React.FC<{
  status: CommitmentStatus;
  onPress: () => void;
}> = ({ status, onPress }) => {
  const approved = status === 'approved';
  const pending = status === 'pending';
  return (
    <View style={styles.commitWrap}>
      <PressableScale
        onPress={onPress}
        style={[styles.commitPill, approved && styles.commitPillApproved, pending && styles.commitPillPending]}
        accessibilityLabel="Commitment"
      >
        {approved ? <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" /> : null}
        <Text style={styles.commitText}>
          {approved ? 'Committed' : pending ? 'Commitment Pending…' : 'Committed to this trip'}
        </Text>
      </PressableScale>
      <Text style={styles.commitCaption}>
        {approved
          ? "You're locked in. Tap to update your details."
          : pending
          ? 'Waiting for the host to approve. Tap to update.'
          : "Let the host know how you're committed"}
      </Text>
    </View>
  );
};

// ===========================================================================
// 2) Recent admin updates
export const AdminUpdatesCard: React.FC<{
  updates: AdminUpdate[];
  isHost: boolean;
  formatTime: (iso: string) => string;
  onAddUpdate: () => void;
  onEditUpdate: (u: AdminUpdate) => void;
  /** Host long-press → Edit/Delete menu (delete isn't in the sheet). */
  onLongPressUpdate: (u: AdminUpdate) => void;
}> = ({ updates, isHost, formatTime, onAddUpdate, onEditUpdate, onLongPressUpdate }) => {
  const [expanded, setExpanded] = useState(false);
  const PREVIEW = 3;
  const visible = expanded ? updates : updates.slice(0, PREVIEW);
  const hasMore = updates.length > PREVIEW;

  return (
    <View style={styles.block}>
      <SectionHeader
        title="Recent admin updates"
        large
        right={hasMore ? <LinkText label={expanded ? 'Show less' : 'View all'} onPress={() => setExpanded(e => !e)} /> : null}
      />
      <SectionCard style={{ paddingVertical: 4 }}>
        {visible.length === 0 ? (
          <Text style={styles.empty}>No updates yet.</Text>
        ) : (
          visible.map((u, i) => (
            <Pressable
              key={u.id}
              onLongPress={isHost ? () => onLongPressUpdate(u) : undefined}
              style={[styles.updateRow, i > 0 && styles.rowDivider]}
            >
              <View style={styles.updateIcon}>
                <Ionicons name="megaphone-outline" size={16} color={T.inkBody} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.updateTitle} numberOfLines={2}>
                  {u.body}
                </Text>
                <Text style={styles.updateTime}>{formatTime(u.created_at)}</Text>
              </View>
              {isHost ? <LinkText label="Edit" onPress={() => onEditUpdate(u)} /> : null}
            </Pressable>
          ))
        )}
        {isHost ? (
          <PressableScale onPress={onAddUpdate} style={[styles.addRow, visible.length > 0 && styles.rowDivider]} scaleTo={0.98}>
            <Ionicons name="add" size={16} color={T.inkBody} />
            <Text style={styles.addRowText}>Add update</Text>
          </PressableScale>
        ) : null}
      </SectionCard>
    </View>
  );
};

// ===========================================================================
// 3a) Group Gear
const GearRow: React.FC<{ item: EnrichedGearItem; onPress: () => void; showDivider: boolean }> = ({
  item,
  onPress,
  showDivider,
}) => {
  const covered = item.claimed_qty >= item.needed_qty;
  const remaining = Math.max(item.needed_qty - item.claimed_qty, 0);
  const status = covered
    ? 'Covered · All set'
    : item.claimed_qty === 0
    ? 'Not covered yet'
    : `${item.claimed_qty} / ${item.needed_qty} collected · ${remaining} more needed`;

  return (
    <PressableScale onPress={onPress} style={[styles.gearRow, showDivider && styles.rowDivider]} scaleTo={0.985}>
      <View style={{ flex: 1 }}>
        <Text style={styles.gearName}>{item.name}</Text>
        <Text style={styles.gearStatus}>{status}</Text>
        <View style={{ marginTop: 8 }}>
          <AvatarStack people={item.contributors} />
        </View>
      </View>
      {covered ? (
        <Ionicons name="checkmark-circle" size={22} color={T.accent} />
      ) : (
        <Ionicons name="chevron-forward" size={20} color="#C4C4C4" />
      )}
    </PressableScale>
  );
};

export const GroupGearCard: React.FC<{
  items: EnrichedGearItem[];
  isHost: boolean;
  isApprovedMember: boolean;
  onPressItem: (item: EnrichedGearItem) => void;
  onManage: () => void;
  onRequestItem: () => void;
}> = ({ items, isHost, isApprovedMember, onPressItem, onManage, onRequestItem }) => {
  const [expanded, setExpanded] = useState(false);
  const PREVIEW = 3;
  const visible = expanded ? items : items.slice(0, PREVIEW);
  const hasMore = items.length > PREVIEW;

  return (
    <View style={styles.subBlock}>
      <SectionHeader
        title="Group Gear"
        subtitle="Shared items for the trip"
        right={
          isHost ? (
            <PressableScale onPress={onManage} style={styles.managePill} scaleTo={0.96}>
              <Ionicons name="create-outline" size={14} color={T.accent} />
              <Text style={styles.managePillText}>Manage</Text>
            </PressableScale>
          ) : hasMore ? (
            <LinkText label={expanded ? 'Show less' : 'View all'} onPress={() => setExpanded(e => !e)} />
          ) : null
        }
      />
      {items.length === 0 ? (
        <SectionCard>
          <Text style={styles.empty}>
            {isHost ? 'No items yet — tap Manage to add some.' : 'No items yet.'}
          </Text>
        </SectionCard>
      ) : (
        <SectionCard style={{ paddingVertical: 4 }}>
          {visible.map((item, i) => (
            <GearRow key={item.id} item={item} onPress={() => onPressItem(item)} showDivider={i > 0} />
          ))}
        </SectionCard>
      )}
      {isApprovedMember ? (
        <LinkText label="Missing something? Request item" onPress={onRequestItem} />
      ) : null}
    </View>
  );
};

// ===========================================================================
// 3b) Your Gear
export type YourGearRow = { kind: 'host' | 'mine'; name: string; done: boolean };

// 20px rounded checkbox — Figma component 2015:9638 (empty) / 2015:9664 (checked).
const GearCheckbox: React.FC<{ checked: boolean }> = ({ checked }) => (
  <View style={[styles.cbBox, checked && styles.cbBoxChecked]}>
    {checked ? <Ionicons name="checkmark" size={14} color="#FFFFFF" /> : null}
  </View>
);

export const YourGearCard: React.FC<{
  rows: YourGearRow[];
  totalCount: number;
  isHost: boolean;
  onOpen: () => void;
  onEditSuggested: () => void;
  /** Toggle an item's "packed" state inline — no overlay (Figma 12716-7051). */
  onToggleItem: (row: YourGearRow) => void;
}> = ({ rows, totalCount, isHost, onOpen, onEditSuggested, onToggleItem }) => {
  const PREVIEW = 3;
  const preview = rows.slice(0, PREVIEW);
  const hidden = Math.max(0, totalCount - preview.length);

  // Build the row list so the LAST one can drop its divider (collapsing borders).
  type RowDef = { key: string; onPress?: () => void; center?: boolean; node: React.ReactNode };
  const rowDefs: RowDef[] = [];
  if (totalCount === 0) {
    rowDefs.push({
      key: 'empty',
      node: (
        <Text style={styles.ygEmpty}>
          {isHost ? 'No gear yet — add suggestions or your own items.' : 'No gear yet — tap to start your list.'}
        </Text>
      ),
    });
  } else {
    preview.forEach(row =>
      rowDefs.push({
        key: `${row.kind}-${row.name}`,
        onPress: () => onToggleItem(row),
        node: (
          <>
            <GearCheckbox checked={row.done} />
            <Text style={[styles.ygItem, row.done && styles.ygItemDone]} numberOfLines={1}>
              {row.name}
            </Text>
          </>
        ),
      }),
    );
    if (hidden > 0) {
      rowDefs.push({ key: 'more', onPress: onOpen, center: true, node: <Text style={styles.ygMore}>+{hidden} more</Text> });
    }
  }
  if (isHost) {
    rowDefs.push({ key: 'edit', onPress: onEditSuggested, center: true, node: <Text style={styles.ygEdit}>Edit gear</Text> });
  }

  return (
    <View style={styles.ygBlock}>
      <View style={styles.ygHeader}>
        <View style={styles.ygHeaderText}>
          <Text style={styles.ygTitle}>Your Gear</Text>
          <Text style={styles.ygSub}>Things you want to bring</Text>
        </View>
        <Pressable onPress={onOpen} hitSlop={8}>
          <Text style={styles.ygViewAll}>View all</Text>
        </Pressable>
      </View>
      <View style={styles.ygCard}>
        {rowDefs.map((d, i) => (
          <Pressable
            key={d.key}
            onPress={d.onPress}
            style={[styles.ygRow, d.center && styles.ygRowCenter, i === rowDefs.length - 1 && styles.ygRowLast]}
          >
            {d.node}
          </Pressable>
        ))}
      </View>
    </View>
  );
};

// ===========================================================================
// Sticky Trip Chat button — floats over content with a faded #FAFAFA gradient
// (mirrors the Connect button in ProfileScreen). Rendered OUTSIDE the scroll.
// Reusable faded-gradient floating footer (Figma CTA frame 12557-3613): a 230px
// band that fades the content above it into #FAFAFA, with the action floating
// solid on top. The positioned wrapper owns the zIndex so the action paints
// ABOVE the gradient (otherwise the gradient washes it out). Used by both the
// member "Trip Chat" button and the non-member "Join a Trip" CTA.
export const StickyGradientFooter: React.FC<{
  children: React.ReactNode;
  bottomInset: number;
}> = ({ children, bottomInset }) => (
  <>
    <View style={styles.footerOverlay} pointerEvents="none">
      <LinearGradient
        // Figma: linear-gradient(180deg, rgba(250,250,250,0) 33.48%, #FAFAFA 86.52%)
        colors={['rgba(250, 250, 250, 0)', '#FAFAFA']}
        locations={[0.3348, 0.8652]}
        style={StyleSheet.absoluteFill}
      />
    </View>
    <View style={[styles.footerWrap, { bottom: Math.max(bottomInset, 16) + 16 }]}>{children}</View>
  </>
);

export const StickyTripChat: React.FC<{
  onPress: () => void;
  loading?: boolean;
  bottomInset: number;
}> = ({ onPress, loading, bottomInset }) => (
  <StickyGradientFooter bottomInset={bottomInset}>
    <PressableScale
      onPress={loading ? undefined : onPress}
      disabled={loading}
      style={styles.chatBtnInner}
      accessibilityLabel="Open trip chat"
    >
      {loading ? (
        <ActivityIndicator color="#FFFFFF" />
      ) : (
        <>
          <Ionicons name="chatbubble-outline" size={18} color="#FFFFFF" />
          <Text style={styles.chatBtnText}>Trip Chat</Text>
        </>
      )}
    </PressableScale>
  </StickyGradientFooter>
);

// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  // Layout blocks
  block: { paddingHorizontal: 16, marginTop: 24 },
  subBlock: { marginTop: 16 },
  card: {
    backgroundColor: T.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: T.border,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },

  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontFamily: T.fontHead, fontSize: 18, fontWeight: '700', color: T.inkBody },
  sectionTitleLarge: { fontSize: 20 },
  sectionSub: { fontFamily: T.fontBody, fontSize: 12, color: T.muted, marginTop: 2 },
  link: { fontFamily: T.fontBody, fontSize: 16, fontWeight: '500', color: T.accent },
  empty: { fontFamily: T.fontBody, fontSize: 14, color: T.muted, paddingVertical: 6 },

  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.hairline },

  // Commit pill
  commitWrap: { paddingHorizontal: 16, marginTop: 20 },
  commitPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 52,
    borderRadius: 12,
    backgroundColor: T.ink,
  },
  commitPillPending: { backgroundColor: '#6B7280' },
  commitPillApproved: { backgroundColor: '#16A34A' },
  commitText: { fontFamily: T.fontHead, fontSize: 16, lineHeight: 24, fontWeight: '700', color: '#FFFFFF' },
  commitCaption: { fontFamily: T.fontBody, fontSize: 12, lineHeight: 18, color: T.muted, textAlign: 'center', marginTop: 10 },

  // Admin updates
  updateRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 2 },
  updateIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F2F4F5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  updateTitle: { fontFamily: T.fontBody, fontSize: 16, fontWeight: '700', color: T.inkBody, lineHeight: 21 },
  updateTime: { fontFamily: T.fontBody, fontSize: 10, lineHeight: 20, color: T.muted, marginTop: 2 },
  addRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14 },
  addRowText: { fontFamily: T.fontBody, fontSize: 14, fontWeight: '600', color: T.inkBody },

  // Group gear
  managePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: T.accent,
  },
  managePillText: { fontFamily: T.fontBody, fontSize: 13, fontWeight: '700', color: T.accent },
  gearRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 2 },
  gearName: { fontFamily: T.fontBody, fontSize: 18, lineHeight: 22, fontWeight: '700', color: T.inkBody },
  gearStatus: { fontFamily: T.fontBody, fontSize: 12, lineHeight: 18, color: T.muted, marginTop: 4 },

  // Avatars
  avatarImg: { backgroundColor: '#E6E6E6' },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#A8DDE0' },
  avatarInitial: { color: '#FFFFFF', fontWeight: '700' },
  avatarStack: { flexDirection: 'row', alignItems: 'center' },
  avatarWrap: { borderWidth: 1.5, borderColor: '#FFFFFF', borderRadius: 14 },
  avatarOverlap: { marginLeft: -8 },
  avatarMore: { fontFamily: T.fontBody, fontSize: 12, color: T.muted, marginLeft: 6 },
  zeroChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: T.border,
  },
  zeroChipText: { fontFamily: T.fontBody, fontSize: 12, color: T.muted },

  // Your Gear — exact match to Figma node 12716-7051
  ygBlock: { marginTop: 16, paddingHorizontal: 16, paddingTop: 20, borderTopWidth: 1, borderTopColor: '#EEEEEE' },
  ygHeader: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 16 },
  ygHeaderText: { flex: 1, gap: 4 },
  ygTitle: { fontFamily: T.fontBody, fontSize: 18, lineHeight: 22, fontWeight: '700', color: '#333333' },
  ygSub: { fontFamily: T.fontBody, fontSize: 16, lineHeight: 18, color: '#6a7282' },
  ygViewAll: { fontFamily: T.fontBody, fontSize: 16, lineHeight: 18, color: T.accent },
  ygCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EEEEEE',
    borderRadius: 16,
    overflow: 'hidden',
  },
  ygRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 54,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#EEEEEE',
  },
  ygRowCenter: { justifyContent: 'center' },
  ygRowLast: { borderBottomWidth: 0 },
  ygItem: { flex: 1, fontFamily: T.fontBody, fontSize: 16, lineHeight: 18, color: '#333333' },
  ygItemDone: { textDecorationLine: 'line-through', color: '#a0a0a0' },
  ygMore: { fontFamily: T.fontBody, fontSize: 16, color: T.muted },
  ygEdit: { fontFamily: T.fontBody, fontSize: 18, lineHeight: 22, color: T.accent },
  ygEmpty: { fontFamily: T.fontBody, fontSize: 16, color: T.muted },
  // 20px rounded checkbox
  cbBox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#d5d7da',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cbBoxChecked: { backgroundColor: T.accent, borderColor: T.accent },

  // Sticky Trip Chat
  footerOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 230, // Figma frame height
    zIndex: 9,
    overflow: 'hidden',
    // backdrop-filter: blur(3.5px) — web only (native would need expo-blur).
    ...(Platform.OS === 'web'
      ? ({
          backdropFilter: 'blur(3.5px)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 50%)',
          maskImage: 'linear-gradient(to bottom, transparent 0%, black 50%)',
        } as any)
      : null),
  },
  footerWrap: { position: 'absolute', left: 16, right: 16, zIndex: 10 },
  chatBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 56,
    borderRadius: 28,
    backgroundColor: T.accent,
  },
  chatBtnText: {
    fontFamily: T.fontHead,
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
