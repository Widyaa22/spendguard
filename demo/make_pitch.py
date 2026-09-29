#!/usr/bin/env python3
"""
Render the Colosseum pitch video: 2 minutes max, in English, answering exactly the three things the listing asks
(what you are building, why it matters, why you). It reuses the real devnet screenshots as evidence rather than
mockups, and it is deliberately shorter than the demo video because that listing caps the pitch at 2 minutes.

Usage: python3 demo/make_pitch.py
"""
import json
import pathlib
import shutil
import subprocess
import textwrap

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
FRAMES = ROOT / "demo" / "pitch_frames"
SHOTS = ROOT / "evidence" / "shots"
OUT = ROOT / "demo" / "spendguard-pitch.mp4"
W, H = 1280, 720

BG = (13, 17, 23)
PANEL = (22, 27, 34)
FG = (230, 237, 243)
DIM = (139, 148, 158)
ACC = (88, 166, 255)
OK = (63, 185, 80)
WARN = (210, 153, 34)

F = "/usr/share/fonts/truetype/dejavu/"
title_f = ImageFont.truetype(F + "DejaVuSans-Bold.ttf", 54)
head_f = ImageFont.truetype(F + "DejaVuSans-Bold.ttf", 30)
sub_f = ImageFont.truetype(F + "DejaVuSans.ttf", 25)
body_f = ImageFont.truetype(F + "DejaVuSans.ttf", 21)
small_f = ImageFont.truetype(F + "DejaVuSans.ttf", 17)
mono_f = ImageFont.truetype(F + "DejaVuSansMono.ttf", 16)

slides = []


def new_frame():
    im = Image.new("RGB", (W, H), BG)
    return im, ImageDraw.Draw(im)


def save(im, name, seconds):
    FRAMES.mkdir(parents=True, exist_ok=True)
    path = FRAMES / f"{len(slides):02d}-{name}.png"
    im.save(path)
    slides.append((path, seconds))
    print(f"  frame {path.name}  {seconds}s")


def card(name, seconds, kicker, title, lines):
    im, d = new_frame()
    d.text((80, 84), kicker.upper(), font=small_f, fill=ACC)
    d.text((80, 124), title, font=title_f, fill=FG)
    d.line([(80, 208), (W - 80, 208)], fill=(48, 54, 61), width=2)
    y = 250
    for line, colour, font in lines:
        for chunk in textwrap.wrap(line, 74) or [""]:
            d.text((80, y), chunk, font=font, fill=colour)
            y += font.size + 12
        y += 6
    save(im, name, seconds)


def shot(name, seconds, png, step, verdict, colour):
    im, d = new_frame()
    d.rectangle([0, 0, W, 87], fill=PANEL)
    d.text((30, 10), step, font=sub_f, fill=FG)
    d.text((30, 48), verdict, font=body_f, fill=colour)
    im.paste(Image.open(SHOTS / png), (0, 87))
    save(im, name, seconds)


# ---------------------------------------------------------------- the pitch (target: under 120s)
card("hook", 11, "the problem, in one sentence",
     "An agent with a wallet\ncan pay anyone, any amount.",
     [("Today the limit lives in a server that decides, then signs.", DIM, body_f),
      ("So the limit is a promise, not a constraint: compromise the agent,", DIM, body_f),
      ("or bug the service, and the rule is gone. The rule was never where the money is.", DIM, body_f)])

card("what", 15, "what i am building",
     "SpendGuard",
     [("The agent's funds sit behind a 2-of-2 SPL Token multisig:", FG, body_f),
      ("the agent's key and a guard key. A spend needs both signatures,", FG, body_f),
      ("so the token program itself refuses a payment the guard did not co-sign.", ACC, body_f),
      ("", DIM, small_f),
      ("The guard co-signs only when the policy allows: daily limit, per-transaction", DIM, body_f),
      ("limit, recipient allowlist, kill switch. Every decision lands in a Memo.", DIM, body_f)])

shot("proof-1", 16, "01-allowed.png",
     "here is the working MVP on Devnet, in the browser",
     "the agent pays 10 to an allowlisted vendor: both keys sign, memo written", OK)

shot("proof-2", 20, "03-chain-refused.png",
     "and here is the case that matters most",
     "the agent signs alone with its own key: Solana refuses, the vault is 2-of-2", WARN)

card("why", 16, "why it matters",
     "Agents are getting wallets before they get limits",
     [("Payments are the next thing agents do autonomously, and the entire safety story", FG, body_f),
      ("today is a service deciding to sign. That does not survive a compromised agent.", DIM, body_f),
      ("", DIM, small_f),
      ("Moving the budget into the vault changes the failure mode: a stolen agent key", ACC, body_f),
      ("can no longer move a cent, and the audit trail is written by the chain.", ACC, body_f)])

card("me", 16, "why me",
     "I ship working systems, and I verify them",
     [("This MVP exists as of today: 12 passing policy tests, a live console on Devnet,", FG, body_f),
      ("a public repo, and the demo video you are watching. I ran it against real Solana", FG, body_f),
      ("and it found two real bugs (a missing Buffer shim, a broken import) which are fixed", FG, body_f),
      ("and now covered by a typecheck step in the build.", DIM, body_f),
      ("", DIM, small_f),
      ("I build the thing, then I try to break it. That is the whole working style.", ACC, body_f)])

card("close", 9, "try it",
     "SpendGuard",
     [("live        https://widyaa22.github.io/spendguard/", ACC, sub_f),
      ("code        https://github.com/Widyaa22/spendguard", ACC, sub_f),
      ("built for the Colosseum hackathon", DIM, small_f)])

manifest = FRAMES / "concat.txt"
with manifest.open("w") as fh:
    # the duration directive on the final entry is honoured (a duplicate final "file" line would make ffmpeg
    # count the last slide twice, which pushed both videos past their length targets)
    for path, seconds in slides:
        fh.write(f"file '{path}'\nduration {seconds}\n")

total = sum(s for _, s in slides)
print(f"  {len(slides)} slides, {total}s (target: under 120s)")
if total > 118:
    print("  [!] too long for the 2 minute cap — trim a slide")

ffmpeg = shutil.which("ffmpeg") or "/home/ubuntu/.hermes/tools/ffmpeg-9.0.1-linux-arm64/bin/ffmpeg"
r = subprocess.run(
    [ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", str(manifest),
     "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-preset", "medium", "-crf", "20",
     "-movflags", "+faststart", str(OUT)],
    capture_output=True, text=True,
)
print("  ffmpeg exit:", r.returncode)
if r.returncode != 0:
    print(r.stderr[-1200:])
else:
    print(f"  wrote {OUT} ({OUT.stat().st_size / 1e6:.1f} MB, {total}s)")
