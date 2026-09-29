#!/usr/bin/env node
/**
 * Devnet helper for the browser demo: fund the vault the app created and create a vendor token account to pay.
 *
 * The web console intentionally has no deposit button (a real deployment would fund the vault by transfer), so
 * this closes that gap with a real transfer. Usage:
 *   node sg_deposit.mjs '<json with owner/agent/mint/vault/agentAta/secrets>'
 */
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction, createTransferInstruction, getAssociatedTokenAddressSync,
  getAccount, TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

const arg = JSON.parse(process.argv[2]);
const conn = new Connection("https://api.devnet.solana.com", "confirmed");

const owner = Keypair.fromSecretKey(Uint8Array.from(arg.ownerSecret));
const agent = Keypair.fromSecretKey(Uint8Array.from(arg.agentSecret));
const mint = new PublicKey(arg.mint);
const vaultAta = new PublicKey(arg.vault);
const agentAta = new PublicKey(arg.agentAta);

// a vendor to pay: its own key, its own token account
const vendor = Keypair.generate();
const vendorAta = getAssociatedTokenAddressSync(mint, vendor.publicKey);

const fund = new Transaction().add(
  createAssociatedTokenAccountInstruction(owner.publicKey, vendorAta, vendor.publicKey, mint),
  createTransferInstruction(agentAta, vaultAta, agent.publicKey, BigInt(arg.amount ?? 200) * 1_000_000n, [], TOKEN_PROGRAM_ID),
);
const sig = await sendAndConfirmTransaction(conn, fund, [owner, agent], { commitment: "confirmed" });

console.log(JSON.stringify({
  vendor: vendor.publicKey.toBase58(),
  vendorAta: vendorAta.toBase58(),
  depositTx: sig,
  vaultBalance: (await getAccount(conn, vaultAta)).amount.toString(),
  ownerBalance: (await conn.getBalance(owner.publicKey)) / LAMPORTS_PER_SOL,
}));
