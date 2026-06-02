import React, { useEffect } from 'react';
import { HostingStyle, GroupTrip } from '../../services/trips/groupTripsService';
import CreateTripFlowA from './CreateTripFlowA';

interface CreateTripWizardProps {
  hostId: string | null;
  /** Hosting style chosen by the parent (chooser lives in TripsScreen now). In
   *  edit mode this is overridden by initialTrip.hosting_style. */
  hostingStyle: HostingStyle;
  onCreated: () => void;
  onCancel: () => void;
  /** When provided, runs in edit mode — style is locked from the trip row. */
  initialTrip?: GroupTrip;
  /** Load the saved draft on mount (chooser confirmed "Continue your trip?"). */
  resumeDraft?: boolean;
  /** Fired with `true` on mount and `false` on unmount, so the parent can show
   *  a confirm-discard prompt while the wizard is open. The chooser used to gate
   *  this — now that the chooser lives in TripsScreen, the wizard is always
   *  considered "started" the moment it mounts. */
  onStartedChange?: (started: boolean) => void;
}

/**
 * Pure router for trip creation. The hosting-style chooser used to live here but
 * was lifted into TripsScreen's Create tab — by the time this mounts, `hostingStyle`
 * is always known (either from the chooser or from initialTrip.hosting_style).
 * All three styles share CreateTripFlowA, which branches internally:
 *   - A → default flow (months/exact dates + AI budget)
 *   - B → adds the "About you" leader step + required specific stay
 *   - C → exact dates only + fixed per-person price + "What's included"
 */
export default function CreateTripWizard({
  hostId,
  hostingStyle,
  onCreated,
  onCancel,
  initialTrip,
  onStartedChange,
  resumeDraft,
}: CreateTripWizardProps) {
  // Edit mode locks style to the trip row's hosting_style.
  const effectiveStyle: HostingStyle = initialTrip?.hosting_style ?? hostingStyle;

  useEffect(() => {
    onStartedChange?.(true);
    return () => onStartedChange?.(false);
    // onStartedChange identity is owned by the parent; we only want this to fire
    // on mount/unmount of the wizard surface.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <CreateTripFlowA
      hostId={hostId}
      onCreated={onCreated}
      onCancel={onCancel}
      initialTrip={initialTrip}
      hostingStyle={effectiveStyle}
      resumeDraft={resumeDraft}
    />
  );
}
