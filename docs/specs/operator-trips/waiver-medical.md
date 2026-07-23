# Waiver signing & medical form — implementation spec

**Part of:** Operator Trips. **Sources:** `SPEC.md` §2, §4.1, §4.3, §7; `docs/operator-trips-workbench.html` features `waiver`, `medical`, `med-card`, `trav-med`, `onb-req`.
**Data model: extends `hosting_style='C'` group trips. Overrides SPEC.md §5.** An operator trip is a `group_trips` row with `hosting_style='C'`. There is no separate operator model. Waiver and medical are new **child tables** in the existing group-trip cluster, keyed the same way every other child table is: `trip_id references group_trips(id)` + `user_id references auth.users(id)`. There is no booking table and no `booking_id`.
**Sibling spec:** `requirements-model.md` — the waiver is an `acknowledge` requirement. Medical is also a requirement item.
**Status:** ready to build, except where marked OPEN. Renames + acknowledgements generalization applied 2026-07-23.

## 1. Summary

Two items in the traveler's trip onboarding.

**Waiver.** The operator uploads waiver text or a PDF, with a version. The traveler reads it and taps "I agree". We record name, timestamp and waiver version. Nothing is drawn and nothing is e-signed. Judged legally reasonable here and trivial to build. Drawn signatures or DocuSign stay available later if an operator's insurer demands them — a future path, not v1 scope.

**Medical.** Four free-text fields: allergies, dietary preferences, injuries, regularly-taken prescribed medication. The form lives **on the trip** and is filled fresh every time. Never written to the Swellyo profile, never copied between trips. The operator gets **view only** — no export, ever. The traveler can view and edit their own answers while the trip is live.

Medical is **table rows**, not file storage. It is an RLS problem. It must never become a file, a PDF, a storage object or a signed URL.

## 2. Waiver

### 2.1 Data model

The waiver version could live as a field on the `group_trips` row, but that cannot hold history. An agreement must point at the exact text the traveler saw. Edit the text in place and every past agreement silently refers to text nobody agreed to. So the waiver splits across two child tables in the group-trip cluster: versions, plus the shared acknowledgements table.

```sql
-- Waiver versions. Append-only. Editing text always makes a new row.
create table if not exists public.group_trip_waiver_versions (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid not null references public.group_trips(id) on delete cascade,
  version      integer not null,
  body_text    text,
  file_path    text,                       -- private bucket path, PDF only
  published_at timestamptz not null default now(),
  created_by   uuid not null references auth.users(id),
  unique (trip_id, version),
  constraint waiver_has_content check (body_text is not null or file_path is not null)
);

-- Acknowledgements. Immutable. One row per user per acknowledge-type requirement.
create table if not exists public.group_trip_acknowledgements (
  id                uuid primary key default gen_random_uuid(),
  trip_id           uuid not null references public.group_trips(id) on delete cascade,
  requirement_id    uuid not null references public.group_trip_requirements(id),
  waiver_version_id uuid references public.group_trip_waiver_versions(id) on delete restrict,
                                            -- null for custom non-waiver acknowledges
  user_id           uuid not null references auth.users(id) on delete cascade,
  agreed_name       text not null,          -- the name as shown to the traveler at agree time
  agreed_version    integer,                -- denormalised copy; null when waiver_version_id is null
  agreed_at         timestamptz not null default now()
);
-- Uniqueness: one row per user per waiver version, one row per user per custom requirement.
create unique index if not exists uq_group_trip_ack_waiver
  on public.group_trip_acknowledgements(waiver_version_id, user_id)
  where waiver_version_id is not null;
create unique index if not exists uq_group_trip_ack_requirement
  on public.group_trip_acknowledgements(requirement_id, user_id)
  where waiver_version_id is null;
create index if not exists idx_group_trip_ack_trip on public.group_trip_acknowledgements(trip_id);
```

This one table is the single record of every acknowledge-type requirement — the waiver is just an acknowledgement that also points at a waiver version (decided 2026-07-23; the ack_* fields that used to be sketched on the states table are gone with that table).

`on delete restrict` on `waiver_version_id` is deliberate. A version that somebody agreed to can never be deleted.

### 2.2 Operator upload flow

1. In trip creation or trip edit, the operator opens "Waiver".
2. They paste text or pick a PDF. Both allowed. A PDF goes to the private documents bucket, same rules as any other operator-trip file.
3. On save we insert a row with `version = max(version) + 1` for that trip. Version 1 on first save. Existing rows are never updated — there is no edit-in-place.
4. The waiver requirement only appears to travelers once version 1 exists.

### 2.3 Traveler agree flow

1. The requirement list shows "Sign waiver" as an `acknowledge` item.
2. Tap → waiver screen: operator name, trip name, version label, then the full text (scroll view) or the PDF (in-app viewer).
3. Below it: the traveler's name, pre-filled from their profile and **not editable**, and one "I agree" button.
4. Tap inserts one row into `group_trip_acknowledgements`. That row IS the requirement state — done means the row exists; there is no separate state row and no operator approval step.

### 2.4 Exactly what is recorded

| Field | Value |
|---|---|
| `user_id` | the signing user |
| `agreed_name` | the profile name displayed on screen at the moment of agreement |
| `agreed_at` | server `now()`, not device time |
| `waiver_version_id` + `agreed_version` | the exact version shown |

Nothing else. No IP address, no device fingerprint, no geolocation — that is a separate decision with its own privacy cost and nobody has asked for it.

### 2.5 New version after people already agreed

The mechanics fall out of the model:

- A new upload makes a new version row. Old agreement rows are untouched and stay valid for the version they name.
- No agreement is ever deleted, edited or "migrated" to a new version.
- The dashboard reports agreement **against the trip's current version**, so publishing v2 makes v1-only signers show as outstanding.

The operator-facing policy on top of that is not decided:

> **OPEN — needs Eyal & Ohad.** Does a new version force everyone to re-agree (reopening the requirement plus a notification, matching the "requirements can be added after publish" rule), or can the operator publish a version marked as a minor correction that reopens nothing? Forced re-agree is the safe default and matches the requirements model. A "minor edit" escape hatch is convenient and easy to abuse. Do not pick one in code before this is answered.

## 3. Medical

### 3.1 Data model

```sql
create table if not exists public.group_trip_medical_forms (
  id               uuid primary key default gen_random_uuid(),
  trip_id          uuid not null references public.group_trips(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  allergies        text,   allergies_none   boolean not null default false,
  dietary          text,   dietary_none     boolean not null default false,
  injuries         text,   injuries_none    boolean not null default false,
  medications      text,   medications_none boolean not null default false,
  completed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (trip_id, user_id),
  constraint medical_text_len check (
    coalesce(length(allergies), 0)   <= 1000 and
    coalesce(length(dietary), 0)     <= 1000 and
    coalesce(length(injuries), 0)    <= 1000 and
    coalesce(length(medications), 0) <= 1000
  )
);
create index if not exists idx_group_trip_medical_forms_trip on public.group_trip_medical_forms(trip_id);
```

One row per `(trip_id, user_id)`, the same anchor as `group_trip_participants`. The paired `*_none` booleans matter. "I have no allergies" and "I have not answered yet" are different facts, and an operator reading a blank field needs to know which. A field is **answered** when the text is non-empty **or** `*_none` is true.

### 3.2 The form

Four blocks, same shape each time: a label, a "None" toggle, and a multi-line `TextInput` (disabled while "None" is on). 1000-char cap, counter appears past 800.

Saving follows the existing onboarding habit in `src/context/OnboardingContext.tsx`:

- **Every keystroke** writes a draft to AsyncStorage under `group_medical_draft_<tripId>`. Crash recovery only, no network.
- **Supabase write on "Save" / "Next" only** — one upsert on `(trip_id, user_id)`.
- On load the DB row wins over the local draft, same rule as profile onboarding. The draft is used only when there is no row yet, or when it is newer than `updated_at`. Clear the draft key after a successful write.

`completed_at` is set on the first save where at least one field is answered. Later edits move `updated_at` and leave `completed_at` alone. `completed_at` being set IS the medical requirement state — there is no separate state row (decided 2026-07-23).

### 3.3 RLS

Two SECURITY DEFINER helpers. The operator check reuses the existing `is_trip_host(trip_id)` — we **call** it, we never modify it. The traveler check uses `is_trip_participant(trip_id)` over `group_trip_participants`.

`is_trip_participant` is **not defined here.** It is the single canonical membership helper, created once in `requirements-model.md`'s migration (`20260722000100_operator_requirements.sql`) and reused by every operator-trip spec. This file assumes it already exists. If waiver/medical ships before the requirements migration, move that one `CREATE FUNCTION` block earlier — do not duplicate it, or the two copies can drift.

> Gotcha, keep this: RLS policy expressions are evaluated as the **calling** role, so `authenticated` must keep `EXECUTE` on `is_trip_participant` — and on the existing `is_trip_host`. The project's blanket "revoke EXECUTE on all SECURITY DEFINER functions" hardening pass **must not** be applied to RLS helper functions. Revoke here and every policy that calls them turns into a permission error.

Policies:

```sql
alter table public.group_trip_medical_forms enable row level security;
revoke all on table public.group_trip_medical_forms from anon, public;
-- deliberately no DELETE grant, for anyone
grant select, insert, update on table public.group_trip_medical_forms to authenticated;

create policy medical_traveler_select on public.group_trip_medical_forms
  for select to authenticated using (user_id = auth.uid());

create policy medical_traveler_insert on public.group_trip_medical_forms
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_trip_participant(trip_id));

create policy medical_traveler_update on public.group_trip_medical_forms
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Operator: read only. There is no operator insert, update or delete policy.
create policy medical_operator_select on public.group_trip_medical_forms
  for select to authenticated using (public.is_trip_host(trip_id));

-- Waiver versions + acknowledgements. No UPDATE/DELETE policy on acknowledgements:
-- that is what makes them immutable.
alter table public.group_trip_waiver_versions    enable row level security;
alter table public.group_trip_acknowledgements   enable row level security;
revoke all on table public.group_trip_waiver_versions,
                    public.group_trip_acknowledgements from anon, public;
grant select, insert on table public.group_trip_waiver_versions    to authenticated;
grant select, insert on table public.group_trip_acknowledgements   to authenticated;

create policy waiver_ver_read on public.group_trip_waiver_versions
  for select to authenticated
  using (public.is_trip_host(trip_id) or public.is_trip_participant(trip_id));

create policy waiver_ver_write on public.group_trip_waiver_versions
  for insert to authenticated with check (public.is_trip_host(trip_id));

create policy ack_read on public.group_trip_acknowledgements
  for select to authenticated
  using (user_id = auth.uid() or public.is_trip_host(trip_id));

create policy ack_write on public.group_trip_acknowledgements
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_trip_participant(trip_id));

-- updated_at
create or replace function public.touch_group_trip_medical_forms()
returns trigger language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$ begin new.updated_at := now(); return new; end $$;

drop trigger if exists trg_touch_group_trip_medical_forms on public.group_trip_medical_forms;
create trigger trg_touch_group_trip_medical_forms before update on public.group_trip_medical_forms
  for each row execute function public.touch_group_trip_medical_forms();

-- Dashboard flag counts. security_invoker so RLS still applies.
create or replace view public.group_trip_medical_flags
with (security_invoker = true) as
select trip_id,
       count(*) filter (where coalesce(length(trim(injuries)), 0)    > 0) as injuries_reported,
       count(*) filter (where coalesce(length(trim(allergies)), 0)   > 0) as allergies_reported,
       count(*) filter (where coalesce(length(trim(dietary)), 0)     > 0) as dietary_reported,
       count(*) filter (where coalesce(length(trim(medications)), 0) > 0) as medications_reported,
       count(*) filter (where completed_at is not null)                   as forms_completed
from public.group_trip_medical_forms
group by trip_id;
```

Migrations are applied by hand in the Supabase SQL editor. Never `supabase db push`.

## 4. Why medical is per-trip and not on the profile

Three reasons. Do not "improve" this later by moving it to the profile.

1. **The data only exists where it is needed.** A user who never joins a paid trip has no medical data in Swellyo at all.
2. **It stays current.** A profile field gets filled once and is wrong three years later. Injuries and medication change. Retyping is the mechanism that keeps it true.
3. **Blast radius.** Profile-level medical data would sit next to the free peer-trip product and be reachable from far more code paths.

Direct consequence for UI wording: the board's phrase "my medical card" means **the card for this trip**. Never write copy that implies a saved profile record — no "your medical info", no "update your medical profile", no "we'll remember this". Accepted cost: repeat travelers retype. That is known and accepted.

## 5. What the traveler sees

**Waiver**
1. Requirement list shows "Sign waiver", not done.
2. Tap → waiver screen. Header: operator, trip, "Version 2". Body: full text scrollable, or the PDF viewer. Footer: their name (read-only) + "I agree".
3. Tap → row written → back to the list, item done, showing "Agreed 4 Aug 2026 · v2".
4. They can reopen it read-only later and see the same summary line.

**Medical**
1. Requirement list shows "Medical info", not done.
2. Tap → the four-block form. One-line note at the top: this is for this trip only, the operator can see it, the operator cannot download it.
3. Typing saves a local draft. "Save" writes the row and marks the requirement done.
4. In Plan the item stays visible as "My medical card" and reopens the same form in edit mode. Editable while the trip is live.

## 6. What the operator sees

**Dashboard snapshot tile — medical flags.** Counts only, from `group_trip_medical_flags`. "3 reported injuries", "2 allergies", "5 dietary notes". No names and no medical detail on the summary screen. Each count has a view-all.

**Per-traveler medical view.** Read-only. The four fields as plain text, with "None reported" where `*_none` is true and "Not answered yet" where neither is set. Plus "Last updated 3 Aug".

Hard constraints on this screen:
- No export button, no share sheet, no download, no copy-all, no "send to hotel".
- No PDF generation, ever.
- Not reachable on the read-only desktop dashboard export paths.
- Medical never joins the document export flow that hands over real files.

> **OPEN — needs Eyal & Ohad.** The board says every dashboard tile gets a view-all page **with export for all**. `SPEC.md` §7 says medical is view-only with **no export**. These two rules collide precisely on the medical view-all page. Nobody has decided which wins. Until it is decided, build the medical view-all with no export and leave a `TODO` pointing at this line. Do not add an export "just in case".

## 7. Edge cases

| Case | Behaviour |
|---|---|
| Operator publishes a new waiver version mid-trip | Old agreements stay, tied to their version. Dashboard counts against the current version, so v1 signers show outstanding. Whether that forces a re-agree is OPEN (§2.5). |
| Traveler edits medical after the operator already read it | Allowed, silently. `updated_at` moves. The operator's view always reads live; there is no snapshot and no "approved" state for medical. **OPEN — needs Ohad:** whether an edit notifies the operator. Do not add a notification before this is answered. |
| Empty medical form | Legal. `completed_at` stays null and the requirement stays not-done. Operator sees "Not answered yet" per field. A traveler with nothing to report ticks the four "None" toggles — that is a real answer and marks it done. |
| Very long free text | Hard cap 1000 chars per field, enforced by the DB `CHECK` and by `maxLength` on the input. Operator view clamps to 6 lines with "show more". No rich text, no markdown rendering — render as plain text so pasted content cannot format itself. |
| Traveler leaves or is removed from the trip | Their `group_trip_participants` row is gone, so `is_trip_participant` returns false and they can no longer insert or edit. Their existing medical row and acknowledgement rows remain. Deletion is a retention question, see §8. |
| Same traveler on two trips of the same operator | Two independent rows. Nothing is copied or pre-filled across them. That is the point of §4. |
| Two devices editing medical at once | Last write wins on the upsert. Acceptable — this is one person editing their own four fields. |
| Waiver PDF fails to load | Show a retry, keep "I agree" disabled until the document has actually rendered. Agreeing to a document that failed to display is worthless. |

## 8. Privacy notes

Medical information is **special-category personal data** under GDPR Art. 9. This spec does not take a legal position — it records what that classification implies for the build, and what still needs a lawyer.

- **Access.** Only two parties ever: the traveler, and the host (operator) of that one trip. RLS in §3.3 is the whole enforcement mechanism. There is no admin view and no support view in v1.
- **Purpose limit.** Collected to run one trip. Not for matching, not for analytics, not for any AI/Swelly prompt. Never put medical text into an Edge Function payload that reaches OpenAI.
- **Minimisation.** Four fields, nothing more. Do not add date-of-birth, blood type, emergency contact or insurance policy number to this table without a fresh decision.
- **Logging.** Special-category data usually calls for a record of who read it. The workbench already has an undecided version of this for document downloads. **OPEN — needs Eyal.** If we do log, it is one append-only table (`group_trip_medical_access_log`: trip_id, user_id, viewer_id, viewed_at) with no read policy for operators.
- **Retention.** The agreed 30-day-after-trip rule in the workbench is about **files**. Medical is rows, so that rule does not automatically cover it. **OPEN — needs Eyal & Ohad.**
- **Disclosure before entry.** The traveler must be told, on the form itself, before typing: this is for this trip, the operator can read it, the operator cannot download it, and how long we keep it. The last part is blocked on the retention answer above.
- **Operator agreement.** A data-protection clause in the operator agreement is already flagged as open in the workbench. It matters more for medical than for anything else. Not a code task.
- **Acknowledgements are not special-category data.** Name, timestamp and version only. They can be exported normally.

## 9. Files to create or change

**New**
- `supabase/migrations/<ts>_group_trip_waiver_medical.sql` — everything in §2.1, §3.1, §3.3. Applied by hand in the SQL editor.
- `src/services/operator/waiverService.ts` — publish version, fetch current version, record acknowledgement, read acknowledgement state for a trip.
- `src/services/operator/medicalService.ts` — get / upsert medical for `(tripId, userId)`, plus dashboard flag counts.
- `src/screens/trips/operator-onboarding/WaiverScreen.tsx` — read + agree.
- `src/screens/trips/operator-onboarding/MedicalFormScreen.tsx` — the form, reused as "My medical card" in edit mode.
- `src/screens/operator/WaiverEditorScreen.tsx` — operator upload, text or PDF.
- `src/screens/operator/TravelerMedicalScreen.tsx` — read-only per-traveler view.
- `src/screens/operator/MedicalFlagsScreen.tsx` — the view-all, no export (see §6 OPEN).

**Changed**
- Requirements list / Plan screen from `requirements-model.md` — render `acknowledge` for waiver, a form item for medical.
- Operator dashboard snapshot — add the medical flags tile. Per-traveler page — add "Waiver: agreed v2, 4 Aug" and the medical entry point. Navigation types for the new screens.

**Untouched — do not modify**
- The existing `group_trips` table shape, all existing `group_trip_*` tables, and `is_trip_host()`. We only **add** new child tables and a new `is_trip_participant` helper. No medical field goes on `profiles`.

## 10. Open questions

1. **Does a new waiver version force re-agreement?** — needs Eyal & Ohad. §2.5. Blocks the version-publish UI.
2. **Does medical appear on the dashboard view-all pages, and with export?** — needs Eyal & Ohad. §6. The board says every tile gets export for all; `SPEC.md` §7 says medical has no export. Unresolved collision. Build with no export meanwhile.
3. **Do we log operator reads of medical data?** — needs Eyal. §8.
4. **How long do we keep medical rows?** — needs Eyal & Ohad. §8. The 30-day file rule does not cover rows. Blocks the disclosure text on the form.
5. **Does editing medical notify the operator?** — needs Ohad. §7.
6. **Must the traveler scroll to the end of the waiver before "I agree" enables?** — needs Ohad. Minor, but it is the kind of thing an insurer asks about later.
