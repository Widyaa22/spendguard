#!/usr/bin/env node
/**
 * SpendGuard devnet demo — the evidence the submission rests on.
 *
 * Design under test: the agent's funds live in a token account whose authority is a **2-of-2 SPL Token
 * multisig** (agent key + guard key). The guard co-signs only when the policy allows. Two independent layers
 * are demonstrated, and the demo keeps them apart on purpose:
 *
 *   * policy refusals        — decided before any transaction exists (the guard simply does not co-sign)
 *   * an on-chain refusal    — the agent builds and sends the transaction itself, signed with its own key only,
 *                              and Solana rejects it because the vault is a 2-of-2 multisig
 *
 * Every allowed spend also carries a Memo instruction, so the audit note is committed by the same transaction
 * that moved the funds.
 *
 * Usage: node scripts/demo.mjs        (writes demo-output.json)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction,
  sendAndConfirmTransaction, LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  MINT_SIZE, TOKEN_PROGRAM_ID, createInitializeMintInstruction, createMintToInstruction,
  createAssociatedTokenAccountInstruction, getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptMint, createMultisig,
  createTransferInstruction, getAccount,
} from "@solana/spl-token";

import { evaluateSpend, initState, remainingToday } from "../src/policy.mjs";

const RPC = "https://api.devnet.solana.com";
const MEMO = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const KEY = join(homedir(), ".config", "spendguard", "id.json");
const DECIMALS = 6;
const UNIT = 10n ** BigInt(DECIMALS);
const DAILY = 50;
const PER_TX = 30;

const conn = new Connection(RPC, "confirmed");
const results = [];
const log = (...a) => console.log(...a);

function memo(text, signer) {
  return new TransactionInstruction({
    programId: MEMO,
    keys: [{ pubkey: signer, isSigner: true, isWritable: false }],
    data: Buffer.from(text, "utf8"),
  });
}

function record(kind, claim, detail) {
  results.push({ kind, claim, detail });
  const tag = { policy: "POLICY REFUSED", chain: "CHAIN REFUSED", ok: "OK" }[kind];
  log(`    ${claim.padEnd(38)} ${tag.padEnd(15)} ${detail}`);
}

async function main() {
  if (!existsSync(KEY)) throw new Error("run scripts/deploy-devnet.mjs once to create a keypair");
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(KEY, "utf8"))));
  const balance = await conn.getBalance(payer.publicKey);
  log(`[*] payer  ${payer.publicKey.toBase58()} (${(balance / LAMPORTS_PER_SOL).toFixed(2)} SOL)`);
  if (balance < 0.02 * LAMPORTS_PER_SOL) throw new Error("not enough devnet SOL");

  // ---- actors
  const agent = Keypair.generate();
  const guard = Keypair.generate();
  const vendor = Keypair.generate();
  const stranger = Keypair.generate();
  await sendAndConfirmTransaction(conn, new Transaction().add(
    ...[agent, guard, vendor, stranger].map((k) => SystemProgram.transfer({
      fromPubkey: payer.publicKey, toPubkey: k.publicKey, lamports: 0.01 * LAMPORTS_PER_SOL,
    })),
  ), [payer], { commitment: "confirmed" });
  log(`[1] agent  ${agent.publicKey.toBase58()}`);
  log(`    guard  ${guard.publicKey.toBase58()}  (co-signs only when the policy allows)`);

  // ---- test mint
  const mint = Keypair.generate();
  const mintLamports = await getMinimumBalanceForRentExemptMint(conn);
  await sendAndConfirmTransaction(conn, new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey, newAccountPubkey: mint.publicKey,
      space: MINT_SIZE, lamports: mintLamports, programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(mint.publicKey, DECIMALS, payer.publicKey, null, TOKEN_PROGRAM_ID),
  ), [payer, mint], { commitment: "confirmed" });
  log(`[2] mint   ${mint.publicKey.toBase58()}`);

  // ---- the vault's authority: a 2-of-2 multisig, not a single key and not our server.
  // createMultisig allocates the 355-byte token-multisig account and initialises it; it must exist before the
  // vault's associated token account can name it as owner.
  const multisig = await createMultisig(
    conn, payer, [agent.publicKey, guard.publicKey], 2, undefined, { commitment: "confirmed" },
  );
  log(`[3] authority multisig ${multisig.toBase58()} (2-of-2: agent + guard)`);
  const agentAta = getAssociatedTokenAddressSync(mint.publicKey, agent.publicKey);
  const vendorAta = getAssociatedTokenAddressSync(mint.publicKey, vendor.publicKey);
  const strangerAta = getAssociatedTokenAddressSync(mint.publicKey, stranger.publicKey);
  const vaultAta = getAssociatedTokenAddressSync(mint.publicKey, multisig, true);

  await sendAndConfirmTransaction(conn, new Transaction().add(
    createAssociatedTokenAccountInstruction(payer.publicKey, agentAta, agent.publicKey, mint.publicKey),
    createAssociatedTokenAccountInstruction(payer.publicKey, vendorAta, vendor.publicKey, mint.publicKey),
    createAssociatedTokenAccountInstruction(payer.publicKey, strangerAta, stranger.publicKey, mint.publicKey),
    createAssociatedTokenAccountInstruction(payer.publicKey, vaultAta, multisig, mint.publicKey),
    createMintToInstruction(mint.publicKey, agentAta, payer.publicKey, 1_000n * UNIT),
  ), [payer], { commitment: "confirmed" });
  log(`[3] vault  ${vaultAta.toBase58()}`);

  // ---- fund the vault: the agent deposits 200 of its 1000
  const deposit = new Transaction().add(createTransferInstruction(
    agentAta, vaultAta, agent.publicKey, 200n * UNIT, [], TOKEN_PROGRAM_ID,
  ));
  const depSig = await sendAndConfirmTransaction(conn, deposit, [payer, agent], { commitment: "confirmed" });
  log(`[4] vault funded with 200 (tx ${depSig.slice(0, 20)}…)`);
  log(`    vault balance ${(await getAccount(conn, vaultAta)).amount}`);

  // ---- policy + guard
  const policy = {
    dailyLimit: DAILY, perTxLimit: PER_TX,
    allowlist: [vendorAta.toBase58()], paused: false, expiryTs: null,
  };
  let state = initState(Date.now());
  log(`[5] policy: daily ${DAILY} · per-tx ${PER_TX} · allowlist = vendor's token account only`);

  /** One spend attempt. The guard co-signs only if the policy says yes. */
  async function attempt(claim, { recipient, units, agentOnly = false, policyOverride = null }) {
    const active = policyOverride ?? policy;
    const decision = evaluateSpend(active, state, { amount: units, recipient: recipient.toBase58() }, Date.now());
    if (!decision.allowed) {
      record("policy", claim, decision.reason);
      return;
    }
    const ix = createTransferInstruction(
      vaultAta, recipient, multisig, BigInt(units) * UNIT,
      [agent.publicKey, guard.publicKey], TOKEN_PROGRAM_ID,
    );
    const tx = new Transaction().add(ix, memo(`spendguard:${units}:${recipient.toBase58().slice(0, 8)}`, guard.publicKey));
    const signers = agentOnly ? [payer, agent] : [payer, agent, guard];
    try {
      const sig = await sendAndConfirmTransaction(conn, tx, signers, { commitment: "confirmed" });
      state = decision.state;
      record("ok", claim, `tx ${sig}`);
      results[results.length - 1].signature = sig;
      results[results.length - 1].poll = true;
    } catch (e) {
      const raw = String(e.message ?? e);
      const missing = /missing signature|signature verification failure|not enough signers/i.test(raw);
      record("chain", claim, missing ? "MissingRequiredSignature — vault is 2-of-2, agent signed alone" : raw.slice(0, 90));
    }
  }

  log(`\n[6] spend attempts (policy in front, chain behind)`);
  await attempt("spend 20 to allowlisted vendor", { recipient: vendorAta, units: 20 });
  await attempt("spend 31 (per-tx limit 30)", { recipient: vendorAta, units: 31 });
  await attempt("spend 5 to a non-allowlisted vendor", { recipient: strangerAta, units: 5 });
  await attempt("agent signs alone (no guard)", { recipient: vendorAta, units: 10, agentOnly: true });
  await attempt("spend 30 (takes today to the limit)", { recipient: vendorAta, units: 30 });
  await attempt("spend 10 more (daily budget used up)", { recipient: vendorAta, units: 10 });

  log(`\n[7] kill switch: owner flips it; the guard stops co-signing`);
  await attempt("spend 1 while paused", { recipient: vendorAta, units: 1, policyOverride: { ...policy, paused: true } });

  const vaultEnd = await getAccount(conn, vaultAta);
  log(`\n[8] vault balance after the run: ${vaultEnd.amount} (of the 200 deposited)`);
  log(`    spent today ${state.spentToday}/${DAILY} · remaining ${remainingToday(policy, state, Date.now())}`);

  const summary = {
    rpc: RPC,
    mint: mint.publicKey.toBase58(),
    vault: vaultAta.toBase58(),
    vaultAuthority: { multisig: multisig.toBase58(), members: [agent.publicKey.toBase58(), guard.publicKey.toBase58()], threshold: 2 },
    agent: agent.publicKey.toBase58(),
    guard: guard.publicKey.toBase58(),
    vendorAta: vendorAta.toBase58(),
    strangerAta: strangerAta.toBase58(),
    policy: { dailyLimit: DAILY, perTxLimit: PER_TX, allowlist: policy.allowlist },
    results,
  };
  writeFileSync("demo-output.json", JSON.stringify(summary, null, 2));
  const refusedPolicy = results.filter((r) => r.kind === "policy").length;
  const refusedChain = results.filter((r) => r.kind === "chain").length;
  log(`\n[+] evidence written to demo-output.json`);
  log(`[+] ${results.length} attempts: ${results.length - refusedPolicy - refusedChain} settled, ${refusedPolicy} refused by policy, ${refusedChain} refused by the chain`);
}

main().catch((e) => {
  console.error("[!] demo failed:", e.message ?? e);
  process.exit(1);
});
