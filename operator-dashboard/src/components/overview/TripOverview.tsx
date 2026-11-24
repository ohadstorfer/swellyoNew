/**
 * The trip Overview, as a traveler sees it in the app — for the web.
 *
 * Port of the app's `src/components/trips/TripDetailViewRedesigned.tsx` (the
 * Overview body of `TripDetailScreen`), same sections in the same order, same
 * copy, Figma sizes from the app's own `get_variable_defs` notes. Read-only:
 * no edit pills (editing lives on its own page), no join / onboarding CTAs, no
 * chat, no share. The app's bottom bar price becomes the last section here.
 *
 * `TripOverview` takes a plain `TripOverviewData`, not a query, so the
 * create-trip wizard's preview can render it from form state.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Avatar, ErrorBox, Loading } from '../StateBits';
import { CiBadge, TripIcon, type TripIconName } from './icons';
import {
  BOARD_SHORT,
  DESTINATION_FAMILIARITY_LABEL,
  INCLUSION_TITLE,
  STAY_FAMILIARITY_LABEL,
  WAVE_SHAPE_LABEL,
  countdownTarget,
  dayHighlights,
  dayLabel,
  fetchTripOverview,
  formatAge,
  formatSkillLevel,
  formatSkillRange,
  formatTripDates,
  guestDays,
  orderedSurfStyles,
  priceInclusionAddOns,
  priceInclusionSections,
  priceLabel,
  titleCase,
  tripRangeLabel,
  vibeLabel,
  type ItineraryDay,
  type OverviewCrewMember,
  type TripOverviewData,
} from '../../services/tripOverview';
import '../../styles/overview.css';

export type { TripOverviewData } from '../../services/tripOverview';

const MAX_COVER_PHOTOS = 10;
/** Days listed before "View all". */
const PREVIEW_DAYS = 5;
/** "See More" shows only past this many characters, as in the app. */
const CLAMP_CHARS = 140;

const INCLUDE_ICON: Record<string, TripIconName> = {
  [INCLUSION_TITLE.meals]: 'meals',
  [INCLUSION_TITLE.accommodation]: 'bed',
  [INCLUSION_TITLE.transportation]: 'car',
  [INCLUSION_TITLE.surfSessions]: 'water',
  [INCLUSION_TITLE.surfEquipment]: 'construct',
  [INCLUSION_TITLE.surfFilm]: 'film',
  [INCLUSION_TITLE.videoAnalysis]: 'videocam',
  [INCLUSION_TITLE.activities]: 'compass',
  [INCLUSION_TITLE.wellness]: 'leaf',
  [INCLUSION_TITLE.custom]: 'sparkles',
};

const CI_URL = 'https://www.conservation.org/projects/surf-conservation';
const STOKE_URL = 'https://www.stokecertified.com/';

/** Tolerate a listing link typed without a scheme ("airbnb.com/..."). */
const withScheme = (raw: string) => (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);

// ─────────────────────────────────────────────────────────────────────────────
// The fetching wrapper
// ─────────────────────────────────────────────────────────────────────────────

export function TripOverviewTab({ tripId }: { tripId: string }) {
  const query = useQuery({
    queryKey: ['trip-overview', tripId],
    queryFn: () => fetchTripOverview(tripId),
    staleTime: 60_000,
  });

  if (query.isPending) return <Loading what="Loading the overview" />;
  if (query.isError)
    return <ErrorBox error={query.error} onRetry={() => query.refetch()} what="The overview" />;
  return <TripOverview data={query.data} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// The page
// ─────────────────────────────────────────────────────────────────────────────

export function TripOverview({
  data,
  heroCard = 'stats',
}: {
  data: TripOverviewData;
  /**
   * What the top card carries under the title. 'stats' is the app's Overview
   * (host + level / wave type / wave range). 'countdown' is what the app's
   * Dashboard and Plan tabs swap in.
   */
  heroCard?: 'stats' | 'countdown';
}) {
  const isOperator = data.hostingStyle === 'C';
  // "Planned together" trips have no one host selling the trip.
  const isPlannedTogether = data.hostingStyle === 'A';

  const covers = data.coverUrls.slice(0, MAX_COVER_PHOTOS);
  const dates = formatTripDates(data);
  const skillLabel = formatSkillLevel(data.skillLevels);
  const vibe = vibeLabel(data.vibeSlug);
  const waveShape = data.waveShape ? WAVE_SHAPE_LABEL[data.waveShape] ?? null : null;
  const waveSize =
    data.waveSizeMin != null && data.waveSizeMax != null
      ? data.waveSizeMin === data.waveSizeMax
        ? `${data.waveSizeMax} Feet`
        : `${data.waveSizeMin}–${data.waveSizeMax} Feet`
      : null;

  // ── Top card ──
  const heroHost = !isPlannedTogether && data.host?.name ? data.host : null;
  const heroStats: { icon: TripIconName; glyph: number; slot: number; label: string; value: string }[] = [];
  if (data.skillLevels.length > 0)
    heroStats.push({ icon: 'bar-chart-10', glyph: 16.7, slot: 20.7, label: 'Level', value: skillLabel });
  if (waveShape)
    heroStats.push({ icon: 'waves', glyph: 18.4, slot: 20.7, label: 'Wave type', value: waveShape });
  if (waveSize) heroStats.push({ icon: 'ruler', glyph: 15.7, slot: 18, label: 'Wave Range', value: waveSize });

  // ── The three cards under it ──
  const localCrew = data.crew.filter(c => c.isLocal).length;
  const infoCards: { icon: TripIconName; label: string; value: string; tint: string }[] = [
    {
      icon: 'users-02',
      label: 'Participants',
      value: data.maxParticipants
        ? `${data.participantCount}/${data.maxParticipants} going`
        : `${data.participantCount} going`,
      tint: 'var(--cyan)',
    },
  ];
  if (data.crew.length > 0)
    infoCards.push({
      icon: 'marker-pin-06',
      label: 'Local Crew',
      value: `${localCrew}/${data.crew.length}`,
      tint: 'var(--ov-orange)',
    });
  if (vibe) infoCards.push({ icon: 'sun-setting-03', label: 'Trip Vibe', value: vibe, tint: 'var(--ov-purple)' });

  const itineraryDays = guestDays(data.itinerary, data.startDate, data.endDate);
  const kindLabel = data.accommodationKind ? titleCase(data.accommodationKind) : null;
  const showAccommodation = !!data.accommodationName || !!kindLabel || data.specificStaySelected != null;
  const surfStyles = orderedSurfStyles(data.surfStyles);
  const includeSections = priceInclusionSections(data.priceInclusions);
  const addOns = priceInclusionAddOns(data.priceInclusions);
  const showWhoFor = data.ageMin != null || data.ageMax != null || data.skillLevels.length > 0;
  const price = priceLabel(data);

  return (
    <div className="ov-root">
      <div className="ov-head">
        <HeroCover urls={covers} />
        <div className="ov-hero-card">
          <div className="ov-hero-top">
            <CertBadges ci={data.ciSurfConservation} stoke={data.stokeCertified} />
            <p className="ov-hero-date">{dates}</p>
            <h2 className="ov-hero-title">{data.title || data.destinationLabel || 'Your trip'}</h2>
          </div>
          {heroCard === 'countdown' ? (
            <Countdown target={countdownTarget(data)} />
          ) : heroHost || heroStats.length > 0 ? (
            <div className="ov-hero-bottom">
              {heroHost ? (
                <div className="ov-hero-host">
                  <HostPhoto url={heroHost.avatarUrl} name={heroHost.name ?? ''} />
                  <span className="ov-hero-host-name">{`By ${heroHost.name?.split(' ')[0] ?? ''}`}</span>
                </div>
              ) : null}
              {heroStats.length > 0 ? (
                <ul className="ov-hero-stats">
                  {heroStats.map(st => (
                    <li key={st.label} className="ov-hero-stat">
                      <span className="ov-hero-stat-icon">
                        <span className="ov-hero-stat-glyph" style={{ width: st.slot }}>
                          <TripIcon name={st.icon} size={st.glyph} strokeWidth={1} />
                        </span>
                      </span>
                      <span className="ov-hero-stat-text">
                        <span className="ov-hero-stat-label">{st.label}</span>
                        <span className="ov-hero-stat-value">{st.value}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="ov-body">
        <ul className="ov-info-row">
          {infoCards.map(card => (
            <li key={card.label} className="ov-info-card">
              <span className="ov-icon-box">
                <TripIcon name={card.icon} size={18} strokeWidth={1.1} />
              </span>
              <span>
                <span className="ov-info-label" style={{ color: card.tint }}>
                  {card.label}
                </span>
                <span className="ov-info-value">{card.value}</span>
              </span>
            </li>
          ))}
        </ul>

        {data.description ? (
          <Section title="About this trip" line="below">
            <ClampedText text={data.description} className="ov-body-text" toggleClass="ov-see-more" />
          </Section>
        ) : null}

        {itineraryDays.length > 0 ? (
          <section className="ov-section ov-line-below">
            <Itinerary
              days={itineraryDays}
              start={data.startDate}
              end={data.endDate}
              fallbackPhoto={data.coverUrls[0] ?? null}
            />
          </section>
        ) : null}

        {!isPlannedTogether && data.host ? <AboutHost data={data} isOperator={isOperator} /> : null}

        {data.crew.length > 0 ? (
          <Section title="Crew" line="below">
            <CrewCards crew={data.crew} />
          </Section>
        ) : null}

        {showAccommodation ? (
          <section className="ov-section ov-section-stay">
            <SectionTitle title="Accommodation" />
            <Stay data={data} kindLabel={kindLabel} />
          </section>
        ) : null}

        {data.participants.length > 0 ? (
          <Section title="Members">
            <ul className="ov-members">
              {data.participants.map(p => (
                <li key={p.id} className="ov-member">
                  <Avatar url={p.avatarUrl} name={p.name ?? '?'} size={56} />
                  {p.name ? <span className="ov-member-name">{p.name.split(' ')[0]}</span> : null}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {isOperator && (includeSections.length > 0 || addOns.length > 0) ? (
          <Section title="What's included" line="above">
            <Included sections={includeSections} addOns={addOns} />
          </Section>
        ) : null}

        {surfStyles.length > 0 ? (
          <Section title="Surf style" line="above">
            <div className="ov-surf-card">
              <ul className="ov-surf-pills">
                {surfStyles.map(s => (
                  <li key={s} className="ov-surf-pill">
                    {BOARD_SHORT[s] ?? s}
                  </li>
                ))}
              </ul>
            </div>
          </Section>
        ) : null}

        {showWhoFor ? (
          <Section title="Who it's for" line="above" padBottom>
            <div className="ov-cell-row">
              <IconCell icon="calendar-date" label="Age range" value={formatAge(data.ageMin, data.ageMax)} />
              <IconCell icon="bar-chart-10" label="Surf level" value={formatSkillRange(data.skillLevels)} />
            </div>
          </Section>
        ) : null}

        {price ? (
          <section className="ov-section ov-line-above" aria-label="Price">
            <div className="ov-price">
              <div>
                <p className="ov-price-amount">{price.amount}</p>
                <p className="ov-price-per">{price.estimate ? 'per person · estimated' : 'per person'}</p>
              </div>
              <p className="ov-price-dates">{dates}</p>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pieces
// ─────────────────────────────────────────────────────────────────────────────

function SectionTitle({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="ov-section-title-row">
      <div className="ov-section-title-text">
        <h3 className="ov-section-title">{title}</h3>
        {sub ? <p className="ov-section-sub">{sub}</p> : null}
      </div>
      {right ?? null}
    </div>
  );
}

function Section({
  title,
  line,
  padBottom,
  children,
}: {
  title: string;
  /** The app's hairlines: under About, the host and Crew; above Surf style and after. */
  line?: 'above' | 'below';
  padBottom?: boolean;
  children: ReactNode;
}) {
  const cls = ['ov-section', line === 'above' && 'ov-line-above', line === 'below' && 'ov-line-below', padBottom && 'ov-pad-bottom']
    .filter(Boolean)
    .join(' ');
  return (
    <section className={cls}>
      <SectionTitle title={title} />
      {children}
    </section>
  );
}

/** Four lines, then "See More" when the text is long enough to need it. */
function ClampedText({ text, className, toggleClass }: { text: string; className: string; toggleClass: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > CLAMP_CHARS;
  return (
    <>
      <p className={`${className}${long && !open ? ' ov-clamp' : ''}`}>{text}</p>
      {long ? (
        <button type="button" className={`ov-link-btn ${toggleClass}`} onClick={() => setOpen(v => !v)} aria-expanded={open}>
          {open ? 'See less' : 'See More'}
        </button>
      ) : null}
    </>
  );
}

function IconCell({ icon, label, value }: { icon: TripIconName; label: string; value: string }) {
  return (
    <div className="ov-icon-cell">
      <span className="ov-icon-cell-box">
        <TripIcon name={icon} size={18} strokeWidth={1.1} />
      </span>
      <span className="ov-icon-cell-text">
        <span className="ov-icon-cell-label">{label}</span>
        <span className="ov-icon-cell-value">{value}</span>
      </span>
    </div>
  );
}

function HostPhoto({ url, name }: { url: string | null; name: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  return url && failed !== url ? (
    <img className="ov-hero-host-photo" src={url} alt="" loading="lazy" decoding="async" onError={() => setFailed(url)} />
  ) : (
    <span className="ov-hero-host-photo ov-hero-host-letter" aria-hidden>
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}

/**
 * A row of photos that swipes sideways (scroll-snap), with dots and an
 * "n / N" count when there are two or more. Shared by the cover and the stay.
 */
function useSnapIndex() {
  const ref = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const onScroll = () => {
    const el = ref.current;
    if (!el || el.clientWidth === 0) return;
    const next = Math.round(el.scrollLeft / el.clientWidth);
    setIndex(prev => (prev === next ? prev : next));
  };
  return { ref, index, onScroll };
}

function HeroCover({ urls }: { urls: string[] }) {
  const { ref, index, onScroll } = useSnapIndex();
  const many = urls.length > 1;
  if (urls.length === 0) {
    return (
      <div className="ov-hero ov-hero-empty">
        <TripIcon name="image" size={40} />
      </div>
    );
  }
  return (
    <div className="ov-hero">
      <div
        className="ov-snap"
        ref={ref}
        onScroll={onScroll}
        tabIndex={many ? 0 : -1}
        aria-label={many ? `Cover photos, ${index + 1} of ${urls.length}` : undefined}
      >
        {urls.map((u, i) => (
          <img key={`${u}-${i}`} className="ov-snap-img" src={u} alt="" loading={i === 0 ? 'eager' : 'lazy'} decoding="async" />
        ))}
      </div>
      <div className="ov-hero-shade" aria-hidden />
      {many ? (
        <>
          <div className="ov-hero-dots" aria-hidden>
            {urls.map((_, i) => (
              <span key={i} className={`ov-hero-dot${i === index ? ' is-on' : ''}`} />
            ))}
          </div>
          <span className="ov-hero-count" aria-hidden>{`${index + 1} / ${urls.length}`}</span>
        </>
      ) : null}
    </div>
  );
}

/**
 * CI / STOKE logos at the top of the card. The CI emblem is the app's own
 * vector. STOKE is a PNG in the app, which this project does not carry, so it
 * reads as a small wordmark pill instead.
 */
function CertBadges({ ci, stoke }: { ci: boolean; stoke: boolean }) {
  if (!ci && !stoke) return null;
  const label = [ci ? 'CI Surf Conservation' : null, stoke ? 'STOKE Certified' : null].filter(Boolean).join(', ');
  return (
    <div className="ov-certs" role="img" aria-label={label}>
      {ci ? <CiBadge /> : null}
      {stoke ? <span className="ov-stoke-mark">STOKE</span> : null}
    </div>
  );
}

const MS_MIN = 60_000;
const MS_HOUR = 3_600_000;
const MS_DAY = 86_400_000;
const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));
const addMonths = (base: Date, n: number) => {
  const d = new Date(base.getTime());
  d.setMonth(d.getMonth() + n);
  return d;
};

/** The app's CountdownBoxes: Months-led a month or more out, Seconds-led under it. */
function Countdown({ target }: { target: Date | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!target) return null;

  const t = target.getTime();
  let blocks: { value: string; label: string }[];
  if (t >= addMonths(new Date(now), 1).getTime()) {
    const nowDate = new Date(now);
    let months = 0;
    while (addMonths(nowDate, months + 1).getTime() <= t) months++;
    let rem = Math.max(0, t - addMonths(nowDate, months).getTime());
    const days = Math.floor(rem / MS_DAY);
    rem -= days * MS_DAY;
    const hours = Math.floor(rem / MS_HOUR);
    rem -= hours * MS_HOUR;
    const minutes = Math.floor(rem / MS_MIN);
    blocks = [
      { value: String(months), label: months === 1 ? 'Month' : 'Months' },
      { value: String(days), label: days === 1 ? 'Day' : 'Days' },
      { value: pad2(hours), label: 'Hours' },
      { value: pad2(minutes), label: 'Minutes' },
    ];
  } else {
    const total = Math.floor(Math.max(0, t - now) / 1000);
    const days = Math.floor(total / 86400);
    blocks = [
      { value: String(days), label: days === 1 ? 'Day' : 'Days' },
      { value: pad2(Math.floor((total % 86400) / 3600)), label: 'Hours' },
      { value: pad2(Math.floor((total % 3600) / 60)), label: 'Minutes' },
      { value: pad2(total % 60), label: 'Seconds' },
    ];
  }
  return (
    <div className="ov-countdown" role="timer" aria-label="Time until the trip starts">
      {blocks.map(b => (
        <div key={b.label} className="ov-countdown-box">
          <span className="ov-countdown-value">{b.value}</span>
          <span className="ov-countdown-label">{b.label}</span>
        </div>
      ))}
    </div>
  );
}

function AboutHost({ data, isOperator }: { data: TripOverviewData; isOperator: boolean }) {
  const host = data.host!;
  // The host's own crew card, if they put themselves on the crew: its title
  // is how the Figma names them ("Oscar - Local Guide").
  const hostTitle = data.crew.find(c => c.roleKey === 'operator' && c.title?.trim())?.title?.trim() ?? null;

  // One wrapping flow, Figma's order: trips, board, level, origin, age.
  const badges: { label: string; emoji?: string }[] = [];
  if (host.surfTrips != null) badges.push({ label: `${host.surfTrips} Surf Trips`, emoji: '🏝️' });
  if (host.surfboardType) badges.push({ label: BOARD_SHORT[host.surfboardType] ?? titleCase(host.surfboardType) });
  if (host.surfLevel) badges.push({ label: titleCase(host.surfLevel) });
  if (host.countryFrom) badges.push({ label: host.countryFrom });
  if (host.age != null) badges.push({ label: `${host.age} yrs` });

  const familiarity: { icon: TripIconName; place: string; label: string }[] = [];
  const destFam = data.hostDestinationFamiliarity ? DESTINATION_FAMILIARITY_LABEL[data.hostDestinationFamiliarity] : null;
  const stayFam = data.hostStayFamiliarity ? STAY_FAMILIARITY_LABEL[data.hostStayFamiliarity] : null;
  if (destFam && data.destinationLabel) familiarity.push({ icon: 'marker-pin-05', place: data.destinationLabel, label: destFam });
  if (stayFam && data.accommodationName) familiarity.push({ icon: 'home-03', place: data.accommodationName, label: stayFam });

  // The app shows the empty-bio hint only to the host, as a way in to editing.
  // This page edits elsewhere, so an empty card is simply not drawn.
  if (!data.hostBio && badges.length === 0 && familiarity.length === 0) return null;

  return (
    <section className="ov-section ov-line-below">
      <div className="ov-about-host-head">
        <Avatar url={host.avatarUrl} name={host.name ?? '?'} size={53} />
        <h3 className="ov-section-title ov-about-host-name">
          {host.name
            ? hostTitle
              ? `${host.name} - ${hostTitle}`
              : host.name
            : isOperator
              ? 'About the operator'
              : 'About the Captain'}
        </h3>
      </div>
      {badges.length > 0 ? (
        <ul className="ov-host-badges">
          {badges.map((b, i) => (
            <li key={`${b.label}-${i}`} className="ov-host-badge">
              {b.emoji ? <span className="ov-emoji" aria-hidden>{b.emoji}</span> : null}
              {b.label}
            </li>
          ))}
        </ul>
      ) : null}
      {data.hostBio ? <HostBio text={data.hostBio} familiarity={familiarity} /> : <Familiarity rows={familiarity} />}
    </section>
  );
}

/** Bio above the local-knowledge rows; its "See More" sits last, under them. */
function HostBio({ text, familiarity }: { text: string; familiarity: { icon: TripIconName; place: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const long = text.length > CLAMP_CHARS;
  return (
    <>
      <p className={`ov-host-bio${long && !open ? ' ov-clamp' : ''}`}>{text}</p>
      <Familiarity rows={familiarity} />
      {long ? (
        <button type="button" className="ov-link-btn ov-host-see-more" onClick={() => setOpen(v => !v)} aria-expanded={open}>
          {open ? 'See less' : 'See More'}
        </button>
      ) : null}
    </>
  );
}

function Familiarity({ rows }: { rows: { icon: TripIconName; place: string; label: string }[] }) {
  if (rows.length === 0) return null;
  return (
    <ul className="ov-familiarity">
      {rows.map((f, i) => (
        <li key={i} className="ov-fam-row">
          <span className="ov-fam-icon">
            {/* ~16 viewBox drawn at 18: 16/18 gives back Figma's 1px hairline. */}
            <TripIcon name={f.icon} size={18} strokeWidth={16 / 18} />
          </span>
          <span className="ov-fam-text">
            <strong>{f.place}</strong>
            {`  ${f.label}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The crew as a row of cards; the operator's card wears the accent border. */
function CrewCards({ crew }: { crew: OverviewCrewMember[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const active = crew.find(c => c.id === open) ?? null;
  return (
    <>
      <ul className="ov-crew">
        {crew.map(c => (
          <li key={c.id}>
            <button
              type="button"
              className={`ov-crew-card${c.roleKey === 'operator' ? ' is-lead' : ''}${open === c.id ? ' is-open' : ''}`}
              onClick={() => setOpen(v => (v === c.id ? null : c.id))}
              aria-expanded={open === c.id}
              aria-label={`About ${c.name}`}
            >
              <Avatar url={c.avatarUrl} name={c.name} size={56} />
              <span className="ov-crew-name">{c.name}</span>
              {c.title ? <span className="ov-crew-meta">{c.title}</span> : null}
              {c.countryFrom ? <span className="ov-crew-meta">{c.countryFrom}</span> : null}
            </button>
          </li>
        ))}
      </ul>
      {/* The app opens a sheet with the whole bio; here it unfolds under the row. */}
      {active ? (
        <div className="ov-crew-detail ov-enter" key={active.id}>
          <p className="ov-crew-detail-name">{active.name}</p>
          {active.title ? <p className="ov-crew-detail-role">{active.title}</p> : null}
          {active.bio ? <p className="ov-crew-detail-bio">{active.bio}</p> : null}
        </div>
      ) : null}
    </>
  );
}

function Stay({ data, kindLabel }: { data: TripOverviewData; kindLabel: string | null }) {
  const url = data.accommodationUrl?.trim() || null;

  if (!(data.specificStaySelected && data.accommodationName)) {
    // No specific stay yet: the same card, reading "Not set yet".
    return (
      <div className="ov-stay-card">
        <div className="ov-stay-image ov-stay-empty">
          <TripIcon name="home-03" size={30} />
          <span>Not set yet</span>
        </div>
        {kindLabel ? (
          <div className="ov-stay-pill">
            <span className="ov-stay-pill-icon">
              <TripIcon name="home-03" size={18} />
            </span>
            <span className="ov-stay-pill-text">
              <span className="ov-stay-name">{kindLabel}</span>
              <span className="ov-stay-meta">Leading option</span>
            </span>
          </div>
        ) : null}
      </div>
    );
  }

  const photos = [data.accommodationImageUrl, ...data.accommodationGalleryUrls].filter(
    (u): u is string => !!u,
  );
  const pill = (
    <>
      {data.accommodationLogoUrl ? (
        <img className="ov-stay-logo" src={data.accommodationLogoUrl} alt="" loading="lazy" />
      ) : (
        <span className="ov-stay-pill-icon">
          <TripIcon name="home-03" size={18} />
        </span>
      )}
      <span className="ov-stay-pill-text">
        <span className="ov-stay-name">{data.accommodationName}</span>
        {data.accommodationVerified ? (
          <span className="ov-stay-meta ov-stay-verified">Verified Swellyo Stay</span>
        ) : (
          <span className="ov-stay-meta">{kindLabel ? `${kindLabel} · Leading option` : 'Leading option'}</span>
        )}
      </span>
      {url ? (
        <span className="ov-stay-link-icon" aria-hidden>
          <TripIcon name="chevron-right" size={18} strokeWidth={1.5} />
        </span>
      ) : null}
    </>
  );

  return (
    <div className="ov-stay-card">
      {photos.length > 0 ? (
        <StayGallery urls={photos} />
      ) : (
        <div className="ov-stay-image ov-stay-empty">
          <TripIcon name="image" size={32} />
        </div>
      )}
      {url ? (
        <a className="ov-stay-pill ov-stay-pill-link" href={withScheme(url)} target="_blank" rel="noopener noreferrer" aria-label={`Open ${data.accommodationName}`}>
          {pill}
        </a>
      ) : (
        <div className="ov-stay-pill">{pill}</div>
      )}
      {data.ciSurfConservation ? (
        <CertRow
          url={CI_URL}
          title={'Conservation International\nSurf Protected Ecosystem'}
          logo={<CiBadge height={33} />}
        />
      ) : null}
      {data.stokeCertified ? (
        <CertRow url={STOKE_URL} title="Sustainable STOKE Certified Provider" logo={<span className="ov-stoke-mark ov-stoke-mark-sm">SC</span>} />
      ) : null}
    </div>
  );
}

function StayGallery({ urls }: { urls: string[] }) {
  const { ref, index, onScroll } = useSnapIndex();
  if (urls.length === 1) {
    return <img className="ov-stay-image" src={urls[0]} alt="" loading="lazy" decoding="async" />;
  }
  return (
    <div className="ov-stay-gallery">
      <div className="ov-stay-image ov-stay-clip">
        <div className="ov-snap" ref={ref} onScroll={onScroll} tabIndex={0} aria-label={`Stay photos, ${index + 1} of ${urls.length}`}>
          {urls.map((u, i) => (
            <img key={`${u}-${i}`} className="ov-snap-img" src={u} alt="" loading="lazy" decoding="async" />
          ))}
        </div>
        <span className="ov-stay-count" aria-hidden>{`${index + 1} / ${urls.length}`}</span>
      </div>
      <div className="ov-stay-dots" aria-hidden>
        {urls.map((_, i) => (
          <span key={i} className={`ov-stay-dot${i === index ? ' is-on' : ''}`} />
        ))}
      </div>
    </div>
  );
}

function CertRow({ url, title, logo }: { url: string; title: string; logo: ReactNode }) {
  return (
    <a className="ov-cert-row" href={url} target="_blank" rel="noopener noreferrer" aria-label={`${title.replace('\n', ' ')}, Learn More`}>
      <span className="ov-cert-logo">{logo}</span>
      <span className="ov-cert-text">
        <span className="ov-cert-title">{title}</span>
        <span className="ov-cert-link">Learn More</span>
      </span>
    </a>
  );
}

/**
 * Five rows, then "See everything included" — which in the app opens a sheet
 * with every row and the add-ons. Here it unfolds in place.
 */
function Included({ sections, addOns }: { sections: { title: string; items: string[]; asTags: boolean }[]; addOns: string[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? sections : sections.slice(0, 5);
  return (
    <>
      {shown.length > 0 ? (
        <ul className="ov-incl-list">
          {shown.map(sec => (
            <li key={sec.title} className="ov-incl-row">
              <span className="ov-incl-icon">
                <TripIcon name={INCLUDE_ICON[sec.title] ?? 'check'} size={18} />
              </span>
              <span className="ov-incl-text">
                <span className="ov-incl-title">{sec.title}</span>
                {all && !sec.asTags ? (
                  sec.items.map((it, j) => (
                    <span key={j} className="ov-incl-item">
                      {it}
                    </span>
                  ))
                ) : (
                  <span className={`ov-incl-item${all ? '' : ' ov-clamp-2'}`}>{sec.items.join(', ')}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {all && addOns.length > 0 ? (
        <div className="ov-addons ov-enter">
          <p className="ov-addons-title">Add-ons for extra price</p>
          <p className="ov-addons-hint">Available on the trip for an extra cost.</p>
          <ul className="ov-addon-tags">
            {addOns.map(a => (
              <li key={a} className="ov-addon-tag">
                {a}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {sections.length > 5 || addOns.length > 0 ? (
        <button type="button" className="ov-link-btn ov-see-more" onClick={() => setAll(v => !v)} aria-expanded={all}>
          {all ? 'See less' : 'See everything included'}
        </button>
      ) : null}
    </>
  );
}

function Itinerary({
  days,
  start,
  end,
  fallbackPhoto,
}: {
  days: ItineraryDay[];
  start: string | null;
  end: string | null;
  fallbackPhoto: string | null;
}) {
  const [openDay, setOpenDay] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? days : days.slice(0, PREVIEW_DAYS);
  const range = tripRangeLabel(start, end);
  return (
    <>
      <SectionTitle
        title="Trip itinerary"
        sub={range || undefined}
        right={
          days.length > PREVIEW_DAYS ? (
            <button type="button" className="ov-link-btn ov-view-all" onClick={() => setShowAll(v => !v)}>
              {showAll ? 'Show less' : 'View all'}
            </button>
          ) : undefined
        }
      />
      <ul className="ov-itin">
        {shown.map(day => (
          <DayCard
            key={day.day}
            day={day}
            label={dayLabel(start, day.day)}
            photos={day.photos.length > 0 ? day.photos : fallbackPhoto ? [fallbackPhoto] : []}
            open={openDay === day.day}
            onToggle={() => setOpenDay(v => (v === day.day ? null : day.day))}
          />
        ))}
      </ul>
    </>
  );
}

function DayCard({
  day,
  label,
  photos,
  open,
  onToggle,
}: {
  day: ItineraryDay;
  label: string;
  photos: string[];
  open: boolean;
  onToggle: () => void;
}) {
  const highlights = dayHighlights(day);
  const { ref, index, onScroll } = useSnapIndex();
  return (
    <li className={`ov-day${open ? ' is-open' : ''}`}>
      {open && photos.length > 0 ? (
        <div className="ov-day-photo ov-enter">
          <div className="ov-snap" ref={ref} onScroll={onScroll} tabIndex={photos.length > 1 ? 0 : -1}>
            {photos.map((u, i) => (
              <img key={`${u}-${i}`} className="ov-snap-img" src={u} alt="" loading="lazy" decoding="async" />
            ))}
          </div>
          {photos.length > 1 ? (
            <div className="ov-day-dots" aria-hidden>
              {photos.map((_, i) => (
                <span key={i} className={`ov-day-dot${i === index ? ' is-on' : ''}`} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <button type="button" className="ov-day-head" onClick={onToggle} aria-expanded={open} aria-label={`${label}, ${day.title}`}>
        {!open && photos[0] ? <img className="ov-day-thumb" src={photos[0]} alt="" loading="lazy" decoding="async" /> : null}
        <span className="ov-day-text">
          <span className="ov-day-label">{label}</span>
          <span className="ov-day-title">{day.title}</span>
          {highlights ? <span className="ov-day-highlights">{highlights}</span> : null}
        </span>
        <span className="ov-day-chevron" aria-hidden>
          <TripIcon name="chevron-right" size={24} strokeWidth={1.5} />
        </span>
      </button>
      {open && day.activities.length > 0 ? (
        <ul className="ov-day-lines ov-enter">
          {day.activities.map((a, i) => (
            <li key={i}>
              <span className="ov-day-line-head">{a.time ? `${a.time} - ${a.name}` : a.name}</span>
              {a.place ? <span className={`ov-day-line-place${a.time ? ' is-indented' : ''}`}>{a.place}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
