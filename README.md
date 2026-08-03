# Swellyo Operator Dashboard

The desktop website operators use to review traveler documents and export files for one trip.

Separate from the mobile app on purpose. All real management — editing trips, messaging, removing travelers — stays on mobile. This site does the two jobs that are painful on a phone: **reviewing documents** and **exporting files**.

Full spec: [`docs/SPEC.md`](docs/SPEC.md) · Build plan: [`docs/superpowers/plans/`](docs/superpowers/plans/)

---

## Setup

```bash
npm install
cp .env.example .env    # then fill in the two values
npm run dev             # http://localhost:5175
```

Environment variables:

```
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

Use the **same** Supabase project as the mobile app. The anon key is public by design — Row Level Security is what protects the data, not the key.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Type-check then build to `dist/` |
| `npm test` | Run tests |
| `npm run typecheck` | Types only |

## How it works

There is **no backend**. The browser talks to Supabase directly.

- Sign-in is Google OAuth, the same account operators use in the app.
- Every read is gated by `is_trip_host` in the database. The site cannot see a trip you do not host, even if the code asks.
- Documents live in a private bucket and are fetched through signed links that expire in about a minute. There are no public file URLs.

```
src/
  domain/      pure logic, no I/O  (requirement state, tested)
  services/    everything that talks to Supabase
  routes/      one file per screen
  components/  shared UI
  lib/         client, auth, errors, formatting
```

## Adds nothing to the database

This project creates no tables, functions, views, or migrations. Every object it reads was already live before it existed.

### Naming traps

Get these wrong and you get a confusing error, not a helpful one.

| Correct | Wrong | Why |
|---|---|---|
| `organized_trip_document_counts` | `group_trip_document_counts` | Renamed in July. The old one was **dropped** |
| `organized_trip_travelers_documents` | `group_trip_documents` | Renamed in July |
| `group_trip_acknowledgements` | `organized_trip_acknowledgements` | Deliberately **not** renamed — it is the waiver's only legal record |

An operator trip is `group_trips.hosting_style = 'C'`. A host is a `group_trip_participants` row with `role = 'host'`.

### Requirement state is derived, never stored

"Done" is worked out from the evidence: a document row, an agreement row, or a completed medical form.

That logic lives in `src/domain/requirements.ts`, ported from the mobile app. **The branch order is load-bearing** — `acknowledge` is checked before `medical`, exactly as the database does it. Change it and this site quietly disagrees with the app about what "done" means. That is what the tests protect.

> **Known debt.** This is the third copy of that rule (the SQL function, the app, here). The proper fix is the `operator_trip_requirement_matrix` function, specced but never applied. Worth doing next time someone is working in the database.

## Deploying

Netlify, static. `netlify.toml` sets the SPA redirect and no-index headers.

1. Point Netlify at this repo.
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the site's environment.
3. Add the deployed URL to Supabase Auth → **Redirect URLs**, or Google sign-in bounces back to nowhere.

## Decisions worth knowing

- **No money tile.** The payment ledger does not exist in the database. A zero would be a lie, so nothing renders.
- **Medical has export.** Decided 2 August. This overrides `SPEC.md` §7, which said view-only. The consent text travelers read should say so before they type anything in.
- **Exports are not logged.** No download history, by decision.
- **Reject deletes the file** and re-opens the task for the traveler. Rejecting and "delete + reclaim" are one action, and it cannot be undone.
- **Approve is one click inside the viewer**, plus bulk approve. A separate queue of 60 deliberate approvals decays, and then the number nobody trusts is the one we added to build trust.

## Still open

1. **Custom requirements.** Operators can invent their own items; the tiles are built around passport, visa, insurance and flights. Custom ones currently land in an "Other requirements" list. How they should properly be counted and exported needs Eyal and Ohad.
2. **Approval on desktop.** Eyal's `SPEC.md` calls desktop read-only, but it was written before the approval step existed, so it cannot have an opinion on it. This site includes approve and reject. If Eyal wants it strictly read-only, it is two buttons to remove.
