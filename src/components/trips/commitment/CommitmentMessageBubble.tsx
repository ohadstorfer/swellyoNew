import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { CommitmentCardIcon } from './CommitmentCardIcon';
import Svg, { Path, G } from 'react-native-svg';
import Reanimated, { LinearTransition, FadeOut } from 'react-native-reanimated';
import type { CommitmentMetadata } from '../../../services/messaging/messagingService';
import { ff } from '../../../theme/fonts';
import { commitmentItemMeta } from './commitmentOptions';

// "check-verified-02" badge (Figma) — teal scalloped badge with a white check.
// Exported so the member's CommitmentScreen reuses the exact same mark.
export const CommitmentBadgeIcon: React.FC<{ size?: number }> = ({ size = 24 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M17.9012 4.99851C18.1071 5.49653 18.5024 5.8924 19.0001 6.09907L20.7452 6.82198C21.2433 7.02828 21.639 7.42399 21.8453 7.92206C22.0516 8.42012 22.0516 8.97974 21.8453 9.47781L21.1229 11.2218C20.9165 11.7201 20.9162 12.2803 21.1236 12.7783L21.8447 14.5218C21.9469 14.7685 21.9996 15.0329 21.9996 15.2999C21.9997 15.567 21.9471 15.8314 21.8449 16.0781C21.7427 16.3249 21.5929 16.549 21.4041 16.7378C21.2152 16.9266 20.991 17.0764 20.7443 17.1785L19.0004 17.9009C18.5023 18.1068 18.1065 18.5021 17.8998 18.9998L17.1769 20.745C16.9706 21.2431 16.575 21.6388 16.0769 21.8451C15.5789 22.0514 15.0193 22.0514 14.5212 21.8451L12.7773 21.1227C12.2792 20.9169 11.7198 20.9173 11.2221 21.1239L9.47689 21.8458C8.97912 22.0516 8.42001 22.0514 7.92237 21.8453C7.42473 21.6391 7.02925 21.2439 6.82281 20.7464L6.09972 19.0006C5.8938 18.5026 5.49854 18.1067 5.00085 17.9L3.25566 17.1771C2.75783 16.9709 2.36226 16.5754 2.15588 16.0777C1.94951 15.5799 1.94923 15.0205 2.1551 14.5225L2.87746 12.7786C3.08325 12.2805 3.08283 11.7211 2.8763 11.2233L2.15497 9.47678C2.0527 9.2301 2.00004 8.96568 2 8.69863C1.99996 8.43159 2.05253 8.16715 2.15472 7.92043C2.25691 7.67372 2.40671 7.44955 2.59557 7.26075C2.78442 7.07195 3.00862 6.92222 3.25537 6.8201L4.9993 6.09772C5.49687 5.89197 5.89248 5.4972 6.0993 5.00006L6.82218 3.25481C7.02848 2.75674 7.42418 2.36103 7.92222 2.15473C8.42027 1.94842 8.97987 1.94842 9.47792 2.15473L11.2218 2.87712C11.7199 3.08291 12.2793 3.08249 12.7771 2.87595L14.523 2.15585C15.021 1.94966 15.5804 1.9497 16.0784 2.15597C16.5763 2.36223 16.972 2.75783 17.1783 3.25576L17.9014 5.00153L17.9012 4.99851Z"
      fill="#2BCCBD"
    />
    <Path
      d="M9 12L11 14L15.5 9.5M17.9012 4.99851C18.1071 5.49653 18.5024 5.8924 19.0001 6.09907L20.7452 6.82198C21.2433 7.02828 21.639 7.42399 21.8453 7.92206C22.0516 8.42012 22.0516 8.97974 21.8453 9.47781L21.1229 11.2218C20.9165 11.7201 20.9162 12.2803 21.1236 12.7783L21.8447 14.5218C21.9469 14.7685 21.9996 15.0329 21.9996 15.2999C21.9997 15.567 21.9471 15.8314 21.8449 16.0781C21.7427 16.3249 21.5929 16.549 21.4041 16.7378C21.2152 16.9266 20.991 17.0764 20.7443 17.1785L19.0004 17.9009C18.5023 18.1068 18.1065 18.5021 17.8998 18.9998L17.1769 20.745C16.9706 21.2431 16.575 21.6388 16.0769 21.8451C15.5789 22.0514 15.0193 22.0514 14.5212 21.8451L12.7773 21.1227C12.2792 20.9169 11.7198 20.9173 11.2221 21.1239L9.47689 21.8458C8.97912 22.0516 8.42001 22.0514 7.92237 21.8453C7.42473 21.6391 7.02925 21.2439 6.82281 20.7464L6.09972 19.0006C5.8938 18.5026 5.49854 18.1067 5.00085 17.9L3.25566 17.1771C2.75783 16.9709 2.36226 16.5754 2.15588 16.0777C1.94951 15.5799 1.94923 15.0205 2.1551 14.5225L2.87746 12.7786C3.08325 12.2805 3.08283 11.7211 2.8763 11.2233L2.15497 9.47678C2.0527 9.2301 2.00004 8.96568 2 8.69863C1.99996 8.43159 2.05253 8.16715 2.15472 7.92043C2.25691 7.67372 2.40671 7.44955 2.59557 7.26075C2.78442 7.07195 3.00862 6.92222 3.25537 6.8201L4.9993 6.09772C5.49687 5.89197 5.89248 5.4972 6.0993 5.00006L6.82218 3.25481C7.02848 2.75674 7.42418 2.36103 7.92222 2.15473C8.42027 1.94842 8.97987 1.94842 9.47792 2.15473L11.2218 2.87712C11.7199 3.08291 12.2793 3.08249 12.7771 2.87595L14.523 2.15585C15.021 1.94966 15.5804 1.9497 16.0784 2.15597C16.5763 2.36223 16.972 2.75783 17.1783 3.25576L17.9014 5.00153L17.9012 4.99851Z"
      stroke="#FFFFFF"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

// "message-question-square" (Figma) — sits in the note's gray icon box.
const NoteIcon: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <Svg width={size} height={size} viewBox="0 0 18 18" fill="none">
    <Path
      d="M7.5 6.00168C7.63215 5.62602 7.89298 5.30925 8.2363 5.10748C8.57962 4.90571 8.98327 4.83195 9.37576 4.89928C9.76825 4.9666 10.1243 5.17065 10.3807 5.4753C10.6372 5.77995 10.7775 6.16554 10.7769 6.56376C10.7769 7.68792 9.09069 8.25 9.09069 8.25M9.11243 10.5H9.11993M5.25 13.5V15.2516C5.25 15.6513 5.25 15.8511 5.33192 15.9537C5.40317 16.043 5.5112 16.0949 5.6254 16.0948C5.75672 16.0946 5.91275 15.9698 6.22482 15.7201L8.01391 14.2889C8.37939 13.9965 8.56213 13.8503 8.76561 13.7463C8.94615 13.6541 9.13832 13.5867 9.33691 13.5459C9.56075 13.5 9.79477 13.5 10.2628 13.5H12.15C13.4101 13.5 14.0402 13.5 14.5215 13.2548C14.9448 13.039 15.289 12.6948 15.5048 12.2715C15.75 11.7902 15.75 11.1601 15.75 9.9V5.85C15.75 4.58988 15.75 3.95982 15.5048 3.47852C15.289 3.05516 14.9448 2.71095 14.5215 2.49524C14.0402 2.25 13.4101 2.25 12.15 2.25H5.85C4.58988 2.25 3.95982 2.25 3.47852 2.49524C3.05516 2.71095 2.71095 3.05516 2.49524 3.47852C2.25 3.95982 2.25 4.58988 2.25 5.85V10.5C2.25 11.1975 2.25 11.5462 2.32667 11.8323C2.53472 12.6088 3.1412 13.2153 3.91766 13.4233C4.20378 13.5 4.55252 13.5 5.25 13.5Z"
      stroke="#222B30"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

// Header presentation per commitment status (Figma 13435:16162 — three cards).
const HEADER_BY_STATE = {
  pending: { label: 'Commitment request', color: '#FFB443' },
  approved: { label: 'Commitment Approved', color: '#2BCCBD' },
  declined: { label: 'Commitment Declined', color: '#FB3748' },
} as const;

// Scalloped "seal" badge (Figma) shared by all three states — centred in a
// 24-unit viewBox. The fill is the status colour; a white glyph sits on top.
const SEAL_D =
  'M17.9012 4.99851C18.1071 5.49653 18.5024 5.8924 19.0001 6.09907L20.7452 6.82198C21.2433 7.02828 21.639 7.42399 21.8453 7.92206C22.0516 8.42012 22.0516 8.97974 21.8453 9.47781L21.1229 11.2218C20.9165 11.7201 20.9162 12.2803 21.1236 12.7783L21.8447 14.5218C21.9469 14.7685 21.9996 15.0329 21.9996 15.2999C21.9997 15.567 21.9471 15.8314 21.8449 16.0781C21.7427 16.3249 21.5929 16.549 21.4041 16.7378C21.2152 16.9266 20.991 17.0764 20.7443 17.1785L19.0004 17.9009C18.5023 18.1068 18.1065 18.5021 17.8998 18.9998L17.1769 20.745C16.9706 21.2431 16.575 21.6388 16.0769 21.8451C15.5789 22.0514 15.0193 22.0514 14.5212 21.8451L12.7773 21.1227C12.2792 20.9169 11.7198 20.9173 11.2221 21.1239L9.47689 21.8458C8.97912 22.0516 8.42001 22.0514 7.92237 21.8453C7.42473 21.6391 7.02925 21.2439 6.82281 20.7464L6.09972 19.0006C5.8938 18.5026 5.49854 18.1067 5.00085 17.9L3.25566 17.1771C2.75783 16.9709 2.36226 16.5754 2.15588 16.0777C1.94951 15.5799 1.94923 15.0205 2.1551 14.5225L2.87746 12.7786C3.08325 12.2805 3.08283 11.7211 2.8763 11.2233L2.15497 9.47678C2.0527 9.2301 2.00004 8.96568 2 8.69863C1.99996 8.43159 2.05253 8.16715 2.15472 7.92043C2.25691 7.67372 2.40671 7.44955 2.59557 7.26075C2.78442 7.07195 3.00862 6.92222 3.25537 6.8201L4.9993 6.09772C5.49687 5.89197 5.89248 5.4972 6.0993 5.00006L6.82218 3.25481C7.02848 2.75674 7.42418 2.36103 7.92222 2.15473C8.42027 1.94842 8.97987 1.94842 9.47792 2.15473L11.2218 2.87712C11.7199 3.08291 12.2793 3.08249 12.7771 2.87595L14.523 2.15585C15.021 1.94966 15.5804 1.9497 16.0784 2.15597C16.5763 2.36223 16.972 2.75783 17.1783 3.25576L17.9014 5.00153L17.9012 4.99851Z';

// White glyphs (Figma exports, own viewBoxes) translated to the seal's centre.
const OVERLAY_BY_STATE = {
  // bell-01
  pending: {
    d: 'M3.03882 8.41667C3.33262 8.67598 3.71856 8.83333 4.14125 8.83333C4.56393 8.83333 4.94987 8.67598 5.24367 8.41667M6.64125 3C6.64125 2.33696 6.37785 1.70107 5.90901 1.23223C5.44017 0.763392 4.80429 0.5 4.14125 0.5C3.4782 0.5 2.84232 0.763392 2.37348 1.23223C1.90464 1.70107 1.64125 2.33696 1.64125 3C1.64125 4.28758 1.31644 5.16915 0.953606 5.75226C0.647548 6.24411 0.494519 6.49004 0.500131 6.55865C0.506344 6.63461 0.522437 6.66358 0.583652 6.70899C0.638936 6.75 0.888158 6.75 1.3866 6.75H6.89589C7.39433 6.75 7.64355 6.75 7.69884 6.70899C7.76005 6.66358 7.77615 6.63461 7.78236 6.55865C7.78797 6.49004 7.63494 6.24411 7.32889 5.75226C6.96605 5.16915 6.64125 4.28758 6.64125 3Z',
    tx: 7.859,
    ty: 7.333,
  },
  // glasses-01
  approved: {
    d: 'M3 6.33333H4.66667M2.5 8.83333H5.16667C5.86673 8.83333 6.21677 8.83333 6.48416 8.69709C6.71936 8.57725 6.91058 8.38602 7.03043 8.15082C7.16667 7.88343 7.16667 7.5334 7.16667 6.83333V2.5C7.16667 1.79993 7.16667 1.4499 7.03043 1.18251C6.91058 0.94731 6.71936 0.756084 6.48416 0.636242C6.21677 0.500001 5.86673 0.500001 5.16667 0.500001H2.5C1.79993 0.500001 1.4499 0.500001 1.18251 0.636242C0.94731 0.756084 0.756084 0.94731 0.636242 1.18251C0.500001 1.4499 0.500001 1.79993 0.500001 2.5V6.83333C0.500001 7.5334 0.500001 7.88343 0.636242 8.15082C0.756084 8.38602 0.94731 8.57725 1.18251 8.69709C1.4499 8.83333 1.79993 8.83333 2.5 8.83333ZM5.08333 3.41667C5.08333 4.10702 4.52369 4.66667 3.83333 4.66667C3.14298 4.66667 2.58333 4.10702 2.58333 3.41667C2.58333 2.72631 3.14298 2.16667 3.83333 2.16667C4.52369 2.16667 5.08333 2.72631 5.08333 3.41667Z',
    tx: 8.167,
    ty: 7.333,
  },
  // alert-triangle
  declined: {
    d: 'M4.77641 3.21006V4.87672M4.77641 6.54339H4.78058M4.19946 1.08161L0.772428 7.00103C0.582342 7.32936 0.4873 7.49353 0.501347 7.62826C0.513599 7.74578 0.57517 7.85257 0.670736 7.92206C0.780301 8.00172 0.969994 8.00172 1.34938 8.00172H8.20345C8.58283 8.00172 8.77253 8.00172 8.88209 7.92206C8.97766 7.85257 9.03923 7.74578 9.05148 7.62826C9.06553 7.49353 8.97049 7.32936 8.7804 7.00103L5.35336 1.08161C5.16396 0.754456 5.06926 0.59088 4.94571 0.535942C4.83793 0.488019 4.7149 0.488019 4.60712 0.535942C4.48357 0.59088 4.38887 0.754456 4.19946 1.08161Z',
    tx: 7.224,
    ty: 7.749,
  },
} as const;

// Header badge: status-coloured seal + white glyph. Replaces the static
// teal check badge so request/approved/declined each read correctly.
const CommitmentStatusBadge: React.FC<{
  state: keyof typeof HEADER_BY_STATE;
  size?: number;
}> = ({ state, size = 24 }) => {
  const overlay = OVERLAY_BY_STATE[state];
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d={SEAL_D}
        fill={HEADER_BY_STATE[state].color}
        stroke="#FFFFFF"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <G transform={`translate(${overlay.tx} ${overlay.ty})`}>
        <Path
          d={overlay.d}
          stroke="#FFFFFF"
          strokeWidth={1}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </G>
    </Svg>
  );
};

interface Props {
  metadata: CommitmentMetadata;
  /** Name to show in the system line above the card ("X requested to be Committed"). */
  senderName?: string | null;
  /** True when current viewer is the sender (member). */
  isOwn?: boolean;
  /** Provided only when viewer is the host moderating this DM. When both
   *  callbacks are supplied and status is 'pending', Approve/Decline render
   *  inline. Approve opens a confirm modal first; Decline fires immediately. */
  onApprove?: () => Promise<void>;
  onDecline?: () => Promise<void>;
}

export const CommitmentMessageBubble: React.FC<Props> = ({
  metadata,
  senderName,
  isOwn,
  onApprove,
  onDecline,
}) => {
  const items = metadata.items ?? [];
  const note = metadata.note ?? '';
  const status = metadata.status ?? 'pending';

  // The just-tapped choice (optimistic) — drives the collapse/grow animation.
  const [decided, setDecided] = useState<null | 'approved' | 'declined'>(null);

  const canModerate = !isOwn && status === 'pending' && !!onApprove && !!onDecline;
  // Resolved outcome: the fresh tap wins; otherwise the persisted status.
  const resolved: 'approved' | 'declined' | null =
    decided ?? (status === 'approved' ? 'approved' : status === 'declined' ? 'declined' : null);

  // Fire the actual approve/decline. Optimistically hides the buttons; reverts on error.
  const runDecision = async (choice: 'approved' | 'declined') => {
    setDecided(choice); // optimistic — buttons fade out, header conveys the outcome
    try {
      if (choice === 'approved') await onApprove?.();
      else await onDecline?.();
    } catch (e: any) {
      setDecided(null); // revert on failure → buttons come back
      Alert.alert(
        choice === 'approved' ? 'Could not approve' : 'Could not reject',
        e?.message || 'Please try again.'
      );
    }
  };

  // Native "are you sure?" confirmation before committing to the decision.
  const pick = (choice: 'approved' | 'declined') => {
    if (decided) return;
    const isApprove = choice === 'approved';
    Alert.alert(
      isApprove ? 'Approve commitment?' : 'Decline commitment?',
      isApprove
        ? 'They’ll appear as committed to everyone on the trip.'
        : 'Their commitment will be rejected and they’ll be notified.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: isApprove ? 'Approve' : 'Decline',
          style: isApprove ? 'default' : 'destructive',
          onPress: () => {
            void runDecision(choice);
          },
        },
      ]
    );
  };

  // Header label, colour and badge follow the resolved outcome (fresh tap wins).
  const headerState: 'pending' | 'approved' | 'declined' =
    resolved === 'approved' ? 'approved' : resolved === 'declined' ? 'declined' : 'pending';
  const headerCfg = HEADER_BY_STATE[headerState];
  // Approve/Decline render only while actionable and undecided. Once a decision
  // is made (or already persisted) the header alone conveys it — no status button.
  const showButtons = canModerate && !decided;
  // Lead-in ("X claimed that…") shows only on an open request.
  const showClaim = headerState === 'pending' && status !== 'superseded';
  const claimText = senderName ? `${senderName} claimed that…` : 'How you’re committed';

  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        {/* Header — label, colour and badge reflect the commitment status. */}
        <View style={styles.header}>
          <CommitmentStatusBadge state={headerState} size={24} />
          <Text style={[styles.headerText, { color: headerCfg.color }]}>{headerCfg.label}</Text>
        </View>

        {/* Lead-in (open request only) → chips of what was committed */}
        <View style={styles.body}>
          {showClaim ? <Text style={styles.claimLabel}>{claimText}</Text> : null}
          <View style={[styles.chips, showClaim && styles.chipsSpaced]}>
            {items.length === 0 ? (
              <View style={styles.chip}>
                <Text style={styles.chipText}>Committing to the trip</Text>
              </View>
            ) : (
              items.map((key) => {
                const cfg = commitmentItemMeta(key);
                return (
                  <View key={key} style={styles.chip}>
                    <CommitmentCardIcon itemKey={key} size={14} color="#7B7B7B" />
                    <Text style={styles.chipText}>{cfg.label}</Text>
                  </View>
                );
              })
            )}
          </View>
        </View>

        {/* Note */}
        {note ? (
          <View style={styles.noteRow}>
            <View style={styles.noteIconBox}>
              <NoteIcon size={18} />
            </View>
            <Text style={styles.noteText} numberOfLines={6}>
              {note}
            </Text>
          </View>
        ) : null}

        {/* Actions (host, open request only). After a decision both fade out and
            the header alone conveys the outcome — no lingering status button. */}
        {showButtons ? (
          <View style={styles.buttons}>
            <Reanimated.View
              key="approve"
              style={styles.btnFlex}
              layout={LinearTransition.duration(320)}
              exiting={FadeOut.duration(160)}
            >
              <TouchableOpacity
                style={styles.approveBtn}
                onPress={() => pick('approved')}
                disabled={!!decided}
                activeOpacity={0.85}
              >
                <Text style={styles.approveText}>Approve</Text>
              </TouchableOpacity>
            </Reanimated.View>
            <Reanimated.View
              key="decline"
              style={styles.btnFlex}
              layout={LinearTransition.duration(320)}
              exiting={FadeOut.duration(160)}
            >
              <TouchableOpacity
                style={styles.declineBtn}
                onPress={() => pick('declined')}
                disabled={!!decided}
                activeOpacity={0.85}
              >
                <Text style={styles.declineText}>Decline</Text>
              </TouchableOpacity>
            </Reanimated.View>
          </View>
        ) : status === 'superseded' ? (
          <View style={styles.statusWrap}>
            <Text style={styles.statusMuted}>Replaced by a newer submission</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    marginVertical: 6,
    alignSelf: 'stretch',
  },

  // Card (Figma 13448:19688)
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingBottom: 12,
    // Box Shadow 01 — #596E7C26, offset(0,2), radius 8.
    shadowColor: '#596E7C',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#EEEEEE',
  },
  headerText: {
    flex: 1,
    fontFamily: ff('Inter', '700'),
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '700',
  },
  body: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  claimLabel: {
    fontFamily: ff('Inter', '700'),
    fontSize: 16,
    lineHeight: 18,
    fontWeight: '700',
    color: '#333333',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chipsSpaced: {
    marginTop: 16,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CFCFCF',
    borderRadius: 9,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  chipText: {
    fontFamily: ff('Inter', '400'),
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '400',
    color: '#7B7B7B',
    textAlign: 'center',
  },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  noteIconBox: {
    backgroundColor: '#F7F7F7',
    padding: 10,
    borderRadius: 8,
  },
  noteText: {
    flex: 1,
    fontFamily: ff('Inter', '400'),
    fontSize: 12,
    lineHeight: 18,
    fontStyle: 'italic',
    fontWeight: '400',
    color: '#7B7B7B',
  },
  buttons: {
    flexDirection: 'row',
    gap: 16,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  // Animated row child — owns the flex; the button inside stretches to fill it.
  btnFlex: { flex: 1 },
  approveBtn: {
    backgroundColor: '#05BCD3',
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  approveText: {
    fontFamily: ff('Inter', '400'),
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '400',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  declineBtn: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#CFCFCF',
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  declineText: {
    fontFamily: ff('Inter', '400'),
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '400',
    color: '#333333',
    textAlign: 'center',
  },
  // Resolved status — only the "superseded" case still uses a text row.
  statusWrap: { paddingHorizontal: 16, paddingTop: 16 },
  statusMuted: {
    fontFamily: ff('Inter', '400'),
    fontSize: 12,
    lineHeight: 18,
    color: '#9AA0A6',
  },
});
