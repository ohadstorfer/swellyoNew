import { useState } from 'react';
import {
  ACCOMMODATION_LABEL,
  ACTIVITIES_OPTIONS,
  BOARD_TYPE_OPTIONS,
  CATEGORY_ORDER,
  CATEGORY_TITLE,
  CURRENCY_SYMBOL,
  JOIN_MODE_OPTIONS,
  MAX_DAY_PHOTOS,
  MAX_DAY_TITLE_LENGTH,
  MAX_SPOTS,
  MIN_SPOTS,
  OPERATOR_CURRENCIES,
  SKILL_LEVEL_OPTIONS,
  STAY_GALLERY_MAX,
  SURF_FILM_MEDIA_OPTIONS,
  SURF_FILM_TYPE_OPTIONS,
  TAG_CATEGORIES,
  TRIP_STRUCTURE_OPTIONS,
  TRIP_VIBE_OPTIONS,
  WAVE_SHAPE_OPTIONS,
  WAVE_SIZE_MAX,
  WAVE_SIZE_MIN,
  WELLNESS_OPTIONS,
  dayLabel,
  emptyDay,
  hasCategoryValue,
  intOrNull,
  isDayPlanned,
  normalizePriceInclusions,
  toggleStructure,
  tripCalendarDays,
  upsertDay,
  waveSizeLabel,
  type AccommodationKind,
  type AudienceCardKey,
  type FieldErrors,
  type ItineraryDay,
  type OperatorCurrency,
  type PriceInclusions,
  type WizardState,
} from '../../domain/createTrip';
import { REQUIREMENT_CATALOG, LOCKED_ON_KINDS, LOCKED_ON_SUB, type EditableKind } from '../../domain/catalog';
import { isDeadlineAtEnd, stepDeadline } from '../../domain/requirements';
import type { CancellationPolicy } from '../../domain/cancellation';
import { PolicyFields } from '../PolicyFields';
import { formatRange, plural } from '../../lib/format';
import type { DefaultWaiver } from '../../services/settings';
import type { ConnectState } from '../../domain/connect';
import { Chip, Choice, DestinationSearch, Field, PhotoDrop, PhotoTile, Section, Stepper } from './fields';

export interface StepProps {
  s: WizardState;
  set: (fn: (s: WizardState) => WizardState) => void;
  errors: FieldErrors;
  /** Display URL for an image ref (remote URL or local object URL). */
  src: (ref: string) => string;
  /** Registers picked files; returns their refs. */
  addFiles: (files: File[]) => string[];
}

const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter(x => x !== v) : [...list, v]);

// ── 1. Audience ────────────────────────────────────────────────────────────

export function AudienceStep({ s, set, errors }: StepProps) {
  const done = (k: AudienceCardKey) => (st: WizardState) =>
    st.audienceDone.includes(k) ? st : { ...st, audienceDone: [...st.audienceDone, k] };
  const touch = (k: AudienceCardKey, fn: (st: WizardState) => WizardState) => set(st => done(k)(fn(st)));
  const confirmBtn = (k: AudienceCardKey) =>
    s.audienceDone.includes(k) ? (
      <span className="tag tag-ok">Set</span>
    ) : (
      <button type="button" className="btn btn-sm" onClick={() => set(done(k))}>
        Looks right
      </button>
    );

  return (
    <>
      {errors.audience && <p className="ct-error" role="alert">{errors.audience}</p>}
      <Section
        title="Surf Level of Members"
        body="Select the skill level range of surfers who would align with your trip."
        right={confirmBtn('levels')}
        error={errors.skill}
      >
        <div className="ct-chips">
          {SKILL_LEVEL_OPTIONS.map(o => (
            <Chip
              key={o.key}
              on={s.skillLevels.includes(o.key)}
              onClick={() => touch('levels', st => ({ ...st, skillLevels: toggle(st.skillLevels, o.key) }))}
            >
              {o.label}
            </Chip>
          ))}
        </div>
      </Section>

      <Section
        title="Board Style"
        body="Let your customers know what kind of surfer this trip is for by selecting the types of boards this trip is for. You can select multiple types of boards if desired."
        right={confirmBtn('boards')}
      >
        <div className="ct-chips">
          {BOARD_TYPE_OPTIONS.map(o => (
            <Chip
              key={o.key}
              on={s.surfStyles.includes(o.key)}
              onClick={() => touch('boards', st => ({ ...st, surfStyles: toggle(st.surfStyles, o.key) }))}
            >
              {o.label}
            </Chip>
          ))}
        </div>
      </Section>

      <Section
        title="The Wave"
        body="Tell your guests what kind of waves they should expect to be riding. Always good to seek growth in our surfing journey but it sucks to be out of your depth after dropping dough."
        right={confirmBtn('wave')}
        error={errors.waveShape}
      >
        <span className="ct-label">Shape</span>
        <div className="ct-chips">
          {WAVE_SHAPE_OPTIONS.map(o => (
            <Chip key={o.key} on={s.waveShape === o.key} onClick={() => touch('wave', st => ({ ...st, waveShape: o.key }))}>
              {o.label}
            </Chip>
          ))}
        </div>
        <div className="ct-grid2" style={{ marginTop: 16 }}>
          <Field label="Smallest wave">
            <select
              value={s.waveSizeMin}
              onChange={e => {
                const min = Number(e.target.value);
                touch('wave', st => ({ ...st, waveSizeMin: min, waveSizeMax: Math.max(min, st.waveSizeMax) }));
              }}
            >
              {sizes().map(n => (
                <option key={n} value={n}>{waveSizeLabel(n)}</option>
              ))}
            </select>
          </Field>
          <Field label="Biggest wave">
            <select
              value={s.waveSizeMax}
              onChange={e => {
                const max = Number(e.target.value);
                touch('wave', st => ({ ...st, waveSizeMax: max, waveSizeMin: Math.min(max, st.waveSizeMin) }));
              }}
            >
              {sizes().map(n => (
                <option key={n} value={n}>{waveSizeLabel(n)}</option>
              ))}
            </select>
          </Field>
        </div>
      </Section>

      <Section
        title="Age range (optional)"
        body="Age ranges on trips can matter to some, but not to all. If you want to place an age range you can, good to know my crew are all into the same vibe ya know!?"
        error={errors.age}
      >
        <div className="ct-grid2">
          <Field label="Youngest">
            <input
              type="number"
              inputMode="numeric"
              min={16}
              max={99}
              placeholder="Any"
              value={s.ageMin}
              onChange={e => touch('age', st => ({ ...st, ageMin: e.target.value.replace(/\D/g, '').slice(0, 2) }))}
            />
          </Field>
          <Field label="Oldest">
            <input
              type="number"
              inputMode="numeric"
              min={16}
              max={99}
              placeholder="Any"
              value={s.ageMax}
              onChange={e => touch('age', st => ({ ...st, ageMax: e.target.value.replace(/\D/g, '').slice(0, 2) }))}
            />
          </Field>
        </div>
      </Section>
    </>
  );
}

const sizes = () => Array.from({ length: WAVE_SIZE_MAX - WAVE_SIZE_MIN + 1 }, (_, i) => i + WAVE_SIZE_MIN);

// ── 2. Basics ──────────────────────────────────────────────────────────────

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function BasicsStep({ s, set, errors, src, addFiles }: StepProps) {
  const spots = s.maxParticipants ? parseInt(s.maxParticipants, 10) : 0;
  return (
    <>
      <Section title="Where" error={errors.destination}>
        <DestinationSearch
          value={s.destination}
          geo={s.destinationGeo}
          onSelect={sel => set(st => ({ ...st, destination: sel.name || sel.short, destinationGeo: sel }))}
          error={errors.destination}
        />
      </Section>

      <Section title="When" body="Operator trips run on exact dates." error={errors.when}>
        <div className="ct-grid2">
          <Field label="Start">
            <input
              type="date"
              min={todayISO()}
              value={s.startDateISO ?? ''}
              onChange={e => set(st => ({ ...st, startDateISO: e.target.value || null }))}
            />
          </Field>
          <Field label="End">
            <input
              type="date"
              min={s.startDateISO ?? todayISO()}
              value={s.endDateISO ?? ''}
              onChange={e => set(st => ({ ...st, endDateISO: e.target.value || null }))}
            />
          </Field>
        </div>
        {s.startDateISO && s.endDateISO && s.endDateISO >= s.startDateISO && (
          <p className="ct-hint">{tripCalendarDays(s.startDateISO, s.endDateISO)} days</p>
        )}
      </Section>

      <Section title="The trip">
        <Field label="Trip name" error={errors.title}>
          <input type="text" value={s.title} maxLength={80} onChange={e => set(st => ({ ...st, title: e.target.value }))} />
        </Field>
        <Field label="Description" error={errors.description}>
          <textarea
            rows={5}
            value={s.description}
            placeholder="What will the days look like? Who is it for?"
            onChange={e => set(st => ({ ...st, description: e.target.value }))}
          />
        </Field>
        <div className="ct-field">
          <span className="ct-label">Max participants</span>
          <Stepper
            label="max participants"
            value={s.maxParticipants || 'Any'}
            decDisabled={!s.maxParticipants}
            incDisabled={spots >= MAX_SPOTS}
            onDec={() => set(st => ({ ...st, maxParticipants: spots <= MIN_SPOTS ? '' : String(spots - 1) }))}
            onInc={() => set(st => ({ ...st, maxParticipants: String(spots < MIN_SPOTS ? MIN_SPOTS : Math.min(spots + 1, MAX_SPOTS)) }))}
          />
        </div>
      </Section>

      <Section title="Cover photo" error={errors.heroImage}>
        {s.heroImage ? (
          <PhotoTile hero src={src(s.heroImage)} alt="cover photo" onRemove={() => set(st => ({ ...st, heroImage: null }))} />
        ) : (
          <PhotoDrop hero label="Add a cover photo" onPick={files => {
            const [ref] = addFiles(files.slice(0, 1));
            set(st => ({ ...st, heroImage: ref }));
          }} />
        )}
      </Section>
    </>
  );
}

// ── 3. Vibez ───────────────────────────────────────────────────────────────

export function VibezStep({ s, set, errors, src, addFiles }: StepProps) {
  const galleryLeft = STAY_GALLERY_MAX - s.accommodationGallery.length;
  return (
    <>
      <Section title="How it runs" body="Pick everything that fits.">
        <div className="ct-chips">
          {TRIP_STRUCTURE_OPTIONS.map(o => (
            <Chip
              key={o.slug}
              on={s.tripStructure.includes(o.slug)}
              onClick={() => set(st => ({ ...st, tripStructure: toggleStructure(st.tripStructure, o.slug) }))}
            >
              {o.label}
            </Chip>
          ))}
        </div>
      </Section>

      <Section title="The vibe">
        <div className="ct-choices">
          {TRIP_VIBE_OPTIONS.map(o => (
            <Choice
              key={o.slug}
              on={s.tripVibes.includes(o.slug)}
              title={o.label}
              desc={`Surf ${'●'.repeat(o.intensity)}${'○'.repeat(4 - o.intensity)}`}
              onClick={() => set(st => ({ ...st, tripVibes: st.tripVibes.includes(o.slug) ? [] : [o.slug] }))}
            />
          ))}
        </div>
      </Section>

      <Section title="The stay" body="Where your guests sleep. Name, link and a photo." error={errors.specificStay}>
        <Field label="Accommodation type" error={errors.accommodationKind}>
          <select
            value={s.accommodationKind ?? ''}
            onChange={e => set(st => ({ ...st, accommodationKind: (e.target.value || null) as AccommodationKind | null }))}
          >
            <option value="">Pick one</option>
            {(Object.keys(ACCOMMODATION_LABEL) as AccommodationKind[]).map(k => (
              <option key={k} value={k}>{ACCOMMODATION_LABEL[k]}</option>
            ))}
          </select>
        </Field>
        <Field label="Name of the stay">
          <input type="text" value={s.accommodationName} onChange={e => set(st => ({ ...st, accommodationName: e.target.value }))} />
        </Field>
        <Field label="Link">
          <input type="url" placeholder="https://" value={s.accommodationUrl} onChange={e => set(st => ({ ...st, accommodationUrl: e.target.value }))} />
        </Field>
        <div className="ct-field">
          <span className="ct-label">Photos</span>
          <div className="ct-photos">
            {s.accommodationImage ? (
              <PhotoTile
                src={src(s.accommodationImage)}
                alt="main stay photo"
                onRemove={() =>
                  set(st => ({
                    ...st,
                    accommodationImage: st.accommodationGallery[0] ?? null,
                    accommodationGallery: st.accommodationGallery.slice(1),
                  }))
                }
              />
            ) : (
              <PhotoDrop label="Main photo" onPick={files => {
                const [ref] = addFiles(files.slice(0, 1));
                set(st => ({ ...st, accommodationImage: ref }));
              }} />
            )}
            {s.accommodationGallery.map((ref, i) => (
              <PhotoTile
                key={ref}
                src={src(ref)}
                alt={`stay photo ${i + 2}`}
                onRemove={() => set(st => ({ ...st, accommodationGallery: st.accommodationGallery.filter(r => r !== ref) }))}
              />
            ))}
            {s.accommodationImage && galleryLeft > 0 && (
              <PhotoDrop multiple label={`More (${galleryLeft} left)`} onPick={files => {
                const refs = addFiles(files.slice(0, galleryLeft));
                set(st => ({ ...st, accommodationGallery: [...st.accommodationGallery, ...refs].slice(0, STAY_GALLERY_MAX) }));
              }} />
            )}
          </div>
        </div>
      </Section>

      <Section title="Certifications">
        <label className="ct-toggle">
          <span>
            <strong>Do you have a STOKE Certification?</strong>
          </span>
          <input type="checkbox" checked={s.stokeCertified} onChange={e => set(st => ({ ...st, stokeCertified: e.target.checked }))} />
        </label>
        <label className="ct-toggle">
          <span>
            <strong>Do they participate with CI Surf Conservation?</strong>
          </span>
          <input type="checkbox" checked={s.ciSurfConservation} onChange={e => set(st => ({ ...st, ciSurfConservation: e.target.checked }))} />
        </label>
      </Section>
    </>
  );
}

// ── 4. Budget (pricing, inclusions, payments, refunds) ─────────────────────

export interface BudgetExtra {
  currency: OperatorCurrency;
  setCurrency: (c: OperatorCurrency) => void;
  connectState: ConnectState | null;
  connectLoading: boolean;
  policy: CancellationPolicy;
}

function MoneyInput({
  currency,
  value,
  onChange,
  placeholder,
}: {
  currency: OperatorCurrency;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="ct-money">
      <span className="ct-prefix">{CURRENCY_SYMBOL[currency]}</span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value.replace(/\D/g, ''))}
      />
    </div>
  );
}

export function BudgetStep({ s, set, errors, extra }: StepProps & { extra: BudgetExtra }) {
  const { currency } = extra;
  const balance = s.requirementTiming.balance ?? { skippable: true, daysBefore: 30 };
  const setBalanceDays = (daysBefore: number) =>
    set(st => ({ ...st, requirementTiming: { ...st.requirementTiming, balance: { ...balance, daysBefore } } }));

  return (
    <>
      <Section title="Price per person" error={errors.price}>
        <div className="ct-grid2">
          <Field label="Currency" hint="Stored in USD at today’s rate, like the app.">
            <select value={currency} onChange={e => extra.setCurrency(e.target.value as OperatorCurrency)}>
              {OPERATOR_CURRENCIES.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Shared room price">
            <MoneyInput currency={currency} value={s.costPerPerson} onChange={v => set(st => ({ ...st, costPerPerson: v }))} />
          </Field>
        </div>
        <Field
          label="Private room price (optional)"
          hint="Leave blank if travelers do not get a room choice."
          error={errors.privatePrice}
        >
          <MoneyInput
            currency={currency}
            placeholder="No private rooms"
            value={s.privateRoomPrice}
            onChange={v => set(st => ({ ...st, privateRoomPrice: v }))}
          />
        </Field>
      </Section>

      <Section title="How travelers join">
        <div className="ct-choices">
          {JOIN_MODE_OPTIONS.map(o => (
            <Choice key={o.key} on={s.joinMode === o.key} title={o.title} desc={o.desc} onClick={() => set(st => ({ ...st, joinMode: o.key }))} />
          ))}
        </div>
      </Section>

      <Section title="What’s included" body="Pick what the price covers. Leave a category empty if it does not apply.">
        <Inclusions value={s.priceInclusions} onChange={inc => set(st => ({ ...st, priceInclusions: inc }))} />
      </Section>

      <Section title="Getting paid" error={errors.deposit}>
        <div className="ct-choices">
          <Choice
            on={s.paymentMode === 'offline'}
            title="Outside the app"
            desc="You collect the money yourself. Travelers see the price and when it is due."
            onClick={() => set(st => ({ ...st, paymentMode: 'offline' }))}
          />
          <Choice
            on={s.paymentMode === 'managed'}
            title="In the app"
            desc="Travelers pay by card through Swellyo; money goes to your Stripe account."
            onClick={() => set(st => ({ ...st, paymentMode: 'managed' }))}
          />
        </div>
        {s.paymentMode === 'managed' && (
          <>
            {extra.connectLoading && <p className="ct-hint">Checking your Stripe account…</p>}
            {extra.connectState === 'under_review' && (
              <p className="ct-hint">Stripe is still verifying your account. You can publish; payments open once it finishes.</p>
            )}
            <Field label="Deposit (optional)" hint="Blank means one single payment. It can’t be more than the price.">
              <MoneyInput
                currency={currency}
                placeholder="No deposit"
                value={s.depositAmount}
                onChange={v => set(st => ({ ...st, depositAmount: v }))}
              />
            </Field>
          </>
        )}
        <div className="ct-field">
          <span className="ct-label">{s.paymentMode === 'managed' ? 'Final payment due' : 'Payment due'}</span>
          <Stepper
            label="days before the trip"
            value={balance.daysBefore === 1 ? '1 day before' : `${balance.daysBefore} days before`}
            decDisabled={isDeadlineAtEnd(balance.daysBefore, -1)}
            incDisabled={isDeadlineAtEnd(balance.daysBefore, 1)}
            onDec={() => setBalanceDays(stepDeadline(balance.daysBefore, -1))}
            onInc={() => setBalanceDays(stepDeadline(balance.daysBefore, 1))}
          />
        </div>
      </Section>

      <Section
        title="Refunds"
        body={s.cancellation ? 'Changed for this trip only. Your default stays as it is.' : 'Your default cancellation policy. Change it for this trip only if you need to.'}
        right={
          s.cancellation ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => set(st => ({ ...st, cancellation: undefined }))}>
              Use my default
            </button>
          ) : undefined
        }
      >
        <PolicyFields value={extra.policy} onChange={p => set(st => ({ ...st, cancellation: p }))} />
      </Section>
    </>
  );
}

function Inclusions({ value, onChange }: { value: PriceInclusions; onChange: (v: PriceInclusions) => void }) {
  const patch = (p: Partial<PriceInclusions>) => onChange({ ...value, ...p });
  const count = (k: keyof PriceInclusions) => (hasCategoryValue(value, k) ? '✓' : '');
  const film = value.surfFilm ?? {};
  const va = value.videoAnalysis ?? {};
  const acts = value.activities ?? [];
  const well = value.wellness ?? [];
  const custom = value.custom ?? [];

  return (
    <div>
      {CATEGORY_ORDER.map(k => (
        <details key={k} className="ct-acc">
          <summary>
            <span>{CATEGORY_TITLE[k]}</span>
            <span className="muted small">{count(k)}</span>
          </summary>
          <div className="ct-acc-body">
            {k in TAG_CATEGORIES && (
              <div className="ct-chips">
                {TAG_CATEGORIES[k as keyof typeof TAG_CATEGORIES].map(o => {
                  const list = (value[k] as string[] | undefined) ?? [];
                  return (
                    <Chip key={o.slug} on={list.includes(o.slug)} onClick={() => patch({ [k]: toggle(list, o.slug) })}>
                      {o.label}
                    </Chip>
                  );
                })}
              </div>
            )}
            {k === 'surfFilm' && (
              <>
                <div className="ct-chips">
                  {SURF_FILM_MEDIA_OPTIONS.map(o => (
                    <Chip key={o.slug} on={!!film.media?.includes(o.slug)} onClick={() => patch({ surfFilm: { ...film, media: toggle(film.media ?? [], o.slug) } })}>
                      {o.label}
                    </Chip>
                  ))}
                </div>
                <Field label="How many sessions (optional)">
                  <input
                    type="number"
                    min={1}
                    value={film.count ?? ''}
                    onChange={e => patch({ surfFilm: { ...film, count: intOrNull(e.target.value) } })}
                  />
                </Field>
                <span className="ct-label" style={{ marginTop: 12 }}>Type (optional)</span>
                <div className="ct-chips">
                  {SURF_FILM_TYPE_OPTIONS.map(o => (
                    <Chip key={o.slug} on={!!film.filmTypes?.includes(o.slug)} onClick={() => patch({ surfFilm: { ...film, filmTypes: toggle(film.filmTypes ?? [], o.slug) } })}>
                      {o.label}
                    </Chip>
                  ))}
                </div>
              </>
            )}
            {k === 'videoAnalysis' && (
              <>
                <label className="ct-toggle">
                  <span>Video analysis is included</span>
                  <input type="checkbox" checked={!!va.included} onChange={e => patch({ videoAnalysis: { ...va, included: e.target.checked } })} />
                </label>
                {va.included && (
                  <Field label="How many sessions (optional)">
                    <input type="number" min={1} value={va.count ?? ''} onChange={e => patch({ videoAnalysis: { ...va, count: intOrNull(e.target.value) } })} />
                  </Field>
                )}
              </>
            )}
            {k === 'activities' && (
              <>
                <div className="ct-chips">
                  {ACTIVITIES_OPTIONS.map(o => {
                    const on = acts.some(a => a.key === o.slug);
                    return (
                      <Chip key={o.slug} on={on} onClick={() => patch({ activities: on ? acts.filter(a => a.key !== o.slug) : [...acts, { key: o.slug }] })}>
                        {o.label}
                      </Chip>
                    );
                  })}
                </div>
                {acts.map(a => (
                  <Field key={a.key} label={`${ACTIVITIES_OPTIONS.find(o => o.slug === a.key)?.label ?? a.key} — note (optional)`}>
                    <input
                      type="text"
                      value={a.note ?? ''}
                      onChange={e => patch({ activities: acts.map(x => (x.key === a.key ? { ...x, note: e.target.value } : x)) })}
                    />
                  </Field>
                ))}
              </>
            )}
            {k === 'wellness' && (
              <>
                <div className="ct-chips">
                  {WELLNESS_OPTIONS.map(o => {
                    const on = well.some(w => w.key === o.slug);
                    return (
                      <Chip key={o.slug} on={on} onClick={() => patch({ wellness: on ? well.filter(w => w.key !== o.slug) : [...well, { key: o.slug, payment: 'included' }] })}>
                        {o.label}
                      </Chip>
                    );
                  })}
                </div>
                {well.map(w => (
                  <div key={w.key} className="row-between" style={{ marginTop: 8, gap: 8 }}>
                    <span className="small">{WELLNESS_OPTIONS.find(o => o.slug === w.key)?.label ?? w.key}</span>
                    <div className="ct-chips">
                      {(['included', 'extra'] as const).map(p => (
                        <Chip key={p} on={w.payment === p} onClick={() => patch({ wellness: well.map(x => (x.key === w.key ? { ...x, payment: p } : x)) })}>
                          {p === 'included' ? 'Included' : 'Extra cost'}
                        </Chip>
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </details>
      ))}
      <details className="ct-acc">
        <summary>
          <span>Add your own</span>
          <span className="muted small">{custom.length ? custom.length : ''}</span>
        </summary>
        <div className="ct-acc-body">
          {custom.map((c, i) => (
            <div key={i} className="ct-grid2" style={{ marginBottom: 8 }}>
              <input type="text" placeholder="Title" aria-label="Title" value={c.title} onChange={e => patch({ custom: custom.map((x, n) => (n === i ? { ...x, title: e.target.value } : x)) })} />
              <div className="row" style={{ gap: 8 }}>
                <input type="text" placeholder="Description (optional)" aria-label="Description" value={c.description ?? ''} onChange={e => patch({ custom: custom.map((x, n) => (n === i ? { ...x, description: e.target.value } : x)) })} />
                <button type="button" className="btn btn-sm" aria-label="Remove" onClick={() => patch({ custom: custom.filter((_, n) => n !== i) })}>✕</button>
              </div>
            </div>
          ))}
          <button type="button" className="btn btn-sm" onClick={() => patch({ custom: [...custom, { title: '' }] })}>
            + Add item
          </button>
        </div>
      </details>
    </div>
  );
}

// ── 5. About you ───────────────────────────────────────────────────────────

export function AboutYouStep({ s, set, profile }: StepProps & { profile: { name: string; photoUrl: string | null } | null }) {
  return (
    <>
      <Section title="You">
        <div className="row" style={{ gap: 12 }}>
          {profile?.photoUrl ? (
            <img src={profile.photoUrl} alt="" width={48} height={48} style={{ borderRadius: 999, objectFit: 'cover' }} />
          ) : (
            <span className="ct-photo" style={{ width: 48, height: 48, borderRadius: 999 }} />
          )}
          <strong>{profile?.name || 'You'}</strong>
        </div>
      </Section>
      <Section title="Why surfers can trust your operation">
        <textarea
          rows={5}
          maxLength={500}
          value={s.hostLeadNote}
          placeholder="e.g. 12 years guiding surfers in Bali, ISA Level 2 coach, lifeguard certified. I know every break on the Bukit and when it works."
          onChange={e => set(st => ({ ...st, hostLeadNote: e.target.value.slice(0, 500) }))}
        />
        <p className="ct-hint" style={{ textAlign: 'right', color: s.hostLeadNote.length >= 500 ? 'var(--danger)' : undefined }}>
          {s.hostLeadNote.length}/500
        </p>
      </Section>
    </>
  );
}

// ── 6. Requirements ────────────────────────────────────────────────────────

const DOC_KINDS: EditableKind[] = ['passport', 'waiver', 'medical', 'insurance', 'visa', 'flights'];

export function RequirementsStep({
  s,
  set,
  errors,
  defaultWaiver,
  waiverFile,
  setWaiverFile,
}: StepProps & {
  defaultWaiver: DefaultWaiver | null;
  waiverFile: File | null;
  setWaiverFile: (f: File | null) => void;
}) {
  const [newItem, setNewItem] = useState('');
  const setTiming = (kind: EditableKind, patch: Partial<{ skippable: boolean; daysBefore: number }>) =>
    set(st => ({
      ...st,
      requirementTiming: { ...st.requirementTiming, [kind]: { ...st.requirementTiming[kind], ...patch } },
    }));

  return (
    <>
      <Section title="Documents" body="What each traveler sends you. Required ones block joining until done; the rest can wait until a deadline.">
        {DOC_KINDS.map(kind => {
          const c = REQUIREMENT_CATALOG[kind];
          const locked = LOCKED_ON_KINDS.includes(kind);
          const on = locked || s.requirementKinds.includes(kind);
          const t = s.requirementTiming[kind];
          return (
            <div key={kind} className="ct-toggle" style={{ display: 'block' }}>
              <label className="row-between" style={{ gap: 12, alignItems: 'flex-start', cursor: locked ? 'default' : 'pointer' }}>
                <span>
                  <strong>{c.operatorTitle}</strong>
                  <span className="muted small" style={{ display: 'block' }}>{LOCKED_ON_SUB[kind] ?? c.operatorSub}</span>
                </span>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={locked}
                  onChange={() => set(st => ({ ...st, requirementKinds: toggle(st.requirementKinds, kind) }))}
                />
              </label>
              {on && t && (
                <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <Chip on={!t.skippable} onClick={() => setTiming(kind, { skippable: false })}>When they join</Chip>
                  <Chip on={t.skippable} onClick={() => setTiming(kind, { skippable: true })}>They can skip</Chip>
                  {t.skippable && (
                    <Stepper
                      label="deadline"
                      value={`${t.daysBefore}d before`}
                      decDisabled={isDeadlineAtEnd(t.daysBefore, -1)}
                      incDisabled={isDeadlineAtEnd(t.daysBefore, 1)}
                      onDec={() => setTiming(kind, { daysBefore: stepDeadline(t.daysBefore, -1) })}
                      onInc={() => setTiming(kind, { daysBefore: stepDeadline(t.daysBefore, 1) })}
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </Section>

      <Section title="Your waiver PDF" error={errors.waiver}>
        {waiverFile ? (
          <div className="row-between" style={{ gap: 12 }}>
            <span>{waiverFile.name}</span>
            <button type="button" className="btn btn-sm" onClick={() => setWaiverFile(null)}>Remove</button>
          </div>
        ) : defaultWaiver ? (
          <p className="small">Using your default waiver: <strong>{defaultWaiver.name}</strong></p>
        ) : null}
        <label className="btn btn-sm" style={{ marginTop: 8 }}>
          {waiverFile || defaultWaiver ? 'Use a different PDF for this trip' : 'Upload PDF'}
          <input
            type="file"
            accept="application/pdf"
            hidden
            onChange={e => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              if (f.type !== 'application/pdf') return alert('The waiver has to be a PDF.');
              if (f.size > 10 * 1024 * 1024) return alert('Waiver PDFs can be up to 10 MB. Please choose a smaller file.');
              setWaiverFile(f);
              set(st => ({ ...st, waiverFileName: f.name }));
            }}
          />
        </label>
        {s.waiverFileName && !waiverFile && (
          <p className="ct-hint">You picked “{s.waiverFileName}” before reloading. Pick it again.</p>
        )}
      </Section>

      <Section
        title="Add a packing list for guests"
        right={<input type="checkbox" aria-label="Add a packing list" checked={s.suggestedPackingOn} onChange={e => set(st => ({ ...st, suggestedPackingOn: e.target.checked }))} />}
        body="Items you suggest they bring, shown to them as Admin suggested."
      >
        {s.suggestedPackingOn && (
          <>
            <div className="ct-chips">
              {s.suggestedPacking.map((n, i) => (
                <span key={`${n}-${i}`} className="chip" aria-pressed="true">
                  {n}{' '}
                  <button type="button" aria-label={`Remove ${n}`} style={{ border: 'none', background: 'none', cursor: 'pointer' }} onClick={() => set(st => ({ ...st, suggestedPacking: st.suggestedPacking.filter((_, k) => k !== i) }))}>✕</button>
                </span>
              ))}
            </div>
            <form
              className="row"
              style={{ gap: 8, marginTop: 12 }}
              onSubmit={e => {
                e.preventDefault();
                const name = newItem.trim();
                if (!name) return;
                set(st => ({ ...st, suggestedPacking: [...st.suggestedPacking, name] }));
                setNewItem('');
              }}
            >
              <input type="text" placeholder="e.g. Reef booties" value={newItem} onChange={e => setNewItem(e.target.value)} />
              <button type="submit" className="btn btn-sm">Add</button>
            </form>
          </>
        )}
      </Section>
    </>
  );
}

// ── 7. Itinerary ───────────────────────────────────────────────────────────

export function ItineraryStep({ s, set, src, addFiles }: StepProps) {
  const total = tripCalendarDays(s.startDateISO, s.endDateISO);
  const [editing, setEditing] = useState<ItineraryDay | null>(null);

  if (editing) {
    const d = editing;
    const up = (p: Partial<ItineraryDay>) => setEditing({ ...d, ...p });
    return (
      <Section title={dayLabel(s.startDateISO, d.day)}>
        <Field label="Title" hint={`${d.title.length}/${MAX_DAY_TITLE_LENGTH}`}>
          <input type="text" maxLength={MAX_DAY_TITLE_LENGTH} value={d.title} onChange={e => up({ title: e.target.value })} />
        </Field>
        <div className="ct-field">
          <span className="ct-label">Photos</span>
          <div className="ct-photos">
            {d.photos.map((ref, i) => (
              <PhotoTile key={ref} src={src(ref)} alt={`day photo ${i + 1}`} onRemove={() => up({ photos: d.photos.filter(p => p !== ref) })} />
            ))}
            {d.photos.length < MAX_DAY_PHOTOS && (
              <PhotoDrop multiple label="Add" onPick={files => up({ photos: [...d.photos, ...addFiles(files.slice(0, MAX_DAY_PHOTOS - d.photos.length))] })} />
            )}
          </div>
        </div>
        <div className="ct-field">
          <span className="ct-label">Activities</span>
          {d.activities.map((a, i) => (
            <div key={i} className="ct-activity">
              <input type="time" aria-label="Time" value={a.time ?? ''} onChange={e => up({ activities: d.activities.map((x, n) => (n === i ? { ...x, time: e.target.value || null } : x)) })} />
              <input type="text" placeholder="What" aria-label="Activity" value={a.name} onChange={e => up({ activities: d.activities.map((x, n) => (n === i ? { ...x, name: e.target.value } : x)) })} />
              <input type="text" placeholder="Where (optional)" aria-label="Place" value={a.place ?? ''} onChange={e => up({ activities: d.activities.map((x, n) => (n === i ? { ...x, place: e.target.value } : x)) })} />
              <button type="button" className="btn btn-sm" aria-label="Remove activity" onClick={() => up({ activities: d.activities.filter((_, n) => n !== i) })}>✕</button>
            </div>
          ))}
          <button type="button" className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => up({ activities: [...d.activities, { time: null, name: '', place: null }] })}>
            + Add activity
          </button>
        </div>
        <div className="row" style={{ gap: 8, marginTop: 16 }}>
          <button type="button" className="btn" onClick={() => setEditing(null)}>Cancel</button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              set(st => ({ ...st, itinerary: upsertDay(st.itinerary, d) }));
              setEditing(null);
            }}
          >
            Done
          </button>
        </div>
      </Section>
    );
  }

  return (
    <Section title="Days" body="Optional. Only days with a title are shown to travelers. You can edit this later in the app.">
      {total === 0 && <p className="muted small">Set the trip dates first.</p>}
      <div className="ct-choices">
        {Array.from({ length: total }, (_, i) => i + 1).map(n => {
          const day = s.itinerary.find(x => x.day === n);
          return (
            <button key={n} type="button" className="ct-day" onClick={() => setEditing(day ?? emptyDay(n))}>
              <span>
                <span className="small muted" style={{ display: 'block' }}>{dayLabel(s.startDateISO, n)}</span>
                <strong>{day && isDayPlanned(day) ? day.title : 'Add plan'}</strong>
              </span>
              <span className="muted" aria-hidden>›</span>
            </button>
          );
        })}
      </div>
    </Section>
  );
}

// ── 8. Preview ─────────────────────────────────────────────────────────────

export function PreviewStep({
  s,
  src,
  currency,
  policyLabel,
  kinds,
}: StepProps & { currency: OperatorCurrency; policyLabel: string; kinds: EditableKind[] }) {
  const sym = CURRENCY_SYMBOL[currency];
  const inc = normalizePriceInclusions(s.priceInclusions);
  return (
    <>
      {s.heroImage && <img className="ct-preview-hero" src={src(s.heroImage)} alt="" />}
      <Section title={s.title || 'Untitled trip'} body={s.destinationGeo?.full ?? s.destination}>
        <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{s.description}</p>
      </Section>
      <Section title="At a glance">
        <dl className="ct-kv">
          <dt>Dates</dt>
          <dd>{formatRange(s.startDateISO, s.endDateISO)}</dd>
          <dt>Spots</dt>
          <dd>{s.maxParticipants || 'Any'}</dd>
          <dt>Price</dt>
          <dd>
            {sym}{s.costPerPerson} shared
            {s.privateRoomPrice && Number(s.privateRoomPrice) > 0 ? ` · ${sym}${s.privateRoomPrice} private` : ''}
          </dd>
          <dt>Payment</dt>
          <dd>
            {s.paymentMode === 'managed'
              ? `In the app${s.depositAmount && Number(s.depositAmount) > 0 ? ` · ${sym}${s.depositAmount} deposit` : ''}`
              : 'Outside the app'}
          </dd>
          <dt>Joining</dt>
          <dd>{JOIN_MODE_OPTIONS.find(o => o.key === s.joinMode)?.title}</dd>
          <dt>Refunds</dt>
          <dd>{policyLabel}</dd>
          <dt>Stay</dt>
          <dd>
            {s.accommodationName}
            {s.accommodationKind ? ` · ${ACCOMMODATION_LABEL[s.accommodationKind]}` : ''}
          </dd>
          <dt>Travelers send</dt>
          <dd>{kinds.map(k => REQUIREMENT_CATALOG[k].operatorTitle).join(', ')}</dd>
          {inc && (
            <>
              <dt>Included</dt>
              <dd>{CATEGORY_ORDER.filter(k => hasCategoryValue(inc, k)).map(k => CATEGORY_TITLE[k]).join(', ') || 'Custom items'}</dd>
            </>
          )}
          <dt>Itinerary</dt>
          <dd>{plural(s.itinerary.filter(isDayPlanned).length, 'planned day')}</dd>
        </dl>
      </Section>
      <p className="ct-hint">The trip is published as public and active, the same as from the app.</p>
    </>
  );
}
