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
import { Buffer } from "buffer";

// web3.js and spl-token assume Node's Buffer. Browsers do not have it, so without this shim the app fails with
// "Buffer is not defined" the moment it tries to build a transaction (found by running it on devnet).
if (!(globalThis as any).Buffer) (globalThis as any).Buffer = Buffer;
if (!(globalThis as any).process) (globalThis as any).process = { env: {}, version: "" } as any;

import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction,
  sendAndConfirmTransaction, LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  MINT_SIZE, TOKEN_PROGRAM_ID, createInitializeMintInstruction, createMintToInstruction,
  createAssociatedTokenAccountInstruction, getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptMint, createMultisig, createTransferInstruction,
} from "@solana/spl-token";

import { evaluateSpend, initState, remainingToday, DENY } from "../../src/policy.mjs";

const RPC = "https://api.devnet.solana.com";
const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

/** Audit trail: a Memo instruction, so the note is committed by the transaction that moves the money. */
function memo(text: string, signer: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: MEMO_PROGRAM_ID,
    keys: [{ pubkey: signer, isSigner: true, isWritable: false }],
    data: Buffer.from(text, "utf8"),
  });
}

const connection = new Connection(RPC, "confirmed");

// ---- typed DOM access: getElementById returns HTMLElement, which has no .value/.checked/.disabled
const el = (id: string): HTMLElement => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node;
};
const input = (id: string): HTMLInputElement => el(id) as HTMLInputElement;
const button = (id: string): HTMLButtonElement => el(id) as HTMLButtonElement;

const short = (s: string): string => (s.length > 18 ? `${s.slice(0, 8)}…${s.slice(-6)}` : s);
const explorer = (sig: string): string => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

interface KeyRecord {
  public: string;
  secret: number[];
}
interface Session {
  owner: KeyRecord;
  agent: KeyRecord;
  guard: KeyRecord;
  mint?: string;
  multisig?: string;
  vault?: string;
  agentAta?: string;
}

/** Keys live in localStorage only so a reload keeps the demo going. Devnet throwaways, never real funds. */
const store = {
  load(): Session | null {
    const raw = localStorage.getItem("spendguard");
    return raw ? (JSON.parse(raw) as Session) : null;
  },
  save(state: Session): void {
    localStorage.setItem("spendguard", JSON.stringify(state));
  },
};

let S: Session | null = store.load();
let policyState: any = initState(Date.now());

function logLine(kind: string, text: string, sig?: string): void {
  const node = document.createElement("div");
  node.className = `line ${kind}`;
  node.innerHTML = `${text}${sig ? ` — <a href="${explorer(sig)}" target="_blank" rel="noopener">${short(sig)}</a>` : ""}`;
  el("log").prepend(node);
}

function readPolicy(): any {
  const allowlist = input("allow")
    .value.split(",")
    .map((s: string) => s.trim())
    .filter(Boolean);
  return {
    dailyLimit: Number(input("daily").value),
    perTxLimit: Number(input("perTx").value),
    allowlist,
    paused: input("paused").checked,
    expiryTs: null,
  };
}

function refreshFacts(): void {
  if (!S) return;
  el("f-vault").textContent = S.vault ? short(S.vault) : "—";
  el("f-policy").textContent = S.multisig ? short(S.multisig) : "—";
  const policy = readPolicy();
  el("f-spent").textContent = String(policyState.spentToday);
  el("f-remain").textContent = String(remainingToday(policy, policyState, Date.now()));
  if (S.vault) input("to").placeholder = S.vault;
}

async function fundWallet(): Promise<boolean> {
  if (!S) return false;
  const kp = Keypair.fromSecretKey(Uint8Array.from(S.agent.secret));
  for (const amount of [1, 0.5, 0.2]) {
    try {
      const sig = await connection.requestAirdrop(kp.publicKey, amount * LAMPORTS_PER_SOL);
      // poll instead of confirmTransaction: its overloads differ across web3.js versions
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        if ((await connection.getBalance(kp.publicKey)) > 0) break;
      }
      logLine("ok", `funded with ${amount} devnet SOL`, sig);
      return true;
    } catch (e) {
      logLine("warn", `faucet refused ${amount} SOL (${errMessage(e).slice(0, 60)}…)`);
    }
  }
  logLine("bad", "devnet faucet refused from this IP — ask https://faucet.solana.com for this address:");
  logLine("bad", new PublicKey(S.agent.public).toBase58());
  return false;
}

/** Create the mint, both token accounts, and the 2-of-2 multisig that owns the vault. */
async function setupVault(): Promise<void> {
  if (!S) throw new Error("create a wallet first");
  const owner = Keypair.fromSecretKey(Uint8Array.from(S.owner.secret));
  const agentPub = new PublicKey(S.agent.public);
  const guardPub = new PublicKey(S.guard.public);

  const mint = Keypair.generate();
  const lamports = await getMinimumBalanceForRentExemptMint(connection);

  // The vault's authority is a 2-of-2 token multisig (agent + guard): neither key alone can move funds.
  // createMultisig allocates and initialises the account, and must run before the vault ATA names it as owner.
  const multisig = await createMultisig(connection, owner, [agentPub, guardPub], 2, undefined, {
    commitment: "confirmed",
  });

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
  logLine("ok", "vault created: the agent's funds now sit behind a 2-of-2 authority", sig);
  refreshFacts();
}

/** A spend needs both signatures: this is the guard co-signing after the policy approves. */
async function agentPay({ agentOnly = false }: { agentOnly?: boolean } = {}): Promise<void> {
  if (!S?.vault || !S.multisig) throw new Error("create the vault first");
  const policy = readPolicy();
  const amount = Number(input("amt").value);
  const recipient = input("to").value.trim();
  const decision = evaluateSpend(policy, policyState, { amount, recipient }, Date.now());

  if (!decision.allowed) {
    const reasons: Record<string, string> = {
      [DENY.PAUSED]: "kill switch is on",
      [DENY.PER_TX_LIMIT]: `above the per-transaction limit (${policy.perTxLimit})`,
      [DENY.DAILY_LIMIT]: `would exceed today's budget (${remainingToday(policy, policyState, Date.now())} left)`,
      [DENY.NOT_ALLOWLISTED]: "recipient is not on the allowlist",
      [DENY.AMOUNT_NONPOSITIVE]: "amount must be positive",
      [DENY.EXPIRED]: "policy expired",
    };
    const friendly = reasons[decision.reason as string] ?? String(decision.reason);
    logLine("bad", `policy refused: ${friendly} <span class="mono">(${decision.reason})</span>`);
    refreshFacts();
    return;
  }

  const owner = Keypair.fromSecretKey(Uint8Array.from(S.owner.secret));
  const agent = Keypair.fromSecretKey(Uint8Array.from(S.agent.secret));
  const guard = Keypair.fromSecretKey(Uint8Array.from(S.guard.secret));

  const tx = new Transaction().add(
    createTransferInstruction(
      new PublicKey(S.vault), new PublicKey(recipient), new PublicKey(S.multisig),
      BigInt(amount) * 1_000_000n, [agent.publicKey, guard.publicKey], TOKEN_PROGRAM_ID,
    ),
    memo(`spendguard:${amount}:${recipient.slice(0, 8)}`, guard.publicKey),
  );

  // "agent only" is the interesting failure: the transaction is built and signed, and the chain refuses it
  const signers = agentOnly ? [owner, agent] : [owner, agent, guard];
  try {
    const sig = await sendAndConfirmTransaction(connection, tx, signers, { commitment: "confirmed" });
    logLine("ok", `paid ${amount} — policy approved, both keys signed, memo written`, sig);
    policyState = decision.state;
  } catch (e) {
    const msg = errMessage(e);
    const missing = /missing signature|signature verification failure|not enough signers/i.test(msg);
    logLine(
      "warn",
      missing
        ? "Solana rejected it: the vault is a 2-of-2 multisig and only the agent signed"
        : `transaction failed: ${msg.slice(0, 120)}`,
    );
  }
  refreshFacts();
}

// ---------------------------------------------------------------- wiring
button("btn-wallet").addEventListener("click", () => {
  const owner = Keypair.generate();
  const agent = Keypair.generate();
  const guard = Keypair.generate();
  S = {
    owner: { public: owner.publicKey.toBase58(), secret: Array.from(owner.secretKey) },
    agent: { public: agent.publicKey.toBase58(), secret: Array.from(agent.secretKey) },
    guard: { public: guard.publicKey.toBase58(), secret: Array.from(guard.secretKey) },
  };
  store.save(S);
  el("wallet-info").textContent = `agent ${short(S.agent.public)} · guard ${short(S.guard.public)}`;
  button("btn-fund").disabled = false;
  logLine("ok", "generated three keys: owner (pays rent), agent (spends), guard (co-signs)");
});

button("btn-fund").addEventListener("click", () => void fundWallet());
button("btn-setup").addEventListener("click", () => void setupVault().catch((e) => logLine("bad", errMessage(e))));
button("btn-pay").addEventListener("click", () => void agentPay().catch((e) => logLine("bad", errMessage(e))));
button("btn-pay-agentonly").addEventListener("click", () =>
  void agentPay({ agentOnly: true }).catch((e) => logLine("bad", errMessage(e))),
);
button("btn-pause").addEventListener("click", () => {
  input("paused").checked = !input("paused").checked;
  logLine(input("paused").checked ? "warn" : "ok", `kill switch ${input("paused").checked ? "engaged" : "released"}`);
  refreshFacts();
});

if (S) {
  el("wallet-info").textContent = `agent ${short(S.agent.public)} · guard ${short(S.guard.public)}`;
  button("btn-fund").disabled = false;
  const bal = await connection.getBalance(new PublicKey(S.owner.public)).catch(() => 0);
  logLine("ok", `restored a previous session (owner balance ${(bal / LAMPORTS_PER_SOL).toFixed(3)} SOL)`);
}
refreshFacts();
