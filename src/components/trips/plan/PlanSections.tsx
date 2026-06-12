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
import { AdminUpdateRow, UpdateDetailModal } from '../AdminUpdateUI';
import { TripIcon } from '../tripIcons';
import { ff } from '../../../theme/fonts';
import type {
  AdminUpdate,
  EnrichedGearItem,
  GearContributor,
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
  // "Add update" card border — kept identical to the full Updates page so the
  // Plan-tab preview reads as the same component (rows live in AdminUpdateUI).
  cardBorder: '#EEEEEE',
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
  contributors: GearContributor[];
  /** Current user — when they're among the contributors, their own avatar is
   *  pulled out and shown first with an "x{qty}" badge (Figma 12919-32986), so a
   *  member instantly sees their own contribution apart from everyone else's. */
  currentUserId?: string | null;
  max?: number;
}> = ({ contributors, currentUserId, max = 3 }) => {
  // Empty — no claims yet → the "add" plus chip.
  if (contributors.length === 0) {
    return (
      <View style={styles.avatarChip}>
        <View style={styles.avatarPlus}>
          <Ionicons name="add" size={16} color={T.muted} />
        </View>
        <Text style={styles.avatarNumber}>0</Text>
      </View>
    );
  }

  const self = currentUserId ? contributors.find(c => c.user_id === currentUserId) : undefined;
  const others = self ? contributors.filter(c => c.user_id !== currentUserId) : contributors;
  const shown = others.slice(0, max);
  const overflow = others.length - shown.length; // contributors not shown
  // Others' chip trailing: "+N" when some don't fit, else the others' collected
  // quantity (1 person × 2 units reads "2"), matching the status line.
  const othersQty = others.reduce((sum, c) => sum + c.quantity, 0);
  const numberText = overflow > 0 ? `+${overflow}` : `${othersQty}`;

  return (
    <View style={styles.contribRow}>
      {self ? (
        <View style={styles.selfWrap}>
          <Avatar url={self.profile_image_url} name={self.name} size={32} />
          <View style={styles.selfQtyBadge}>
            <Text style={styles.selfQtyText}>x{self.quantity}</Text>
          </View>
        </View>
      ) : null}
      {others.length > 0 ? (
        <View style={styles.avatarChip}>
          {shown.map((p, i) => (
            <View key={p.user_id} style={[styles.avatarWrap, i > 0 && styles.avatarOverlap]}>
              <Avatar url={p.profile_image_url} name={p.name} size={28} />
            </View>
          ))}
          <Text style={styles.avatarNumber}>{numberText}</Text>
        </View>
      ) : null}
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
  /** When provided, "View all" pushes the full Updates screen instead of
   *  expanding inline (Figma node 12933-38189). */
  onViewAll?: () => void;
}> = ({ updates, isHost, formatTime, onAddUpdate, onEditUpdate, onLongPressUpdate, onViewAll }) => {
  const [expanded, setExpanded] = useState(false);
  // Full text of a tapped (truncated) update — drives the detail overlay.
  const [detail, setDetail] = useState<AdminUpdate | null>(null);
  const PREVIEW = 3;
  // When "View all" navigates to a dedicated screen we always show the 3-item
  // preview here; inline expand is the fallback when no navigation is wired.
  const visible = onViewAll || !expanded ? updates.slice(0, PREVIEW) : updates;
  const hasMore = updates.length > PREVIEW;

  return (
    <View style={styles.block}>
      <SectionHeader
        title="Recent admin updates"
        large
        right={
          hasMore ? (
            onViewAll ? (
              <LinkText label="View all" onPress={onViewAll} />
            ) : (
              <LinkText label={expanded ? 'Show less' : 'View all'} onPress={() => setExpanded(e => !e)} />
            )
          ) : null
        }
      />
      {visible.length === 0 && !isHost ? (
        <SectionCard>
          <Text style={styles.empty}>No updates yet.</Text>
        </SectionCard>
      ) : (
        <View style={styles.updateList}>
          {visible.map(u => (
            <AdminUpdateRow
              key={u.id}
              update={u}
              formatTime={formatTime}
              onOpenDetail={setDetail}
              onLongPress={isHost ? () => onLongPressUpdate(u) : undefined}
              right={isHost ? <LinkText label="Edit" onPress={() => onEditUpdate(u)} /> : undefined}
            />
          ))}
          {isHost ? (
            <PressableScale onPress={onAddUpdate} style={styles.addCard} scaleTo={0.98}>
              <Ionicons name="add" size={16} color={T.inkBody} />
              <Text style={styles.addRowText}>Add update</Text>
            </PressableScale>
          ) : null}
        </View>
      )}

      <UpdateDetailModal update={detail} formatTime={formatTime} onClose={() => setDetail(null)} />
    </View>
  );
};

// ===========================================================================
// 3a) Group Gear
// Two layouts share the same content: the preview rows inside one card (divider
// between rows) and the full-screen PackingAndGearScreen (each item is its own
// rounded card — Figma node 12919-32700). `standalone` switches between them.
export const GearRow: React.FC<{
  item: EnrichedGearItem;
  onPress: () => void;
  showDivider?: boolean;
  standalone?: boolean;
  /** Current user — surfaces their own contribution with an "x{qty}" badge. */
  currentUserId?: string | null;
}> = ({ item, onPress, showDivider, standalone, currentUserId }) => {
  const covered = item.claimed_qty >= item.needed_qty;
  const remaining = Math.max(item.needed_qty - item.claimed_qty, 0);
  const status = covered
    ? 'Covered · All set'
    : item.claimed_qty === 0
    ? 'Not covered yet'
    : `${item.claimed_qty} / ${item.needed_qty} collected · ${remaining} more needed`;

  return (
    <PressableScale
      onPress={onPress}
      style={standalone ? styles.gearCard : [styles.gearRow, showDivider && styles.rowDivider]}
      scaleTo={standalone ? 0.99 : 0.985}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.gearName}>{item.name}</Text>
        <Text style={styles.gearStatus}>{status}</Text>
        <View style={{ marginTop: 8 }}>
          <AvatarStack contributors={item.contributors} currentUserId={currentUserId} />
        </View>
      </View>
      {covered ? (
        <View style={styles.coveredBadge}>
          <Ionicons name="checkmark" size={14} color="#FFFFFF" />
        </View>
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
  currentUserId?: string | null;
  onPressItem: (item: EnrichedGearItem) => void;
  onManage: () => void;
  onRequestItem: () => void;
  /** When provided, "View all" pushes the full Packing & Gear screen instead
   *  of expanding inline (Figma node 12919-32700). */
  onViewAll?: () => void;
}> = ({ items, isHost, isApprovedMember, currentUserId, onPressItem, onManage, onRequestItem, onViewAll }) => {
  const [expanded, setExpanded] = useState(false);
  const PREVIEW = 3;
  // When "View all" navigates to a dedicated screen we always show the 3-item
  // preview here; inline expand is the fallback when no navigation is wired.
  const visible = onViewAll || !expanded ? items.slice(0, PREVIEW) : items;
  const handleViewAll = onViewAll ?? (() => setExpanded(e => !e));

  return (
    <View style={styles.subBlock}>
      {/* Header mirrors Your Gear (Figma 12557-5898): title + subtitle, with the
          "Manage" button (host) stacked over a persistent "View all" link. */}
      <View style={styles.ygHeader}>
        <View style={styles.ygHeaderText}>
          <Text style={styles.ygTitle}>Group Gear</Text>
          <Text style={styles.ygSub}>Shared items for the trip</Text>
        </View>
        <View style={[styles.ygHeaderRight, isHost && styles.ygHeaderRightHost]}>
          {isHost ? (
            <PressableScale onPress={onManage} style={styles.managePill} scaleTo={0.96}>
              <TripIcon name="edit-02" size={14} color="#333333" />
              <Text style={styles.managePillText}>Manage</Text>
            </PressableScale>
          ) : null}
          <Pressable onPress={handleViewAll} hitSlop={8}>
            <Text style={styles.ygViewAll}>View all</Text>
          </Pressable>
        </View>
      </View>
      {items.length === 0 ? (
        <SectionCard>
          <Text style={styles.empty}>
            {isHost ? 'No items yet — tap Manage to add some.' : 'No items yet.'}
          </Text>
        </SectionCard>
      ) : (
        <View style={styles.gearList}>
          {visible.map(item => (
            <GearRow key={item.id} item={item} onPress={() => onPressItem(item)} currentUserId={currentUserId} standalone />
          ))}
        </View>
      )}
      {isApprovedMember ? (
        <Pressable onPress={onRequestItem} hitSlop={8} style={styles.requestRow}>
          <Text style={styles.requestLink}>Missing something? Request item</Text>
        </Pressable>
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

// "Host suggestion" label — purple text + award ribbon (Figma fill/tertiary
// #B72DF2 + award-01). Marks a gear row the host suggested for members to pack;
// distinct from the teal HostTag pill used on host-only controls.
const HostSuggestionTag: React.FC = () => (
  <View style={styles.hostSugg}>
    <Text style={styles.hostSuggText}>Host suggestion</Text>
    <TripIcon name="award-01" size={14} color="#333333" strokeWidth={1.2} />
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
  /** Add a personal item — opens the AddPersonalGearSheet. Only passed when the
   *  viewer can edit their own list (Figma node 12919-33766 "+ Add item" row). */
  onAddItem?: () => void;
}> = ({ rows, totalCount, isHost, onOpen, onEditSuggested, onToggleItem }) => {
  const PREVIEW = 3;
  // Host sees "what members should pack" — host suggestions only, no checkboxes
  // (the host isn't packing them, just curating the list). Members see their full
  // checklist (host suggestions + their own items) with toggle checkboxes.
  const displayRows = isHost ? rows.filter(r => r.kind === 'host') : rows;
  const total = isHost ? displayRows.length : totalCount;
  const preview = displayRows.slice(0, PREVIEW);
  const moreCount = Math.max(0, total - preview.length);

  return (
    <View style={styles.ygBlock}>
      {/* Header (Figma 12557-5898). Member: title + subtitle + "View all".
          Host: title + "Manage" pill, with "View all" beneath it. */}
      <View style={styles.ygHeader}>
        <View style={styles.ygHeaderText}>
          <Text style={styles.ygTitle}>
            {isHost ? 'What should members pack for themselves?' : 'Your Gear'}
          </Text>
          <Text style={styles.ygSub}>Things you want to bring</Text>
        </View>
        <View style={[styles.ygHeaderRight, isHost && styles.ygHeaderRightHost]}>
          {isHost ? (
            <PressableScale onPress={onEditSuggested} style={styles.managePill} scaleTo={0.96}>
              <TripIcon name="edit-02" size={14} color="#333333" />
              <Text style={styles.managePillText}>Manage</Text>
            </PressableScale>
          ) : null}
          <Pressable onPress={onOpen} hitSlop={8}>
            <Text style={styles.ygViewAll}>View all</Text>
          </Pressable>
        </View>
      </View>

      {total === 0 ? (
        <View style={styles.ygCard}>
          <View style={[styles.ygRow, styles.ygRowCenter, styles.ygRowLast]}>
            <Text style={styles.ygEmpty}>
              {isHost ? 'No suggestions yet — tap Manage to add some.' : 'No gear yet — tap View all to start.'}
            </Text>
          </View>
        </View>
      ) : (
        <View style={styles.ygCard}>
          {preview.map((row, i) => {
            // Last visual row drops its divider so the collapsing 1px borders read
            // as one card; when "+N more" is present, IT is the real last row.
            const isLast = moreCount === 0 && i === preview.length - 1;
            return (
              <Pressable
                key={`${row.kind}-${row.name}`}
                onPress={isHost ? undefined : () => onToggleItem(row)}
                style={[styles.ygRow, isLast && styles.ygRowLast]}
              >
                {isHost ? null : <GearCheckbox checked={row.done} />}
                <Text
                  style={[styles.ygItem, !isHost && row.done && styles.ygItemDone]}
                  numberOfLines={1}
                >
                  {row.name}
                </Text>
                {row.kind === 'host' ? <HostSuggestionTag /> : null}
              </Pressable>
            );
          })}

          {moreCount > 0 ? (
            <Pressable onPress={onOpen} style={[styles.ygRow, styles.ygRowCenter, styles.ygRowLast]}>
              <Text style={styles.ygMore}>+{moreCount} more</Text>
            </Pressable>
          ) : null}
        </View>
      )}
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
  // Layout blocks. Every Plan section owns 20px top + 20px bottom padding, so
  // adjacent sections read as a consistent 40px vertical gap (Figma 12933-38355).
  block: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 20 },
  subBlock: { paddingBottom: 20 },
  card: {
    backgroundColor: T.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: T.border,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },

  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  // Headings on this page are Inter Bold (NOT Montserrat — that renders wider/
  // taller at the same px and is what made the page look oversized). Montserrat
  // is reserved for the dark CTA buttons. Figma (Mobile-800 mode, read via
  // get_variable_defs): Group Gear/Your Gear/Recent admin updates 14px (Body/M
  // B-2), Packing & Gear 16px (Body/M B-1).
  sectionTitle: { fontFamily: ff('Inter', '700'), fontSize: 14, lineHeight: 18, fontWeight: '700', color: T.inkBody },
  sectionTitleLarge: { fontSize: 16, lineHeight: 24 },
  sectionSub: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18, color: T.muted, marginTop: 2 },
  link: { fontFamily: ff('Inter', '400'), fontSize: 14, lineHeight: 18, fontWeight: '400', color: T.accent },
  empty: { fontFamily: ff('Inter', '400'), fontSize: 14, color: T.muted, paddingVertical: 6 },

  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.hairline },

  // Commit pill
  commitWrap: { paddingHorizontal: 16, marginTop: 32 },
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
  commitText: { fontFamily: ff('Montserrat', '700'), fontSize: 16, lineHeight: 24, fontWeight: '700', color: '#FFFFFF' },
  commitCaption: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18, color: T.muted, textAlign: 'center', marginTop: 10 },

  // Admin updates — rows live in AdminUpdateUI (shared with the full Updates
  // page so both read as one component). Only the list gap + "Add update" card
  // are owned here.
  updateList: { gap: 8 },
  addCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 16,
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.cardBorder,
    borderRadius: 20,
  },
  addRowText: { fontFamily: ff('Inter', '600'), fontSize: 14, fontWeight: '600', color: T.inkBody },

  // Group gear
  // Unified "Manage" button (Figma node 12933-35761): white surface, #CFCFCF
  // border, radius 9, pencil + Body/B-3 label in #333. Used by every section.
  managePill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#CFCFCF',
    backgroundColor: '#FFFFFF',
  },
  managePillText: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18, color: '#333333', textAlign: 'center' },
  gearRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 2 },
  // Standalone card (PackingAndGearScreen) — Figma rounded-20 white card.
  gearCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: 16,
    paddingRight: 12,
    paddingVertical: 12,
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: '#EEEEEE',
    borderRadius: 20,
  },
  // Inline preview list — each item is its own rounded card, gapped (Figma).
  gearList: { gap: 12 },
  // Centred "Missing something? Request item" link, spaced from the cards above.
  requestRow: { alignItems: 'center', marginTop: 16 },
  requestLink: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18, fontWeight: '400', color: T.accent },
  // "All set" badge — solid teal circle with a white check (Figma: 20px, radius
  // 10, fill/border #05BCD3). Distinct from the cut-out checkmark-circle glyph.
  coveredBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: T.accent,
    borderWidth: 1,
    borderColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gearName: { fontFamily: ff('Inter', '700'), fontSize: 14, lineHeight: 18, fontWeight: '700', color: T.inkBody },
  gearStatus: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18, color: T.muted, marginTop: 4 },

  // Avatars
  avatarImg: { backgroundColor: '#E6E6E6' },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#A8DDE0' },
  avatarInitial: { color: '#FFFFFF', fontWeight: '700' },
  // Figma avatars chip (node 12833:13012): pill (bg #f7f7f7, border #cfcfcf,
  // full radius, 1px pad) with 28px overlapping avatars + a trailing number.
  avatarChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#F7F7F7',
    borderWidth: 1,
    borderColor: '#CFCFCF',
    borderRadius: 999,
    padding: 1,
  },
  avatarWrap: { borderWidth: 1.5, borderColor: '#F7F7F7', borderRadius: 16 },
  avatarOverlap: { marginLeft: -8 },
  avatarPlus: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#E4E4E4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarNumber: { fontFamily: ff('Montserrat', '400'), fontSize: 12, lineHeight: 16, color: T.muted, paddingLeft: 6, paddingRight: 8 },
  // Self contribution + others chip, side by side (Figma node 12919-32986).
  contribRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  // Current user's own 32px avatar with a dark "x{qty}" badge bottom-right.
  selfWrap: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  selfQtyBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    backgroundColor: '#212121',
    borderWidth: 1,
    borderColor: '#FFFFFF',
    borderRadius: 9,
    paddingHorizontal: 3,
    paddingVertical: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selfQtyText: { fontFamily: ff('Inter', '700'), fontSize: 9, lineHeight: 14, color: '#FFFFFF', textAlign: 'center' },

  // Your Gear — exact match to Figma node 12716-7051. No horizontal padding: it
  // renders inside planSection (already 16px), so adding more here pushed Your
  // Gear in to 32px and misaligned it with Group Gear. pt/pb 20 = its own section.
  ygBlock: { paddingTop: 20, paddingBottom: 20, borderTopWidth: 1, borderTopColor: '#EEEEEE' },
  // Header stretches the right column to the title's height so "View all" sits at
  // the bottom (member) and "Manage"/"View all" book-end it top/bottom (host).
  ygHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16 },
  ygHeaderText: { flex: 1, gap: 4, paddingRight: 12 },
  ygHeaderRight: { alignSelf: 'stretch', alignItems: 'flex-end', justifyContent: 'flex-end' },
  ygHeaderRightHost: { justifyContent: 'space-between' },
  ygTitle: { fontFamily: ff('Inter', '700'), fontSize: 14, lineHeight: 18, fontWeight: '700', color: '#333333' },
  ygSub: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18, color: '#6a7282' },
  ygViewAll: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18, color: T.accent },
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
  ygItem: { flex: 1, fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18, color: '#333333' },
  ygItemDone: { textDecorationLine: 'line-through', color: '#a0a0a0' },
  ygMore: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18, color: '#333333' },
  // "Host suggestion" — purple text + award ribbon (Figma size/xs 10, #B72DF2).
  hostSugg: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  hostSuggText: { fontFamily: ff('Inter', '400'), fontSize: 10, lineHeight: 14, color: '#B72DF2' },
  ygEmpty: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18, color: T.muted },
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
    fontFamily: ff('Montserrat', '700'),
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
