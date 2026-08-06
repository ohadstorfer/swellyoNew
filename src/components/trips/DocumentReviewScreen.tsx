/**
 * DocumentReviewScreen — the operator approves what travelers sent.
 *
 * Organised BY TRAVELER, not by document type (Ohad, 30 Jul). An operator books
 * a flight for a person, so "is Maya ready?" is the question they actually have;
 * "are all the passports in?" is not.
 *
 * Three levels, one Modal:
 *   1. Everyone on the trip, people who need a decision first.
 *   2. One traveler's items — OR one requirement across every traveler.
 *   3. The document itself (DocumentViewer), with Approve / Ask again.
 *
 * Level 2 has TWO shapes because there are two honest ways to ask the question,
 * and the Dashboard offers both doors (Ohad, 5 Aug). "Is Maya ready?" opens the
 * traveler shape; tapping "Passport" in the Documents card opens the requirement
 * shape — every traveler's passport, one row each. Level 3 is the same viewer
 * either way, so approving from one door behaves exactly like the other.
 *
 * Only UPLOADS are approvable. A waiver is agreed to and a medical form is
 * filled in — both are self-completing, so this shows them as facts and offers
 * no decision. Pretending otherwise would leave the host tapping Approve on
 * something the RPCs cannot record.
 *
 * Nothing here caches a signed URL: the viewer mints its own, per open, and the
 * list never renders a thumbnail. A row of passport thumbnails would mean a
 * signed URL per row and a decrypted copy in the image cache, which is exactly
 * what the private bucket exists to prevent.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Modal,
  ScrollView,
  Platform,
  Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Thumb from '../Thumb';
import { Images } from '../../assets/images';
import { TripIcon } from './tripIcons';
import { DOC_ICON } from './plan/PlanSections';
import { DocumentViewer } from './DocumentViewer';
import { RejectDocumentSheet } from './RejectDocumentSheet';
import { ff } from '../../theme/fonts';
import { plural } from './dashboard/dashboardFormat';
import {
  approveDocuments,
  rejectDocument,
  type ReviewItem,
  type TravelerReview,
} from '../../services/trips/tripDocumentsService';
import { showErrorAlert } from '../../utils/friendlyError';
import { SkeletonBase } from '../skeletons/SkeletonPrimitives';

export type ReviewTraveler = {
  userId: string;
  name: string | null;
  avatarUrl: string | null;
};

/** "sent 2 days ago" — a review queue is about how long someone has waited. */
function sentAgo(iso: string | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** The one line under an item's title. Says what happened, not what the state
 *  is called — "agreed 3 days ago" beats "approved". */
function itemSubtitle(item: ReviewItem): string {
  const isUpload = item.reqType !== 'acknowledge' && item.kind !== 'medical';
  switch (item.state) {
    case 'submitted':
      return `sent ${sentAgo(item.submittedAt)}`;
    case 'approved':
      if (item.reqType === 'acknowledge') return `agreed ${sentAgo(item.submittedAt)}`;
      if (item.kind === 'medical') return `filled in ${sentAgo(item.submittedAt)}`;
      return `approved${item.fileDeleted ? ' · file deleted' : ''}`;
    case 'rejected':
      // Says what is TRUE of it now, not just what was done to it. Sending a
      // document back deletes the file, so there is nothing left to open and
      // the row is not tappable — without this line that reads as a dead row.
      return item.note
        ? `sent back — ${item.note} · waiting for a new one`
        : 'sent back · waiting for a new one';
    case 'overdue':
      return isUpload ? 'nothing sent — overdue' : 'not done — overdue';
    default:
      return isUpload ? 'nothing sent yet' : 'not done yet';
  }
}

/**
 * The header line under a requirement's title: "2 of 3 in · 1 approved".
 *
 * Both numbers on an upload, deliberately — the same rule the Dashboard card
 * and the web dashboard follow. The gap between received and approved is the
 * OPERATOR's backlog, and printing only "approved" would make their own
 * unfinished work read as a traveler who has not sent anything.
 *
 * A waiver has no such gap (agreeing IS the approval) and neither does a
 * medical form, so those get one number and the verb that actually happened.
 */
function requirementSummary(
  item: ReviewItem,
  received: number,
  approved: number,
  total: number,
): string {
  if (item.reqType === 'acknowledge') return `${approved} of ${total} agreed`;
  if (item.kind === 'medical') return `${approved} of ${total} filled in`;
  return `${received} of ${total} in · ${approved} approved`;
}

/**
 * What is waiting on one traveler, BY NAME — "Travel insurance", not "1 item".
 *
 * The queue used to read "sababa · 1 of 7 done · [1 to review]", which says
 * that there is work and refuses to say what it is (Ohad, 5 Aug). An operator
 * chasing one specific document had to open every person to find out who it
 * was sitting behind.
 *
 * Two names at most, then a count. Three titles do not fit a phone row and the
 * third one is not the reason anybody taps.
 */
function waitingNames(r: TravelerReview | undefined): string | null {
  const names = (r?.items ?? []).filter(i => i.state === 'submitted').map(i => i.title);
  if (names.length === 0) return null;
  if (names.length <= 2) return names.join(', ');
  return `${names[0]}, ${names[1]} +${names.length - 2}`;
}

const ItemIcon: React.FC<{ kind: string }> = ({ kind }) =>
  kind === 'passport' ? (
    <TripIcon name="passport" size={20} color="#333333" strokeWidth={1.4} />
  ) : (
    <Ionicons name={DOC_ICON[kind] ?? 'document-outline'} size={19} color="#333333" />
  );

const Avatar: React.FC<{ uri: string | null }> = ({ uri }) =>
  uri ? (
    <Thumb uri={uri} size={96} style={styles.avatar} contentFit="cover" cachePolicy="memory-disk" />
  ) : (
    <Image source={Images.defaultAvatar} style={styles.avatar} contentFit="cover" />
  );

/**
 * The list, drawn in grey, while the real one is being fetched.
 *
 * Reuses `styles.card` / `styles.row` rather than approximating them, so the
 * rows land at the height and rhythm the real rows will occupy and the swap is
 * a fill rather than a reflow. A spinner in the middle of an empty screen said
 * nothing about what was coming and moved everything when it arrived.
 *
 * Row count is fixed at four: enough to read as a list, few enough that a trip
 * with two travelers does not visibly shrink.
 */
const ReviewListSkeleton: React.FC<{ round: boolean }> = ({ round }) => (
  <View style={styles.body}>
    <View style={styles.card}>
      {[0, 1, 2, 3].map(i => (
        <View key={i} style={[styles.row, i === 3 && styles.rowLast]}>
          <SkeletonBase width={36} height={36} borderRadius={round ? 18 : 8} />
          <View style={styles.rowText}>
            {/* Widths vary per row so it reads as names, not as a table. */}
            <SkeletonBase width={`${52 + i * 9}%`} height={13} />
            <SkeletonBase width={`${34 + i * 6}%`} height={11} />
          </View>
        </View>
      ))}
    </View>
  </View>
);

/**
 * What level 2 is showing. Exactly one of these, or null for the traveler root.
 *
 * `root` means the operator LANDED here — the caller opened the screen straight
 * into it — rather than drilling down from the traveler list. It is what Back
 * reads: from a landed level 2 there is no screen behind, so Back leaves, and
 * from a drilled-into one it goes up. Without it, tapping "1 document waiting
 * for you" and immediately backing out walked through a traveler list the
 * operator had never seen (Ohad, 5 Aug).
 */
type Level2 =
  | { kind: 'traveler'; userId: string; root?: boolean }
  | { kind: 'requirement'; requirementId: string; root?: boolean }
  | { kind: 'waiting'; root?: boolean }
  | null;

/** Which door the caller asked for. Person, then document, then the queue. */
function initialLevel2(
  userId: string | null | undefined,
  requirementId: string | null | undefined,
  waiting: boolean | undefined,
): Level2 {
  if (userId) return { kind: 'traveler', userId, root: true };
  if (requirementId) return { kind: 'requirement', requirementId, root: true };
  if (waiting) return { kind: 'waiting', root: true };
  return null;
}

export const DocumentReviewScreen: React.FC<{
  visible: boolean;
  onClose: () => void;
  loading: boolean;
  travelers: ReviewTraveler[];
  review: TravelerReview[];
  /** Refetch after a decision — every state is derived server-side. */
  onChanged: () => void;
  /**
   * Open straight into one person instead of the queue.
   *
   * The Dashboard's Travelers list needs "show me Maya", not "show me the
   * queue and let me find Maya". Read on each open, so tapping a different
   * traveler re-targets it.
   */
  initialUserId?: string | null;
  /**
   * Open straight into one REQUIREMENT — every traveler's passport, say.
   *
   * The other door into level 2. Set by the Dashboard's Documents card, where
   * the operator has just tapped the word "Passport" and means it: showing them
   * the traveler queue instead would make them hunt for the thing they named.
   *
   * Ignored when `initialUserId` is also set — a caller that passes both has a
   * bug, and picking the person is the safer half to honour.
   */
  initialRequirementId?: string | null;
  /**
   * Open straight into EVERYTHING that needs a decision, across every document
   * type and every traveler.
   *
   * The third door, and the one the "N documents waiting for you" banner uses.
   * It used to open the traveler queue, which is a list of people — so a banner
   * counting documents landed on a screen that named none of them and included
   * everyone who was not the point (Ohad, 5 Aug).
   *
   * Lowest priority of the three: a caller naming a person or a document meant
   * that specific thing.
   */
  initialWaiting?: boolean;
  /**
   * Extra blocks under one traveler's documents — money, medical, and the
   * actions the operator can take on that person.
   *
   * A render prop rather than more props on this component: those blocks are
   * operator-business, this screen is about documents, and the Dashboard tab
   * already holds the money it would otherwise have to fetch a second time.
   */
  renderTravelerExtras?: (userId: string) => React.ReactNode;
  /**
   * Anything the CALLER needs to present ON TOP of this screen — rendered as
   * the last child inside this Modal.
   *
   * It exists because a sheet the caller renders as a sibling of this Modal is
   * not merely mis-stacked, it is DEAD: RN presents from the nearest view
   * controller above it in the tree, which for a sibling is the root — already
   * busy presenting this one. UIKit refuses, RN marks it presented anyway, and
   * the sheet only appears once this screen is dismissed. That is exactly what
   * "Set price" did (Ohad, 5 August: "el bottom sheet con los precios abrió
   * después de salir de la pantalla del usuario").
   *
   * Whatever goes in here must render as a LAYER, not a Modal — pass `inline`.
   * See the note on the reject sheet below for why a second Modal is not the
   * fix either.
   */
  renderOverlay?: () => React.ReactNode;
}> = ({
  visible,
  onClose,
  loading,
  travelers,
  review,
  onChanged,
  initialUserId,
  initialRequirementId,
  initialWaiting,
  renderTravelerExtras,
  renderOverlay,
}) => {
  const insets = useSafeAreaInsets();
  // ONE piece of state for level 2, not three booleans. Level 2 is a person, a
  // requirement, or the waiting queue — exactly one at a time — and a union
  // makes "exactly one" the type's problem rather than three setters that have
  // to remember to clear each other.
  const [level2, setLevel2] = useState<Level2>(() =>
    initialLevel2(initialUserId, initialRequirementId, initialWaiting),
  );

  // Re-target on each open. Without the `visible` guard this would also yank
  // the operator back to the initial traveler when they tap Back inside an
  // already-open screen.
  useEffect(() => {
    if (!visible) return;
    setLevel2(initialLevel2(initialUserId, initialRequirementId, initialWaiting));
  }, [visible, initialUserId, initialRequirementId, initialWaiting]);

  const openUserId = level2?.kind === 'traveler' ? level2.userId : null;
  const openRequirementId = level2?.kind === 'requirement' ? level2.requirementId : null;
  const waitingMode = level2?.kind === 'waiting';

  // The viewer needs to name the traveler whose file it is showing, and from
  // the requirement door that is NOT the traveler who is "open" — there isn't
  // one. So the owner rides along with the item rather than being inferred.
  const [viewing, setViewing] = useState<{ item: ReviewItem; userId: string } | null>(null);
  const [rejecting, setRejecting] = useState<ReviewItem | null>(null);
  const [busy, setBusy] = useState(false);

  const byUser = useMemo(() => {
    const m = new Map<string, TravelerReview>();
    review.forEach(r => m.set(r.userId, r));
    return m;
  }, [review]);

  // People who need a decision, then people still missing things, then the
  // finished. A review queue should put the work at the top.
  const ordered = useMemo(() => {
    const rank = (t: ReviewTraveler) => {
      const r = byUser.get(t.userId);
      if (!r) return 2;
      if (r.toReview > 0) return 0;
      return r.done === r.total ? 2 : 1;
    };
    return [...travelers].sort(
      (a, b) => rank(a) - rank(b) || (a.name ?? '').localeCompare(b.name ?? ''),
    );
  }, [travelers, byUser]);

  const totalToReview = review.reduce((n, r) => n + r.toReview, 0);
  const openTraveler = openUserId ? travelers.find(t => t.userId === openUserId) ?? null : null;
  const openReview = openUserId ? byUser.get(openUserId) ?? null : null;

  /**
   * Level 2, requirement shape: one row per traveler, for the one requirement.
   *
   * Built from `travelers` rather than from `review`, so a traveler whose
   * review row failed to load still appears — as "nothing sent yet", which is
   * what an operator chasing a missing passport needs to see. Anyone the trip
   * does not ask for this document is dropped entirely.
   */
  const requirementRows = useMemo(() => {
    if (!openRequirementId) return null;
    const rows: { traveler: ReviewTraveler; item: ReviewItem }[] = [];
    for (const t of travelers) {
      const item = byUser.get(t.userId)?.items.find(i => i.requirementId === openRequirementId);
      if (item) rows.push({ traveler: t, item });
    }
    // Work first, then problems, then the finished — the same shape as the
    // traveler queue, so the eye lands in the same place through either door.
    const rank = (i: ReviewItem) =>
      i.state === 'submitted' ? 0
      : i.state === 'rejected' || i.state === 'overdue' ? 1
      : i.state === 'approved' ? 3
      : 2;
    return rows.sort(
      (a, b) =>
        rank(a.item) - rank(b.item) ||
        (a.traveler.name ?? '').localeCompare(b.traveler.name ?? ''),
    );
  }, [openRequirementId, travelers, byUser]);

  // A requirement that no traveler is asked for has no rows and therefore no
  // title to show. Falling back to level 1 beats an empty screen headed
  // "Document" — it can only happen if the requirement was deleted under us.
  const openRequirement = requirementRows?.[0]?.item ?? null;

  /**
   * Level 2, waiting shape: everything the operator has to act on, whoever
   * sent it and whatever it is.
   *
   * `submitted` AND a document id together are what "actionable" means — a
   * waiver agreed to has neither, and a rejected item is back with the
   * traveler. It is the same rule `toReview` counts by, which is what keeps
   * this list's length equal to the number on the banner that opened it.
   */
  const waitingRows = useMemo(() => {
    if (!waitingMode) return null;
    const rows: { traveler: ReviewTraveler; item: ReviewItem }[] = [];
    for (const t of travelers) {
      for (const item of byUser.get(t.userId)?.items ?? []) {
        if (item.state === 'submitted' && item.documentId) rows.push({ traveler: t, item });
      }
    }
    // Oldest first. A queue is about who has been kept waiting — the passport
    // sent last week outranks the one sent this morning.
    return rows.sort((a, b) =>
      (a.item.submittedAt ?? '').localeCompare(b.item.submittedAt ?? ''),
    );
  }, [waitingMode, travelers, byUser]);

  const nameOf = useCallback(
    (userId: string) => travelers.find(t => t.userId === userId)?.name ?? null,
    [travelers],
  );

  const close = useCallback(() => {
    setLevel2(null);
    setViewing(null);
    setRejecting(null);
    onClose();
  }, [onClose]);

  /**
   * Back: undo the last thing the operator did, not "up the hierarchy".
   *
   * Drilled in from the traveler list → up to it. Landed on this level from the
   * Dashboard → leave, because the level above was never on screen and showing
   * it on the way out is a screen nobody asked for.
   */
  const goBack = useCallback(() => {
    if (level2?.root === true || !level2) close();
    else setLevel2(null);
  }, [level2, close]);

  // `waitingMode`, not `waitingRows.length` — approving the last document must
  // leave the operator on an empty queue that says so, not drop them back to
  // the traveler list mid-tap.
  const inLevel2 = !!openReview || !!openRequirement || waitingMode;

  const handleApprove = useCallback(async () => {
    if (!viewing?.item.documentId || busy) return;
    setBusy(true);
    try {
      await approveDocuments([viewing.item.documentId]);
      setViewing(null);
      onChanged();
    } catch (e) {
      console.error('[DocumentReview] approve failed:', e);
      showErrorAlert('Could not approve', e, 'Please try again.');
    } finally {
      setBusy(false);
    }
  }, [viewing, busy, onChanged]);

  const handleReject = useCallback(
    async (note: string) => {
      if (!rejecting?.documentId || busy) return;
      setBusy(true);
      try {
        await rejectDocument(
          { id: rejecting.documentId, storagePath: rejecting.storagePath ?? '' },
          note.trim() || undefined,
        );
        setRejecting(null);
        setViewing(null);
        onChanged();
      } catch (e) {
        console.error('[DocumentReview] reject failed:', e);
        showErrorAlert('Could not send it back', e, 'Please try again.');
      } finally {
        setBusy(false);
      }
    },
    [rejecting, busy, onChanged],
  );

  const openItem = useCallback((item: ReviewItem, userId: string) => {
    // Only an upload has anything to open. A waiver or medical row is a fact,
    // not a document.
    if (item.reqType === 'acknowledge' || item.kind === 'medical') return;
    if (!item.storagePath || item.fileDeleted) {
      Alert.alert('No longer available', 'This file has been deleted.');
      return;
    }
    setViewing({ item, userId });
  }, []);

  return (
    <>
      <Modal
        visible={visible}
        animationType="slide"
        // Android back, innermost first. The viewer and the reject sheet are
        // LAYERS inside this Modal, not Modals of their own, so this is the only
        // handler they get — without the two extra branches, back would close the
        // whole review screen out from under an open document.
        onRequestClose={
          rejecting
            ? () => setRejecting(null)
            : viewing
            ? () => setViewing(null)
            : goBack
        }
        statusBarTranslucent
        {...(Platform.OS === 'android' ? { navigationBarTranslucent: true } : {})}
      >
        <View style={[styles.root, { paddingTop: insets.top }]}>
          <View style={styles.header}>
            <Pressable
              onPress={goBack}
              hitSlop={12}
              style={styles.headerBtn}
            >
              {/* A chevron whenever there is somewhere to go back TO — which
                  from a landed level 2 is the Dashboard row that opened it, not
                  a screen inside here. The X is for the traveler root, the one
                  place where back and dismiss are the same thing. */}
              <Ionicons
                name={inLevel2 ? 'chevron-back' : 'close'}
                size={inLevel2 ? 24 : 26}
                color="#212121"
              />
            </Pressable>
            <View style={styles.headerText}>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {waitingMode
                  ? 'Waiting for you'
                  : openRequirement
                  ? openRequirement.title
                  : openTraveler
                  ? openTraveler.name ?? 'Traveler'
                  : 'Review documents'}
              </Text>
              <Text style={styles.headerSub} numberOfLines={1}>
                {waitingRows
                  ? waitingRows.length === 0
                    ? 'Nothing to review'
                    : `${plural(waitingRows.length, 'document')} across ${plural(
                        new Set(waitingRows.map(r => r.traveler.userId)).size,
                        'traveler',
                      )}`
                  : openRequirement && requirementRows
                  ? requirementSummary(
                      openRequirement,
                      requirementRows.filter(
                        r => r.item.state === 'submitted' || r.item.state === 'approved',
                      ).length,
                      requirementRows.filter(r => r.item.state === 'approved').length,
                      requirementRows.length,
                    )
                  : openReview
                  ? `${openReview.done} of ${openReview.total} done`
                  : totalToReview > 0
                  ? `${totalToReview} waiting for you`
                  : 'Nothing waiting'}
              </Text>
            </View>
            <View style={styles.headerBtn} />
          </View>

          {loading ? (
            // Round leading shape for the traveler queue (avatars), square for
            // one traveler's items (document icons).
            <ReviewListSkeleton round={!openUserId} />
          ) : (
            <ScrollView
              contentContainerStyle={[
                styles.body,
                { paddingBottom: Math.max(insets.bottom, 16) + 24 },
              ]}
            >
              {/* ── Level 2c: everything waiting, whoever sent it ───────── */}
              {waitingRows ? (
                <View style={styles.card}>
                  {waitingRows.length === 0 ? (
                    <View style={[styles.row, styles.rowLast]}>
                      <Text style={styles.empty}>
                        Nothing waiting for you. Every document travelers have sent has
                        been dealt with.
                      </Text>
                    </View>
                  ) : (
                    waitingRows.map(({ traveler, item }, i) => {
                      // Every row here is an actionable upload by construction,
                      // so there is no unviewable case to guard and no state to
                      // print — "Review" says it, once per row, on the right.
                      const isLast = i === waitingRows.length - 1;
                      return (
                        <Pressable
                          // A traveler can be waiting on several documents, so
                          // the key is the document, not the person.
                          key={item.documentId ?? `${traveler.userId}-${item.requirementId}`}
                          onPress={() => openItem(item, traveler.userId)}
                          style={({ pressed }) => [
                            styles.row,
                            isLast && styles.rowLast,
                            pressed && styles.rowPressed,
                          ]}
                        >
                          <Avatar uri={traveler.avatarUrl} />
                          <View style={styles.rowText}>
                            <Text style={styles.rowTitle} numberOfLines={1}>
                              {traveler.name ?? 'Traveler'}
                            </Text>
                            {/* What it is, then when it arrived — the two the
                                web's Document and When columns carry. */}
                            <Text style={styles.rowSub} numberOfLines={1}>
                              {item.title} · sent {sentAgo(item.submittedAt)}
                            </Text>
                          </View>
                          <Text style={styles.pillAccent}>Review</Text>
                        </Pressable>
                      );
                    })
                  )}
                </View>
              ) : /* ── Level 2b: one requirement, everyone ───────────────── */
              openRequirement && requirementRows ? (
                <View style={styles.card}>
                  {requirementRows.map(({ traveler, item }, i) => {
                    const reviewable = item.state === 'submitted' && !!item.documentId;
                    const viewable =
                      item.reqType !== 'acknowledge' &&
                      item.kind !== 'medical' &&
                      !!item.storagePath &&
                      !item.fileDeleted;
                    const isLast = i === requirementRows.length - 1;
                    return (
                      <Pressable
                        key={traveler.userId}
                        onPress={viewable ? () => openItem(item, traveler.userId) : undefined}
                        disabled={!viewable}
                        style={({ pressed }) => [
                          styles.row,
                          isLast && styles.rowLast,
                          pressed && styles.rowPressed,
                        ]}
                      >
                        {/* The person, not the document type — every row here
                            IS this document type, so repeating its icon seven
                            times would carry no information. */}
                        <Avatar uri={traveler.avatarUrl} />
                        <View style={styles.rowText}>
                          <Text style={styles.rowTitle} numberOfLines={1}>
                            {traveler.name ?? 'Traveler'}
                          </Text>
                          <Text
                            style={[
                              styles.rowSub,
                              (item.state === 'overdue' || item.state === 'rejected') &&
                                styles.rowSubBad,
                            ]}
                            numberOfLines={2}
                          >
                            {itemSubtitle(item)}
                          </Text>
                        </View>
                        {reviewable ? (
                          <Text style={styles.pillAccent}>Review</Text>
                        ) : item.state === 'approved' ? (
                          <Ionicons name="checkmark-circle" size={20} color="#34C759" />
                        ) : viewable ? (
                          <Ionicons name="chevron-forward" size={18} color="#C9C9C9" />
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              ) : /* ── Level 2: one traveler's items ────────────────────── */
              openReview ? (
                <>
                <View style={styles.card}>
                  {openReview.items.map((item, i) => {
                    const reviewable = item.state === 'submitted' && !!item.documentId;
                    const viewable =
                      item.reqType !== 'acknowledge' &&
                      item.kind !== 'medical' &&
                      !!item.storagePath &&
                      !item.fileDeleted;
                    const isLast = i === openReview.items.length - 1;
                    return (
                      <Pressable
                        key={item.requirementId}
                        onPress={viewable ? () => openItem(item, openReview.userId) : undefined}
                        disabled={!viewable}
                        style={({ pressed }) => [
                          styles.row,
                          isLast && styles.rowLast,
                          pressed && styles.rowPressed,
                        ]}
                      >
                        <ItemIcon kind={item.kind} />
                        <View style={styles.rowText}>
                          <Text style={styles.rowTitle} numberOfLines={1}>
                            {item.title}
                          </Text>
                          <Text
                            style={[
                              styles.rowSub,
                              (item.state === 'overdue' || item.state === 'rejected') &&
                                styles.rowSubBad,
                            ]}
                            numberOfLines={2}
                          >
                            {itemSubtitle(item)}
                          </Text>
                        </View>
                        {reviewable ? (
                          <Text style={styles.pillAccent}>Review</Text>
                        ) : item.state === 'approved' ? (
                          <Ionicons name="checkmark-circle" size={20} color="#34C759" />
                        ) : viewable ? (
                          <Ionicons name="chevron-forward" size={18} color="#C9C9C9" />
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
                {/* Money, medical and the per-person actions. Supplied by the
                    Dashboard tab; absent everywhere else, which is what keeps
                    this screen usable on its own. */}
                {renderTravelerExtras?.(openReview.userId)}
                </>
              ) : (
                /* ── Level 1: everyone ─────────────────────────────────── */
                <View style={styles.card}>
                  {ordered.length === 0 ? (
                    <View style={[styles.row, styles.rowLast]}>
                      <Text style={styles.empty}>No travelers on this trip yet.</Text>
                    </View>
                  ) : (
                    ordered.map((t, i) => {
                      const r = byUser.get(t.userId);
                      const waiting = (r?.toReview ?? 0) > 0;
                      const complete = !!r && r.done === r.total && r.total > 0;
                      const isLast = i === ordered.length - 1;
                      // Names first, progress second. Whoever is at the top of
                      // this queue is there because something needs deciding,
                      // and "which one?" is the question they have; the ratio
                      // still rides along and truncates if it must.
                      const names = waitingNames(r);
                      const progress = r ? `${r.done} of ${r.total} done` : 'nothing yet';
                      return (
                        <Pressable
                          key={t.userId}
                          onPress={() => setLevel2({ kind: 'traveler', userId: t.userId })}
                          style={({ pressed }) => [
                            styles.row,
                            isLast && styles.rowLast,
                            pressed && styles.rowPressed,
                          ]}
                        >
                          <Avatar uri={t.avatarUrl} />
                          <View style={styles.rowText}>
                            <Text style={styles.rowTitle} numberOfLines={1}>
                              {t.name ?? 'Traveler'}
                            </Text>
                            <Text style={styles.rowSub} numberOfLines={1}>
                              {names ? `${names} · ${progress}` : progress}
                            </Text>
                          </View>
                          {waiting ? (
                            <Text style={styles.pillAccent}>
                              {r!.toReview} to review
                            </Text>
                          ) : complete ? (
                            <Ionicons name="checkmark-circle" size={20} color="#34C759" />
                          ) : (
                            <Ionicons name="chevron-forward" size={18} color="#C9C9C9" />
                          )}
                        </Pressable>
                      );
                    })
                  )}
                </View>
              )}
            </ScrollView>
          )}
        </View>

        {/* ── Level 3: the document itself ───────────────────────────────── */}
        {/* INSIDE this Modal, as a layer (`inline`), never as a Modal of its
            own. Two RN Modals presented at once is what strands an invisible
            view controller on iOS when they dismiss in overlapping frames —
            after which every touch on the screen underneath dies silently.
            Reproduced by: open a traveler's document, then go back to Plan.

            Stays mounted while the reject sheet is up; the sheet layers on top
            of it. */}
        <DocumentViewer
          inline
          visible={!!viewing}
          onClose={() => setViewing(null)}
          storagePath={viewing?.item.storagePath ?? null}
          title={viewing?.item.title ?? 'Document'}
          // A decision is only offered while there is one to make. An already
          // approved file stays viewable, read-only.
          onApprove={viewing?.item.state === 'submitted' ? handleApprove : undefined}
          onReject={
            viewing?.item.state === 'submitted' ? () => setRejecting(viewing.item) : undefined
          }
          busy={busy}
          // This screen is the host's, so export belongs here and nowhere a
          // traveler can reach. See the note on `allowExport`.
          allowExport
          // Offer "Copy details" on passports only. The operator retypes these
          // into a flight booking, which is the whole reason we hold a passport
          // at all — see passport-upload-v1.md §1.
          isPassport={viewing?.item.kind === 'passport'}
          // From the requirement door there is no "open traveler", so the name
          // comes off the item's own owner. Same answer through both doors.
          travelerName={viewing ? nameOf(viewing.userId) : null}
        />

        {/* INSIDE this Modal, and as a LAYER (`inline`), for two separate
            reasons — it used to be a sibling of the Modal below and was dead on
            iOS in both respects.

            Inside, because RN presents a Modal from the nearest view controller
            ABOVE it in the RN tree. A sibling of this Modal resolves to the root
            controller, which is already presenting this one, so UIKit refuses —
            and RN marks it presented anyway and never retries. "Ask for a new
            one" simply did nothing, with no error and no log.

            A layer, because the fix for that must not be a second Modal: two of
            them dismissing in overlapping frames strand an invisible controller
            that swallows every touch on the screen underneath. Same rule the
            viewer above already follows.

            Last child, so it stacks over the viewer (zIndex 60 vs 50). */}
        <RejectDocumentSheet
          inline
          visible={!!rejecting}
          onClose={() => setRejecting(null)}
          title={rejecting?.title ?? 'Document'}
          busy={busy}
          onSend={handleReject}
        />

        {/* The caller's own layers, over everything above. Same rules. */}
        {renderOverlay?.()}
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FAFAFA' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 12,
    paddingTop: 4,
  },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1, alignItems: 'center' },
  headerTitle: {
    fontFamily: ff('Inter', '700'),
    fontSize: 17,
    fontWeight: '700',
    color: '#212121',
  },
  headerSub: { fontFamily: ff('Inter', '400'), fontSize: 12, color: '#7B7B7B', marginTop: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 16 },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#EDEDEB',
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 64,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0EE',
  },
  rowLast: { borderBottomWidth: 0 },
  rowPressed: { backgroundColor: '#F4F4F2' },
  rowText: { flex: 1, gap: 2 },
  rowTitle: {
    fontFamily: ff('Inter', '600'),
    fontSize: 14,
    fontWeight: '600',
    color: '#212121',
  },
  rowSub: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 16, color: '#7B7B7B' },
  rowSubBad: { color: '#C4361E' },
  pillAccent: {
    fontFamily: ff('Inter', '600'),
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    color: '#05BCD3',
    backgroundColor: '#E4F8FB',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: 'hidden',
  },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#EFEFEF' },
  empty: {
    flex: 1,
    fontFamily: ff('Inter', '400'),
    fontSize: 13,
    color: '#7B7B7B',
    textAlign: 'center',
  },
});
