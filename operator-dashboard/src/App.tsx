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
import { CrewPage } from './routes/CrewPage';
import { SettingsPage } from './routes/SettingsPage';
import { SetupPage } from './routes/SetupPage';
import { SetupBanner } from './components/SetupBanner';
import { useOperatorSetup } from './services/useOperatorSetup';

export function App() {
  const { session, loading, isOperator, hasAccess } = useAuth();
  // Hooks cannot sit behind the early returns below, so this runs for everyone
  // and does nothing without a user id — the reads are own-row only anyway.
  //
  // Operators only. Setup is the four things the person who SELLS the trip
  // settles once (Stripe, waiver, terms); a Manager has no Stripe account to
  // connect and nothing to do about someone else's.
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

  // Signed in, but we do not know yet whether they are an operator or crew.
  // Keep waiting rather than guessing — rendering NotOperatorPage on `null`
  // would flash a rejection at everyone on every page load.
  if (hasAccess === null) {
    return (
      <Shell>
        <Loading what="Checking your access" />
      </Shell>
    );
  }

  // No <Shell> and no <Routes>: nobody without a trip has anywhere to navigate
  // to, so this replaces the whole app rather than sitting inside its chrome.
  if (!hasAccess) {
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
        {/* Both are about the OPERATOR's own account — their Stripe connection,
            their default waiver, their cancellation policy. Crew have no such
            row, so the pages would read someone else's defaults or nothing at
            all. Redirected rather than 404'd: a stale bookmark should land
            somewhere useful. */}
        <Route
          path="/setup"
          element={isOperator ? <SetupPage /> : <Navigate to="/trips" replace />}
        />
        <Route
          path="/settings"
          element={isOperator ? <SettingsPage /> : <Navigate to="/trips" replace />}
        />
        <Route path="/trips" element={<TripsPage />} />
        <Route path="/trips/:tripId" element={<TripPage />} />
        <Route path="/trips/:tripId/money" element={<MoneyPage />} />
        {/* Not guarded here: "may I manage the crew" is a question about one
            trip, and the trip id only exists inside the page. CrewPage asks it
            and answers in words. */}
        <Route path="/trips/:tripId/crew" element={<CrewPage />} />
        <Route path="/trips/:tripId/waiting" element={<WaitingPage />} />
        <Route path="/trips/:tripId/d/:requirementId" element={<RequirementPage />} />
        <Route path="/trips/:tripId/t/:userId" element={<TravelerPage />} />
        <Route path="*" element={<Navigate to="/trips" replace />} />
      </Routes>
    </Shell>
  );
}
