/**
 * DocumentReviewScreen — the operator approves what travelers sent.
 *
 * Organised BY TRAVELER, not by document type (Ohad, 30 Jul). An operator books
 * a flight for a person, so "is Maya ready?" is the question they actually have;
 * "are all the passports in?" is not.
 *
 * Organised BY DOCUMENT since the Figma redesign (Ohad, 14 Sep — frames
 * 14980-66552 / -66698 / 14981-68385 / 14980-67220). Four steps, one Modal:
 *   1. Documents — every requirement, "Passport 2/3 approved".
 *   2. One requirement across every traveler — totals, filters, and a
 *      "Send reminder" on each person who has not sent it.
 *   3. One traveler's file — preview, facts, Approve / Request Resubmission.
 *   4. The file full screen (DocumentViewer), read-only, from the expand button.
 *
 * The traveler shape and the waiting queue below are still reachable through
 * `initialUserId` / `initialWaiting`; nothing on the Dashboard opens them today.
 *
 * Level 3 is the same screen whichever list opened it, so approving from one
 * door behaves exactly like the other.
 *
 * Only UPLOADS are approvable. A waiver is agreed to and a medical form is
 * filled in — both are self-completing, so this shows them as facts and offers
 * no decision. Pretending otherwise would leave the host tapping Approve on
 * something the RPCs cannot record.
 *
 * Nothing here caches a signed URL: the preview and the viewer each mint their
 * own, per open, and no LIST ever renders a thumbnail. A row of passport thumbnails would mean a
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
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Thumb from '../Thumb';
import { Images } from '../../assets/images';
import { TripIcon } from './tripIcons';
import { DOC_ICON } from './plan/PlanSections';
import { DocumentViewer } from './DocumentViewer';
import { RejectDocumentSheet } from './RejectDocumentSheet';
import { PressableScale } from './PressableScale';
import { ff } from '../../theme/fonts';
import { plural } from './dashboard/dashboardFormat';
import {
  approveDocuments,
  rejectDocument,
  remindTravelerRequirement,
  type ReviewItem,
  type TravelerReview,
} from '../../services/trips/tripDocumentsService';
import {
  DarkHeader,
  DocumentDetail,
  DocumentsList,
  HeaderPill,
  RequirementPeople,
  canOpenFile,
  type PeopleFilter,
  type PersonRow,
  type RequirementSummary,
} from './documents/DocumentReviewParts';
import {
  exportDocumentsAsZip,
  shareSingleDocument,
  safeFileName as exportSafeName,
  CAN_EXPORT,
  EXPORT_MAX_FILES,
  type ExportFile,
} from '../../services/trips/exportService';
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

/** Level 3 offers a decision on an upload that is waiting or approved. A file
 *  already sent back has nothing left to decide on. */
function isUploadDecidable(item: ReviewItem): boolean {
  return canOpenFile(item) && (item.state === 'submitted' || item.state === 'approved');
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
  /** Only for "Remind everyone who still owes this" — see `remind` below. */
  tripId: string;
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
  /**
   * May this viewer decide? `docs.approve` in the capability set. Everything
   * stays readable without it (that is `docs.view`, which gates the mount in
   * the caller) — but Approve, Ask again and Remind disappear, because a
   * button the server will refuse is worse than no button. Defaults to true
   * so existing host callers do not change.
   */
  canApprove?: boolean;
}> = ({
  visible,
  onClose,
  tripId,
  loading,
  travelers,
  review,
  onChanged,
  initialUserId,
  initialRequirementId,
  initialWaiting,
  renderTravelerExtras,
  renderOverlay,
  canApprove = true,
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

  useEffect(() => {
    if (!visible) return;
    setDetail(null);
  }, [visible]);

  const openUserId = level2?.kind === 'traveler' ? level2.userId : null;
  const openRequirementId = level2?.kind === 'requirement' ? level2.requirementId : null;
  const waitingMode = level2?.kind === 'waiting';

  // A filter chosen on one document must not follow you into the next.
  useEffect(() => {
    setFilter('all');
  }, [openRequirementId]);

  useEffect(
    () => () => {
      const paths = sharedPaths.current;
      sharedPaths.current = [];
      if (paths.length === 0) return;
      const FileSystem = require('expo-file-system/legacy');
      paths.forEach(p =>
        FileSystem.deleteAsync(p, { idempotent: true }).catch(() => {
          // Best effort — the OS reclaims its cache directory.
        }),
      );
    },
    [],
  );

  // The viewer needs to name the traveler whose file it is showing, and from
  // the requirement door that is NOT the traveler who is "open" — there isn't
  // one. So the owner rides along with the item rather than being inferred.
  const [viewing, setViewing] = useState<{ item: ReviewItem; userId: string } | null>(null);
  /** Level 3: one traveler's file. By ids, not by item, so an approval that
   *  refetches the review re-renders it in its new state. */
  const [detail, setDetail] = useState<{ userId: string; requirementId: string } | null>(null);
  const [rejecting, setRejecting] = useState<ReviewItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<PeopleFilter>('all');
  // Per-person reminders, keyed `${requirementId}:${userId}`. What the server
  // said is kept for the session so the row stops offering a second push.
  const [reminded, setReminded] = useState<Record<string, 'sending' | 'sent' | 'skipped'>>({});
  const [downloading, setDownloading] = useState(false);
  /** Files handed to the share sheet from level 3. Deleted when this closes —
   *  not when the share resolves; see shareSingleDocument. */
  const sharedPaths = React.useRef<string[]>([]);

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
   * Export what is on screen — one traveler's documents, or one document type
   * across everyone. Product Specs §"Manage trip": "export all docs."
   *
   * NOT the whole trip. Decision D4, 4 Sep 2026: JSZip builds the archive in
   * memory, and sixty phone photos is how a mid-range Android kills the app.
   * The trip-wide export streams to disk in the operator dashboard, which is
   * where it stays. See exportService's header.
   *
   * Same `canApprove` gate the single-file export in DocumentViewer uses — a
   * traveler never reaches this screen, but the rule is worth stating once
   * rather than assumed twice.
   */
  const [exportingZip, setExportingZip] = useState<string | null>(null);

  const runExport = useCallback(
    async (files: ExportFile[], zipName: string, key: string) => {
      if (exportingZip || files.length === 0) return;
      setExportingZip(key);
      try {
        const res = await exportDocumentsAsZip(files, zipName, (done, total) =>
          setExportingZip(`${key}:${done}/${total}`),
        );
        if (res.failed > 0 || res.trimmed) {
          // Said after the share sheet, not instead of it: the archive is
          // real and already in their hands. This explains what is not in it.
          Alert.alert(
            'Some files are missing',
            [
              res.failed > 0
                ? `${plural(res.failed, 'file')} could not be downloaded.`
                : null,
              res.trimmed
                ? `Only the first ${EXPORT_MAX_FILES} were included. Use the operator dashboard on a computer for the rest.`
                : null,
            ]
              .filter(Boolean)
              .join(' '),
          );
        }
      } catch (e) {
        showErrorAlert('Could not export', e, 'Could not package those documents.');
      } finally {
        setExportingZip(null);
      }
    },
    [exportingZip],
  );

  /** Only rows that still have a file behind them. A waiver signature and a
   *  medical form are rows, not documents, and there is nothing to put in a
   *  zip for them. */
  const exportableOf = (items: { item: ReviewItem; name: string | null }[]): ExportFile[] =>
    items
      .filter(
        ({ item }) =>
          !!item.storagePath && !item.fileDeleted && item.kind !== 'medical',
      )
      .map(({ item, name }) => ({
        storagePath: item.storagePath as string,
        name: exportSafeName([name, item.title].filter(Boolean).join(' - ')),
        isPdf: /\.pdf$/i.test(item.storagePath ?? ''),
      }));

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

  /**
   * Level 1: one line per requirement — approved of everyone asked (Ohad,
   * 14 Sep). Pay rows are money, not documents, and the review data cannot even
   * tell who paid (see fetchTripReview), so they are left out.
   */
  const requirementSummaries = useMemo<RequirementSummary[]>(() => {
    const out = new Map<string, RequirementSummary>();
    for (const t of travelers) {
      for (const item of byUser.get(t.userId)?.items ?? []) {
        if (item.reqType === 'pay') continue;
        const row = out.get(item.requirementId) ?? {
          requirementId: item.requirementId,
          title: item.title,
          kind: item.kind,
          approved: 0,
          total: 0,
        };
        row.total += 1;
        if (item.state === 'approved') row.approved += 1;
        out.set(item.requirementId, row);
      }
    }
    return [...out.values()];
  }, [travelers, byUser]);

  const detailRow = useMemo<PersonRow | null>(() => {
    if (!detail) return null;
    const traveler = travelers.find(t => t.userId === detail.userId);
    const item = byUser.get(detail.userId)?.items.find(i => i.requirementId === detail.requirementId);
    return traveler && item ? { traveler, item } : null;
  }, [detail, travelers, byUser]);

  /** What the file is called in Mail or WhatsApp — never the storage key. */
  const fileNameOf = (row: PersonRow) =>
    `${exportSafeName([row.traveler.name, row.item.title].filter(Boolean).join(' - '))}.${
      /\.pdf$/i.test(row.item.storagePath ?? '') ? 'pdf' : 'jpg'
    }`;

  const shareDetailFile = useCallback(async () => {
    if (!detailRow?.item.storagePath || downloading) return;
    setDownloading(true);
    try {
      const uri = await shareSingleDocument({
        storagePath: detailRow.item.storagePath,
        name: [detailRow.traveler.name, detailRow.item.title].filter(Boolean).join(' - '),
        isPdf: /\.pdf$/i.test(detailRow.item.storagePath),
      });
      sharedPaths.current.push(uri);
    } catch (e) {
      // Never log the path or the raw error — either can carry the storage key.
      console.error('[DocumentReview] share failed');
      showErrorAlert('Could not export', e, 'Could not export this document.');
    } finally {
      setDownloading(false);
    }
  }, [detailRow, downloading]);

  /**
   * Remind ONE traveler about this document.
   *
   * Confirmed first: it is a real push to a real phone, with no undo. The server
   * skips anyone reminded about this in the last day, and the row says which
   * of the two happened rather than claiming a send that did not go out.
   */
  const remindOne = useCallback(
    (row: PersonRow) => {
      const key = `${row.item.requirementId}:${row.traveler.userId}`;
      if (reminded[key]) return;
      const who = row.traveler.name ?? 'this traveler';
      Alert.alert(`Remind ${who}?`, `They get a notification to send “${row.item.title}”.`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send',
          onPress: async () => {
            setReminded(r => ({ ...r, [key]: 'sending' }));
            try {
              const n = await remindTravelerRequirement(
                tripId,
                row.item.requirementId,
                row.traveler.userId,
              );
              setReminded(r => ({ ...r, [key]: n > 0 ? 'sent' : 'skipped' }));
            } catch (e) {
              setReminded(r => {
                const { [key]: _drop, ...rest } = r;
                return rest;
              });
              showErrorAlert('Could not send the reminder', e, 'Please try again.');
            }
          },
        },
      ]);
    },
    [reminded, tripId],
  );

  const close = useCallback(() => {
    setLevel2(null);
    setDetail(null);
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
    if (detail) setDetail(null);
    else if (level2?.root === true || !level2) close();
    else setLevel2(null);
  }, [detail, level2, close]);


  const handleApprove = useCallback(async () => {
    const item = detailRow?.item;
    if (!item?.documentId || busy) return;
    setBusy(true);
    try {
      await approveDocuments([item.documentId]);
      // Stay on the file: the refetch redraws it as approved (Figma 14980-67220).
      onChanged();
    } catch (e) {
      console.error('[DocumentReview] approve failed:', e);
      showErrorAlert('Could not approve', e, 'Please try again.');
    } finally {
      setBusy(false);
    }
  }, [detailRow, busy, onChanged]);

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
        // Sending it back deletes the file, so there is nothing left to show.
        setDetail(null);
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
    if (!canOpenFile(item)) {
      Alert.alert('No longer available', 'This file has been deleted.');
      return;
    }
    setDetail({ userId, requirementId: item.requirementId });
  }, []);

  const headerTitle = detailRow
    ? detailRow.traveler.name ?? 'Traveler'
    : waitingMode
      ? 'Waiting for you'
      : openRequirement
        ? openRequirement.title
        : openTraveler
          ? openTraveler.name ?? 'Traveler'
          : 'Documents';

  /** Everything this document type has on file, for the header's Export all. */
  const requirementExport =
    !detailRow && openRequirement && requirementRows && CAN_EXPORT && canApprove
      ? exportableOf(requirementRows.map(r => ({ item: r.item, name: r.traveler.name })))
      : [];

  // The footer only exists on level 3, and only for someone who may decide.
  const footer =
    detailRow && canApprove && isUploadDecidable(detailRow.item) ? detailRow.item.state : null;

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
            : goBack // goBack steps out of level 3 first
        }
        statusBarTranslucent
        {...(Platform.OS === 'android' ? { navigationBarTranslucent: true } : {})}
      >
        <View style={styles.root}>
          {/* The dark header runs up under the status bar. */}
          <View style={[styles.statusBarFill, { height: insets.top }]} />
          <StatusBar barStyle="light-content" />
          <DarkHeader
            title={headerTitle}
            topInset={0}
            onBack={goBack}
            right={
              requirementExport.length > 0 && openRequirement ? (
                <HeaderPill
                  label={
                    exportingZip?.startsWith(`req:${openRequirement.requirementId}`)
                      ? `Packaging ${exportingZip.split(':')[2] ?? ''}…`
                      : 'Export all'
                  }
                  disabled={!!exportingZip}
                  onPress={() =>
                    runExport(
                      requirementExport,
                      `${openRequirement.title} (${requirementExport.length})`,
                      `req:${openRequirement.requirementId}`,
                    )
                  }
                />
              ) : null
            }
          />

          {loading ? (
            // Round leading shape for the traveler queue (avatars), square for
            // one traveler's items (document icons).
            <ReviewListSkeleton round={!openUserId} />
          ) : (
            <ScrollView
              contentContainerStyle={[
                styles.body,
                // Clear the footer's buttons when level 3 shows them.
                { paddingBottom: Math.max(insets.bottom, 16) + (footer ? 170 : 24) },
              ]}
            >
              {/* ── Level 3: one traveler's file ───────────────────────── */}
              {detailRow ? (
                <DocumentDetail
                  row={detailRow}
                  fileName={fileNameOf(detailRow)}
                  onExpand={() =>
                    setViewing({ item: detailRow.item, userId: detailRow.traveler.userId })
                  }
                  onDownload={CAN_EXPORT && canApprove ? shareDetailFile : undefined}
                  downloading={downloading}
                />
              ) :
              /* ── Level 2c: everything waiting, whoever sent it ───────── */
              waitingRows ? (
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
                <RequirementPeople
                  rows={requirementRows}
                  filter={filter}
                  onFilter={setFilter}
                  onOpen={row => openItem(row.item, row.traveler.userId)}
                  // Pay rows are refused by the server; see remindRequirement.
                  onRemind={canApprove && openRequirement.reqType !== 'pay' ? remindOne : undefined}
                  reminded={Object.fromEntries(
                    Object.entries(reminded)
                      .filter(([k]) => k.startsWith(`${openRequirement.requirementId}:`))
                      .map(([k, v]) => [k.split(':')[1], v]),
                  )}
                />
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
                {/* This person's whole file, as one archive. */}
                {CAN_EXPORT && canApprove
                  ? (() => {
                      const files = exportableOf(
                        openReview.items.map(item => ({ item, name: null })),
                      );
                      if (files.length === 0) return null;
                      const key = `trav:${openReview.userId}`;
                      const busy = exportingZip?.startsWith(key);
                      const who = openTraveler?.name ?? 'Traveler';
                      return (
                        <PressableScale
                          onPress={() => runExport(files, `${who} (${files.length})`, key)}
                          disabled={!!exportingZip}
                          style={styles.exportBtn}
                          accessibilityLabel={`Export ${who}'s documents`}
                        >
                          <Ionicons name="download-outline" size={15} color="#5A5A5A" />
                          <Text style={styles.exportText}>
                            {busy
                              ? `Packaging ${exportingZip?.split(':')[2] ?? ''}…`
                              : `Export their documents (${files.length})`}
                          </Text>
                        </PressableScale>
                      );
                    })()
                  : null}

                {/* Money, medical and the per-person actions. Supplied by the
                    Dashboard tab; absent everywhere else, which is what keeps
                    this screen usable on its own. */}
                {renderTravelerExtras?.(openReview.userId)}
                </>
              ) : (
                /* ── Level 1: every document ───────────────────────────── */
                <DocumentsList
                  rows={requirementSummaries}
                  onOpen={requirementId => setLevel2({ kind: 'requirement', requirementId })}
                />
              )}
            </ScrollView>
          )}

          {/* Level 3's decision, over a fade like the trip screen's Trip Chat. */}
          {footer ? (
            <View style={styles.footer} pointerEvents="box-none">
              <LinearGradient
                colors={['rgba(250,250,250,0)', 'rgba(250,250,250,0.85)', '#FAFAFA']}
                locations={[0, 0.35, 0.7]}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              />
              <View style={[styles.footerInner, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
                {footer === 'submitted' ? (
                  <Pressable
                    onPress={handleApprove}
                    disabled={busy}
                    style={({ pressed }) => [styles.cta, styles.ctaAccent, (pressed || busy) && styles.ctaDim]}
                    accessibilityRole="button"
                  >
                    {busy ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <Text style={styles.ctaText}>Approve document</Text>
                    )}
                  </Pressable>
                ) : CAN_EXPORT ? (
                  <Pressable
                    onPress={shareDetailFile}
                    disabled={downloading}
                    style={({ pressed }) => [styles.cta, styles.ctaBlack, (pressed || downloading) && styles.ctaDim]}
                    accessibilityRole="button"
                  >
                    {downloading ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <>
                        <TripIcon name="upload-01" size={24} color="#FFFFFF" strokeWidth={1.17} />
                        <Text style={styles.ctaText}>Export file</Text>
                      </>
                    )}
                  </Pressable>
                ) : null}
                {/* Allowed on an approved file too: the server's reject clears
                    the approval, deletes the file and tells the traveler. */}
                <Pressable
                  onPress={() => detailRow && setRejecting(detailRow.item)}
                  disabled={busy}
                  hitSlop={8}
                  accessibilityRole="button"
                >
                  <Text style={styles.ctaSecondary}>Request Resubmission</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>

        {/* ── Level 4: the file full screen ──────────────────────────────── */}
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
          // Read-only: the decision lives on level 3, under the facts it is
          // made from. This is only the full-size look (the expand button).
          // Export stays a host capability — see the note on `allowExport`.
          allowExport={canApprove}
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
  statusBarFill: { backgroundColor: '#212121' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 60 },
  footerInner: { paddingHorizontal: 40, gap: 16, alignItems: 'stretch' },
  cta: {
    height: 56,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 24,
  },
  ctaAccent: { backgroundColor: '#05BCD3' },
  ctaBlack: { backgroundColor: '#212121' },
  ctaDim: { opacity: 0.85 },
  ctaText: {
    fontFamily: ff('Montserrat', '600'),
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  // Size/md 14/18 (get_variable_defs on 14981:68554; the export says 18/22).
  ctaSecondary: {
    fontFamily: ff('Inter', '700'),
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
    color: '#333333',
    textAlign: 'center',
  },
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
  body: { paddingHorizontal: 16, paddingTop: 24 },
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
  remindBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    marginTop: 12,
    borderRadius: 12,
    backgroundColor: '#E4F8FB',
  },
  remindBtnText: {
    fontFamily: ff('Inter', '600'),
    fontSize: 14,
    fontWeight: '600',
    color: '#05BCD3',
  },
  // Quiet, outlined — an export takes files out of the product, so it should
  // not look like the primary thing to do on the screen.
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginTop: 14,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E4E4E4',
    backgroundColor: '#FFFFFF',
  },
  exportText: {
    fontFamily: ff('Inter', '500'),
    fontSize: 13.5,
    color: '#5A5A5A',
  },
  remindDoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 48,
    marginTop: 12,
    paddingHorizontal: 16,
  },
  remindDoneText: {
    fontFamily: ff('Inter', '400'),
    fontSize: 13,
    lineHeight: 18,
    color: '#1F7A4D',
    textAlign: 'center',
  },
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
