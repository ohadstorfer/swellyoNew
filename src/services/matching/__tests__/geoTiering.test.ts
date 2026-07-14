import {
  geohashNeighbors,
  boundsContain,
  assignGeoTiers,
  GeocodedPlace,
  UserDestinationGeoRow,
} from '../geoTiering';

// Uluwatu ≈ (-8.8291, 115.0849) → bucket5 "qw60x", bucket4 "qw60"
const ULUWATU: GeocodedPlace = {
  lat: -8.8291,
  lng: 115.0849,
  geo_bucket_4: 'qw60',
  geo_bucket_5: 'qw60x',
  country: 'Indonesia',
  state: null,
  is_region: false,
  bounds: null,
};

describe('geohashNeighbors', () => {
  it('returns the 8 known neighbors of a mid-latitude cell', () => {
    // Reference values from the standard Veness geohash adjacency algorithm
    const n = geohashNeighbors('gbsuv');
    expect(n).toHaveLength(8);
    expect(new Set(n)).toEqual(
      new Set(['gbsvj', 'gbsvh', 'gbsuu', 'gbsvn', 'gbsuy', 'gbsuw', 'gbsut', 'gbsus'])
    );
  });

  it('crosses the antimeridian without throwing and stays 8 unique cells', () => {
    // 'xbp' east edge wraps to '8' side (lng +180 → -180)
    const n = geohashNeighbors('xbp');
    expect(n).toHaveLength(8);
    expect(new Set(n).size).toBe(8);
  });

  it('does not throw near the poles', () => {
    expect(() => geohashNeighbors('zzzzz')).not.toThrow();
    expect(geohashNeighbors('zzzzz')).toHaveLength(8);
  });

  it('returns 4-char neighbors for a 4-char hash', () => {
    for (const h of geohashNeighbors('qw60')) expect(h).toHaveLength(4);
  });
});

describe('boundsContain', () => {
  const bounds = { sw: { lat: 13.15, lng: -89.75 }, ne: { lat: 13.85, lng: -88.95 } };
  it('contains a point inside', () => {
    expect(boundsContain(bounds, 13.49, -89.38)).toBe(true); // Punta Roca
  });
  it('excludes a point outside', () => {
    expect(boundsContain(bounds, 13.19, -88.44)).toBe(false); // Las Flores (east)
  });
  it('handles antimeridian-spanning bounds (sw.lng > ne.lng)', () => {
    const fiji = { sw: { lat: -21, lng: 176 }, ne: { lat: -12, lng: -178 } };
    expect(boundsContain(fiji, -17.7, 177.1)).toBe(true);  // west of the line
    expect(boundsContain(fiji, -16.8, -179.3)).toBe(true); // east of the line
    expect(boundsContain(fiji, -17.7, 170.0)).toBe(false);
  });
});

describe('assignGeoTiers — point mode', () => {
  const rows: UserDestinationGeoRow[] = [
    // same bucket5 as Uluwatu → Tier 1
    { user_id: 'u1', lat: -8.83, lng: 115.09, geo_bucket_4: 'qw60', geo_bucket_5: 'qw60x' },
    // same bucket4, different bucket5 (Canggu ≈ -8.66, 115.13 → qw642 / qw64... actually
    // use a synthetic row: bucket4 matches, bucket5 far) → Tier 2
    { user_id: 'u2', lat: -8.65, lng: 115.13, geo_bucket_4: 'qw60', geo_bucket_5: 'qw60b' },
    // Mentawais — different bucket4 entirely → Tier 3 (absent from map)
    { user_id: 'u3', lat: -1.98, lng: 99.53, geo_bucket_4: 'mgkq', geo_bucket_5: 'mgkq3' },
    // null buckets (unbackfilled row) → ignored, u4 absent from map
    { user_id: 'u4', lat: null, lng: null, geo_bucket_4: null, geo_bucket_5: null },
  ];

  it('assigns tier 1 for same/neighbor bucket5, tier 2 for same/neighbor bucket4', () => {
    const tiers = assignGeoTiers(ULUWATU, rows);
    expect(tiers.get('u1')).toBe(1);
    expect(tiers.get('u2')).toBe(2);
    expect(tiers.has('u3')).toBe(false);
    expect(tiers.has('u4')).toBe(false);
  });

  it('promotes via neighbor bucket5 (edge-straddling)', () => {
    // a row whose bucket5 is a neighbor of qw60x, not equal
    const neighbor5 = geohashNeighbors('qw60x')[0];
    const tiers = assignGeoTiers(ULUWATU, [
      { user_id: 'u5', lat: -8.82, lng: 115.08, geo_bucket_4: 'qw60', geo_bucket_5: neighbor5 },
    ]);
    expect(tiers.get('u5')).toBe(1);
  });

  it('keeps the best tier across multiple destinations of one user', () => {
    const tiers = assignGeoTiers(ULUWATU, [
      { user_id: 'u6', lat: -1.98, lng: 99.53, geo_bucket_4: 'mgkq', geo_bucket_5: 'mgkq3' },
      { user_id: 'u6', lat: -8.83, lng: 115.09, geo_bucket_4: 'qw60', geo_bucket_5: 'qw60x' },
    ]);
    expect(tiers.get('u6')).toBe(1);
  });
});

describe('assignGeoTiers — region mode', () => {
  const LA_LIBERTAD_DEPT: GeocodedPlace = {
    lat: 13.6,
    lng: -89.3,
    geo_bucket_4: 'd41w',
    geo_bucket_5: 'd41wx',
    country: 'El Salvador',
    state: null,
    is_region: true,
    bounds: { sw: { lat: 13.15, lng: -89.75 }, ne: { lat: 13.85, lng: -88.95 } },
  };

  it('promotes destinations inside bounds to tier 2, never tier 1', () => {
    const tiers = assignGeoTiers(LA_LIBERTAD_DEPT, [
      { user_id: 'u1', lat: 13.49, lng: -89.38, geo_bucket_4: 'd41w', geo_bucket_5: 'd41wx' },
      { user_id: 'u2', lat: 13.19, lng: -88.44, geo_bucket_4: 'd41y', geo_bucket_5: 'd41y0' },
    ]);
    expect(tiers.get('u1')).toBe(2);
    expect(tiers.has('u2')).toBe(false);
  });

  it('region mode with null bounds promotes nobody', () => {
    const noBounds = { ...LA_LIBERTAD_DEPT, bounds: null };
    const tiers = assignGeoTiers(noBounds, [
      { user_id: 'u1', lat: 13.49, lng: -89.38, geo_bucket_4: 'd41w', geo_bucket_5: 'd41wx' },
    ]);
    expect(tiers.size).toBe(0);
  });

  it('region mode ignores rows with null lat/lng', () => {
    const tiers = assignGeoTiers(LA_LIBERTAD_DEPT, [
      { user_id: 'u1', lat: null, lng: null, geo_bucket_4: 'd41w', geo_bucket_5: 'd41wx' },
    ]);
    expect(tiers.size).toBe(0);
  });
});
