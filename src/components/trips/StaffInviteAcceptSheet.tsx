// "Marta wants you on the crew of Nias, October" — the screen you land on after
// tapping a staff invite link.
//
// Spec: docs/specs/operator-trips/staff-and-permissions.md
//
// ── Why this is a sheet and not an Alert ───────────────────────────────────
// Accepting grants real access — a Guide reads every traveler's profile and
// emergency contact, a Manager reads passports. The person tapping Accept
// should be able to see what they are being handed before they take it, and an
// Alert has no room for that list. The capability list here is the same data
// the operator saw when they picked the tier.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheetShell } from '../BottomSheetShell';
import { ff } from '../../theme/fonts';
import { showErrorAlert } from '../../utils/friendlyError';
import {
  peekStaffInvite, acceptStaffInvite, listStaffRoles,
  type StaffInvitePreview, type StaffRole,
} from '../../services/trips/tripStaffService';
import { fetchMyStaffRequirements } from '../../services/trips/staffRequirementsService';
import type { TripCapability } from '../../hooks/trips/useTripCapabilities';

const CAPABILITY_LABELS: Record<TripCapability, string> = {
  'profile.shown_to_travelers': 'Be shown to travelers',
  'roster.view': 'See the roster',
  'travelers.view_profiles': 'See traveler profiles and emergency contacts',
  'travelers.view_stats': 'See surf and travel stats',
  'chat.participate': 'Join the group chat and message travelers',
  'payments.view_status': 'See who has paid',
  'docs.view': 'See documents, flights and passports',
  'medical.view': 'See medical status',
  'trip.edit': 'Edit the trip, gear and required documents',
  'updates.send': 'Post admin updates',
  'docs.approve': 'Approve documents',
  'travelers.remove': 'Remove a traveler',
  'data.export': 'Export traveler data',
  'money.manage': 'Manage money',
  'staff.manage': 'Invite and edit crew',
  'trip.cancel': 'Cancel the trip',
};

interface Props {
  visible: boolean;
  token: string;
  onClose: () => void;
  /**
   * Called with the trip id after a successful accept, so the app can open it.
   *
   * `hasPaperwork` is true when the operator ticked something on the invite and
   * it is now waiting for them. The caller decides what to do with that — this
   * sheet must not navigate, because it is a Modal and pushing a screen that
   * opens an OS picker while a Modal is tearing down is the PHPicker hang.
   */
  onAccepted: (tripId: string, hasPaperwork: boolean) => void;
}

export function StaffInviteAcceptSheet({ visible, token, onClose, onAccepted }: Props) {
  const insets = useSafeAreaInsets();
  const [invite, setInvite] = useState<StaffInvitePreview | null>(null);
  const [role, setRole] = useState<StaffRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([peekStaffInvite(token), listStaffRoles()])
      .then(([preview, roles]) => {
        if (cancelled) return;
        setInvite(preview);
        setRole(roles.find(r => r.role_key === preview?.role_key) ?? null);
      })
      .catch(() => { if (!cancelled) setInvite(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [visible, token]);

  const handleAccept = useCallback(async () => {
    setAccepting(true);
    try {
      const tripId = await acceptStaffInvite(token);
      // Asked here rather than read off the invite: accept_staff_invite skips
      // any requirement deleted since the invite was sent, so the invite's own
      // list can promise paperwork that no longer exists. A failure is not
      // worth blocking a successful join over — they still get the trip, and
      // the entry in the trip's menu is always there.
      const outstanding = await fetchMyStaffRequirements(tripId)
        .then(rows => rows.some(r => !r.fulfilled))
        .catch(() => false);
      onAccepted(tripId, outstanding);
      onClose();
    } catch (e) {
      showErrorAlert("Couldn't join", e, 'This invite may have already been used.');
    } finally {
      setAccepting(false);
    }
  }, [token, onAccepted, onClose]);

  // One shape for wrong / spent / revoked / expired. The server does not tell
  // them apart either — otherwise a stale link becomes a way to probe which
  // tokens once existed.
  const deadInvite = (
    <View style={styles.stateBox}>
      <Ionicons name="link-outline" size={28} color="#B9BEC3" />
      <Text style={styles.stateTitle}>This invite isn't valid anymore</Text>
      <Text style={styles.stateSub}>
        It may have already been used, or it expired. Ask the operator for a new one.
      </Text>
      <TouchableOpacity style={styles.secondaryButton} activeOpacity={0.7} onPress={onClose}>
        <Text style={styles.secondaryButtonText}>Close</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <BottomSheetShell visible={visible} onClose={onClose}>
      {({ panHandlers }) => (
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
          <View {...panHandlers} style={styles.handleZone}>
            <View style={styles.grabber} />
          </View>

          {loading ? (
            <View style={styles.stateBox}><ActivityIndicator size="small" color="#7B7B7B" /></View>
          ) : !invite ? (
            deadInvite
          ) : (
            <View style={styles.body}>
              <Text style={styles.eyebrow}>
                {invite.operator_name ?? 'The operator'} invited you
              </Text>
              <Text style={styles.title}>
                Join the crew of {invite.trip_title ?? 'this trip'}
              </Text>
              {/* What they were asked to BE comes first — "as Photographer" is
                  the offer, and "Guide" is the permission tier behind it. The
                  tier still shows, because accepting hands over real access and
                  the capability list below is what that access is. */}
              <Text style={styles.roleLine}>
                as <Text style={styles.roleStrong}>{invite.title ?? invite.role_label ?? invite.role_key}</Text>
                {invite.title ? ` · ${invite.role_label ?? invite.role_key}` : ''}
              </Text>
              {!!invite.bio && (
                <Text style={styles.bioLine}>
                  “{invite.bio}” — how they'll introduce you to travelers.
                </Text>
              )}

              {!!role?.capabilities?.length && (
                <View style={styles.capBox}>
                  <Text style={styles.capHeading}>You'll be able to</Text>
                  {role.capabilities
                    // Being listed on the page is not something you "do", and
                    // reading it back as a permission is confusing.
                    .filter(c => c !== 'profile.shown_to_travelers')
                    .map(c => (
                      <View key={c} style={styles.capRow}>
                        <Ionicons name="checkmark" size={14} color="#1B8A4B" />
                        <Text style={styles.capText}>{CAPABILITY_LABELS[c] ?? c}</Text>
                      </View>
                    ))}
                </View>
              )}

              <TouchableOpacity
                style={[styles.primaryButton, accepting && styles.buttonBusy]}
                activeOpacity={0.8}
                disabled={accepting}
                onPress={handleAccept}
              >
                {accepting
                  ? <ActivityIndicator size="small" color="#FFFFFF" />
                  : <Text style={styles.primaryButtonText}>Join the crew</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryButton} activeOpacity={0.7} onPress={onClose}>
                <Text style={styles.secondaryButtonText}>Not now</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
    </BottomSheetShell>
  );
}

const styles = StyleSheet.create({
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  handleZone: { paddingTop: 8 },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: '#E2E5E8', marginBottom: 14 },
  body: { paddingHorizontal: 20 },

  eyebrow: { fontFamily: ff('Inter', '500'), fontSize: 13, color: '#7B7B7B', includeFontPadding: false },
  title: { fontFamily: ff('Montserrat', '700'), fontSize: 20, color: '#212121', marginTop: 4, includeFontPadding: false },
  roleLine: { fontFamily: ff('Inter', '400'), fontSize: 14, color: '#4A5057', marginTop: 6, includeFontPadding: false },
  roleStrong: { fontFamily: ff('Montserrat', '600'), color: '#212121' },
  bioLine: {
    fontFamily: ff('Inter', '400'), fontSize: 13, lineHeight: 19, color: '#7B7B7B',
    marginTop: 8, includeFontPadding: false,
  },

  capBox: { backgroundColor: '#F7F8F9', borderRadius: 14, padding: 14, marginTop: 18, gap: 8 },
  capHeading: { fontFamily: ff('Montserrat', '600'), fontSize: 12, color: '#7B7B7B', includeFontPadding: false },
  capRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  capText: { fontFamily: ff('Inter', '400'), fontSize: 13, color: '#4A5057', flex: 1, includeFontPadding: false },

  primaryButton: {
    alignItems: 'center', justifyContent: 'center', marginTop: 20,
    paddingHorizontal: 20, paddingVertical: 14, borderRadius: 24, backgroundColor: '#212121',
  },
  primaryButtonText: { fontFamily: ff('Montserrat', '600'), fontSize: 15, color: '#FFFFFF', includeFontPadding: false },
  buttonBusy: { opacity: 0.7 },
  secondaryButton: { alignItems: 'center', paddingVertical: 14, marginTop: 2 },
  secondaryButtonText: { fontFamily: ff('Montserrat', '600'), fontSize: 14, color: '#7B7B7B', includeFontPadding: false },

  stateBox: { alignItems: 'center', paddingVertical: 32, paddingHorizontal: 32 },
  stateTitle: { fontFamily: ff('Montserrat', '600'), fontSize: 16, color: '#212121', marginTop: 10, textAlign: 'center', includeFontPadding: false },
  stateSub: { fontFamily: ff('Inter', '400'), fontSize: 13, color: '#7B7B7B', marginTop: 6, textAlign: 'center', lineHeight: 19, includeFontPadding: false },
});

export default StaffInviteAcceptSheet;
