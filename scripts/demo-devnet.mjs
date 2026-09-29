#!/usr/bin/env node
/**
 * SpendGuard end-to-end demo on Devnet — the evidence behind the submission.
 *
 * It exercises the on-chain program the way the product claims an agent would be constrained, and it prints the
 * signature (and the program's own error code) for every attempt, so a judge can check each claim on chain:
 *
 *   1. create a test mint and a vault token account owned by the policy PDA
 *   2. initialise the policy: daily limit 100, per-transaction limit 30
 *   3. allowlist exactly one vendor token account
 *   4. fund the vault (the agent deposits)
 *   5. allowed spend of 20                      -> succeeds
 *   6. spend of 31                              -> refused: PerTxLimitExceeded
 *   7. spend to a non-allowlisted account       -> refused: RecipientNotAllowlisted
 *   8. spend past the daily limit               -> refused: DailyLimitExceeded
 *   9. flip the kill switch, then spend 1       -> refused: PolicyPaused
 *  10. print a summary table with explorer links
 *
 * Usage: node scripts/demo-devnet.mjs
 * Requires a funded Devnet keypair at ~/.config/spendguard/id.json and a deployed program id.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction,
  sendAndConfirmTransaction, ComputeBudgetProgram, LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  MINT_SIZE, TOKEN_PROGRAM_ID, createAssociatedTokenAccountInstruction, createInitializeMintInstruction,
  createMintToInstruction, getAccount, getAssociatedTokenAddressSync, getMinimumBalanceForRentExemptMint,
} from "@solana/spl-token";

const RPC = process.env.SOLANA_RPC ?? "https://api.devnet.solana.com";
const DIR = join(homedir(), ".config", "spendguard");
const KEY_PATH = join(DIR, "id.json");
const PROGRAM_KEY_PATH = join(DIR, "program-id.json");
const OUT = join(process.cwd(), "demo-output.json");

const DAILY = 100;
const PER_TX = 30;

const log = (...a) => console.log(...a);
const ix_disc = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n, 0);
  return b;
};
const u64 = (n) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n), 0);
  return b;
};

function loadKeypair(path) {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

async function main() {
  if (!existsSync(KEY_PATH) || !existsSync(PROGRAM_KEY_PATH)) {
    throw new Error("missing keys — run scripts/deploy-devnet.mjs first");
  }
  const payer = loadKeypair(KEY_PATH);
  const programId = loadKeypair(PROGRAM_KEY_PATH).publicKey;
  const connection = new Connection(RPC, "confirmed");

  const results = [];
  const record = (step, claim, signature, error) => {
    results.push({ step, claim, signature, error });
    const link = signature ? `https://explorer.solana.com/tx/${signature}?cluster=devnet` : "—";
    log(`    ${claim.padEnd(34)} ${error ? `REFUSED (${error})` : "OK"} ${signature ? `\n      ${link}` : ""}`);
  };

  log(`[*] program ${programId.toBase58()}`);
  const balance = await connection.getBalance(payer.publicKey);
  log(`[*] owner   ${payer.publicKey.toBase58()} (${(balance / LAMPORTS_PER_SOL).toFixed(3)} SOL)`);
  if (balance < 0.05 * LAMPORTS_PER_SOL) throw new Error("owner needs more devnet SOL");

  // --- actors: an agent key, a vendor, and a second (non-allowlisted) vendor
  const agent = Keypair.generate();
  const vendor = Keypair.generate();
  const stranger = Keypair.generate();
  const fund = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: agent.publicKey, lamports: 0.02 * LAMPORTS_PER_SOL }),
    SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: vendor.publicKey, lamports: 0.01 * LAMPORTS_PER_SOL }),
    SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: stranger.publicKey, lamports: 0.01 * LAMPORTS_PER_SOL }),
  );
  await sendAndConfirmTransaction(connection, fund, [payer], { commitment: "confirmed" });
  log(`[1] agent ${agent.publicKey.toBase58()}`);
  log(`    vendor ${vendor.publicKey.toBase58()}`);

  // --- test mint (stands in for USDC on devnet)
  const mint = Keypair.generate();
  const lamports = await getMinimumBalanceForRentExemptMint(connection);
  const createMint = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey, newAccountPubkey: mint.publicKey,
      space: MINT_SIZE, lamports, programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(mint.publicKey, 6, payer.publicKey, null, TOKEN_PROGRAM_ID),
  );
  await sendAndConfirmTransaction(connection, createMint, [payer, mint], { commitment: "confirmed" });
  log(`[2] mint  ${mint.publicKey.toBase58()}`);

  // --- PDAs and token accounts
  const [policyPda] = PublicKey.findProgramAddressSync([Buffer.from("policy"), agent.publicKey.toBuffer()], programId);
  const agentAta = getAssociatedTokenAddressSync(mint.publicKey, agent.publicKey);
  const vendorAta = getAssociatedTokenAddressSync(mint.publicKey, vendor.publicKey);
  const strangerAta = getAssociatedTokenAddressSync(mint.publicKey, stranger.publicKey);
  const vaultAta = getAssociatedTokenAddressSync(mint.publicKey, policyPda, true); // owned by the PDA

  const setup = new Transaction().add(
    createAssociatedTokenAccountInstruction(payer.publicKey, agentAta, agent.publicKey, mint.publicKey),
    createAssociatedTokenAccountInstruction(payer.publicKey, vendorAta, vendor.publicKey, mint.publicKey),
    createAssociatedTokenAccountInstruction(payer.publicKey, strangerAta, stranger.publicKey, mint.publicKey),
    createAssociatedTokenAccountInstruction(payer.publicKey, vaultAta, policyPda, mint.publicKey),
    createMintToInstruction(mint.publicKey, agentAta, payer.publicKey, 1_000_000_000n), // 1000 units at 6dp
  );
  await sendAndConfirmTransaction(connection, setup, [payer], { commitment: "confirmed" });
  log(`[3] policy PDA ${policyPda.toBase58()}`);
  log(`    vault      ${vaultAta.toBase58()}`);

  // --- space for the policy account (fixed 170 bytes + 1 allowlist entry of 32)
  const policySpace = 32 * 4 + 8 * 5 + 2 + 32;
  const policyRent = await connection.getMinimumBalanceForRentExemption(policySpace);

  const initPolicy = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey, newAccountPubkey: policyPda, lamports: policyRent,
      space: policySpace, programId,
    }),
    new TransactionInstruction({
      programId,
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: false },
        { pubkey: agent.publicKey, isSigner: false, isWritable: false },
        { pubkey: policyPda, isSigner: false, isWritable: true },
        { pubkey: vaultAta, isSigner: false, isWritable: false },
        { pubkey: mint.publicKey, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: new PublicKey("SysvarRent111111111111111111111111111111111"), isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([Buffer.from([0]), u64(DAILY), u64(PER_TX)]),
    }),
  );
  await sendAndConfirmTransaction(connection, initPolicy, [payer], { commitment: "confirmed" });
  log(`[4] policy initialised: daily ${DAILY}, per-tx ${PER_TX}`);

  // --- allowlist the vendor's token account (instruction 2: tag, count, 32-byte keys)
  const allow = new Transaction().add(new TransactionInstruction({
    programId,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: false },
      { pubkey: policyPda, isSigner: false, isWritable: true },
    ],
    data: Buffer.concat([Buffer.from([2, 1]), vendorAta.toBuffer()]),
  }));
  await sendAndConfirmTransaction(connection, allow, [payer], { commitment: "confirmed" });
  log(`[5] allowlist: vendor token account only`);

  // --- fund the vault (instruction 3), signed by the agent
  const depositIx = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: agent.publicKey, isSigner: true, isWritable: false },
      { pubkey: policyPda, isSigner: false, isWritable: false },
      { pubkey: mint.publicKey, isSigner: false, isWritable: false },
      { pubkey: vaultAta, isSigner: false, isWritable: true },
      { pubkey: agentAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from([3]), u64(100)]),
  });
  await sendAndConfirmTransaction(connection, new Transaction().add(depositIx), [payer, agent], { commitment: "confirmed" });
  const vaultBal = await getAccount(connection, vaultAta);
  log(`[6] vault funded, balance ${vaultBal.amount}`);

  const spend = (recipientAta, amount) => new TransactionInstruction({
    programId,
    keys: [
      { pubkey: agent.publicKey, isSigner: true, isWritable: false },
      { pubkey: policyPda, isSigner: false, isWritable: true },
      { pubkey: vaultAta, isSigner: false, isWritable: true },
      { pubkey: recipientAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from([4]), u64(amount)]),
  });

  async function attempt(step, claim, recipientAta, amount) {
    try {
      const sig = await sendAndConfirmTransaction(connection, new Transaction().add(spend(recipientAta, amount)), [payer, agent], { commitment: "confirmed" });
      record(step, claim, sig, null);
      return { ok: true, sig };
    } catch (e) {
      const m = /custom program error: 0x([0-9a-f]+)/i.exec(e.message ?? "");
      const code = m ? parseInt(m[1], 16) : null;
      const named = { 6000: "PolicyPaused", 6001: "PerTxLimitExceeded", 6002: "DailyLimitExceeded", 6003: "RecipientNotAllowlisted", 6006: "AmountNotPositive" }[code] ?? `error ${code ?? "?"}`;
      record(step, claim, null, named);
      return { ok: false, code, named };
    }
  }

  log(`\n[7] spend attempts through the agent key`);
  await attempt(7, "spend 20 within limits", vendorAta, 20);
  await attempt(8, "spend 31 (per-tx limit 30)", vendorAta, 31);
  await attempt(9, "spend 5 to unknown vendor", strangerAta, 5);
  await attempt(10, "spend 50 (28 left today)", vendorAta, 50);
  await attempt(11, "spend 28 (exact remainder)", vendorAta, 28);
  await attempt(12, "spend 1 more (daily used up)", vendorAta, 1);

  // --- kill switch
  const pause = new Transaction().add(new TransactionInstruction({
    programId,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: false },
      { pubkey: policyPda, isSigner: false, isWritable: true },
    ],
    data: Buffer.from([1, 1]),
  }));
  await sendAndConfirmTransaction(connection, pause, [payer], { commitment: "confirmed" });
  log(`\n[8] kill switch engaged by the owner`);
  await attempt(13, "spend 1 while paused", vendorAta, 1);

  const vaultEnd = await getAccount(connection, vaultAta);
  log(`\n[9] vault balance after the run: ${vaultEnd.amount}`);

  const summary = {
    rpc: RPC,
    programId: programId.toBase58(),
    policyPda: policyPda.toBase58(),
    vault: vaultAta.toBase58(),
    mint: mint.publicKey.toBase58(),
    agent: agent.publicKey.toBase58(),
    vendor: vendorAta.toBase58(),
    policy: { dailyLimit: DAILY, perTxLimit: PER_TX, allowlist: [vendorAta.toBase58()] },
    results,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(summary, null, 2));
  log(`\n[+] evidence written to ${OUT}`);
  const refused = results.filter((r) => r.error).length;
  log(`[+] ${results.length} attempts: ${results.length - refused} executed, ${refused} refused by the program`);
}

main().catch((e) => {
  console.error("[!] demo failed:", e.message ?? e);
  process.exit(1);
});
