# Spec: copy Swellyo into `~/swellyoWavepools`

## Summary

Make a full copy of `~/swellyoNative` at `~/swellyoWavepools`. It is the start of
a wave-pool version of the app (surf trips at wave pools, run by the pool
operators). This step is a **copy only**: no product changes. The only edits
are safety rails, so the copy can never ship as Swellyo or push to Swellyo's
repos.

## Decisions (from the interview, 21 Oct 2026)

| Topic | Decision |
|---|---|
| Path | `/Users/ohadstorfer/swellyoWavepools` (does not exist yet) |
| Git history | **Keep** the full `.git` history |
| Uncommitted work on `ohad` | **Include** it, as it is now |
| Heavy / generated files | **Exclude** them; run `npm install` after |
| Git remotes | Remove `origin` + `love`; new **private** repo `ohadstorfer/swellyoWavepools` becomes `origin` |
| Branches | Push **only `main`**; work on `main` |
| EAS / bundle ids | Keep the ids as they are, but **block** every EAS build/update/submit until new ids exist |
| Supabase / `.env` | Copy the `.env` files as they are. The copy talks to **Swellyo's prod DB** for now |
| Claude memory | **Copy** it to the new project path, plus a note |
| CLAUDE.md | Add **one short section at the top**; leave the rest as it is |
| Netlify | **Not** connected |
| Eyal | No access for now |

## Steps

### 1. Copy the files
Use `rsync -a` from `~/swellyoNative/` to `~/swellyoWavepools/`, with `.git`
included and these excluded:

- `node_modules/` (root **and** `operator-dashboard/node_modules/`)
- `dist/`
- `ios/Pods/`, `ios/build/`
- `android/build/`, `android/app/build/`, `android/.gradle/`
- `.expo/`, `web-build/`, `tsconfig.tsbuildinfo`

Keep everything else, including `.env`, `.env.local`,
`operator-dashboard/.env`, `google-services.json`, the source `ios/` and
`android/` folders, `.claude/`, and every loose root file (html reports,
sync logs, and so on). Do **not** clean anything up.

Check: compare `git status` in the copy with the source. It must show the same
modified files (`TripDetailView.tsx`, `ProfileScreen.tsx`,
`TripDetailScreen.tsx`, `imageService.ts`) and the same untracked migration
(`20261019000000_auto_approve_operator_insurance.sql`).

### 2. Git: one branch, new remote
In the copy only:

1. `git remote remove origin` and `git remote remove love`.
2. Commit the uncommitted `ohad` work on the `ohad` branch. Stage the files by
   explicit path, never `git add -A`. Message:
   `chore: snapshot of ohad working tree at copy time`.
3. Point `main` at that commit: `git checkout -B main`.
4. Delete every other local branch (`ohad`, `eyal`, `production`, …), so
   only `main` remains.
5. Remove the leftover remote-tracking refs and stashes, so nothing points
   back at SwellyoNew (`git remote prune` is not enough once the remotes are
   gone, so delete `refs/remotes/*` with `git update-ref -d`, and run
   `git stash clear`).
6. Create the private GitHub repo `ohadstorfer/swellyoWavepools`.
   - `gh` is **not installed** on this machine. Either install it
     (`brew install gh` + `gh auth login`, which Ohad does himself) or Ohad
     creates an empty private repo on github.com without a README.
7. `git remote add origin https://github.com/ohadstorfer/swellyoWavepools.git`
   and run `git push -u origin main`, after Ohad confirms.

Never touch `~/swellyoNative`'s git state (branches, remotes, working tree).

### 3. Block EAS until new ids exist
Do both of these:

**a. Unlink from Swellyo's EAS project** (in `app.json`):
- Remove `expo.extra.eas.projectId` (`c14ee9e6-…`).
- Remove `expo.updates.url` (the `u.expo.dev/c14ee9e6-…` URL).
- Leave the name, slug, scheme, bundle id, package and runtimeVersion as
  they are.

**b. Guard in `app.config.js`**: at the top of the exported function, throw
when the config is read by the EAS CLI or on an EAS build server while the
bundle id is still `com.swellyo.app`:
- Detect EAS with `process.env.EAS_BUILD` (set on EAS build servers), or with
  `process.argv`/`process.env` showing the `eas` CLI is running
  (`eas build`, `eas update`, `eas submit`). **Check first how the eas CLI
  loads app.config.js**, and pick a signal that is really there. If no
  reliable signal exists, step 3a alone is the block, and the spec note in
  CLAUDE.md is the rail.
- Error text: `swellyoWavepools: EAS is blocked until new app ids exist
  (bundle id, package, slug, scheme, EAS projectId). See CLAUDE.md.`
- `npm start`, `npm run web`, `npm run ios` / `android` (local runs) must
  keep working.

Check: `npx expo config --type public` still works. Run `npx eas-cli build
--platform ios --profile production --non-interactive` with `--dry-run`, or
a similar safe call that reads the config, and confirm it fails with the
message above. **Do not** run a real build, update or submit.

### 4. CLAUDE.md: section at the top
Add this at the very top of the copy's `.claude/CLAUDE.md`, and leave the
rest as it is:

```md
# ⚠️ THIS IS swellyoWavepools — NOT Swellyo

A copy of swellyoNative (made 21 Oct 2026, with full git history) that will
become a wave-pool version of the app: surf trips at wave pools, run by the
pool operators. No product changes yet.

- **Git:** `origin` = ohadstorfer/swellyoWavepools (private). Never push to
  SwellyoNew or SwellyoLove from here. The "Deploying to SwellyoLove" section
  below does NOT apply.
- **EAS is blocked** (no projectId, guard in app.config.js) until new ids
  exist: bundle id / package (still `com.swellyo.app`), slug, scheme, EAS
  project. Do not run eas build / update / submit.
- **Backend is Swellyo's PROD Supabase** (same .env). Anything created from
  this app (users, trips, messages) shows up in real Swellyo. No migrations,
  no edge-function deploys, and no test data from here until it has its own
  backend.
- **Not on Netlify.**
```

### 5. Copy the Claude memory
- Source: `~/.claude/projects/-Users-ohadstorfer-swellyoNative/memory/`
- Target: `~/.claude/projects/-Users-ohadstorfer-swellyoWavepools/memory/`
  (check the exact folder name Claude Code uses for the new path first)
- Add a memory `project_is_wavepools_copy.md` with a pointer in `MEMORY.md`:
  "This is the wave-pools copy of Swellyo; it shares Swellyo's prod
  Supabase; facts about live DB/edge functions are about Swellyo's prod".

### 6. Install and check
In `~/swellyoWavepools`:
- `npm install` (root), then `npm install` in `operator-dashboard/`
- `npx tsc --noEmit`: it should give the same result as in swellyoNative,
  with no new errors
- `cd ios && pod install` only if Ohad wants to run iOS locally (it is slow
  and not needed for the copy)

## Done when
- `~/swellyoWavepools` exists. `git log` shows the full Swellyo history, plus
  one snapshot commit on `main`, and `main` is the only branch.
- `git remote -v` shows only `swellyoWavepools`.
- `app.json` has no EAS projectId or updates URL, and an EAS command fails
  with the guard message.
- The CLAUDE.md top section and the memory copy are in place.
- `~/swellyoNative` is unchanged: same branch (`ohad`), same 4 modified files
  plus the 1 untracked migration, same remotes.

## Edge cases / risks
- **Shared prod DB**: the biggest risk. The copy can create real users,
  trips, pushes and Stripe events in Swellyo. CLAUDE.md says it; the next
  real project step is a separate Supabase project.
- **Push notifications**: the copy uses the same `com.swellyo.app` id and
  the same DB push tokens. A local dev build could register tokens into
  Swellyo's prod `push_tokens`.
- **The history is public already**: SwellyoNew is public, so a private copy
  does not hide anything that is already out.
- **`.env` files in the copy**: they are gitignored there too. Confirm with
  `git check-ignore` before the first push.

## Open questions (for later, not this step)
- New ids: app name, bundle id/package, scheme, EAS project, store listings.
- Own Supabase project? Own Stripe account? Own PostHog/Sentry projects?
- What "operator" means for a wave pool (pool = operator? sessions = trips?).
