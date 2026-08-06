import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Image,
  ScrollView,
  ActivityIndicator,
  Alert,
  Animated,
  Platform,
  TextInput,
  KeyboardAvoidingView,
  Share,
  RefreshControl,
  type LayoutChangeEvent,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Reanimated, { FadeInUp, FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useOnboarding } from '../../context/OnboardingContext';
import {
  GroupTrip,
  EnrichedParticipant,
  EnrichedJoinRequest,
  GroupTripJoinRequest,
  GroupGearItem,
  PersonalGearItem,
  AdminUpdate,
  EnrichedGearItem,
  EnrichedGearRequest,
  TRIP_STRUCTURE_OPTIONS,
  TRIP_VIBE_OPTIONS,
  DESTINATION_FAMILIARITY_OPTIONS,
  STAY_FAMILIARITY_OPTIONS,
  listGearItems,
  addGearItem,
  updateGearItem,
  deleteGearItem,
  setMyGearClaim,
  listGearRequests,
  createGearRequest,
  approveGearRequest,
  declineGearRequest,
  getTripById,
  updateGroupTrip,
  getGroupTripInviteUrl,
  getTripParticipants,
  getMyJoinRequest,
  listPendingRequests,
  listDeclinedRequests,
  requestToJoinTrip,
  withdrawJoinRequest,
  approveJoinRequest,
  declineJoinRequest,
  cancelTrip,
  completeTrip,
  isTripPast,
  leaveTrip,
  removeParticipant,
  type CommitmentStatus,
  setTripGroupGear,
  setMyGroupGear,
  setMyPersonalGearList,
  listAdminUpdates,
  addAdminUpdate,
  updateAdminUpdate,
  deleteAdminUpdate,
  type SurfStyle,
  type WaveShapeKind,
} from '../../services/trips/groupTripsService';
import { type TripDetailVM, BOARD_SHORT } from '../../components/trips/TripDetailView';
import { TripDetailViewRedesigned } from '../../components/trips/TripDetailViewRedesigned';
import {
  EditTextSheet,
  EditCoverSheet,
  EditDatesSheet,
  EditAccommodationSheet,
  type DatesPatch,
  type AccommodationInitial,
} from '../../components/trips/TripEditSheets';
import { uploadTripImage } from '../../services/storage/storageService';
import { logEvent, logEventThrottled } from '../../services/analytics/eventLogger';
import { TripTabToggle, type TripTab } from '../../components/trips/TripTabToggle';
import { TripDashboardTab } from '../../components/trips/dashboard/TripDashboardTab';
import { TravelerExtras } from '../../components/trips/dashboard/TravelerExtras';
import { TravelerPriceSheet } from '../../components/trips/TravelerPriceSheet';
import { fetchTripMoney } from '../../services/trips/operatorDashboardService';
import { NotificationCenter } from '../../components/notifications/NotificationCenter';
import type { TripDetailFocus } from '../../services/notifications/notificationsService';
import { HostTag } from '../../components/trips/HostTag';
import { AdminUpdateSheet } from '../../components/trips/updates/AdminUpdateSheet';
import { AddPersonalGearSheet } from '../../components/trips/gear/AddPersonalGearSheet';
import { ReportTripSheet } from '../../components/ReportTripSheet';
import { ShareTripStorySheet } from '../../components/trips/ShareTripStorySheet';
import { isExpoGo } from '../../utils/keyboardAvoidingView';
import { hapticMedium, hapticLight, hapticSuccess, hapticError } from '../../utils/haptics';
import { toWidthThumbUrl } from '../../services/media/thumbnails';
import { PersonalGearSheet } from '../../components/trips/gear/PersonalGearSheet';
import ParticipantCard from '../../components/trips/ParticipantCard';
import PendingRequestCard from '../../components/trips/PendingRequestCard';
import { GearItemSheet } from '../../components/trips/gear/GearItemSheet';
import { RequestGearSheet } from '../../components/trips/gear/RequestGearSheet';
import { ManageGearSheet } from '../../components/trips/gear/ManageGearSheet';
import { GearRequestsSheet } from '../../components/trips/gear/GearRequestsSheet';
import {
  CommitPill,
  TripMemberSection,
  AdminUpdatesCard,
  GroupGearCard,
  YourGearCard,
  TripDocumentsCard,
  type DocumentRow,
} from '../../components/trips/plan/PlanSections';
import { RequirementUploadFlow } from '../../components/trips/RequirementUploadFlow';
import { WaiverAgreeSheet } from '../../components/trips/WaiverAgreeSheet';
import { MedicalFormSheet } from '../../components/trips/MedicalFormSheet';
import { DocumentViewer } from '../../components/trips/DocumentViewer';
import {
  DocumentReviewScreen,
  type ReviewTraveler,
} from '../../components/trips/DocumentReviewScreen';
import { ManageRequirementsSheet } from '../../components/trips/ManageRequirementsSheet';
import { TripIcon, type TripIconName } from '../../components/trips/tripIcons';
import { ff } from '../../theme/fonts';
import { supabase } from '../../config/supabase';
import { messagingService } from '../../services/messaging/messagingService';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { tripsKeys } from '../../hooks/trips/useTripQueries';
import {
  useTripCore,
  useTripAdminUpdates,
  useTripGear,
  useTripRequests,
  useTripGearRequests,
  useTripDocuments,
  useTripReview,
  useTripRequirements,
} from '../../hooks/trips/useTripDetail';
import { useTripRealtime } from '../../hooks/trips/useTripRealtime';
import { TripDetailSkeleton } from '../../components/skeletons';
import { friendlyErrorMessage, showErrorAlert } from '../../utils/friendlyError';
import {
  fetchMyDocument,
  actionForRequirement,
  type EditableRequirement,
  type RequirementKind,
  type TripRequirement,
} from '../../services/trips/tripDocumentsService';
import {
  amountDue,
  amountOutstanding,
  startCheckout,
  fetchTravelerPrices,
  fetchPaidByRequirement,
  type PayStep,
  type CheckoutOutcome,
} from '../../services/trips/tripPaymentsService';
import { PaymentStatusSheet, type PaymentStatusMode } from '../../components/trips/PaymentStatusSheet';
import {
  attemptPhase,
  describeAttemptAge,
  loadPaymentAttempts,
  recordPaymentAttempt,
  clearPaymentAttempt,
  PENDING_WINDOW_MS,
  type PaymentAttempts,
} from '../../services/trips/pendingPaymentStore';
import { isTripHost } from '../../utils/tripRole';
import { useUserProfile } from '../../context/UserProfileContext';

interface TripDetailScreenProps {
  tripId: string;
  onBack: () => void;
  onOpenGroupChat?: (params: { conversationId: string; title: string; heroImageUrl?: string | null; tripId?: string }) => void;
  onEditTrip?: (trip: GroupTrip) => void;
  /** Operator (host_id owner) tap on the "Edit trip" menu entry — pushes the
   *  flat OperatorEditTrip screen. Distinct from onEditTrip, which reopens the
   *  wizard and is for peer (A/B) hosts only. */
  onEditOperatorTrip?: (tripId: string) => void;
  /** Tap on a participant opens their profile. Back from the profile returns here. */
  onViewUserProfile?: (userId: string) => void;
  /** Optional — wires the header notification bell (Figma). Bell is hidden when
   *  not provided, since a non-functional bell is worse than none. */
  onOpenNotifications?: () => void;
  /** Tap on a bell notification deep-links to its trip (may be another trip). */
  onOpenTrip?: (tripId: string, focus?: TripDetailFocus) => void;
  /**
   * Deep-link landing spot (from a notification tap). Switches to the Plan tab
   * and scrolls to the section once data + layout are ready. Silently falls
   * back to Overview when the viewer can't see Plan (non-member, locked trip)
   * or the target section isn't rendered.
   */
  initialFocus?: TripDetailFocus | null;
  /** "View all" on the admin-updates preview pushes the full Updates list. */
  onViewAllUpdates?: () => void;
  /** "View all" on the Members section / Overview Participants row pushes the full
   *  Members list (permission layers resolved inside that screen). */
  onViewAllMembers?: () => void;
  /** "View all" on the Group Gear preview pushes the full Packing & Gear list. */
  onViewAllGroupGear?: () => void;
  onViewAllYourGear?: () => void;
  /** Host "Manage" on the Your Gear section pushes the full suggested-gear editor. */
  onManageSuggestedGear?: () => void;
  /** Host "Manage" on the Group Gear card pushes the full-screen Manage Gear editor. */
  onManageGroupGear?: () => void;
  /** Member "Commit to this trip" → pushes the full-screen commitment flow. */
  onOpenCommitment?: (args: { tripTitle: string | null; initialItems: string[]; initialNote: string | null }) => void;
  /** Open a 1:1 chat with someone on the trip. Used by the Dashboard tab's
   *  per-traveler actions; absent means the button is not offered. */
  onMessageUser?: (userId: string, name?: string, avatar?: string | null) => void;
}

/** Stable empty list for the requirements editor. An inline `?? []` would be a
 *  new array on every render, and the sheet reseeds its draft when that prop
 *  changes identity — which is a render loop, not a re-render. */
const NO_REQUIREMENTS: EditableRequirement[] = [];

// ---------------------------------------------------------------------------
// Helpers (mirrors TripsScreen formatting so cards and details stay in sync)
// ---------------------------------------------------------------------------
const formatDates = (trip: GroupTrip): string => {
  if (trip.start_date && trip.end_date) {
    const fmt = (d: string) =>
      new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    const setInStone = trip.dates_set_in_stone ? '' : ' (flexible)';
    return `${fmt(trip.start_date)} – ${fmt(trip.end_date)}${setInStone}`;
  }
  if (trip.date_months && trip.date_months.length > 0) {
    return trip.date_months
      .map(m => {
        const [y, mo] = m.split('-');
        return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString(undefined, {
          month: 'short',
          year: 'numeric',
        });
      })
      .join(' / ');
  }
  return 'Dates TBD';
};

const formatDestination = (trip: GroupTrip): string =>
  trip.destination?.short_label ||
  trip.destination?.name ||
  trip.destination?.country ||
  'Destination TBD';

const WAVE_SHAPE_LABEL: Record<WaveShapeKind, string> = {
  soft: 'Mellow',
  wally: 'Standing',
  barrel: 'Barreling',
};

const titleCase = (s: string): string =>
  s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

// Build the shared TripDetailView model from a real trip + its participants.
const buildTripDetailVM = (
  trip: GroupTrip,
  participantCount: number,
  host?: EnrichedParticipant | null,
): TripDetailVM => ({
  heroImageUri: trip.hero_image_url || null,
  title: trip.title,
  destinationLabel:
    trip.destination?.short_label ||
    trip.destination?.name ||
    trip.destination?.country ||
    null,
  startDateISO: trip.start_date,
  endDateISO: trip.end_date,
  dateMonths: trip.date_months,
  durationDays: trip.duration_days,
  skillLevels: trip.target_surf_levels ?? [],
  ageMin: trip.age_min ?? null,
  ageMax: trip.age_max ?? null,
  participantCount: participantCount || trip.participant_count || 1,
  maxParticipants: trip.max_participants,
  description: trip.description ?? '',
  vibeSlug: trip.trip_vibes?.[0] ?? null,
  surfStyles: (trip.target_surf_styles ?? []) as SurfStyle[],
  structureSlugs: trip.trip_structure ?? [],
  waveSizeMin: trip.wave_size_min,
  waveSizeMax: trip.wave_size_max,
  waveShapeLabel: trip.wave_shapes?.length
    ? WAVE_SHAPE_LABEL[trip.wave_shapes[0] as WaveShapeKind] ?? null
    : null,
  specificStaySelected: trip.specific_stay_selected,
  accommodationKindLabel: trip.accommodation_type?.length
    ? titleCase(String(trip.accommodation_type[0]))
    : null,
  accommodationName: trip.accommodation_name,
  accommodationImageUri: trip.accommodation_image_url,
  accommodationUrl: trip.accommodation_url,
  costPerPerson: trip.cost_per_person,
  priceInclusions: trip.price_inclusions,
  budgetMin: trip.budget_min,
  budgetMax: trip.budget_max,
  budgetFxRate: trip.budget_fx_rate,
  budgetTier: (trip.budget_tier as 'low' | 'medium' | 'high' | null) ?? null,
  hostingStyle: trip.hosting_style,
  leader:
    trip.hosting_style === 'B'
      ? {
          name: host?.name ?? null,
          avatarUrl: host?.profile_image_url ?? null,
          age: host?.age ?? null,
          countryFrom: null, // not in participant data; shown when available
          surfLevelLabel: host?.surf_level_category
            ? titleCase(host.surf_level_category)
            : null,
          tripsCount: null, // travel_experience not in participant data
          destinationFamiliarityLabel: trip.host_destination_familiarity
            ? DESTINATION_FAMILIARITY_OPTIONS.find(
                o => o.slug === trip.host_destination_familiarity,
              )?.label ?? null
            : null,
          stayFamiliarityLabel: trip.host_stay_familiarity
            ? STAY_FAMILIARITY_OPTIONS.find(o => o.slug === trip.host_stay_familiarity)?.label ??
              null
            : null,
          leadNote: trip.host_lead_note ?? null,
        }
      : null,
});

const formatRelativeTime = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.max(0, Math.floor(diff / 1000));
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} day${day === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString();
};

// ---------------------------------------------------------------------------
const Section: React.FC<{
  title: string;
  children: React.ReactNode;
  headerRight?: React.ReactNode;
}> = ({ title, children, headerRight }) => (
  <View style={styles.section}>
    <View style={styles.sectionHeaderRow}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {headerRight ? <View>{headerRight}</View> : null}
    </View>
    {children}
  </View>
);

const InfoRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View style={styles.infoRow}>
    <Text style={styles.infoLabel}>{label}</Text>
    <Text style={styles.infoValue}>{value}</Text>
  </View>
);

const DangerRow: React.FC<{
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  loading?: boolean;
  showDivider?: boolean;
}> = ({ icon, label, onPress, loading, showDivider }) => (
  <TouchableOpacity
    style={[styles.dangerRow, showDivider && styles.dangerRowDivider]}
    onPress={onPress}
    disabled={loading}
    activeOpacity={0.6}
  >
    {loading ? (
      <ActivityIndicator color="#C0392B" />
    ) : (
      <>
        <Ionicons name={icon} size={20} color="#C0392B" />
        <Text style={styles.dangerRowText}>{label}</Text>
      </>
    )}
  </TouchableOpacity>
);

// ---------------------------------------------------------------------------
export default function TripDetailScreen({ tripId, onBack, onOpenGroupChat, onEditTrip, onEditOperatorTrip, onViewUserProfile, onOpenNotifications, onOpenTrip, initialFocus, onViewAllUpdates, onViewAllMembers, onViewAllGroupGear, onViewAllYourGear, onManageSuggestedGear, onManageGroupGear, onOpenCommitment, onMessageUser }: TripDetailScreenProps) {
  const { user: contextUser } = useOnboarding();
  const { profile } = useUserProfile();
  const insets = useSafeAreaInsets();
  const currentUserId = contextUser?.id?.toString() ?? null;
  const viewerCountry = profile?.country_from ?? null;
  const queryClient = useQueryClient();

  // Data from react-query cache (survives screen unmount → instant reopen).
  const coreQuery = useTripCore(tripId, currentUserId);
  const trip = coreQuery.data?.trip ?? null;
  const participants = coreQuery.data?.participants ?? [];
  const myRequest = coreQuery.data?.myRequest ?? null;

  // Discreet "report this whole trip" flow — available to members and non-members alike.
  const [reportSheetVisible, setReportSheetVisible] = useState(false);
  const [storySheetVisible, setStorySheetVisible] = useState(false);
  // Header kebab (⋮) overflow menu: Chat / Report / Share for everyone, plus
  // Complete / Cancel for the host.
  const [menuVisible, setMenuVisible] = useState(false);
  // Warm RN Image's cache with the story-card hero while the user reads the
  // menu, so ShareTripStorySheet opens with the photo already local (expo-image
  // caches elsewhere in the app don't help RN Image — separate caches).
  useEffect(() => {
    if (!menuVisible || !trip?.hero_image_url) return;
    const url = toWidthThumbUrl(trip.hero_image_url) ?? trip.hero_image_url;
    Image.prefetch(url).catch(() => {});
  }, [menuVisible, trip?.hero_image_url]);
  // placeholderData seeds the trip from the list cache with participants: []
  // and myRequest: null, so until the real fetch lands we DON'T know whether
  // the viewer is a member. Member-dependent chrome (join CTA, deep-link
  // fallback) must wait for this — otherwise members see a "Request to Join"
  // flash on every open.
  const membershipKnown = !!coreQuery.data && !coreQuery.isPlaceholderData;

  // isHostDerived must be derived before any hook that depends on it so hook
  // call order stays stable across renders (no conditional hooks).
  const isHostDerived = isTripHost(trip, participants, currentUserId);

  const updatesQuery = useTripAdminUpdates(tripId);
  const adminUpdates = updatesQuery.data ?? [];

  const gearQuery = useTripGear(tripId, currentUserId);
  const gearItems = gearQuery.data ?? [];

  const requestsQuery = useTripRequests(tripId, isHostDerived);
  const pendingRequests = requestsQuery.data?.pending ?? [];
  const declinedRequests = requestsQuery.data?.declined ?? [];

  const gearRequestsQuery = useTripGearRequests(tripId, isHostDerived);
  const gearRequests = gearRequestsQuery.data ?? [];

  // ── Documents (v1: passport image only) ───────────────────────────────────
  // Gated on membership, NOT on hosting_style. The database is the real gate:
  // `trg_passport_requires_operator_trip` refuses to create a passport
  // requirement on anything but an operator trip, so the client can simply
  // render whatever requirements come back. That also means any future
  // requirement kind works here without touching this condition.
  //
  // The RPC itself returns nothing to a non-participant, so this only saves a
  // pointless round trip for people browsing a trip they have not joined.
  const isTripMember =
    !!currentUserId &&
    (isHostDerived || participants.some(p => p.user_id === currentUserId));
  const documentsQuery = useTripDocuments(tripId, isTripMember);

  // This traveler's own price + what they've already paid, per requirement.
  // Only fetched on a `managed` trip — an `offline` trip has no Stripe amounts
  // to show — and never for the host: they're a participant too, but the host
  // card never renders amounts, so this would just be a wasted round trip on
  // every operator trip open. staleTime 0: money must never be read from a
  // stale cache.
  const paymentsQuery = useQuery({
    queryKey: tripsKeys.payments(tripId, currentUserId ?? ''),
    enabled: !!tripId && !!currentUserId && !isHostDerived && trip?.payment_mode === 'managed',
    queryFn: async () => {
      const [prices, paid] = await Promise.all([
        fetchTravelerPrices(tripId, currentUserId as string),
        fetchPaidByRequirement(tripId, currentUserId as string),
      ]);
      return { prices, paid };
    },
    staleTime: 0,
  });

  // Checkout just closed and we're polling for the webhook to land (see
  // `handlePressDocumentRow`). Set only for the row being confirmed, cleared
  // once the poll gives up or the row flips to `approved`.
  const [confirmingRequirementId, setConfirmingRequirementId] = useState<string | null>(null);

  // Payments that came back from Checkout unconfirmed, keyed by requirement id
  // → when the poll gave up. Persisted, because this used to be a plain
  // `useState` that died on unmount and handed a fresh "Pay" button to someone
  // who may already have paid. See services/trips/pendingPaymentStore.ts.
  const [paymentAttempts, setPaymentAttempts] = useState<PaymentAttempts>({});

  // Re-renders the rows so a `pending` attempt visibly ages out of
  // "Processing" instead of sitting there forever on a screen nobody has
  // navigated away from. Runs ONLY while something is actually pending — an
  // unconditional interval on a screen this heavy is not worth one label.
  const [attemptTick, setAttemptTick] = useState(0);

  // The background poll's interval closure reads this instead of the state, so
  // recording a second attempt doesn't tear down and restart the interval —
  // which, on a 5s timer, would keep pushing the next check further away.
  const paymentAttemptsRef = useRef<PaymentAttempts>({});
  paymentAttemptsRef.current = paymentAttempts;

  // The unhappy-path sheet. `null` = nothing wrong. Carries its own title and
  // reason so the sheet can stay a pure presentational component and the copy
  // can name the actual requirement ("Deposit") rather than say "your payment".
  const [paymentIssue, setPaymentIssue] = useState<{
    mode: PaymentStatusMode;
    requirementId: string;
    title: string;
    reason?: string | null;
    attemptAge?: string | null;
  } | null>(null);
  const [recheckingPayment, setRecheckingPayment] = useState(false);

  const documentRows: DocumentRow[] = useMemo(
    () =>
      (documentsQuery.data ?? []).map(r => {
        let amountUsd: number | null = null;
        let amountError = false;
        if (r.reqType === 'pay') {
          if (paymentsQuery.isError) {
            // Distinct from "no price set yet" — a fetch failure shouldn't
            // read as "this is free."
            amountError = true;
          } else if (paymentsQuery.data) {
            const step = r.kind as PayStep;
            const due = amountDue(step, paymentsQuery.data.prices);
            // Null means no price is set anywhere for this traveler — never
            // show "$0" next to a Pay button; that reads as "this is free."
            amountUsd =
              due == null
                ? null
                : amountOutstanding(step, paymentsQuery.data.prices, paymentsQuery.data.paid[r.requirementId] ?? 0);
          }
        }
        return {
          requirementId: r.requirementId,
          kind: r.kind,
          reqType: r.reqType,
          title: r.title,
          state: r.state as DocumentRow['state'],
          dueDate: r.dueDate,
          note: r.note,
          amountUsd,
          amountError,
          confirming: r.requirementId === confirmingRequirementId,
          // Gated on the server's own state, not just on our stored attempt:
          // the moment the webhook lands the row is `approved` and must render
          // as Done, even if the background poll below hasn't yet noticed and
          // cleared the attempt.
          pending:
            r.state !== 'approved' &&
            attemptPhase(paymentAttempts[r.requirementId] ?? 0, Date.now()) === 'pending',
        };
      }),
    [
      documentsQuery.data,
      paymentsQuery.data,
      paymentsQuery.isError,
      confirmingRequirementId,
      paymentAttempts,
      // Not read in the body — it exists so the ticker below can force the
      // `Date.now()` above to be re-evaluated when an attempt ages out.
      attemptTick,
    ],
  );

  // ── Host review ───────────────────────────────────────────────────────────
  // Everyone except the hosts: an operator reviewing their own passport is not a
  // thing. Sorted so the query key is stable no matter what order the
  // participants come back in — otherwise every refetch would look like a new
  // key and re-run.
  const reviewTravelers: ReviewTraveler[] = useMemo(
    () =>
      participants
        .filter(p => p.role !== 'host')
        .map(p => ({
          userId: p.user_id,
          name: p.name,
          avatarUrl: p.profile_image_url,
        })),
    [participants],
  );
  const reviewUserIds = useMemo(
    () => reviewTravelers.map(t => t.userId).sort(),
    [reviewTravelers],
  );
  // Only worth fetching once this trip actually asks for something. On a peer
  // trip `documentRows` is empty and this never runs.
  const hasRequirements = documentRows.length > 0;
  const reviewQuery = useTripReview(
    tripId,
    isHostDerived && hasRequirements,
    reviewUserIds,
  );
  const reviewData = reviewQuery.data?.travelers ?? [];
  const travelersFinished = reviewData.filter(r => r.total > 0 && r.done === r.total).length;
  const [reviewOpen, setReviewOpen] = useState(false);
  /** Set when the Dashboard's Travelers list opens review on ONE person; null
   *  opens the whole queue, which is every other entry point. */
  const [reviewFocusUserId, setReviewFocusUserId] = useState<string | null>(null);
  /** Set when the Dashboard's Documents list opens review on ONE document type.
   *  Mutually exclusive with the focus above — the review screen's level 2 is
   *  a person OR a requirement, so each setter clears the other. */
  const [reviewFocusRequirementId, setReviewFocusRequirementId] = useState<string | null>(null);
  /** Set when the "N documents waiting for you" banner opens review on
   *  everything that needs a decision. Lowest priority of the three. */
  const [reviewWaiting, setReviewWaiting] = useState(false);
  /** Who the price sheet is open for, launched from inside the review screen. */
  const [pricingUserId, setPricingUserId] = useState<string | null>(null);

  /**
   * Trip-wide money, shared with the Dashboard tab through the query cache.
   *
   * Same key the tab uses, so this is one fetch, not two — and the per-traveler
   * block inside the review screen therefore always shows the same numbers as
   * the summary card the operator just tapped through.
   *
   * Only for hosts of an operator trip; nobody else may read the ledger, and
   * asking would be a guaranteed RLS-empty result.
   */
  const dashboardMoney = useQuery({
    queryKey: ['operatorDashboard', 'money', tripId],
    queryFn: () => fetchTripMoney(tripId),
    // `hosting_style === 'C'` inline rather than the `isOperatorTrip` alias:
    // that is declared below this point, and hoisting this query above it
    // would be a temporal-dead-zone crash on first render.
    enabled: isHostDerived && trip?.hosting_style === 'C',
  });

  // ── Editing what the trip asks for (host) ─────────────────────────────────
  //
  // Two ways in, and the first one is the important one: ANY trip that already
  // asks for something is editable. `hosting_style === 'C'` alone was wrong —
  // there are live trips on `A` carrying requirements (they predate
  // `trg_passport_requires_operator_trip`, or were flipped to A afterwards), and
  // gating on style hid the editor from exactly the trips that most need it.
  // This screen's own rule, one section up, is that the database is the real
  // gate; this now follows it.
  //
  // The second way in is for a `C` trip that asks for nothing yet, which needs
  // an empty state to add its first requirement.
  //
  // `documentsQuery.data` rather than `documentRows` — the two now carry the
  // same rows, but this reads directly off the query so it never depends on
  // whatever `documentRows` happens to derive.
  const isOperatorTrip = trip?.hosting_style === 'C';
  // The operator of record — the one operator_payout_accounts pays. NOT
  // isHost, which is flat multi-host (every promoted co-admin). group_trips'
  // UPDATE policy is is_trip_host(id), so gating the operator edit screen on
  // isHost would let any promoted co-host change cost_per_person for
  // everyone — this screen is the first UI anywhere that edits a published
  // trip's price. Same reasoning as operator_set_traveler_price's C3 fix
  // (supabase/migrations/20260803000100_operator_set_traveler_price.sql:14-44).
  const isTripOwner = !!currentUserId && trip?.host_id === currentUserId;
  // TEMPORARY TEST HATCH — remove before this ships.
  // "El Salvador 26" is a hosting_style 'A' trip, so it would not normally get
  // the operator Edit screen. Opened up so Ohad (its host) can walk the screen
  // on a real trip before any type-C trip exists to test against. Still gated
  // on isTripOwner, so it only ever appears for that trip's own host.
  // Caveat while testing: the Price, Deposit and Requirements rows are
  // operator-only concepts. A peer trip is always payment_mode 'offline' (a DB
  // CHECK forbids 'managed' unless hosting_style = 'C'), so those rows will
  // read as empty or not apply — that is expected here, not a bug.
  const isEditTestTrip = trip?.id === '5c042bf4-18af-496c-a3e1-262bfa0a3efc';
  const canManageRequirements =
    isHostDerived && ((documentsQuery.data?.length ?? 0) > 0 || isOperatorTrip);
  // Enabled on `isHost`, matching where the sheet is mounted. Tying it to
  // `canManageRequirements` would let the rows disappear underneath an open
  // editor the moment its own Save invalidated the documents query.
  const requirementsQuery = useTripRequirements(tripId, isHostDerived);
  const [manageOpen, setManageOpen] = useState(false);
  // Refetch on the way in. Save diffs the draft against these rows, so opening
  // the editor on a cached list is how a change made on another device gets
  // quietly undone.
  //
  // Goes through queryClient rather than `requirementsQuery.refetch`: react-query
  // hands back a new result object every render, so depending on it rebuilt this
  // callback constantly and pushed a new `onManage` into the card each time.
  const openManageRequirements = useCallback(() => {
    queryClient.refetchQueries({ queryKey: tripsKeys.detailRequirements(tripId) });
    setManageOpen(true);
  }, [queryClient, tripId]);
  const handleRequirementsSaved = useCallback(() => {
    // Everything downstream of the requirement list: the host's own checklist
    // read, the stored rows, and the per-traveler review whose totals just moved.
    queryClient.invalidateQueries({ queryKey: tripsKeys.detailRequirements(tripId) });
    queryClient.invalidateQueries({ queryKey: tripsKeys.detailDocuments(tripId) });
    queryClient.invalidateQueries({ queryKey: ['trips', 'detail-review', tripId] });
  }, [queryClient, tripId]);


  // Live refresh while the screen is open — other users' approvals, joins,
  // leaves, trip edits and admin updates invalidate the queries above.
  useTripRealtime(tripId);

  /**
   * Pull to refresh.
   *
   * This screen had none. For a traveler that was survivable — realtime and the
   * focus refresh in `useTripRealtime` cover most of it. For an operator it was
   * not: the Dashboard tab is the thing they open to see what changed, and a
   * screen that quietly shows yesterday's numbers is worse than no screen,
   * because they will trust it and be wrong.
   *
   * `type: 'active'` refetches only what is currently mounted, so pulling on
   * Overview does not go and fetch the whole Dashboard. The predicate keeps it
   * to this feature's two key roots rather than every query in the app.
   */
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await queryClient.refetchQueries({
        type: 'active',
        predicate: q => {
          const root = q.queryKey[0];
          return root === 'trips' || root === 'operatorDashboard';
        },
      });
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  const [openingChat, setOpeningChat] = useState(false);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [editingPacking, setEditingPacking] = useState(false);
  const [groupGearDraft, setGroupGearDraft] = useState('');
  const [savingPacking, setSavingPacking] = useState(false);
  // Member-private gear: each user adds/removes only their own; host items
  // live in trip.personal_gear_host_suggestion and aren't editable from here.
  const [addingPersonalItem, setAddingPersonalItem] = useState(false);
  const [personalItemDraft, setPersonalItemDraft] = useState('');
  const [savingPersonalItem, setSavingPersonalItem] = useState(false);
  // Overview = public read-only facts; Plan = interactive (members only).
  const [activeTab, setActiveTab] = useState<TripTab>('overview');
  // Host-only inline edit sheets (Figma admin view): cover / about-host / description / dates / accommodation.
  const [editSheet, setEditSheet] = useState<
    'cover' | 'about' | 'description' | 'dates' | 'accommodation' | null
  >(null);

  // Shared gear — items with required quantities + request flow
  // (group_trip_gear_items / _gear_claims / _gear_requests). Distinct from
  // the host's checklist (which lives on group_trips.personal_gear_host_suggestion).
  // gearItems + gearRequests now come from react-query (declared above).
  const [gearItemSheetItem, setGearItemSheetItem] = useState<EnrichedGearItem | null>(null);
  const [requestSheetVisible, setRequestSheetVisible] = useState(false);
  const [manageSheetVisible, setManageSheetVisible] = useState(false);
  // Group Gear "+ Add item" — opens the add-item sheet in place (Figma
  // 12919-32232), without leaving for the "Edit Group Gear" screen.
  const [addGroupGearSheetOpen, setAddGroupGearSheetOpen] = useState(false);
  const [requestsSheetVisible, setRequestsSheetVisible] = useState(false);
  // New gear/update sheets (Plan tab redesign)
  const [personalGearSheetOpen, setPersonalGearSheetOpen] = useState(false);
  const [addPersonalSheetOpen, setAddPersonalSheetOpen] = useState(false);
  const [processingGearRequestId, setProcessingGearRequestId] = useState<string | null>(null);

  // Requirements. `openRequirement` says which row the traveler tapped and what
  // it wants them to do; the three sheets below are driven off it. The viewer
  // holds only a storage path, never a signed URL.
  const [openRequirement, setOpenRequirement] = useState<{
    requirementId: string;
    kind: RequirementKind;
    action: 'upload' | 'agree' | 'medical';
    note: string | null;
    agreed: boolean;
  } | null>(null);
  // The kind travels with the path because the viewer offers "Copy details" on
  // passports only, and the storage path alone cannot say what it holds. The
  // title travels with it for the same reason: DocumentViewer's header has no
  // way to name what it is showing, and its default is 'Document' — every file
  // a traveler opened used to be titled "Passport", including their flights.
  const [viewingDoc, setViewingDoc] = useState<{
    storagePath: string;
    kind: string;
    title: string;
  } | null>(null);

  // Admin updates — host-posted free-text lines, visible to all members.
  // adminUpdates now comes from react-query (declared above).
  const [addingUpdate, setAddingUpdate] = useState(false);
  const [updateTitleDraft, setUpdateTitleDraft] = useState('');
  const [updateDraft, setUpdateDraft] = useState('');
  const [editingUpdateId, setEditingUpdateId] = useState<string | null>(null);
  const [savingUpdate, setSavingUpdate] = useState(false);

  const isHost = isHostDerived;
  const isApprovedMember = useMemo(
    () =>
      !!currentUserId &&
      participants.some(p => p.user_id === currentUserId && p.role !== 'host'),
    [participants, currentUserId]
  );
  const hasNonHostMembers = useMemo(
    () => participants.some(p => p.role !== 'host'),
    [participants]
  );

  // ── Which tabs exist ──────────────────────────────────────────────────────
  // Computed up here, above the loading/not-found early returns, because the
  // two hooks below must run on EVERY render. Deep-linking in from a
  // notification mounts this screen with no cached trip, so the first render
  // takes the skeleton return — if these hooks lived after it, the render that
  // follows the fetch would add hooks and React would throw
  // "Rendered more hooks than during the previous render".
  const isLockedForTabs =
    !!trip &&
    (trip.status === 'cancelled' || trip.status === 'completed' || isTripPast(trip));
  // Tabs: only members (host + approved) get the Plan tab, and only while the
  // trip is live. Once locked (completed / ended / cancelled) the toggle is gone
  // and everyone sees just the Overview.
  const canSeePlan = (isHost || isApprovedMember) && !isLockedForTabs;

  /**
   * The Dashboard tab — running the trip, not going on it.
   *
   * Operator trips only, and only for a host. `isOperatorTrip` is what makes a
   * trip a business: peer trips have no documents, no travelers to review and
   * no money to collect, so a third tab there would be three empty sections.
   *
   * Kept alive on a locked trip on purpose, unlike Plan. A trip that ended
   * yesterday is exactly when an operator still needs the ledger and the
   * documents — the tab that disappears the moment the trip is over is the one
   * they will look for first.
   */
  const canSeeDashboard = isHost && !!isOperatorTrip;

  const visibleTabs = useMemo<TripTab[]>(() => {
    const tabs: TripTab[] = ['overview'];
    if (canSeePlan) tabs.push('plan');
    if (canSeeDashboard) tabs.push('dashboard');
    return tabs;
  }, [canSeePlan, canSeeDashboard]);

  // A tab that stops being available must not leave the screen showing nothing
  // — losing host rights, or the trip locking, would otherwise strand the
  // viewer on a blank body with no way back.
  useEffect(() => {
    if (!visibleTabs.includes(activeTab)) setActiveTab('overview');
  }, [visibleTabs, activeTab]);

  /**
   * Operators open on the tab that has news.
   *
   * Overview is the page the operator wrote themselves and it does not change.
   * Dashboard is what moved since yesterday — money in, documents to decide on,
   * people to chase. Starting everyone on Overview charged every operator a tap
   * on every open to get past a page they know by heart.
   *
   * ONE SHOT, via the ref. A plain effect on `canSeeDashboard` would drag them
   * back here every time they deliberately chose Overview.
   *
   * The deep link always wins. `initialFocus` is set when the screen was opened
   * from a notification, and the effect below this one is already steering to
   * the right tab and section — landing on Dashboard instead would send someone
   * who tapped "your passport was approved" to the wrong place. Claim the ref
   * without acting so this never fires later in the session either.
   */
  const didPickDefaultTab = useRef(false);
  useEffect(() => {
    if (didPickDefaultTab.current) return;
    if (initialFocus) {
      didPickDefaultTab.current = true;
      return;
    }
    // `canSeeDashboard` is false until the trip loads, so this waits rather
    // than deciding on incomplete data.
    if (!canSeeDashboard) return;
    didPickDefaultTab.current = true;
    setActiveTab('dashboard');
  }, [canSeeDashboard, initialFocus]);

  // ── Notification deep-link: land on the right tab + section ───────────────
  // Plan sections register their content-relative Y here as they lay out; the
  // focus effect scrolls once the target exists. 'your-gear' is nested inside
  // the 'gear' section, so its absolute Y is the sum of both.
  const scrollRef = useRef<ScrollView>(null);
  // Sticky Overview/Plan toggle: track scroll position and the toggle's resting
  // Y so a clone can clip under the black header once the real one scrolls past.
  const scrollY = useRef(new Animated.Value(0)).current;
  const toggleYRef = useRef(0);
  const [toggleY, setToggleY] = useState(0);
  const [toggleStuck, setToggleStuck] = useState(false);
  const sectionYs = useRef<Record<string, number>>({});
  const appliedFocusRef = useRef<string | null>(null);
  const registerSection = useCallback(
    (key: string) => (e: LayoutChangeEvent) => {
      sectionYs.current[key] = e.nativeEvent.layout.y;
    },
    []
  );
  useEffect(() => {
    sectionYs.current = {}; // stale Ys from another trip must not be scroll targets
  }, [tripId]);

  // Flip the sticky toggle on/off only as the scroll crosses the toggle's resting
  // Y (not every frame) — the clone's opacity itself is driven natively below.
  useEffect(() => {
    const id = scrollY.addListener(({ value }) => {
      const next = toggleYRef.current > 0 && value >= toggleYRef.current;
      setToggleStuck(prev => (prev !== next ? next : prev));
    });
    return () => scrollY.removeListener(id);
  }, [scrollY]);

  // Analytics: "active in this trip today" (chart C). Throttled per (user, trip).
  useEffect(() => {
    logEventThrottled('trip_opened', { tripId });
  }, [tripId]);

  useEffect(() => {
    // membershipKnown: placeholder-seeded data has participants: [] — deciding
    // the Plan-vs-Overview fallback on it would dump members on Overview.
    if (!trip || !initialFocus || !membershipKnown) return;
    const token = `${tripId}:${initialFocus}`;
    if (appliedFocusRef.current === token) return; // once per (trip, focus)
    appliedFocusRef.current = token;

    const locked = trip.status === 'cancelled' || trip.status === 'completed' || isTripPast(trip);
    const canSeePlanNow = (isHost || isApprovedMember) && !locked;
    if (initialFocus === 'overview' || !canSeePlanNow) return; // fallback: Overview

    setActiveTab('plan');
    if (initialFocus === 'gear-requests' && isHost) setRequestsSheetVisible(true);

    // Scroll once the Plan sections have mounted and reported layout. If the
    // target never renders (e.g. no commit pill for hosts, no pending
    // requests), give up quietly — the user is at the top of Plan, which is
    // the right fallback.
    let attempts = 0;
    let cancelled = false;
    const tryScroll = () => {
      if (cancelled) return;
      const ys = sectionYs.current;
      const y =
        initialFocus === 'your-gear'
          ? ys['gear'] != null && ys['your-gear'] != null
            ? ys['gear'] + ys['your-gear']
            : undefined
          : ys[initialFocus];
      if (y != null) {
        scrollRef.current?.scrollTo({ y: Math.max(y - 12, 0), animated: true });
      } else if (attempts++ < 30) {
        requestAnimationFrame(tryScroll);
      }
    };
    requestAnimationFrame(tryScroll);
    return () => {
      cancelled = true;
    };
  }, [trip, tripId, initialFocus, isHost, isApprovedMember, membershipKnown]);
  const meParticipant = useMemo(
    () => participants.find(p => p.user_id === currentUserId),
    [participants, currentUserId]
  );
  const myCommitmentStatus: CommitmentStatus = meParticipant?.commitment_status ?? 'none';
  const myCommitmentItems = meParticipant?.commitment_items ?? [];
  const myCommitmentNote = meParticipant?.commitment_note ?? null;
  // Members section (Plan tab) — avatars + committed-to-trip count. The passport
  // badge tracks the `committed` flag (host counts as committed by default).
  const memberList = useMemo(
    () =>
      participants.map(p => ({
        id: p.user_id,
        name: p.name ?? null,
        avatarUrl: p.profile_image_url ?? null,
        committed: !!p.committed,
        isHost: p.role === 'host',
      })),
    [participants]
  );
  const committedCount = useMemo(
    () => participants.filter(p => p.committed).length,
    [participants]
  );
  const myGroupGear = useMemo<GroupGearItem[]>(
    () => participants.find(p => p.user_id === currentUserId)?.personal_gear_by_host ?? [],
    [participants, currentUserId]
  );
  const myPersonalGear = useMemo<PersonalGearItem[]>(
    () => participants.find(p => p.user_id === currentUserId)?.personal_gear_by_me ?? [],
    [participants, currentUserId]
  );
  const gearTotalCount = (trip?.personal_gear_host_suggestion?.length ?? 0) + myPersonalGear.length;
  // Combined rows (host-suggested + my own) for the "Your gear" summary preview.
  const gearAllRows = [
    ...(trip?.personal_gear_host_suggestion ?? []).map(name => ({
      kind: 'host' as const,
      name,
      done: myGroupGear.find(it => it.name === name)?.done ?? false,
    })),
    ...myPersonalGear.map(it => ({ kind: 'mine' as const, name: it.name, done: it.done })),
  ];
  // Data is now managed by react-query hooks above.
  // refreshGear / refreshGearRequests replaced by queryClient.invalidateQueries.

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------
  // Tapping "Request to join" sends the request straight away — no note sheet.
  const handleRequestToJoin = async () => {
    if (!currentUserId) return;
    hapticMedium();

    // Flip the CTA to "Requested" immediately, then fire the write in the
    // background — same optimistic pattern as handleWithdraw below. The INSERT
    // is ~10ms server-side but awaiting the REST round trip held a spinner for
    // 6-8s whenever the call stalled (cold realtime socket / auth-lock on RN).
    const prevRequest =
      queryClient.getQueryData<import('../../hooks/trips/useTripDetail').TripCoreData>(
        tripsKeys.detail(tripId)
      )?.myRequest ?? null;
    const optimistic: GroupTripJoinRequest = {
      id: `optimistic-${currentUserId}`,
      trip_id: tripId,
      requester_id: currentUserId,
      status: 'pending',
      request_note: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      reviewed_at: null,
      reviewed_by: null,
      seen_decision_at: null,
    };
    queryClient.setQueryData<import('../../hooks/trips/useTripDetail').TripCoreData>(
      tripsKeys.detail(tripId),
      prev => (prev ? { ...prev, myRequest: optimistic } : prev)
    );

    try {
      const newReq = await requestToJoinTrip(tripId, currentUserId);
      // Reconcile the optimistic row with the real one (real id/timestamps).
      queryClient.setQueryData<import('../../hooks/trips/useTripDetail').TripCoreData>(
        tripsKeys.detail(tripId),
        prev => (prev ? { ...prev, myRequest: newReq } : prev)
      );
    } catch (e: any) {
      // Roll back so the CTA reflects reality (write never committed).
      queryClient.setQueryData<import('../../hooks/trips/useTripDetail').TripCoreData>(
        tripsKeys.detail(tripId),
        prev => (prev ? { ...prev, myRequest: prevRequest } : prev)
      );
      hapticError();
      Alert.alert('Could not send request', friendlyErrorMessage(e, 'Please try again.'));
    }
  };

  const handleWithdraw = async () => {
    if (!myRequest) return;
    hapticMedium();
    const prevStatus = myRequest.status;
    const reqId = myRequest.id;

    // Flip the CTA to "Request to join" immediately, then fire the write in the
    // background. Withdrawing a pending request is a fire-and-forget status
    // change: server-side the UPDATE is ~10ms, but awaiting the REST round trip
    // showed a 6-8s spinner whenever the call stalled (cold realtime socket /
    // token-refresh auth-lock on RN). Optimistic update + rollback removes the
    // wait without losing correctness — the realtime broadcast reconciles the
    // cache once the write commits.
    queryClient.setQueryData<import('../../hooks/trips/useTripDetail').TripCoreData>(
      tripsKeys.detail(tripId),
      prev =>
        prev && prev.myRequest
          ? { ...prev, myRequest: { ...prev.myRequest, status: 'withdrawn' } }
          : prev
    );

    try {
      await withdrawJoinRequest(reqId);
    } catch (e: any) {
      // Roll back so the CTA reflects reality (write never committed).
      queryClient.setQueryData<import('../../hooks/trips/useTripDetail').TripCoreData>(
        tripsKeys.detail(tripId),
        prev =>
          prev && prev.myRequest
            ? { ...prev, myRequest: { ...prev.myRequest, status: prevStatus } }
            : prev
      );
      hapticError();
      Alert.alert('Could not withdraw', friendlyErrorMessage(e, 'Please try again.'));
    }
  };

  const handleApprove = async (requestId: string) => {
    hapticSuccess();
    const approved = pendingRequests.find(r => r.id === requestId);
    // Snapshot both caches for rollback.
    const prevRequests =
      queryClient.getQueryData<import('../../hooks/trips/useTripDetail').TripRequestsData>(
        tripsKeys.detailRequests(tripId)
      );
    const prevCore =
      queryClient.getQueryData<import('../../hooks/trips/useTripDetail').TripCoreData>(
        tripsKeys.detail(tripId)
      );

    // Optimistically move the row out of "pending" and into the participant list
    // right away, instead of holding a spinner for the whole REST round trip. The
    // invalidate on success reconciles with the server's canonical row.
    queryClient.setQueryData<import('../../hooks/trips/useTripDetail').TripRequestsData>(
      tripsKeys.detailRequests(tripId),
      prev => (prev ? { ...prev, pending: prev.pending.filter(r => r.id !== requestId) } : prev)
    );
    if (approved) {
      const newParticipant: EnrichedParticipant = {
        ...approved.requester,
        role: 'member',
        joined_at: new Date().toISOString(),
        committed: false,
        commitment_status: 'none',
        commitment_items: [],
        commitment_note: null,
        personal_gear_by_host: [],
        personal_gear_by_me: [],
      };
      queryClient.setQueryData<import('../../hooks/trips/useTripDetail').TripCoreData>(
        tripsKeys.detail(tripId),
        prev =>
          prev && !prev.participants.some(p => p.user_id === newParticipant.user_id)
            ? { ...prev, participants: [...prev.participants, newParticipant] }
            : prev
      );
    }

    try {
      await approveJoinRequest(requestId);
      queryClient.invalidateQueries({ queryKey: tripsKeys.detail(tripId) });
      queryClient.invalidateQueries({ queryKey: tripsKeys.detailRequests(tripId) });
      queryClient.invalidateQueries({ queryKey: ['trips', 'my'] });
    } catch (e: any) {
      // Roll back both caches — the approval never committed.
      if (prevRequests)
        queryClient.setQueryData(tripsKeys.detailRequests(tripId), prevRequests);
      if (prevCore) queryClient.setQueryData(tripsKeys.detail(tripId), prevCore);
      hapticError();
      Alert.alert('Could not approve', friendlyErrorMessage(e, 'Please try again.'));
    }
  };

  const handleOpenGroupChat = async () => {
    if (!trip || !onOpenGroupChat) return;
    setOpeningChat(true);
    try {
      let conv = await messagingService.getConversationByTripId(trip.id);
      if (!conv) {
        // Legacy trip created before this feature shipped — create the conversation lazily.
        conv = await messagingService.createGroupConversation(
          trip.title || 'Surftrip',
          [],
          { trip_id: trip.id }
        );
      }
      onOpenGroupChat({
        conversationId: conv.id,
        title: trip.title || 'Surftrip',
        heroImageUrl: trip.hero_image_url ?? null,
        tripId: trip.id,
      });
    } catch (e: any) {
      Alert.alert('Could not open chat', friendlyErrorMessage(e, 'Please try again.'));
    } finally {
      setOpeningChat(false);
    }
  };

  const handleDecline = async (requestId: string) => {
    hapticLight();
    const moved = pendingRequests.find(r => r.id === requestId);
    const prevRequests =
      queryClient.getQueryData<import('../../hooks/trips/useTripDetail').TripRequestsData>(
        tripsKeys.detailRequests(tripId)
      );

    // Optimistically move the row from "pending" to "declined" immediately,
    // instead of holding a spinner until the REST round trip returns.
    queryClient.setQueryData<import('../../hooks/trips/useTripDetail').TripRequestsData>(
      tripsKeys.detailRequests(tripId),
      prev => {
        if (!prev) return prev;
        return {
          pending: prev.pending.filter(r => r.id !== requestId),
          declined: moved
            ? [{ ...moved, status: 'declined' as const }, ...prev.declined.filter(r => r.id !== requestId)]
            : prev.declined,
        };
      }
    );

    try {
      await declineJoinRequest(requestId);
    } catch (e: any) {
      // Roll back — the decline never committed.
      if (prevRequests)
        queryClient.setQueryData(tripsKeys.detailRequests(tripId), prevRequests);
      hapticError();
      Alert.alert('Could not decline', friendlyErrorMessage(e, 'Please try again.'));
    }
  };

  const handleRemoveParticipant = (userId: string) => {
    const target = participants.find(p => p.user_id === userId);
    const name = target?.name || 'this participant';
    Alert.alert(
      'Remove from trip',
      `Are you sure you want to remove ${name}? They'll be notified and removed from the group chat.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setRemovingUserId(userId);
            try {
              await removeParticipant(tripId, userId);
              queryClient.setQueryData<import('../../hooks/trips/useTripDetail').TripCoreData>(
                tripsKeys.detail(tripId),
                prev =>
                  prev ? { ...prev, participants: prev.participants.filter(p => p.user_id !== userId) } : prev
              );
            } catch (e: any) {
              Alert.alert('Could not remove', friendlyErrorMessage(e, 'Please try again.'));
            } finally {
              setRemovingUserId(null);
            }
          },
        },
      ]
    );
  };

  const handleCancelTrip = () => {
    Alert.alert(
      'Cancel trip',
      'This will hide the trip from Explore. Existing participants will see it as cancelled. You can\'t undo this.',
      [
        { text: 'Keep trip', style: 'cancel' },
        {
          text: 'Cancel trip',
          style: 'destructive',
          onPress: async () => {
            setCancelling(true);
            try {
              await cancelTrip(tripId);
              queryClient.setQueryData<import('../../hooks/trips/useTripDetail').TripCoreData>(
                tripsKeys.detail(tripId),
                prev => (prev && prev.trip ? { ...prev, trip: { ...prev.trip, status: 'cancelled' } } : prev)
              );
              queryClient.invalidateQueries({ queryKey: ['trips', 'my'] });
              queryClient.invalidateQueries({ queryKey: tripsKeys.explore });
            } catch (e: any) {
              Alert.alert('Could not cancel', friendlyErrorMessage(e, 'Please try again.'));
            } finally {
              setCancelling(false);
            }
          },
        },
      ]
    );
  };

  const handleCompleteTrip = () => {
    Alert.alert(
      'Mark trip as completed?',
      "This closes the trip. Members keep the group chat and overview, but the plan is locked. You can't undo this.",
      [
        { text: 'Keep open', style: 'cancel' },
        {
          text: 'Mark completed',
          style: 'destructive',
          onPress: async () => {
            setCompleting(true);
            try {
              await completeTrip(tripId);
              queryClient.setQueryData<import('../../hooks/trips/useTripDetail').TripCoreData>(
                tripsKeys.detail(tripId),
                prev => (prev && prev.trip ? { ...prev, trip: { ...prev.trip, status: 'completed' } } : prev)
              );
              queryClient.invalidateQueries({ queryKey: ['trips', 'my'] });
              setActiveTab('overview');
            } catch (e: any) {
              Alert.alert('Could not complete', friendlyErrorMessage(e, 'Please try again.'));
            } finally {
              setCompleting(false);
            }
          },
        },
      ]
    );
  };

  const handleLeaveTrip = () => {
    if (!currentUserId) return;
    Alert.alert(
      'Leave trip',
      "You'll be removed from the group chat. You can request to join again later.",
      [
        { text: 'Stay', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            setLeaving(true);
            try {
              await leaveTrip(tripId, currentUserId);
              queryClient.setQueryData<import('../../hooks/trips/useTripDetail').TripCoreData>(
                tripsKeys.detail(tripId),
                prev =>
                  prev ? { ...prev, participants: prev.participants.filter(p => p.user_id !== currentUserId) } : prev
              );
              queryClient.invalidateQueries({ queryKey: ['trips', 'my'] });
            } catch (e: any) {
              Alert.alert('Could not leave', friendlyErrorMessage(e, 'Please try again.'));
            } finally {
              setLeaving(false);
            }
          },
        },
      ]
    );
  };


  // ---- Host-only inline edits (Figma admin view). Each persists one field via
  // updateGroupTrip and merges it locally (updateGroupTrip returns only the base
  // row, so we keep the existing joined `destination`/host data on `trip`).
  const patchTripCache = (patch: Partial<GroupTrip>) => {
    queryClient.setQueryData<import('../../hooks/trips/useTripDetail').TripCoreData>(
      tripsKeys.detail(tripId),
      prev => (prev && prev.trip ? { ...prev, trip: { ...prev.trip, ...patch } } : prev)
    );
    queryClient.invalidateQueries({ queryKey: ['trips', 'my'] });
  };

  const handleSaveCover = async (localUri: string) => {
    if (!trip || !currentUserId) return;
    const res = await uploadTripImage(localUri, currentUserId, 'hero');
    if (!res.success || !res.url) throw new Error(res.error || 'Failed to upload cover');
    await updateGroupTrip(trip.id, { hero_image_url: res.url });
    patchTripCache({ hero_image_url: res.url });
  };

  const handleSaveAboutHost = async (text: string) => {
    if (!trip) return;
    const next = text || null;
    await updateGroupTrip(trip.id, { host_lead_note: next });
    patchTripCache({ host_lead_note: next });
  };

  const handleSaveDescription = async (text: string) => {
    if (!trip) return;
    await updateGroupTrip(trip.id, { description: text });
    patchTripCache({ description: text });
  };

  const handleSaveDates = async (patch: DatesPatch) => {
    if (!trip) return;
    await updateGroupTrip(trip.id, patch);
    patchTripCache(patch);
  };

  const handleSaveAccommodation = async (next: AccommodationInitial) => {
    if (!trip || !currentUserId) return;
    let imageUrl = next.photoUri;
    if (next.photoUri && !/^https?:\/\//.test(next.photoUri)) {
      const res = await uploadTripImage(next.photoUri, currentUserId, 'accommodation');
      if (!res.success || !res.url) throw new Error(res.error || 'Failed to upload stay photo');
      imageUrl = res.url;
    }
    const patch = {
      accommodation_type: next.kind ? [next.kind] : null,
      accommodation_name: next.name || null,
      accommodation_url: next.url || null,
      accommodation_image_url: imageUrl,
      specific_stay_selected: true,
    };
    await updateGroupTrip(trip.id, patch);
    patchTripCache(patch);
  };

  const handleShare = async () => {
    if (!trip) return;
    try {
      const url = getGroupTripInviteUrl(trip.id);
      const name = trip.title?.trim() || 'my surf trip';
      // Keep the URL in `message` so it survives apps that ignore the `url`
      // field (WhatsApp, etc.); `url` gives iOS a rich link target. Without
      // this the share pasted as plain text with no link.
      await Share.share({
        message: `Yo! check out my trip "${name}" on Swellyo! 🌊\n${url}`,
        url,
      });
      logEvent('trip_invite_shared', { tripId: trip.id });
    } catch {
      // user cancelled or platform unavailable — silently no-op
    }
  };


  const handleOpenCommitSheet = () => {
    if (!currentUserId) return;
    onOpenCommitment?.({
      tripTitle: trip?.title ?? null,
      initialItems: myCommitmentItems,
      initialNote: myCommitmentNote,
    });
  };

  const patchParticipantsCache = (updater: (p: EnrichedParticipant) => EnrichedParticipant) => {
    queryClient.setQueryData<import('../../hooks/trips/useTripDetail').TripCoreData>(
      tripsKeys.detail(tripId),
      prev =>
        prev ? { ...prev, participants: prev.participants.map(p => p.user_id === currentUserId ? updater(p) : p) } : prev
    );
  };

  const handleToggleGroupGearItem = async (itemName: string) => {
    if (!currentUserId) return;
    const current = myGroupGear;
    const next: GroupGearItem[] = current.map(it =>
      it.name === itemName ? { ...it, done: !it.done } : it
    );
    patchParticipantsCache(p => ({ ...p, personal_gear_by_host: next }));
    try {
      await setMyGroupGear(tripId, currentUserId, next);
    } catch (e: any) {
      patchParticipantsCache(p => ({ ...p, personal_gear_by_host: current }));
      Alert.alert('Could not update', friendlyErrorMessage(e, 'Please try again.'));
    }
  };

  // -------------------------------------------------------------------------
  // Personal gear (member-private) handlers
  // -------------------------------------------------------------------------
  const persistPersonalGear = async (next: PersonalGearItem[], previous: PersonalGearItem[]) => {
    if (!currentUserId) return;
    patchParticipantsCache(p => ({ ...p, personal_gear_by_me: next }));
    try {
      await setMyPersonalGearList(tripId, currentUserId, next);
    } catch (e: any) {
      patchParticipantsCache(p => ({ ...p, personal_gear_by_me: previous }));
      Alert.alert('Could not update', friendlyErrorMessage(e, 'Please try again.'));
    }
  };

  const handleTogglePersonalItem = (itemName: string) => {
    const current = myPersonalGear;
    const next = current.map(it => (it.name === itemName ? { ...it, done: !it.done } : it));
    persistPersonalGear(next, current);
  };

  const handleRemovePersonalItem = (itemName: string) => {
    const current = myPersonalGear;
    const next = current.filter(it => it.name !== itemName);
    persistPersonalGear(next, current);
  };

  const handleStartAddPersonalItem = () => {
    setPersonalItemDraft('');
    setAddingPersonalItem(true);
  };

  const handleCancelAddPersonalItem = () => {
    setAddingPersonalItem(false);
    setPersonalItemDraft('');
  };

  const handleSavePersonalItem = async () => {
    if (!currentUserId) return;
    const name = personalItemDraft.trim();
    if (!name) {
      handleCancelAddPersonalItem();
      return;
    }
    // Reject duplicates against host list or my own list.
    const hostNames = (trip?.personal_gear_host_suggestion ?? []).map(n => n.toLowerCase());
    const myNames = myPersonalGear.map(i => i.name.toLowerCase());
    if (hostNames.includes(name.toLowerCase()) || myNames.includes(name.toLowerCase())) {
      Alert.alert('Already on your list', `"${name}" is already in your gear.`);
      return;
    }
    setSavingPersonalItem(true);
    const current = myPersonalGear;
    const next: PersonalGearItem[] = [...current, { name, done: false }];
    try {
      await setMyPersonalGearList(tripId, currentUserId, next);
      patchParticipantsCache(p => ({ ...p, personal_gear_by_me: next }));
      handleCancelAddPersonalItem();
    } catch (e: any) {
      Alert.alert('Could not add', friendlyErrorMessage(e, 'Please try again.'));
    } finally {
      setSavingPersonalItem(false);
    }
  };

  const handleStartEditPacking = () => {
    if (!trip) return;
    setGroupGearDraft((trip.personal_gear_host_suggestion ?? []).join('\n'));
    setEditingPacking(true);
  };

  const handleCancelEditPacking = () => {
    setEditingPacking(false);
    setGroupGearDraft('');
  };

  const handleSavePacking = async () => {
    if (!trip) return;
    const names = groupGearDraft
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);
    setSavingPacking(true);
    try {
      await setTripGroupGear(tripId, names);
      // Trigger refetches for both trip (personal_gear_host_suggestion) and participants.
      queryClient.invalidateQueries({ queryKey: tripsKeys.detail(tripId) });
      setEditingPacking(false);
      setGroupGearDraft('');
    } catch (e: any) {
      Alert.alert('Could not save list', friendlyErrorMessage(e, 'Please try again.'));
    } finally {
      setSavingPacking(false);
    }
  };

  // -------------------------------------------------------------------------
  // Group Gear handlers
  // -------------------------------------------------------------------------
  const handleSetGearClaim = async (itemId: string, quantity: number) => {
    if (!currentUserId) return;
    try {
      await setMyGearClaim(itemId, currentUserId, quantity);
      queryClient.invalidateQueries({ queryKey: tripsKeys.detailGear(tripId) });
    } catch (e: any) {
      Alert.alert('Could not update', friendlyErrorMessage(e, 'Please try again.'));
    }
  };

  const handleSubmitGearRequest = async (itemName: string, note: string) => {
    if (!currentUserId) return;
    try {
      await createGearRequest(tripId, currentUserId, itemName, note || undefined);
      Alert.alert('Request sent', 'The host will review your request.');
    } catch (e: any) {
      hapticError();
      Alert.alert('Could not send request', friendlyErrorMessage(e, 'Please try again.'));
      throw e;
    }
  };

  const handleSaveGearItem = async (
    patch: { name: string; needed_qty: number },
    itemId?: string
  ) => {
    if (!currentUserId) return;
    if (itemId) {
      await updateGearItem(itemId, patch);
    } else {
      await addGearItem(tripId, currentUserId, patch.name, patch.needed_qty);
    }
    queryClient.invalidateQueries({ queryKey: tripsKeys.detailGear(tripId) });
  };

  const handleDeleteGearItem = async (itemId: string) => {
    await deleteGearItem(itemId);
    queryClient.invalidateQueries({ queryKey: tripsKeys.detailGear(tripId) });
  };

  const handleApproveGearRequest = async (request: EnrichedGearRequest, neededQty: number, itemName: string) => {
    setProcessingGearRequestId(request.id);
    try {
      await approveGearRequest(request.id, neededQty, itemName);
      queryClient.invalidateQueries({ queryKey: tripsKeys.detailGear(tripId) });
      queryClient.invalidateQueries({ queryKey: tripsKeys.detailGearRequests(tripId) });
    } catch (e: any) {
      hapticError();
      Alert.alert('Could not approve', friendlyErrorMessage(e, 'Please try again.'));
    } finally {
      setProcessingGearRequestId(null);
    }
  };

  const handleDeclineGearRequest = async (request: EnrichedGearRequest) => {
    setProcessingGearRequestId(request.id);
    try {
      await declineGearRequest(request.id);
      queryClient.invalidateQueries({ queryKey: tripsKeys.detailGearRequests(tripId) });
    } catch (e: any) {
      hapticError();
      Alert.alert('Could not decline', friendlyErrorMessage(e, 'Please try again.'));
    } finally {
      setProcessingGearRequestId(null);
    }
  };

  // -------------------------------------------------------------------------
  // Admin updates handlers
  // -------------------------------------------------------------------------
  // ── Requirements ──────────────────────────────────────────────────────────
  /**
   * Wait for the webhook after Checkout, and make sure the wait ENDS somewhere.
   *
   * The browser closing is not proof of payment — the webhook is the only
   * truth, and it has not necessarily landed the instant the sheet closes. So
   * we poll. Two things about the schedule are deliberate:
   *
   *  • It opens at 700ms, not 1500. Most webhooks land inside that, so the row
   *    usually ticks over almost the moment the traveler is back — the
   *    difference between "it just worked" and "it thought about it first".
   *  • It backs off to ~14s total, where it used to give up at 8. Stripe is
   *    normally sub-second, but a retried delivery is not, and every second
   *    spent here is a second not spent in the far worse `pending` state.
   *
   * `quiet` is for the `abandoned` outcome — no redirect came back, so this is
   * almost certainly someone who swiped the sheet away. It checks anyway, in
   * case a real payment lost its redirect, but spends no UI on it and gives up
   * early. Critically it does NOT leave the row in `pending`: parking a
   * "Processing" state on a payment the traveler deliberately walked out of
   * would lock them out of ever making it.
   *
   * `detailDocuments` is the traveler's own requirement list (it wraps
   * fetchMyRequirements). There is no `myRequirements` key — do not invent one.
   */
  const confirmPayment = useCallback(
    async (row: { requirementId: string; title: string }, opts: { quiet: boolean }) => {
      const delaysMs = opts.quiet ? [700, 1500, 2500] : [700, 1000, 1500, 2500, 3500, 5000];
      if (!opts.quiet) setConfirmingRequirementId(row.requirementId);
      try {
        for (const delayMs of delaysMs) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
          if (currentUserId) {
            await queryClient.refetchQueries({ queryKey: tripsKeys.payments(tripId, currentUserId) });
          }
          await queryClient.refetchQueries({ queryKey: tripsKeys.detailDocuments(tripId) });
          const freshRows = queryClient.getQueryData<TripRequirement[]>(
            tripsKeys.detailDocuments(tripId),
          );
          if (freshRows?.find(r => r.requirementId === row.requirementId)?.state === 'approved') {
            // The row ticks itself off; the haptic is what makes it land as an
            // event rather than a checkbox that quietly changed while they
            // weren't looking.
            hapticSuccess();
            setPaymentAttempts(prev => {
              void clearPaymentAttempt(tripId, row.requirementId, prev);
              const next = { ...prev };
              delete next[row.requirementId];
              return next;
            });
            return;
          }
        }
      } finally {
        setConfirmingRequirementId(null);
      }

      // Ran out of patience. The old code returned the row to "Pay" here and
      // said nothing — which, to someone who has just been through Checkout
      // for $2,000, reads as "it didn't work, do it again". That is how people
      // pay twice. Say what we actually know instead: we don't know yet.
      if (opts.quiet) return;
      const startedAt = Date.now();
      setPaymentAttempts(prev => {
        void recordPaymentAttempt(tripId, row.requirementId, prev, startedAt);
        return { ...prev, [row.requirementId]: startedAt };
      });
      hapticMedium();
      setPaymentIssue({ mode: 'pending', requirementId: row.requirementId, title: row.title });
    },
    [currentUserId, tripId, queryClient],
  );

  // Restore unconfirmed attempts for this trip. This is the whole point of the
  // store: without it, coming back to the screen hands a plain "Pay" button to
  // someone whose money may already be gone.
  useEffect(() => {
    if (!tripId) return;
    let alive = true;
    loadPaymentAttempts(tripId).then(stored => {
      if (!alive) return;
      // Merged, not replaced. A hydrate that resolves AFTER a payment made in
      // this same session would otherwise wipe the fresher in-memory record.
      setPaymentAttempts(prev => ({ ...stored, ...prev }));
    });
    return () => {
      alive = false;
    };
  }, [tripId]);

  // Age `pending` out of "Processing" while the screen stays open. Only runs
  // while something is actually in that window, and stops on its own once the
  // last one crosses it.
  const hasPendingAttempt = useMemo(
    () => Object.values(paymentAttempts).some(at => attemptPhase(at, Date.now()) === 'pending'),
    [paymentAttempts, attemptTick],
  );
  useEffect(() => {
    if (!hasPendingAttempt) return;
    const id = setInterval(() => setAttemptTick(t => t + 1), 30000);
    return () => clearInterval(id);
  }, [hasPendingAttempt]);

  // While a payment is stuck in `pending`, keep asking. The traveler should
  // not have to pull-to-refresh to find out whether their money arrived, and
  // the row is designed to resolve itself under them.
  //
  // Capped at ~2 minutes: past that the webhook is not merely late, and an
  // interval that never stops would keep firing behind a screen the traveler
  // has stopped looking at. The `pending` row survives the cap — giving up on
  // polling is not the same as giving up on the state.
  useEffect(() => {
    if (!hasPendingAttempt || !tripId) return;
    let stopped = false;

    const check = async () => {
      if (stopped) return;
      if (currentUserId) {
        await queryClient.refetchQueries({ queryKey: tripsKeys.payments(tripId, currentUserId) });
      }
      await queryClient.refetchQueries({ queryKey: tripsKeys.detailDocuments(tripId) });
      if (stopped) return;
      const freshRows = queryClient.getQueryData<TripRequirement[]>(
        tripsKeys.detailDocuments(tripId),
      );
      if (!freshRows) return;

      // Every pending attempt, not just one: a trip can have both a deposit
      // and a balance mid-flight, and the old single-id version could only
      // ever resolve whichever was stored last.
      const landed = Object.keys(paymentAttemptsRef.current).filter(
        reqId => freshRows.find(r => r.requirementId === reqId)?.state === 'approved',
      );
      if (landed.length === 0) return;

      hapticSuccess();
      setPaymentAttempts(prev => {
        const next = { ...prev };
        for (const reqId of landed) {
          delete next[reqId];
          void clearPaymentAttempt(tripId, reqId, prev);
        }
        return next;
      });
      // Close the explanation if they happen to be reading it — it is about to
      // be describing something that is no longer true.
      setPaymentIssue(prev =>
        prev && prev.mode === 'pending' && landed.includes(prev.requirementId) ? null : prev,
      );
    };

    const interval = setInterval(check, 5000);
    const giveUp = setTimeout(() => clearInterval(interval), 120000);
    return () => {
      stopped = true;
      clearInterval(interval);
      clearTimeout(giveUp);
    };
  }, [hasPendingAttempt, tripId, currentUserId, queryClient]);

  // "Try again" has to re-enter the row handler, which is declared below it
  // (the sheet is wired before the list it belongs to). A ref, not a reorder:
  // the handler already closes over `confirmPayment`, so hoisting it above
  // this would only move the cycle rather than remove it.
  const handlePressDocumentRowRef = useRef<((row: DocumentRow) => Promise<void>) | null>(null);

  /**
   * The primary button on PaymentStatusSheet. The two modes want opposite
   * things from it, which is exactly why it is one button and not two sheets:
   *
   *  • `failed` — nothing happened, so "Try again" means try again. Close
   *    first: Checkout opens a browser sheet, and stacking that over a bottom
   *    sheet mid-dismiss is how iOS strands an invisible view controller that
   *    swallows every touch underneath.
   *
   *  • `pending` — something may be in flight, so the button must NEVER start
   *    a second checkout. It re-asks the server, and the sheet stays open with
   *    a spinner so the answer arrives where the question was asked. On a hit
   *    it closes itself; on a miss it stays, which is the honest outcome —
   *    silently closing would read as "sorted", and it isn't.
   */
  const handleRetryPayment = useCallback(async () => {
    const issue = paymentIssue;
    if (!issue) return;

    // "Pay anyway" — they have read the warning and decided. Forget the
    // attempt FIRST, or the retry would immediately hit the same gate and
    // re-open this sheet instead of opening Checkout.
    if (issue.mode === 'unconfirmed') {
      setPaymentIssue(null);
      const cleared = await clearPaymentAttempt(
        tripId,
        issue.requirementId,
        paymentAttemptsRef.current,
      );
      // The ref is normally assigned during render; set it by hand here so the
      // gate below sees the cleared map without waiting for one.
      paymentAttemptsRef.current = cleared;
      setPaymentAttempts(cleared);
      const row = documentRows.find(r => r.requirementId === issue.requirementId);
      if (row) await handlePressDocumentRowRef.current?.({ ...row, pending: false });
      return;
    }

    if (issue.mode === 'failed') {
      setPaymentIssue(null);
      const row = documentRows.find(r => r.requirementId === issue.requirementId);
      if (row) await handlePressDocumentRowRef.current?.(row);
      return;
    }

    setRecheckingPayment(true);
    try {
      if (currentUserId) {
        await queryClient.refetchQueries({ queryKey: tripsKeys.payments(tripId, currentUserId) });
      }
      await queryClient.refetchQueries({ queryKey: tripsKeys.detailDocuments(tripId) });
      const freshRows = queryClient.getQueryData<TripRequirement[]>(
        tripsKeys.detailDocuments(tripId),
      );
      if (freshRows?.find(r => r.requirementId === issue.requirementId)?.state === 'approved') {
        hapticSuccess();
        const cleared = await clearPaymentAttempt(
          tripId,
          issue.requirementId,
          paymentAttemptsRef.current,
        );
        paymentAttemptsRef.current = cleared;
        setPaymentAttempts(cleared);
        setPaymentIssue(null);
      } else {
        // Not a failure — just not yet. A light tap acknowledges the press
        // without implying anything went wrong.
        hapticLight();
      }
    } finally {
      setRecheckingPayment(false);
    }
  }, [paymentIssue, documentRows, currentUserId, tripId, queryClient]);

  // One tap handler for all six kinds. Where it goes depends on what the
  // requirement wants: a file, an agreement, or a form.
  const handlePressDocumentRow = useCallback(
    async (row: DocumentRow) => {
      if (row.reqType === 'pay') {
        // Already paid — don't round-trip to the edge function just to be
        // told "Already paid". Also skips a re-tap while we're already
        // polling this exact row.
        if (row.state === 'approved' || row.confirming) return;

        // Stuck in `pending`: the tap must NOT open a second checkout. It
        // opens the explanation instead — the row is deliberately still
        // tappable so the traveler has somewhere to go with the question
        // "did my money arrive?", just not somewhere that charges them again.
        if (row.pending) {
          setPaymentIssue({ mode: 'pending', requirementId: row.requirementId, title: row.title });
          return;
        }

        // Past the 30-minute window the row is back to a normal "Pay", but we
        // still remember the attempt for a week — and this is the gate that
        // memory buys. Letting expiry hand back a plain one-tap payment would
        // just re-open the double-payment trap on a delay.
        // Read through the ref, not the state: "Pay anyway" clears the attempt
        // and re-enters this handler in the same tick, before a re-render has
        // refreshed any closure. Off the state it would hit the gate it just
        // cleared and bounce straight back into the sheet.
        const attemptAt = paymentAttemptsRef.current[row.requirementId];
        if (attemptAt && attemptPhase(attemptAt, Date.now()) === 'unconfirmed') {
          setPaymentIssue({
            mode: 'unconfirmed',
            requirementId: row.requirementId,
            title: row.title,
            attemptAge: describeAttemptAge(attemptAt),
          });
          return;
        }

        let outcome: CheckoutOutcome;
        try {
          outcome = await startCheckout(row.requirementId);
        } catch (e) {
          // Was: a one-button OS alert. Now the traveler gets the reason, a
          // retry, and a way to reach the operator — see PaymentStatusSheet.
          hapticError();
          setPaymentIssue({
            mode: 'failed',
            requirementId: row.requirementId,
            title: row.title,
            reason: friendlyErrorMessage(e, 'Something went wrong before you reached the payment page.'),
          });
          return;
        }

        // They pressed "back" inside Checkout. Nothing was charged, nothing is
        // in flight, and there is nothing to confirm — so do nothing at all.
        // This used to be eight seconds of "Confirming…" for a payment that
        // never started, which is the single most confusing thing this screen
        // did.
        if (outcome === 'cancelled') return;

        await confirmPayment(row, { quiet: outcome === 'abandoned' });
        return;
      }

      const action = actionForRequirement({ kind: row.kind, reqType: row.reqType });
      if (!action) return; // custom — no traveler UI yet
      // Pay rows already returned above via `row.reqType === 'pay'`, but
      // `actionForRequirement`'s return type still allows 'pay' — narrow it
      // explicitly so `open()` below can hand a non-pay action to
      // `setOpenRequirement`, which never learned about payment sheets.
      if (action === 'pay') return;

      const open = () =>
        setOpenRequirement({
          requirementId: row.requirementId,
          kind: row.kind as RequirementKind,
          action,
          note: row.note ?? null,
          agreed: row.state === 'approved',
        });

      // Agreements and the medical form are re-openable in every state: the
      // traveler may want to re-read the waiver or correct an allergy.
      if (action === 'agree' || action === 'medical') {
        open();
        return;
      }

      // Uploads: nothing sent yet (or rejected) opens the picker.
      if (row.state === 'not_started' || row.state === 'overdue' || row.state === 'rejected') {
        open();
        return;
      }

      // 'submitted' or 'approved' — show them what they sent. The storage path
      // is fetched on demand; it is not kept in the requirement row.
      if (!currentUserId) return;
      try {
        const doc = await fetchMyDocument(tripId, row.requirementId, currentUserId);
        if (doc?.storagePath && !doc.fileDeletedAt) {
          setViewingDoc({ storagePath: doc.storagePath, kind: row.kind, title: row.title });
        } else {
          // Past the 30-day purge the row survives but the file does not. Say so
          // rather than opening an empty viewer.
          Alert.alert('No longer available', 'This file has been deleted.');
        }
      } catch (e) {
        console.error('[TripDetail] could not load document');
        showErrorAlert('Something went wrong', e, 'Could not open this document.');
      }
    },
    [currentUserId, tripId, queryClient, confirmPayment],
  );
  handlePressDocumentRowRef.current = handlePressDocumentRow;

  const handleRequirementDone = useCallback(() => {
    setOpenRequirement(null);
    // Every state is derived server-side, so refetch rather than guess.
    queryClient.invalidateQueries({ queryKey: tripsKeys.detailDocuments(tripId) });
  }, [queryClient, tripId]);

  const handleStartAddUpdate = () => {
    setEditingUpdateId(null);
    setUpdateTitleDraft('');
    setUpdateDraft('');
    setAddingUpdate(true);
  };

  const handleCancelUpdateDraft = () => {
    setAddingUpdate(false);
    setEditingUpdateId(null);
    setUpdateTitleDraft('');
    setUpdateDraft('');
  };

  const patchUpdatesCache = (updater: (prev: AdminUpdate[]) => AdminUpdate[]) => {
    queryClient.setQueryData<AdminUpdate[]>(tripsKeys.detailUpdates(tripId), prev =>
      updater(prev ?? [])
    );
  };

  const handleEditUpdate = (update: AdminUpdate) => {
    setAddingUpdate(false);
    setEditingUpdateId(update.id);
    setUpdateTitleDraft(update.title);
    setUpdateDraft(update.body);
  };

  const handleDeleteUpdate = (update: AdminUpdate) => {
    Alert.alert('Delete update', 'This update will be removed for everyone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteAdminUpdate(update.id);
            patchUpdatesCache(prev => prev.filter(u => u.id !== update.id));
            if (editingUpdateId === update.id) handleCancelUpdateDraft();
          } catch (e: any) {
            Alert.alert('Could not delete', friendlyErrorMessage(e, 'Please try again.'));
          }
        },
      },
    ]);
  };

  const handleLongPressUpdate = (update: AdminUpdate) => {
    if (!isHost) return;
    Alert.alert('Update', undefined, [
      { text: 'Edit', onPress: () => handleEditUpdate(update) },
      { text: 'Delete', style: 'destructive', onPress: () => handleDeleteUpdate(update) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  // -------------------------------------------------------------------------
  // Sheet-driven handlers (Plan tab redesign — bottom sheets replace the old
  // inline editors).
  // -------------------------------------------------------------------------
  const handleSubmitUpdateBody = async (title: string, body: string) => {
    if (!currentUserId) return;
    const titleText = title.trim();
    if (!titleText) {
      handleCancelUpdateDraft();
      return;
    }
    const bodyText = body.trim();
    setSavingUpdate(true);
    try {
      if (editingUpdateId) {
        const updated = await updateAdminUpdate(editingUpdateId, titleText, bodyText);
        patchUpdatesCache(prev => prev.map(u => (u.id === updated.id ? updated : u)));
      } else {
        const created = await addAdminUpdate(tripId, currentUserId, titleText, bodyText);
        patchUpdatesCache(prev => [created, ...prev]);
      }
      handleCancelUpdateDraft();
    } catch (e: any) {
      Alert.alert('Could not save update', friendlyErrorMessage(e, 'Please try again.'));
    } finally {
      setSavingUpdate(false);
    }
  };

  // Host edits the suggested gear list — called with the full new array after
  // each add/edit/delete. Persists then refetches so member copies stay in sync.

  const handleAddPersonalSubmit = async (name: string) => {
    if (!currentUserId) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    setSavingPersonalItem(true);
    const current = myPersonalGear;
    const next: PersonalGearItem[] = [...current, { name: trimmed, done: false }];
    try {
      await setMyPersonalGearList(tripId, currentUserId, next);
      patchParticipantsCache(p => ({ ...p, personal_gear_by_me: next }));
      setAddPersonalSheetOpen(false);
    } catch (e: any) {
      Alert.alert('Could not add', friendlyErrorMessage(e, 'Please try again.'));
    } finally {
      setSavingPersonalItem(false);
    }
  };

  // -------------------------------------------------------------------------
  if (coreQuery.isLoading && !coreQuery.data) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <Header onBack={onBack} />
        <TripDetailSkeleton />
      </SafeAreaView>
    );
  }

  // Once the core query has actually resolved (not loading, not placeholder-seeded)
  // and trip is still null, the trip was deleted/not found — show a minimal fallback.
  if (!trip && !coreQuery.isLoading && !coreQuery.isPlaceholderData) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <Header onBack={onBack} />
        <View style={styles.centered}>
          <Text style={styles.errorText}>This trip is no longer available.</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Still in-flight but trip is null (no placeholder seed available) — show skeleton.
  if (!trip) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <Header onBack={onBack} />
        <TripDetailSkeleton />
      </SafeAreaView>
    );
  }

  const isCancelled = trip.status === 'cancelled';
  const isCompleted = trip.status === 'completed';
  // A trip that has ended by date is treated like a completed one: the plan is
  // locked, only the overview + group chat stay active. Explicit completion or
  // cancellation lock it the same way.
  const isLocked = isCancelled || isCompleted || isTripPast(trip);

  // Whether a floating sticky CTA (join request / trip chat) is showing — drives
  // the extra scroll bottom padding so content clears the floating button.
  // Both CTAs wait for membershipKnown: with placeholder data every viewer
  // looks like a non-member, and members would see "Request to Join" flash.
  // A short blank beats a wrong button.
  const showJoinCta =
    membershipKnown &&
    !isHost && !isCancelled && !isApprovedMember && myRequest?.status !== 'approved';
  // Trip full = a cap is set and it's reached. participant_count is the
  // trigger-maintained denormalized count (incl. host) shown as "X/Y going" —
  // reliable even for non-members whose `participants` array is RLS-trimmed.
  const isFull =
    trip?.max_participants != null &&
    (trip?.participant_count ?? 0) >= trip.max_participants;
  // isHost derives from trip.host_id, which the placeholder DOES carry — hosts
  // get their chat CTA immediately; members wait one fetch.
  const showChatCta = (isHost || (membershipKnown && isApprovedMember)) && !isCancelled;
  const stickyCtaVisible = showJoinCta || showChatCta;

  // Has the trip started yet? Gates "Mark as completed" — a host can close a
  // trip that's underway, not an upcoming one.
  const tripHasStarted = (() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (trip.start_date) {
      const s = new Date(trip.start_date);
      s.setHours(0, 0, 0, 0);
      return s <= today;
    }
    if (trip.date_months && trip.date_months.length > 0) {
      const earliest = [...trip.date_months].sort()[0];
      const [y, m] = earliest.split('-').map(Number);
      return new Date() >= new Date(y, m - 1, 1);
    }
    return true; // no dates set — let the host decide
  })();

  // canSeePlan / canSeeDashboard / visibleTabs are computed above the early
  // returns — see the "Which tabs exist" block — so their hooks always run.
  const showPlan = canSeePlan && activeTab === 'plan';
  const showDashboard = canSeeDashboard && activeTab === 'dashboard';
  /** Anything that replaces the Overview body. */
  const bodyReplaced = showPlan || showDashboard;
  // One tab is not a choice. This used to read `canSeePlan`, which was the same
  // thing back when Plan was the only second tab — it is not any more, and a
  // host on a locked operator trip has Overview + Dashboard and no Plan.
  const showTabs = visibleTabs.length > 1;

  // Alias for the bottom-spacer below; kept identical to stickyCtaVisible.
  const hasStickyFooter = stickyCtaVisible;

  // Header kebab menu. `group` drives the dividers (chat / report+share /
  // host actions) so they collapse cleanly when a section isn't shown.
  type TripMenuEntry = {
    key: string;
    /** Set exactly one of `icon` / `tripIcon`. `tripIcon` wins if both are set. */
    icon?: React.ComponentProps<typeof Ionicons>['name'];
    /** Renders a TripIcon instead of the Ionicon. Edit actions use the
     *  project's standard pencil (`edit-02`) — the same one the "Edit cover"
     *  pill and every other edit affordance uses. Ionicons has no match for it,
     *  so the two icon sets have to coexist in this menu. */
    tripIcon?: TripIconName;
    label: string;
    group: number;
    onPress: () => void;
    /** Destructive actions render in red (Figma: Exit / Cancel trip). */
    destructive?: boolean;
  };
  const menuItems: TripMenuEntry[] = (
    [
      // Chat — members + host, while the trip isn't cancelled (chat lives on
      // even once a trip is completed).
      ((isHost || isApprovedMember) && !isCancelled) && {
        key: 'chat',
        icon: 'chatbubble-outline',
        label: 'Trip Chat',
        group: 0,
        onPress: handleOpenGroupChat,
      },
      // Report + Share — everyone, members and non-members alike.
      { key: 'report', icon: 'warning-outline', label: 'Report Trip', group: 1, onPress: () => setReportSheetVisible(true) },
      { key: 'share', icon: 'paper-plane-outline', label: 'Share Trip', group: 1, onPress: handleShare },
      // Share to Instagram Story — native builds only (view-shot + share are
      // native modules; the sheet itself degrades to a generic share sheet
      // when Instagram isn't installed).
      (Platform.OS !== 'web' && !isExpoGo) && {
        key: 'shareStory',
        icon: 'logo-instagram' as const,
        label: 'Share to Story',
        group: 1,
        onPress: () => {
          setStorySheetVisible(true);
          logEvent('trip_story_share_opened', { tripId: trip.id });
        },
      },
      // Complete — host only, once the trip is underway and still live.
      (isHost && tripHasStarted && !isLocked) && {
        key: 'complete',
        icon: 'checkmark-circle-outline',
        label: 'Complete trip',
        group: 2,
        onPress: handleCompleteTrip,
      },
      // Edit trip — the operator OF RECORD only, on a hosting_style 'C' trip.
      // Deliberately trip.host_id and not isHost: isHost is flat multi-host
      // (every promoted admin), and this screen edits cost_per_person, which
      // group_trips' own UPDATE policy would otherwise let any co-host change.
      // Same reasoning as operator_set_traveler_price's C3 fix. Peer A/B hosts
      // keep the inline Overview pills; the wizard's edit mode stays
      // unreachable for them, exactly as it is today.
      (isTripOwner && (isOperatorTrip || isEditTestTrip) && !isLocked) && {
        key: 'edit',
        tripIcon: 'edit-02' as const,
        label: 'Edit trip',
        group: 2,
        onPress: () => onEditOperatorTrip?.(trip.id),
      },
      // Cancel — host only, while the trip is still live.
      (isHost && !isLocked) && {
        key: 'cancel',
        icon: 'ban-outline',
        label: 'Cancel trip',
        group: 2,
        onPress: handleCancelTrip,
        destructive: true,
      },
      // Exit — approved member (not the host); replaces the old bottom-of-Plan
      // destructive card.
      (isApprovedMember && !isHost) && {
        key: 'exit',
        icon: 'exit-outline',
        label: 'Exit trip',
        group: 2,
        onPress: handleLeaveTrip,
        destructive: true,
      },
    ] as (TripMenuEntry | false)[]
  ).filter(Boolean) as TripMenuEntry[];

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Header
        onBack={onBack}
        title={trip.title || 'Trip'}
        rightAction={
          <View style={styles.headerActions}>
            {/* Notifications — self-contained bell + unread badge; opens the
                panel ROUTE (same component the other headers use). */}
            {currentUserId ? (
              <NotificationCenter userId={currentUserId} bare />
            ) : null}
            {/* Overflow (⋮) — Chat / Report / Share for everyone, plus
                Complete / Cancel for the host. */}
            <TouchableOpacity
              onPress={() => setMenuVisible(true)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityLabel="Trip options"
            >
              {cancelling || completing || openingChat ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Ionicons name="ellipsis-vertical" size={22} color="#FFFFFF" />
              )}
            </TouchableOpacity>
          </View>
        }
      />

      {/* This scroll body has NO TextInput of its own (all inputs live in the
          gear/suggest/wizard Modal sheets), so this KAV is only needed on iOS's
          'padding' path — and it is actively harmful on Android: behavior='height'
          reacts to GLOBAL keyboard events, so when a sheet's keyboard opens/closes
          the background viewport reflows and the ScrollView never re-pins to its
          exact-bottom rest. That leaves real content parked under the always-on
          bottom `ctaOverlay` fog, so the fog reads as a persistent grey veil after
          any sheet interaction. Disabling the KAV on Android keeps content at rest
          in the #FAFAFA clearance buffer, where the fog is invisible as designed. */}
      <KeyboardAvoidingView
        style={styles.keyboardAvoider}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        enabled={Platform.OS === 'ios'}
      >
      <Animated.ScrollView
        ref={scrollRef}
        contentContainerStyle={[
          styles.scrollContent,
          stickyCtaVisible && { paddingBottom: Math.max(insets.bottom, 16) + 100 },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#7B7B7B"
            colors={['#05BCD3']}
          />
        }
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: true,
        })}
      >
        {isCancelled && (
          <View style={styles.cancelledBanner}>
            <Ionicons name="alert-circle-outline" size={18} color="#C0392B" />
            <Text style={styles.cancelledText}>This trip has been cancelled by the host.</Text>
          </View>
        )}

        {!isCancelled && isLocked && (
          <View style={styles.endedBanner}>
            <Ionicons name="checkmark-done-outline" size={18} color="#445" />
            <Text style={styles.endedText}>
              {isCompleted
                ? 'This trip has been completed. The chat stays open below.'
                : 'This trip has ended. The chat stays open below.'}
            </Text>
          </View>
        )}

        {/* Rich trip-detail layout (shared with the create-trip preview). The
            Overview/Plan toggle is injected as shared chrome under the hero;
            bodyHidden hides the read-only overview body when Plan is active. */}
        <TripDetailViewRedesigned
          vm={buildTripDetailVM(
            trip,
            participants.length,
            participants.find(p => p.role === 'host') ?? null,
          )}
          participants={participants.map(p => ({
            id: p.user_id,
            avatarUrl: p.profile_image_url ?? null,
            name: p.name ?? null,
          }))}
          onParticipantPress={
            onViewUserProfile
              ? userId => {
                  if (userId !== currentUserId) onViewUserProfile(userId);
                }
              : undefined
          }
          onSeeAllParticipants={onViewAllMembers}
          onLeaderPress={
            onViewUserProfile && trip.host_id && trip.host_id !== currentUserId
              ? () => onViewUserProfile(trip.host_id)
              : undefined
          }
          afterHeroSlot={
            showTabs ? (
              <View
                onLayout={e => {
                  // Y is relative to the white header zone, which starts at the
                  // top of the scroll content (no banners while the toggle shows),
                  // so this equals the scroll offset where it reaches the header.
                  const y = e.nativeEvent.layout.y;
                  toggleYRef.current = y;
                  setToggleY(y);
                }}
              >
                <TripTabToggle value={activeTab} onChange={setActiveTab} tabs={visibleTabs} />
              </View>
            ) : null
          }
          bodyHidden={bodyReplaced}
          // Members who have the Plan tab now see the participants there (Figma
          // 13455-38686), so drop the Overview Participants row for them. Locked
          // trips (no Plan tab) and non-members keep it as the only member view.
          hideParticipants={canSeePlan}
          // Host edit affordances (Figma admin view) — only while the trip is
          // still live (locked trips are read-only, mirroring the header pencil).
          isHost={isHost && !isLocked}
          aboutHost={(() => {
            const hostP = participants.find(p => p.role === 'host') ?? null;
            return {
              name: hostP?.name ?? null,
              avatarUrl: hostP?.profile_image_url ?? null,
              bio: trip.host_lead_note ?? null,
              // Profile detail badges — surfaced in the "About <host>" block for
              // Trip Operator trips (mirror the create-trip "About you" stats).
              age: hostP?.age ?? null,
              countryFrom: hostP?.country_from ?? null,
              surfLevelLabel: hostP?.surf_level_category
                ? titleCase(String(hostP.surf_level_category))
                : null,
              boardLabel: hostP?.surfboard_type
                ? BOARD_SHORT[hostP.surfboard_type as keyof typeof BOARD_SHORT] ??
                  titleCase(String(hostP.surfboard_type))
                : null,
              surfTrips:
                typeof hostP?.travel_experience === 'number' ? hostP.travel_experience : null,
              // Local-knowledge lines (Captain + Operator): how well the host
              // knows the destination + the stay.
              destinationFamiliarityLabel: trip.host_destination_familiarity
                ? DESTINATION_FAMILIARITY_OPTIONS.find(
                    o => o.slug === trip.host_destination_familiarity,
                  )?.label ?? null
                : null,
              stayFamiliarityLabel: trip.host_stay_familiarity
                ? STAY_FAMILIARITY_OPTIONS.find(o => o.slug === trip.host_stay_familiarity)
                    ?.label ?? null
                : null,
            };
          })()}
          onAboutHostPress={
            onViewUserProfile && trip.host_id && trip.host_id !== currentUserId
              ? () => onViewUserProfile(trip.host_id)
              : undefined
          }
          onShare={handleShare}
          onEditCover={() => setEditSheet('cover')}
          onEditAboutHost={() => setEditSheet('about')}
          onEditDescription={() => setEditSheet('description')}
          onEditDates={() => setEditSheet('dates')}
          onEditAccommodation={() => setEditSheet('accommodation')}
        />

        {/* ============================ DASHBOARD ============================ */}
        {/* Running the trip: money, document review, travelers. Host of an
            operator trip only — see `canSeeDashboard`. Everything it needs is
            already loaded by this screen or fetched by the tab itself.
            The wrapper is the same 16px gutter every Plan section uses; the tab
            draws its own vertical rhythm, so it gets no paddingTop. */}
        {showDashboard && (
          <View style={styles.dashboardWrap}>
            <TripDashboardTab
              tripId={tripId}
              // The tab's only sense of time. Without these it cannot tell a
              // passport missing three months out from one missing in three
              // days, and both read as the same number.
              startDateISO={trip.start_date}
              endDateISO={trip.end_date}
              travelers={reviewTravelers}
              review={reviewData}
              reviewLoading={reviewQuery.isLoading}
              onOpenReview={userId => {
                setReviewFocusUserId(userId ?? null);
                setReviewFocusRequirementId(null);
                setReviewWaiting(false);
                setReviewOpen(true);
              }}
              onOpenRequirement={requirementId => {
                setReviewFocusUserId(null);
                setReviewFocusRequirementId(requirementId);
                setReviewWaiting(false);
                setReviewOpen(true);
              }}
              onOpenWaiting={() => {
                setReviewFocusUserId(null);
                setReviewFocusRequirementId(null);
                setReviewWaiting(true);
                setReviewOpen(true);
              }}
              onManageRequirements={
                canManageRequirements ? openManageRequirements : undefined
              }
            />
          </View>
        )}

        {/* ============================== PLAN ============================== */}
        {/* Interactive / operational content — members only. */}
        {showPlan && (
        <>
        {/* Redesigned Plan (Figma 12557-5860 / 12716-6927): commit pill →
            admin updates → Packing & Gear. Operational/host sections (join
            requests, breakdown, destructive actions) stay below — they're not
            in the Figma frames and live only here, not in Overview. */}

        {/* 1) Members — moved here from the Overview body (members-only;
            non-members still see the simpler Participants row in Overview). */}
        <View onLayout={registerSection('members')}>
          <TripMemberSection
            members={memberList}
            participantCount={participants.length}
            maxParticipants={trip.max_participants}
            committedCount={committedCount}
            showCommitment={!isOperatorTrip}
            onViewAll={onViewAllMembers}
            pendingCount={isHost ? pendingRequests.length : 0}
            onMemberPress={
              onViewUserProfile
                ? userId => {
                    if (userId !== currentUserId) onViewUserProfile(userId);
                  }
                : undefined
            }
          />
        </View>

        {/* 1.5) Commit pill — below the members + commitment bar (approved
            members only; the host can't commit). Never on an operator trip:
            commitment is a peer-trip promise, and a traveler who already paid
            has nothing left to promise. */}
        {isApprovedMember && !isOperatorTrip && (
          <View onLayout={registerSection('commit')}>
            <CommitPill status={myCommitmentStatus} onPress={handleOpenCommitSheet} />
          </View>
        )}

        {/* 2) Recent admin updates — always shown (members see a read-only
            "No updates yet" placeholder; only the host gets "+ Add update").
            The Members section above provides the spacing under the toggle. */}
        {(
          <View onLayout={registerSection('updates')} style={{ marginTop: 16 }}>
            <AdminUpdatesCard
              updates={adminUpdates}
              isHost={isHost}
              formatTime={formatRelativeTime}
              onAddUpdate={handleStartAddUpdate}
              onViewAll={onViewAllUpdates}
            />
          </View>
        )}

        {/* 3) Packing & Gear — Group Gear + Your Gear */}
        <View style={styles.planSection} onLayout={registerSection('gear')}>
          <GroupGearCard
            items={gearItems}
            isHost={isHost}
            isApprovedMember={isApprovedMember}
            currentUserId={currentUserId}
            onPressItem={item => setGearItemSheetItem(item)}
            onManage={onManageGroupGear ?? (() => setManageSheetVisible(true))}
            onAddItem={() => setAddGroupGearSheetOpen(true)}
            onRequestItem={() => setRequestSheetVisible(true)}
            onViewAll={onViewAllGroupGear}
          />
          <View onLayout={registerSection('your-gear')}>
            <YourGearCard
              rows={gearAllRows}
              totalCount={gearTotalCount}
              mode={isHost ? 'personal' : 'member'}
              onOpen={onViewAllYourGear ?? (() => setPersonalGearSheetOpen(true))}
              onToggleItem={row =>
                row.kind === 'host'
                  ? handleToggleGroupGearItem(row.name)
                  : handleTogglePersonalItem(row.name)
              }
              onAddItem={
                (isHost || isApprovedMember) && !isCancelled
                  ? () => setAddPersonalSheetOpen(true)
                  : undefined
              }
            />
          </View>
          {/* Host only — a separate section for the gear the host suggests that
              members pack for themselves (kept apart from the host's own gear). */}
          {isHost && (
            <View onLayout={registerSection('members-gear')}>
              <YourGearCard
                rows={gearAllRows}
                totalCount={gearTotalCount}
                mode="suggestions"
                onOpen={onManageSuggestedGear ?? (() => {})}
                onToggleItem={() => {}}
                onAddItem={!isCancelled ? (onManageSuggestedGear ?? undefined) : undefined}
              />
            </View>
          )}
        </View>

        {/* 4) Documents (v1: passport image). Placed after Packing & Gear so the
            Figma order above stays intact. Renders only when this trip actually
            asks for a document — which is no peer trip, because the DB refuses
            to create a passport requirement on one. */}
        {/* Traveler-facing only. The host's review summary used to render here
            in `mode="host"`; it moved to the Dashboard tab, which is where
            everything about running the trip now lives. Plan is what the
            traveler sees — including for an operator who wants to check what
            they are asking people to do.

            `canSeeDashboard`, not `isHost`: a host of a PEER trip has no
            Dashboard tab, so their documents card has to stay right here or it
            would vanish with nowhere to go. */}
        {documentRows.length > 0 && !canSeeDashboard && (
          <View style={styles.planSection} onLayout={registerSection('documents')}>
            <TripDocumentsCard
              rows={documentRows}
              mode={isHost ? 'host' : 'member'}
              pendingReviewCount={reviewQuery.data?.totalToReview ?? 0}
              travelersDone={travelersFinished}
              travelerCount={reviewTravelers.length}
              onPressRow={handlePressDocumentRow}
              /* The whole queue, so every focus has to be cleared. This card
                 and the Dashboard's entry points are mutually exclusive today
                 (`!canSeeDashboard` above), so no stale focus can actually
                 reach here — but the day that stops being true, a leftover
                 `reviewWaiting` would silently open the wrong screen. */
              onReviewAll={() => {
                setReviewFocusUserId(null);
                setReviewFocusRequirementId(null);
                setReviewWaiting(false);
                setReviewOpen(true);
              }}
              onManage={canManageRequirements ? openManageRequirements : undefined}
              budgetFxRate={trip?.budget_fx_rate}
              viewerCountry={viewerCountry}
            />
          </View>
        )}

        {/* ---- Operational sections (kept at the bottom of Plan; not in Figma) ---- */}

        {/* Gear suggestions (host) — review members' "suggest item" submissions.
            Only shown when there are pending suggestions to act on. */}
        {isHost && gearRequests.length > 0 && (
          <View style={styles.planSection} onLayout={registerSection('gear-requests')}>
            <TouchableOpacity
              style={styles.gearReqsBadge}
              onPress={() => setRequestsSheetVisible(true)}
              activeOpacity={0.7}
            >
              <Ionicons name="notifications-outline" size={16} color="#222B30" />
              <Text style={styles.gearReqsBadgeText}>
                {`${gearRequests.length} pending gear ${gearRequests.length === 1 ? 'suggestion' : 'suggestions'}`}
              </Text>
              <Ionicons name="chevron-forward" size={16} color="#222B30" />
            </TouchableOpacity>
          </View>
        )}

        {/* Pending requests + member management now live in the full Members
            view ("View all" / "Requests pending" on the Members section). */}

        {/* Declined requests (host only) — lets the host reverse a decision. */}
        {isHost && declinedRequests.length > 0 && (
          <Section title={`Declined requests (${declinedRequests.length})`}>
            {declinedRequests.map(r => (
              <PendingRequestCard
                key={r.id}
                request={r}
                onApprove={handleApprove}
                onDecline={handleDecline}
                hideDecline
                approveLabel="Approve anyway"
              />
            ))}
          </Section>
        )}

        {/* "Exit trip" now lives in the header overflow (⋮) menu, alongside the
            host's Cancel / Complete. */}
        </>
        )}

        {/* Share + Report now live in the header overflow (⋮) menu; Share also
            keeps its floating button on the hero cover (TripDetailViewRedesigned
            `onShare`). */}

        {/* Clearance for the floating sticky footer (Trip Chat / Join a Trip)
            so the last content isn't hidden behind it; smaller otherwise. */}
        <View style={{ height: hasStickyFooter ? insets.bottom + 96 : 40 }} />
      </Animated.ScrollView>

      {/* Sticky Overview/Plan toggle — a clone that clips under the black header
          once the real toggle scrolls past its resting Y, so members can switch
          tabs without scrolling back to the top. Crisp opacity swap at the
          threshold (native-driven) so it hands off seamlessly from the real one. */}
      {showTabs && (
        <Animated.View
          pointerEvents={toggleStuck ? 'auto' : 'none'}
          style={[
            styles.stickyToggle,
            {
              opacity: scrollY.interpolate({
                inputRange: [Math.max(toggleY - 1, 0), Math.max(toggleY, 1)],
                outputRange: [0, 1],
                extrapolate: 'clamp',
              }),
            },
          ]}
        >
          <TripTabToggle value={activeTab} onChange={setActiveTab} tabs={visibleTabs} />
        </Animated.View>
      )}
      </KeyboardAvoidingView>

      {/* Sticky CTA — floating pill over a foggy fade (mirrors the profile
          "Connect to …" button). The overlay fades scroll content into the
          background behind the button; the button itself keeps its own
          colour + label. */}
      {stickyCtaVisible && (
        <View style={styles.ctaOverlay} pointerEvents="none">
          {/* Plain white fade (mirrors the profile "Connect to …" overlay) —
              content dissolves into the background behind the button. A blurred
              variant was tried but read blotchy over the colourful hero/avatars,
              so we keep the clean gradient. */}
          <LinearGradient
            colors={['rgba(250, 250, 250, 0)', 'rgba(250, 250, 250, 0.4)', 'rgba(250, 250, 250, 0.75)', '#FAFAFA']}
            locations={[0, 0.4, 0.72, 1]}
            style={styles.ctaOverlayGradient}
          />
        </View>
      )}

      {/* Join flow (non-host, non-member, active trip). Fades in because it
          mounts only after membership resolves — a pop would read as a glitch. */}
      {showJoinCta && (
        <Reanimated.View
          entering={FadeInUp.duration(220)}
          style={[styles.ctaFloat, { bottom: Math.max(insets.bottom, 16) + 12 }]}
        >
          <CtaButton
            myRequest={myRequest}
            isFull={isFull}
            onRequest={handleRequestToJoin}
            onWithdraw={handleWithdraw}
          />
        </Reanimated.View>
      )}

      {/* Members get quick access to the group chat (Figma "Trip Chat", accent). */}
      {showChatCta && (
        <Reanimated.View
          entering={FadeInUp.duration(220)}
          style={[styles.ctaFloat, { bottom: Math.max(insets.bottom, 16) + 12 }]}
        >
          <TouchableOpacity
            style={[styles.ctaBtn, styles.ctaChat]}
            onPress={handleOpenGroupChat}
            disabled={openingChat}
            activeOpacity={0.85}
          >
            {openingChat ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <>
                <Ionicons name="chatbubble-outline" size={18} color="#FFFFFF" />
                <Text style={styles.ctaPrimaryText}>Trip Chat</Text>
              </>
            )}
          </TouchableOpacity>
        </Reanimated.View>
      )}

      {/* Gear bottom sheets */}
      <GearItemSheet
        visible={!!gearItemSheetItem}
        item={gearItemSheetItem}
        currentUserId={currentUserId}
        onClose={() => setGearItemSheetItem(null)}
        onSetClaim={handleSetGearClaim}
      />
      <RequestGearSheet
        visible={requestSheetVisible}
        onClose={() => setRequestSheetVisible(false)}
        onSubmit={handleSubmitGearRequest}
      />
      <ManageGearSheet
        visible={manageSheetVisible}
        items={gearItems}
        onClose={() => setManageSheetVisible(false)}
        onSave={handleSaveGearItem}
        onDelete={handleDeleteGearItem}
      />
      {/* Host "+ Add item" on the Group Gear preview — straight into the add
          form (Figma 12919-32232), no detour through "Edit Group Gear". */}
      <ManageGearSheet
        visible={addGroupGearSheetOpen}
        items={gearItems}
        formOnly
        editItem={null}
        onClose={() => setAddGroupGearSheetOpen(false)}
        onSave={handleSaveGearItem}
        onDelete={handleDeleteGearItem}
      />
      <GearRequestsSheet
        visible={requestsSheetVisible}
        requests={gearRequests}
        processingId={processingGearRequestId}
        onClose={() => setRequestsSheetVisible(false)}
        onApprove={handleApproveGearRequest}
        onDecline={handleDeclineGearRequest}
      />
      {/* Host review — every traveler's documents, with Approve / Ask again.
          Mounted on `isHost` alone. It used to also require
          `documentRows.length > 0`, but that reads a query this screen
          invalidates on every approve/reject — so the mount could drop while
          the review Modal (or the viewer/reject sheet nested inside it) was
          mid-dismiss. Same stability rule as the requirements editor below:
          a Modal's MOUNT must not depend on data that moves under it. */}
      {isHost && (
        <DocumentReviewScreen
          visible={reviewOpen}
          onClose={() => setReviewOpen(false)}
          loading={reviewQuery.isLoading}
          travelers={reviewTravelers}
          review={reviewData}
          initialUserId={reviewFocusUserId}
          initialRequirementId={reviewFocusRequirementId}
          initialWaiting={reviewWaiting}
          renderTravelerExtras={userId => {
            const t = reviewTravelers.find(x => x.userId === userId);
            const name = t?.name ?? 'Traveler';
            return (
              <TravelerExtras
                tripId={tripId}
                userId={userId}
                name={name}
                money={
                  dashboardMoney.data?.travelers.find(m => m.userId === userId) ?? null
                }
                moneyLoading={dashboardMoney.isPending}
                isOffline={dashboardMoney.data?.isOffline ?? false}
                // Only the operator of RECORD may price anyone:
                // `operator_set_traveler_price` authorises on `host_id` alone,
                // while `isHost` here is flat multi-host and includes every
                // promoted admin. Showing them the button would hand them a
                // guaranteed server error.
                onSetPrice={
                  trip?.host_id && trip.host_id === currentUserId
                    ? () => setPricingUserId(userId)
                    : undefined
                }
                onMessage={() => {
                  // Close the review Modal FIRST. Pushing a chat card from
                  // under a presented Modal leaves it stranded on top of the
                  // conversation.
                  setReviewOpen(false);
                  onMessageUser?.(userId, t?.name ?? undefined, t?.avatarUrl ?? null);
                }}
              />
            );
          }}
          /* Per-traveler price, opened by "Set price" in the traveler's own
             view — so it has to live INSIDE that screen's Modal, as a layer.
             As a sibling of it (which it was) RN resolved its presentation to
             the root view controller, already presenting the review screen;
             UIKit refused and the sheet only surfaced once the operator left
             the traveler. It is the same sheet the Members list uses, so the
             two can never price someone differently. */
          renderOverlay={() => (
            <TravelerPriceSheet
              inline
              visible={!!pricingUserId}
              tripId={tripId}
              userId={pricingUserId ?? ''}
              travelerName={
                reviewTravelers.find(t => t.userId === pricingUserId)?.name ?? 'Traveler'
              }
              budgetFxRate={trip?.budget_fx_rate ?? null}
              requirements={
                requirementsQuery.data
                  ? requirementsQuery.data.map(r => ({ kind: r.kind, isActive: r.isActive }))
                  : null
              }
              onClose={() => setPricingUserId(null)}
              onSaved={() => {
                setPricingUserId(null);
                // Every number on the Dashboard is derived from this — refetch
                // rather than patch, so the summary and the row agree again.
                void queryClient.invalidateQueries({
                  queryKey: ['operatorDashboard', 'money', tripId],
                });
              }}
            />
          )}
          onChanged={() => reviewQuery.refetch()}
        />
      )}

      {/* The operator edits what the trip asks for. Kept out of the create
          wizard's edit mode on purpose: `updateGroupTrip` never writes
          requirement rows, so a toggle there would silently do nothing.

          Mounted on `isHost` ALONE, never on `canManageRequirements`. That flag
          reads `documentsQuery.data`, which this sheet's own Save invalidates —
          so the mount condition could go false while the sheet was still
          animating out, unmounting a Modal mid-dismiss. On iOS that strands a
          layer that swallows every touch on the tab underneath while the screen
          still looks and behaves alive. The mount has to be stable for the
          lifetime of the screen; only the AFFORDANCE is data-dependent. */}
      {isHost && (
        <ManageRequirementsSheet
          visible={manageOpen}
          onClose={() => setManageOpen(false)}
          tripId={tripId}
          startDateISO={trip?.start_date ?? null}
          requirements={requirementsQuery.data ?? NO_REQUIREMENTS}
          isOperatorTrip={!!isOperatorTrip}
          paymentMode={trip?.payment_mode ?? 'offline'}
          costPerPersonUsd={trip?.cost_per_person ?? null}
          depositAmountUsd={trip?.deposit_amount ?? null}
          onSaved={handleRequirementsSaved}
        />
      )}

      {/* Requirement sheets. Only one is ever mounted, chosen by what the
          tapped requirement actually asks the traveler to do. */}
      {/* ⚠️ `onClose` here UNMOUNTS the flow, and that is the contract it
          expects: it means "the traveler is done", not "hide the sheet". The
          flow hides its own sheets internally, because it has to still be
          mounted when the Modal finishes tearing down — that callback is what
          launches the camera / photo / PDF picker.

          Do not make this component call `onClose` to close a sheet, and do
          not add another condition to this mount that a tap could flip. Either
          one kills the picker hand-off, and the symptom is silent: the buttons
          simply do nothing, on every upload requirement, with no error
          anywhere. See point 2 in RequirementUploadFlow's header. */}
      {openRequirement && currentUserId && openRequirement.action === 'upload' && (
        <RequirementUploadFlow
          visible
          onClose={() => setOpenRequirement(null)}
          tripId={tripId}
          requirementId={openRequirement.requirementId}
          userId={currentUserId}
          kind={openRequirement.kind}
          onUploaded={handleRequirementDone}
          rejectionNote={openRequirement.note}
        />
      )}

      {openRequirement && openRequirement.action === 'agree' && (
        <WaiverAgreeSheet
          visible
          onClose={() => setOpenRequirement(null)}
          tripId={tripId}
          requirementId={openRequirement.requirementId}
          agreed={openRequirement.agreed}
          onAgreed={handleRequirementDone}
        />
      )}

      {openRequirement && currentUserId && openRequirement.action === 'medical' && (
        <MedicalFormSheet
          visible
          onClose={() => setOpenRequirement(null)}
          tripId={tripId}
          userId={currentUserId}
          onSaved={handleRequirementDone}
        />
      )}

      {/* Every unhappy payment path ends here rather than in a one-button OS
          alert or, worse, in silence. See PaymentStatusSheet's header. */}
      <PaymentStatusSheet
        visible={!!paymentIssue}
        mode={paymentIssue?.mode ?? 'failed'}
        title={paymentIssue?.title ?? 'This payment'}
        reason={paymentIssue?.reason}
        attemptAge={paymentIssue?.attemptAge}
        busy={recheckingPayment}
        onClose={() => setPaymentIssue(null)}
        onRetry={handleRetryPayment}
        onMessageOrganiser={
          onOpenGroupChat
            ? () => {
                setPaymentIssue(null);
                handleOpenGroupChat();
              }
            : undefined
        }
      />

      {/* Document viewer — mints its own ~60s signed URL per open and never
          disk-caches the image. Read-only here; the host review screen is the
          one that passes approve/reject.

          "Copy details" IS offered here, on a traveler's own passport. Ohad,
          3 August: a traveler filling in an airline booking has to retype the
          same seven fields the operator does, off the same photo. Nothing is
          stored either way, and the passport being read is their own. */}
      <DocumentViewer
        visible={!!viewingDoc}
        storagePath={viewingDoc?.storagePath ?? null}
        onClose={() => setViewingDoc(null)}
        title={viewingDoc?.title ?? 'Document'}
        isPassport={viewingDoc?.kind === 'passport'}
      />

      {/* Admin update — host writes/edits an announcement. Driven by the same
          addingUpdate / editingUpdateId state the list uses. */}
      <AdminUpdateSheet
        visible={addingUpdate || !!editingUpdateId}
        mode={editingUpdateId ? 'edit' : 'add'}
        initialTitle={editingUpdateId ? (updateTitleDraft ?? '') : ''}
        initialBody={editingUpdateId ? (updateDraft ?? '') : ''}
        saving={savingUpdate}
        onClose={handleCancelUpdateDraft}
        onSubmit={handleSubmitUpdateBody}
        onDelete={
          editingUpdateId
            ? () => {
                const u = adminUpdates.find(x => x.id === editingUpdateId);
                if (u) handleDeleteUpdate(u);
              }
            : undefined
        }
      />

      {/* Your gear — full personal list (check / remove), opens Add from here. */}
      <PersonalGearSheet
        visible={personalGearSheetOpen}
        onClose={() => setPersonalGearSheetOpen(false)}
        hostItems={trip.personal_gear_host_suggestion ?? []}
        myHostState={myGroupGear}
        myItems={myPersonalGear}
        canEdit={(isHost || isApprovedMember) && !isCancelled}
        onToggleHostItem={handleToggleGroupGearItem}
        onTogglePersonalItem={handleTogglePersonalItem}
        onRemovePersonalItem={handleRemovePersonalItem}
        onAddPersonal={() => {
          setPersonalGearSheetOpen(false);
          setAddPersonalSheetOpen(true);
        }}
      />

      {/* Add one item to my own personal list. */}
      <AddPersonalGearSheet
        visible={addPersonalSheetOpen}
        onClose={() => setAddPersonalSheetOpen(false)}
        existingNames={[
          ...(trip.personal_gear_host_suggestion ?? []),
          ...myPersonalGear.map(i => i.name),
        ]}
        saving={savingPersonalItem}
        onSubmit={handleAddPersonalSubmit}
      />

      {/* Host-only inline edit sheets (Figma admin view). */}
      <EditCoverSheet
        visible={editSheet === 'cover'}
        currentUri={trip.hero_image_url ?? null}
        onClose={() => setEditSheet(null)}
        onSave={handleSaveCover}
      />
      <EditTextSheet
        visible={editSheet === 'about'}
        title="About you"
        subtitle={
          trip.hosting_style === 'C'
            ? 'Why surfers can trust your operation.'
            : 'Why you’re the right Captain for this.'
        }
        label={
          trip.hosting_style === 'C'
            ? 'Why surfers can trust your operation'
            : 'Why you’re the right Captain'
        }
        initialValue={trip.host_lead_note ?? ''}
        placeholder="Mention anything that brings credibility to your experience here"
        maxLength={250}
        onClose={() => setEditSheet(null)}
        onSave={handleSaveAboutHost}
      />
      <EditTextSheet
        visible={editSheet === 'description'}
        title="About this trip"
        subtitle="What surfers should know about this trip."
        label="Trip description"
        initialValue={trip.description ?? ''}
        placeholder="Describe the surf, the vibe, the plan…"
        maxLength={1000}
        rows={8}
        onClose={() => setEditSheet(null)}
        onSave={handleSaveDescription}
      />
      <EditDatesSheet
        visible={editSheet === 'dates'}
        initial={(() => {
          const months = [...(trip.date_months ?? [])].sort();
          return {
            datesMode: trip.start_date ? ('exact' as const) : ('months' as const),
            startDateISO: trip.start_date ?? null,
            endDateISO: trip.end_date ?? null,
            monthFrom: months[0] ?? '',
            monthTo: months[months.length - 1] ?? '',
            durationDays: trip.duration_days ?? null,
          };
        })()}
        onClose={() => setEditSheet(null)}
        onSave={handleSaveDates}
      />
      <EditAccommodationSheet
        visible={editSheet === 'accommodation'}
        specificOnly
        initial={{
          kind: (trip.accommodation_type?.[0] ?? null) as AccommodationInitial['kind'],
          name: trip.accommodation_name ?? '',
          url: trip.accommodation_url ?? '',
          photoUri: trip.accommodation_image_url ?? null,
        }}
        onClose={() => setEditSheet(null)}
        onSave={handleSaveAccommodation}
      />

      {/* Report this whole trip */}
      <ReportTripSheet
        visible={reportSheetVisible}
        tripId={tripId}
        tripTitle={trip.title ?? ''}
        hostId={trip.host_id}
        hostName={participants.find(p => p.role === 'host')?.name ?? ''}
        onClose={() => setReportSheetVisible(false)}
      />

      {/* Instagram-story share — mounted on demand so the story card (and its
          full-size hero fetch) only render when the user asks for it. */}
      {storySheetVisible && (
        <ShareTripStorySheet
          visible={storySheetVisible}
          tripId={trip.id}
          vm={buildTripDetailVM(
            trip,
            participants.length,
            participants.find(p => p.role === 'host') ?? null,
          )}
          onClose={() => setStorySheetVisible(false)}
        />
      )}

      {/* Header overflow (⋮) menu. Rendered at the SafeAreaView root (not inside
          the header) so it isn't clipped, and above everything via zIndex. A
          full-screen transparent backdrop dismisses it on any outside tap. */}
      {menuVisible && (
        <>
          <TouchableOpacity
            style={styles.menuBackdrop}
            activeOpacity={1}
            onPress={() => setMenuVisible(false)}
          />
          {/* Open just BELOW the kebab. Absolute `top` is measured from the
              screen's border edge (RN ignores SafeAreaView's inset padding for
              absolute children), so add the inset + header height ourselves. */}
          <Reanimated.View
            entering={FadeInDown.duration(160)}
            style={[styles.menuDropdown, { top: insets.top + 56 }]}
          >
            {menuItems.map((item, i) => {
              const showDivider = i > 0 && item.group !== menuItems[i - 1].group;
              return (
                <React.Fragment key={item.key}>
                  {showDivider && <View style={styles.menuDivider} />}
                  <TouchableOpacity
                    style={styles.menuItem}
                    activeOpacity={0.6}
                    onPress={() => {
                      setMenuVisible(false);
                      item.onPress();
                    }}
                  >
                    {item.tripIcon ? (
                      <TripIcon
                        name={item.tripIcon}
                        // 22 to match the Ionicons beside it. strokeWidth is in
                        // the icon's OWN viewBox units, and edit-02's viewBox is
                        // 12.27 where most TripIcons are ~16 — so the default 1
                        // renders visibly heavier here than the same 1 does
                        // elsewhere. 0.85 lands on ~1.5px, the weight IconCell
                        // gets from strokeWidth 1.1 at this size.
                        size={22}
                        strokeWidth={0.85}
                        color={item.destructive ? '#FF5367' : '#222B30'}
                      />
                    ) : item.icon ? (
                      <Ionicons name={item.icon} size={22} color={item.destructive ? '#FF5367' : '#222B30'} />
                    ) : null}
                    <Text style={[styles.menuItemText, item.destructive && styles.menuItemTextDestructive]}>{item.label}</Text>
                  </TouchableOpacity>
                </React.Fragment>
              );
            })}
          </Reanimated.View>
        </>
      )}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
const Header: React.FC<{ onBack: () => void; title?: string; rightAction?: React.ReactNode }> = ({
  onBack,
  title,
  rightAction,
}) => (
  <View style={styles.header}>
    <TouchableOpacity onPress={onBack} style={styles.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
      <Ionicons name="chevron-back" size={28} color="#FFFFFF" />
    </TouchableOpacity>
    <Text style={styles.headerTitle} numberOfLines={1}>{title || 'Trip'}</Text>
    <View style={styles.headerRight}>{rightAction}</View>
  </View>
);

const CtaButton: React.FC<{
  myRequest: GroupTripJoinRequest | null;
  isFull: boolean;
  onRequest: () => void;
  onWithdraw: () => void;
}> = ({ myRequest, isFull, onRequest, onWithdraw }) => {
  // Trip is full and the user hasn't already got a request in flight → show a
  // non-pressable "Trip full" state instead of letting them request a spot that
  // can't be granted. Pending requesters keep their pending/withdraw row.
  if (isFull && myRequest?.status !== 'pending') {
    return (
      <View style={[styles.ctaBtn, styles.ctaPending]}>
        <Ionicons name="people" size={18} color="#555" />
        <Text style={styles.ctaPendingText}>Trip full</Text>
      </View>
    );
  }
  if (myRequest?.status === 'pending') {
    // Already requested → yellow "Requested" button. Tapping it withdraws the
    // pending request (no confirm sheet — same tap that sent it cancels it).
    return (
      <Pressable
        style={({ pressed }) => [styles.ctaBtn, styles.ctaRequested, pressed && styles.ctaPressed]}
        onPress={onWithdraw}
      >
        <Text style={styles.ctaPrimaryText}>Requested</Text>
      </Pressable>
    );
  }
  if (myRequest?.status === 'declined') {
    // Previously declined → let them try again. A fresh request replaces the
    // old declined row (see requestToJoinTrip), so the host sees a new pending.
    return (
      <View style={styles.ctaDeclinedRow}>
        <Text style={styles.ctaDeclinedNote}>Your last request was declined.</Text>
        <Pressable
          style={({ pressed }) => [styles.ctaBtn, styles.ctaPrimary, pressed && styles.ctaPressed]}
          onPress={onRequest}
        >
          <Text style={styles.ctaPrimaryText}>Request again</Text>
        </Pressable>
      </View>
    );
  }
  // No request yet, or withdrawn → allow new request
  return (
    <Pressable
      style={({ pressed }) => [styles.ctaBtn, styles.ctaPrimary, pressed && styles.ctaPressed]}
      onPress={onRequest}
    >
      <Text style={styles.ctaPrimaryText}>Request to join</Text>
    </Pressable>
  );
};

// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  // Dark top chrome (Figma 12557-3316). Root paints the status-bar inset dark;
  // the scroll area below paints itself light (#FAFAFA).
  root: { flex: 1, backgroundColor: '#212121' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    backgroundColor: '#212121',
  },
  backBtn: { padding: 4 },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    flex: 1,
    textAlign: 'left',
    marginLeft: 8,
    fontFamily: ff('Montserrat', '700'),
  },
  headerRight: { minWidth: 28, alignItems: 'flex-end' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  // Header overflow (⋮) menu — anchored under the kebab, top-right.
  menuBackdrop: { ...StyleSheet.absoluteFillObject, zIndex: 9998 },
  menuDropdown: {
    position: 'absolute',
    // `top` is set inline (insets.top + header height) so it clears the kebab.
    right: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    minWidth: 224,
    paddingVertical: 8,
    shadowColor: '#596E7C',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 999,
    zIndex: 9999,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 18,
    paddingRight: 28,
    paddingVertical: 14,
    gap: 14,
  },
  menuItemText: {
    fontFamily: ff('Inter', '400'),
    fontSize: 16,
    color: '#222B30',
    flex: 1,
  },
  // Destructive menu items — Exit / Cancel trip (Figma red).
  menuItemTextDestructive: { color: '#FF5367' },
  menuDivider: { height: 1, backgroundColor: '#ECECEC', marginVertical: 4 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  errorText: { color: '#7B7B7B' },

  keyboardAvoider: { flex: 1, backgroundColor: '#FAFAFA' },
  scrollContent: { paddingBottom: 24 },

  // Sticky Overview/Plan clone — pinned to the top of the scroll area (right
  // under the black header). paddingHorizontal cancels the toggle's -16 bleed so
  // it spans edge-to-edge; a soft shadow lifts it above the scrolling content.
  stickyToggle: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    backgroundColor: '#FFFFFF',
    zIndex: 20,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } },
      android: { elevation: 4 },
      default: {},
    }),
  },
  // Redesigned Plan tab (Figma) — light wrappers around the PlanSections cards.
  planSection: { paddingHorizontal: 16, paddingTop: 20 },
  dashboardWrap: { paddingHorizontal: 16 },
  planSectionHeading: {
    // Inter Bold 20 (Figma) — was Montserrat, which rendered oversized. 16px gap
    // down to "Group Gear" matches the section's internal spacing.
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '700',
    color: '#222B30',
    marginBottom: 16,
    fontFamily: ff('Inter', '700'),
  },

  // Top card — hero, title, action row (WhatsApp group header)
  topCard: { backgroundColor: '#FFFFFF', paddingBottom: 4 },
  hero: { width: '100%', height: 220, backgroundColor: '#F2F2F2' },
  heroPlaceholder: { alignItems: 'center', justifyContent: 'center' },

  titleBlock: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#222B30',
    marginBottom: 6,
    textAlign: 'center',
    ...(Platform.OS === 'web' ? { fontFamily: 'Montserrat, sans-serif' } : {}),
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 4,
    marginBottom: 4,
  },
  metaText: { fontSize: 14, color: '#7B7B7B' },
  metaDot: { fontSize: 14, color: '#7B7B7B', marginHorizontal: 2 },
  dates: { fontSize: 13, color: '#7B7B7B', textAlign: 'center', marginTop: 2 },

  // Action row (Chat / Share / Mute) — circular brand-tinted icons
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
    marginTop: 8,
  },
  actionBtn: { flex: 1, alignItems: 'center' },
  actionBtnDisabled: { opacity: 0.5 },
  reportTripLink: {
    alignSelf: 'center',
    marginTop: 12,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  reportTripLinkText: {
    fontFamily: ff('Inter', '400'),
    fontSize: 12,
    color: '#B0B0B0',
  },
  actionIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#E6F4F8',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  actionLabel: { fontSize: 12, color: '#0788B0', fontWeight: '600' },

  // Sectioned cards on light gray bg (WhatsApp pattern)
  section: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginTop: 12,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#222B30',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  body: { fontSize: 14, color: '#333', lineHeight: 20 },
  muted: { fontSize: 13, color: '#7B7B7B' },

  infoRow: { flexDirection: 'row', paddingVertical: 6 },
  infoLabel: { width: 110, fontSize: 13, color: '#7B7B7B' },
  infoValue: { flex: 1, fontSize: 13, color: '#222B30' },

  // Tag chips (trip_structure / trip_vibes) — light pill, matches the existing
  // detail-row density. Wraps across rows when many tags are selected.
  tagsBlock: { marginTop: 12 },
  tagsLabel: {
    fontSize: 12,
    color: '#7B7B7B',
    marginBottom: 6,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tagChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tagChip: {
    backgroundColor: '#F2F2F2',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  tagChipText: { fontSize: 12, color: '#222B30', fontWeight: '500' },

  memberDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#ECECEC',
    marginLeft: 60,
  },

  // Bottom destructive card — Exit / Cancel rows
  destructiveCard: {
    backgroundColor: '#FFFFFF',
    marginTop: 12,
    paddingVertical: 4,
  },
  dangerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  dangerRowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ECECEC',
  },
  dangerRowText: { color: '#C0392B', fontSize: 15, fontWeight: '500' },

  // Sticky CTA (join flow only)
  // Foggy fade behind the floating CTA — fades scroll content into #FAFAFA
  // (mirrors the profile "Connect to …" overlay, incl. the web blur mask).
  ctaOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 215,
    zIndex: 9,
    overflow: 'hidden',
    ...(Platform.OS === 'web' && {
      backdropFilter: 'blur(6px)',
      WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 45%)',
      maskImage: 'linear-gradient(to bottom, transparent 0%, black 45%)',
    }),
  },
  ctaOverlayGradient: { flex: 1 },
  // Floating button wrapper — pinned above the home indicator. Inset wider than
  // the old full-width bar so the button reads "narrower", matching the create
  // flow's "Next" CTA.
  ctaFloat: {
    position: 'absolute',
    left: 56,
    right: 56,
    zIndex: 10,
  },
  // Shape copied from the create-flow "Next" button: taller (64), softer-but-
  // not-pill corners (14).
  ctaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 64,
    borderRadius: 14,
    paddingHorizontal: 24,
    gap: 6,
  },
  ctaPrimary: { backgroundColor: '#212121' },
  // Subtle press feedback — same scale dip used on the other trip buttons.
  ctaPressed: { transform: [{ scale: 0.97 }], opacity: 0.9 },
  ctaChat: { backgroundColor: '#05BCD3' },
  ctaPrimaryText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 16,
    fontFamily: ff('Montserrat', '600'),
  },
  ctaPending: { backgroundColor: '#F2F2F2' },
  ctaPendingText: { color: '#555', fontWeight: '600', fontSize: 14, marginLeft: 6 },
  ctaRequested: { backgroundColor: '#FFB443' },
  ctaDeclined: { backgroundColor: '#F2F2F2' },
  ctaDeclinedText: { color: '#7B7B7B', fontWeight: '600', fontSize: 14 },
  ctaDeclinedRow: { gap: 8 },
  ctaDeclinedNote: { color: '#7B7B7B', fontSize: 12, textAlign: 'center' },

  cancelledBanner: {
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#FDECEA',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cancelledText: { color: '#C0392B', fontSize: 13, fontWeight: '500', flex: 1 },
  endedBanner: {
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#EEF1F3',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  endedText: { color: '#445', fontSize: 13, fontWeight: '500', flex: 1 },
  manageBtnDisabled: { opacity: 0.6 },

  packingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  // "Edit suggested" host button (header of Your gear)
  editSuggestedBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  editSuggestedBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0788B0',
  },
  // Your gear — compact summary card (tap → full PersonalGearSheet)
  gearSummaryCard: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10,
  },
  gearSummaryCount: {
    fontSize: 13,
    fontWeight: '600',
    color: '#7B7B7B',
  },
  gearSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  gearSummaryItem: {
    flex: 1,
    fontSize: 15,
    color: '#222B30',
  },
  gearSummaryItemDone: {
    textDecorationLine: 'line-through',
    color: '#9AA0A6',
  },
  gearSummaryMore: {
    fontSize: 13,
    fontWeight: '600',
    color: '#7B7B7B',
    marginLeft: 28,
  },
  gearSummaryViewAllRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: 2,
  },
  gearSummaryViewAll: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0788B0',
  },
  packingToggleRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  packingToggleChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#DDD',
    backgroundColor: '#FFFFFF',
  },
  packingToggleChipActive: {
    borderColor: '#0788B0',
    backgroundColor: '#E6F4F8',
  },
  packingToggleText: { fontSize: 13, fontWeight: '600', color: '#7B7B7B' },
  packingToggleTextActive: { color: '#0788B0' },
  groupEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  groupEditInput: {
    borderWidth: 1,
    borderColor: '#DDD',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: '#222B30',
    backgroundColor: '#FFFFFF',
  },
  singleMultiChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#DDD',
    backgroundColor: '#FFFFFF',
  },
  singleMultiChipActive: {
    borderColor: '#0788B0',
    backgroundColor: '#E6F4F8',
  },
  singleMultiText: { fontSize: 12, fontWeight: '600', color: '#7B7B7B' },
  singleMultiTextActive: { color: '#0788B0' },
  singleMultiChipSmall: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#DDD',
    backgroundColor: '#FFFFFF',
    marginLeft: 4,
  },
  singleMultiChipSmallActive: {
    borderColor: '#0788B0',
    backgroundColor: '#E6F4F8',
  },
  singleMultiTextSmall: { fontSize: 11, fontWeight: '600', color: '#7B7B7B' },
  addItemBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    marginTop: 4,
  },
  addItemText: { color: '#0788B0', fontWeight: '600', fontSize: 13 },
  avatarStack: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 6,
  },
  avatarSmallWrap: { marginLeft: -6 },
  avatarSmall: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    backgroundColor: '#F2F2F2',
  },
  avatarSmallPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#A8DDE0',
  },
  avatarSmallInitial: { color: '#FFFFFF', fontWeight: '700', fontSize: 10 },
  avatarMoreText: { fontSize: 11, color: '#7B7B7B', marginLeft: 4 },
  packingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 10,
  },
  packingItemText: { fontSize: 14, color: '#222B30', flex: 1 },
  packingItemTextDone: { color: '#7B7B7B', textDecorationLine: 'line-through' },
  packingTextarea: {
    borderWidth: 1,
    borderColor: '#DDD',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 120,
    fontSize: 14,
    color: '#222B30',
    backgroundColor: '#FFFFFF',
    textAlignVertical: 'top',
    marginTop: 6,
  },
  packingActions: { flexDirection: 'row', gap: 10, marginTop: 10 },
  packingCancel: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#DDD',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  packingCancelText: { color: '#555', fontWeight: '600', fontSize: 14 },
  packingSave: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#0788B0',
    alignItems: 'center',
  },
  packingSaveText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  commitWrapper: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginTop: 12,
  },
  commitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#34C759',
  },
  commitBtnActive: {
    backgroundColor: '#34C759',
    borderColor: '#34C759',
  },
  commitBtnText: { color: '#34C759', fontWeight: '600', fontSize: 14 },
  commitBtnTextActive: { color: '#FFFFFF' },
  commitCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 10,
    gap: 8,
    backgroundColor: '#222B30',
  },
  commitCtaPending: { backgroundColor: '#7B7B7B' },
  commitCtaApproved: { backgroundColor: '#16A34A' },
  commitCtaText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  commitCtaCaption: {
    textAlign: 'center',
    fontSize: 12,
    color: '#7B7B7B',
    marginTop: 8,
  },

  // Personal gear extras (host suggestion tag + add button + inline editor)
  hostSuggestionTag: {
    marginLeft: 'auto',
    fontSize: 11,
    color: '#7B7B7B',
    fontStyle: 'italic',
  },
  personalToggleHit: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  personalAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 12,
    marginTop: 4,
  },
  personalAddBtnText: {
    color: '#0788B0',
    fontSize: 14,
    fontWeight: '600',
  },
  personalAddEditor: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    backgroundColor: '#FAFAFA',
    padding: 10,
  },
  personalAddInput: {
    fontSize: 14,
    color: '#222B30',
    padding: 0,
    minHeight: 32,
  },
  personalAddActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 8,
  },
  personalAddCancel: { paddingHorizontal: 12, paddingVertical: 8 },
  personalAddCancelText: { color: '#7B7B7B', fontWeight: '600', fontSize: 14 },
  personalAddSave: {
    backgroundColor: '#0788B0',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    minWidth: 64,
    alignItems: 'center',
  },
  personalAddSaveText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  btnDisabled: { opacity: 0.4 },

  // Group Gear section
  gearHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  gearHeaderTitle: { fontSize: 12, fontWeight: '700', color: '#4A5565', letterSpacing: 0.5 },
  gearHeaderSub: { fontSize: 13, color: '#7B7B7B', marginTop: 2 },
  gearManageBtn: {
    borderWidth: 1,
    borderColor: '#0788B0',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  gearManageBtnText: { fontSize: 13, fontWeight: '700', color: '#0788B0' },
  requestLinkBtn: { paddingVertical: 12, alignItems: 'center' },
  requestLinkText: {
    color: '#0788B0',
    fontSize: 14,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  gearReqsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EEEEEE',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 8,
    gap: 8,
  },
  gearReqsBadgeText: { flex: 1, color: '#222B30', fontWeight: '700', fontSize: 13 },

  // Admin updates
  addUpdateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#0788B0',
  },
  addUpdateBtnText: { fontSize: 13, fontWeight: '600', color: '#0788B0' },

  updateEditor: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
    backgroundColor: '#FAFAFA',
  },
  updateEditorInput: {
    fontSize: 14,
    color: '#222B30',
    minHeight: 44,
    padding: 0,
    textAlignVertical: 'top',
  },
  updateEditorActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 8,
  },
  updateEditorCancel: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  updateEditorCancelText: { color: '#7B7B7B', fontWeight: '600', fontSize: 14 },
  updateEditorSave: {
    backgroundColor: '#0788B0',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    minWidth: 64,
    alignItems: 'center',
  },
  updateEditorSaveDisabled: { opacity: 0.4 },
  updateEditorSaveText: { color: '#FFFFFF', fontWeight: '600', fontSize: 14 },

  updatesEmpty: { color: '#7B7B7B', fontSize: 14, fontStyle: 'italic' },

  updateRow: {
    flexDirection: 'row',
    paddingVertical: 10,
    alignItems: 'flex-start',
  },
  updateBullet: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: '#0788B0',
    marginTop: 4,
    marginRight: 12,
  },
  updateBody: { flex: 1 },
  updateText: { fontSize: 15, color: '#222B30', lineHeight: 20 },
  updateAuthor: { fontWeight: '700' },
  updateTime: { fontSize: 12, color: '#7B7B7B', marginTop: 2 },
});
