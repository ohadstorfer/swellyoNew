/**
 * StaffPaperworkScreen — the crew member's own side of "what do you need from
 * me": the task list a guide, driver or photographer works through.
 *
 * Spec: docs/staff-requirements-and-wallet-delivery-spec-and-plan.html, Part A,
 *       step A4.
 *
 * FOUR THINGS HERE ARE NOT STYLE CHOICES:
 *
 * 1. IT IS A NAVIGATOR SCREEN, NEVER A MODAL — same rule as
 *    TravelerOnboardingScreen. Two of its rows open OS pickers, and a picker
 *    launched while a Modal is tearing down hangs the main thread on PHPicker
 *    and the OS kills the app. RequirementUploadFlow's header documents the
 *    incident.
 *
 * 2. IT GATES NOTHING. A traveler with unmet requirements is not on the trip; a
 *    guide with unmet paperwork is flagged and nothing more. There is no
 *    "finish" button, no activation call, no deadline and no Skip — skipping
 *    only means leaving, and leaving costs them nothing. The operator hired
 *    this person and knows the situation.
 *
 * 3. IT IS A LIST, NOT A WALK. The traveler flow marches step by step because
 *    it is a gate being cleared in one sitting. Crew paperwork trickles in over
 *    weeks — the visa arrives, then the insurance — so the shape that fits is a
 *    list you come back to, with each row opening its own thing.
 *
 * 4. IT REUSES THE TRAVELER'S COMPONENTS AND TABLES. Upload, waiver and medical
 *    all go through the same screens and land in the same tables travelers use
 *    (see the migration header). A second fulfilment path would drift from the
 *    first, and the one used less would rot.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { WaiverStepInline } from '../../components/trips/WaiverStepInline';
import { MedicalFormSheet } from '../../components/trips/MedicalFormSheet';
import { RequirementUploadFlow } from '../../components/trips/RequirementUploadFlow';
import { ff } from '../../theme/fonts';
import { hapticLight, hapticSuccess, hapticError } from '../../utils/haptics';
import { friendlyErrorMessage, showErrorAlert } from '../../utils/friendlyError';
import { devResetOnboarding } from '../../services/trips/tripOnboardingService';
import {
  REQUIREMENT_CATALOG,
  actionForRequirement,
  type RequirementKind,
} from '../../services/trips/tripDocumentsService';
import {
  fetchMyStaffRequirements,
  fetchStaffRequirementsAsMe,
  ensureStaffRequirements,
  STAFF_REQUIREMENT_KINDS,
  type MyStaffRequirement,
  type StaffRequirementKind,
} from '../../services/trips/staffRequirementsService';

// The Plan tab's palette, same as the traveler flow — crew who also travel
// should not feel they changed apps between the two.
const C = {
  accent: '#05BCD3',
  ink: '#212121',
  muted: '#7B7B7B',
  faint: '#8A8A84',
  bg: '#FAFAFA',
  surface: '#FFFFFF',
  hairline: '#EFEFEF',
  border: '#E4E4E4',
  done: '#34C759',
  doneTint: '#E8F5EE',
} as const;

const KIND_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  passport: 'card-outline',
  visa: 'document-attach-outline',
  waiver: 'document-text-outline',
  medical: 'medkit-outline',
  insurance: 'shield-checkmark-outline',
  flights: 'airplane-outline',
  custom: 'document-outline',
};

/** What the dev shortcut seeds when the trip has no crew paperwork yet. The
 *  whole catalog minus `custom`, which needs a title typed by hand. */
const DEV_SEED_KINDS = STAFF_REQUIREMENT_KINDS.filter(
  k => k !== 'custom',
) as StaffRequirementKind[];

export default function StaffPaperworkScreen({
  tripId,
  userId,
  tripTitle,
  devMode = false,
  onClose,
}: {
  tripId: string;
  userId: string;
  tripTitle?: string | null;
  /**
   * Launched from the dev menu. Two differences, both explained on
   * `fetchStaffRequirementsAsMe`: the list is every crew requirement on the
   * trip rather than the ones assigned to me, and the header grows a Reset.
   * Never set on the real route.
   */
  devMode?: boolean;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();

  const [rows, setRows] = useState<MyStaffRequirement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** The row being worked on, and how. `waiver` takes over the whole screen —
   *  the document has to scroll itself, and a PDF inside the ScrollView below
   *  would be two nested scroll views, neither of which works. */
  const [open, setOpen] = useState<
    { how: 'upload' | 'medical' | 'waiver'; row: MyStaffRequirement } | null
  >(null);

  const load = useCallback(async () => {
    try {
      setRows(
        devMode
          ? await fetchStaffRequirementsAsMe(tripId, userId)
          : await fetchMyStaffRequirements(tripId),
      );
      setError(null);
    } catch (e) {
      setError(friendlyErrorMessage(e, 'We could not load your paperwork.'));
    } finally {
      setLoading(false);
    }
  }, [tripId, userId, devMode]);

  // ── Dev tools ────────────────────────────────────────────────────────────
  const [working, setWorking] = useState(false);

  /** Give the trip the standard crew paperwork, so there is something to walk.
   *  Real rows on a real trip — removable from the trip's requirement editor. */
  const seedRequirements = useCallback(async () => {
    setWorking(true);
    try {
      await ensureStaffRequirements(tripId, DEV_SEED_KINDS);
      setLoading(true);
      await load();
      hapticSuccess();
    } catch (e) {
      hapticError();
      showErrorAlert("Couldn't add them", e, 'Nothing was changed.');
    } finally {
      setWorking(false);
    }
  }, [tripId, load]);

  /** Clear my own evidence so the flow can be walked again. The same RPC the
   *  traveler dev flow uses: host-only, operator trips only, and it refuses
   *  outright if there is a live payment on the trip. */
  const resetMine = useCallback(() => {
    Alert.alert(
      'Reset this paperwork?',
      'Deletes YOUR waiver signature, medical form and uploaded documents on this trip, so the flow starts over. Live payments are never touched.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            setWorking(true);
            try {
              const summary = await devResetOnboarding(tripId, userId);
              setLoading(true);
              await load();
              hapticSuccess();
              Alert.alert(
                'Reset done',
                `Cleared ${summary.documents ?? 0} document(s), ${summary.acknowledgements ?? 0} waiver signature(s) and ${summary.medical ?? 0} medical form(s).`,
              );
            } catch (e) {
              hapticError();
              showErrorAlert('Could not reset', e, 'Nothing was changed.');
            } finally {
              setWorking(false);
            }
          },
        },
      ],
    );
  }, [tripId, userId, load]);

  useEffect(() => {
    void load();
  }, [load]);

  const outstanding = useMemo(() => rows.filter(r => !r.fulfilled), [rows]);
  const done = useMemo(() => rows.filter(r => r.fulfilled), [rows]);

  /** Re-derive from the server rather than flipping the row here — a save that
   *  silently failed must not paint itself as done. */
  const completed = useCallback(async () => {
    setOpen(null);
    hapticSuccess();
    await load();
  }, [load]);

  const openRow = (row: MyStaffRequirement) => {
    const action = actionForRequirement({ kind: row.kind, reqType: row.reqType });
    if (!action) return;
    hapticLight();
    if (action === 'agree') setOpen({ how: 'waiver', row });
    else if (action === 'medical') setOpen({ how: 'medical', row });
    else if (action === 'upload') setOpen({ how: 'upload', row });
    // 'pay' cannot occur: the database refuses a paying staff requirement
    // (organized_trip_req_staff_never_pays). Staff do not pay to work.
  };

  const header = (title: string, onBack: () => void, backLabel: string) => (
    <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
      <View style={styles.headerRow}>
        <Pressable
          onPress={onBack}
          style={styles.backRow}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={backLabel}
        >
          <Ionicons name="chevron-back" size={22} color={C.muted} />
          <Text style={styles.backText}>{backLabel}</Text>
        </Pressable>
        {/* Dev only, and on the far side of the header from Back — a
            destructive button does not belong under the thumb reaching to
            leave. Same placement as the traveler flow's Reset. */}
        {devMode ? (
          <Pressable
            onPress={resetMine}
            disabled={working}
            style={styles.resetBtn}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Reset this paperwork"
          >
            {working ? (
              <ActivityIndicator size="small" color="#C98A00" />
            ) : (
              <>
                <Ionicons name="refresh" size={13} color="#C98A00" />
                <Text style={styles.resetText}>Reset</Text>
              </>
            )}
          </Pressable>
        ) : null}
      </View>
      <Text style={styles.headerTitle}>{title}</Text>
    </View>
  );

  // ── The waiver reads inside this screen ──────────────────────────────────
  if (open?.how === 'waiver') {
    return (
      <View style={styles.screen}>
        {header(open.row.title, () => setOpen(null), 'Paperwork')}
        <View style={styles.waiverBody}>
          <Text style={styles.sub}>
            {open.row.helpText ?? 'Read it, then agree by typing your name.'}
          </Text>
          <WaiverStepInline
            tripId={tripId}
            requirementId={open.row.requirementId}
            agreed={open.row.fulfilled}
            onAgreed={completed}
          />
          <View style={{ height: Math.max(insets.bottom, 12) }} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {header('Your paperwork', onClose, 'Trip')}

      {loading ? (
        <View style={styles.centre}>
          <ActivityIndicator color={C.accent} />
        </View>
      ) : error ? (
        <View style={styles.centre}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.sub}>{error}</Text>
          <Pressable style={styles.retry} onPress={() => { setLoading(true); void load(); }}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : rows.length === 0 ? (
        <View style={styles.centre}>
          <View style={[styles.bigIcon, { backgroundColor: C.doneTint }]}>
            <Ionicons name="checkmark" size={26} color={C.done} />
          </View>
          <Text style={styles.title}>Nothing to send</Text>
          <Text style={styles.sub}>
            {tripTitle ? `${tripTitle} asks` : 'This trip asks'} nothing of you right now. If
            that changes, it'll show up here.
          </Text>
          {devMode ? (
            <Pressable style={styles.retry} onPress={seedRequirements} disabled={working}>
              {working ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.retryText}>Add the standard crew paperwork</Text>
              )}
            </Pressable>
          ) : null}
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {devMode ? (
            <View style={styles.devBanner}>
              <Ionicons name="construct-outline" size={15} color="#C98A00" />
              <Text style={styles.devBannerText}>
                Dev: showing every crew requirement on this trip, not just the ones assigned to
                you — an operator can't be crew on their own trip. Everything you tap is real
                and writes under your own account.
              </Text>
            </View>
          ) : null}
          <Text style={styles.eyebrow}>{tripTitle ?? 'Your trip'}</Text>
          <Text style={styles.title}>
            {outstanding.length === 0
              ? "That's everything"
              : 'Your operator needs these from you'}
          </Text>
          <Text style={styles.sub}>
            {outstanding.length === 0
              ? 'Everything they asked for is in. You can reopen any of it below.'
              : 'Nothing here blocks you from the trip — they just need it on file.'}
          </Text>

          <View style={styles.list}>
            {[...outstanding, ...done].map(row => {
              const catalog = REQUIREMENT_CATALOG[row.kind as RequirementKind];
              const openable = !!actionForRequirement({ kind: row.kind, reqType: row.reqType });
              return (
                <Pressable
                  key={row.requirementId}
                  onPress={openable ? () => openRow(row) : undefined}
                  disabled={!openable}
                  style={({ pressed }) => [styles.row, pressed && openable && styles.rowPressed]}
                >
                  <View style={[styles.rowIcon, row.fulfilled && styles.rowIconDone]}>
                    <Ionicons
                      name={row.fulfilled ? 'checkmark' : KIND_ICON[row.kind] ?? 'document-outline'}
                      size={15}
                      color={row.fulfilled ? C.done : C.ink}
                    />
                  </View>
                  <View style={styles.rowBody}>
                    <Text
                      style={[styles.rowTitle, row.fulfilled && styles.rowTitleDim]}
                      numberOfLines={1}
                    >
                      {row.title}
                    </Text>
                    <Text style={styles.rowSub} numberOfLines={2}>
                      {row.helpText ?? catalog?.helpText ?? ''}
                    </Text>
                  </View>
                  {row.fulfilled ? (
                    <View style={[styles.pill, styles.pillDone]}>
                      <Text style={[styles.pillText, styles.pillTextDone]}>Done</Text>
                    </View>
                  ) : openable ? (
                    <Ionicons name="chevron-forward" size={18} color="#C4C4C4" />
                  ) : (
                    // A kind this build has no screen for — a `custom` ask typed
                    // by the operator. Saying so beats a dead row that does
                    // nothing when tapped.
                    <Text style={styles.rowAside}>Ask them</Text>
                  )}
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.note}>
            Only the operator and the crew who run this trip can see what you send.
          </Text>
          <View style={{ height: Math.max(insets.bottom, 16) + 8 }} />
        </ScrollView>
      )}

      {/* Sheets. Mounted only while open, so nothing here fires a picker or a
          fetch on a screen the crew member is only reading. */}
      {open?.how === 'upload' ? (
        <RequirementUploadFlow
          visible
          onClose={() => setOpen(null)}
          tripId={tripId}
          requirementId={open.row.requirementId}
          userId={userId}
          kind={open.row.kind as RequirementKind}
          onUploaded={completed}
        />
      ) : null}

      {open?.how === 'medical' ? (
        <MedicalFormSheet
          visible
          onClose={() => setOpen(null)}
          tripId={tripId}
          userId={userId}
          onSaved={completed}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },

  header: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    backgroundColor: C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.hairline,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backRow: { flexDirection: 'row', alignItems: 'center', marginLeft: -6 },
  resetBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4 },
  resetText: {
    fontFamily: ff('Montserrat', '600'),
    fontSize: 12,
    color: '#C98A00',
    includeFontPadding: false,
  },
  devBanner: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#FDF6E3',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  devBannerText: {
    flex: 1,
    fontFamily: ff('Inter', '400'),
    fontSize: 12,
    lineHeight: 17,
    color: '#8A6D1F',
    includeFontPadding: false,
  },
  backText: {
    fontFamily: ff('Inter', '500'),
    fontSize: 14,
    color: C.muted,
    includeFontPadding: false,
  },
  headerTitle: {
    fontFamily: ff('Montserrat', '700'),
    fontSize: 18,
    color: C.ink,
    marginTop: 4,
    includeFontPadding: false,
  },

  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  bigIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },

  body: { paddingHorizontal: 20, paddingTop: 22 },
  waiverBody: { flex: 1, paddingHorizontal: 20, paddingTop: 18 },

  eyebrow: {
    fontFamily: ff('Inter', '500'),
    fontSize: 13,
    color: C.faint,
    includeFontPadding: false,
  },
  title: {
    fontFamily: ff('Montserrat', '700'),
    fontSize: 22,
    lineHeight: 29,
    color: C.ink,
    marginTop: 4,
    includeFontPadding: false,
  },
  sub: {
    fontFamily: ff('Inter', '400'),
    fontSize: 14,
    lineHeight: 21,
    color: C.muted,
    marginTop: 6,
    includeFontPadding: false,
  },

  list: { marginTop: 20, gap: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  rowPressed: { opacity: 0.75 },
  rowIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F2F3F5',
  },
  rowIconDone: { backgroundColor: C.doneTint },
  rowBody: { flex: 1 },
  rowTitle: {
    fontFamily: ff('Montserrat', '600'),
    fontSize: 15,
    color: C.ink,
    includeFontPadding: false,
  },
  rowTitleDim: { color: C.muted },
  rowSub: {
    fontFamily: ff('Inter', '400'),
    fontSize: 12.5,
    lineHeight: 17,
    color: C.muted,
    marginTop: 2,
    includeFontPadding: false,
  },
  rowAside: {
    fontFamily: ff('Inter', '400'),
    fontSize: 12,
    color: C.faint,
    includeFontPadding: false,
  },

  pill: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 10, backgroundColor: '#F2F3F5' },
  pillDone: { backgroundColor: C.doneTint },
  pillText: {
    fontFamily: ff('Montserrat', '600'),
    fontSize: 11,
    color: C.muted,
    includeFontPadding: false,
  },
  pillTextDone: { color: C.done },

  note: {
    fontFamily: ff('Inter', '400'),
    fontSize: 12,
    lineHeight: 18,
    color: C.faint,
    marginTop: 18,
    includeFontPadding: false,
  },

  retry: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: C.ink,
  },
  retryText: {
    fontFamily: ff('Montserrat', '600'),
    fontSize: 14,
    color: '#FFFFFF',
    includeFontPadding: false,
  },
});
