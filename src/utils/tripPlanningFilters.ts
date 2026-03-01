/**
 * Helpers to flatten queryFilters/requestData into a display list for the filters menu
 * and to remove a single filter from requestData.
 */

export interface FilterDisplayItem {
  id: string;
  label: string;
  filterKey: string;
  value: any;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function formatSurfboardType(t: string): string {
  const normalized = (t || '').toLowerCase();
  if (normalized === 'shortboard') return 'a shortboard';
  if (normalized === 'longboard') return 'a longboard';
  if (normalized === 'funboard') return 'a funboard';
  if (normalized === 'fish') return 'a fish';
  if (normalized === 'foam' || normalized === 'soft top') return 'a foam board';
  return `a ${normalized}`;
}

/** For display in filters: if value is "United States - StateName", return "StateName"; otherwise return value. */
function displayCountryOrState(s: string): string {
  const v = (s || '').trim();
  if (/^United States - /i.test(v)) return v.replace(/^United States - /i, '').trim();
  return v;
}

/**
 * Convert queryFilters (and optional requestData fields) into a flat list of display items.
 */
export function queryFiltersToDisplayList(
  queryFilters: Record<string, any> | null | undefined,
  requestData?: { destination_country?: string; area?: string | null } | null
): FilterDisplayItem[] {
  const items: FilterDisplayItem[] = [];
  if (!queryFilters || typeof queryFilters !== 'object') {
    if (requestData?.destination_country) {
      items.push({
        id: 'destination_country',
        label: `Surfed in ${displayCountryOrState(requestData.destination_country)}`,
        filterKey: 'destination_country',
        value: requestData.destination_country,
      });
    }
    if (requestData?.area) {
      items.push({
        id: 'area',
        label: `Area – ${requestData.area}`,
        filterKey: 'area',
        value: requestData.area,
      });
    }
    return items;
  }

  if (queryFilters.country_from && Array.isArray(queryFilters.country_from)) {
    for (const country of queryFilters.country_from) {
      if (country != null && String(country).trim()) {
        items.push({
          id: `country_from_${String(country).trim()}`,
          label: `Origin – ${displayCountryOrState(String(country).trim())}`,
          filterKey: 'country_from',
          value: country,
        });
      }
    }
  }

  if (queryFilters.surfboard_type) {
    const types = Array.isArray(queryFilters.surfboard_type)
      ? queryFilters.surfboard_type
      : [queryFilters.surfboard_type];
    for (const t of types) {
      if (t != null && String(t).trim()) {
        items.push({
          id: `surfboard_type_${String(t).trim()}`,
          label: `Surfing ${formatSurfboardType(String(t).trim())}`,
          filterKey: 'surfboard_type',
          value: t,
        });
      }
    }
  }

  if (
    queryFilters.age_min !== undefined &&
    queryFilters.age_min !== null &&
    queryFilters.age_max !== undefined &&
    queryFilters.age_max !== null
  ) {
    items.push({
      id: 'age_range',
      label: `Age ${queryFilters.age_min}–${queryFilters.age_max}`,
      filterKey: 'age_range',
      value: { age_min: queryFilters.age_min, age_max: queryFilters.age_max },
    });
  }

  if (queryFilters.surf_level_category) {
    const cat = String(queryFilters.surf_level_category).toLowerCase();
    const label = capitalize(cat);
    items.push({
      id: 'surf_level_category',
      label: `Surf level – ${label}`,
      filterKey: 'surf_level_category',
      value: queryFilters.surf_level_category,
    });
  } else if (
    queryFilters.surf_level_min !== undefined ||
    queryFilters.surf_level_max !== undefined
  ) {
    const min = queryFilters.surf_level_min ?? '';
    const max = queryFilters.surf_level_max ?? '';
    const label = min !== '' && max !== '' ? `Level ${min}–${max}` : min !== '' ? `Level ≥ ${min}` : `Level ≤ ${max}`;
    items.push({
      id: 'surf_level_range',
      label: `Surf level – ${label}`,
      filterKey: 'surf_level_range',
      value: { surf_level_min: queryFilters.surf_level_min, surf_level_max: queryFilters.surf_level_max },
    });
  }

  if (queryFilters.destination_days_min && typeof queryFilters.destination_days_min === 'object') {
    const d = queryFilters.destination_days_min;
    const dest = d.destination ? String(d.destination).trim() : '';
    if (dest) {
      items.push({
        id: 'destination_days_min',
        label: `Surfed ${displayCountryOrState(dest)}`,
        filterKey: 'destination_days_min',
        value: queryFilters.destination_days_min,
      });
    }
  }

  if (!requestData) return items;
  if (requestData.destination_country && !items.some((i) => i.filterKey === 'destination_country')) {
    items.push({
      id: 'destination_country',
      label: `Surfed in ${displayCountryOrState(requestData.destination_country)}`,
      filterKey: 'destination_country',
      value: requestData.destination_country,
    });
  }
  if (requestData.area && !items.some((i) => i.filterKey === 'area')) {
    items.push({
      id: 'area',
      label: `Area – ${requestData.area}`,
      filterKey: 'area',
      value: requestData.area,
    });
  }
  return items;
}

/**
 * Return a new requestData object with the given filter removed.
 * Does not mutate the input.
 */
export function removeFilterFromRequestData(
  requestData: any,
  item: FilterDisplayItem
): any {
  if (!requestData || typeof requestData !== 'object') return requestData;
  const next = { ...requestData };
  const qf = next.queryFilters ? { ...next.queryFilters } : {};

  switch (item.filterKey) {
    case 'country_from': {
      const arr = Array.isArray(qf.country_from) ? qf.country_from.filter((c: any) => c !== item.value) : [];
      if (arr.length === 0) delete qf.country_from;
      else qf.country_from = arr;
      break;
    }
    case 'surfboard_type': {
      const arr = Array.isArray(qf.surfboard_type) ? qf.surfboard_type.filter((t: any) => t !== item.value) : [];
      if (arr.length === 0) delete qf.surfboard_type;
      else qf.surfboard_type = arr;
      break;
    }
    case 'age_range':
      delete qf.age_min;
      delete qf.age_max;
      break;
    case 'surf_level_category':
      delete qf.surf_level_category;
      break;
    case 'surf_level_range':
      delete qf.surf_level_min;
      delete qf.surf_level_max;
      break;
    case 'destination_days_min':
      delete qf.destination_days_min;
      break;
    case 'destination_country':
      next.destination_country = undefined;
      break;
    case 'area':
      next.area = null;
      break;
    default:
      break;
  }

  if (Object.keys(qf).length === 0) next.queryFilters = null;
  else next.queryFilters = qf;
  return next;
}
