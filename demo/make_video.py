#!/usr/bin/env python3
"""
Render the SpendGuard demo video from the evidence this project actually produced.

Nothing here is a mock: the app frames are screenshots of the live console running against devnet, and the
terminal frames are the real output of scripts/demo.mjs (signatures included). The video is assembled with
ffmpeg from still frames, each held for a fixed duration.

Usage: python3 demo/make_video.py
"""
import json
import pathlib
import shutil
import subprocess
import textwrap

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
FRAMES = ROOT / "demo" / "frames"
SHOTS = ROOT / "evidence" / "shots"
OUT = ROOT / "demo" / "spendguard-demo.mp4"
W, H = 1280, 720

BG = (13, 17, 23)
PANEL = (22, 27, 34)
FG = (230, 237, 243)
DIM = (139, 148, 158)
ACC = (88, 166, 255)
OK = (63, 185, 80)
BAD = (248, 81, 73)
WARN = (210, 153, 34)

F = "/usr/share/fonts/truetype/dejavu/"
title_f = ImageFont.truetype(F + "DejaVuSans-Bold.ttf", 58)
sub_f = ImageFont.truetype(F + "DejaVuSans.ttf", 26)
head_f = ImageFont.truetype(F + "DejaVuSans-Bold.ttf", 32)
body_f = ImageFont.truetype(F + "DejaVuSans.ttf", 22)
small_f = ImageFont.truetype(F + "DejaVuSans.ttf", 17)
mono_f = ImageFont.truetype(F + "DejaVuSansMono.ttf", 16)
mono_b = ImageFont.truetype(F + "DejaVuSansMono-Bold.ttf", 17)

slides = []  # (path, seconds)


def new_frame():
    im = Image.new("RGB", (W, H), BG)
    return im, ImageDraw.Draw(im)


def save(im, name, seconds):
    FRAMES.mkdir(parents=True, exist_ok=True)
    p = FRAMES / f"{len(slides):02d}-{name}.png"
    im.save(p)
    slides.append((p, seconds))
    print(f"  frame {p.name}  {seconds}s")


def card(name, seconds, title, lines, kicker=None):
    im, d = new_frame()
    y = 150 if kicker else 190
    if kicker:
        d.text((80, 96), kicker.upper(), font=small_f, fill=ACC)
    d.text((80, y), title, font=title_f, fill=FG)
    y += 100
    d.line([(80, y), (W - 80, y)], fill=(48, 54, 61), width=2)
    y += 40
    for line, colour, font in lines:
        for chunk in textwrap.wrap(line, 78) or [""]:
            d.text((80, y), chunk, font=font, fill=colour)
            y += font.size + 12
        y += 8
    save(im, name, seconds)


def shot(name, seconds, png, step, verdict, verdict_colour, note):
    # the screenshot goes in at native size (1280 wide) so the log lines stay legible; the context sits in the
    # bar above it, which is the only place text can go without shrinking the evidence
    im, d = new_frame()
    d.rectangle([0, 0, W, 87], fill=PANEL)
    d.text((30, 10), step, font=sub_f, fill=FG)
    d.text((30, 48), verdict, font=body_f, fill=verdict_colour)
    img = Image.open(SHOTS / png)
    im.paste(img, (0, 87))
    save(im, name, seconds)


def terminal(name, seconds, title, rows):
    im, d = new_frame()
    d.rectangle([0, 0, W, 60], fill=PANEL)
    d.text((30, 16), title, font=head_f, fill=FG)
    d.rectangle([30, 80, W - 30, H - 40], fill=(9, 12, 17), outline=(48, 54, 61))
    y = 100
    for text, kind in rows:
        colour = {"ok": OK, "bad": BAD, "warn": WARN, "dim": DIM, "fg": FG}[kind]
        d.text((50, y), text[:104], font=mono_b if kind in ("ok", "bad", "warn") else mono_f, fill=colour)
        y += 26
    save(im, name, seconds)


# ---------------------------------------------------------------- load the real evidence
cli = json.loads((ROOT / "demo-output.json").read_text())
app = json.loads(pathlib.Path("/home/ubuntu/.hermes/cache/scratch/sg_app2.json").read_text())
APP_VAULT = "HmUoD3gS7wJtbcdvwTtLECTPFq9jhsjuM43Uq7E8dKfG"
APP_MULTISIG = "2DQoZ62PC5FDcHrWyHRKtmzNhX8zdtVMC5vWpQCVee4g"
APP_VENDOR = "4g6A7z4wYRMXVPFGP5YEykE6XSZ5gXqBSjdAKhdauNkL"
cli_rows = []
for r in cli["results"]:
    claim = r["claim"][:40]
    if r["kind"] == "ok":
        cli_rows.append((f"{claim:42} OK             {r['signature'][:26]}…", "ok"))
    elif r["kind"] == "policy":
        cli_rows.append((f"{claim:42} POLICY REFUSED {r['detail'][:28]}", "bad"))
    else:
        cli_rows.append((f"{claim:42} CHAIN REFUSED  MissingRequiredSignature", "warn"))

# ---------------------------------------------------------------- the video
card("intro", 7, "SpendGuard", [
    ("Give an agent a budget, not a blank cheque.", DIM, sub_f),
    ("", DIM, small_f),
    ("An on-chain spend policy for AI agents on Solana.", ACC, sub_f),
], kicker="devnet demo")

card("problem", 15, "The problem with off-chain limits", [
    ("An agent holds a key and pays for things.", FG, body_f),
    ("The limit is decided by a service, which then signs.", FG, body_f),
    ("", DIM, small_f),
    ("If the agent is compromised, or that service has a bug, the rule is gone.", DIM, body_f),
    ("The rule was never where the money was.", BAD, body_f),
], kicker="problem")

card("design", 14, "Put the budget where the money is", [
    ("The vault's authority is a 2-of-2 SPL Token multisig:", FG, body_f),
    ("the agent's key and the guard's key.", ACC, body_f),
    ("", DIM, small_f),
    ("Both signatures are required, so the token program itself refuses a spend", FG, body_f),
    ("the guard did not co-sign. The guard co-signs only when the policy allows.", FG, body_f),
], kicker="product")

shot("app-1", 17, "01-allowed.png",
     "1. the agent pays 10 to an allowlisted vendor",
     "approved: both keys signed, memo written, real devnet transaction", OK,
     "")
shot("app-2", 15, "02-per-tx-refused.png",
     "2. the agent tries 31 against a per-transaction limit of 30",
     "refused by the policy, before any transaction exists", BAD,
     "")
shot("app-3", 19, "03-chain-refused.png",
     "3. the agent signs with its own key only",
     "Solana itself refuses: the vault is 2-of-2 and the guard did not sign", WARN,
     "")
shot("app-4", 15, "04-paused.png",
     "4. the owner flips the kill switch",
     "the guard stops co-signing and the agent's wallet goes inert", BAD,
     "")

terminal("cli-1", 15, "the same policy, driven from the command line", cli_rows[:4])
terminal("cli-2", 13, "every refusal, with the reason it was refused", cli_rows[4:])

card("chain", 15, "What is on chain", [
    (f"vault          {cli['vault']}", ACC, mono_f),
    (f"authority      multisig {cli['vaultAuthority']['multisig']}  (2-of-2, agent + guard)", FG, mono_f),
    (f"mint           {cli['mint']}", DIM, mono_f),
    ("", DIM, small_f),
    (f"settled spend  {cli['results'][0]['signature'][:44]}…", OK, mono_f),
    (f"refused spend  {cli['results'][2]['claim']} → {cli['results'][2]['detail']}", BAD, mono_f),
    (f"deepest test   agent signs alone → MissingRequiredSignature (refused by the runtime)", WARN, mono_f),
    ("", DIM, small_f),
    (f"live app run   vault {APP_VAULT}  balance 200 → 190", DIM, mono_f),
    (f"               authority multisig {APP_MULTISIG}", DIM, mono_f),
], kicker="evidence")

card("outro", 12, "SpendGuard", [
    ("live console   https://widyaa22.github.io/spendguard/", ACC, sub_f),
    ("source         https://github.com/Widyaa22/spendguard", ACC, sub_f),
    ("", DIM, small_f),
    ("policy engine with 12 passing tests, devnet end to end, MIT licensed", DIM, small_f),
    ("guard key management and multi-guard quorum are the next steps, not claims", DIM, small_f),
], kicker="try it")

# ---------------------------------------------------------------- assemble
manifest = FRAMES / "concat.txt"
with manifest.open("w") as fh:
    for path, seconds in slides:
        fh.write(f"file '{path}'\nduration {seconds}\n")
    fh.write(f"file '{slides[-1][0]}'\n")

total = sum(s for _, s in slides)
print(f"  {len(slides)} slides, {total}s total")
ffmpeg = shutil.which("ffmpeg") or "/home/ubuntu/.hermes/tools/ffmpeg-9.0.1-linux-arm64/bin/ffmpeg"
cmd = [
    ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", str(manifest),
    "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-preset", "medium", "-crf", "20",
    "-movflags", "+faststart", str(OUT),
]
r = subprocess.run(cmd, capture_output=True, text=True)
print("  ffmpeg exit:", r.returncode)
if r.returncode != 0:
    print(r.stderr[-1500:])
else:
    size = OUT.stat().st_size / 1e6
    print(f"  wrote {OUT} ({size:.1f} MB, {total}s)")
