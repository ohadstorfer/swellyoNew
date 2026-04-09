---
name: Age Gate + DOB Onboarding — Industry Patterns
description: What happens when a user enters conflicting DOB (age gate vs profile setup), whether DOB should be locked, and what Apple/Google require for 18+ social apps.
type: project
---

Industry standard for 18+ social/matching apps: ask DOB once (at age gate), pre-fill and lock the profile DOB field from that value. Do NOT ask for DOB a second time.

Tinder, Bumble, Hinge all lock name + DOB immediately after signup — not editable in-app. Manual change requires ID verification via support. Hinge allows one change then permanently locks.

If an underage DOB is entered in profile setup (second screen), the correct industry response is immediate account termination / block — not a gentle error. Tinder auto-restricts the account and requires ID verification to appeal.

Apple: No universal 18+ verification mandate, but apps with UGC targeting adults must use "an age restriction mechanism based on verified or declared age" (App Review Guidelines sections 1.2.1a, 4.7.5). Apple's Declared Age Range API avoids direct DOB collection — uses age brackets. Accurate metadata in App Store Connect is required.

Google: Play Age Signals API (live Jan 2026) provides age bracket signals. No long-term storage of age data permitted — query at runtime. Play Store now enforces 18+ download gates for rated apps in several jurisdictions.

**Why:** Apple and Google do not require DOB collection per se, but 18+ social apps must implement a mechanism preventing underage access. Self-declared DOB at signup is the minimum acceptable bar.

**How to apply:** Swellyo's current flow (age gate → pre-fill Step 4 DOB → validate 18+ again at submit) is architecturally correct. The gap is: what happens if the user clears/changes the pre-filled DOB to something underage in Step 4? The industry answer is: block and terminate the session immediately, same as the initial age gate block.
