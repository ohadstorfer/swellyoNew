import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  Pressable,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Platform,
  TextInput,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../Text';
import { Thumb } from '../Thumb';
import { useSheetTransition } from '../../hooks/useSheetTransition';
import type { AddableDmPartner } from '../../services/surftrips/surftripsService';
import { friendlyErrorMessage } from '../../utils/friendlyError';

interface AddMembersSheetProps {
  visible: boolean;
  /** Source of the picker list. Caller decides whether this is "addable to group X" or "all my DMs". */
  loadPartners: () => Promise<AddableDmPartner[]>;
  /** Called with the chosen ids when the user taps "Add". Returns the ids actually applied (may be a subset). */
  commitSelection: (userIds: string[]) => Promise<string[]>;
  /** When > 0, caps the number of selectable rows. Pass 0 to disable the cap. */
  remainingSlots: number;
  onClose: () => void;
  onCommitted: (appliedUserIds: string[]) => void;
  /** Pre-selected ids (used in re-open flows so the caller can keep state). */
  initialSelectedIds?: string[];
  /** Override the title (default: "Add from your chats"). */
  title?: string;
  /** Override the submit button label (default: "Add to group" / "Add N to group"). */
  submitLabel?: (count: number) => string;
}

export const AddMembersSheet: React.FC<AddMembersSheetProps> = ({
  visible,
  loadPartners,
  commitSelection,
  remainingSlots,
  onClose,
  onCommitted,
  initialSelectedIds,
  title = 'Add from your chats',
  submitLabel,
}) => {
  const [partners, setPartners] = useState<AddableDmPartner[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');

  // Slide + swipe-to-dismiss, shared with every other bottom sheet.
  const { mounted, backdropOpacity, translateY, onSheetLayout, panHandlers } =
    useSheetTransition(visible, submitting ? () => {} : onClose);
  // Android: pad past the system nav/gesture bar (iOS keeps its static 28).
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    setErrorMsg(null);
    setSelectedIds(new Set(initialSelectedIds || []));
    setQuery('');
    loadPartners()
      .then(rows => {
        if (!cancelled) setPartners(rows);
      })
      .catch((e: any) => {
        if (!cancelled) setErrorMsg(friendlyErrorMessage(e, 'Could not load chats'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // intentionally do not depend on initialSelectedIds — it's a one-shot seed on open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, loadPartners]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return partners;
    return partners.filter(p => (p.name || '').toLowerCase().includes(q));
  }, [partners, query]);

  const toggle = useCallback(
    (userId: string) => {
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(userId)) {
          next.delete(userId);
          return next;
        }
        if (remainingSlots > 0 && next.size >= remainingSlots) {
          return prev;
        }
        next.add(userId);
        return next;
      });
    },
    [remainingSlots]
  );

  const handleSubmit = useCallback(async () => {
    if (selectedIds.size === 0) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const ids = Array.from(selectedIds);
      const applied = await commitSelection(ids);
      onCommitted(applied);
    } catch (e: any) {
      setErrorMsg(friendlyErrorMessage(e, 'Could not add members'));
    } finally {
      setSubmitting(false);
    }
  }, [selectedIds, commitSelection, onCommitted]);

  const reachedCap =
    remainingSlots > 0 && selectedIds.size >= remainingSlots;

  const submitText =
    submitLabel?.(selectedIds.size) ??
    (selectedIds.size === 0 ? 'Add to group' : `Add ${selectedIds.size} to group`);

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={submitting ? undefined : onClose}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.dim, { opacity: backdropOpacity }]} />
        <Animated.View style={{ transform: [{ translateY }] }} onLayout={onSheetLayout}>
        <Pressable
          style={[styles.sheet, Platform.OS === 'android' && { paddingBottom: Math.max(insets.bottom, 16) }]}
          onPress={e => e.stopPropagation()}
        >
          <View style={styles.handleZone} {...panHandlers}>
            <View style={styles.handle} />
          </View>
          <View style={styles.headerRow}>
            <Text style={styles.title}>{title}</Text>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityLabel="Close"
              disabled={submitting}
            >
              <Ionicons name="close" size={22} color="#7B7B7B" />
            </TouchableOpacity>
          </View>
          <Text style={styles.subtitle}>
            People you have conversations with
            {remainingSlots > 0 ? ` · ${remainingSlots} slot${remainingSlots === 1 ? '' : 's'} left` : ''}
          </Text>

          {partners.length > 6 ? (
            <View style={styles.searchWrap}>
              <Ionicons name="search" size={16} color="#9AA3A8" />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search by name"
                placeholderTextColor="#9AA3A8"
                style={styles.searchInput}
                autoCorrect={false}
                autoCapitalize="none"
              />
            </View>
          ) : null}

          <View style={styles.body}>
            {loading ? (
              <View style={styles.center}>
                <ActivityIndicator color="#0788B0" />
              </View>
            ) : errorMsg && partners.length === 0 ? (
              <View style={styles.center}>
                <Text style={styles.helper}>{errorMsg}</Text>
              </View>
            ) : partners.length === 0 ? (
              <View style={styles.center}>
                <Text style={styles.helper}>
                  You don&apos;t have any chats yet.
                </Text>
              </View>
            ) : filtered.length === 0 ? (
              <View style={styles.center}>
                <Text style={styles.helper}>No matches.</Text>
              </View>
            ) : (
              <ScrollView
                style={styles.list}
                contentContainerStyle={styles.listContent}
                keyboardShouldPersistTaps="handled"
              >
                {filtered.map(p => {
                  const checked = selectedIds.has(p.user_id);
                  const disabled = !checked && reachedCap;
                  return (
                    <PartnerRow
                      key={p.user_id}
                      partner={p}
                      checked={checked}
                      disabled={disabled}
                      onPress={() => toggle(p.user_id)}
                    />
                  );
                })}
              </ScrollView>
            )}
          </View>

          {errorMsg && partners.length > 0 ? (
            <Text style={styles.errorBanner}>{errorMsg}</Text>
          ) : null}

          <View style={styles.footer}>
            <TouchableOpacity
              style={[
                styles.addBtn,
                selectedIds.size === 0 && styles.addBtnDisabled,
              ]}
              onPress={handleSubmit}
              disabled={selectedIds.size === 0 || submitting}
              activeOpacity={0.85}
            >
              {submitting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.addBtnText}>{submitText}</Text>
              )}
            </TouchableOpacity>
          </View>
        </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
};

interface PartnerRowProps {
  partner: AddableDmPartner;
  checked: boolean;
  disabled: boolean;
  onPress: () => void;
}

const PartnerRow: React.FC<PartnerRowProps> = ({
  partner,
  checked,
  disabled,
  onPress,
}) => {
  const { name, age, profile_image_url, surfboard_type, surf_level_category } =
    partner;
  const detail = [
    age != null ? `${age} yo` : null,
    surf_level_category
      ? surf_level_category.charAt(0).toUpperCase() +
        surf_level_category.slice(1)
      : null,
    surfboard_type ? surfboard_type.replace(/_/g, ' ') : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <TouchableOpacity
      style={[styles.row, disabled && styles.rowDisabled]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
    >
      <View style={styles.avatarWrap}>
        {profile_image_url ? (
          <Thumb
            uri={profile_image_url}
            size={144}
            style={styles.avatar}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder]}>
            <Text style={styles.avatarInitial}>
              {(name || 'U').charAt(0).toUpperCase()}
            </Text>
          </View>
        )}
      </View>
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {name || 'User'}
        </Text>
        {!!detail && (
          <Text style={styles.detail} numberOfLines={1}>
            {detail}
          </Text>
        )}
      </View>
      <View
        style={[
          styles.checkbox,
          checked && styles.checkboxChecked,
        ]}
      >
        {checked ? (
          <Ionicons name="checkmark" size={16} color="#FFFFFF" />
        ) : null}
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  dim: { backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 28 : 16,
    paddingHorizontal: 16,
    maxHeight: '85%',
  },
  // Wider grab target around the thin handle bar for the swipe-down gesture.
  handleZone: { alignSelf: 'stretch', alignItems: 'center', paddingVertical: 6, marginTop: -6 },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E1E1E1',
    marginBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 4,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: '#222B30',
    ...(Platform.OS === 'web' ? { fontFamily: 'Montserrat, sans-serif' } : {}),
  },
  subtitle: {
    fontSize: 13,
    color: '#7B7B7B',
    marginTop: 2,
    marginBottom: 10,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F2F2F2',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: Platform.OS === 'ios' ? 8 : 4,
    marginBottom: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#222B30',
    paddingVertical: 0,
  },
  body: {
    minHeight: 120,
  },
  list: {
    maxHeight: 380,
  },
  listContent: {
    paddingVertical: 4,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  helper: {
    fontSize: 14,
    color: '#7B7B7B',
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  rowDisabled: {
    opacity: 0.45,
  },
  avatarWrap: { marginRight: 12 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F2F2F2',
  },
  avatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#A8DDE0',
  },
  avatarInitial: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },
  info: { flex: 1, minWidth: 0 },
  name: {
    fontSize: 15,
    fontWeight: '600',
    color: '#222B30',
    ...(Platform.OS === 'web' ? { fontFamily: 'Montserrat, sans-serif' } : {}),
  },
  detail: {
    fontSize: 13,
    color: '#7B7B7B',
    marginTop: 2,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: '#D6D6D6',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  checkboxChecked: {
    backgroundColor: '#0788B0',
    borderColor: '#0788B0',
  },
  errorBanner: {
    fontSize: 13,
    color: '#C0392B',
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  footer: {
    paddingTop: 10,
  },
  addBtn: {
    backgroundColor: '#0788B0',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  addBtnDisabled: {
    backgroundColor: '#C7D2D6',
  },
  addBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
