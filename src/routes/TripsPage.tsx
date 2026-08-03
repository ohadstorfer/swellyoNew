import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { fetchOperatorTrips } from '../services/trips';
import { formatRange, daysUntil, plural } from '../lib/format';
import { Empty, ErrorBox, Loading } from '../components/StateBits';
import { PageHead } from '../components/Shell';

export function TripsPage() {
  const { user } = useAuth();

  const q = useQuery({
    queryKey: ['operator-trips', user?.id],
    queryFn: () => fetchOperatorTrips(user!.id),
    enabled: !!user?.id,
  });

  return (
    <>
      <PageHead title="Your trips" sub="Trips you run as an operator" />

      {q.isPending && <Loading what="Loading your trips" />}
      {q.isError && <ErrorBox error={q.error} onRetry={() => void q.refetch()} />}

      {q.data && q.data.length === 0 && (
        <Empty
          title="No operator trips on this account"
          note="You are signed in. Operator trips you host will show up here."
        />
      )}

      {q.data && q.data.length > 0 && (
        <div className="stack">
          {q.data.map(trip => {
            const days = daysUntil(trip.startDate);
            return (
              <Link
                key={trip.id}
                to={`/trips/${trip.id}`}
                className="card card-link enter"
              >
                <div className="card-body row-between">
                  <div>
                    <h3>{trip.title}</h3>
                    <p className="muted small" style={{ marginTop: 3 }}>
                      {formatRange(trip.startDate, trip.endDate)}
                      {trip.maxParticipants
                        ? ` · up to ${plural(trip.maxParticipants, 'spot')}`
                        : ''}
                    </p>
                  </div>
                  <div className="row" style={{ gap: 10 }}>
                    {/* Testing mode can list peer trips. Say so, or you will
                        forget which one is the real operator trip. */}
                    {trip.hostingStyle !== 'C' && (
                      <span className="tag tag-warn">Not an operator trip</span>
                    )}
                    {days !== null && days >= 0 && (
                      <span className="tag tag-idle">{plural(days, 'day')} to go</span>
                    )}
                    {days !== null && days < 0 && <span className="tag tag-idle">Finished</span>}
                    <span className="muted" aria-hidden>
                      ›
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
