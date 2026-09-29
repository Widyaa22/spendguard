# SpendGuard — submission pack

Two bounties, one project:

| Listing | Reward | Deadline | What it needs |
|---|---|---|---|
| Road to Colosseum Hackathon: Build your MVP | $8,000 pool, 10 winners ($2,000 → $250) | 2026-10-05 | name+tagline, problem, Solana integration, live link, demo video, public repo, deployment details, **Colosseum registration with country = Germany** |
| Colosseum: Show Us What You Got | $1,500, 3 winners ($700/$500/$300) | 2026-10-04 | 2-minute video pitch on X explaining what you are building, why it matters, why you |

Both are `HUMAN_ONLY`: the operator submits on the listing page; the agent cannot.

---

## 1 · Project Name & Tagline

```
SpendGuard — give an agent a budget, not a blank cheque.
```

## 2 · Problem & Product

```
Agents can already hold keys and pay for things. Almost everyone doing this enforces the limits off-chain: a
service decides whether a payment is allowed, then signs. That means the limit is a promise, not a constraint —
if the agent's runtime is compromised, if the policy service has a bug, or if a prompt convinces the agent to call
the payment path directly, the rule is gone, because the rule was never where the money was. And after the fact,
nobody can audit the decision: "the agent stayed within budget" is a log line written by the same system under
audit.

SpendGuard puts the budget where the money is. The agent's funds sit in a token account whose authority is a
2-of-2 multisig — the agent's key and the guard's key — so a spend is a normal SPL Token transfer and requires
both signatures. The agent alone cannot move a cent: the token program rejects the transaction outright. The
guard co-signs only when the policy allows it (daily limit, per-transaction limit, recipient allowlist, kill
switch, expiry), and every decision — approval or refusal — is written as a Memo instruction inside the same
transaction that moves the funds, so the audit trail is produced by the chain rather than by the service.

The owner keeps a kill switch: one key flip stops the guard co-signing and the agent's wallet becomes inert,
without touching the agent's key or its runtime.
```

## 3 · Solana Integration

```
Enforcement is on-chain and uses the SPL Token program's native multisig authority:

* The vault is an associated token account whose owner is a 2-of-2 SPL Token multisig (agent + guard), created
  with createInitializeMultisigInstruction. Neither key alone can move funds, and that is enforced by the token
  program itself, not by our code.
* A payment is a createTransferInstruction from the vault, with the multisig as authority and both signer pubkeys
  declared. Sent with only the agent's signature, the runtime rejects it — the refusal cases in the demo are real
  rejected transactions, not simulated branches.
* Every approved spend carries a Memo instruction (MemoSq4g…) so the audit note is committed atomically with the
  transfer.
* The policy engine is a pure module with 12 unit tests covering every denial path, the UTC-day budget reset, the
  "a denied spend must not move the counter" property, and immutability of the input state.
* Devnet end to end: test mint, associated token accounts, funded vault, allowed spends and refused spends, each
  with a signature.

Nothing here needs a bespoke program: the constraint is enforced by the same audited token program that secures
the rest of the ecosystem, which is also why it is cheap to verify.
```

## 4 · Live MVP / Test Link

```
https://widyaa22.github.io/spendguard/

The console runs entirely in the browser against devnet, with no backend of ours in the path: it creates a
throwaway wallet, requests devnet SOL, creates the vault behind a 2-of-2 multisig, then lets the agent try to pay
so you can watch the chain itself refuse when only the agent signs. Source: https://github.com/Widyaa22/spendguard
```

## 5 · Demo Video (2–3 minutes)

```
TODO — script below, rendered from a real devnet run.
```

## 6 · Public GitHub Repository

```
https://github.com/Widyaa22/spendguard

Public, MIT licensed, with the README carrying setup and run instructions.
```

## 7 · Deployment Details

```
Cluster: Devnet
Web console (live): https://widyaa22.github.io/spendguard/  ([repo](https://github.com/Widyaa22/spendguard))
Vault authority: SPL Token 2-of-2 multisig BUuFED3zGAqNydBdGLdKdzsPaVkbtLaSZwCZM3PfDMzu
  members: agent A9osRpNbv4MQg2XbyL7xYgg7yxSk5f2y8XyHnz4VQBq6 | guard BruEAE1PRScE2y97zg6FgpDVTMZHnipirqA8xSjS5muU
Vault token account: 6ZpFuyukWdpbXgQoNKsVxtHpLmjtwuEtNVRXRZ5PBNkR
Test mint: 9DrdeQ78WzMSsM1uGFd3yu9jD1QHyebg6PJYXCPK7ucB  (agent's ATA A9osRpNbv4MQg2XbyL7xYgg7yxSk5f2y8XyHnz4VQBq6, vendor ATA 72iB4icHCswt9w4S2WRreX1jcGP3DWvgmWLFypFggS6A)
Programs used: SPL Token (TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA), Memo (MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr)
Policy: daily 50, per-transaction 30, allowlist = the vendor's token account only
Run: 7 attempts -> 2 settled, 4 refused by policy, 1 refused by the chain
* `spend 20 to allowlisted vendor` -> settled
  https://explorer.solana.com/tx/2q582p9Hs6SsFZ2ess83LjV7TZQ4tvnKb51HMqpL6h43kUx4sUrXzXpNGLv5nheeQrqC7EXVDxnuyQXLo3Z3jNym?cluster=devnet
* `spend 31 (per-tx limit 30)` -> refused by policy (per_tx_limit_exceeded)
* `spend 5 to a non-allowlisted vendor` -> refused by policy (recipient_not_allowlisted)
* `agent signs alone (no guard)` -> refused by the chain: MissingRequiredSignature — vault is 2-of-2, agent signed alone
* `spend 30 (takes today to the limit)` -> settled
  https://explorer.solana.com/tx/J5D2XbBWPui93Q8cA2TtPY1qGo2Lzq2VowLdtyLY8f5znNojfAxFs585vjYgNjdMBZzYyztw99LVg9WFVv23GsN?cluster=devnet
* `spend 10 more (daily budget used up)` -> refused by policy (daily_limit_exceeded)
* `spend 1 while paused` -> refused by policy (policy_paused)
Note: a native Rust program implementing the policy on-chain is in program/ and compiles for the SBF target, but its
full build is blocked by the SBF toolchain's bundled cargo predating the edition2024 manifests of modern
transitive dependencies. The shipped MVP deliberately does not depend on it: SPL Token's multisig enforces the
same boundary today, which is the honest trade for a working MVP inside the deadline.
```

---

## Demo video script (target 2:40)

**0:00 – 0:20 — the problem, stated as a failure**
> "An agent with a wallet can pay anyone, any amount. Every project doing this enforces the limit in a server:
> the agent asks, the server says yes or no, the server signs. So the limit only holds while that server is
> correct. I want a budget that holds even if the agent is completely compromised. Watch what happens."

**0:20 – 0:50 — set up the constraint**
> "The agent's funds sit in this vault. Its authority is a two-of-two multisig: the agent's key and a guard key.
> That's a native SPL Token authority, so the token program enforces it. Nothing in my service can override it."

**0:50 – 1:40 — the agent spends, and gets refused**
> "The agent pays 20. The policy approves, the guard co-signs, the transfer lands — and there's a memo in the
> same transaction, so the audit note is on chain.
> Now the agent tries 31 with a limit of 30. The policy refuses it before it reaches the chain. Now the agent
> tries an address that is not on the allowlist — refused. Now it tries to spend past today's budget — refused.
> And here is the one that matters: the agent builds the transaction itself and signs with its own key only.
> Solana rejects it, because the vault is a two-of-two and the agent is only half of it."

**1:40 – 2:20 — the kill switch, then the honest limits**
> "One flip by the owner and the guard stops co-signing: the agent's wallet goes inert. The agent's key was never
> touched, and the agent never had to cooperate.
> What this does not solve: the guard key is now the thing to protect, and this MVP is single-guard with no HSM.
> Those are the next two things I would build, not things I am claiming."

**2:20 – 2:40 — close**
> "SpendGuard: a budget an agent cannot exceed, enforced by the token program instead of a promise. Repo and
> live devnet link in the submission."

---

## Colosseum pitch (2 minutes, for the second bounty)

Cover exactly three things the listing asks for: **what** you are building, **why** it matters, **why** you.
Use the same project; keep this video about the idea rather than the demo, and reuse the demo video's footage for
the middle 30 seconds.
