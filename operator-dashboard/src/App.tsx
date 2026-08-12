import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { Shell } from './components/Shell';
import { Loading } from './components/StateBits';
import { LoginPage } from './routes/LoginPage';
import { NotOperatorPage } from './routes/NotOperatorPage';
import { TripsPage } from './routes/TripsPage';
import { TripPage } from './routes/TripPage';
import { RequirementPage } from './routes/RequirementPage';
import { WaitingPage } from './routes/WaitingPage';
import { TravelerPage } from './routes/TravelerPage';
import { MoneyPage } from './routes/MoneyPage';
import { SettingsPage } from './routes/SettingsPage';
import { SetupPage } from './routes/SetupPage';
import { SetupBanner } from './components/SetupBanner';
import { useOperatorSetup } from './services/useOperatorSetup';

export function App() {
  const { session, loading, isOperator } = useAuth();
  // Hooks cannot sit behind the early returns below, so this runs for everyone
  // and does nothing without a user id — the reads are own-row only anyway.
  const setup = useOperatorSetup(isOperator ? (session?.user?.id ?? null) : null);

  if (loading) {
    return (
      <Shell>
        <Loading what="Signing you in" />
      </Shell>
    );
  }

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  // Signed in, but we do not know yet whether they are an operator. Keep
  // waiting rather than guessing — rendering NotOperatorPage on `null` would
  // flash a rejection at every operator on every page load.
  if (isOperator === null) {
    return (
      <Shell>
        <Loading what="Checking your access" />
      </Shell>
    );
  }

  // No <Shell> and no <Routes>: every route below is operator-only, so this
  // replaces the whole app rather than sitting inside its chrome. There is
  // nothing to navigate to.
  if (!isOperator) {
    return <NotOperatorPage />;
  }

  return (
    <Shell>
      {/* Above the routes, so it shows on every page — same reason as the app's
          banner sitting above the tab pager. Silent until both reads have
          settled, so a finished operator never sees it flash. */}
      {setup.ready && !setup.complete && (
        <SetupBanner summary={setup.summary} done={setup.done} total={setup.total} />
      )}
      <Routes>
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/trips" element={<TripsPage />} />
        <Route path="/trips/:tripId" element={<TripPage />} />
        <Route path="/trips/:tripId/money" element={<MoneyPage />} />
        <Route path="/trips/:tripId/waiting" element={<WaitingPage />} />
        <Route path="/trips/:tripId/d/:requirementId" element={<RequirementPage />} />
        <Route path="/trips/:tripId/t/:userId" element={<TravelerPage />} />
        <Route path="*" element={<Navigate to="/trips" replace />} />
      </Routes>
    </Shell>
  );
}
