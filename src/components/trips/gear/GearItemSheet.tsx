// Gear-claim bottom sheet — Figma nodes 12833-12938 (unclaimed) / 12833-13869
// (claimed). A grabber-topped sheet: item title, collection progress, a
// horizontal Contributors strip, a "How many can you bring?" card with a
// stepper, and stacked actions. Two states:
//   • Not yet claimed → "I got this", plain stepper, no banner.
//   • Already claimed → "You" pinned first in Contributors (teal ring) with a
//     divider, a "You're bringing N" confirmation banner, a trash button to
//     remove, the value box outlined teal, and the button becomes "Update".
// Custom Modal (not TripBottomSheet): grabber + centered title + no close-X.
//
// Fonts: ff(family, weight) so native renders the real Inter/Montserrat weights.

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Image,
  Modal,
  Pressable,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ff } from '../../../theme/fonts';
import { TripIcon } from '../tripIcons';
import type { EnrichedGearItem, GearContributor } from '../../../services/trips/groupTripsService';

interface Props {
  visible: boolean;
  item: EnrichedGearItem | null;
  currentUserId: string | null;
  onClose: () => void;
  onSetClaim: (itemId: string, quantity: number) => Promise<void>;
}

// Exact Figma tokens.
const C = {
  ink: '#333333', // text/m-01
  body: '#333333',
  collected: '#7B7B7B', // text/m-02
  name: '#A0A0A0', // text/m-03
  cardBg: '#F7F7F7', // surface/m-02
  border: '#CFCFCF', // stroke/m-03
  hairline: '#EEEEEE', // stroke/m-04
  track: '#E4E4E4', // surface/m-03
  dark: '#212121', // surface/m-07
  accent: '#05BCD3', // fill/accent
  bannerBg: '#F1F9F9', // confirmation banner
  bannerIcon: '#2BCCBD', // green/m-200
  danger: '#E5484D', // trash
  white: '#FFFFFF',
  grabber: '#7B7B7B',
} as const;

const SHEET_MAX_HEIGHT = Dimensions.get('window').height * 0.9;

const initialOf = (name: string | null) => (name || '?').trim().charAt(0).toUpperCase() || '?';
const badgeText = (qty: number) => (qty > 1 ? `x${qty}` : '1');

// One contributor: 48px avatar + quantity badge (bottom-right) + name below.
// `me` gives the current user a teal ring and the "You" label.
const Contributor: React.FC<{ c: GearContributor; me?: boolean }> = ({ c, me }) => (
  <View style={styles.contributor}>
    <View style={styles.avatarWrap}>
      {c.profile_image_url ? (
        <Image source={{ uri: c.profile_image_url }} style={[styles.avatar, me && styles.avatarMe]} />
      ) : (
        <View style={[styles.avatar, styles.avatarFallback, me && styles.avatarMe]}>
          <Text style={styles.avatarInitial}>{initialOf(c.name)}</Text>
        </View>
      )}
      <View style={styles.qtyBadge}>
        <Text style={styles.qtyBadgeText}>{badgeText(c.quantity)}</Text>
      </View>
    </View>
    <Text style={[styles.contributorName, me && styles.contributorNameMe]} numberOfLines={1}>
      {me ? 'You' : c.name || '—'}
    </Text>
  </View>
);

export const GearItemSheet: React.FC<Props> = ({ visible, item, currentUserId, onClose, onSetClaim }) => {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState(1);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (item) setDraft(item.my_claim_qty > 0 ? item.my_claim_qty : 1);
  }, [item?.id, item?.my_claim_qty]);

  if (!item) {
    return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} />;
  }

  const othersQty = item.claimed_qty - item.my_claim_qty;
  const maxForMe = Math.max(item.needed_qty - othersQty, 0); // most I could still bring
  const coveredByOthers = maxForMe <= 0 && item.my_claim_qty === 0;
  const iHaveIt = item.my_claim_qty > 0;

  const remaining = Math.max(item.needed_qty - item.claimed_qty, 0);
  const pct = item.needed_qty > 0 ? Math.min(1, item.claimed_qty / item.needed_qty) : 0;

  // Pin the current user first ("You"); everyone else follows after a divider.
  const me = currentUserId ? item.contributors.find(c => c.user_id === currentUserId) : undefined;
  const others = item.contributors.filter(c => c.user_id !== currentUserId);

  const inc = () => setDraft(d => Math.min(maxForMe, d + 1));
  const dec = () => setDraft(d => Math.max(1, d - 1)); // floor 1 — removal is via the trash

  const handleConfirm = async () => {
    if (saving) return;
    const qty = Math.max(1, draft);
    if (qty === item.my_claim_qty) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      await onSetClaim(item.id, qty);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onSetClaim(item.id, 0);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const showStepper = !coveredByOthers;
  const hasContributors = item.contributors.length > 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={e => e.stopPropagation()}>
          {/* Grabber */}
          <View style={styles.grabberRow}>
            <View style={styles.grabber} />
          </View>

          <ScrollView
            contentContainerStyle={styles.body}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            <Text style={styles.title}>{item.name}</Text>

            {/* Progress */}
            <View style={styles.progressSection}>
              <View style={styles.progressInfo}>
                <Text style={styles.collected}>
                  {item.claimed_qty} / {item.needed_qty} collected
                </Text>
                <Text style={styles.remaining}>
                  {remaining > 0 ? `${remaining} more needed` : 'All set'}
                </Text>
              </View>
              <View style={styles.track}>
                <View style={[styles.fill, { flex: pct }]} />
                <View style={{ flex: 1 - pct }} />
              </View>
            </View>

            {/* Contributors — "You" pinned first (teal ring) + divider + others. */}
            {hasContributors ? (
              <View style={styles.contributorsSection}>
                <Text style={styles.sectionTitle}>Contributors</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.contributorRow}
                >
                  {iHaveIt && me ? (
                    <>
                      <Contributor c={me} me />
                      {others.length > 0 ? <View style={styles.contribDivider} /> : null}
                    </>
                  ) : null}
                  {others.map(c => (
                    <Contributor key={c.user_id} c={c} />
                  ))}
                </ScrollView>
              </View>
            ) : null}

            {/* Confirmation banner — only after claiming. */}
            {iHaveIt ? (
              <View style={styles.banner}>
                <View style={styles.bannerIcon}>
                  <Ionicons name="checkmark" size={26} color={C.white} />
                </View>
                <View style={styles.bannerText}>
                  <Text style={styles.bannerTitle}>You're bringing {item.my_claim_qty}</Text>
                  <Text style={styles.bannerSub}>Thanks! You can update or remove anytime.</Text>
                </View>
              </View>
            ) : null}

            {/* How many can you bring? */}
            {showStepper ? (
              <View style={styles.howManyCard}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>How many can you bring?</Text>
                  {iHaveIt ? (
                    <TouchableOpacity
                      style={styles.trashBtn}
                      onPress={handleRemove}
                      disabled={saving}
                      hitSlop={8}
                      accessibilityLabel="Remove my contribution"
                    >
                      <TripIcon name="trash-01" size={20} color={C.danger} strokeWidth={1} />
                    </TouchableOpacity>
                  ) : null}
                </View>
                <Text style={styles.cardBody}>
                  By claiming this item, you're committing to bring it on the trip. The group is
                  counting on you!
                </Text>
                <View style={styles.stepperRow}>
                  <TouchableOpacity
                    style={styles.stepBtn}
                    onPress={dec}
                    disabled={draft <= 1}
                    activeOpacity={0.7}
                    accessibilityLabel="One less"
                  >
                    <Ionicons name="remove" size={28} color={draft <= 1 ? C.border : C.ink} />
                  </TouchableOpacity>
                  <View style={[styles.stepValueBox, iHaveIt && styles.stepValueBoxActive]}>
                    <Text style={styles.stepValue}>{draft}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.stepBtn}
                    onPress={inc}
                    disabled={draft >= maxForMe}
                    activeOpacity={0.7}
                    accessibilityLabel="One more"
                  >
                    <Ionicons name="add" size={28} color={draft >= maxForMe ? C.border : C.ink} />
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}
          </ScrollView>

          {/* Stacked actions */}
          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 24) }]}>
            {showStepper ? (
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={handleConfirm}
                disabled={saving}
                activeOpacity={0.85}
              >
                {saving ? (
                  <ActivityIndicator color={C.white} />
                ) : (
                  <Text style={styles.primaryBtnText}>{iHaveIt ? 'Update' : 'I got this'}</Text>
                )}
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity onPress={onClose} hitSlop={8} activeOpacity={0.7}>
              <Text style={styles.maybeLater}>Maybe later</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(33,33,33,0.70)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: SHEET_MAX_HEIGHT,
    width: '100%',
    paddingTop: 2,
  },

  // Grabber — Figma: 80x4 #7b7b7b, pt8 pb16
  grabberRow: { alignItems: 'center', paddingTop: 8, paddingBottom: 16 },
  grabber: { width: 80, height: 4, borderRadius: 20, backgroundColor: C.grabber },

  // Explicit margins (not a uniform `gap`) so each Figma spacing is exact.
  body: { paddingHorizontal: 16 },

  title: { fontFamily: ff('Inter', '700'), fontWeight: '700', fontSize: 16, lineHeight: 24, color: C.ink },

  // Progress — 24 below the title (Figma).
  progressSection: { gap: 8, paddingHorizontal: 8, marginTop: 24 },
  progressInfo: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  collected: { fontFamily: ff('Inter', '400'), fontSize: 14, lineHeight: 18, color: C.collected },
  remaining: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18, color: C.collected },
  track: {
    flexDirection: 'row',
    height: 6,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: C.track,
  },
  fill: { backgroundColor: C.accent },

  // Contributors — 16 below the progress bar, 24 between title and avatars (Figma).
  contributorsSection: {
    marginTop: 16,
    gap: 24,
  },
  sectionTitle: { fontFamily: ff('Inter', '700'), fontWeight: '700', fontSize: 16, lineHeight: 24, color: C.ink },
  contributorRow: { gap: 8, paddingVertical: 2, alignItems: 'flex-start' },
  contributor: { width: 48, alignItems: 'center', gap: 2 },
  avatarWrap: { width: 48, height: 48 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: C.track },
  avatarMe: { borderWidth: 2, borderColor: C.accent },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#A8DDE0' },
  avatarInitial: { fontFamily: ff('Inter', '700'), fontWeight: '700', fontSize: 18, color: C.white },
  qtyBadge: {
    position: 'absolute',
    right: 0,
    top: 34,
    minWidth: 14,
    paddingHorizontal: 2,
    borderRadius: 5,
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyBadgeText: { fontFamily: ff('Inter', '700'), fontWeight: '700', fontSize: 9, lineHeight: 14, color: C.ink, textAlign: 'center' },
  contributorName: { fontFamily: ff('Inter', '400'), fontSize: 10, lineHeight: 20, color: C.name, textAlign: 'center', width: 48 },
  contributorNameMe: { color: C.ink },
  // Vertical hairline separating "You" from the rest.
  contribDivider: { width: 1, height: 48, backgroundColor: C.hairline, marginHorizontal: 12 },

  // Confirmation banner (claimed) — 24 below the avatars.
  banner: {
    marginTop: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 8,
    borderRadius: 16,
    backgroundColor: C.bannerBg,
  },
  bannerIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: C.bannerIcon,
    borderWidth: 1,
    borderColor: C.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerText: { flex: 1, gap: 4 },
  bannerTitle: { fontFamily: ff('Inter', '700'), fontWeight: '700', fontSize: 14, lineHeight: 18, color: C.ink },
  bannerSub: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18, color: C.ink },

  // How many can you bring? card — 24 below the avatars/banner (Figma).
  howManyCard: {
    marginTop: 24,
    backgroundColor: C.cardBg,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    gap: 10,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  cardTitle: { flex: 1, fontFamily: ff('Inter', '700'), fontWeight: '700', fontSize: 16, lineHeight: 24, color: C.ink },
  trashBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18, color: C.body },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    paddingTop: 24,
    paddingBottom: 16,
    paddingHorizontal: 8,
  },
  stepBtn: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValueBox: {
    flex: 1,
    height: 56,
    borderRadius: 12,
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValueBoxActive: { borderColor: C.accent },
  stepValue: { fontFamily: ff('Inter', '400'), fontSize: 16, lineHeight: 24, color: C.ink, textAlign: 'center' },

  // Footer actions — 16 above the buttons (card → "I got this"), 24 at the bottom.
  footer: { paddingHorizontal: 32, paddingTop: 16, gap: 16, alignItems: 'center' },
  primaryBtn: {
    width: '100%',
    height: 56,
    borderRadius: 12,
    backgroundColor: C.dark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { fontFamily: ff('Montserrat', '600'), fontWeight: '600', fontSize: 16, lineHeight: 24, color: C.white },
  maybeLater: { fontFamily: ff('Inter', '700'), fontWeight: '700', fontSize: 14, lineHeight: 18, color: C.ink, textAlign: 'center' },
});

export default GearItemSheet;
