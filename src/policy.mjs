/**
 * SpendGuard core policy engine.
 *
 * The whole point of this project: an AI agent can be given spending power without being given unlimited
 * spending power. Every decision here is deterministic and pure, so it can be (a) unit tested, (b) replicated
 * on-chain by the Anchor/native program, and (c) audited by a judge line by line.
 *
 * Policy shape:
 *   dailyLimit   - maximum amount spendable per UTC day
 *   perTxLimit   - maximum amount for a single spend
 *   allowlist    - recipient addresses the agent may pay (empty array = deny everyone)
 *   paused       - kill switch; when true nothing is allowed
 *   expiryTs     - optional unix seconds after which the policy is dead (null = no expiry)
 */

export const DENY = {
  PAUSED: "policy_paused",
  EXPIRED: "policy_expired",
  AMOUNT_NONPOSITIVE: "amount_not_positive",
  PER_TX_LIMIT: "per_tx_limit_exceeded",
  DAILY_LIMIT: "daily_limit_exceeded",
  NOT_ALLOWLISTED: "recipient_not_allowlisted",
};

/** UTC day index, so "daily" is not affected by the operator's timezone. */
export function dayIndexOf(timestampMs) {
  return Math.floor(timestampMs / 86_400_000);
}

/** Fresh accounting state for a policy. */
export function initState(nowMs) {
  return { day: dayIndexOf(nowMs), spentToday: 0, totalSpent: 0, spends: 0 };
}

/**
 * Decide whether a spend is allowed, and return the state after it.
 * Never mutates its inputs; a denied spend leaves the state untouched.
 *
 * @returns {{allowed: boolean, reason: string|null, state: object}}
 */
export function evaluateSpend(policy, state, request, nowMs) {
  const amount = request.amount;

  if (policy.paused) return deny(DENY.PAUSED, state);
  if (policy.expiryTs != null && nowMs / 1000 > policy.expiryTs) return deny(DENY.EXPIRED, state);
  if (!Number.isFinite(amount) || amount <= 0) return deny(DENY.AMOUNT_NONPOSITIVE, state);
  if (amount > policy.perTxLimit) return deny(DENY.PER_TX_LIMIT, state);
  if (!policy.allowlist.includes(request.recipient)) return deny(DENY.NOT_ALLOWLISTED, state);

  // a new UTC day resets the daily counter
  const day = dayIndexOf(nowMs);
  const spentToday = day === state.day ? state.spentToday : 0;
  if (spentToday + amount > policy.dailyLimit) return deny(DENY.DAILY_LIMIT, state);

  return {
    allowed: true,
    reason: null,
    state: {
      day,
      spentToday: spentToday + amount,
      totalSpent: state.totalSpent + amount,
      spends: state.spends + 1,
    },
  };
}

function deny(reason, state) {
  return { allowed: false, reason, state };
}

/** Remaining budget for the current UTC day, for display and for agent planners. */
export function remainingToday(policy, state, nowMs) {
  const spent = state.day === dayIndexOf(nowMs) ? state.spentToday : 0;
  return Math.max(0, policy.dailyLimit - spent);
}

/** A spend is only defensible if the guard can point at the rule that allowed it. */
export function describePolicy(policy) {
  const parts = [
    `daily ${policy.dailyLimit}`,
    `per-tx ${policy.perTxLimit}`,
    `allowlist ${policy.allowlist.length} address(es)`,
    policy.paused ? "PAUSED" : "active",
  ];
  if (policy.expiryTs != null) parts.push(`expires ${new Date(policy.expiryTs * 1000).toISOString()}`);
  return parts.join(" · ");
}
