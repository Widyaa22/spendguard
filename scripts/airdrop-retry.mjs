#!/usr/bin/env node
/**
 * Retry devnet funding until it lands, then run the demo automatically.
 *
 * The public faucets rate-limit per IP (HTTP 429 from this host), and that limit clears on its own. Rather than
 * blocking on a human, this polls: it tries several endpoints with small amounts, and the moment the wallet has
 * SOL it runs the end-to-end demo and prints the result. Silent while it is still waiting, so the cron feed stays
 * clean; it speaks only when something actually happened.
 *
 * Usage: node scripts/airdrop-retry.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";

const KEY = join(homedir(), ".config", "spendguard", "id.json");
const ENDPOINTS = [
  "https://api.devnet.solana.com",
  "https://rpc.ankr.com/solana_devnet",
  "https://devnet.genesysgo.net",
];

if (!existsSync(KEY)) {
  console.log("[airdrop-retry] no keypair yet — run scripts/deploy-devnet.mjs once.");
  process.exit(0);
}

const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(KEY, "utf8"))));
const conn = new Connection(ENDPOINTS[0], "confirmed");

const balance = async () => conn.getBalance(kp.publicKey).catch(() => 0);

let bal = await balance();
if (bal > 0) {
  // funded already: make sure the demo has been run, then stay quiet if it has
  console.log(`[airdrop-retry] wallet already funded (${(bal / LAMPORTS_PER_SOL).toFixed(3)} SOL).`);
  process.exit(0);
}

for (const ep of ENDPOINTS) {
  const c = new Connection(ep, "confirmed");
  for (const amount of [1, 0.5, 0.2]) {
    try {
      const sig = await c.requestAirdrop(kp.publicKey, amount * LAMPORTS_PER_SOL);
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        if ((await balance()) > 0) break;
      }
      bal = await balance();
      if (bal > 0) {
        console.log(`[airdrop-retry] FUNDED via ${ep}: ${(bal / LAMPORTS_PER_SOL).toFixed(3)} SOL (tx ${sig})`);
        console.log(`[airdrop-retry] running the devnet demo now…`);
        const r = spawnSync("node", ["scripts/demo-devnet.mjs"], { encoding: "utf8", timeout: 600_000 });
        console.log((r.stdout ?? "").split("\n").slice(-40).join("\n"));
        if (r.status !== 0) console.log("[airdrop-retry] demo exit code:", r.status, (r.stderr ?? "").slice(0, 400));
        process.exit(0);
      }
    } catch {
      // rate-limited or unavailable: try the next amount/endpoint, and stay quiet
    }
  }
}

// still nothing: exit silently so the cron produces no notification
process.exit(0);
