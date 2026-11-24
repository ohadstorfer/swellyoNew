/**
 * The trip's tab bar — a web copy of the app's
 * `src/components/trips/TripTabToggle.tsx` (Figma 12557-4992, operator pair
 * 14980-65921): white strip, hairline under it, Inter 16, the active label bold
 * with a 3px cyan underline that slides between tabs.
 *
 * Operators get Overview + Dashboard, Overview on the left, like the app. Chat
 * is the app's third tab and is not here (SPEC §1).
 *
 * Bold vs regular is two stacked layers crossfaded, as in the app — swapping
 * `font-weight` would reflow the label mid-slide.
 */
export type TripTabKey = 'overview' | 'dashboard';

const TABS: { key: TripTabKey; label: string; icon: { viewBox: string; d: string } }[] = [
  {
    key: 'overview',
    label: 'Overview',
    // sun-setting-03 from the app's tripIcons.tsx
    icon: {
      viewBox: '0 0 16 14.7438',
      d: 'M3.54504 13.9344C4.45254 14.3469 5.60754 14.3469 6.51504 13.9344C7.42254 13.5219 8.57754 13.5219 9.48504 13.9344C10.3925 14.3469 11.5475 14.3469 12.455 13.9344M8 0.5V2M2 8H0.5M3.73559 3.73559L2.67493 2.67493M12.2642 3.73559L13.3248 2.67493M15.5 8H14M4.25 8C4.25 5.92893 5.92893 4.25 8 4.25C10.0711 4.25 11.75 5.92893 11.75 8M0.575073 11.3094C1.48257 10.8969 2.63757 10.8969 3.54507 11.3094C4.45257 11.7219 5.60757 11.7219 6.51507 11.3094C7.42257 10.8969 8.57757 10.8969 9.48507 11.3094C10.3926 11.7219 11.5476 11.7219 12.4551 11.3094C13.3626 10.8969 14.5176 10.8969 15.4251 11.3094',
    },
  },
  {
    key: 'dashboard',
    label: 'Dashboard',
    // layout-alt-04 from the app's tripIcons.tsx
    icon: {
      viewBox: '0 0 16 16',
      d: 'M8 8L14 8M8 2L8 14M5.2 2H10.8C11.9201 2 12.4802 2 12.908 2.21799C13.2843 2.40973 13.5903 2.71569 13.782 3.09202C14 3.51984 14 4.0799 14 5.2V10.8C14 11.9201 14 12.4802 13.782 12.908C13.5903 13.2843 13.2843 13.5903 12.908 13.782C12.4802 14 11.9201 14 10.8 14H5.2C4.07989 14 3.51984 14 3.09202 13.782C2.71569 13.5903 2.40973 13.2843 2.21799 12.908C2 12.4802 2 11.9201 2 10.8V5.2C2 4.07989 2 3.51984 2.21799 3.09202C2.40973 2.71569 2.71569 2.40973 3.09202 2.21799C3.51984 2 4.0799 2 5.2 2Z',
    },
  },
];

export function TripTabs({
  value,
  onChange,
}: {
  value: TripTabKey;
  onChange: (tab: TripTabKey) => void;
}) {
  const index = Math.max(0, TABS.findIndex(t => t.key === value));

  return (
    <div className="trip-tabs" role="tablist" aria-label="Trip">
      {TABS.map(tab => {
        const selected = tab.key === value;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={selected}
            className="trip-tab"
            aria-label={tab.label}
            onClick={() => {
              if (!selected) onChange(tab.key);
            }}
          >
            <svg width={16} height={16} viewBox={tab.icon.viewBox} fill="none" aria-hidden>
              <path d={tab.icon.d} stroke="currentColor" strokeWidth={1} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="trip-tab-label">
              <span className="trip-tab-bold" aria-hidden>
                {tab.label}
              </span>
              <span className="trip-tab-reg" aria-hidden>
                {tab.label}
              </span>
            </span>
          </button>
        );
      })}
      <span
        className="trip-tabs-indicator"
        aria-hidden
        style={{ width: `${100 / TABS.length}%`, transform: `translateX(${index * 100}%)` }}
      />
    </div>
  );
}
