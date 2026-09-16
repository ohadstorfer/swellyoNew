# Operator trips — what the failed test pass says we have to fix

**Written 16 Sep 2026.** Source: the "Operator Trip Test Pass" page
(https://claude.ai/code/artifact/2e80312c-c320-4c6e-991b-49eb2ac6da2b).
Every test that was not already ticked was treated as failed, and the code,
the database rules and the live database were read to find out why. 96 of them
came back with a suspected cause.

**This document is decisions, not instructions.** One block per root cause:
what is wrong, and what we decide to do. No file paths, no code. The file and
line for each one is in the note on the test page.

**Grouping:** by root cause, ordered by risk — money first, then who can do
what, then seats, documents, lifecycle, setup, copy. One defect often covers
three or four tests, so fixing 96 tests is about 40 pieces of work, not 96.

**Rules that apply to all of it**
- Migrations are applied by hand through MCP. Never `db push`.
- Edge functions are deployed by hand. Repo files are copies, and live has
  drifted before — diff live against the repo before changing anything.
- Nothing here is committed by Claude. Ohad reviews and commits.
- Anything that moves money is verified on Stripe test mode first.

---

## Do these first

| # | What | Tests |
|---|------|-------|
| 1 | The operator is put into onboarding on their own new trip | B-08 |
| 2 | Bank payments are never recorded at all | M-04 |
| 3 | A paid traveler can be removed with no refund | X-06 |
| 4 | Traveler prices are still world-readable | N-10 |
| 5 | Anyone, not just an operator, can make an operator trip | S-01 |
| 6 | The deposit is taken before the seat is claimed | J-06 |

They are all live today, they all touch money or access, and none of them
depends on anything else in this document.

---

## A — Money

### A1. Bank payments are dropped on the floor
**Tests:** M-04, M-05, M-09 (part)
**Wrong:** the webhook only treats a bank checkout as in flight when Stripe
says `processing`. Stripe never says that on a checkout session — a bank
payment arrives as `unpaid`. So the session is thrown away as "completed, no
money". Live has never held a single in-flight bank row.
**Decision:** treat a completed session with an unpaid async payment method as
money in flight. Write the pending row, show the "4 business days" message,
and block a second payment while it is in flight. Verify on test mode with a
real ACH run before this is called done.

### A2. A paid traveler can be removed with no refund
**Tests:** X-06, X-08, X-14 (part)
**Wrong:** the phone reads "paid so far" as zero while the money is still
loading or if the read failed, so it decides no refund is needed and runs the
plain remove. It is also how a Manager gets around the refund rule.
**Decision:** unknown is not zero. If the money has not loaded, the remove
button waits; if the read failed, it refuses and says so. Same rule for the
cancel sheet. Do not let a UI-only gate be the only thing protecting a refund.

### A3. A failed payment never becomes a row
**Tests:** M-10, M-11
**Wrong:** a declined card and an expired session only send a notification and
return. No ledger row is written, so the "show failed" toggle is never drawn
and the CSV has nothing to export. The export code itself is fine.
**Decision:** write a failed row for both events. The toggle and the CSV then
work with no further change.

### A4. Nobody is told about a refund
**Tests:** X-16
**Wrong:** there is no refund notification type at all. Neither the refund
function nor the cancel function writes one. A removed traveler also cannot
reach their own money view any more.
**Decision:** add a refund notification for the traveler, sent by the server
on refund and on cancel, and keep the money view reachable after removal.

### A5. "Payment landed" goes to the wrong person
**Tests:** M-18, M-19
**Wrong:** the operator's "money arrived" notification is addressed to the
traveler, and only fires for bank payments. No trigger writes it either.
Deploying will not fix it.
**Decision:** rewrite it as an operator notification, fired for card and bank
alike. Ship it together with the payouts card (A6), which is the screen that
makes it useful.

### A6. The payouts card is in no build
**Tests:** M-19
**Wrong:** the card, its service, the website reader and the payouts function
are all untracked in git.
**Decision:** commit and ship as one piece, with A5.

### A7. Money numbers count people who left
**Tests:** M-09, M-17, W-02
**Wrong:** the phone counts every traveler row whatever their status, so
people who left or were removed are still inside "expected total", "still
owed" and "fully paid N of M". The website filters them out, so the two
surfaces disagree. The phone money card also never says when the rest is due.
**Decision:** one shared rule for who counts, applied on both surfaces:
present travelers only. Add the due date to the phone card.

### A8. Cents are dropped on the phone confirm
**Tests:** M-14
**Wrong:** the confirm reads the amount as a whole number, and only tells the
traveler what they paid, not what they will still owe.
**Decision:** read cents properly and show all three numbers, like the website.

### A9. The deposit is not frozen with the price
**Tests:** M-12
**Wrong:** the freeze only fills in rows where the price is empty. Adding a
trip deposit later makes an already-paid traveler owe it; removing one lets an
unpaid deposit vanish.
**Decision:** freeze the deposit at the same moment and by the same rule as
the price.

### A10. The price gate is only in the screen
**Tests:** M-16
**Wrong:** both screens hide the price button from a co-operator, but the
database function accepts anyone holding `money.manage`.
**Decision:** decide which is the truth and make the database say it. If a
co-operator may not set prices, the function must refuse them.

### A11. Cancel and refund loose ends
**Tests:** X-09, X-10, X-11
**Wrong:** once the cancel result screen is closed there is no way back to it.
A bank payment that has not landed is skipped and left for the operator to
refund by hand, and nothing on screen says so. The stalled-onboarding nudge
rounds hours instead of rounding down, so the 4-hour nudge can arrive at 3.5,
and it only nudges travelers who already paid — someone stuck at the waiver
never hears anything.
**Decision:** keep the cancel result reachable on a cancelled trip; say
plainly, on screen and to the traveler, when a payment has to be refunded by
hand; round the nudge hours down and nudge from the first unfinished step, not
from payment.

### A12. Disputes have never happened
**Tests:** X-15
**Wrong:** live has never held a dispute ledger row, and the only two dispute
notifications share one timestamp, so they look hand-inserted.
**Decision:** check whether the webhook version is deployed and whether the
dispute events are subscribed in Stripe. This is a deploy/configuration check
before it is a code change.

---

## B — Who can do what

### B1. Anyone can make an operator trip
**Tests:** S-01, P-01
**Wrong:** the Operator card is shown to every user, and the one guard only
redirects real operators with unfinished setup. A plain account falls straight
into the wizard, and the database insert rule only checks that you are the
host, so it does not stop it either.
**Decision:** hide the card from non-operators, guard the wizard, and add the
operator check to the database rule. All three — the screen alone is not a
gate.

### B2. Traveler prices are still world-readable
**Tests:** N-10
**Wrong:** the revoke was applied on 6 Sep and reverted the same day because
shipped clients broke. It was never re-applied. Any signed-in user can still
read what every traveler pays. Separately the view built to replace it runs as
its owner, not as the caller, hands full write rights to every signed-in user,
and has no check option — writes through it may skip row security entirely.
**Decision:** both clients now read through the view, so re-apply the revoke.
Before that, fix the view: run it as the caller, take the write rights away,
and add the check option. Treat the write path as a possible hole until it is
proven closed.

### B3. "Set as admin" grants nothing
**Tests:** N-11
**Wrong:** it only writes a role on the participant row, but operator
permission comes from being the host or from an accepted crew row. The trip
appears in their list, then refuses to open, and the money page says they have
no access.
**Decision:** either make it create the crew row that actually grants access,
or take the option away. Half-granting is the worst of the three.

### B4. A Manager still sees medical on the phone
**Tests:** R-11
**Wrong:** the phone shows a Manager a medical block reading "not filled in
yet" — both a medical card they may not see, and a false statement. The
website hides it. This is the same fail-closed mistake we already fixed once
on the website.
**Decision:** pass the medical permission into the phone traveler card and
hide the whole block, not the values.

### B5. Crew and the trip page contradict each other
**Tests:** W-06, C-07
**Wrong:** the website puts both operator cards on the trip page, and that
page is refused to anyone without document-view. So a Guide can never see
them — which is exactly what the already-passing C-07 checks. The two tests
cannot both be right.
**Decision:** product call — either a Guide may open the trip page with a
reduced view, or W-06 is wrong and gets rewritten. See section G.

### B6. There is no per-person "shown to travelers" switch
**Tests:** C-20, C-23 (part)
**Wrong:** "shown to travelers" only exists as a tier capability, and all six
tiers hold it. The staff table has no column for it and no screen has a toggle.
**Decision:** either build the per-person switch (column + toggle on both
surfaces) or drop it from the spec and the test.

### B7. Crew keep access to a cancelled trip
**Tests:** X-13
**Wrong:** the cancel trigger notifies travelers and pending requests only.
Nothing tells crew, and the permission check never looks at trip status.
**Decision:** notify crew on cancel, and make the permission check refuse a
cancelled trip.

---

## C — Seats and onboarding

### C1. The operator is put into onboarding on their own trip
**Tests:** B-08
**Wrong:** the host row is created with no status, and the live trigger fills
in `onboarding`. There is no exception for the host. So every operator trip
made today opens with "finish onboarding" for its own operator, and the host
stops counting toward seats. The four older live trips predate the trigger,
which is why nobody has seen it.
**Decision:** the trigger exempts the host. Fix the four — or however many —
existing trips in the same migration.

### C2. The deposit is taken before the seat
**Tests:** J-06, N-04
**Wrong:** onboarding runs waiver, deposit, then medical, and only the medical
form makes someone active. The loser of the last seat has already paid, and
the screen tells them they were not charged. Nothing refunds them.
**Decision:** claim the seat before taking money — hold it for the length of
the checkout. If that is too big for now, the fallback is an automatic refund
plus an honest message, but a hold is the right answer.

### C3. "Overdue" counts as done
**Tests:** O-02, O-03, O-13
**Wrong:** the settled check treats an overdue step as finished, so once a
deadline passes the step drops out of the walk and shows a green Done pill,
while the trip page still lists it as outstanding. Two screens, two answers.
**Decision:** overdue is not settled. One place decides, both screens read it.

### C4. Membership only activates in two places
**Tests:** O-15, O-01
**Wrong:** the seat is only claimed by the "Go to the trip" button and by one
check when the trip screen opens. Close onboarding with the X and nothing
retries — no seat, no count change — until the trip screen is opened fresh.
No server-side job does it. The remaining-seats number is worked out once and
goes stale.
**Decision:** activate server-side when the last step is settled, not from a
button. Read the seat count live.

### C5. The seat count and the database disagree
**Tests:** J-03
**Wrong:** the tile leaves hosts out of the count; the live capacity trigger
counts every active row, host included. The tile says 11 of 12 while the
database already refuses the 12th traveler.
**Decision:** one definition of a taken seat, and the tile uses the database's.

### C6. Approve against decline
**Tests:** J-04, J-07
**Wrong:** the phone approves and declines with no check that the request is
still pending; the website checks. From a stale list you can mark someone
declined who then finishes onboarding and joins anyway. Two approvals at once
are fine.
**Decision:** add the pending check to the phone, the same as the website.

### C7. An old medical form is never re-asked
**Tests:** O-09
**Wrong:** the completeness check is written and imported but never called,
and the live view marks medical approved as soon as it has a completion
stamp. So a form filled in before we asked for an emergency contact is never
asked for one.
**Decision:** call the check, or drop it and accept old forms deliberately.
Dead code that looks like a guard is worse than no guard.

### C8. "Needed to join" on a months-only trip
**Tests:** N-02
**Wrong:** the website looks only at the due date and ignores the 30-day rule
it has already loaded, so a skippable document reads as needed to join. The
phone gets it right.
**Decision:** the website uses the same rule as the phone.

### C9. Paying twice when the webhook is slow
**Tests:** N-05
**Wrong:** when the confirm poll gives up, onboarding says "still being
confirmed" and puts the Pay button back. The server only de-duplicates open
sessions, so a slow webhook means two charges. The Plan tab does block it.
**Decision:** no Pay button while a session is unresolved, on any surface, and
the server refuses a second session for the same thing.

---

## D — Documents and review

### D1. Replacing a document can destroy it
**Tests:** O-14
**Wrong:** the upload deletes the existing document before it uploads the new
one. Lose the network halfway through re-sending a rejected document and the
old file and the rejection note are both gone. A first upload behaves.
**Decision:** upload first, delete after it succeeds.

### D2. Passport details are never written
**Tests:** O-10
**Wrong:** nothing anywhere writes the name, nationality or expiry date. The
upload only picks a file. The one scanner panel copies to the clipboard and
saves nothing, and it needs a native build so it is dead in Expo Go.
**Decision:** decide whether we collect these at all. If yes, a plain form is
the honest first version; the scanner comes later. If no, remove the columns
from the spec and the test.

### D3. Rejecting on the website leaves a live View button
**Tests:** R-04
**Wrong:** the website deletes the file but never stamps the row, and the page
works out "file deleted" from that stamp alone. The row keeps a View button
pointing at a file that is already gone, until the nightly purge. The phone
stamps it.
**Decision:** the website stamps it too. One function does the delete and the
stamp together so this cannot drift again.

### D4. The two review surfaces differ
**Tests:** R-03, R-05, R-14
**Wrong:** the phone cannot approve several documents at once; the website
can. The website allows an empty rejection reason; the phone needs three
characters.
**Decision:** bulk approve on the phone, minimum reason on the website. Same
rules on both.

### D5. "Received" means two different things
**Tests:** W-01
**Wrong:** the website requirement page counts a rejected document as
received; the phone and the website trip row do not. On top of that the live
count view is missing the traveler-status filter the repo version has, so
people who left are still counted.
**Decision:** rejected is not received. Re-apply the live view so it matches
the repo.

### D6. Exports
**Tests:** D-03, D-04, D-05, D-07, D-08
**Wrong:** past 40 files the phone silently trims to the first 40, shares
them, and only then shows an alert. There is no whole-trip export on the phone
at all. Two travelers with the same name share one folder. A `#` in a name
cuts the zip file name short. The phone never checks the download status, so
an error page can be zipped as a `.jpg`. The phone names only travelers still
on the trip, so anyone who left appears as a raw user id.
**Decision:** refuse before doing half the job; folder per person, not per
name; strip `#`; check the download status; look up every name. Whole-trip
export on the phone is a separate decision — the website has it.

---

## E — Trip lifecycle and reminders

### E1. Nothing ever ends a trip
**Tests:** N-13, N-14, N-06
**Wrong:** no job sets a trip to completed — only a manual update does. Ended
is worked out from the dates, so a months-only trip never ends and its
documents are never purged. West of UTC a trip reads as ended on its own last
day. The "trip ended" push only fires on the exact day, so one missed cron day
means never. Meanwhile the old reminder job runs on operator trips and tells
paid travelers to "commit now" four times, and sends "trip today" to people
who are still onboarding and hold no seat.
**Decision:** a job that ends trips, catching up on anything it missed rather
than firing only on the day. Use the trip's own timezone. Decide what "ended"
means for a months-only trip. Stop the old reminder job from touching operator
trips.

### E2. The website cannot move the start date
**Tests:** E-14
**Wrong:** there is no write to the trip start date anywhere in the dashboard,
although the spec says there is.
**Decision:** build it, or correct the spec. Do not leave the spec lying.

### E3. Changing a requirement does not warn
**Tests:** E-02
**Wrong:** the phone saves straight away with no confirm and no count at all.
The website does ask, but counts only overdue people, so travelers who are
late because their document was rejected are missing from the number; and it
only checks that the date moves later, not that it clears today, so it can
claim to un-late people who stay late.
**Decision:** one shared "who is affected" rule, used by both. The phone gets
the confirm.

### E4. Deadline defaults can already be in the past
**Tests:** B-05, B-06, B-11
**Wrong:** on a trip less than 30 days away the 30-day default is already in
the past and publishes with no complaint — only pressing "earlier" is blocked,
never the starting value. The create flow also checks for a start date in
months-only mode, so the button can be dead while the label asks for exact
dates. And the two requirement editors list requirements in different orders,
so a row added on the website sorts differently.
**Decision:** validate the default, not just the edit. Fix the months-only
check. One catalogue order, shared.

### E5. "Custom" requirements exist only in SQL
**Tests:** B-07
**Wrong:** the database allows a custom kind, no screen ever creates one, so
"other requirements" only ever shows rows written by hand.
**Decision:** build the screen or remove the kind. It cannot stay half-built.

### E6. Invite links only work on a phone that has the app
**Tests:** B-10
**Wrong:** the redirect page sends any non-phone browser to the marketing
site, and the web app ignores the trip parameter on purpose.
**Decision:** make the web app honour the link, so a desktop click lands on
the trip. Until then, say plainly that these links are phone-only.

### E7. Leaving and removing still delete the record
**Tests:** X-07, G-02, X-14 (part)
**Wrong:** only part of the departed-members work is applied live. The leave
and remove functions do not exist, so both clients fall back to the old
delete. The website also runs a raw delete of its own, which will keep erasing
the record even after the migrations land. The website blocks a co-operator
from refunding while the phone allows one.
**Decision:** apply the remaining migrations — both parts together, never
phase 2 alone — then remove the website's raw delete and settle the
co-operator refund rule.

### E8. The traveler cannot read the terms they agreed to
**Tests:** O-18
**Wrong:** the terms sheet only appears before you agree, or while money is
owed. The frozen consent record is never read back by any traveler screen. The
leave alert names the preset only.
**Decision:** a plain "the terms you agreed to" screen, reading the frozen
record, reachable any time.

---

## F — Setup wizard, Stripe Connect and crew

### F1. The Stripe button never opens Stripe
**Tests:** S-11
**Wrong:** the website opens the new tab in a way that by the HTML spec always
reports failure, so it always says the browser blocked it, and leaves a blank
tab behind. Stripe is never loaded.
**Decision:** open it without the flag that breaks the return value, and check
that the live onboarding function still serves the dashboard action.

### F2. A platform rejection looks like "checking"
**Tests:** S-06
**Wrong:** the list of unrecoverable Stripe reasons is missing the three
platform rejections. When the platform is what refuses the account, the step
ticks with a "checking" pill instead of going red.
**Decision:** add the three reasons, in both copies of the list, and then
delete one of the copies.

### F3. The setup banner never clears itself
**Tests:** S-05, S-09
**Wrong:** the website loads the setup state once per page load and never
reloads it. The phone does refresh, through the Connect notification. On the
phone the cached summary only refreshes once all six steps are done.
**Decision:** reload the setup state after any step finishes, on both surfaces.

### F4. Replacing the waiver can break the next trip
**Tests:** S-08
**Wrong:** replacing the waiver from settings deletes the old file, but the
cached default still points at it. Make a trip soon after and the copy fails
with "requirements not saved", leaving a trip with no requirements and no
payment steps.
**Decision:** update the cached default when the file is replaced, and never
leave a published trip with no requirements — fail the publish instead.

### F5. Crew photo upload dies in the browser
**Tests:** C-05, C-23 (part)
**Wrong:** the image upload function has no preflight handler and no CORS
headers, so the browser check fails and the photo dies after the crew row is
already saved. The phone path works.
**Decision:** add the preflight handler and the headers, and do not save the
crew row until the photo is settled — or save the row and retry the photo, but
say which.

### F6. The website's invite link is not a link
**Tests:** C-04, C-23 (part)
**Wrong:** the website hands over a bare 64-character token. Nothing builds a
real link out of it, so pasting it does nothing. The phone builds the real one.
**Decision:** build the same link on the website.

### F7. "Not accepted" can never be shown
**Tests:** C-03
**Wrong:** both crew lists read only the staff table, and a staff row is only
created on accept, already stamped. The invites table is read by no screen at
all.
**Decision:** read the invites table so pending invites show. Otherwise the
state does not exist in the product and the test should go.

### F8. Crew lose the trip once they close it
**Tests:** C-02
**Wrong:** crew are never participants, and the trips feed reads participants
and join requests only. After closing the trip once, a crew member can only
get back in through the notification. The website does read the staff table.
**Decision:** the feed reads crew rows too.

### F9. Silent read failures
**Tests:** W-10
**Wrong:** several reads fail with nothing on screen: counts show 0 of N, the
money card just disappears, crew and flags say nothing. The error helper also
tests "not found" before "object not found", so the "file is no longer stored"
message can never appear.
**Decision:** a failed read says it failed. Zero and "failed to load" are not
the same sentence. Fix the helper's test order.

---

## G — Product decisions (the test text may be what is wrong)

These are not bugs. The product does what it does on purpose, and the test
says otherwise. Each needs one decision from Ohad, then either the code or the
test text changes.

| Test | The question |
|------|--------------|
| S-03 | Setup has six steps now, not four, and the screen still says "four things" above "0 of 6 done". Fix the copy — and the test. |
| O-11 | Passports refuse a PDF on purpose ("a passport is a photo of a page"). Keep that rule, or allow PDFs? |
| C-10 | The website shows the refund terms card to anyone who can open the trip and hides only editing. May a Manager read the terms? |
| E-11 | A Guide holds "send updates" live, on purpose, and the phone lets them post. The website blocks them only because the whole page needs document-view. Which is the truth? |
| E-09 | The refusal guard checks joins before signatures, and anyone who signed also joined, so the signature message can almost never appear. Keep the message or drop it? |
| R-13 | The purge deletes a file 30 days after the trip **ends**, not 30 days after upload. A document uploaded 30 days ago on a running trip keeps its file. Is that the rule we want? |
| N-07 | Both surfaces say "leaves today" on departure day and "1 day to go" the day before. The test expects something else. The test is probably wrong. |
| X-10 | On cancel, a bank payment that has not landed is skipped and the operator is told later to refund it by hand. Neither the result screen nor the traveler is told. Is that the answer we want? |
| W-06 / C-07 | Same contradiction as B5 — can a Guide open the website trip page or not? |

---

## H — Not shipped (commit and deploy, no new code)

| Tests | What |
|-------|------|
| D-01, D-02 | The export files, the zip library and the screen changes are untracked. No build or OTA has them, so no device result means anything yet. |
| M-19 | The payouts card and its function are untracked. See A6. |
| X-07 | Two departed-member migrations are not applied. See E7. Apply both together. |
| X-15 | Check the webhook version and the Stripe event subscription. See A12. |

---

## I — Cannot be tested today (data or timing, not code)

| Tests | Why | What to do |
|-------|-----|------------|
| C-18, C-19 | Live has no Guide, Manager or Co-operator rows — the 6 Sep test crew is gone. | Seed the test crew again. |
| C-17 | All four live trips ask travelers for every kind, so "something a traveler is not asked for" does not exist. | Make a trip with a narrower requirement set. |
| C-14 | Medical and waiver rows carry no traveler deadline, so the field is blank for crew too. | Retest with a dated document, like the passport. |
| R-09 | The daily job writes the same notification type, so anyone nudged in the last 24 hours is skipped. | Retest outside the 24-hour window. |
| R-15 | The job only writes when a deadline is 14, 7, 3, 2 or 1 days out, or 1 or 3 days past. Every live deadline is 88+ days away. | Move a deadline, or wait. |
| N-12 | Live already has nine refunds stuck on insufficient balance (12–19 Aug) and two expired crew invites. | Clear the leftovers first — and decide separately whether stuck refunds need an alarm. |
| O-05 | Works in code; the live function records name, time, version, IP and agent. The waiver preview is dead in Expo Go. | Retest on a real build. |
| P-05 | Cannot be judged from code at all. | Real build, two phones. |

---

## Rough order of work

1. **Today, live problems:** C1, B1, B2, A1, A2, C2.
2. **Money correctness:** A3, A4, A5 + A6, A7, A8, A9, A10, A11, A12.
3. **Seats and onboarding:** C3, C4, C5, C6, C7, C8, C9.
4. **Access:** B3, B4, B6, B7, and B5 after the G decision.
5. **Documents:** D1, D3, D4, D5, D6, and D2 after the G decision.
6. **Lifecycle:** E1, E7, E3, E4, E2, E5, E6, E8.
7. **Setup and crew:** F1, F2, F3, F4, F5, F6, F7, F8, F9.
8. **Copy and tests:** section G, then rewrite the affected tests on the test
   page.
9. **Retest:** section I once the test data is seeded.

Sections 3, 5 and 7 touch different files from each other and can run in
parallel. Section 1 should not run in parallel with anything.
