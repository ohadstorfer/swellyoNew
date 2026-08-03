# Passport upload v1 — image only, no text extraction

**Status:** Implementation spec. Written 2026-07-29.
**Scope:** A traveler on a group trip uploads a photo of their passport. The trip's host can view it. Nobody else can. The file is deleted 30 days after the trip ends.
**Explicitly out of scope:** reading any text off the image. That is v2 — see §13.
**Sources:** decisions with Ohad 2026-07-29. Extends `documents-storage.md` (applied to prod 2026-07-24), which owns the bucket, the access rules and the retention promise. This spec does not change any of them.

---

## 1. Summary

The operator books flights for the group, so they need what is printed in the passport. In v1 they get it the simple way: **they open the image and read it with their eyes.** No OCR, no typed fields, no encryption keys.

That makes v1 almost entirely client work. The storage, the access rules and the metadata table already exist on production. What is missing is three screens and one deployed cron job.

Five rules, none of them new:

- The file lives in the existing **private** `group-trip-documents` bucket.
- Exactly two kinds of people can read it: **the traveler who uploaded it**, and **a host of that trip**.
- Reads use a **60-second signed URL**, minted per view, never stored anywhere.
- The file is **deleted 30 days after the trip ends**.
- The image **never** enters the thumbnail or video pipeline.

---

## 2. What already exists — do not rebuild

Verified in the repo 2026-07-29.

| Piece | Where | State |
| --- | --- | --- |
| Private bucket, 15 MB cap, image + PDF mime allowlist | `20260724000300_operator_documents_bucket.sql` | **Applied to prod** |
| Storage policies: traveler writes own folder, owner-or-host reads, owner-or-host deletes, no UPDATE, no `anon` | same file | **Applied to prod** |
| `can_access_group_document(path)` — the one access predicate | same file | **Applied to prod** |
| `organized_trip_travelers_documents` metadata table + RLS | `20260724000200_operator_evidence_tables.sql` | **Applied to prod** |
| One-live-document index `uq_gtd_trip_user_requirement` | same file | **Applied to prod** |
| Requirement rows, `kind='passport'`, `req_type='upload'` | `20260724000100_operator_requirements.sql` | **Applied to prod** |
| Traveler's checklist state, derived | `organized_trip_requirements_resolved` + reads in `…000400` | **Applied to prod** |
| `operator_approve_documents()` / `operator_reject_document()` | `…000400` | **Applied to prod** |
| `purge-group-documents` edge function + daily cron 03:20 UTC | `supabase/functions/purge-group-documents/`, `20260729000100_…sql` | **DEPLOYED + APPLIED 2026-07-29** |
| Passport-requires-operator-trip trigger | `20260729000200_…sql` | **APPLIED 2026-07-29** |
| Image compression + JPEG re-encode | `src/utils/imageCompression.ts` → `compressImage()` | Exists, reuse it |

**v1 needs no new database objects.** The APIS-fields migration (`20260729000000_passport_apis_fields.sql`) and the `group-document-passport` edge function belong to v2. Both are written but deliberately **NOT applied / NOT deployed** — v1 writes none of those columns, and prod stays matched to what ships.

### ⚠️ The table rename trap

`20260724000700` renamed the evidence tables to `organized_trip_*`, but **only the tables**. Anything created before the rename kept its old identifier, so on production right now:

| Thing | Live name |
| --- | --- |
| documents table | `organized_trip_travelers_documents` |
| requirements table | `organized_trip_requirements` |
| resolved view | `organized_trip_requirements_resolved` |
| storage bucket | `group-trip-documents` ← **not renamed** |
| access predicate | `can_access_group_document()` ← **not renamed** |
| RLS policies on the documents table | `otd_select` / `otd_insert` / `otd_delete` |
| FK constraints on that table | still `group_trip_documents_*_fkey` |
| acknowledgements table | `group_trip_acknowledgements` ← **deliberately not renamed** |

The mismatch is real and permanent. Read names off the database, never off the older migration files — a first pass at this feature was written against `group_trip_documents` and failed on apply with `42P01 relation does not exist`.

---

## 3. What v1 deliberately does not do

Writing these down so nobody "fixes" them later by accident.

- **No text extraction.** No OCR, no MRZ parsing, no AI vision.
- **No typed fields.** `surname`, `given_names`, `date_of_birth`, `sex`, `nationality`, `issuing_country`, `expiry_date`, `passport_number_enc` all stay `NULL`. No `DOCUMENT_ENCRYPTION_KEY` is needed for v1.
- **No expiry warning.** It needs a date we are not collecting yet.
- **No access log.** Decided 2026-07-29: the access rules are the only gate. If a passport leaks there is no record of who opened it.
- **No thumbnails, no compression pipeline on the server, no Lambda, no MediaConvert.** That pipeline writes copies to other prefixes on its own schedule, and no retention rule covers those copies.
- **No PDF for the passport requirement.** The bucket allows PDFs because insurance and visa documents need them. A passport is a photo. Restricting v1 to images keeps the viewer simple.
- **No export button.** The operator can screenshot or long-press-save; we are not building a feature that hands them a file. Their copy outliving ours is a known accepted consequence (`documents-storage.md` §7), but v1 does not make it one tap.

---

## 4. The flow, screen by screen

### 4.0 Operator trips only — `hosting_style = 'C'`

**Decided 2026-07-29.** A passport requirement may exist only on an operator trip.

The reason is `is_trip_host()`: it returns true for any participant with `role = 'host'`. On an operator trip that host is a business, with an agreement and a data-protection clause. On a peer group trip it is another surfer. "One surfer can open another surfer's passport" is not a thing we want to have to defend.

Enforced in **three** places, deliberately:

| Layer | What it does |
| --- | --- |
| DB trigger `trg_passport_requires_operator_trip` | Refuses to insert or update a `kind='passport'` requirement when the trip's `hosting_style` is not `'C'`. Migration `20260729000200`. |
| Client — requirement authoring | The passport option is not offered when building a non-C trip. |
| Client — traveler checklist | Nothing to hide: with no requirement row there is no checklist row and no upload path. |

The trigger is the one that matters. A passport document row must point at a requirement through a foreign key, so if the requirement cannot exist, neither can the document — and that closes the path without touching any storage policy.

A `CHECK` constraint cannot express this, because it may not read another table. Hence a trigger.

### 4.1 Traveler — the checklist row

Where the traveler already sees trip requirements, a `kind='passport'` row shows one of:

| State | Row shows | Tap does |
| --- | --- | --- |
| `not_started` | "Passport — needed" | opens the upload sheet |
| `submitted` | "Passport — waiting for review" | opens the viewer (own file) |
| `approved` | "Passport — approved" | opens the viewer |
| `rejected` | "Passport — needs a new photo" + the operator's note | opens the upload sheet |
| `overdue` | same as `not_started`, marked late | opens the upload sheet |

State comes from `organized_trip_requirements_resolved` and the existing derived read. Do not add a state column.

### 4.2 Traveler — the upload sheet

Uses `BottomSheetShell` (project rule: every sheet does).

Contents, top to bottom:

1. Title: **"Add your passport"**
2. One line of purpose: *"Your trip organiser needs it to book your flights."*
3. The disclosure block from §9. Not collapsed, not behind a link.
4. Two buttons: **Take a photo** and **Choose from photos**.
5. A cancel affordance.

### 4.3 Traveler — confirm before upload

After picking, show the image full-screen with **Use this photo** / **Retake**.

The check is human: *"Can you read the two lines at the bottom?"* Put that sentence on screen. It is the cheapest possible quality gate, it costs one line of copy, and it is what makes the operator's job possible in v1. It also happens to be exactly what v2's scanner will need.

Nothing uploads until they confirm.

### 4.4 Upload

See §5 for the image rules. On success the sheet closes and the checklist row moves to `submitted`.

On failure: keep the sheet open, keep the picked image, show a retry. Never silently drop it.

### 4.5 Host — the review list

A list of travelers with a passport requirement, grouped by state. Reuse whatever `organized_trip_document_counts()` already feeds. Each row opens the viewer with **Approve** / **Reject** at the bottom.

Reject asks for an optional note, calls `operator_reject_document()`, **and then the client must delete the storage object** — the host has the DELETE policy. If that delete fails the row is left `rejected_at` set with `file_deleted_at` null, which is exactly the condition the purge job sweeps, so nothing leaks. Log the failure, do not block the UI.

### 4.6 The viewer

One component, used by both the traveler and the host.

- Full screen, dark background.
- **Pinch and pan to zoom.** Not optional. The operator is reading a passport number off a phone screen.
- The image, and nothing else: no share button, no save button, no "open in", no long-press menu.
- A close button.
- For the host only: Approve / Reject.

---

## 5. Image handling rules

This is where v1 can quietly go wrong. Six rules.

### 5.1 Re-encode to JPEG on the device, always

Call the existing `compressImage(uri, { maxDimension: 2200, quality: 0.85 })` from `src/utils/imageCompression.ts`. It always writes `SaveFormat.JPEG`, so one call does three jobs:

- **HEIC becomes JPEG.** iPhones shoot HEIC by default. A HEIC file in the bucket is a file the host may not be able to display.
- **Size comes down** under the bucket's 15 MB cap.
- **EXIF is dropped** as a side effect of re-encoding — see 5.2.

Object key stays `<trip_id>/<user_id>/<document_id>.jpg`, which is what the storage policy's regex already expects.

### 5.2 The photo carries the traveler's home address — strip it

A passport gets photographed at home, on the kitchen table. That photo has GPS coordinates in its EXIF. Uploading it as-is hands the operator the traveler's home location, silently, forever.

Re-encoding through `manipulateAsync` does not carry EXIF across. **Verify this once on a real device** — pull an uploaded object back down and check it has no GPS block. Do not take it on trust; it is one check and the failure mode is invisible.

### 5.3 Do not let the capture reach the photo library

A passport photo in the camera roll is a passport photo in iCloud, in Google Photos, and in every app the traveler ever grants photo access to. It also outlives our 30-day deletion by years.

There is **no option** to switch this off — checked `ImagePickerOptions` in `expo-image-picker@17`, there is no such field. What is true instead:

- `launchCameraAsync` writes the capture to the app's own cache directory. It does not add it to the user's library on its own.
- So the rule is a *don't*: **never call `MediaLibrary.saveToLibraryAsync`** (or anything like it) on this path. There is nothing to disable — only something not to add.
- **Delete the temp file** once the upload succeeds, and also when the traveler cancels out of the confirm screen.
- Leave `exif` at its default `false` so we never even read the metadata into JS.

Because this rests on library behaviour rather than a flag we set, the camera-roll check in §10 is a real test, not a formality. Run it on both platforms.

### 5.4 Do not disk-cache the image on view

`expo-image` caches to disk by default. That would leave a plain, unencrypted copy of the passport in the app's cache directory, outliving the 60-second URL, outliving the 30-day purge, and surviving logout.

Set `cachePolicy="memory"` (or `"none"`) on the viewer's `<Image>`. Only there — do not change the global default and slow the rest of the app down.

### 5.5 Resolution is a v2 dependency

`maxDimension: 2200` is chosen so the two machine-readable lines stay legible. v1 only needs a human to read them, but v2's scanner will read the same files. Compressing harder now means v2 fails on every passport uploaded before it shipped.

If anyone wants to lower it, that is a v2 conversation, not a file-size one.

### 5.6 Keep it out of analytics

Mask the upload sheet, the confirm screen and the viewer from PostHog capture. Never log the object path, the signed URL, or the picked file URI — client or edge function.

---

## 6. What gets written

One row in `organized_trip_travelers_documents`:

| Column | v1 value |
| --- | --- |
| `trip_id`, `user_id`, `requirement_id` | the obvious ones |
| `storage_path` | `<trip_id>/<user_id>/<document_id>.jpg` |
| `mime_type` | `image/jpeg`, always |
| `byte_size` | after compression |
| `uploaded_at` | `now()` |
| everything else | `NULL` |

The client generates the `document_id` UUID **before** uploading, because the object key contains it. Insert the row **after** the object lands — a row pointing at a file that failed to upload shows the traveler a broken "submitted" state, while a file with no row is invisible and gets swept by the orphan pass.

`uq_gtd_trip_user_requirement` means one live document per traveler per requirement. A re-upload replaces the row: delete the old object, delete the old row, insert the new one. **A re-upload must clear `rejected_at`** — the purge job treats a rejected row with a live file as an orphan, and only a newer `uploaded_at` protects a fresh file from being swept.

---

## 7. Viewing — the exact call

```ts
const { data } = await supabase.storage
  .from('group-trip-documents')
  .createSignedUrl(storagePath, 60);
```

That is the whole read path. `createSignedUrl` is gated by the bucket's SELECT policy, so RLS decides who gets a URL — the client does not need to check anything itself.

**Never persist what comes back.** Not in the react-query cache, not in component state that outlives the screen, not in AsyncStorage, not in a database column, not in a log line. A signed URL is a bearer token: whoever holds it has the file until it expires, logged in or not.

If the viewer is open longer than 60 seconds and the image needs reloading, mint a new URL. Do not extend the expiry.

---

## 8. Retention

Unchanged from `documents-storage.md` §8. Nothing in v1 is allowed to weaken it.

**Done 2026-07-29.** The function is deployed and the cron is scheduled at `20 3 * * *`, and the whole chain was smoke-tested through the path the cron actually uses — Vault secret, gateway with `verify_jwt=false`, function auth, queries — returning `200 {"deleted":0,"failed":0}`. Safe to run at the time because prod held zero documents and zero objects.

This was the one thing that had to be true before any passport could be uploaded. It is true now.

Still open, and it needs a person: **after any point-in-time restore, run the purge once by hand.** A restore inside the retention window brings deleted files and rows back.

---

## 9. What the traveler is told, before they pick a file

Shown in the upload sheet. Not collapsed, not behind a "learn more".

> **Who sees this:** only you and your trip organiser.
> **Why:** so they can book your flights and organise the trip.
> **How long we keep it:** we delete your file within 30 days after the trip ends. That happens automatically. It also happens if you leave the trip or are removed.
> **One thing to know:** your organiser can save a copy to do the booking. That copy is theirs, and our deletion does not reach it.

Wording rules: "within 30 days" — never "on day 30", never "after 30 days". The last line is not optional; saying only "we delete after 30 days" while the operator walks away with a copy would be misleading.

---

## 10. Acceptance criteria

- [ ] A traveler can photograph or pick a passport image and see it as `submitted`.
- [ ] The object lands at `<trip_id>/<user_id>/<document_id>.jpg` and is `image/jpeg` even when the source was HEIC.
- [ ] A downloaded copy of the uploaded object has **no GPS EXIF**.
- [ ] The captured photo does **not** appear in the device camera roll — checked on **both** iOS and Android (§5.3 relies on library behaviour, not a flag).
- [ ] Inserting a `kind='passport'` requirement on a trip with `hosting_style` of `'A'` or `'B'` **fails** with the trigger's error (§4.0).
- [ ] A second traveler on the same trip cannot read the first traveler's file — direct `createSignedUrl` on the path returns an error, not a URL.
- [ ] A host of the trip can read it. A participant who is not a host cannot.
- [ ] A logged-out request for the path gets nothing.
- [ ] The signed URL stops working about a minute after it is minted.
- [ ] Approve moves the row to `approved`; reject deletes the object, keeps the row, and shows the note to the traveler.
- [ ] A re-upload after a reject clears `rejected_at` and the new file survives a purge run.
- [ ] Nothing in the app writes the signed URL or the object path to a log.
- [ ] No file appears anywhere in the `swellyo-images` bucket or any thumbnail prefix.
- [ ] `purge-group-documents` runs on the cron and deletes a document from a trip that ended 31 days ago.

Testing note: verification is by code reading, `tsc`, and on-device checks by Ohad. There is no simulator or Maestro pass on this project.

---

## 11. Files — what was built

**Backend — DONE 2026-07-29 (deployed + applied to prod):**
- `supabase/functions/purge-group-documents/` — deployed with `--no-verify-jwt`. Smoke-tested through the cron's exact path (Vault secret → gateway → function): `200 {"deleted":0,"failed":0}`.
- `supabase/migrations/20260729000100_schedule_purge_group_documents.sql` — cron `purge-group-documents-daily` @ `20 3 * * *`.
- `supabase/migrations/20260729000200_passport_requires_operator_trip.sql` — trigger verified to block a passport requirement on an `'A'`/`'B'` trip and allow it on a `'C'` trip.

**Written but NOT applied (v2):**
- `supabase/migrations/20260729000000_passport_apis_fields.sql`
- `supabase/functions/group-document-passport/`

**New client files:**
- `src/services/trips/tripDocumentsService.ts` — fetch requirements, upload/replace, mint signed URL, delete, approve, reject.
- `src/components/trips/PassportUploadFlow.tsx` — disclosure sheet → OS picker → confirm → upload, in one component.
- `src/components/trips/DocumentViewer.tsx` — full-screen, pinch/pan/double-tap zoom, no share affordances, `cachePolicy="none"`.
- `TripDocumentsCard` in `src/components/trips/plan/PlanSections.tsx` — built from the same `ygBlock` / `ygCard` / `ygRow` pieces as `YourGearCard`, so the Plan tab reads as one design.

**Changed:**
- `src/hooks/trips/useTripQueries.ts` — added `tripsKeys.detailDocuments`.
- `src/hooks/trips/useTripDetail.ts` — added `useTripDocuments(tripId, isOperatorTrip)`, gated so peer trips never fire the request.
- `src/screens/trips/TripDetailScreen.tsx` — Plan tab section 4 (after Packing & Gear), plus the two modals.

**Reused unchanged:** `compressImage()`, `BottomSheetShell`, `TripIcon name="passport"`, `showErrorAlert`, `operator_trip_my_requirements()`, `operator_approve_documents()`, `operator_reject_document()`.

### Still to build
- **Host review screen.** `DocumentViewer` already accepts `onApprove` / `onReject`, and the service already wraps both RPCs — what is missing is the host-side list that feeds them. `TripDocumentsCard` has a `mode="host"` branch ready for it.
- **Requirement authoring.** There is no UI anywhere to create a requirement row, which means **the section is invisible until one exists.** To see it on a dev operator trip:

```sql
insert into public.organized_trip_requirements
  (trip_id, kind, req_type, skip_at_onboarding, title, help_text)
values
  ('<a hosting_style=C trip id>', 'passport', 'upload', 'must_have',
   'Passport', 'So your organiser can book your flights.');
```

Only on a trip whose members are all developers — group trips are live on production.

## 12. Security checklist

- [ ] Bucket `public = false`. Never flipped.
- [ ] No `anon` policy on any of the four storage policies.
- [ ] Signed URLs are 60 seconds, minted per view, never persisted, never logged.
- [ ] No public URL is ever constructed for this bucket.
- [ ] The image is not disk-cached by the viewer (§5.4).
- [ ] The capture is not written to the photo library (§5.3).
- [ ] EXIF, including GPS, is gone from the stored object (§5.2, verified on device).
- [ ] The service role key is used in exactly one place — the purge function — and never on the client.
- [ ] No document path reaches the thumbnail, Lambda or MediaConvert pipelines.
- [ ] PostHog does not capture the three passport screens.
- [ ] `can_access_group_document` keeps its pinned `search_path` and its `EXECUTE` revoked from `anon` and `public`.
- [ ] `enforce_passport_requires_operator_trip` has its `search_path` pinned and, being `SECURITY DEFINER`, its `EXECUTE` revoked from `public`, `anon` and `authenticated` — otherwise anon could call it over `/rest/v1/rpc/`.

---

## 13. Considered and left out of v1

**One typed field: expiry date.** Asking the traveler to type only the passport expiry date would unlock a genuinely useful warning — many countries require a passport valid for six months past the return date, and `expiry_date` already exists on the table with the purge deliberately preserving it. One field, real value.

Left out anyway, because v1's job is to prove upload → store → view → delete with nothing else moving. Worth revisiting the moment v1 is stable, and it does not need to wait for full extraction.

**Superseded 2026-08-03 — see `passport-copy-details.md`.** Extraction shipped, but not the way v2 imagined it: the phone reads the passport's code lines on demand and copies the fields to the clipboard, and **nothing is stored**. So the expiry date is now read for free, and the encryption key, the typed-field columns and the extra purge obligation are all still unnecessary. `20260729000000_passport_apis_fields.sql` and `group-document-passport` stay unapplied.

**The bigger question v2 raises:** if the phone extracts the fields, do we still need to keep the image at all? The operator books from text. Storing the photo is a v1 requirement precisely because there is no extraction — it is the only way the operator can read anything. Once v2 exists, the photo may become optional per trip, and a photo we never stored cannot leak.

---

## 14. Open questions

Both remaining questions were raised with Ohad on 2026-07-29 and explicitly **deprioritised — "I don't care"**. Recorded here because they do not stop the build, but they are the two things that would matter after an incident:

1. **PITR / backup window.** A point-in-time restore inside 30 days brings deleted files back, so that window is the real floor on how fast anything truly disappears. Until the number is known, the "within 30 days" promise in §9 is unverified. *Deprioritised 2026-07-29.*
2. **The operator agreement.** The operator saves a copy to do the booking — the designed flow, not an edge case — and our deletion does not reach their copy. Nothing contractually binds them on it. *Deprioritised 2026-07-29.*
*(The third open question — whether passports are restricted to operator trips — was decided on 2026-07-29. See §4.0.)*
