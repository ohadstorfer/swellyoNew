import { useQuery } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router-dom';
import { fetchTrip } from '../services/trips';
import { PageHead } from '../components/Shell';
import { TripTabs, type TripTabKey } from '../components/TripTabs';
import { TripOverviewTab } from '../components/overview/TripOverview';
import { TripPage } from './TripPage';

/**
 * One trip, two tabs — the app's operator pair (TripDetailScreen
 * `visibleTabs`): Overview on the left, Dashboard on the right, and it OPENS on
 * Dashboard, because that is the tab with news. Overview is the page the
 * operator wrote themselves.
 *
 * The tab lives in the URL (`?tab=overview`) so a reload or a shared link keeps
 * it. Switching replaces the history entry instead of pushing one: a tab is not
 * a page, and Back should leave the trip rather than flip tabs.
 */
export function TripScreen() {
  const { tripId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tab: TripTabKey = params.get('tab') === 'overview' ? 'overview' : 'dashboard';
  // Same key as TripPage, so the title is already cached either way.
  const trip = useQuery({ queryKey: ['trip', tripId], queryFn: () => fetchTrip(tripId) });

  const tabs = (
    <TripTabs
      value={tab}
      onChange={next => setParams(next === 'dashboard' ? {} : { tab: next }, { replace: true })}
    />
  );

  if (tab === 'dashboard') return <TripPage tabs={tabs} />;

  return (
    <>
      <PageHead back="/trips" backLabel="All trips" title={trip.data?.title ?? ''} />
      {tabs}
      <TripOverviewTab tripId={tripId} />
    </>
  );
}
