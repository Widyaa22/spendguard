# Form isian — siap tempel

Dua listing, dua form yang berbeda bentuknya. Isian di bawah sudah disesuaikan dengan batas panjang jawaban
masing-masing field, dan semua link sudah gue verifikasi HTTP 200.

---

## A. Road to Colosseum Hackathon: Build your MVP

`https://superteam.fun/earn/listing/road-to-colosseum-hackathon-build-your-mvp`
Hadiah $8.000 (2000/1500/1100/800/650/500/450/400/350/250) · deadline **5 Okt 2026 21:59 UTC** · sponsor Superteam Germany

**Field 1 — What is the name of your project?**
```
SpendGuard
```

**Field 2 — Put your project one-liner here:**
```
Give an agent a budget, not a blank cheque: an on-chain spend policy that a compromised agent cannot exceed.
```

**Field 3 — What problem are you solving, and who are you building for?**
```
Agents can already hold keys and pay for things, and almost everyone enforces the limits off-chain: a service
decides whether a payment is allowed and then signs. That makes the limit a promise rather than a constraint. If
the agent's runtime is compromised, if the policy service has a bug, or if a prompt convinces the agent to call
the payment path directly, the rule is gone, because the rule was never where the money was. After the fact
nobody can audit it either: "the agent stayed within budget" is a log line written by the system under audit.

SpendGuard is for the people about to give agents real spending power: teams shipping agent payments, and
operators who need limits they can prove rather than limits they configured. The product is a vault whose
authority is a 2-of-2 multisig, so the budget itself refuses what the policy does not allow.
```

**Field 4 — Briefly explain the Solana integration in your working MVP:**
```
Enforcement is on-chain using the SPL Token program's native multisig authority, so the constraint does not
depend on our backend being correct.

* The vault is an associated token account whose owner is a 2-of-2 SPL Token multisig (agent key + guard key),
  created with createInitializeMultisigInstruction. Neither key alone can move funds, and the token program
  enforces that, not our code.
* A payment is a createTransferInstruction from the vault with the multisig as authority and both signer pubkeys
  declared. Signed with only the agent's key, the runtime rejects it (MissingRequiredSignature) - that refusal is
  demonstrated live, it is not a simulated branch.
* Every approved spend carries a Memo instruction, so the audit note is committed atomically with the transfer
  instead of being written by the service that made the decision.
* The policy engine (daily limit, per-transaction limit, recipient allowlist, kill switch, expiry) is a pure
  module with 12 tests covering every denial path, the UTC-day budget reset, and the property that a refused
  spend must not consume budget.
* The console runs entirely in the browser against devnet with no backend of ours in the path, so a judge can
  create a vault, fund it and watch both kinds of refusal directly.
```

**Field 5 — Provide a link where we can access and test your MVP:**
```
https://widyaa22.github.io/spendguard/
```
(tidak butuh install; butuh SOL devnet untuk bikin vault, dan halaman itu punya tombol faucet. Kalau faucet
menolak dari IP juri, kirim alamat wallet-nya ke kami dan kami isi.)

**Field 6 — Provide a link to a 2–3 minute video demonstrating the working product and its main user flow:**
```
https://github.com/Widyaa22/spendguard/releases/download/v0.1.0/spendguard-demo.mp4
```

**Field 7 — Provide the public GitHub repository for your submission:**
```
https://github.com/Widyaa22/spendguard
```

**Field 8 — Is your MVP running on Devnet or Mainnet? If applicable, include relevant program IDs, transaction links or addresses:**
```
Devnet. Programs used: SPL Token (TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA) and Memo
(MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr). No custom program is deployed - the 2-of-2 authority is the
enforcement.

Verified run from the console (screenshots in the repo under evidence/shots/):
  vault token account  HmUoD3gS7wJtbcdvwTtLECTPFq9jhsjuM43Uq7E8dKfG
  authority multisig   2DQoZ62PC5FDcHrWyHRKtmzNhX8zdtVMC5vWpQCVee4g  (2-of-2: agent + guard)
  vendor token account 4g6A7z4wYRMXVPFGP5YEykE6XSZ5gXqBSjdAKhdauNkL
  vault funded with 200, one approved spend of 10, on-chain balance after 190

Approved spend (policy allowed, both keys signed, memo written):
  https://explorer.solana.com/tx/3qqWNdmM3bwkUP9q2ADFKceTKe6uiUxZz5gspKCBh6wPAxi3idfKV5SDHvBfNefw17RWzoMbnG3HQE4uCfD83tjL?cluster=devnet

Command-line run (raw evidence attached to the release as demo-output.json):
  approved spend 20  https://explorer.solana.com/tx/2q582p9Hs6SsFZ2ess83LjV7TZQ4tvnKb51HMqpL6h43kUx4sUrXzXpNGLv5nheeQrqC7EXVDxnuyQXLo3Z3jNym?cluster=devnet
  approved spend 30  https://explorer.solana.com/tx/J5D2XbBWPui93Q8cA2TtPY1qGo2Lzq2VowLdtyLY8f5znNojfAxFs585vjYgNjdMBZzYyztw99LVg9WFVv23GsN?cluster=devnet
  refusals: per_tx_limit_exceeded, recipient_not_allowlisted, daily_limit_exceeded, policy_paused, and
  MissingRequiredSignature from the runtime when the agent signed alone.
```

**Field 9 — Please add your Colosseum project link here:**
```
https://arena.colosseum.org/projects/<project-slug>
```
⚠️ BELUM ADA. Ini butuh lo register di `https://arena.colosseum.org/?ref=germany` dengan **country = Germany**,
lalu bikin project page. Tanpa field ini submission tidak lengkap.

**Field 10 — Did this project originate from our Road to Colosseum Ideathon? (opsional)**
```
(biarkan kosong — project ini bukan dari Ideathon)
```

**Field 11 — Provide the Telegram username of one team member we can contact:**
```
@Ashev1933
```

---

## B. Colosseum: Show Us What You Got

`https://superteam.fun/earn/listing/colosseum-show-us-what-got`
Hadiah $1.500 (700/500/300) · deadline **4 Okt 2026 20:59 UTC** · sponsor Superteam Netherlands

Form listing ini tidak punya pertanyaan khusus (`eligibility` kosong), jadi pakai form standar Superteam:
**link karya**, **link tweet (opsional)**, **link video demo**, **anything else (opsional)**.

Syarat keras dari deskripsinya: **video pitch di X, maksimal 2 MENIT, publik, bahasa Inggris**, dan harus
menjawab tiga hal — apa yang dibangun, kenapa penting, kenapa tim ini.

```
video pitch   https://github.com/Widyaa22/spendguard/releases/download/v0.1.0/spendguard-pitch.mp4
              (1:50, bahasa Inggris, tiga pertanyaan listing dijawab berurutan)
link karya    <URL post X yang berisi video pitch>
video demo    https://github.com/Widyaa22/spendguard/releases/download/v0.1.0/spendguard-pitch.mp4
anything else SpendGuard lets an agent spend, but only up to limits it cannot escape even if its key is stolen.
              The vault's authority is a 2-of-2 SPL Token multisig (agent + guard), so the token program refuses
              any payment the guard did not co-sign, and every decision lands in a Memo instruction on chain.
              Live devnet console: https://widyaa22.github.io/spendguard/  Code:
              https://github.com/Widyaa22/spendguard
```

Teks untuk post X ada di `demo/X_POST.txt` (versi demo) — untuk listing ini video yang dipakai adalah
`spendguard-pitch.mp4`, jadi kalimat pembukanya pakai versi pitch.

---

## Urutan yang gue sarankan

1. **Register Colosseum** (country Germany) + bikin project page → dapat link field 9.
2. **Post video pitch di X** (≤2 menit, `spendguard-pitch.mp4`) → dapat link field B.
3. Submit **listing B dulu** (deadline paling dekat: 4 Okt) — form-nya paling sederhana.
4. Submit **listing A** (5 Okt) dengan 11 field di atas.

Kalau nomor 1 atau 2 mentok, bilang ke gue — link video ke `github.com/.../releases/download/...` sudah publik
dan bisa dipakai sebagai fallback di field video mana pun.
