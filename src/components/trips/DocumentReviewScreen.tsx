/**
 * DocumentReviewScreen — the operator approves what travelers sent.
 *
 * Organised BY TRAVELER, not by document type (Ohad, 30 Jul). An operator books
 * a flight for a person, so "is Maya ready?" is the question they actually have;
 * "are all the passports in?" is not.
 *
 * Three levels, one Modal:
 *   1. Everyone on the trip, people who need a decision first.
 *   2. One traveler's items.
 *   3. The document itself (DocumentViewer), with Approve / Ask again.
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
  ActivityIndicator,
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
import {
  approveDocuments,
  rejectDocument,
  type ReviewItem,
  type TravelerReview,
} from '../../services/trips/tripDocumentsService';
import { showErrorAlert } from '../../utils/friendlyError';

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
      return item.note ? `sent back — ${item.note}` : 'sent back';
    case 'overdue':
      return isUpload ? 'nothing sent — overdue' : 'not done — overdue';
    default:
      return isUpload ? 'nothing sent yet' : 'not done yet';
  }
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
   * Extra blocks under one traveler's documents — money, medical, and the
   * actions the operator can take on that person.
   *
   * A render prop rather than more props on this component: those blocks are
   * operator-business, this screen is about documents, and the Dashboard tab
   * already holds the money it would otherwise have to fetch a second time.
   */
  renderTravelerExtras?: (userId: string) => React.ReactNode;
}> = ({
  visible,
  onClose,
  loading,
  travelers,
  review,
  onChanged,
  initialUserId,
  renderTravelerExtras,
}) => {
  const insets = useSafeAreaInsets();
  const [openUserId, setOpenUserId] = useState<string | null>(initialUserId ?? null);

  // Re-target on each open. Without the `visible` guard this would also yank
  // the operator back to the initial traveler when they tap Back inside an
  // already-open screen.
  useEffect(() => {
    if (visible) setOpenUserId(initialUserId ?? null);
  }, [visible, initialUserId]);
  const [viewing, setViewing] = useState<ReviewItem | null>(null);
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

  const close = useCallback(() => {
    setOpenUserId(null);
    setViewing(null);
    setRejecting(null);
    onClose();
  }, [onClose]);

  const handleApprove = useCallback(async () => {
    if (!viewing?.documentId || busy) return;
    setBusy(true);
    try {
      await approveDocuments([viewing.documentId]);
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

  const openItem = useCallback((item: ReviewItem) => {
    // Only an upload has anything to open. A waiver or medical row is a fact,
    // not a document.
    if (item.reqType === 'acknowledge' || item.kind === 'medical') return;
    if (!item.storagePath || item.fileDeleted) {
      Alert.alert('No longer available', 'This file has been deleted.');
      return;
    }
    setViewing(item);
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
            : openUserId
            ? () => setOpenUserId(null)
            : close
        }
        statusBarTranslucent
        {...(Platform.OS === 'android' ? { navigationBarTranslucent: true } : {})}
      >
        <View style={[styles.root, { paddingTop: insets.top }]}>
          <View style={styles.header}>
            <Pressable
              onPress={openUserId ? () => setOpenUserId(null) : close}
              hitSlop={12}
              style={styles.headerBtn}
            >
              <Ionicons
                name={openUserId ? 'chevron-back' : 'close'}
                size={openUserId ? 24 : 26}
                color="#212121"
              />
            </Pressable>
            <View style={styles.headerText}>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {openTraveler ? openTraveler.name ?? 'Traveler' : 'Review documents'}
              </Text>
              <Text style={styles.headerSub} numberOfLines={1}>
                {openReview
                  ? `${openReview.done} of ${openReview.total} done`
                  : totalToReview > 0
                  ? `${totalToReview} waiting for you`
                  : 'Nothing waiting'}
              </Text>
            </View>
            <View style={styles.headerBtn} />
          </View>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator />
            </View>
          ) : (
            <ScrollView
              contentContainerStyle={[
                styles.body,
                { paddingBottom: Math.max(insets.bottom, 16) + 24 },
              ]}
            >
              {/* ── Level 2: one traveler's items ───────────────────────── */}
              {openReview ? (
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
                        onPress={viewable ? () => openItem(item) : undefined}
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
                      return (
                        <Pressable
                          key={t.userId}
                          onPress={() => setOpenUserId(t.userId)}
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
                              {r ? `${r.done} of ${r.total} done` : 'nothing yet'}
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
          storagePath={viewing?.storagePath ?? null}
          title={viewing?.title ?? 'Document'}
          // A decision is only offered while there is one to make. An already
          // approved file stays viewable, read-only.
          onApprove={viewing?.state === 'submitted' ? handleApprove : undefined}
          onReject={viewing?.state === 'submitted' ? () => setRejecting(viewing) : undefined}
          busy={busy}
          // This screen is the host's, so export belongs here and nowhere a
          // traveler can reach. See the note on `allowExport`.
          allowExport
          // Offer "Copy details" on passports only. The operator retypes these
          // into a flight booking, which is the whole reason we hold a passport
          // at all — see passport-upload-v1.md §1.
          isPassport={viewing?.kind === 'passport'}
          travelerName={openTraveler?.name ?? null}
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
