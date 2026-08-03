# Operator Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a desktop website where surf-trip operators review traveler documents and export files for one trip.

**Architecture:** A static React SPA. The browser talks to Supabase directly — there is no backend. Row Level Security decides what each operator can read, so no server-side permission code exists or is needed. Files are fetched through short-lived signed links from a private bucket.

**Tech Stack:** Vite · React 19 · TypeScript · React Router · TanStack Query · `@supabase/supabase-js` · Vitest · plain CSS with tokens · Netlify.

## Global Constraints

- **Add nothing to the database.** No migrations, no new tables, functions, or views. Every object read here is already live.
- Table names are `organized_trip_*`. The counts function is `organized_trip_document_counts` — the old `group_trip_document_counts` was **dropped**.
- `group_trip_acknowledgements` is deliberately **not** renamed. Do not "fix" it.
- An operator trip is `group_trips.hosting_style = 'C'`. A host is a `group_trip_participants` row with `role = 'host'`.
- In requirement-state derivation, `acknowledge` is checked **before** `medical`. This branch order is load-bearing and must match `operator_trip_my_requirements`.
- Never render a raw error string to the user. Always map through `friendlyError()`.
- Files are private. Every view/download mints a fresh signed URL. Never build a public URL.
- Money is out of scope — no ledger exists. Do not render a zero.
- Environment variables are `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. `.env` is never committed.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/supabase.ts` | The single Supabase client |
| `src/lib/errors.ts` | `friendlyError()` — error object → human sentence |
| `src/lib/format.ts` | Dates and small display helpers |
| `src/lib/auth.tsx` | `AuthProvider`, `useAuth()` — session, sign in, sign out |
| `src/domain/requirements.ts` | Types + `deriveState()`, ported from the app. Pure, no I/O |
| `src/domain/requirements.test.ts` | Tests for the branch order and overdue rules |
| `src/services/trips.ts` | Operator trips list + one trip |
| `src/services/review.ts` | The per-trip review matrix (all travelers × requirements) |
| `src/services/counts.ts` | Received/approved counts + medical flags |
| `src/services/files.ts` | Signed URLs, single download, download-all zip |
| `src/services/actions.ts` | Approve and reject |
| `src/routes/*.tsx` | One file per screen |
| `src/components/*.tsx` | Shared UI pieces |

Split by responsibility: everything that talks to Supabase lives in `services/`, everything that computes lives in `domain/`, and nothing in `routes/` does either directly.

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `netlify.toml`, `.env.example`, `src/main.tsx`, `src/App.tsx`

**Interfaces:**
- Produces: a dev server that boots and a `npm test` that runs.

- [ ] **Step 1: Scaffold and install**

```bash
cd /Users/ohadstorfer/operatorsDashboard
npm create vite@latest . -- --template react-ts
npm install @supabase/supabase-js @tanstack/react-query react-router-dom jszip
npm install -D vitest
```

- [ ] **Step 2: Add the test script to package.json**

```json
"scripts": { "dev": "vite", "build": "tsc -b && vite build", "test": "vitest run" }
```

- [ ] **Step 3: Verify it builds**

Run: `npm run build`
Expected: succeeds, `dist/` produced.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: scaffold vite react ts"
```

---

### Task 2: Requirement state derivation (the risky logic)

This is ported from `swellyoNative/src/services/trips/tripDocumentsService.ts`. Tests come first because the branch order is load-bearing.

**Files:**
- Create: `src/domain/requirements.ts`, `src/domain/requirements.test.ts`

**Interfaces:**
- Produces:
  - `type RequirementState = 'not_started' | 'submitted' | 'approved' | 'rejected' | 'overdue'`
  - `deriveState(req, evidence, todayISO): RequirementState`
  - `type Requirement = { id, kind, reqType, title, dueDate, sortOrder, skipAtOnboarding }`
  - `type Evidence = { doc?, ack?, medical?, currentWaiverId? }`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { deriveState } from './requirements'

const req = (o = {}) => ({ id: 'r1', kind: 'passport', reqType: 'upload', title: 'Passport',
  dueDate: null, sortOrder: 0, skipAtOnboarding: 'must_have', ...o })

describe('deriveState', () => {
  it('is not_started with no evidence', () => {
    expect(deriveState(req(), {}, '2026-08-02')).toBe('not_started')
  })
  it('is submitted when a document exists but is unapproved', () => {
    expect(deriveState(req(), { doc: { approvedAt: null, rejectedAt: null } }, '2026-08-02'))
      .toBe('submitted')
  })
  it('is approved when the document is approved', () => {
    expect(deriveState(req(), { doc: { approvedAt: '2026-08-01', rejectedAt: null } }, '2026-08-02'))
      .toBe('approved')
  })
  it('is rejected when the document is rejected', () => {
    expect(deriveState(req(), { doc: { approvedAt: null, rejectedAt: '2026-08-01' } }, '2026-08-02'))
      .toBe('rejected')
  })
  it('is overdue when past the due date with no evidence', () => {
    expect(deriveState(req({ dueDate: '2026-07-01' }), {}, '2026-08-02')).toBe('overdue')
  })
  it('checks acknowledge BEFORE medical - a medical acknowledge row counts as approved', () => {
    const r = req({ kind: 'medical', reqType: 'acknowledge' })
    expect(deriveState(r, { ack: { agreedAt: '2026-08-01' } }, '2026-08-02')).toBe('approved')
  })
  it('counts a waiver agreement only against the current version', () => {
    const r = req({ kind: 'waiver', reqType: 'acknowledge' })
    const stale = { ack: { agreedAt: '2026-07-01', operatorDocumentId: 'v1' }, currentWaiverId: 'v2' }
    expect(deriveState(r, stale, '2026-08-02')).toBe('not_started')
  })
  it('is approved when the medical form is completed', () => {
    const r = req({ kind: 'medical', reqType: 'fill' })
    expect(deriveState(r, { medical: { completedAt: '2026-08-01' } }, '2026-08-02')).toBe('approved')
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL — `deriveState` is not defined.

- [ ] **Step 3: Implement `deriveState`**

Mirror the app branch for branch: `acknowledge` first, then `fill`/medical, then `upload`; overdue only when there is no evidence.

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: 8 passing.

- [ ] **Step 5: Commit**

```bash
git add src/domain && git commit -m "feat: port requirement state derivation with tests"
```

---

### Task 3: Supabase client, errors, auth

**Files:**
- Create: `src/lib/supabase.ts`, `src/lib/errors.ts`, `src/lib/auth.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `supabase`, `friendlyError(e: unknown): string`, `AuthProvider`, `useAuth(): { session, user, loading, signIn(), signOut() }`.

- [ ] **Step 1: Client** — `createClient(url, anonKey, { auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true } })`. Throw a clear startup error if env vars are missing.
- [ ] **Step 2: `friendlyError`** — map common cases (network, JWT expired, `PGRST` codes, 403) to plain sentences. Default: "Something went wrong. Please try again."
- [ ] **Step 3: `AuthProvider`** — read session on mount, subscribe to `onAuthStateChange`, expose `signIn()` calling `signInWithOAuth({ provider: 'google' })`.
- [ ] **Step 4: Verify** — `npm run build` succeeds.
- [ ] **Step 5: Commit**

---

### Task 4: Design tokens and shell

**Files:**
- Create: `src/styles/tokens.css`, `src/styles/global.css`, `src/components/Shell.tsx`, `src/components/StateBits.tsx`

**Interfaces:**
- Produces: `<Shell>`, `<Spinner/>`, `<ErrorBox error onRetry/>`, `<Empty title note/>`, `<StateTag state/>`.

Bright mode only, reusing the palette already used across the operator docs: `--cyan:#05BCD3`, `--cyan-dark:#066B8C`, `--ok:#1f7a4d`, `--open:#b8532b`, `--line:#e3e3de`, `--panel:#f7f7f5`.

- [ ] **Step 1: Write tokens.css and global.css**
- [ ] **Step 2: Write Shell with header, operator email, sign-out**
- [ ] **Step 3: Write the small state components**
- [ ] **Step 4: Build passes**
- [ ] **Step 5: Commit**

---

### Task 5: Trips list

**Files:**
- Create: `src/services/trips.ts`, `src/routes/TripsPage.tsx`

**Interfaces:**
- Produces: `fetchOperatorTrips(): Promise<OperatorTrip[]>` where
  `OperatorTrip = { id, title, destination, startDate, endDate, memberCount }`.

Query: `group_trip_participants` where `user_id = me and role = 'host'`, join `group_trips` filtered to `hosting_style = 'C'`.

- [ ] **Step 1: Write `fetchOperatorTrips`**
- [ ] **Step 2: Write TripsPage — loading, error, empty, list**
- [ ] **Step 3: Empty state copy** — "No operator trips on this account." Not an error.
- [ ] **Step 4: Build passes**
- [ ] **Step 5: Commit**

---

### Task 6: Review matrix service

**Files:**
- Create: `src/services/review.ts`, `src/services/counts.ts`

**Interfaces:**
- Produces:
  - `fetchTripReview(tripId, userIds): Promise<TripReview>` with
    `TripReview = { travelers: TravelerReview[], totalToReview: number }`,
    `TravelerReview = { userId, items: ReviewItem[], toReview, done, total }`,
    `ReviewItem = { requirementId, kind, reqType, title, dueDate, state, documentId, storagePath, submittedAt, note, fileDeleted }`
  - `fetchCounts(tripId): Promise<CountRow[]>` where `CountRow = { requirementId, expected, received, approved }`
  - `fetchMedicalFlags(tripId): Promise<MedicalFlags>`

Five parallel reads, exactly as the app does: requirements-resolved, documents, acknowledgements, medical, current waiver. Filter out `req_type = 'pay'` — there is no payment UI.

- [ ] **Step 1: Write the reads**
- [ ] **Step 2: Compose with `deriveState` from Task 2**
- [ ] **Step 3: Write `fetchCounts` calling `organized_trip_document_counts`**
- [ ] **Step 4: Build passes**
- [ ] **Step 5: Commit**

---

### Task 7: Trip snapshot page

**Files:**
- Create: `src/routes/TripPage.tsx`, `src/components/Tile.tsx`

Renders, in order: needs-review banner, documents tile (received + approved per requirement), waiver/medical line, other-requirements list, medical flags tile, surf stats tile. **No money tile.**

- [ ] **Step 1: Write Tile**
- [ ] **Step 2: Write TripPage wiring counts + review + flags**
- [ ] **Step 3: Verify both numbers always render, never just approved**
- [ ] **Step 4: Build passes**
- [ ] **Step 5: Commit**

---

### Task 8: Files — signed URLs, download, zip

**Files:**
- Create: `src/services/files.ts`

**Interfaces:**
- Produces: `signedUrl(path, seconds?): Promise<string>`, `downloadOne(path, filename)`, `downloadAll(items, zipName, onProgress)`.

`downloadAll` fetches each file through a fresh signed URL, adds it to a JSZip archive, and saves. Reports progress so a 60-file export is not a frozen page. Skips rows whose file was purged.

- [ ] **Step 1: Write signedUrl using `storage.from('group-trip-documents').createSignedUrl`**
- [ ] **Step 2: Write downloadOne**
- [ ] **Step 3: Write downloadAll with JSZip and progress**
- [ ] **Step 4: Build passes**
- [ ] **Step 5: Commit**

---

### Task 9: Requirement detail page + export

**Files:**
- Create: `src/routes/RequirementPage.tsx`, `src/components/DocumentViewer.tsx`

One requirement, every traveler, their state, and export. Purged rows show "File deleted after 30 days" and offer no view or export.

- [ ] **Step 1: Write the table of travelers for one requirement**
- [ ] **Step 2: Write DocumentViewer (image + PDF via signed URL)**
- [ ] **Step 3: Wire Export all**
- [ ] **Step 4: Build passes**
- [ ] **Step 5: Commit**

---

### Task 10: Approve and reject

**Files:**
- Create: `src/services/actions.ts`
- Modify: `src/routes/RequirementPage.tsx`, `src/components/DocumentViewer.tsx`

**Interfaces:**
- Produces: `approveDocuments(tripId, documentIds): Promise<number>`, `rejectDocument(documentId, note?): Promise<void>`.

Approve is one click inside the viewer. Bulk approve takes a selection. Reject warns clearly that it deletes the file and re-opens the task, since it is not undoable.

- [ ] **Step 1: Write the two RPC wrappers**
- [ ] **Step 2: Add approve to the viewer**
- [ ] **Step 3: Add bulk approve to the table**
- [ ] **Step 4: Add reject with an explicit confirm and optional note**
- [ ] **Step 5: Invalidate queries so counts refresh**
- [ ] **Step 6: Build passes**
- [ ] **Step 7: Commit**

---

### Task 11: Traveler page

**Files:**
- Create: `src/routes/TravelerPage.tsx`, `src/services/travelers.ts`

**Interfaces:**
- Produces: `fetchTravelerProfile(userId)`, `fetchMedicalForm(tripId, userId)`.

Profile, waiver line, each document with view/export/reject, and medical with view **and export** (2 August decision). No message, no remove, no editing.

- [ ] **Step 1: Write the profile + medical reads**
- [ ] **Step 2: Write the page**
- [ ] **Step 3: Build passes**
- [ ] **Step 4: Commit**

---

### Task 12: Routing, README, deploy config

**Files:**
- Modify: `src/App.tsx`
- Create: `README.md`, `netlify.toml`

SPA redirect so deep links work on Netlify. README covers setup, env vars, running, testing, deploying, and the naming traps.

- [ ] **Step 1: Wire all five routes with an auth guard**
- [ ] **Step 2: `netlify.toml` with `/* -> /index.html 200`**
- [ ] **Step 3: Write README**
- [ ] **Step 4: `npm run build` and `npm test` both pass**
- [ ] **Step 5: Commit**

---

## Self-Review

**Spec coverage:** §3 auth → Task 3. §4.1 → Task 5. §4.2 → Task 7. §4.3 → Tasks 8–9. §4.4 → Task 11. §4.5 → Task 10. §5 purge → Task 9. §6 data → Tasks 2, 6. §10 errors → Task 3 + Task 4. Money is deliberately absent, matching §7.

**Placeholders:** none. Every task names exact files and real interfaces.

**Type consistency:** `ReviewItem`, `TravelerReview`, `TripReview`, `CountRow` are defined once in Task 6 and used unchanged in Tasks 7, 9, 10, 11. `deriveState` is defined in Task 2 and consumed only in Task 6.
