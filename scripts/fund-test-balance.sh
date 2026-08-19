#!/usr/bin/env bash
#
# Put test money into the operator's Stripe balance so refunds can be tested.
#
#   bash scripts/fund-test-balance.sh sk_test_xxxxx [dollars]
#
# WHY THIS EXISTS. Paying a trip in test mode does NOT give the operator a
# spendable balance: those charges sit in `pending` until Stripe's payout clock
# releases them, and the refund guardrail reads `available`. So a trip with
# $2,600 paid still refunds nothing. This funds `available` directly.
#
# Two steps, because Stripe requires both. A transfer from the platform to a
# connected account FAILS OUTRIGHT if the platform's own available balance does
# not cover it, and it does not retry — so the platform is funded first with the
# one test card that skips `pending` (`tok_bypassPending`, which exists for
# exactly this).
#
# TEST KEYS ONLY. The guard below refuses anything else: this script moves money
# and creates charges, which on a live key would be real.
set -euo pipefail

KEY="${1:-}"
DOLLARS="${2:-5000}"
ACCOUNT="${STRIPE_ACCOUNT:-acct_1U14lgHdTqJVIPkO}"

if [ -z "$KEY" ]; then
  cat <<'USAGE'
Usage: bash scripts/fund-test-balance.sh sk_test_xxxxx [dollars]

Get the key from:  Stripe Dashboard -> Developers -> API keys
                   (make sure the TEST MODE toggle is on)
USAGE
  exit 1
fi

case "$KEY" in
  sk_test_*) ;;
  *) echo "REFUSING: that is not a test key. This script creates charges."; exit 1 ;;
esac

CENTS=$(( DOLLARS * 100 ))

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# `available` is the only figure that matters — `pending` cannot fund a refund,
# which is the whole reason this script is needed.
balance() {
  # ⚠️ The shell wrapper is single-quoted, so double quotes inside need no
  # escaping — and MUST NOT have any. A backslash inside an f-string expression
  # is a SyntaxError on Python < 3.12, which is what this printed the first time.
  curl -s https://api.stripe.com/v1/balance \
    -u "$KEY:" -H "Stripe-Account: $ACCOUNT" \
  | python3 -c '
import json, sys
b = json.load(sys.stdin)
if "error" in b:
    print("  ERROR:", b["error"].get("message"))
    sys.exit(1)
def fmt(key):
    rows = b.get(key, [])
    if not rows:
        return "0.00"
    return ", ".join("%s %s" % (format(e["amount"] / 100, ",.2f"), e["currency"].upper()) for e in rows)
print("  available:", fmt("available"))
print("  pending:  ", fmt("pending"))'
}

say "Operator balance BEFORE ($ACCOUNT)"
balance

say "1/2 Funding the platform with \$$DOLLARS (bypasses the pending clock)"
curl -s https://api.stripe.com/v1/charges \
  -u "$KEY:" \
  -d amount="$CENTS" \
  -d currency=usd \
  -d source=tok_bypassPending \
  -d description="fund platform test balance" \
| python3 -c '
import json, sys
c = json.load(sys.stdin)
if "error" in c:
    print("  ERROR:", c["error"].get("message"))
    sys.exit(1)
print("  charge:", c["id"], c["status"])'

# ⚠️ Transfer what the platform ACTUALLY has, not what was asked for.
#
# Stripe takes its processing fee out of the funding charge — $20,000 in became
# $19,419.70 available — so transferring the nominal amount fails with
# "insufficient available funds" every time. Read the balance back and move the
# smaller of the two, rounded down to whole dollars so a rounding cent cannot
# reintroduce the same failure.
say "Checking what actually landed on the platform"
PLATFORM_CENTS=$(curl -s https://api.stripe.com/v1/balance -u "$KEY:" | python3 -c '
import json, sys
b = json.load(sys.stdin)
usd = [e for e in b.get("available", []) if e["currency"] == "usd"]
print(usd[0]["amount"] if usd else 0)')

MOVE=$CENTS
if [ "$PLATFORM_CENTS" -lt "$CENTS" ]; then
  MOVE=$(( PLATFORM_CENTS / 100 * 100 ))
fi
printf '  platform available: $%s — transferring $%s\n' \
  "$(( PLATFORM_CENTS / 100 ))" "$(( MOVE / 100 ))"

if [ "$MOVE" -le 0 ]; then
  echo "  Nothing to transfer. The funding charge did not land."
  exit 1
fi

say "2/2 Transferring \$$(( MOVE / 100 )) to the operator"
curl -s https://api.stripe.com/v1/transfers \
  -u "$KEY:" \
  -d amount="$MOVE" \
  -d currency=usd \
  -d destination="$ACCOUNT" \
| python3 -c '
import json, sys
t = json.load(sys.stdin)
if "error" in t:
    print("  ERROR:", t["error"].get("message"))
    sys.exit(1)
print("  transfer:", t["id"])'

say "Operator balance AFTER"
balance

cat <<'NOTE'

Done. One thing to remember while testing:

  The guardrail charges the NET, not the gross. Refunding $70 needs $61.60
  available, because Swellyo's 12% comes back separately. Fund more than the
  nominal amount or it will still refuse by a few dollars.
NOTE
