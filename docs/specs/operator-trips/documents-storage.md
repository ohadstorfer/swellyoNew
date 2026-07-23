# Operator Trips — Document storage and retention

**Data model: extends `hosting_style='C'` group trips. Overrides SPEC.md §5.**
An operator trip is a `group_trips` row with `hosting_style='C'`. There is no separate operator data model. Documents extend the existing group-trips cluster the same way `group_trip_gear_claims` does — a child table anchored on `trip_id` + `user_id`, guarded by the existing `is_trip_host()` function.

**Status:** Implementation spec. Written 2026-07-22, reconciled with approval-review.md 2026-07-23.
**Sources:** `SPEC.md` §7, and workbench features `g-storage`, `g-retention`, `onb-req`, `trav-file`, `detail-pages` in `docs/operator-trips-workbench.html`.
**Scope:** passport, insurance, visa, flight tickets. Files only.

---

## 1. Summary

Travelers on an operator trip upload documents. These are the most sensitive files Swellyo will ever hold. The design:

- Files live in a **new private Supabase Storage bucket**, guarded by RLS.
- Only two people can read a file: the traveler who uploaded it, and that trip's host (the operator).
- Reads use a **signed URL of about 60 seconds**, minted fresh per view.
- The **file is deleted within 30 days after the trip ends**. The typed fields — full name as printed, nationality, expiry date — stay on the document row.
- The operator can **export the real file**. Their copy is theirs and outlives ours.
- Documents **never** enter the image or video processing pipeline.

**Medical data is not in this spec.** Allergies, injuries, dietary needs and medication are table rows, not files. That is an RLS problem on a normal table, not a bucket problem. Medical has no export and must never become a file. Keep the two tracks separate.

---

## 2. Why Supabase Storage and not S3

Swellyo runs both. So this needs an answer.

**1. The access rule is a policy here, and hand-written code there.** The rule is "only the traveler and that trip's host". In Postgres that is one RLS policy on `storage.objects`, and it can reuse the existing `is_trip_host()` function that already gates the six other group-trip child tables. On S3 there is no notion of a Swellyo user, so the check must be re-implemented by hand inside an edge function that mints presigned URLs. Verified in `supabase/functions/image-upload-s3/index.ts`: every authorization decision there is a hand-written `if` (conversation-membership lookups at lines 93-99, 116-122, 139-145). That works, but it puts the most sensitive files in the one place where authorization is custom code.

**2. S3 was adopted for egress, and documents have no egress.** S3 cut bandwidth cost on images and video at volume. Documents are roughly 15 travelers × 4 files per trip, viewed a handful of times.

### Never the existing `swellyo-images` bucket

`swellyo-images` is **public-read**. Verified: `image-upload-s3/index.ts` returns a plain `publicUrl` of the form `https://swellyo-images.s3.us-east-1.amazonaws.com/<key>` with no signature (lines 81, 103, 158), and `storageService.ts` writes that URL straight to the database. Anyone with the link gets the file.

Reusing `uploadImageToS3` would be the natural shortcut for a passport upload. It would publish passports to the open internet. **New bucket. No public read. Ever.**

### Signed URLs must be short

Every S3 edge function in this repo defaults to `expiresIn: 3600` — verified in `image-upload-s3/aws.ts:38`, `generate-thumbnail-s3/aws.ts:38`, `process-profile-video-s3/index.ts:43`, `health-check/aws.ts:37`. One hour is fine for a trip photo. A signed URL is a bearer token: whoever holds the link has the file until it expires, logged in or not. Documents use **60 seconds**, minted per view. (Related known bug, not fixed here: DM videos are presigned for 7 days.)

---

## 3. Bucket layout and object key scheme

One bucket: **`group-trip-documents`**. Private.

```
<trip_id>/<user_id>/<document_id>.<ext>
```

- Every segment is a UUID. The traveler's filename never touches the key — the same discipline `image-upload-s3` already uses for chat files.
- `trip_id` and `user_id` come first because the RLS policy needs them, and `storage.foldername()` gives them cheaply. This mirrors `group_trip_gear_claims`, which anchors on `trip_id` + `user_id`.
- `document_id` is the primary key of the metadata row. One row = one object, created together, deleted together.
- Allowed extensions: `jpg`, `jpeg`, `png`, `heic`, `pdf`. Nothing else.
- Objects are never overwritten. Replacing a document means a new `document_id`, a new object, and deleting the old pair.

Metadata row (sketch; full shape belongs to the operator-trips schema spec):

```
group_trip_documents
  id              uuid pk        -- also the filename
  trip_id         uuid not null references group_trips(id)
  user_id         uuid not null references auth.users(id)
  requirement_id  uuid not null references group_trip_requirements(id)
                                 -- one live document per (trip_id, user_id, requirement_id),
                                 -- unique index — matches approval-review.md
  storage_path    text not null  -- exactly the key above
  mime_type       text not null
  byte_size       int  not null
  uploaded_at     timestamptz not null default now()
  -- typed fields that survive the file (passport only; nullable otherwise):
  full_name       text           -- full name as printed
  nationality     text
  expiry_date     date
  file_deleted_at timestamptz    -- set by the purge job once the object is gone
```

There is no `doc_type` column — the requirement the row points at already knows its kind. There is no review-state column either: the canonical review fields are `approved_at` / `approved_by`, added by `approval-review.md`, and a reject deletes the row entirely (the audit table `group_trip_document_reviews` keeps who / when / why).

**This row is also the single source of truth for the upload requirement's state — there is no separate state table (decided 2026-07-23). See `requirements-model.md`.** No row = open, row with `approved_at` null = submitted, `approved_at` set = approved.

The typed fields (full name as printed, nationality, expiry date) stay on this row. That is deliberate: the purge job removes only the storage object and sets `file_deleted_at` — the row itself is kept, so the fields survive the file. A repeat traveler gets them pre-filled and only retakes the photo.

---

## 4. RLS policies — SQL

Migrations here are applied **by hand in the Supabase SQL editor**. This is runnable as-is.

The operator check reuses the existing `is_trip_host(uuid)` function (defined in `20260708000000_group_trip_multiple_hosts.sql`, already granted to `authenticated`). We **call** it; we never modify it.

### 4.1 Bucket

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('group-trip-documents', 'group-trip-documents', false, 15728640,
        array['image/jpeg','image/png','image/heic','application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
```

`public = false` is the whole point. Never flip it.

### 4.2 Access predicate

One `SECURITY DEFINER` helper, so the logic is written once. It derives `trip_id` and `user_id` from the object path and applies the same rule as `group_trip_gear_claims`: the owner (`user_id = auth.uid()`) or a host (`is_trip_host(trip_id)`). `search_path` is pinned, as every function in this project is.

```sql
create or replace function public.can_access_group_document(object_path text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select object_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/'
     and (
       ((storage.foldername(object_path))[2])::uuid = auth.uid()
       or public.is_trip_host(((storage.foldername(object_path))[1])::uuid)
     );
$$;

-- Called from inside a storage policy, so it runs as the caller's role.
revoke execute on function public.can_access_group_document(text) from public, anon;
grant  execute on function public.can_access_group_document(text) to authenticated;
```

The regex guard matters: without it a malformed path makes the `::uuid` cast raise instead of returning false. Note the repo rule — `DROP` + `CREATE` re-adds the `PUBLIC` grant, so re-run the `REVOKE` after any recreate. **Do not touch `is_trip_host()` — only call it.**

### 4.3 Policies on `storage.objects`

```sql
-- INSERT: only the traveler, only into their own folder.
create policy "group docs: traveler uploads own"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'group-trip-documents'
  and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|heic|pdf)$'
  and ((storage.foldername(name))[2])::uuid = auth.uid()
);

-- SELECT: traveler or that trip's host. This also gates createSignedUrl —
-- Supabase checks SELECT before it will sign.
create policy "group docs: traveler or host reads"
on storage.objects for select to authenticated
using (bucket_id = 'group-trip-documents'
       and public.can_access_group_document(name));

-- DELETE: traveler removes their own, host does delete + reclaim.
create policy "group docs: traveler or host deletes"
on storage.objects for delete to authenticated
using (bucket_id = 'group-trip-documents'
       and public.can_access_group_document(name));

-- No UPDATE policy on purpose. Objects are immutable. Replace = delete + new id.
```

There is deliberately no policy for `anon`. An unauthenticated caller matches nothing. The purge job uses the service role, which bypasses RLS — that is the only privileged path.

### 4.4 Metadata table

```sql
alter table public.group_trip_documents enable row level security;

create policy "group doc rows: traveler or host reads"
on public.group_trip_documents for select to authenticated
using (auth.uid() = user_id or public.is_trip_host(trip_id));

create policy "group doc rows: traveler inserts own"
on public.group_trip_documents for insert to authenticated
with check (auth.uid() = user_id);
```

These mirror the `group_trip_gear_claims` policies line-for-line. Operator review (setting `approved_at` / `approved_by`, and the reject that deletes the row) goes through the RPCs in `approval-review.md`, not here.

### 4.5 Verify after applying

```sql
select id, public from storage.buckets where id = 'group-trip-documents';
-- expect public = false

select policyname, roles, cmd from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and (qual ilike '%group-trip-documents%' or with_check ilike '%group-trip-documents%');
-- expect: 3 policies, roles = {authenticated}, no anon
```

---

## 5. Upload flow

Client → Storage → row. No edge function. No service role.

1. Traveler taps a requirement (passport / insurance / visa / flights).
2. **The disclosure in §9 is shown and acknowledged before the picker opens.** Not after.
3. Picker returns a file. Client validates locally: extension in the allowlist, size under 15 MB, MIME matches the extension.
4. Client generates `document_id = uuid()` and builds `<trip_id>/<user_id>/<document_id>.<ext>` (its own `auth.uid()` as `user_id`).
5. Client uploads with the user's own JWT:
   ```ts
   await supabase.storage
     .from('group-trip-documents')
     .upload(key, body, { contentType, upsert: false, cacheControl: '0' });
   ```
   RLS decides whether this is allowed. A caller writing into someone else's folder fails at the database — there is no code path to get wrong. `cacheControl: '0'` matters, see §8.
6. On success, client inserts the row in `group_trip_documents` with `storage_path = key` and the `requirement_id` of the requirement the traveler tapped in step 1.
7. For a passport, the client also collects the typed fields and writes them onto the same `group_trip_documents` row (`full_name`, `nationality`, `expiry_date`). **These are what survive deletion.**
8. If step 6 fails after step 5 succeeded, the client deletes the object it just wrote. If that cleanup also fails, the orphan sweep in §8.1 catches it.

**Deliberately absent:** no thumbnail generation, no `generate-thumbnails` call, no Lambda, no MediaConvert, no compression that creates a second copy. That pipeline writes derivatives to other prefixes on its own schedule, producing untracked copies that no retention rule covers.

Implementer note: `uploadImageToS3` in `storageService.ts` fires `generate-thumbnails` automatically (lines 180-184). **Do not route documents through it.** Documents get their own service.

---

## 6. View flow

A signed URL is minted **per view**, valid **60 seconds**, by the **client**, with the **viewer's own JWT**.

```ts
const { data, error } = await supabase.storage
  .from('group-trip-documents')
  .createSignedUrl(storagePath, 60);
```

`createSignedUrl` runs the SELECT policy from §4.3 against the caller's JWT before signing. A traveler from another trip gets an error, not a URL. The authorization is the policy — exactly the property we picked Supabase Storage for. No service role key appears anywhere in the read path.

Rules:

- **Never persist a signed URL.** Not in state that outlives the screen, not in the query cache, not in AsyncStorage, not in a database column, not in a log line.
- Mint on open. If the viewer is still there after ~50 seconds and the file is still loading, mint again.
- Prefer showing the file in-app over handing it to an external viewer. "View" and "export" stay two different actions.

**OPEN — needs Eyal & Ohad:** whether views and downloads are logged. If yes, this stops being a bare client call and becomes a thin edge function that logs, then signs. See §12.

---

## 7. Export flow

Export gives the operator **the real file**, not a summary sheet. Settled 22 July: operators genuinely have to send a passport to a hotel or a visa agent, and pretending otherwise pushes them back to WhatsApp.

- Available on the per-traveler page and on each dashboard detail page (`trav-file`, `detail-pages`).
- Mechanically identical to §6: mint a 60-second signed URL with the operator's own JWT, then download. No separate privileged endpoint.
- Bulk export = one short URL per file, minted on demand, sequentially. Never pre-mint a batch and hold them.
- Medical has **no export**.

**Accepted consequence:** once the operator downloads a passport, that copy is theirs and outlives our 30-day deletion. Retention bounds Swellyo's storage, not the traveler's data. That is why the disclosure in §9 must mention export, and why the operator agreement needs a data-protection clause (open on `onb-req`, owner: Eyal).

---

## 8. Retention and deletion

**The rule:** the file is deleted **within 30 days after the trip ends**. The typed fields stay on the document row. Someone who leaves or is removed follows the **same 30-day clock**. No special case.

Application code alone is not enough. It does not run when nobody opens the app, and it does not know about copies the storage layer made on its own.

### 8.1 The lifecycle rule and the scheduled job

Supabase Storage does not expose an S3-style bucket lifecycle configuration, so the scheduled job **is** the lifecycle rule and must be written like one: idempotent, driven by the trip's end date, safe to re-run. **OPEN — needs Eyal & Ohad:** confirm with Supabase whether any bucket-level TTL exists that could act as a second, independent backstop. Do not assume one exists.

New edge function `purge-group-documents`, service role, run daily by `pg_cron` — same shape as the existing crons (`supabase/migrations/20260610000100_schedule_trip_reminders.sql`). What it does:

1. Select due documents, batched so one bad day cannot time out:
   ```sql
   select d.id, d.storage_path
   from group_trip_documents d
   join group_trips t on t.id = d.trip_id
   where d.file_deleted_at is null
     and t.end_date < (now() - interval '30 days')
   limit 500;
   ```
2. `storage.from('group-trip-documents').remove([...paths])`.
3. Confirm the object is gone (`list` on the prefix), and only then set `file_deleted_at = now()`.
4. **Orphan sweep** in the same run: list objects and delete any whose `document_id` has no live row. Catches failed step-6 inserts and partial deletes.
5. Log counts only — deleted, failed. **Never log a path or a URL.**

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'purge-group-documents-daily') then
    perform cron.unschedule('purge-group-documents-daily');
  end if;
end $$;

select cron.schedule(
  'purge-group-documents-daily',
  '20 3 * * *',
  $$
  select net.http_post(
    url := 'https://rfdhtvcmagsbxqntnepv.supabase.co/functions/v1/purge-group-documents',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <anon key — copy verbatim from 20260610000100_schedule_trip_reminders.sql>',
      'x-internal-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'admin_function_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
```

Application code still deletes immediately where it can — the operator's "delete + reclaim", and a traveler replacing a document. The job is the floor, not the only path.

### 8.2 The three things that quietly keep a file alive

A file is not gone when the delete call returns 200.

**1. Object versioning turns a delete into a delete marker.** If the S3 bucket underneath Supabase Storage has versioning on, `remove()` writes a delete marker and the bytes stay. The object becomes unreachable through the API but still exists. We do not control that bucket. **OPEN — needs Eyal & Ohad:** ask Supabase whether the storage backend for this project has versioning enabled and whether old versions are retained. Until that is answered we can only claim the file is unreachable, not destroyed.

**2. Backups and PITR keep copies inside the retention window.** PITR and daily backups cover `storage.objects` and our metadata tables. A restore inside the window brings deleted rows back, and that window is the real floor on how fast anything can truly disappear. **OPEN — needs Eyal & Ohad:** what the actual PITR / backup retention window is on this project. It has to be reconciled with the promise we make travelers. Add to the restore runbook: after any restore, re-run the purge job immediately.

**3. CDN caching serves a file after the origin deleted it.** Supabase Storage sits behind a CDN and a cached response can outlive the object. What we control and must do: upload with `cacheControl: '0'` (§5), keep the bucket private so every read goes through a signature that dies in 60 seconds, and never assume invalidation happens on our schedule.

**A fourth, honest one:** copies that already left — the operator's export (§7), a device download cache, an OS document viewer cache. We cannot delete those. That is exactly why §9 says so.

### 8.3 The promise

Because of all three, the traveler-facing wording is **"within 30 days"** — never "on day 30", never "immediately". We can promise deletion starts on a fixed schedule and the file becomes unreachable. We cannot promise the byte-level moment.

---

## 9. What the traveler is told before they upload

Shown **before the file picker opens**, on first upload for a trip, and acknowledged. Also reachable later from the trip's Plan screen.

> **About your documents**
>
> Your passport, insurance, visa and flight documents are stored privately. Only you and the operator of this trip can open them.
>
> **The operator can download a copy.** They need to — hotels and visa agents ask for these. Once they download it, that copy is theirs and it is outside Swellyo. Their own privacy rules apply to it, not ours.
>
> **We delete your file within 30 days after the trip ends.** That happens automatically. It also happens if you leave the trip or are removed.
>
> We keep a few typed details after that: your full name as printed, your nationality, and your passport expiry date. We keep those so you do not have to type them again next time, and so we can warn you if your passport expires before a trip. The photo itself is deleted.
>
> You can delete a document yourself at any time.

Notes for whoever builds this screen:

- "within 30 days" — not "on day 30", not "after 30 days". See §8.3.
- The export sentence is not optional. Saying only "we delete after 30 days" while the operator walks away with a copy would be misleading. This is the open item on `onb-req`; the text above is the draft answer and **still needs Eyal & Ohad's sign-off**.
- Do not soften "that copy is theirs and it is outside Swellyo". That sentence is the honest part.

---

## 10. Security checklist

Each line is a build gate.

- [ ] **No public read.** Bucket `public = false` (query in §4.5). `getPublicUrl` is never called on it. No document is ever written to `swellyo-images`, `message-images`, `profile-images`, or any other existing bucket.
- [ ] **Short URLs.** 60 seconds, minted per view. No `3600` anywhere in the document code path.
- [ ] **No URL leakage.** Signed URLs are never persisted (no DB column, query cache, AsyncStorage) and never logged — no `console.log` of a path or URL, client or edge function.
- [ ] **Sentry.** Verified today: `App.tsx` sets `sendDefaultPii: false` and `replaysOnErrorSampleRate: 1`, and has **no `beforeSend` or `beforeBreadcrumb` scrub hook**. Mobile replay is on in native builds, so a document on screen during an error is capturable. **OPEN — needs Eyal & Ohad:** add a scrub hook and/or mask document screens from replay.
- [ ] **PostHog.** `posthogService.ts` initialises with `enableSessionReplay: true` — same exposure. No path or URL may be sent as an event property. **OPEN — needs Eyal & Ohad.**
- [ ] **No pipeline.** No `generate-thumbnails`, no Lambda, no MediaConvert, no derivative in another prefix.
- [ ] **Least privilege.** `can_access_group_document` has `search_path` pinned and `EXECUTE` revoked from `anon` and `public`. `is_trip_host()` is only called, never modified. The service role key is used in exactly one place — the purge edge function — and never on the client.
- [ ] **Deletion actually runs.** Purge job scheduled, failures visible where the other crons report, and the restore runbook says: after any PITR restore, re-run it.
- [ ] **Access logging: OPEN — needs Eyal & Ohad.** See §12.

---

## 11. Files to create or change

**Create**

- `supabase/migrations/<ts>_group_trip_documents_bucket.sql` — §4.1-§4.4. Applied by hand in the SQL editor.
- `supabase/migrations/<ts>_schedule_purge_group_documents.sql` — §8.1 cron.
- `supabase/functions/purge-group-documents/index.ts` — purge + orphan sweep. Service role, requires `x-internal-secret` like the other admin functions. Deploy via CLI (`--use-api`); diff the live version first if one exists.
- `src/services/operator/documentsService.ts` — upload, mint-signed-url, delete, list. The **only** module that knows the bucket name.
- `src/components/operator/DocumentDisclosureSheet.tsx` — the §9 text, gating the picker.

**Change**

- `supabase/functions/health-check/checks/storage.ts` — add `group-trip-documents` to `REQUIRED_BUCKETS` and assert `public = false` on it. The existing check already exercises a 60-second signed URL, which is the right pattern.
- `App.tsx` and `src/services/analytics/posthogService.ts` — scrubbing, **if** §12 item 1 is decided that way.

**Do not change:** `src/services/storage/storageService.ts` (documents do not go through `uploadImageToS3`), `src/services/media/imageService.ts`, `supabase/functions/image-upload-s3/` (do not add a document action to it), and `is_trip_host()` / `20260708000000_group_trip_multiple_hosts.sql` (call it, never edit it).

---

## 12. Open questions

Do not invent answers to these.

1. **Are document URLs and paths scrubbed from Sentry and PostHog?** — **OPEN — needs Eyal & Ohad.** Both SDKs are wired in, both have session replay enabled, and no scrubbing hook exists today (verified in `App.tsx` and `posthogService.ts`). A signed document URL in a breadcrumb or an event property is a working link to a passport for as long as it is valid. Short expiry is half the mitigation; not logging the URL is the other half.
2. **Are downloads logged?** — **OPEN — needs Eyal & Ohad.** Flagged on `trav-file`. A record of who took what and when is cheap, and it is the only visibility we have after the file leaves. If yes, §6 and §7 change from a bare client `createSignedUrl` to a thin logging edge function. Decide before building.
3. **What is the actual PITR / backup retention window?** — **OPEN — needs Eyal & Ohad.** It sets the real floor under the 30-day promise.
4. **Does the storage backend have object versioning enabled?** — **OPEN — needs Eyal & Ohad / Supabase support.** If yes, our delete produces a delete marker and we must say "unreachable", not "destroyed".
5. **Is there any Supabase bucket-level TTL to use as an independent backstop?** — **OPEN — needs Eyal & Ohad.** See §8.1.
6. **Sign-off on the §9 disclosure text.** — **OPEN — needs Eyal & Ohad.** Flagged on `onb-req`.
7. **Operator agreement data-protection clause.** — **OPEN — needs Eyal.** Once an operator downloads a passport they hold it independently of us. Out of scope here, but it is the legal half of §7.
