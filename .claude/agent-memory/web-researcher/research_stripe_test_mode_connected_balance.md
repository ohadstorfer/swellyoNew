---
name: research_stripe_test_mode_connected_balance
description: How to fund a Connect connected account's AVAILABLE balance in Stripe test mode so reverse_transfer refunds succeed (destination charges + on_behalf_of)
metadata:
  type: reference
---

Researched 2026-08-19 for Swellyo operator-trips Stripe refund testing (destination charges + `on_behalf_of` + `transfer_data[destination]`, refund via `reverse_transfer` + `refund_application_fee`).

## The bypass-pending test card
- `4000 0000 0000 0077` (US) and `4000003720000278` (international) — official Stripe test cards that add charge funds directly to **available** balance, skipping the normal pending window. Named-token equivalents: `tok_bypassPending`, `pm_card_bypassPending`, `tok_bypassPendingInternational`. Source: https://docs.stripe.com/testing and the 2015-02-10 changelog https://docs.stripe.com/changelog/2015-02-10/transfers-require-sufficient-balance-test-mode (that changelog is *why* the card exists: "Test mode transfers now require sufficient funds in your available test mode balance... Add funds directly to your available test mode balance... by creating a charge using 4000 0000 0000 0077").
- **Unresolved/unconfirmed by Stripe docs**: whether this card, used as the customer's payment method on a `on_behalf_of`-flagged destination charge (settlement merchant = connected account), lands the funds in the *connected account's* available balance directly, or only guarantees the *platform's* available balance is sufficient for the automatic internal transfer (after which the connected account's own `delay_days` clock still applies). Could not find an explicit Stripe statement either way for the `on_behalf_of` case specifically. Must verify empirically with `GET /v1/balance -H "Stripe-Account: acct_..."` immediately after the charge.
- General destination-charges doc (https://docs.stripe.com/connect/destination-charges) confirms: with `on_behalf_of` set, "the number of days that a pending balance is held before being paid out depends on the `delay_days` setting on the connected account" — i.e. settlement risk/timing shifts to the connected account, not the platform.

## Fallback: fund platform, then explicit Transfer
1. Fund platform's own available balance with a **plain, non-Connect** charge using the bypass card (no `on_behalf_of`/`transfer_data`) — guarantees platform available balance instantly.
2. `POST /v1/transfers` (destination=acct_...) moves those already-available platform funds to the connected account.
3. Per https://docs.stripe.com/connect/account-balances: "if you attempt to transfer funds from your platform's balance to a connected account's balance, but your platform has insufficient available funds, that transfer attempt fails" and does NOT auto-retry — fund first, transfer second, always in that order.
4. The 2015-07-28 changelog (https://docs.stripe.com/changelog/2015-07-28/transfers-immediately-processed-trigger-balance-available) confirms Stripe has a category of "immediately processed" transfers that fire `balance.available` right away — this is the closest official evidence that manually-created Transfers of already-settled platform funds become available on the destination side quickly (the "Separate Charges and Transfers" model, distinct from the on_behalf_of destination-charge model).

## Stripe CLI
No dedicated one-liner for "fund a connected account." `stripe trigger` uses canned fixtures and does not accept `on_behalf_of`/`transfer_data`/custom card params. Use the CLI's raw resource commands instead, e.g. `stripe charges create --source=tok_bypassPending ...`, `stripe transfers create --destination=acct_... ...`, `stripe balance retrieve --stripe-account=acct_...` — these just wrap the REST API 1:1.

## Payout schedule / delay_days — does NOT help the way people assume
- `settings[payouts][schedule][interval]=manual` only stops Stripe auto-paying the balance OUT to the connected account's bank. It does **not** change when internal funds move pending→available. That's governed by `settlement_timing.delay_days` (Balance Settings API) / legacy `payouts.schedule.delay_days`.
- Per https://docs.stripe.com/connect/manage-payout-schedule: `delay_days_override` is only editable "on accounts where you own fraud and dispute liability." Express accounts (Stripe-liability by default) generally do NOT let the platform override this — so this lever is likely unavailable for a standard Express setup. Don't waste time trying `interval=manual` expecting it to unblock available balance.

## debit_negative_balances is orthogonal
- It only controls whether Stripe auto-debits the connected account's *external bank account* after the fact, once their Stripe balance is already negative. It's a recovery mechanism, not a pre-funding mechanism — doesn't make a refund "free" up front.
- Found but unverified-for-this-exact-flow: a Stripe refunds doc snippet states "Refunds use your available Stripe balance. If your available balance doesn't cover the amount of the refund, Stripe holds the refund as pending for card transactions until your Stripe balance becomes sufficient" — i.e., Stripe's own API may not hard-reject for insufficient balance the way [[project_operator_becomes_merchant_of_record]]'s app-level guardrail does (that guardrail is Swellyo's own code checking `GET /v1/balance` pre-emptively, not a Stripe-imposed rule). Worth a product conversation about whether that check should be a hard block or a queue/warn, independent of the test-funding question.

## Recommended test recipe (given the above)
1. `POST /v1/payment_intents` (or classic `/v1/charges`) with `payment_method=pm_card_bypassPending`, `on_behalf_of=acct_...`, `transfer_data[destination]=acct_...`, `confirm=true`.
2. Immediately `GET /v1/balance -H "Stripe-Account: acct_..."`. If `available` > 0, refund test can proceed as-is.
3. If still `pending` on the connected account, fall back to: plain bypass-card charge on the platform (no Connect params) → `POST /v1/transfers` to the connected account → re-check balance.
