/**
 * ManageRequirementsSheet — the operator changes what a PUBLISHED trip asks for.
 *
 * The create wizard writes requirements once, on publish, and never looks at
 * them again. Everything an operator learns afterwards — a destination that
 * turns out to need a visa, a partner who wants insurance on file — had no way
 * in. This is that way in.
 *
 * Same shape as the wizard's Requirements step on purpose: one card per kind,
 * tap to switch it on, timing inside the card. An operator who published a trip
 * last week has seen this exact list once already, and re-learning it is not a
 * thing worth asking of them.
 *
 * Two things are different from the wizard, both because this edits live data:
 *
 * 1. Nothing is written until Save. A stepper tap is one edit of a draft, not a
 *    round trip; and the waiver PDF has to land before the requirement pointing
 *    at it exists, which only a single commit point can guarantee.
 * 2. Switching a requirement OFF asks first. Travelers are already looking at
 *    it, some of them have already sent something, and neither fact is visible
 *    from this sheet.
 *
 * What "off" actually does is decided in `removeRequirement` — a clean delete
 * when nothing has been sent, `is_active = false` once anything has. See there
 * for why the difference matters.
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
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheetShell } from '../BottomSheetShell';
import { FadeInView } from '../FadeInView';
import { TripIcon } from './tripIcons';
import { DOC_ICON, formatExactUsd } from './plan/PlanSections';
import { ff } from '../../theme/fonts';
import { showErrorAlert } from '../../utils/friendlyError';
import { formatFileSize } from '../../utils/videoValidation';
import {
  DEFAULT_TIMING,
  REQUIREMENT_CATALOG,
  REQUIREMENT_ORDER,
  fetchWaiver,
  isDeadlineAtEnd,
  isPayKind,
  publishWaiverPdf,
  resolveDeadlineDate,
  saveRequirementChanges,
  stepDeadline,
  type EditableRequirement,
  type RequirementKind,
  type RequirementTiming,
} from '../../services/trips/tripDocumentsService';
import { amountDue, type PayStep } from '../../services/trips/tripPaymentsService';

// The wizard's copy for `deposit` (`REQUIREMENT_CATALOG.deposit.operatorSub`)
// tells the operator to "leave the amount blank for one single payment" — an
// instruction about a field on the budget step that does not exist in this
// sheet. This editor only ever shows a pay row once it already has an amount
// (see the `kinds` filter below), so that sentence is never actionable here.
const PAY_KIND_EDITOR_SUB: Partial<Record<RequirementKind, string>> = {
  deposit: 'A first payment, collected when they join.',
};

type Draft = Record<string, RequirementTiming>;

/** Seed the draft from what the trip currently asks for. Inactive rows keep
 *  their stored timing so switching one back on restores what it used to say,
 *  rather than resetting it to the catalog default. */
function seedFrom(rows: EditableRequirement[]): {
  on: RequirementKind[];
  timing: Draft;
} {
  const on: RequirementKind[] = [];
  const timing: Draft = {};
  for (const kind of REQUIREMENT_ORDER) {
    const row = rows.find(r => r.kind === kind);
    timing[kind] = row
      ? { skippable: row.skippable, daysBefore: row.daysBefore }
      : { ...DEFAULT_TIMING[kind] };
    if (row?.isActive) on.push(kind);
  }
  return { on, timing };
}

export const ManageRequirementsSheet: React.FC<{
  visible: boolean;
  onClose: () => void;
  tripId: string;
  /** The trip's exact departure date, or null on a months-only trip. Deadlines
   *  are stored relative to it, so with no date there is no real date to show. */
  startDateISO: string | null;
  /** Every stored row, active or not — `useTripRequirements`. */
  requirements: EditableRequirement[];
  /** `hosting_style === 'C'`. Only an operator trip may CREATE a passport
   *  requirement — see `passportBlocked`. */
  isOperatorTrip: boolean;
  /** `trip?.payment_mode ?? 'offline'`. Pay rows (`deposit`, `balance`) only
   *  show here when the trip actually collects money — an offline trip has no
   *  active pay rows to edit, and showing the cards anyway would invite an
   *  operator to "turn one on" through a sheet that deliberately has no
   *  on/off toggle for them. See `isPayKind`. */
  paymentMode: 'offline' | 'managed';
  /** `trip?.cost_per_person ?? null`, `trip?.deposit_amount ?? null`. The
   *  TRIP's default price, not any one traveler's — this sheet has no
   *  traveler in view, so it is the only figure it can honestly show next to
   *  a pay row's deadline. */
  costPerPersonUsd: number | null;
  depositAmountUsd: number | null;
  /** Fires after a successful save, so the caller can invalidate its queries. */
  onSaved: () => void;
}> = ({
  visible,
  onClose,
  tripId,
  startDateISO,
  requirements,
  isOperatorTrip,
  paymentMode,
  costPerPersonUsd,
  depositAmountUsd,
  onSaved,
}) => {
  const insets = useSafeAreaInsets();
  // The cap has to be a NUMBER. `maxHeight: '88%'` resolves against the parent,
  // and BottomSheetShell wraps children in auto-height views — so a percentage
  // is silently ignored and the sheet grows to its full content height, which
  // for six cards is taller than the screen. Same fix as InviteMembersSheet.
  const { height: windowHeight } = useWindowDimensions();
  const maxSheetHeight = Math.round(windowHeight * 0.85);

  const [on, setOn] = useState<RequirementKind[]>([]);
  const [timing, setTiming] = useState<Draft>({});
  const [saving, setSaving] = useState(false);
  // null = not looked yet. Distinguishing "no waiver published" from "we have
  // not checked" is what stops the sheet demanding a PDF the trip already has.
  const [hasWaiver, setHasWaiver] = useState<boolean | null>(null);
  const [waiverFile, setWaiverFile] = useState<{
    uri: string;
    name: string;
    size: number;
  } | null>(null);
  const [waiverError, setWaiverError] = useState<string | null>(null);
  // Has the operator changed anything yet? Only used to decide whether a late
  // refetch is allowed to reseed — see below.
  const [dirty, setDirty] = useState(false);

  // Reseed on every open. The sheet is a draft OF the server rows, so opening it
  // on last time's draft would silently re-apply an edit the operator abandoned.
  //
  // It also reseeds when `requirements` changes UNDER an untouched sheet. The
  // caller refetches on open, so the rows can land a beat after the sheet paints;
  // without this the operator would be looking at yesterday's toggles while Save
  // diffs against today's rows, and a change made on another device would be
  // silently reverted. Once they have touched anything, their draft wins — a
  // background refetch must never move a switch under someone's finger.
  useEffect(() => {
    if (!visible || dirty) return;
    const seed = seedFrom(requirements);
    setOn(seed.on);
    setTiming(seed.timing);
    setWaiverFile(null);
    setWaiverError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, requirements, dirty]);

  useEffect(() => {
    if (!visible) setDirty(false);
  }, [visible]);

  // Only worth a round trip once the sheet is open, and only once per open.
  useEffect(() => {
    if (!visible) {
      setHasWaiver(null);
      return;
    }
    let cancelled = false;
    fetchWaiver(tripId)
      .then(w => {
        if (!cancelled) setHasWaiver(!!w);
      })
      .catch(() => {
        if (!cancelled) setHasWaiver(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, tripId]);

  const activeByKind = useMemo(() => {
    const m = new Map<string, EditableRequirement>();
    for (const r of requirements) if (r.isActive) m.set(r.kind, r);
    return m;
  }, [requirements]);

  /**
   * Does a waiver PDF already exist? An ACTIVE waiver requirement is proof on its
   * own — the only paths that create one upload a document first.
   *
   * That matters because the lookup can fail. Reading a failed lookup as "no
   * waiver" would show "Upload a PDF" for a waiver the trip already has, and an
   * operator who obliges publishes a NEW version, which asks every traveler who
   * had already agreed to agree again. A network blip must not cost that.
   */
  const waiverOnFile = hasWaiver === true || activeByKind.has('waiver');

  /**
   * Can the passport card be switched on at all?
   *
   * `trg_passport_requires_operator_trip` refuses to INSERT a passport
   * requirement unless the trip is `hosting_style = 'C'`, and it raises a raw
   * Postgres exception — so an ungated toggle here is a Save that fails with a
   * message no operator can act on.
   *
   * It only fires on INSERT and on UPDATE OF kind/trip_id, so a passport row
   * that ALREADY exists stays fully editable on any trip: switching it off and
   * back on takes the update branch, never the insert branch. That is why this
   * looks at every stored row and not just the active ones.
   */
  const passportBlocked =
    !isOperatorTrip && !requirements.some(r => r.kind === 'passport');

  // Money rows are not toggled here. Turning off collection is a trip-level
  // decision (payment_mode), and deleting a pay row with payments against it
  // would strand ledger history pointing at nothing. So they only belong in
  // this list at all when the trip is actually collecting money.
  //
  // `paymentMode === 'managed'` alone is NOT enough: the wizard publishes
  // `deposit` only when an amount was entered, `balance` alone otherwise (the
  // "leave the amount blank for one single payment" flow deposit's own copy
  // advertises). Gating on mode only would show a working Deposit card — with
  // real timing pills and a stepper — on a managed trip that never created a
  // deposit row, and Save would silently no-op: `saveRequirementChanges`'s pay
  // branch bails on `!row`. Requiring a real, ACTIVE row closes that, and
  // closes the same gap for a row a `payment_mode` trigger has deactivated —
  // unreachable today (nothing switches offline back to managed), but this
  // guard does not depend on that staying true.
  const kinds = useMemo(
    () =>
      REQUIREMENT_ORDER.filter(
        k =>
          !isPayKind(k) ||
          (paymentMode === 'managed' && requirements.some(r => r.kind === k && r.isActive)),
      ),
    [paymentMode, requirements],
  );

  const setKindTiming = useCallback(
    (kind: RequirementKind, patch: Partial<RequirementTiming>) => {
      setDirty(true);
      setTiming(prev => ({
        ...prev,
        [kind]: { ...(prev[kind] ?? DEFAULT_TIMING[kind]), ...patch },
      }));
    },
    [],
  );

  const toggle = useCallback(
    (kind: RequirementKind) => {
      const isOn = on.includes(kind);
      setDirty(true);
      if (!isOn) {
        setOn(prev => [...prev, kind]);
        setWaiverError(null);
        return;
      }
      const off = () => setOn(prev => prev.filter(k => k !== kind));
      // A kind that was never saved is just an un-tick — nobody has seen it.
      if (!activeByKind.has(kind)) {
        off();
        return;
      }
      const title = REQUIREMENT_CATALOG[kind].operatorTitle;
      // Removing a passport from a NON-operator trip is a one-way door: the row
      // goes, and `trg_passport_requires_operator_trip` will not let a new one
      // be created on an A/B trip. Say so before it happens, not after — the
      // locked card afterwards explains the state but cannot undo it.
      const oneWay = kind === 'passport' && !isOperatorTrip;
      Alert.alert(
        `Stop asking for ${title.toLowerCase()}?`,
        oneWay
          ? 'Travelers will no longer see it on their plan. Anything they already sent you stays on the trip.\n\nThis trip is not an organised trip, so you will not be able to ask for a passport again.'
          : 'Travelers will no longer see it on their plan. Anything they already sent you stays on the trip.',
        [
          { text: 'Keep it', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: off },
        ],
      );
    },
    [on, activeByKind, isOperatorTrip],
  );

  const pickWaiverFile = useCallback(async () => {
    try {
      const DocumentPicker = require('expo-document-picker');
      const res = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
        multiple: false,
      });
      const asset = !res.canceled ? res.assets?.[0] : null;
      if (asset?.uri) {
        setDirty(true);
        setWaiverFile({
          uri: asset.uri,
          name: asset.name ?? 'waiver.pdf',
          size: asset.size ?? 0,
        });
        setWaiverError(null);
      }
    } catch (e) {
      console.error('[ManageRequirements] waiver picker failed:', e);
      showErrorAlert('Something went wrong', e, 'Could not open your files. Please try again.');
    }
  }, []);

  const handleSave = useCallback(async () => {
    if (saving) return;

    const wantsWaiver = on.includes('waiver');

    // A waiver requirement with no waiver document can never be completed:
    // `operator_trip_my_requirements` only counts an agreement against the
    // CURRENT version, so with no version there is nothing to agree to.
    //
    // `!waiverOnFile` covers the still-loading case too: the lookup fires on open
    // and resolves long before anyone reaches Save, and blocking is much cheaper
    // than shipping a requirement nobody can ever complete.
    if (wantsWaiver && !waiverFile && !waiverOnFile) {
      setWaiverError('Upload the waiver PDF travelers will agree to.');
      return;
    }

    setSaving(true);
    try {
      // The document first, for the same reason the wizard does it in this
      // order — a waiver requirement that goes live before its PDF is a
      // requirement travelers can see and cannot complete.
      //
      // Only when the waiver is actually staying on. Picking a PDF and then
      // switching the waiver off would otherwise publish a new version — and
      // `purge-group-documents` skips the operator prefix entirely, so nothing
      // would ever clean it up.
      if (waiverFile && wantsWaiver) await publishWaiverPdf(tripId, waiverFile.uri);

      // `on` already contains every pay kind visible here: `seedFrom` pushes
      // any ACTIVE row it finds regardless of whether that kind has a toggle,
      // and a pay kind only ever appears in `kinds` (so only ever gets
      // rendered, so only ever gets edited) when its row is active — see the
      // `kinds` guard above. This union is a defensive backstop, not the
      // primary path: it makes a timing edit on a pay row reach
      // `saveRequirementChanges` even if that "active row implies present in
      // `on`" assumption ever stops holding. `!on.includes(k)` just avoids
      // listing an already-present kind twice.
      const draftKinds = [...on, ...kinds.filter(k => isPayKind(k) && !on.includes(k))];

      await saveRequirementChanges(
        tripId,
        requirements,
        draftKinds.map(kind => ({
          kind,
          timing: timing[kind] ?? DEFAULT_TIMING[kind],
        })),
      );
      onSaved();
      onClose();
    } catch (e) {
      console.error('[ManageRequirements] save failed:', e);
      showErrorAlert('Could not save', e, 'Your changes were not saved. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [saving, on, kinds, timing, waiverFile, waiverOnFile, tripId, requirements, onSaved, onClose]);

  // The real date a deadline lands on. Months-only trips have no exact start
  // date, so there is nothing honest to show — say so instead of inventing one.
  const deadlineLabel = (daysBefore: number) => {
    const due = resolveDeadlineDate(startDateISO, daysBefore);
    if (!due) return 'Set exact dates to see the date';
    return due.toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  // The trip's DEFAULT price — never a traveler's, since no traveler is in
  // view here. Mirrors `TravelerPrices` so `amountDue` can be reused as-is.
  const payDefaults = useMemo(
    () => ({ totalUsd: costPerPersonUsd, depositUsd: depositAmountUsd }),
    [costPerPersonUsd, depositAmountUsd],
  );

  // Pay rows sort first (REQUIREMENT_ORDER), so on a paid trip they are the
  // first thing an operator sees under this header — "Documents" reads like a
  // mislabeled screen at that point.
  const hasPayRows = kinds.some(isPayKind);

  return (
    <BottomSheetShell visible={visible} onClose={onClose}>
      {({ panHandlers }) => (
        <View
          style={[
            styles.surface,
            { maxHeight: maxSheetHeight, paddingBottom: Math.max(insets.bottom, 12) },
          ]}
        >
          <View {...panHandlers} style={styles.grabWrap}>
            <View style={styles.grabber} />
            <Text style={styles.title}>{hasPayRows ? 'Documents & payments' : 'Documents'}</Text>
            <Text style={styles.sub}>
              {hasPayRows
                ? 'What you ask travelers to send — and pay'
                : 'What you ask travelers to send you'}
            </Text>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollBody}
            keyboardShouldPersistTaps="handled"
            // Left ON deliberately. Only about three of the six cards fit, and
            // with the bar hidden there is nothing on screen saying the other
            // three exist — an operator would conclude visa and flights are not
            // offered. Cosmetics lose to discoverability here.
          >
            {kinds.map(kind => {
              const c = REQUIREMENT_CATALOG[kind];
              // Pay rows have no toggle to switch off, so they read as
              // permanently "on" — their card always shows the timing
              // controls, there is just nothing to tap in the header.
              const noToggle = isPayKind(kind);
              const isOn = noToggle || on.includes(kind);
              const t = timing[kind] ?? DEFAULT_TIMING[kind];
              const locked = kind === 'passport' && passportBlocked;
              return (
                <View
                  key={kind}
                  style={[styles.reqCard, isOn && styles.reqCardOn, locked && styles.reqCardOff]}
                >
                  <Pressable
                    onPress={() => toggle(kind)}
                    disabled={locked || noToggle}
                    // Tint on press, not scale: the border belongs to the parent
                    // card, so scaling this row would read as the content
                    // shrinking inside a fixed frame.
                    style={({ pressed }) => [
                      styles.reqHeader,
                      pressed &&
                        !locked &&
                        !noToggle &&
                        (isOn ? styles.reqHeaderPressedOn : styles.reqHeaderPressed),
                    ]}
                    // A pay row's header is not disabled — its timing controls
                    // below still work — only the toggle press is a no-op, and
                    // there is no toggle state left to announce once the role
                    // is 'text' rather than 'checkbox'.
                    accessibilityRole={noToggle ? 'text' : 'checkbox'}
                    accessibilityState={noToggle ? undefined : { checked: isOn, disabled: locked }}
                  >
                    <View style={styles.reqIconWrap}>
                      {kind === 'passport' ? (
                        <TripIcon name="passport" size={22} color="#212121" strokeWidth={1.5} />
                      ) : (
                        <Ionicons name={DOC_ICON[kind]} size={21} color="#212121" />
                      )}
                    </View>
                    <View style={styles.reqBody}>
                      <Text style={styles.reqTitle}>{c.operatorTitle}</Text>
                      <Text style={styles.reqSub}>
                        {locked
                          ? 'Only on operator trips. Change this trip to an organised trip to ask for it.'
                          : (noToggle && PAY_KIND_EDITOR_SUB[kind]) || c.operatorSub}
                      </Text>
                      {/* The trip's DEFAULT amount — every other card here
                          describes itself; a pay row asking to set a deadline
                          with no figure in sight does not. Never a traveler's
                          own amount: no traveler is in view on this sheet. */}
                      {noToggle ? (
                        <Text style={styles.reqAmount}>
                          {(() => {
                            const due = amountDue(kind as PayStep, payDefaults);
                            return due != null
                              ? formatExactUsd(due)
                              : 'Set a price on the budget step to see the amount';
                          })()}
                        </Text>
                      ) : null}
                    </View>
                    {locked ? (
                      <Ionicons name="lock-closed" size={16} color="#9A9A9A" style={styles.reqLock} />
                    ) : noToggle ? null : (
                      <View style={[styles.reqCheck, isOn && styles.reqCheckOn]}>
                        {isOn ? <Ionicons name="checkmark" size={15} color="#FFFFFF" /> : null}
                      </View>
                    )}
                  </Pressable>

                  {isOn ? (
                    <FadeInView duration={180} translateY={4} style={styles.reqExpand}>
                      <View style={styles.reqDivider} />

                      <View style={styles.timingRow}>
                        <Pressable
                          onPress={() => setKindTiming(kind, { skippable: false })}
                          style={[styles.timingPill, !t.skippable && styles.timingPillOn]}
                        >
                          <Text
                            style={[
                              styles.timingPillText,
                              !t.skippable && styles.timingPillTextOn,
                            ]}
                          >
                            When they join
                          </Text>
                        </Pressable>
                        <Pressable
                          onPress={() => setKindTiming(kind, { skippable: true })}
                          style={[styles.timingPill, t.skippable && styles.timingPillOn]}
                        >
                          <Text
                            style={[
                              styles.timingPillText,
                              t.skippable && styles.timingPillTextOn,
                            ]}
                          >
                            They can skip
                          </Text>
                        </Pressable>
                      </View>

                      {t.skippable ? (
                        <View style={styles.daysRow}>
                          <Pressable
                            onPress={() =>
                              setKindTiming(kind, { daysBefore: stepDeadline(t.daysBefore, -1) })
                            }
                            disabled={isDeadlineAtEnd(t.daysBefore, -1)}
                            hitSlop={8}
                            style={({ pressed }) => [
                              styles.stepBtn,
                              isDeadlineAtEnd(t.daysBefore, -1) && styles.stepBtnOff,
                              pressed && styles.stepBtnPressed,
                            ]}
                          >
                            <Ionicons name="remove" size={16} color="#212121" />
                          </Pressable>
                          <View style={styles.daysLabel}>
                            <Text style={styles.daysValue}>
                              {t.daysBefore === 1
                                ? '1 day before the trip'
                                : `${t.daysBefore} days before the trip`}
                            </Text>
                            <Text style={styles.daysDate}>{deadlineLabel(t.daysBefore)}</Text>
                          </View>
                          <Pressable
                            onPress={() =>
                              setKindTiming(kind, { daysBefore: stepDeadline(t.daysBefore, 1) })
                            }
                            disabled={isDeadlineAtEnd(t.daysBefore, 1)}
                            hitSlop={8}
                            style={({ pressed }) => [
                              styles.stepBtn,
                              isDeadlineAtEnd(t.daysBefore, 1) && styles.stepBtnOff,
                              pressed && styles.stepBtnPressed,
                            ]}
                          >
                            <Ionicons name="add" size={16} color="#212121" />
                          </Pressable>
                        </View>
                      ) : (
                        <Text style={styles.timingHint}>No Skip button.</Text>
                      )}

                      {/* The waiver is the one requirement that needs something
                          FROM the operator. Uploading again publishes a new
                          version — travelers who agreed to the old one are asked
                          to agree again, which is the point of versioning it. */}
                      {kind === 'waiver' ? (
                        <View style={styles.waiverBox}>
                          <Text style={styles.waiverLabel}>Your waiver document</Text>

                          {waiverFile ? (
                            <View style={styles.waiverFileRow}>
                              <Ionicons name="document-text-outline" size={20} color="#212121" />
                              <View style={styles.waiverFileText}>
                                <Text style={styles.waiverFileName} numberOfLines={1}>
                                  {waiverFile.name}
                                </Text>
                                <Text style={styles.waiverFileSize}>
                                  {formatFileSize(waiverFile.size)}
                                </Text>
                              </View>
                              <Pressable onPress={pickWaiverFile} hitSlop={8}>
                                <Text style={styles.waiverReplace}>Change</Text>
                              </Pressable>
                            </View>
                          ) : waiverOnFile ? (
                            <View style={styles.waiverFileRow}>
                              <Ionicons name="checkmark-circle" size={20} color="#0E9F6E" />
                              <View style={styles.waiverFileText}>
                                <Text style={styles.waiverFileName} numberOfLines={1}>
                                  Waiver published
                                </Text>
                                <Text style={styles.waiverFileSize}>
                                  Travelers agree to this version
                                </Text>
                              </View>
                              <Pressable onPress={pickWaiverFile} hitSlop={8}>
                                <Text style={styles.waiverReplace}>Replace</Text>
                              </Pressable>
                            </View>
                          ) : (
                            <Pressable
                              onPress={pickWaiverFile}
                              style={({ pressed }) => [
                                styles.waiverPickBtn,
                                waiverError ? styles.waiverPickBtnError : null,
                                pressed && styles.waiverPickBtnPressed,
                              ]}
                            >
                              <Ionicons name="cloud-upload-outline" size={18} color="#212121" />
                              <Text style={styles.waiverPickText}>Upload a PDF</Text>
                            </Pressable>
                          )}

                          {waiverError ? (
                            <Text style={styles.waiverErrorText}>{waiverError}</Text>
                          ) : (
                            <Text style={styles.waiverHint}>
                              Replacing it asks everyone to agree again.
                            </Text>
                          )}
                        </View>
                      ) : null}
                    </FadeInView>
                  ) : null}
                </View>
              );
            })}

            <Text style={styles.footNote}>
              Removing a document hides it from travelers. Anything already sent stays with
              the trip until it is deleted 30 days after the trip ends.
            </Text>
          </ScrollView>

          {/* Pinned, not scrolled with the list — six cards are taller than the
              sheet, and a Save button you have to scroll to find is a Save
              button people think is missing. */}
          <View style={styles.footer}>
            <Pressable
              onPress={handleSave}
              disabled={saving}
              style={({ pressed }) => [
                styles.saveBtn,
                saving && styles.saveBtnDisabled,
                pressed && !saving && styles.saveBtnPressed,
              ]}
            >
              {saving ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.saveText}>Save</Text>
              )}
            </Pressable>
          </View>
        </View>
      )}
    </BottomSheetShell>
  );
};

const styles = StyleSheet.create({
  // maxHeight is applied inline, in pixels — see maxSheetHeight.
  surface: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  grabWrap: { alignItems: 'center', paddingTop: 10, paddingBottom: 12, gap: 4 },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E4E4E4',
    marginBottom: 6,
  },
  title: {
    fontFamily: ff('Inter', '700'),
    fontSize: 18,
    fontWeight: '700',
    color: '#212121',
  },
  sub: { fontFamily: ff('Inter', '400'), fontSize: 12, color: '#7B7B7B' },

  // flexShrink so the list gives up height to the pinned footer once the sheet
  // hits its cap. Without it the ScrollView keeps its full content height and
  // pushes Save off the bottom edge.
  scroll: { flexShrink: 1, borderTopWidth: 1, borderTopColor: '#EEEEEE' },
  scrollBody: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8, gap: 14 },

  // Card geometry mirrors the wizard's Requirements step exactly — an operator
  // has already learned this list once.
  reqCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E4E4E4',
    backgroundColor: '#FFFFFF',
    // Lets the expanded section's full-bleed divider stop at the rounded corner.
    overflow: 'hidden',
  },
  reqCardOn: { borderColor: '#05BCD3', backgroundColor: '#F4FDFE' },
  // Dimmed rather than hidden: "you cannot ask for this here" is information,
  // and a card that silently vanishes just looks like a missing feature.
  reqCardOff: { backgroundColor: '#FAFAFA', opacity: 0.65 },
  reqLock: { marginTop: 4 },
  reqHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 16,
  },
  reqHeaderPressed: { backgroundColor: '#F4F4F4' },
  reqHeaderPressedOn: { backgroundColor: '#E7F7F9' },
  reqExpand: { paddingHorizontal: 16, paddingBottom: 16, gap: 12 },
  reqDivider: {
    height: 1,
    marginHorizontal: -16,
    marginBottom: 4,
    backgroundColor: 'rgba(5,188,211,0.16)',
  },
  reqIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F3F3F3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reqBody: { flex: 1, gap: 3 },
  reqTitle: {
    fontFamily: ff('Inter', '600'),
    fontSize: 15,
    fontWeight: '600',
    color: '#212121',
  },
  reqSub: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 17, color: '#7B7B7B' },
  reqAmount: {
    fontFamily: ff('Inter', '600'),
    fontSize: 13,
    fontWeight: '600',
    color: '#0788B0',
    marginTop: 2,
  },
  reqCheck: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#D5D7DA',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  reqCheckOn: { backgroundColor: '#05BCD3', borderColor: '#05BCD3' },

  timingRow: { flexDirection: 'row', gap: 8 },
  timingPill: {
    flex: 1,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E4E4E4',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  timingPillOn: { backgroundColor: '#212121', borderColor: '#212121' },
  timingPillText: {
    fontFamily: ff('Inter', '600'),
    fontSize: 12,
    fontWeight: '600',
    color: '#555555',
  },
  timingPillTextOn: { color: '#FFFFFF' },
  timingHint: { fontFamily: ff('Inter', '400'), fontSize: 11, lineHeight: 16, color: '#9A9A9A' },
  daysRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E7F1F3',
    backgroundColor: '#FFFFFF',
  },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3F3F3',
  },
  // 0.94 on press — the button is small, so the scale has to be deeper than a
  // full-width control's to read at all.
  stepBtnPressed: { backgroundColor: '#E6E6E6', transform: [{ scale: 0.94 }] },
  stepBtnOff: { backgroundColor: '#FAFAFA', opacity: 0.5 },
  daysLabel: { flex: 1, alignItems: 'center' },
  daysValue: {
    fontFamily: ff('Inter', '600'),
    fontSize: 13,
    fontWeight: '600',
    color: '#212121',
  },
  daysDate: { fontFamily: ff('Inter', '400'), fontSize: 11, color: '#7B7B7B', marginTop: 1 },

  waiverBox: { gap: 8 },
  waiverLabel: {
    fontFamily: ff('Inter', '600'),
    fontSize: 12,
    fontWeight: '600',
    color: '#212121',
  },
  waiverPickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#D5D7DA',
    backgroundColor: '#FFFFFF',
  },
  waiverPickBtnError: { borderColor: '#C4361E' },
  waiverPickBtnPressed: { backgroundColor: '#F6F6F6', transform: [{ scale: 0.985 }] },
  waiverPickText: {
    fontFamily: ff('Inter', '600'),
    fontSize: 14,
    fontWeight: '600',
    color: '#212121',
  },
  waiverFileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E4E4E4',
    backgroundColor: '#FFFFFF',
  },
  waiverFileText: { flex: 1, gap: 1 },
  waiverFileName: {
    fontFamily: ff('Inter', '600'),
    fontSize: 13,
    fontWeight: '600',
    color: '#212121',
  },
  waiverFileSize: { fontFamily: ff('Inter', '400'), fontSize: 11, color: '#7B7B7B' },
  waiverReplace: {
    fontFamily: ff('Inter', '600'),
    fontSize: 13,
    fontWeight: '600',
    color: '#05BCD3',
  },
  waiverErrorText: { fontFamily: ff('Inter', '400'), fontSize: 11, color: '#C4361E' },
  waiverHint: { fontFamily: ff('Inter', '400'), fontSize: 11, lineHeight: 16, color: '#9A9A9A' },

  footNote: {
    fontFamily: ff('Inter', '400'),
    fontSize: 12,
    lineHeight: 17,
    color: '#9A9A9A',
    paddingHorizontal: 4,
    marginTop: 4,
  },

  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 4,
    borderTopWidth: 1,
    borderTopColor: '#EEEEEE',
    backgroundColor: '#FFFFFF',
  },
  saveBtn: {
    height: 48,
    borderRadius: 24,
    backgroundColor: '#212121',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnDisabled: { opacity: 0.45 },
  saveBtnPressed: { opacity: 0.85 },
  saveText: {
    fontFamily: ff('Inter', '600'),
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
