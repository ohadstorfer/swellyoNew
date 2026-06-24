// Plan-tab presentational sections (Figma nodes 12557-5860 / 12716-6927).
// These are the redesigned blocks shown under the Overview/Plan toggle when
// "Plan" is active: the commit pill, recent admin updates, and Packing & Gear
// (Group Gear + Your Gear). All data + handlers live in TripDetailScreen — this
// file is pure presentation so the screen stays lean and the layout is testable
// in isolation. Operational sections (join requests, breakdown, destructive
// actions) stay in TripDetailScreen below these blocks.

import React, { useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  StyleSheet,
  Pressable,
  Animated,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image as CachedImage } from 'expo-image';
import Svg, { Path } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { AdminUpdateRow, AnnouncementIcon } from '../AdminUpdateUI';
import { TripIcon } from '../tripIcons';
import { ff } from '../../../theme/fonts';
import { getStorageThumbUrl } from '../../../services/media/imageService';
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

const LinkText: React.FC<{ label: string; onPress?: () => void; size?: 'sm' | 'md'; color?: string }> = ({ label, onPress, size = 'md', color }) => (
  <Pressable onPress={onPress} hitSlop={8}>
    <Text style={[size === 'sm' ? styles.linkSmall : styles.link, color ? { color } : null]}>{label}</Text>
  </Pressable>
);

// Verified-badge (scalloped) check icon used in the committed state.
const BadgeCheckIcon: React.FC<{ size?: number; color?: string }> = ({ size = 24, color = '#FFFFFF' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M9 12L11 14L15.5 9.5M17.9012 4.99851C18.1071 5.49653 18.5024 5.8924 19.0001 6.09907L20.7452 6.82198C21.2433 7.02828 21.639 7.42399 21.8453 7.92206C22.0516 8.42012 22.0516 8.97974 21.8453 9.47781L21.1229 11.2218C20.9165 11.7201 20.9162 12.2803 21.1236 12.7783L21.8447 14.5218C21.9469 14.7685 21.9996 15.0329 21.9996 15.2999C21.9997 15.567 21.9471 15.8314 21.8449 16.0781C21.7427 16.3249 21.5929 16.549 21.4041 16.7378C21.2152 16.9266 20.991 17.0764 20.7443 17.1785L19.0004 17.9009C18.5023 18.1068 18.1065 18.5021 17.8998 18.9998L17.1769 20.745C16.9706 21.2431 16.575 21.6388 16.0769 21.8451C15.5789 22.0514 15.0193 22.0514 14.5212 21.8451L12.7773 21.1227C12.2792 20.9169 11.7198 20.9173 11.2221 21.1239L9.47689 21.8458C8.97912 22.0516 8.42001 22.0514 7.92237 21.8453C7.42473 21.6391 7.02925 21.2439 6.82281 20.7464L6.09972 19.0006C5.8938 18.5026 5.49854 18.1067 5.00085 17.9L3.25566 17.1771C2.75783 16.9709 2.36226 16.5754 2.15588 16.0777C1.94951 15.5799 1.94923 15.0205 2.1551 14.5225L2.87746 12.7786C3.08325 12.2805 3.08283 11.7211 2.8763 11.2233L2.15497 9.47678C2.0527 9.2301 2.00004 8.96568 2 8.69863C1.99996 8.43159 2.05253 8.16715 2.15472 7.92043C2.25691 7.67372 2.40671 7.44955 2.59557 7.26075C2.78442 7.07195 3.00862 6.92222 3.25537 6.8201L4.9993 6.09772C5.49687 5.89197 5.89248 5.4972 6.0993 5.00006L6.82218 3.25481C7.02848 2.75674 7.42418 2.36103 7.92222 2.15473C8.42027 1.94842 8.97987 1.94842 9.47792 2.15473L11.2218 2.87712C11.7199 3.08291 12.2793 3.08249 12.7771 2.87595L14.523 2.15585C15.021 1.94966 15.5804 1.9497 16.0784 2.15597C16.5763 2.36223 16.972 2.75783 17.1783 3.25576L17.9014 5.00153L17.9012 4.99851Z"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

// Passport-in-badge icon for the "Committed to trip" row (Figma 13455-38704):
// a teal scalloped badge filled #05BCD3 with a white passport document inside.
// Exported so the full Members screen reuses the exact same committed badge.
export const CommittedPassportIcon: React.FC<{ size?: number }> = ({ size = 24 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M17.9012 4.99851C18.1071 5.49653 18.5024 5.8924 19.0001 6.09907L20.7452 6.82198C21.2433 7.02828 21.639 7.42399 21.8453 7.92206C22.0516 8.42012 22.0516 8.97974 21.8453 9.47781L21.1229 11.2218C20.9165 11.7201 20.9162 12.2803 21.1236 12.7783L21.8447 14.5218C21.9469 14.7685 21.9996 15.0329 21.9996 15.2999C21.9997 15.567 21.9471 15.8314 21.8449 16.0781C21.7427 16.3249 21.5929 16.549 21.4041 16.7378C21.2152 16.9266 20.991 17.0764 20.7443 17.1785L19.0004 17.9009C18.5023 18.1068 18.1065 18.5021 17.8998 18.9998L17.1769 20.745C16.9706 21.2431 16.575 21.6388 16.0769 21.8451C15.5789 22.0514 15.0193 22.0514 14.5212 21.8451L12.7773 21.1227C12.2792 20.9169 11.7198 20.9173 11.2221 21.1239L9.47689 21.8458C8.97912 22.0516 8.42001 22.0514 7.92237 21.8453C7.42473 21.6391 7.02925 21.2439 6.82281 20.7464L6.09972 19.0006C5.8938 18.5026 5.49854 18.1067 5.00085 17.9L3.25566 17.1771C2.75783 16.9709 2.36226 16.5754 2.15588 16.0777C1.94951 15.5799 1.94923 15.0205 2.1551 14.5225L2.87746 12.7786C3.08325 12.2805 3.08283 11.7211 2.8763 11.2233L2.15497 9.47678C2.0527 9.2301 2.00004 8.96568 2 8.69863C1.99996 8.43159 2.05253 8.16715 2.15472 7.92043C2.25691 7.67372 2.40671 7.44955 2.59557 7.26075C2.78442 7.07195 3.00862 6.92222 3.25537 6.8201L4.9993 6.09772C5.49687 5.89197 5.89248 5.4972 6.0993 5.00006L6.82218 3.25481C7.02848 2.75674 7.42418 2.36103 7.92222 2.15473C8.42027 1.94842 8.97987 1.94842 9.47792 2.15473L11.2218 2.87712C11.7199 3.08291 12.2793 3.08249 12.7771 2.87595L14.523 2.15585C15.021 1.94966 15.5804 1.9497 16.0784 2.15597C16.5763 2.36223 16.972 2.75783 17.1783 3.25576L17.9014 5.00153L17.9012 4.99851Z"
      fill="#05BCD3"
      stroke="#FFFFFF"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <Path
      d="M11.166 13.6668H12.8327M10.666 16.1668H13.3327C14.0327 16.1668 14.3828 16.1668 14.6502 16.0306C14.8854 15.9107 15.0766 15.7195 15.1964 15.4843C15.3327 15.2169 15.3327 14.8669 15.3327 14.1668V9.8335C15.3327 9.13343 15.3327 8.7834 15.1964 8.51601C15.0766 8.28081 14.8854 8.08958 14.6502 7.96974C14.3828 7.8335 14.0327 7.8335 13.3327 7.8335H10.666C9.96595 7.8335 9.61592 7.8335 9.34853 7.96974C9.11332 8.08958 8.9221 8.28081 8.80226 8.51601C8.66602 8.7834 8.66602 9.13343 8.66602 9.8335V14.1668C8.66602 14.8669 8.66602 15.2169 8.80226 15.4843C8.9221 15.7195 9.11332 15.9107 9.34853 16.0306C9.61592 16.1668 9.96595 16.1668 10.666 16.1668ZM13.2493 10.7502C13.2493 11.4405 12.6897 12.0002 11.9993 12.0002C11.309 12.0002 10.7493 11.4405 10.7493 10.7502C10.7493 10.0598 11.309 9.50016 11.9993 9.50016C12.6897 9.50016 13.2493 10.0598 13.2493 10.7502Z"
      stroke="#FFFFFF"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

// Admin/host marker — same scalloped badge as the committed one, but amber
// (#F5A623) with a white crown instead of teal + passport. Marks the trip host
// in member lists; shown to everyone (who the admin is isn't sensitive).
export const AdminBadgeIcon: React.FC<{ size?: number }> = ({ size = 24 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M17.9012 4.99851C18.1071 5.49653 18.5024 5.8924 19.0001 6.09907L20.7452 6.82198C21.2433 7.02828 21.639 7.42399 21.8453 7.92206C22.0516 8.42012 22.0516 8.97974 21.8453 9.47781L21.1229 11.2218C20.9165 11.7201 20.9162 12.2803 21.1236 12.7783L21.8447 14.5218C21.9469 14.7685 21.9996 15.0329 21.9996 15.2999C21.9997 15.567 21.9471 15.8314 21.8449 16.0781C21.7427 16.3249 21.5929 16.549 21.4041 16.7378C21.2152 16.9266 20.991 17.0764 20.7443 17.1785L19.0004 17.9009C18.5023 18.1068 18.1065 18.5021 17.8998 18.9998L17.1769 20.745C16.9706 21.2431 16.575 21.6388 16.0769 21.8451C15.5789 22.0514 15.0193 22.0514 14.5212 21.8451L12.7773 21.1227C12.2792 20.9169 11.7198 20.9173 11.2221 21.1239L9.47689 21.8458C8.97912 22.0516 8.42001 22.0514 7.92237 21.8453C7.42473 21.6391 7.02925 21.2439 6.82281 20.7464L6.09972 19.0006C5.8938 18.5026 5.49854 18.1067 5.00085 17.9L3.25566 17.1771C2.75783 16.9709 2.36226 16.5754 2.15588 16.0777C1.94951 15.5799 1.94923 15.0205 2.1551 14.5225L2.87746 12.7786C3.08325 12.2805 3.08283 11.7211 2.8763 11.2233L2.15497 9.47678C2.0527 9.2301 2.00004 8.96568 2 8.69863C1.99996 8.43159 2.05253 8.16715 2.15472 7.92043C2.25691 7.67372 2.40671 7.44955 2.59557 7.26075C2.78442 7.07195 3.00862 6.92222 3.25537 6.8201L4.9993 6.09772C5.49687 5.89197 5.89248 5.4972 6.0993 5.00006L6.82218 3.25481C7.02848 2.75674 7.42418 2.36103 7.92222 2.15473C8.42027 1.94842 8.97987 1.94842 9.47792 2.15473L11.2218 2.87712C11.7199 3.08291 12.2793 3.08249 12.7771 2.87595L14.523 2.15585C15.021 1.94966 15.5804 1.9497 16.0784 2.15597C16.5763 2.36223 16.972 2.75783 17.1783 3.25576L17.9014 5.00153L17.9012 4.99851Z"
      fill="#F5A623"
      stroke="#FFFFFF"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* White crown — three peaks + base bar, centred in the badge. */}
    <Path
      d="M7.6 15.1L6.95 9.7L9.85 11.85L12 8.6L14.15 11.85L17.05 9.7L16.4 15.1H7.6Z M7.7 15.9H16.3V17.1H7.7V15.9Z"
      fill="#FFFFFF"
    />
  </Svg>
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
      {/* Already committed (or pending) → no sheet on tap; PressableScale still
          gives the scale-down press feedback. */}
      <PressableScale
        onPress={pending || approved ? undefined : onPress}
        style={[styles.commitPill, pending && styles.commitPillPending, approved && styles.commitPillApproved]}
        accessibilityLabel="Commitment"
      >
        {approved ? <BadgeCheckIcon size={24} color="#FFFFFF" /> : null}
        <Text style={styles.commitText}>
          {approved ? 'Committed' : pending ? 'Commitment request sent' : 'Commit to this trip'}
        </Text>
        {!approved && !pending ? <Ionicons name="chevron-forward" size={20} color="#FFFFFF" /> : null}
      </PressableScale>
      <Text style={styles.commitCaption}>
        {approved
          ? "You're all set for this trip"
          : pending
            ? 'Waiting for host approval'
            : "Let the admin know how you're committed"}
      </Text>
    </View>
  );
};

// ===========================================================================
// Members — avatar row + "Committed to trip" progress (Figma 13455-38686).
// Lives in the Plan tab (members only); non-members keep the simpler
// Participants row in the Overview body. The passport badge marks members who
// have committed to the trip (commitment_status === 'approved').
export type TripMember = {
  id: string;
  name: string | null;
  avatarUrl: string | null;
  committed: boolean;
  /** Host → amber admin crown instead of the committed badge. */
  isHost?: boolean;
};

export const TripMemberSection: React.FC<{
  members: TripMember[];
  participantCount: number;
  maxParticipants?: number | null;
  committedCount: number;
  /** Tapping an avatar opens that member's profile. */
  onMemberPress?: (id: string) => void;
  /** When wired, the header count becomes a "View all (n/max)" link. The avatar
   *  row already scrolls to reveal everyone, so this is optional. */
  onViewAll?: () => void;
  /** Host only — number of pending join requests. When > 0, a red pill next to
   *  "View all" nudges the admin to open the Members screen and act on them. */
  pendingCount?: number;
}> = ({ members, participantCount, maxParticipants, committedCount, onMemberPress, onViewAll, pendingCount = 0 }) => {
  // "View all (N)" = the actual number of members to view. Previously this used
  // the trip cap (max_participants), which made a 2-member/13-cap trip read as
  // "View all (13)" — i.e. "13 members". Always show the real head-count.
  const countLabel = `${participantCount}`;
  // "Committed to trip" = how many of the CURRENT members have committed, so the
  // denominator is the actual head-count (not the trip cap — a 2-member trip read
  // "0/13" against a 13 cap, which is wrong).
  const denom = Math.max(participantCount, 1);
  const fillPct = Math.max(0, Math.min(1, committedCount / denom));
  return (
    <View style={styles.memberSection}>
      <SectionHeader
        title="Members"
        large
        right={
          pendingCount > 0 ? (
            // Host with pending join requests — the link turns into an amber
            // "Request pending (N)" nudge; reverts to "View all" once cleared.
            <LinkText
              label={`Requests pending (${pendingCount})`}
              onPress={onViewAll}
              color="#F5A623"
            />
          ) : (
            <LinkText label={`View all (${countLabel})`} onPress={onViewAll} />
          )
        }
      />

      {members.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.memberScroll}
          contentContainerStyle={styles.memberScrollContent}
        >
          {members.map(m => {
            const thumb = getStorageThumbUrl(m.avatarUrl, 96) ?? m.avatarUrl;
            return (
              <Pressable
                key={m.id}
                onPress={onMemberPress ? () => onMemberPress(m.id) : undefined}
                disabled={!onMemberPress}
                style={styles.memberItem}
                accessibilityRole="button"
                accessibilityLabel={m.name ? `Open ${m.name}'s profile` : 'Open profile'}
              >
                <View>
                  {thumb ? (
                    <CachedImage
                      source={{ uri: thumb }}
                      style={styles.memberAvatar}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                    />
                  ) : (
                    <View style={[styles.memberAvatar, styles.memberAvatarEmpty]}>
                      <Ionicons name="person" size={24} color="#FFFFFF" />
                    </View>
                  )}
                  {m.isHost ? (
                    <View style={styles.memberBadge}>
                      <AdminBadgeIcon size={26} />
                    </View>
                  ) : m.committed ? (
                    <View style={styles.memberBadge}>
                      <CommittedPassportIcon size={26} />
                    </View>
                  ) : null}
                </View>
                <Text style={styles.memberName} numberOfLines={1}>
                  {m.name ?? '—'}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : (
        <Text style={styles.empty}>No members yet</Text>
      )}

      {/* "Committed to trip" progress — committed head-count vs the cap. */}
      <View style={styles.memberProgress}>
        <View style={styles.memberProgressRow}>
          <View style={styles.memberProgressLabelRow}>
            <CommittedPassportIcon size={24} />
            <Text style={styles.memberProgressLabel}>Committed to trip</Text>
          </View>
          <Text style={styles.memberProgressCount}>
            {committedCount}/{participantCount}
          </Text>
        </View>
        <View style={styles.memberProgressTrack}>
          <View style={[styles.memberProgressFill, { width: `${fillPct * 100}%` }]} />
        </View>
      </View>
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
  /** When provided, "View all" pushes the full Updates screen instead of
   *  expanding inline (Figma node 12933-38189). */
  onViewAll?: () => void;
}> = ({ updates, isHost, formatTime, onAddUpdate, onViewAll }) => {
  const [expanded, setExpanded] = useState(false);
  // Inline accordion: which update ids are expanded (tap a card to reveal its
  // body in place instead of opening an overlay). Rows toggle independently.
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  // The open/close animation itself lives in AdminUpdateRow (Reanimated, UI
  // thread); here we just flip which ids are open.
  const toggleOpen = useCallback((id: string) => {
    setOpenIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);
  const PREVIEW = 3;
  // When "View all" navigates to a dedicated screen we always show the 3-item
  // preview here; inline expand is the fallback when no navigation is wired.
  const visible = onViewAll || !expanded ? updates.slice(0, PREVIEW) : updates;
  // "View all (N)" shows as soon as there's any update (count starts right away),
  // not only once the preview overflows.
  const hasAny = updates.length > 0;

  return (
    <View style={styles.block}>
      <SectionHeader
        title="Recent admin updates"
        large
        right={
          hasAny ? (
            onViewAll ? (
              <LinkText label={`View all (${updates.length})`} onPress={onViewAll} />
            ) : (
              <LinkText label={expanded ? 'Show less' : 'View all'} onPress={() => setExpanded(e => !e)} />
            )
          ) : null
        }
      />
      {(
        <View style={styles.updatesCard}>
          {/* Empty state (any role) — a placeholder row (megaphone + "No updates
              yet") so the card reads like a real update before any exist (Figma
              13179-7024). The host additionally gets a "+ Add update" row beneath
              it; the divider only shows when that row follows. */}
          {visible.length === 0 ? (
            <View style={[styles.updateEmptyRow, isHost && styles.updateEmptyDivider]}>
              <View style={styles.updateEmptyIcon}>
                <AnnouncementIcon size={18} color={T.inkBody} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.updateEmptyTitle}>No updates yet</Text>
                <Text style={styles.updateEmptyTime}>0 minutes ago</Text>
              </View>
            </View>
          ) : null}
          {visible.map((u, i) => (
            // Plan preview — tap a card with a body to expand it inline
            // (accordion); editing / deleting happens on the "View all" screen.
            <AdminUpdateRow
              key={u.id}
              update={u}
              connected
              showDivider={isHost || i < visible.length - 1}
              formatTime={formatTime}
              open={openIds.has(u.id)}
              onToggle={() => toggleOpen(u.id)}
            />
          ))}
          {isHost ? (
            <PressableScale onPress={onAddUpdate} style={styles.addRow} scaleTo={0.98}>
              <Text style={styles.addRowText}>+ Add update</Text>
            </PressableScale>
          ) : null}
        </View>
      )}
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
  /** Host "+ Add item" — opens the add-item bottom sheet in place (NOT the full
   *  "Edit Group Gear" screen). Falls back to onManage when not provided. */
  onAddItem?: () => void;
  /** When provided, "View all" pushes the full Packing & Gear screen instead
   *  of expanding inline (Figma node 12919-32700). */
  onViewAll?: () => void;
}> = ({ items, isHost, isApprovedMember, currentUserId, onPressItem, onManage, onRequestItem, onAddItem, onViewAll }) => {
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
          <Text style={styles.ygSub}>Shared items - e.g. camera, speaker</Text>
        </View>
        <View style={styles.ygHeaderRight}>
          {items.length > 0 ? (
            <Pressable onPress={handleViewAll} hitSlop={8}>
              <Text style={styles.ygViewAll}>View all ({items.length})</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      {items.length === 0 ? (
        // Empty — a card shaped like a real gear card (Figma 13179-7024): bold
        // title, "Suggest below" hint, and the empty contributor chip ("+ 0").
        <View style={styles.gearEmptyCard}>
          <Text style={styles.gearName}>No group gear yet</Text>
          <Text style={styles.gearStatus}>Suggest below</Text>
          <View style={{ marginTop: 8 }}>
            <AvatarStack contributors={[]} currentUserId={currentUserId} />
          </View>
        </View>
      ) : (
        <View style={styles.gearList}>
          {visible.map(item => (
            <GearRow key={item.id} item={item} onPress={() => onPressItem(item)} currentUserId={currentUserId} standalone />
          ))}
        </View>
      )}
      {/* Host adds group gear directly ("+ Add item"); approved members request
          an item instead. Both render as the same teal link beneath the card. */}
      {isHost ? (
        <Pressable onPress={onManage} hitSlop={8} style={styles.requestRow}>
          <Text style={styles.requestLink}>+ Add item</Text>
        </Pressable>
      ) : isApprovedMember ? (
        <Pressable onPress={onRequestItem} hitSlop={8} style={styles.requestRow}>
          <Text style={styles.suggestLink}>Missing something? Suggest item</Text>
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
    <Text style={styles.hostSuggText}>Admin suggested</Text>
    <TripIcon name="award-01" size={14} color="#333333" strokeWidth={1.2} />
  </View>
);

// Three layouts share one card. 'member' = the viewer's full checklist (host
// suggestions + their own items, all checkable). 'personal' = the host's OWN
// gear, kept SEPARATE from the suggestions they curate (kind 'mine', checkable).
// 'suggestions' = the host curating what members should pack (kind 'host', no
// checkbox, "Host suggestion" badge). Admin sees 'personal' + 'suggestions' as
// two distinct sections; members see one 'member' card.
export type YourGearMode = 'member' | 'personal' | 'suggestions';

export const YourGearCard: React.FC<{
  rows: YourGearRow[];
  totalCount: number;
  mode: YourGearMode;
  onOpen: () => void;
  /** Toggle an item's "packed" state inline — no overlay (Figma 12716-7051). */
  onToggleItem: (row: YourGearRow) => void;
  /** Add a row — a personal item ('member'/'personal') or a suggestion
   *  ('suggestions'). Renders the "+ Add item" row; omit to hide it (e.g. a
   *  cancelled trip or a viewer who can't edit). */
  onAddItem?: () => void;
}> = ({ rows, totalCount, mode, onOpen, onToggleItem, onAddItem }) => {
  const PREVIEW = 3;
  const isSuggestions = mode === 'suggestions';
  const displayRows =
    mode === 'personal'
      ? rows.filter(r => r.kind === 'mine')
      : mode === 'suggestions'
      ? rows.filter(r => r.kind === 'host')
      : rows;
  const total = displayRows.length;
  const preview = displayRows.slice(0, PREVIEW);

  const title = isSuggestions ? 'What should members pack?' : 'Your Gear';
  const subtitle = isSuggestions ? 'Things they should bring for themselves' : 'Things you want to bring';
  const emptyText = isSuggestions ? 'No gear yet' : 'No personal gear yet';

  return (
    <View style={styles.ygBlock}>
      {/* Header (Figma 12557-5898). Every mode keeps a single "View all" link
          that opens the full list (suggestions are curated from there too). */}
      <View style={styles.ygHeader}>
        <View style={styles.ygHeaderText}>
          <Text style={styles.ygTitle}>{title}</Text>
          <Text style={styles.ygSub}>{subtitle}</Text>
        </View>
        <View style={styles.ygHeaderRight}>
          {total > 0 ? (
            <Pressable onPress={onOpen} hitSlop={8}>
              <Text style={styles.ygViewAll}>View all ({total})</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={styles.ygCard}>
        {total === 0 ? (
          // Empty placeholder — same row height as a real item (Figma 13179-7024).
          // Personal/member: an unchecked checkbox. Suggestions: the badge.
          <View style={[styles.ygRow, !onAddItem && styles.ygRowLast]}>
            {isSuggestions ? null : <GearCheckbox checked={false} />}
            <Text style={styles.ygItem} numberOfLines={1}>{emptyText}</Text>
            {isSuggestions ? <HostSuggestionTag /> : null}
          </View>
        ) : (
          preview.map((row, i) => {
            // Last visual row drops its divider so the collapsing 1px borders read
            // as one card; a trailing "+ Add item" becomes the real last when shown.
            const isLast = !onAddItem && i === preview.length - 1;
            return (
              <Pressable
                key={`${row.kind}-${row.name}`}
                onPress={isSuggestions ? undefined : () => onToggleItem(row)}
                style={[styles.ygRow, isLast && styles.ygRowLast]}
              >
                {isSuggestions ? null : <GearCheckbox checked={row.done} />}
                <Text
                  style={[styles.ygItem, !isSuggestions && row.done && styles.ygItemDone]}
                  numberOfLines={1}
                >
                  {row.name}
                </Text>
                {row.kind === 'host' ? <HostSuggestionTag /> : null}
              </Pressable>
            );
          })
        )}

        {onAddItem ? (
          <Pressable onPress={onAddItem} style={[styles.ygRow, styles.ygRowCenter, styles.ygRowLast]}>
            <Text style={styles.addRowText}>+ Add item</Text>
          </Pressable>
        ) : null}
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
  sectionTitleLarge: { fontSize: 16, lineHeight: 24, color: '#333333' },
  sectionSub: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18, color: T.muted, marginTop: 2 },
  // get_variable_defs (per node): View all = Body/M B-2 (Size/md 14 / Size/xl 18);
  // Edit = Body/B-4 (Size/xs 10 / 20).
  link: { fontFamily: ff('Inter', '400'), fontSize: 14, lineHeight: 18, fontWeight: '400', color: T.accent },
  linkSmall: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18, fontWeight: '400', color: T.accent },
  empty: { fontFamily: ff('Inter', '400'), fontSize: 14, color: T.muted, paddingVertical: 6 },

  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.hairline },

  // Members section (Figma 13455-38686) — header + scrollable avatar row +
  // "Committed to trip" progress. Bottom hairline separates it from the next
  // Plan block.
  memberSection: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 24,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: T.cardBorder,
  },
  // Bleed edge-to-edge so avatars scroll to the screen edge.
  memberScroll: { marginHorizontal: -16, marginTop: 16 },
  memberScrollContent: { paddingHorizontal: 16, gap: 8, alignItems: 'flex-start' },
  memberItem: { width: 68, alignItems: 'center' },
  memberAvatar: { width: 68, height: 68, borderRadius: 34, backgroundColor: '#9CB6C0' },
  memberAvatarEmpty: { alignItems: 'center', justifyContent: 'center' },
  // Passport badge — the Figma scalloped teal badge (CommittedPassportIcon
  // brings its own teal fill + white ring), notched into the avatar's
  // bottom-right. This is just the positioning wrapper.
  memberBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 26,
    height: 26,
  },
  // Name caption (Body/B-4: Size/xs) — nudged to 11px for legibility under the avatar.
  memberName: {
    marginTop: 4,
    fontFamily: ff('Inter', '400'),
    fontSize: 11,
    lineHeight: 14,
    color: '#A0A0A0',
    textAlign: 'center',
    width: 56,
  },
  memberProgress: { marginTop: 24, gap: 8 },
  memberProgressRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  memberProgressLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  // Body/M B-2: Size/md 14 / Size/xl 18.
  memberProgressLabel: { fontFamily: ff('Inter', '400'), fontSize: 14, lineHeight: 18, color: T.muted },
  // Body/B-3: Size/s 12 / 18.
  memberProgressCount: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18, color: T.muted },
  memberProgressTrack: {
    height: 6,
    borderRadius: 2,
    backgroundColor: T.border,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  memberProgressFill: { height: '100%', backgroundColor: T.accent, borderRadius: 2 },

  // Commit pill
  commitWrap: { paddingHorizontal: 16, marginTop: 32, marginBottom: 12 },
  commitPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 52,
    borderRadius: 12,
    backgroundColor: T.ink,
  },
  commitPillPending: { backgroundColor: '#FFB443' }, // Colors/Yellow/100 — request sent
  commitPillApproved: { backgroundColor: '#2BCCBD' }, // Colors/Green/M 200 — committed
  commitText: { fontFamily: ff('Montserrat', '700'), fontSize: 16, lineHeight: 24, fontWeight: '700', color: '#FFFFFF' },
  commitCaption: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18, color: '#6A7282', textAlign: 'center', marginTop: 10 },

  // Admin updates — rows live in AdminUpdateUI. The Plan card connects them into
  // one rounded card (Figma 12716:6935): a single border, hairline dividers
  // between rows, and "+ Add update" as the last connected row.
  updatesCard: {
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.cardBorder,
    borderRadius: 16,
    overflow: 'hidden',
  },
  addRow: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 8,
    backgroundColor: T.surface,
  },
  addRowText: { fontFamily: ff('Inter', '600'), fontSize: 14, lineHeight: 20, fontWeight: '600', color: T.inkBody },
  // Empty admin-updates placeholder — mirrors AdminUpdateUI's connected row
  // (icon box + title + time) so the empty card reads like a real update.
  updateEmptyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 8,
    paddingRight: 16,
    paddingVertical: 16,
    backgroundColor: T.surface,
  },
  updateEmptyDivider: { borderBottomWidth: 1, borderBottomColor: T.cardBorder },
  updateEmptyIcon: { padding: 10, borderRadius: 8, backgroundColor: '#F7F7F7', alignItems: 'center', justifyContent: 'center' },
  updateEmptyTitle: { fontFamily: ff('Inter', '700'), fontSize: 12, lineHeight: 18, fontWeight: '700', color: '#333333', marginBottom: -2 },
  updateEmptyTime: { fontFamily: ff('Inter', '400'), fontSize: 10, lineHeight: 20, color: '#6A7282' },

  // Group gear
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
  // Empty Group Gear card — same shell as gearCard but stacked (title, hint,
  // contributor chip) instead of a single row (Figma 13179-7024).
  gearEmptyCard: {
    paddingLeft: 16,
    paddingRight: 12,
    paddingVertical: 14,
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: '#EEEEEE',
    borderRadius: 20,
  },
  // Inline preview list — each item is its own rounded card, gapped (Figma).
  gearList: { gap: 12 },
  // Centred "Missing something? Suggest item" link, spaced from the cards above.
  requestRow: { alignItems: 'center', marginTop: 16 },
  requestLink: { fontFamily: ff('Inter', '600'), fontSize: 14, lineHeight: 20, fontWeight: '600', color: T.accent },
  // Member "Missing something? Suggest item" — 14px but kept regular weight.
  suggestLink: { fontFamily: ff('Inter', '400'), fontSize: 14, lineHeight: 20, fontWeight: '400', color: T.accent },
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
  ygTitle: { fontFamily: ff('Inter', '700'), fontSize: 16, lineHeight: 24, fontWeight: '700', color: '#333333' },
  ygSub: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18, color: '#6a7282' },
  ygViewAll: { fontFamily: ff('Inter', '400'), fontSize: 14, lineHeight: 18, color: T.accent },
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
