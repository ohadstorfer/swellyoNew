import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OperatorTrip } from '../services/trips';
import { completeTrip, ensureOperatorOnCrew, useTripHosts } from '../services/tripActions';
import { fetchMyCrewRow } from '../services/staff';
import { canCompleteTrip, tripIsLocked } from '../domain/tripLifecycle';
import { friendlyError } from '../lib/errors';
import { ConfirmDialog } from './ConfirmDialog';
import { ShareTripDialog } from './ShareTripDialog';
import '../styles/tripActions.css';

/**
 * The trip's "More" menu — the web twin of the app header's ⋮ menu
 * (TripDetailScreen `menuItems`), minus what is elsewhere on this site (Crew,
 * Your details, Your paperwork, Cancel) and minus messaging (SPEC §1).
 *
 * Each entry carries the app's exact condition:
 *   Share trip              everyone
 *   Complete trip           isHost && tripHasStarted && !isLocked
 *   Add yourself to crew    owner && operator trip && !isLocked && no crew row
 */
export function TripActionsMenu({ trip }: { trip: OperatorTrip }) {
  const qc = useQueryClient();
  const { viewerIsHost, me } = useTripHosts(trip.id, trip.hostId);
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<'share' | 'complete' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const isOwner = !!me && me === trip.hostId;
  const locked = tripIsLocked(trip);

  // Shares the query key with MyCrewCard, so the card appears the moment the
  // row exists and neither runs a second read.
  const mine = useQuery({
    queryKey: ['crew', trip.id, 'mine'],
    queryFn: () => fetchMyCrewRow(trip.id),
    enabled: isOwner && trip.hostingStyle === 'C' && !locked,
  });

  const complete = useMutation({
    mutationFn: () => completeTrip(trip.id),
    onSuccess: () => {
      setDialog(null);
      void qc.invalidateQueries({ queryKey: ['trip', trip.id] });
      void qc.invalidateQueries({ queryKey: ['trips'] });
    },
  });

  const joinCrew = useMutation({
    mutationFn: () => ensureOperatorOnCrew(trip.id, me!),
    onSuccess: () => {
      setNotice('You are on the crew. Your details are further down this page.');
      void qc.invalidateQueries({ queryKey: ['crew', trip.id] });
    },
    onError: e => setNotice(friendlyError(e)),
  });

  const showComplete = canCompleteTrip(trip, viewerIsHost);
  const showJoinCrew =
    isOwner && trip.hostingStyle === 'C' && !locked && mine.isSuccess && !mine.data;

  // Close on outside click and on Escape, returning focus to the trigger so a
  // keyboard user is not dropped at the top of the page.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <>
      <div className="ta-menu" ref={wrap}>
        <button
          ref={trigger}
          className="btn"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(o => !o)}
        >
          More
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {open && (
          <div className="ta-pop" role="menu">
            <button role="menuitem" className="ta-item" onClick={pick(() => setDialog('share'))}>
              Share trip
            </button>
            {showJoinCrew && (
              <button
                role="menuitem"
                className="ta-item"
                disabled={joinCrew.isPending}
                onClick={pick(() => joinCrew.mutate())}
              >
                <span>
                  Add yourself to the crew
                  <span className="ta-item-sub">So travelers see who runs this trip</span>
                </span>
              </button>
            )}
            {showComplete && (
              <>
                <div className="ta-sep" role="separator" />
                <button role="menuitem" className="ta-item" onClick={pick(() => setDialog('complete'))}>
                  Complete trip
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {notice && (
        <div className="banner enter" role="status" style={{ position: 'fixed', left: 16, right: 16, bottom: 16, zIndex: 45, maxWidth: 560, margin: '0 auto' }}>
          <span>{notice}</span>
          <button className="btn btn-sm" onClick={() => setNotice(null)}>
            OK
          </button>
        </div>
      )}

      {dialog === 'share' && (
        <ShareTripDialog tripId={trip.id} tripTitle={trip.title} onClose={() => setDialog(null)} />
      )}

      {dialog === 'complete' && (
        // The app's copy, word for word.
        <ConfirmDialog
          title="Mark trip as completed?"
          confirmLabel="Mark completed"
          cancelLabel="Keep open"
          busyLabel="Completing…"
          danger
          busy={complete.isPending}
          error={complete.isError ? friendlyError(complete.error) : null}
          onConfirm={() => complete.mutate()}
          onCancel={() => {
            complete.reset();
            setDialog(null);
          }}
        >
          <p>
            This closes the trip. Members keep the group chat and overview, but the plan is
            locked. You can't undo this.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
