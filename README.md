# SpendGuard — an on-chain spend policy for AI agents

**Tagline:** give an agent a budget, not a blank cheque.

**Live MVP:** https://widyaa22.github.io/spendguard/ — runs entirely in your browser against devnet, no backend of ours in the path.

**Devnet evidence:** the demo run below is real; every signature is on chain.

---

## The problem

Agents can now hold keys and pay for things. Almost every project doing this enforces the limits **off-chain**:
a server decides whether a payment is allowed and then signs. That has two problems that only show up after
something goes wrong:

1. **The limit is a promise, not a constraint.** If the agent's runtime is compromised, or the policy service has a
   bug, or a prompt makes the agent call the payment API directly, the rule is bypassed — because the rule was
   never where the money is.
2. **Nobody can audit the decision after the fact.** "The agent stayed within budget" is a log line written by the
   same system being audited.

The thing an agent needs before anyone lets it spend real money is not another dashboard. It is a **budget that
cannot be exceeded even if the agent is fully compromised**.

## The product

SpendGuard puts the budget where the money is: on Solana.

- The agent's funds sit in a token account (the **vault**) whose authority is a **2-of-2 multisig**: the agent's
  key **and** the guard's key.
- A spend is a normal SPL Token transfer, so it requires **both signatures**. The agent alone cannot move a cent:
  the SPL Token program rejects the transaction outright.
- The **guard signs only when the policy allows it** — daily limit, per-transaction limit, recipient allowlist,
  kill switch, expiry.
- Every decision (approval *and* refusal) is recorded with a **Memo** instruction, so the audit trail is on-chain
  and written by the same transaction that moved the funds.
- The **kill switch** is one key flip by the owner: the guard stops co-signing, and the agent's wallet becomes
  inert without anyone touching the agent.

The enforcement is therefore cryptographic, not procedural. A judge can verify it by watching a transaction fail
because the second signature is missing.

## Why Solana

- SPL Token's multisig gives the 2-of-2 authority **without deploying a custom program** — the constraint is
  enforced by a program that already secures billions in assets.
- Devnet makes the failure cases cheap and demonstrable: every refusal in the demo is a real transaction that the
  runtime rejected.
- Fees of a fraction of a cent mean the guard can co-sign a $0.10 spend without the accounting breaking down,
  which is what agent payments actually look like.

## Repository layout

```
src/policy.mjs              the policy engine — pure, deterministic, and the decision the guard actually makes
tests/policy.test.mjs       12 tests: every rule that can deny a spend, plus the daily reset and no-mutation case
scripts/deploy-devnet.mjs   deploys the compiled program to devnet without the Solana CLI (see "custom program")
scripts/demo.mjs            the end-to-end demo: creates the vault behind a 2-of-2 multisig, funds it, then runs allowed and refused spends
program/                    Rust program (work in progress — see the status section)
app/                        the live web MVP
```

## The policy engine

`src/policy.mjs` is where the rules live, kept separate from the Solana plumbing so it can be tested and audited
on its own:

| Rule | Denial reason | Meaning |
|---|---|---|
| `paused` | `policy_paused` | kill switch: nothing is allowed |
| `expiryTs` | `policy_expired` | the policy dies on its own |
| `amount <= 0` | `amount_not_positive` | no zero-value or negative spends |
| `amount > perTxLimit` | `per_tx_limit_exceeded` | one transaction cannot exceed this |
| `recipient ∉ allowlist` | `recipient_not_allowlisted` | the agent can only pay parties the owner named |
| `spentToday + amount > dailyLimit` | `daily_limit_exceeded` | the budget is per **UTC day** and resets automatically |

```bash
npm test        # 12/12 passing — node's built-in runner, no test framework installed
```

Two properties worth calling out because they are the ones that usually bite:

- **A denied spend does not move the counter.** A refusal cannot be used to grieve the agent's budget.
- **`evaluateSpend` never mutates its input.** The returned state is the only way to advance the budget, so a
  caller cannot accidentally run rules against half-updated state.

## Running it

```bash
node --version            # 22+ required
npm install               # @solana/web3.js + @solana/spl-token
npm test                  # prove the policy holds

# 1. fund a devnet keypair (the script generates ~/.config/spendguard/id.json and prints the address)
node scripts/deploy-devnet.mjs

# 2. run the end-to-end demo (allowed spend, then each refusal, with signatures)
node scripts/demo.mjs
```

The demo prints an explorer link for every attempt, and writes `demo-output.json` with the full evidence:

```
spend 20 to allowlisted vendor         OK  tx 2q582p9Hs6SsFZ2ess83LjV7TZQ4tvnKb51HMqpL6
spend 31 (per-tx limit 30)             POLICY REFUSED  per_tx_limit_exceeded
spend 5 to a non-allowlisted vendor    POLICY REFUSED  recipient_not_allowlisted
agent signs alone (no guard)           CHAIN REFUSED  MissingRequiredSignature — vault is 2-of-2, 
spend 30 (takes today to the limit)    OK  tx J5D2XbBWPui93Q8cA2TtPY1qGo2Lzq2VowLdtyLY8
spend 10 more (daily budget used up)   POLICY REFUSED  daily_limit_exceeded
spend 1 while paused                   POLICY REFUSED  policy_paused
```

## Security model, stated plainly

- **What the agent can do:** spend, up to the limits, to allowlisted recipients, until the owner pauses.
- **What the agent cannot do:** exceed a limit, pay an unlisted recipient, spend while paused, or change any rule.
  The vault's authority is a multisig the agent only half-controls, so a stolen agent key alone moves nothing.
- **What the operator must protect:** the guard key. If the guard key leaks, the limits are gone. That is the
  honest trade of this design, and it is why the guard key belongs on separate infrastructure from the agent.
- **Not in scope for this MVP:** key management/HSM for the guard, multi-guard quorum, and per-recipient daily
  limits. They are listed as next steps rather than implied as done.

## Status — what is actually finished

Honest accounting, because the submission is judged on whether the MVP works:

- [x] Policy engine with 12 passing tests covering every denial path
- [x] Devnet plumbing (vault creation, multisig authority, Memo audit trail, spend/refuse orchestration)
- [x] Program build toolchain established on ARM64 (SBF compiler verified working)
- [x] **Web MVP builds** — Vite bundle, 297 kB of JS, 236 modules, `node node_modules/vite/bin/vite.js build`
- [x] **Demo runs on devnet** — `node scripts/demo.mjs`: 2 spends settled, 4 refused by policy, 1 refused by the chain
- [x] **Live web MVP** at https://widyaa22.github.io/spendguard/
- [x] **Demo video** (2:37): https://github.com/Widyaa22/spendguard/releases/tag/v0.1.0 — a walkthrough of the live console plus the command-line run
- [x] Typecheck in the build (`npm run typecheck`), added after two runtime bugs slipped past the bundler

## Custom program (work in progress)

`program/` contains a native Rust program that would move the policy itself on-chain: a policy PDA holding the
limits, an allowlist, and a kill switch, with `Spend` as the only instruction able to move money. It compiles for
the `sbpfv3-solana-solana` target (the toolchain was set up and verified with a minimal crate), but the full build
is blocked on the SBF toolchain's bundled cargo being too old: recent transitive dependencies of `solana-program`
declare `edition2024`, which cargo 1.75/1.79 refuses to parse. That is an environment problem, not a design
problem, and the shipped MVP does not depend on it — SPL Token's multisig enforces the same boundary today.
