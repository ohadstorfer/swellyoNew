import React, { useCallback, useState } from 'react';
import {
  ConnectAccountOnboarding,
  ConnectComponentsProvider,
  loadConnectAndInitialize,
  type StripeConnectInstance,
} from '@stripe/stripe-react-native';
import { fetchConnectAccountSession } from '../../services/trips/tripPaymentsService';

/**
 * Stripe Connect onboarding, drawn inside the app.
 *
 * `ConnectAccountOnboarding` presents itself full-screen — a native modal on
 * iOS, a React Native Modal on Android — so this renders no chrome of its own.
 * Mounting it opens the flow; `onExit` fires when the operator closes it.
 *
 * ── This file is NATIVE-ONLY ────────────────────────────────────────────────
 * `@stripe/stripe-react-native` has no JS fallback, so it does not exist in
 * Expo Go. Nothing here may be imported at module scope by a screen that has
 * to keep working there — ConnectStripeCard therefore `require`s this file
 * lazily, behind an `isExpoGo` check. Importing it eagerly would take down the
 * whole create-trip wizard on Expo Go, not just the Stripe button.
 *
 * ── Why the operator still sees a Stripe screen ─────────────────────────────
 * Partway through, Stripe asks the operator to authenticate with Stripe
 * itself. That is not a bug and it cannot be themed away. Removing it needs
 * `disable_stripe_user_authentication`, which Stripe only accepts when the
 * PLATFORM collects requirements — and that configuration makes Swellyo
 * liable for operators' negative balances. Ohad chose to leave that liability
 * with Stripe on 2026-08-04, knowing this was the cost. See the design notes
 * on `stripe-connect-onboard`.
 */
export const StripeConnectOnboarding: React.FC<{
  /** Fired when the operator closes onboarding — finished or not. */
  onExit: () => void;
  /** Fired when the component cannot load at all. */
  onLoadError?: (message: string) => void;
}> = ({ onExit, onLoadError }) => {
  // useState's initialiser form, not useMemo: this must run exactly once per
  // mount. useMemo is a performance hint that React is allowed to discard, and
  // a second Connect instance would re-open the flow from the start.
  const [connectInstance] = useState<StripeConnectInstance>(() =>
    loadConnectAndInitialize({
      publishableKey: PUBLISHABLE_KEY,
      // Called again by the SDK whenever the secret expires mid-flow, so it
      // must stay cheap and side-effect free.
      fetchClientSecret: fetchConnectAccountSession,
      appearance: {
        variables: {
          // The app's primary blue, so the form does not look borrowed.
          colorPrimary: '#0788B0',
        },
      },
    }),
  );

  const handleLoadError = useCallback(
    (e: { error?: { message?: string } } | Error) => {
      // Stripe can call this more than once for one failure, so whatever the
      // caller does with it has to be safe to run twice.
      const message =
        e instanceof Error ? e.message : (e?.error?.message ?? 'Stripe could not load');
      console.warn('[StripeConnectOnboarding] load error:', message);
      onLoadError?.(message);
    },
    [onLoadError],
  );

  return (
    <ConnectComponentsProvider connectInstance={connectInstance}>
      <ConnectAccountOnboarding
        title="Get paid with Stripe"
        onExit={onExit}
        onLoadError={handleLoadError}
      />
    </ConnectComponentsProvider>
  );
};

/**
 * Stripe's PUBLISHABLE key — safe in the bundle, unlike the secret key, which
 * lives only in the edge functions.
 *
 * It must come from the same Stripe account and the same mode as
 * STRIPE_SECRET_KEY on the server, or the account session will not load. A
 * `pk_test_` key here with an `sk_live_` key on the server is the usual way to
 * get a blank screen with no useful error.
 */
const PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';

/** Is the native onboarding usable at all? False when the key is missing. */
export const hasStripePublishableKey = PUBLISHABLE_KEY.length > 0;
