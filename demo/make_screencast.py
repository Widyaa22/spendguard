#!/usr/bin/env python3
"""
Assemble the live-product screencast from the frames captured while driving the real app on devnet.

The Colosseum form asks for a demo that shows the live product rather than a slide deck, so this video is nothing
but frames of the running console with a caption bar: the vault being created, a real approved spend, and the
three refusals. Timing comes from the capture timestamps, so what a viewer sees is the actual pace of the run
(clamped so a slow devnet confirmation does not stall the video).

Usage: python3 demo/make_screencast.py
"""
import json
import pathlib
import shutil
import subprocess

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "evidence" / "screencast"
FRAMES = ROOT / "demo" / "screen_frames"
OUT = ROOT / "demo" / "spendguard-live.mp4"

W, H = 1280, 720
BAR = 62
BG = (13, 17, 23)
PANEL = (22, 27, 34)
FG = (230, 237, 243)
DIM = (139, 148, 158)
ACC = (88, 166, 255)
OK = (63, 185, 80)
BAD = (248, 81, 73)
WARN = (210, 153, 34)

F = "/usr/share/fonts/truetype/dejavu/"
cap_f = ImageFont.truetype(F + "DejaVuSans-Bold.ttf", 25)
small_f = ImageFont.truetype(F + "DejaVuSans.ttf", 17)
title_f = ImageFont.truetype(F + "DejaVuSans-Bold.ttf", 52)
sub_f = ImageFont.truetype(F + "DejaVuSans.ttf", 24)

CAPTIONS = {
    "halaman dibuka": ("the live console, running in the browser against devnet", ACC),
    "wallet dibuat": ("create a throwaway wallet (owner, agent, guard keys)", DIM),
    "sesi dipulihkan": ("session restored, owner funded from the devnet faucet", DIM),
    "membuat vault": ("creating the vault: a 2-of-2 SPL Token multisig owns it", ACC),
    "vault jadi": ("vault created and named in the interface", OK),
    "vault terisi": ("vault funded with 200 tokens, ready for the agent to spend", OK),
    "policy disiapkan": ("policy: daily 50, per transaction 30, allowlist = this vendor only", DIM),
    "bayar 10": ("the agent pays 10 to the allowlisted vendor", FG),
    "berhasil": ("approved: both keys signed, memo written, real devnet transaction", OK),
    "tolak per-tx": ("the agent tries 31 against a per-transaction limit of 30", BAD),
    "agent sendiri": ("the agent builds the payment itself and signs with its own key only", WARN),
    "rantai menolak": ("Solana refuses it: the vault is 2-of-2 and the agent is only half of it", WARN),
    "kill switch": ("the owner flips the kill switch", FG),
    "tolak saat paused": ("the guard stops co-signing, so nothing gets through", BAD),
    "kembali normal": ("released. the vault holds 190 of the 200 the agent deposited", OK),
}

data = json.loads((SRC / "marks.json").read_text())
marks = [m for m in data["marks"] if (SRC / m["file"]).exists()]
slides = []
FRAMES.mkdir(parents=True, exist_ok=True)


def save(im, name, seconds):
    p = FRAMES / name
    im.save(p)
    slides.append((p, seconds))


def intro():
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    d.text((80, 220), "SpendGuard on Solana devnet", font=title_f, fill=FG)
    d.line([(80, 296), (W - 80, 296)], fill=(48, 54, 61), width=2)
    d.text((80, 330), "The live console, no slides: a 2-of-2 vault, an approved spend,", font=sub_f, fill=DIM)
    d.text((80, 366), "and three refusals, including one by the Solana runtime itself.", font=sub_f, fill=DIM)
    d.text((80, 430), "everything on screen is a real transaction against devnet", font=small_f, fill=ACC)
    save(im, "00-intro.png", 7)


def outro():
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    d.text((80, 200), "SpendGuard", font=title_f, fill=FG)
    d.line([(80, 276), (W - 80, 276)], fill=(48, 54, 61), width=2)
    d.text((80, 310), "live console   https://widyaa22.github.io/spendguard/", font=sub_f, fill=ACC)
    d.text((80, 350), "source         https://github.com/Widyaa22/spendguard", font=sub_f, fill=ACC)
    d.text((80, 410), "policy engine with 12 passing tests · devnet end to end · MIT licensed", font=small_f, fill=DIM)
    save(im, "99-outro.png", 8)


def frame(mark, seconds):
    tag = mark.get("tag", "")
    text, colour = CAPTIONS.get(tag, (tag or "the live console", DIM))
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, W, BAR], fill=PANEL)
    d.text((26, 19), text, font=cap_f, fill=colour)
    shot = Image.open(SRC / mark["file"])
    im.paste(shot, (0, BAR))
    save(im, f"{mark['file']}", seconds)


intro()
for i, m in enumerate(marks):
    if i + 1 < len(marks):
        seconds = marks[i + 1]["t"] - m["t"]
    else:
        seconds = 3.0
    # clamp: keep the pace readable without letting a slow confirmation stall the video
    frame(m, max(1.8, min(seconds, 7.0)))
outro()

manifest = FRAMES / "concat.txt"
with manifest.open("w") as fh:
    for path, seconds in slides:
        fh.write(f"file '{path}'\nduration {seconds:.2f}\n")

total = sum(s for _, s in slides)
print(f"  {len(slides)} slides, {total:.1f}s total")

ffmpeg = shutil.which("ffmpeg") or "/home/ubuntu/.hermes/tools/ffmpeg-9.0.1-linux-arm64/bin/ffmpeg"
r = subprocess.run(
    [ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", str(manifest),
     "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-preset", "medium", "-crf", "21",
     "-movflags", "+faststart", str(OUT)],
    capture_output=True, text=True,
)
print("  ffmpeg exit:", r.returncode)
if r.returncode != 0:
    print(r.stderr[-1200:])
else:
    print(f"  wrote {OUT} ({OUT.stat().st_size/1e6:.1f} MB)")
