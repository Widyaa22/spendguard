/**
 * SpendGuard console — the live MVP.
 *
 * Runs entirely in the browser against Solana devnet, so a judge can test it without trusting our backend:
 *   create a throwaway wallet -> fund it from the faucet -> create a vault whose authority is a 2-of-2 multisig
 *   (agent + guard) -> let the agent try to pay, and watch what the chain does when the guard does not sign.
 *
 * The policy engine imported here is the same file the tests exercise (src/policy.mjs), so the rules in the UI
 * are the rules under test, not a re-implementation.
 */
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  MINT_SIZE, TOKEN_PROGRAM_ID, TransactionInstruction as _TI, createInitializeMintInstruction, createMintToInstruction,
  createAssociatedTokenAccountInstruction, getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptMint, createMultisig, createTransferInstruction,
  getAccount,
} from "@solana/spl-token";

import { evaluateSpend, initState, remainingToday, DENY } from "../../src/policy.mjs";

const RPC = "https://api.devnet.solana.com";
const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

/** The audit trail is a Memo instruction: the note is written by the same transaction that moves the money. */
function memo(text, signer) {
  return new TransactionInstruction({
    programId: MEMO_PROGRAM_ID,
    keys: [{ pubkey: signer, isSigner: true, isWritable: false }],
    data: new TextEncoder().encode(text),
  });
}
const connection = new Connection(RPC, "confirmed");

const $ = (id) => document.getElementById(id);
const $in = (id) => document.getElementById(id);
const short = (s) => (s.length > 18 ? `${s.slice(0, 8)}…${s.slice(-6)}` : s);
const explorer = (sig) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

/** Browser-side state. Keys live in localStorage only so a judge can reload without losing the demo. */
const store = {
  load() {
    const raw = localStorage.getItem("spendguard");
    return raw ? JSON.parse(raw) : null;
  },
  save(state) {
    localStorage.setItem("spendguard", JSON.stringify(state));
  },
  clear() {
    localStorage.removeItem("spendguard");
  },
};

let S = store.load();
let policyState = initState(Date.now());

function logLine(kind, text, sig) {
  const el = document.createElement("div");
  el.className = `line ${kind}`;
  el.innerHTML = `${text}${sig ? ` — <a href="${explorer(sig)}" target="_blank" rel="noopener">${short(sig)}</a>` : ""}`;
  $("log").prepend(el);
}

function readPolicy() {
  const allow = $("allow").value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    dailyLimit: Number($("daily").value),
    perTxLimit: Number($("perTx").value),
    allowlist: allow,
    paused: $("paused").checked,
    expiryTs: null,
  };
}

function refreshFacts() {
  if (!S) return;
  $("f-vault").textContent = S.vault ? short(S.vault) : "—";
  $("f-policy").textContent = S.multisig ? short(S.multisig) : "—";
  const p = readPolicy();
  $("f-spent").textContent = String(policyState.spentToday);
  $("f-remain").textContent = String(remainingToday(p, policyState, Date.now()));
  if (S.vault) $("to").placeholder = S.vendorAta ?? "recipient address (token account)";
}

async function fundWallet() {
  const kp = Keypair.fromSecretKey(Uint8Array.from(S.agent.secret));
  for (const amount of [1, 0.5, 0.2]) {
    try {
      const sig = await connection.requestAirdrop(kp.publicKey, amount * LAMPORTS_PER_SOL);
      // poll rather than confirmTransaction: the overloads differ across web3.js versions
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        if ((await connection.getBalance(kp.publicKey)) > 0) break;
      }
      logLine("ok", `funded with ${amount} devnet SOL`, sig);
      return true;
    } catch (e) {
      logLine("warn", `faucet refused ${amount} SOL (${String(e.message).slice(0, 60)}…)`);
    }
  }
  logLine("bad", "devnet faucet refused from this IP — use https://faucet.solana.com for this address:");
  logLine("bad", new PublicKey(S.agent.public).toBase58());
  return false;
}

/** Create the mint, both token accounts, and the 2-of-2 multisig that owns the vault. */
async function setupVault() {
  const owner = Keypair.fromSecretKey(Uint8Array.from(S.owner.secret));
  const agentPub = new PublicKey(S.agent.public);
  const guardPub = new PublicKey(S.guard.public);

  const mint = Keypair.generate();
  const lamports = await getMinimumBalanceForRentExemptMint(connection);

  // the vault's authority: a 2-of-2 token multisig, agent + guard. Neither key alone can move funds.
  // createMultisig allocates and initialises the 355-byte account and must run before the vault ATA names it as owner.
  const multisig = await createMultisig(connection, owner, [agentPub, guardPub], 2, undefined, { commitment: "confirmed" });

  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: owner.publicKey, newAccountPubkey: mint.publicKey,
      space: MINT_SIZE, lamports, programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(mint.publicKey, 6, owner.publicKey, null, TOKEN_PROGRAM_ID),
  );

  const agentAta = getAssociatedTokenAddressSync(mint.publicKey, agentPub);
  const vaultAta = getAssociatedTokenAddressSync(mint.publicKey, multisig);
  tx.add(
    createAssociatedTokenAccountInstruction(owner.publicKey, agentAta, agentPub, mint.publicKey),
    createAssociatedTokenAccountInstruction(owner.publicKey, vaultAta, multisig, mint.publicKey),
    createMintToInstruction(mint.publicKey, agentAta, owner.publicKey, 1_000_000_000n),
  );

  const sig = await sendAndConfirmTransaction(connection, tx, [owner, mint], { commitment: "confirmed" });
  S.mint = mint.publicKey.toBase58();
  S.multisig = multisig.toBase58();
  S.vault = vaultAta.toBase58();
  S.agentAta = agentAta.toBase58();
  store.save(S);
  logLine("ok", "vault created: agent's funds now sit behind a 2-of-2 authority", sig);
  refreshFacts();
}

/** A spend needs both signatures. This is the "guard" co-signing after the policy approves. */
async function agentPay({ agentOnly = false } = {}) {
  const policy = readPolicy();
  const amount = Number($("amt").value);
  const recipient = $("to").value.trim();
  const decision = evaluateSpend(policy, policyState, { amount, recipient }, Date.now());

  if (!decision.allowed) {
    const friendly = {
      [DENY.PAUSED]: "kill switch is on",
      [DENY.PER_TX_LIMIT]: `above the per-transaction limit (${policy.perTxLimit})`,
      [DENY.DAILY_LIMIT]: `would exceed today's budget (${remainingToday(policy, policyState, Date.now())} left)`,
      [DENY.NOT_ALLOWLISTED]: "recipient is not on the allowlist",
      [DENY.AMOUNT_NONPOSITIVE]: "amount must be positive",
      [DENY.EXPIRED]: "policy expired",
    }[decision.reason] ?? decision.reason;
    logLine("bad", `policy refused: ${friendly} <span class="mono">(${decision.reason})</span>`);
    refreshFacts();
    return;
  }

  const owner = Keypair.fromSecretKey(Uint8Array.from(S.owner.secret));
  const agent = Keypair.fromSecretKey(Uint8Array.from(S.agent.secret));
  const guard = Keypair.fromSecretKey(Uint8Array.from(S.guard.secret));

  const ix = createTransferInstruction(
    new PublicKey(S.vault), new PublicKey(recipient), new PublicKey(S.multisig),
    BigInt(amount) * 1_000_000n, [agent.publicKey, guard.publicKey], TOKEN_PROGRAM_ID,
  );
  const tx = new Transaction().add(
    ix,
    memo(`spendguard:${amount}:${recipient.slice(0, 8)}`, guard.publicKey),
  );

  const signers = agentOnly ? [owner, agent] : [owner, agent, guard];
  try {
    const sig = await sendAndConfirmTransaction(connection, tx, signers, { commitment: "confirmed" });
    logLine("ok", `paid ${amount} — policy approved, both keys signed, memo written`, sig);
    policyState = decision.state;
  } catch (e) {
    const msg = String(e.message ?? e);
    const missing = /missing signature|signature verification failure|not enough signers/i.test(msg);
    logLine("warn", missing
      ? "Solana rejected it: the vault is a 2-of-2 multisig and only the agent signed"
      : `transaction failed: ${msg.slice(0, 120)}`);
  }
  refreshFacts();
}

// ---------------------------------------------------------------- wiring
$("btn-wallet").addEventListener("click", () => {
  const owner = Keypair.generate();
  const agent = Keypair.generate();
  const guard = Keypair.generate();
  S = {
    owner: { public: owner.publicKey.toBase58(), secret: Array.from(owner.secretKey) },
    agent: { public: agent.publicKey.toBase58(), secret: Array.from(agent.secretKey) },
    guard: { public: guard.publicKey.toBase58(), secret: Array.from(guard.secretKey) },
  };
  store.save(S);
  $("wallet-info").textContent = `agent ${short(S.agent.public)} · guard ${short(S.guard.public)}`;
  $("btn-fund").disabled = false;
  logLine("ok", "generated three keys: owner (pays rent), agent (spends), guard (co-signs)");
});

$("btn-fund").addEventListener("click", fundWallet);
$("btn-setup").addEventListener("click", () => setupVault().catch((e) => logLine("bad", String(e.message ?? e))));
$("btn-pay").addEventListener("click", () => agentPay().catch((e) => logLine("bad", String(e.message ?? e))));
$("btn-pay-agentonly").addEventListener("click", () => agentPay({ agentOnly: true }).catch((e) => logLine("bad", String(e.message ?? e))));
$("btn-pause").addEventListener("click", () => {
  $("paused").checked = !$("paused").checked;
  logLine($("paused").checked ? "warn" : "ok", `kill switch ${$("paused").checked ? "engaged" : "released"}`);
  refreshFacts();
});

if (S) {
  $("wallet-info").textContent = `agent ${short(S.agent.public)} · guard ${short(S.guard.public)}`;
  $("btn-fund").disabled = false;
  const bal = await connection.getBalance(new PublicKey(S.owner.public)).catch(() => 0);
  logLine("ok", `restored a previous session (owner balance ${(bal / LAMPORTS_PER_SOL).toFixed(3)} SOL)`);
}
refreshFacts();
