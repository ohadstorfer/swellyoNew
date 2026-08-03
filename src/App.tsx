import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { Shell } from './components/Shell';
import { Loading } from './components/StateBits';
import { LoginPage } from './routes/LoginPage';
import { TripsPage } from './routes/TripsPage';
import { TripPage } from './routes/TripPage';
import { RequirementPage } from './routes/RequirementPage';
import { TravelerPage } from './routes/TravelerPage';

export function App() {
  const { session, loading } = useAuth();

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

  return (
    <Shell>
      <Routes>
        <Route path="/trips" element={<TripsPage />} />
        <Route path="/trips/:tripId" element={<TripPage />} />
        <Route path="/trips/:tripId/d/:requirementId" element={<RequirementPage />} />
        <Route path="/trips/:tripId/t/:userId" element={<TravelerPage />} />
        <Route path="*" element={<Navigate to="/trips" replace />} />
      </Routes>
    </Shell>
  );
}
