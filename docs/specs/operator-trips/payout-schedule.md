# Payout schedule — when the operator's money reaches their bank

**Status:** ✅ **BUILT + DEPLOYED 2026-09-02, uncommitted.** The edge function boots (verified by
an anon-key call returning our own `Not signed in`). Its **Stripe paths have never run** — that
needs a real operator JWT, i.e. Ohad opening the screen.
**Why:** operators had no way to see or change when Stripe pays them, and no way to ask for the
money early. The only lever was Stripe's country default, which nothing in this repo ever set.
**Related:** `refunds-and-merchant-of-record.md` (the `on_behalf_of` line that makes payout
timing follow the operator's `delay_days`), `staff-and-permissions.md` (why this is NOT
trip-scoped), `ach-bank-payments.md` (the other place money timing surprises people).

---

## 1. The two clocks

Almost every confused question about payouts comes from mixing up two independent things. The
UI shows them **separately, in this order**, because an operator asking *"where is my money"*
has to be able to tell which one is holding it.

| | What it controls | Can a "pay out now" button beat it? |
|---|---|---|
| `delay_days` | When money becomes **available** in the operator's balance at all | **No.** Nothing can. The money does not exist to pay out yet. |
| `interval` | How often **available** money is swept to the bank (`daily` / `weekly` / `monthly` / `manual`) | **Yes.** That is exactly what a manual payout is for. |

Collapse these into one "you get paid in N days" line and the answer becomes a guess.

### The third wait, which is neither

> ⚠️ Stripe holds the **first live payout of a brand-new account for 7–14 days.** It is not in
> the schedule, it is not configurable, it happens once, and **test-mode accounts never see
> it** — so it cannot be reproduced before going live.

This is the single most likely explanation for an operator reporting a two-week wait. The card
detects it (`hasEverPaidOut`, one `GET /v1/payouts?limit=1`) and says so plainly rather than
implying a setting would fix it. Once the account has been paid before, the note disappears —
a permanent warning trains people to ignore warnings.

---

## 2. Why we are allowed to write this at all

Stripe only lets a platform edit a connected account's payout schedule when **the platform owns
fraud and dispute liability**. Ours do:

```
controller.losses.payments = "application"
```

read off a live account on 2026-08-12 (see the header of `stripe-connect-onboard/index.ts`).
Stripe, verbatim: *"Platforms that manage fraud and dispute liability … can adjust the payout
interval"*, and for the delay, *"You can edit this property on accounts where you own fraud and
dispute liability."*

> If that controller value ever changes, **every write in `operator-payouts` starts 400ing.**

The alternative considered and rejected was deep-linking to Stripe's Express Dashboard, which
ships its own payouts screen. It was rejected because it cannot set a Swellyo-wide default, it
needs a Connect setting toggled on outside this repo, and bouncing a React Native user to
Stripe's web dashboard is a worse experience than the screen we control.

---

## 3. The one UI rule worth defending

**"Pay out now" appears only when `interval` is `manual`.**

On an automatic schedule the available balance is swept the moment it clears, so the button
would read `Pay out $0.00` nearly always — which reads as *money gone missing*, not as a healthy
account. Stripe's own Express Dashboard hides it for exactly the same reason.

When a manual account has nothing available, the copy distinguishes the two states, because
they mean completely different things to someone waiting on money:

| Situation | Copy |
|---|---|
| Sold, still clearing | *"$1,200.00 is on its way but has not cleared yet."* |
| Nothing sold | *"Nothing to pay out yet."* |

---

## 4. The API surface

`supabase/functions/operator-payouts/` — three actions, all acting on **the caller's own**
Stripe account.

| Action | Does |
|---|---|
| `status` | Reads schedule, balance (available + pending), and whether the account has ever been paid out |
| `set_schedule` | `POST /v1/accounts/{id}` with `settings[payouts][schedule][…]` |
| `payout_now` | `POST /v1/payouts` with the `Stripe-Account` header |

### The gate is account-scoped, not trip-scoped

Every other money endpoint asks `trip_staff_can(trip_id, 'money.manage')`. This one does not,
and that is deliberate: **a payout schedule is not a fact about a trip.** It outlives any single
trip and covers the money from all of them. So the rule is the simplest one that is actually
true — *you may change the schedule of the payout account whose `user_id` is you*. There is no
account parameter in the request at all, so there is nothing to aim at someone else's money.
Trip staff and co-operators get nothing here.

### Things the server deliberately does not decide

- **The `delay_days` floor.** Stripe enforces the account's country minimum and returns a
  precise message (*"delay_days must be at least 2…"*). Re-implementing that rule here would
  either duplicate it wrongly or drift from it. We pass Stripe's message through.
- **Blocking a longer delay.** Raising `delay_days` is always allowed and is only ever safer for
  us — it leaves money where a refund can still reach it.
- **Anchors for the wrong interval.** `weekly_anchor` sent with `interval=daily` is a Stripe
  400, not a no-op, so an anchor is only ever sent for the interval that owns it.

---

## 5. Deliberately not built

- **No creation default.** `stripe-connect-onboard` still sets no schedule, so new accounts keep
  Stripe's country default. Decided 2026-09-02: least risk of breaking payouts for an operator
  in a country nobody thought about.
- **No `minimum_balance_by_currency`.** It defaults to 0 and *only funds in excess of it are
  paid out*, so "any balance goes to the bank" is already the behaviour. There was nothing to
  build.
- **No instant payouts.** Requires `manual` plus a debit card on the account; not asked for.

---

## 6. What is verified, and what is not

| | |
|---|---|
| Dashboard `tsc`, `build`, 151 tests (15 new) | ✅ pass |
| App `tsc` — new files and `SettingsScreen.tsx` | ✅ zero errors |
| Edge function type-check | ❌ **never** — no Deno locally, same as every other function here |
| Edge function boots | ✅ deployed 2026-09-02; anon-key call returns our own `{"error":"Not signed in"}` |
| `status` / `set_schedule` / `payout_now` against Stripe | ❌ **never run.** Needs a real operator JWT. |

Deployed with `npx supabase functions deploy operator-payouts --use-api`.

**First real check** — this is also the outstanding question the whole feature
started from, *"what is the 2 weeks?"*:

```bash
curl -s https://api.stripe.com/v1/accounts/acct_1U14lgHdTqJVIPkO -u "sk_test_KEY:" \
  | python3 -c "import sys,json;a=json.load(sys.stdin);print(a['settings']['payouts']['schedule'])"
```

If `interval` is `weekly`/`monthly`, the 2 weeks was the sweep and this feature fixes it. If
`delay_days` is 14, it was the clearing delay and this feature fixes it. If both look normal
(e.g. `daily`, `delay_days: 2`), it was the first-payout hold — and §1 is the answer, not a
setting.
