#!/usr/bin/env node
/**
 * Deploy the SpendGuard program to Solana Devnet without the Solana CLI.
 *
 * Why this exists: the published `solana` CLI has no Linux ARM64 build, so `solana program deploy` is not
 * available on the machine this project was built on. The CLI only wraps four RPC operations anyway, so this
 * does them directly with @solana/web3.js against the upgradeable BPF loader:
 *
 *   1. create a buffer account and write the .so into it, in size-bounded chunks
 *   2. DeployWithMaxDataLen, which creates the program + programdata accounts and copies the buffer in
 *   3. verify by fetching the account and reporting the executable size
 *
 * Usage:
 *   node scripts/deploy-devnet.mjs                 # uses program/target/.../spendguard.so
 *   node scripts/deploy-devnet.mjs path/to/prog.so
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction,
  sendAndConfirmTransaction, ComputeBudgetProgram, LAMPORTS_PER_SOL,
} from "@solana/web3.js";

const RPC = process.env.SOLANA_RPC ?? "https://api.devnet.solana.com";
const LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const KEY_PATH = join(homedir(), ".config", "spendguard", "id.json");
const CHUNK = 900; // bytes of program data per transaction
const HEADER_BUFFER = 37; // UpgradeableLoaderState::Buffer metadata
const HEADER_PROGRAMDATA = 45; // UpgradeableLoaderState::ProgramData metadata
const HEADER_PROGRAM = 36; // UpgradeableLoaderState::Program metadata

const log = (...a) => console.log(...a);

function loadKeypair() {
  if (!existsSync(KEY_PATH)) {
    const kp = Keypair.generate();
    mkdirSync(dirname(KEY_PATH), { recursive: true });
    writeFileSync(KEY_PATH, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
    log(`[+] generated a new devnet keypair at ${KEY_PATH}`);
    log(`    address: ${kp.publicKey.toBase58()}`);
    log(`    fund it (devnet SOL) before deploying, e.g. https://faucet.solana.com`);
    return kp;
  }
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(KEY_PATH, "utf8"))));
}

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n, 0);
  return b;
}
function u64(n) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n), 0);
  return b;
}

const initializeBufferIx = () => ({
  programId: LOADER,
  keys: [],
  data: Buffer.concat([u32(0)]),
});

const writeIx = (buffer, authority, offset, bytes) => new TransactionInstruction({
  programId: LOADER,
  keys: [
    { pubkey: buffer, isSigner: false, isWritable: true },
    { pubkey: authority, isSigner: true, isWritable: false },
  ],
  // Write { offset: u32, bytes: Vec<u8> } — bincode: u32 enum tag, u32 offset, u64 len, bytes
  data: Buffer.concat([u32(1), u32(offset), u64(bytes.length), bytes]),
});

const deployIx = (payer, program, programData, buffer, authority, maxLen) => new TransactionInstruction({
  programId: LOADER,
  keys: [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: programData, isSigner: false, isWritable: true },
    { pubkey: program, isSigner: false, isWritable: true },
    { pubkey: buffer, isSigner: false, isWritable: true },
    { pubkey: new PublicKey("SysvarRent111111111111111111111111111111111"), isSigner: false, isWritable: false },
    { pubkey: new PublicKey("SysvarC1ock11111111111111111111111111111111"), isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: authority, isSigner: true, isWritable: false },
  ],
  data: Buffer.concat([u32(2), u64(maxLen)]),
});

async function main() {
  const soPath = process.argv[2] ?? join(
    "program", "target", "sbpfv3-solana-solana", "release", "spendguard.so",
  );
  if (!existsSync(soPath)) {
    throw new Error(`program binary not found: ${soPath}\nbuild it first: cargo build --target sbpfv3-solana-solana --release`);
  }
  const programData = readFileSync(soPath);
  const connection = new Connection(RPC, "confirmed");
  const payer = loadKeypair();
  const programKeyPath = join(dirname(KEY_PATH), "program-id.json");
  let program;
  if (existsSync(programKeyPath)) {
    program = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(programKeyPath, "utf8"))));
  } else {
    program = Keypair.generate();
    writeFileSync(programKeyPath, JSON.stringify(Array.from(program.secretKey)), { mode: 0o600 });
  }

  const balance = await connection.getBalance(payer.publicKey);
  log(`[*] rpc        : ${RPC}`);
  log(`[*] payer      : ${payer.publicKey.toBase58()} (${(balance / LAMPORTS_PER_SOL).toFixed(3)} SOL)`);
  log(`[*] program id : ${program.publicKey.toBase58()}`);
  log(`[*] program    : ${programData.length} bytes`);

  const [programDataAddr] = PublicKey.findProgramAddressSync(
    [program.publicKey.toBuffer()], LOADER,
  );

  if (balance === 0) {
    throw new Error("payer has no devnet SOL — fund it at https://faucet.solana.com then re-run");
  }

  // 1. buffer account
  const buffer = Keypair.generate();
  const bufferSpace = programData.length + HEADER_BUFFER;
  const bufferRent = await connection.getMinimumBalanceForRentExemption(bufferSpace);
  log(`[1/3] creating buffer ${buffer.publicKey.toBase58()} (${bufferSpace} bytes, ${bufferRent} lamports)`);
  const createBuffer = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: buffer.publicKey,
      lamports: bufferRent,
      space: bufferSpace,
      programId: LOADER,
    }),
    initializeBufferIx(),
  );
  // the loader's InitializeBuffer must be signed by the buffer as owner at creation time
  createBuffer.instructions[1].keys.push(
    { pubkey: buffer.publicKey, isSigner: true, isWritable: true },
    { pubkey: payer.publicKey, isSigner: false, isWritable: false },
  );
  await sendAndConfirmTransaction(connection, createBuffer, [payer, buffer], { commitment: "confirmed" });
  log(`      buffer ready`);

  // 2. write the program in chunks
  const chunks = Math.ceil(programData.length / CHUNK);
  log(`[2/3] writing ${chunks} chunk(s) of ${CHUNK} bytes`);
  for (let i = 0; i < chunks; i++) {
    const offset = i * CHUNK;
    const bytes = programData.subarray(offset, offset + CHUNK);
    const tx = new Transaction().add(writeIx(buffer.publicKey, payer.publicKey, offset, bytes));
    await sendAndConfirmTransaction(connection, tx, [payer], { commitment: "confirmed" });
    process.stdout.write(`      ${i + 1}/${chunks}\r`);
  }
  log(`      written`);

  // 3. deploy
  const maxLen = programData.length;
  log(`[3/3] DeployWithMaxDataLen(${maxLen})`);
  const deploy = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    deployIx(payer.publicKey, program.publicKey, programDataAddr, buffer.publicKey, payer.publicKey, maxLen),
  );
  const sig = await sendAndConfirmTransaction(connection, deploy, [payer], { commitment: "confirmed" });
  log(`      signature: ${sig}`);

  const info = await connection.getAccountInfo(program.publicKey);
  log(`\n[+] deployed`);
  log(`    program id  : ${program.publicKey.toBase58()}`);
  log(`    programdata : ${programDataAddr.toBase58()}`);
  log(`    executable  : ${info?.executable}`);
  log(`    data space  : ${info?.data.length ?? 0} bytes`);
  log(`    explorer    : https://explorer.solana.com/address/${program.publicKey.toBase58()}?cluster=devnet`);
  log(`\n    put this in your .env:  SPENDGUARD_PROGRAM_ID=${program.publicKey.toBase58()}`);
}

main().catch((e) => {
  console.error("[!] deploy failed:", e.message ?? e);
  process.exit(1);
});
