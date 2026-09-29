# Colosseum: daftar + project page (langkah untuk lo)

## Kenapa bagian ini harus lo

Gue sudah coba daftar. Form-nya sudah gue isi sampai siap submit:

```
email     widyakuya47@gmail.com      ← email lo (dari catatan; bilang kalau salah)
username  widyaa22
display   Abdul Halim
password  ← hanya field ini yang belum, dan gue TIDAK boleh mengetik password
```

Password itu satu-satunya penghalang, dan itu memang by design: gue tidak pernah mengetik password, dan di sesi
ini prompt vault-nya tidak tersedia (sesi headless). Dua jalan:

* **A. Lo daftar sendiri** (paling cepat, 1 klik): pilih **Continue with GitHub** atau **Google** di
  https://colosseum.com/signup — tidak perlu bikin password baru, email lo sudah terverifikasi di provider itu.
* **B. Gue yang lanjutkan**: lo tambahkan login Colosseum ke vault di host (`hermes vault add`, origin
  `https://colosseum.com`), lalu bilang "udah". Gue isi field password dari vault dan tekan Create account.

Form email (kalau lo pilih jalur email, bukan GitHub/Google): **email, username, display name, password**.
Sudah gue uji: **tidak ada jalur tanpa password** (halaman sign-in hanya punya email + password, tidak ada
"kirim kode ke email"), dan password wajib **minimal 8 karakter** — submit tanpa password ditolak dengan pesan
`Password must be at least 8 characters`. Jadi alur "daftar → kirim kode → lo terusan kode ke gue" memang tidak
ada di situs ini; yang ada adalah pembuatan password, dan password itu hanya boleh masuk halaman lewat vault
(lo yang mengetik lewat prompt masked, atau lewat `hermes vault add` dari sesi yang punya UI).

## Langkah 1 — daftar pakai link yang benar

Pakai link dari listing-nya, **bukan** colosseum.com polos — supaya region Germany ikut tercatat:

```
https://arena.colosseum.org/?ref=germany
```

Daftar → lalu di profil/pengaturan, pastikan **country = Germany**. Ini syarat eksplisit listing MVP.

## Langkah 2 — bikin project page, tempel isian ini

Isian di bawah sudah disesuaikan dengan proyeknya (semua link sudah gue verifikasi hidup):

**Nama project**
```
SpendGuard
```

**Tagline / one-liner**
```
Give an agent a budget, not a blank cheque: an on-chain spend policy that a compromised agent cannot exceed.
```

**Kategori** (pilih yang paling dekat; kalau ada opsi AI/Infrastructure, itu paling pas)
```
AI / Infrastructure / Developer Tools
```

**Deskripsi pendek (kalau ada kolom singkat)**
```
An on-chain spend policy for AI agents. The agent's funds sit behind a 2-of-2 SPL Token multisig (agent key +
guard key), so a payment needs both signatures and Solana itself refuses anything the guard did not co-sign.
Policy: daily limit, per-transaction limit, recipient allowlist, kill switch, expiry. Every decision lands in a
Memo instruction inside the transaction that moves the money, so the audit trail is written by the chain rather
than by the service that decided. Built on devnet, runs in the browser with no backend of ours in the path.
```

**Deskripsi panjang (kalau ada kolom deskripsi besar)**
```
Agents can already hold keys and pay for things, and almost everyone enforces the limits off-chain: a service
decides whether a payment is allowed and then signs. That makes the limit a promise rather than a constraint. If
the agent's runtime is compromised, if the policy service has a bug, or if a prompt convinces the agent to call
the payment path directly, the rule is gone, because the rule was never where the money was. After the fact
nobody can audit it either, because "the agent stayed within budget" is a log line written by the same system
under audit.

SpendGuard puts the budget where the money is. The vault is an associated token account whose owner is a 2-of-2
SPL Token multisig: the agent's key and a guard key. A spend is a normal SPL Token transfer, so it requires both
signatures, and the agent alone cannot move a cent because the token program rejects the transaction. The guard
co-signs only when the policy allows: daily limit, per-transaction limit, recipient allowlist, kill switch, and
expiry. Every approved spend carries a Memo instruction, so the audit note is committed by the same transaction
that moved the funds. The owner keeps a kill switch: one key flip stops the guard co-signing and the agent's
wallet goes inert, without touching the agent's key or its runtime.

The differentiator is where enforcement lives. Nothing in our stack can override the rule, because the rule is
the vault's authority structure. In the demo the agent builds its own payment, signs with its own key, and Solana
refuses it: that refusal is the product working.

Honest limits: the guard key is now the thing to protect, and this MVP is single-guard with no HSM, no
multi-guard quorum and no per-recipient daily limits. Those are the next things to build, not things being
claimed as done.
```

**Links**
```
Live MVP   https://widyaa22.github.io/spendguard/
Repo       https://github.com/Widyaa22/spendguard
Video      https://github.com/Widyaa22/spendguard/releases/download/v0.1.0/spendguard-demo.mp4
Pitch      https://github.com/Widyaa22/spendguard/releases/download/v0.1.0/spendguard-pitch.mp4
```

**Tech / chain**
```
Solana (devnet). SPL Token 2-of-2 multisig as the vault authority, Memo program for the audit trail, no custom
program deployed. Policy engine is a pure module with 12 tests; the console is a browser app against devnet.
```

## Langkah 3 — kirim gue URL project page-nya

Setelah project page jadi, salin URL-nya (bentuknya seperti `https://colosseum.com/...` atau
`https://arena.colosseum.org/projects/<slug>` — gue belum bisa memastikan tanpa akun). URL itu yang masuk ke
**field 9** di form submission Superteam, dan setelah itu submission-nya lengkap.
