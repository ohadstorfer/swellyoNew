// Operator-facing sheet to run a trip's crew: see who is on it, add someone,
// move them between tiers, take them off.
//
// Spec: docs/specs/operator-trips/staff-and-permissions.md
//
// ── Why the tier list is not hardcoded here ─────────────────────────────────
// What each tier can do is a row in `organized_trip_staff_roles`, editable with
// an UPDATE because the permissions are not finally decided. So this sheet
// RENDERS whatever the database returns — the labels, the blurbs and the
// capability list all come down the wire. The only thing the client owns is the
// English for a capability key (CAPABILITY_LABELS), because that is copy.
//
// Visual language matches InviteMembersSheet: white surface, grabber, 20px
// radius, Montserrat for weight and Inter for body.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput, ActivityIndicator,
  StyleSheet, useWindowDimensions, Share, Platform, Alert,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { BottomSheetShell } from '../BottomSheetShell';
import Thumb from '../Thumb';
import { Image } from 'expo-image';
import { Images } from '../../assets/images';
import { ff } from '../../theme/fonts';
import { showErrorAlert } from '../../utils/friendlyError';
import {
  listStaffRoles, listTripStaff, addTripStaff, updateTripStaffRole, revokeTripStaff,
  createStaffInviteLink, updateTripStaffListed, canChangeTier,
  searchUsersForStaff, inviteStaffMember,
  type StaffRole, type StaffRoleKey, type TripStaffMember, type StaffSearchResult,
} from '../../services/trips/tripStaffService';
import { uploadCrewPhoto } from '../../services/storage/storageService';
import type { TripCapability } from '../../hooks/trips/useTripCapabilities';

interface Props {
  visible: boolean;
  tripId: string;
  /** The trip's host_id. The database checks this, but passing it avoids a read. */
  operatorId: string;
  onClose: () => void;
}

/**
 * English for each capability key. Copy, not logic — a key with no entry here
 * still works, it just shows the raw key, which is a loud enough signal that
 * someone added a capability and forgot the label.
 */
const CAPABILITY_LABELS: Record<TripCapability, string> = {
  'profile.shown_to_travelers': 'Shown to travelers',
  'roster.view': 'Logs in · sees the roster',
  'travelers.view_profiles': 'Traveler profiles + emergency contact',
  'travelers.view_stats': 'Surf & travel stats',
  'chat.participate': 'Group chat · updates · 1:1',
  'payments.view_status': 'Payment status',
  'docs.view': 'Documents · flights · passports',
  'medical.view': 'Medical status',
  'trip.edit': 'Edit trip, gear and required docs',
  'docs.approve': 'Approve documents',
  'travelers.remove': 'Remove a traveler',
  'data.export': 'Export traveler data',
  'money.manage': 'Money: amounts, refunds, payouts',
  'staff.manage': 'Invite and edit staff',
  'trip.cancel': 'Cancel the trip',
};

const TIER_TINT: Record<StaffRoleKey, { bg: string; fg: string }> = {
  listed:   { bg: '#F1F3F5', fg: '#6B7178' },
  crew:     { bg: '#EDF3FF', fg: '#3A6DB0' },
  guide:    { bg: '#E9F6EF', fg: '#1B8A4B' },
  manager:  { bg: '#FFF3E4', fg: '#B4712A' },
  operator: { bg: '#F0EBFB', fg: '#6A4BC0' },
};

// 'add' is the fork: someone with a Swellyo account joins by link (they have to
// sign in, which is what identifies them), someone without one is a Listed
// credit typed in by hand. 'link' is the generated-link screen.
type Mode =
  | { kind: 'list' }
  | { kind: 'add' }
  | { kind: 'listed' }
  // Search for an account, then pick their tier. Two steps because the tier is
  // the consequential choice and it should not be buried under a search box.
  | { kind: 'search' }
  | { kind: 'searchRole'; user: StaffSearchResult }
  | { kind: 'link' }
  | { kind: 'edit'; member: TripStaffMember };

export function TripStaffSheet({ visible, tripId, operatorId, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  const [roles, setRoles] = useState<StaffRole[]>([]);
  const [staff, setStaff] = useState<TripStaffMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [saving, setSaving] = useState(false);

  // Draft state for the add/edit form.
  const [draftName, setDraftName] = useState('');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftRole, setDraftRole] = useState<StaffRoleKey>('crew');
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Local file URI while picking; becomes an S3 URL on save. Kept apart from
  // draftPhotoUrl so a cancelled edit never leaves a dead local path in the DB.
  const [draftPhotoLocal, setDraftPhotoLocal] = useState<string | null>(null);
  const [draftPhotoUrl, setDraftPhotoUrl] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<StaffSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    Promise.all([listStaffRoles(), listTripStaff(tripId)])
      .then(([r, s]) => {
        if (cancelled) return;
        setRoles(r);
        setStaff(s);
      })
      .catch(() => { if (!cancelled) setLoadError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tripId]);

  useEffect(() => {
    if (!visible) return;
    setMode({ kind: 'list' });
    return load();
  }, [visible, load]);

  // The Operator tier is the trip owner and is never assignable — they hold it
  // by owning the trip, not by having a row. Offering it would create a second,
  // contradictory source of truth.
  const assignableRoles = useMemo(() => roles.filter(r => r.role_key !== 'operator'), [roles]);
  const roleByKey = useMemo(
    () => new Map(roles.map(r => [r.role_key, r])),
    [roles],
  );

  const openAdd = useCallback(() => {
    setDraftName('');
    setDraftTitle('');
    setDraftRole('crew');
    setInviteUrl(null);
    setCopied(false);
    setDraftPhotoLocal(null);
    setDraftPhotoUrl(null);
    setMode({ kind: 'add' });
  }, []);

  // Debounced so a name is one query, not one per keystroke. 250ms is long
  // enough to swallow a burst of typing and short enough to feel live.
  // `stale` guards against an earlier, slower query landing after a later one
  // and overwriting good results with old ones.
  useEffect(() => {
    if (mode.kind !== 'search') return;
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    let stale = false;
    setSearching(true);
    const t = setTimeout(() => {
      searchUsersForStaff(tripId, q)
        .then(rows => { if (!stale) setSearchResults(rows); })
        .catch(() => { if (!stale) setSearchResults([]); })
        .finally(() => { if (!stale) setSearching(false); });
    }, 250);
    return () => { stale = true; clearTimeout(t); };
  }, [searchQuery, mode.kind, tripId]);

  const handleInviteInApp = useCallback(async () => {
    if (mode.kind !== 'searchRole') return;
    setSaving(true);
    try {
      await inviteStaffMember({
        tripId,
        userId: mode.user.user_id,
        roleKey: draftRole as Exclude<StaffRoleKey, 'operator'>,
        title: draftTitle,
      });
      setStaff(await listTripStaff(tripId));
      setMode({ kind: 'list' });
    } catch (e) {
      showErrorAlert("Couldn't send the invite", e, 'Please try again.');
    } finally {
      setSaving(false);
    }
  }, [mode, tripId, draftRole, draftTitle]);

  // Only ever offered for a Listed credit: they have no account, so there is no
  // profile photo to fall back on and the operator is the only one who can put
  // a face to the name.
  const handlePickPhoto = useCallback(async () => {
    try {
      if (Platform.OS !== 'web') {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission needed', 'Swellyo needs photo access to add a crew photo.');
          return;
        }
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });
      if (!result.canceled && result.assets?.[0]) {
        setDraftPhotoLocal(result.assets[0].uri);
      }
    } catch (e) {
      showErrorAlert("Couldn't open your photos", e, 'Please try again.');
    }
  }, []);

  const handleCreateLink = useCallback(async () => {
    setSaving(true);
    try {
      const url = await createStaffInviteLink({
        tripId,
        roleKey: draftRole as Exclude<StaffRoleKey, 'operator'>,
        title: draftTitle,
      });
      setInviteUrl(url);
      setCopied(false);
    } catch (e) {
      showErrorAlert("Couldn't make the link", e, 'Please try again.');
    } finally {
      setSaving(false);
    }
  }, [tripId, draftRole, draftTitle]);

  const handleShareLink = useCallback(async () => {
    if (!inviteUrl) return;
    try {
      await Share.share({ message: inviteUrl });
    } catch {
      // User dismissed the share sheet — not an error worth an alert.
    }
  }, [inviteUrl]);

  const handleCopyLink = useCallback(async () => {
    if (!inviteUrl) return;
    await Clipboard.setStringAsync(inviteUrl);
    setCopied(true);
  }, [inviteUrl]);

  const openEdit = useCallback((member: TripStaffMember) => {
    setDraftName(member.name);
    setDraftTitle(member.title ?? '');
    setDraftRole(member.role_key);
    setDraftPhotoLocal(null);
    setDraftPhotoUrl(member.photo_url);
    setMode({ kind: 'edit', member });
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      // Upload only when a new local file was picked. An untouched photo keeps
      // whatever URL is already on the row.
      let photoUrl = draftPhotoUrl;
      if (draftPhotoLocal) {
        const up = await uploadCrewPhoto(draftPhotoLocal, operatorId);
        if (!up.success || !up.url) {
          throw new Error(up.error || "The photo didn't upload.");
        }
        photoUrl = up.url;
      }

      if (mode.kind === 'listed') {
        // Always tier 1. A row with no account cannot be anything else — nobody
        // can sign in as it, so a higher tier would be a permission granted to
        // no one, sitting in the table looking like it means something.
        await addTripStaff({
          tripId,
          operatorId,
          roleKey: 'listed',
          displayName: draftName,
          title: draftTitle,
          photoUrl: photoUrl ?? undefined,
        });
      } else if (mode.kind === 'edit') {
        // Two different edits behind one Save. Someone with an account gets
        // their tier changed; a Listed credit has no tier to change, so Save
        // means their name, title and photo.
        if (canChangeTier(mode.member)) {
          await updateTripStaffRole(mode.member.id, draftRole);
        } else {
          await updateTripStaffListed(mode.member.id, {
            displayName: draftName,
            title: draftTitle,
            ...(draftPhotoLocal ? { photoUrl } : {}),
          });
        }
      }
      setStaff(await listTripStaff(tripId));
      setMode({ kind: 'list' });
    } catch (e) {
      showErrorAlert("Couldn't save", e, 'Please try again.');
    } finally {
      setSaving(false);
    }
  }, [mode, tripId, operatorId, draftRole, draftName, draftTitle, draftPhotoLocal, draftPhotoUrl]);

  const handleRemove = useCallback(async (member: TripStaffMember) => {
    setSaving(true);
    try {
      await revokeTripStaff(member.id);
      // Drop it locally rather than refetching: one row leaving a short list
      // does not need a round trip, and the list must not jump.
      setStaff(prev => prev.filter(s => s.id !== member.id));
      setMode({ kind: 'list' });
    } catch (e) {
      showErrorAlert("Couldn't remove", e, 'Please try again.');
    } finally {
      setSaving(false);
    }
  }, []);

  // ── Rows ─────────────────────────────────────────────────────────────────

  const renderStaffRow = ({ item }: { item: TripStaffMember }) => {
    const tint = TIER_TINT[item.role_key];
    const role = roleByKey.get(item.role_key);
    return (
      <TouchableOpacity style={styles.row} activeOpacity={0.6} onPress={() => openEdit(item)}>
        {item.photo_url ? (
          <Thumb uri={item.photo_url} size={128} style={styles.avatar} contentFit="cover" cachePolicy="memory-disk" />
        ) : (
          <Image source={Images.defaultAvatar} style={styles.avatar} contentFit="cover" />
        )}
        <View style={styles.rowText}>
          <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
          <Text style={styles.meta} numberOfLines={1}>
            {item.pending ? 'Invite not accepted yet' : (item.title || role?.blurb || '')}
          </Text>
        </View>
        <View style={[styles.tierPill, { backgroundColor: tint.bg }]}>
          <Text style={[styles.tierPillText, { color: tint.fg }]}>{role?.label ?? item.role_key}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderRoleOption = (role: StaffRole) => {
    const selected = draftRole === role.role_key;
    const tint = TIER_TINT[role.role_key];
    return (
      <TouchableOpacity
        key={role.role_key}
        style={[styles.roleCard, selected && { borderColor: tint.fg, backgroundColor: tint.bg }]}
        activeOpacity={0.8}
        onPress={() => setDraftRole(role.role_key)}
      >
        <View style={styles.roleCardHead}>
          <Text style={[styles.roleLabel, selected && { color: tint.fg }]}>{role.label}</Text>
          {selected && <Ionicons name="checkmark-circle" size={18} color={tint.fg} />}
        </View>
        {!!role.blurb && <Text style={styles.roleBlurb}>{role.blurb}</Text>}
        {selected && (
          <View style={styles.capList}>
            {role.capabilities.map(c => (
              <View key={c} style={styles.capRow}>
                <Ionicons name="checkmark" size={13} color={tint.fg} />
                <Text style={styles.capText}>{CAPABILITY_LABELS[c] ?? c}</Text>
              </View>
            ))}
          </View>
        )}
      </TouchableOpacity>
    );
  };

  // ── Screens ──────────────────────────────────────────────────────────────

  const listScreen = (
    <>
      <View style={styles.handleZoneInner}>
        <Text style={styles.title}>Crew</Text>
        <Text style={styles.subtitle}>Who helps you run this trip, and what they can see</Text>
      </View>
      {loading ? (
        <View style={styles.stateBox}><ActivityIndicator size="small" color="#7B7B7B" /></View>
      ) : loadError ? (
        <View style={styles.stateBox}>
          <Ionicons name="cloud-offline-outline" size={28} color="#B9BEC3" />
          <Text style={styles.stateTitle}>Couldn't load the crew</Text>
          <TouchableOpacity style={styles.primaryButton} activeOpacity={0.8} onPress={load}>
            <Text style={styles.primaryButtonText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={staff}
          keyExtractor={s => s.id}
          renderItem={renderStaffRow}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.stateBox}>
              <Ionicons name="people-outline" size={28} color="#B9BEC3" />
              <Text style={styles.stateTitle}>No crew yet</Text>
              <Text style={styles.stateSub}>Add the people who help you run this trip.</Text>
            </View>
          }
          ListFooterComponent={
            <TouchableOpacity style={styles.addRow} activeOpacity={0.7} onPress={openAdd}>
              <View style={styles.addIcon}><Ionicons name="add" size={20} color="#212121" /></View>
              <Text style={styles.addRowText}>Add someone</Text>
            </TouchableOpacity>
          }
        />
      )}
    </>
  );

  // Tap-to-choose avatar. Shown only where there is no account behind the row,
  // because everyone else already has a profile photo that wins over this one.
  const photoPicker = (
    <TouchableOpacity style={styles.photoPicker} activeOpacity={0.8} onPress={handlePickPhoto}>
      {draftPhotoLocal ? (
        // A just-picked local file: plain expo-image. Thumb is for remote
        // storage URLs with a generated thumbnail, which this will never have.
        <Image source={{ uri: draftPhotoLocal }} style={styles.photoPreview} contentFit="cover" />
      ) : draftPhotoUrl ? (
        <Thumb
          uri={draftPhotoUrl}
          size={192}
          style={styles.photoPreview}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
      ) : (
        <View style={styles.photoEmpty}>
          <Ionicons name="camera-outline" size={22} color="#7B7B7B" />
        </View>
      )}
      <Text style={styles.photoPickerLabel}>
        {draftPhotoLocal || draftPhotoUrl ? 'Change photo' : 'Add a photo'}
      </Text>
    </TouchableOpacity>
  );

  const header = (title: string) => (
    <View style={styles.handleZoneInner}>
      <TouchableOpacity style={styles.backRow} activeOpacity={0.6} onPress={() => setMode({ kind: 'list' })}>
        <Ionicons name="chevron-back" size={18} color="#7B7B7B" />
        <Text style={styles.backText}>Crew</Text>
      </TouchableOpacity>
      <Text style={styles.title}>{title}</Text>
    </View>
  );

  // The fork. These are genuinely different things, not one form with a toggle:
  // one grants access to a real person who signs in, the other is a name on a
  // page. Making the operator choose up front is what keeps "a credit" from
  // quietly becoming "a login".
  const addScreen = (
    <>
      {header('Add someone')}
      <View style={styles.forkWrap}>
        <TouchableOpacity
          style={styles.forkCard}
          activeOpacity={0.8}
          onPress={() => { setSearchQuery(''); setSearchResults([]); setMode({ kind: 'search' }); }}
        >
          <View style={styles.forkIcon}><Ionicons name="search-outline" size={20} color="#212121" /></View>
          <View style={styles.forkText}>
            <Text style={styles.forkTitle}>They have a Swellyo account</Text>
            <Text style={styles.forkSub}>
              Find them by name. They get a notification and choose to join.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#B9BEC3" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.forkCard} activeOpacity={0.8} onPress={() => setMode({ kind: 'link' })}>
          <View style={styles.forkIcon}><Ionicons name="link-outline" size={20} color="#212121" /></View>
          <View style={styles.forkText}>
            <Text style={styles.forkTitle}>Send a link instead</Text>
            <Text style={styles.forkSub}>
              For someone you can't find by name. Works over WhatsApp — they sign in to join.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#B9BEC3" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.forkCard} activeOpacity={0.8} onPress={() => setMode({ kind: 'listed' })}>
          <View style={styles.forkIcon}><Ionicons name="person-outline" size={20} color="#212121" /></View>
          <View style={styles.forkText}>
            <Text style={styles.forkTitle}>Just show their name</Text>
            <Text style={styles.forkSub}>
              A credit on the trip page. No login, sees nothing.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#B9BEC3" />
        </TouchableOpacity>
      </View>
    </>
  );

  const listedScreen = (
    <>
      {header('Show their name')}
      <FlatList
        data={[]}
        keyExtractor={() => 'none'}
        renderItem={() => null}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.formBlock}>
            {photoPicker}
            <Text style={styles.fieldLabel}>Name</Text>
            <TextInput
              style={styles.input}
              value={draftName}
              onChangeText={setDraftName}
              placeholder="e.g. Marta Ruiz"
              placeholderTextColor="#B9BEC3"
              autoCapitalize="words"
              returnKeyType="next"
            />
            <Text style={styles.fieldLabel}>Title (optional)</Text>
            <TextInput
              style={styles.input}
              value={draftTitle}
              onChangeText={setDraftTitle}
              placeholder="e.g. Head Guide"
              placeholderTextColor="#B9BEC3"
              autoCapitalize="words"
              returnKeyType="done"
            />
            <Text style={styles.noteText}>
              They'll show on the trip page for travelers to see. They can't sign in, and they
              see nothing.
            </Text>
            <TouchableOpacity
              style={[styles.primaryButton, styles.formTopGap, (saving || !draftName.trim()) && styles.buttonBusy]}
              activeOpacity={0.8}
              disabled={saving || !draftName.trim()}
              onPress={handleSave}
            >
              {saving
                ? <ActivityIndicator size="small" color="#FFFFFF" />
                : <Text style={styles.primaryButtonText}>Add to crew</Text>}
            </TouchableOpacity>
          </View>
        }
      />
    </>
  );

  const searchScreen = (
    <>
      {header('Find someone')}
      <View style={styles.formBlock}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={17} color="#B9BEC3" />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search by name"
            placeholderTextColor="#B9BEC3"
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="search"
          />
          {searching && <ActivityIndicator size="small" color="#B9BEC3" />}
        </View>
      </View>
      <FlatList
        data={searchResults}
        keyExtractor={u => u.user_id}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.row}
            activeOpacity={0.6}
            onPress={() => {
              setDraftRole('crew');
              setDraftTitle('');
              setMode({ kind: 'searchRole', user: item });
            }}
          >
            {item.profile_image_url ? (
              <Thumb uri={item.profile_image_url} size={128} style={styles.avatar} contentFit="cover" cachePolicy="memory-disk" />
            ) : (
              <Image source={Images.defaultAvatar} style={styles.avatar} contentFit="cover" />
            )}
            <View style={styles.rowText}>
              <Text style={styles.name} numberOfLines={1}>{item.name ?? 'Unnamed'}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#B9BEC3" />
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.stateBox}>
            {searchQuery.trim().length < 2 ? (
              <>
                <Ionicons name="people-outline" size={28} color="#B9BEC3" />
                <Text style={styles.stateSub}>Type at least two letters of their name.</Text>
              </>
            ) : searching ? null : (
              <>
                <Ionicons name="person-outline" size={28} color="#B9BEC3" />
                <Text style={styles.stateTitle}>Nobody found</Text>
                <Text style={styles.stateSub}>
                  They may not be on Swellyo, or they're already on this trip. You can send a
                  link instead.
                </Text>
                <TouchableOpacity
                  style={styles.secondaryButton}
                  activeOpacity={0.7}
                  onPress={() => setMode({ kind: 'link' })}
                >
                  <Ionicons name="link-outline" size={15} color="#212121" />
                  <Text style={styles.secondaryButtonText}>Send a link</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        }
      />
    </>
  );

  const searchRoleScreen = mode.kind === 'searchRole' ? (
    <>
      {header(mode.user.name ?? 'Choose a tier')}
      <FlatList
        data={assignableRoles.filter(r => r.role_key !== 'listed')}
        keyExtractor={r => r.role_key}
        renderItem={({ item }) => renderRoleOption(item)}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.formBlock}>
            <Text style={styles.fieldLabel}>Title (optional)</Text>
            <TextInput
              style={styles.input}
              value={draftTitle}
              onChangeText={setDraftTitle}
              placeholder="e.g. Head Guide"
              placeholderTextColor="#B9BEC3"
              autoCapitalize="words"
              returnKeyType="done"
            />
            <Text style={styles.fieldLabel}>What they'll be able to see</Text>
          </View>
        }
        ListFooterComponent={
          <View style={styles.formFooter}>
            <TouchableOpacity
              style={[styles.primaryButton, saving && styles.buttonBusy]}
              activeOpacity={0.8}
              disabled={saving}
              onPress={handleInviteInApp}
            >
              {saving
                ? <ActivityIndicator size="small" color="#FFFFFF" />
                : <Text style={styles.primaryButtonText}>Send invite</Text>}
            </TouchableOpacity>
            <Text style={styles.noteText}>
              They'll get a notification and can accept or ignore it. Nothing is shared with
              them until they accept.
            </Text>
          </View>
        }
      />
    </>
  ) : null;

  const linkScreen = (
    <>
      {header('Invite by link')}
      <FlatList
        data={inviteUrl ? [] : assignableRoles.filter(r => r.role_key !== 'listed')}
        keyExtractor={r => r.role_key}
        renderItem={({ item }) => renderRoleOption(item)}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          inviteUrl ? null : (
            <View style={styles.formBlock}>
              <Text style={styles.fieldLabel}>Title (optional)</Text>
              <TextInput
                style={styles.input}
                value={draftTitle}
                onChangeText={setDraftTitle}
                placeholder="e.g. Head Guide"
                placeholderTextColor="#B9BEC3"
                autoCapitalize="words"
                returnKeyType="done"
              />
              <Text style={styles.fieldLabel}>What they'll be able to see</Text>
            </View>
          )
        }
        ListFooterComponent={
          <View style={styles.formFooter}>
            {inviteUrl ? (
              <>
                <View style={styles.linkBox}>
                  <Text style={styles.linkBoxText} numberOfLines={2}>{inviteUrl}</Text>
                </View>
                <Text style={styles.noteText}>
                  Good for one person, once. It stops working in 14 days, or as soon as someone
                  uses it.
                </Text>
                <TouchableOpacity style={[styles.primaryButton, styles.formTopGap]} activeOpacity={0.8} onPress={handleShareLink}>
                  <Text style={styles.primaryButtonText}>Send link</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.secondaryButton} activeOpacity={0.7} onPress={handleCopyLink}>
                  <Ionicons
                    name={copied ? 'checkmark' : 'copy-outline'}
                    size={15}
                    color={copied ? '#1B8A4B' : '#212121'}
                  />
                  <Text style={[styles.secondaryButtonText, copied && { color: '#1B8A4B' }]}>
                    {copied ? 'Copied' : 'Copy link'}
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity
                style={[styles.primaryButton, saving && styles.buttonBusy]}
                activeOpacity={0.8}
                disabled={saving}
                onPress={handleCreateLink}
              >
                {saving
                  ? <ActivityIndicator size="small" color="#FFFFFF" />
                  : <Text style={styles.primaryButtonText}>Make the link</Text>}
              </TouchableOpacity>
            )}
          </View>
        }
      />
    </>
  );

  // A row with no account cannot move tiers — there is nobody to grant anything
  // to. So the picker is not "shown disabled", it is not shown at all: offering
  // four cards and refusing three of them is worse than offering none. What
  // that person's edit screen shows instead is what IS editable — their photo,
  // name and title.
  const editable = mode.kind === 'edit' ? canChangeTier(mode.member) : false;

  const editScreen = mode.kind === 'edit' ? (
    <>
      {header(mode.member.name)}
      <FlatList
        data={editable ? assignableRoles : []}
        keyExtractor={r => r.role_key}
        renderItem={({ item }) => renderRoleOption(item)}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          editable ? null : (
            <View style={styles.formBlock}>
              {photoPicker}
              <Text style={styles.fieldLabel}>Name</Text>
              <TextInput
                style={styles.input}
                value={draftName}
                onChangeText={setDraftName}
                placeholder="e.g. Marta Ruiz"
                placeholderTextColor="#B9BEC3"
                autoCapitalize="words"
                returnKeyType="next"
              />
              <Text style={styles.fieldLabel}>Title (optional)</Text>
              <TextInput
                style={styles.input}
                value={draftTitle}
                onChangeText={setDraftTitle}
                placeholder="e.g. Head Guide"
                placeholderTextColor="#B9BEC3"
                autoCapitalize="words"
                returnKeyType="done"
              />
              <View style={styles.lockedNote}>
                <Ionicons name="information-circle-outline" size={16} color="#7B7B7B" />
                <Text style={styles.lockedNoteText}>
                  Listed only — they have no Swellyo account, so there's nothing to give them
                  access to. To make someone crew, invite them by link instead.
                </Text>
              </View>
            </View>
          )
        }
        ListFooterComponent={
          <View style={styles.formFooter}>
            <TouchableOpacity
              // A Listed credit with a blank name would write display_name =
              // null, which the ots_listed_needs_name CHECK rejects — the row
              // would have neither an account nor a name, so nothing to show.
              // Catch it here rather than turning it into a database error.
              style={[styles.primaryButton, (saving || (!editable && !draftName.trim())) && styles.buttonBusy]}
              activeOpacity={0.8}
              disabled={saving || (!editable && !draftName.trim())}
              onPress={handleSave}
            >
              {saving
                ? <ActivityIndicator size="small" color="#FFFFFF" />
                : <Text style={styles.primaryButtonText}>Save</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.removeButton}
              activeOpacity={0.7}
              disabled={saving}
              onPress={() => handleRemove(mode.member)}
            >
              <Text style={styles.removeButtonText}>Remove from crew</Text>
            </TouchableOpacity>
          </View>
        }
      />
    </>
  ) : null;

  return (
    <BottomSheetShell visible={visible} onClose={onClose} avoidKeyboard>
      {({ panHandlers }) => (
        <View
          style={[
            styles.sheet,
            {
              maxHeight: Math.round(windowHeight * 0.85),
              paddingBottom: Math.max(insets.bottom, 16) + 8,
            },
          ]}
        >
          {/* Grabber owns the swipe-down so it never fights the list scroll. */}
          <View {...panHandlers} style={styles.handleZone}>
            <View style={styles.grabber} />
          </View>
          {mode.kind === 'list'       ? listScreen
           : mode.kind === 'add'        ? addScreen
           : mode.kind === 'listed'     ? listedScreen
           : mode.kind === 'search'     ? searchScreen
           : mode.kind === 'searchRole' ? searchRoleScreen
           : mode.kind === 'link'       ? linkScreen
           : editScreen}
        </View>
      )}
    </BottomSheetShell>
  );
}

const styles = StyleSheet.create({
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  handleZone: { paddingTop: 8 },
  handleZoneInner: { paddingHorizontal: 20, paddingBottom: 8 },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: '#E2E5E8', marginBottom: 14 },
  title: { fontFamily: ff('Montserrat', '700'), fontSize: 18, color: '#212121', includeFontPadding: false },
  subtitle: { fontFamily: ff('Inter', '400'), fontSize: 13, color: '#7B7B7B', marginTop: 2, includeFontPadding: false },
  listContent: { paddingBottom: 8 },

  backRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: 6, marginLeft: -4 },
  backText: { fontFamily: ff('Inter', '500'), fontSize: 13, color: '#7B7B7B', includeFontPadding: false },

  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10, gap: 12 },
  rowText: { flex: 1 },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  name: { fontFamily: ff('Montserrat', '600'), fontSize: 15, color: '#212121', includeFontPadding: false },
  meta: { fontFamily: ff('Inter', '400'), fontSize: 12, color: '#7B7B7B', marginTop: 2, includeFontPadding: false },

  tierPill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  tierPillText: { fontFamily: ff('Montserrat', '600'), fontSize: 11, includeFontPadding: false },

  addRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 12 },
  addIcon: {
    width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#E2E5E8', borderStyle: 'dashed',
  },
  addRowText: { fontFamily: ff('Montserrat', '600'), fontSize: 15, color: '#212121', includeFontPadding: false },

  formBlock: { paddingHorizontal: 20, paddingBottom: 4 },
  fieldLabel: { fontFamily: ff('Montserrat', '600'), fontSize: 12, color: '#7B7B7B', marginTop: 14, marginBottom: 6, includeFontPadding: false },
  input: {
    borderWidth: 1, borderColor: '#E2E5E8', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 11,
    fontFamily: ff('Inter', '400'), fontSize: 15, color: '#212121', includeFontPadding: false,
  },

  roleCard: {
    marginHorizontal: 20, marginTop: 8, padding: 14,
    borderWidth: 1, borderColor: '#E2E5E8', borderRadius: 14, backgroundColor: '#FFFFFF',
  },
  roleCardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  roleLabel: { fontFamily: ff('Montserrat', '700'), fontSize: 15, color: '#212121', includeFontPadding: false },
  roleBlurb: { fontFamily: ff('Inter', '400'), fontSize: 13, color: '#7B7B7B', marginTop: 3, includeFontPadding: false },
  capList: { marginTop: 10, gap: 6 },
  capRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  capText: { fontFamily: ff('Inter', '400'), fontSize: 13, color: '#4A5057', flex: 1, includeFontPadding: false },

  forkWrap: { paddingHorizontal: 20, paddingTop: 4, gap: 10 },
  forkCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14,
    borderWidth: 1, borderColor: '#E2E5E8', borderRadius: 14, backgroundColor: '#FFFFFF',
  },
  forkIcon: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#F1F3F5',
  },
  forkText: { flex: 1 },
  forkTitle: { fontFamily: ff('Montserrat', '600'), fontSize: 15, color: '#212121', includeFontPadding: false },
  forkSub: { fontFamily: ff('Inter', '400'), fontSize: 13, color: '#7B7B7B', marginTop: 3, includeFontPadding: false },

  noteText: {
    fontFamily: ff('Inter', '400'), fontSize: 12, color: '#7B7B7B',
    marginTop: 10, lineHeight: 17, includeFontPadding: false,
  },
  formTopGap: { marginTop: 16 },

  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: '#E2E5E8', borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10, marginTop: 4,
  },
  searchInput: {
    flex: 1, fontFamily: ff('Inter', '400'), fontSize: 15, color: '#212121',
    padding: 0, includeFontPadding: false,
  },

  photoPicker: { alignItems: 'center', paddingTop: 4, paddingBottom: 6, gap: 8 },
  photoPreview: { width: 76, height: 76, borderRadius: 38 },
  photoEmpty: {
    width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#F1F3F5', borderWidth: 1, borderColor: '#E2E5E8', borderStyle: 'dashed',
  },
  photoPickerLabel: {
    fontFamily: ff('Montserrat', '600'), fontSize: 13, color: '#212121', includeFontPadding: false,
  },

  lockedNote: {
    flexDirection: 'row', gap: 8, marginTop: 16, padding: 12,
    backgroundColor: '#F7F8F9', borderRadius: 12,
  },
  lockedNoteText: {
    flex: 1, fontFamily: ff('Inter', '400'), fontSize: 12, color: '#7B7B7B',
    lineHeight: 17, includeFontPadding: false,
  },

  linkBox: { backgroundColor: '#F1F3F5', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  linkBoxText: { fontFamily: ff('Inter', '400'), fontSize: 12, color: '#4A5057', includeFontPadding: false },
  secondaryButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 13, marginTop: 6,
  },
  secondaryButtonText: { fontFamily: ff('Montserrat', '600'), fontSize: 14, color: '#212121', includeFontPadding: false },

  formFooter: { paddingHorizontal: 20, paddingTop: 18 },
  primaryButton: {
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 20, paddingVertical: 13, borderRadius: 24, backgroundColor: '#212121',
  },
  primaryButtonText: { fontFamily: ff('Montserrat', '600'), fontSize: 15, color: '#FFFFFF', includeFontPadding: false },
  buttonBusy: { opacity: 0.7 },
  removeButton: { alignItems: 'center', paddingVertical: 14, marginTop: 4 },
  removeButtonText: { fontFamily: ff('Montserrat', '600'), fontSize: 14, color: '#C0392B', includeFontPadding: false },

  stateBox: { alignItems: 'center', paddingVertical: 36, paddingHorizontal: 32 },
  stateTitle: { fontFamily: ff('Montserrat', '600'), fontSize: 15, color: '#212121', marginTop: 10, includeFontPadding: false },
  stateSub: { fontFamily: ff('Inter', '400'), fontSize: 13, color: '#7B7B7B', marginTop: 4, textAlign: 'center', includeFontPadding: false },
});

export default TripStaffSheet;
