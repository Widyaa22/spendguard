#!/usr/bin/env python3
"""
Three logo directions for SpendGuard, each stating a different part of the product. Renders a contact sheet so
they can be compared side by side, plus the individual files at 1024.

A  one shield, one lock on the seam      the 2-of-2 authority (the version currently in the repo)
B  budget bar with a hard stop           the limit itself: spending fills the bar, the bar stops at the line
C  keyhole in a rounded vault            the guard key: nothing opens without it
D  minimal wordmark with a limit line    quietest option, reads well small (favicon, X avatar)

Usage: python3 demo/make_logo_variants.py
"""
import pathlib

from PIL import Image, ImageDraw, ImageFont

S = 1024
SS = 3
BG = (13, 17, 23)
PANEL = (22, 27, 34)
EDGE = (88, 166, 255)
EDGE_D = (35, 78, 130)
FILL = (17, 32, 54)
OK = (63, 185, 80)
STOP = (248, 81, 73)
FG = (230, 237, 243)
DIM = (139, 148, 158)
BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def canvas():
    im = Image.new("RGB", (S * SS, S * SS), BG)
    return im, ImageDraw.Draw(im)


def wordmark(d, text="SPENDGUARD", tag="an agent cannot exceed it", y=846, size=70, tag_size=28):
    f = ImageFont.truetype(BOLD, int(size * SS))
    d.text((S * SS / 2 - d.textlength(text, font=f) / 2, y * SS), text, font=f, fill=FG)
    f2 = ImageFont.truetype(BOLD, int(tag_size * SS))
    d.text((S * SS / 2 - d.textlength(tag, font=f2) / 2, (y + 96) * SS), tag, font=f2, fill=DIM)


def shield_points(cx=S / 2, top=150, shoulder=470, tip=800, half=290):
    return [(cx - half, top), (cx + half, top), (cx + half, shoulder), (cx, tip), (cx - half, shoulder)]


# ---------------------------------------------------------------- A: split shield, one lock
def variant_a():
    im, d = canvas()
    pts = [((x) * SS, (y) * SS) for x, y in shield_points()]
    d.polygon(pts, fill=FILL)
    d.line(pts + [pts[0]], fill=EDGE, width=int(9 * SS), joint="curve")
    # the seam: the two halves of the authority
    d.rectangle([(S / 2 - 5) * SS, 152 * SS, (S / 2 + 5) * SS, 792 * SS], fill=BG)
    # one lock, centred on the seam
    cx = S / 2
    d.rounded_rectangle([(cx - 150) * SS, 380 * SS, (cx + 150) * SS, 560 * SS], radius=26 * SS, fill=PANEL, outline=EDGE, width=int(8 * SS))
    d.arc([(cx - 62) * SS, 316 * SS, (cx + 62) * SS, 440 * SS], start=180, end=360, fill=EDGE, width=int(20 * SS))
    d.ellipse([(cx - 20) * SS, 448 * SS, (cx + 20) * SS, 488 * SS], fill=OK)
    wordmark(d)
    return im.resize((S, S), Image.Resampling.LANCZOS)


# ---------------------------------------------------------------- B: budget bar with a hard stop
def variant_b():
    im, d = canvas()
    pts = [((x) * SS, (y) * SS) for x, y in shield_points(top=180, shoulder=520, tip=760, half=300)]
    d.polygon(pts, fill=FILL)
    d.line(pts + [pts[0]], fill=EDGE, width=int(9 * SS), joint="curve")
    # the bar: spending so far
    x0, x1, y0, y1 = 300, 724, 400, 480
    d.rounded_rectangle([x0 * SS, y0 * SS, x1 * SS, y1 * SS], radius=40 * SS, fill=(28, 40, 60), outline=EDGE_D, width=int(4 * SS))
    d.rounded_rectangle([x0 * SS, y0 * SS, (x0 + (x1 - x0) * 0.62) * SS, y1 * SS], radius=40 * SS, fill=EDGE)
    # the limit: the bar cannot pass it
    d.rectangle([(x1 - 14) * SS, (y0 - 34) * SS, (x1 + 14) * SS, (y1 + 34) * SS], fill=STOP)
    # a blocked arrow trying to push through
    d.polygon([((x1 + 100) * SS, (y0 + 40) * SS), ((x1 + 170) * SS, (y0 + 40) * SS), ((x1 + 130) * SS, (y0 + 82) * SS)], fill=STOP)
    d.rectangle([(x1 + 40) * SS, (y0 + 30) * SS, (x1 + 96) * SS, (y0 + 50) * SS], fill=STOP)
    wordmark(d, "SPENDGUARD", "the limit is the vault's authority")
    return im.resize((S, S), Image.Resampling.LANCZOS)


# ---------------------------------------------------------------- C: vault door
def variant_c():
    im, d = canvas()
    cx, cy, r = S / 2, 460, 260
    d.ellipse([(cx - r) * SS, (cy - r) * SS, (cx + r) * SS, (cy + r) * SS], fill=FILL, outline=EDGE, width=int(11 * SS))
    d.ellipse([(cx - r + 54) * SS, (cy - r + 54) * SS, (cx + r - 54) * SS, (cy + r - 54) * SS], outline=EDGE_D, width=int(6 * SS))
    # handle
    for ang in (0, 120, 240):
        import math
        a = math.radians(ang)
        x2, y2 = cx + math.cos(a) * 150, cy + math.sin(a) * 150
        d.line([(cx * SS, cy * SS), (x2 * SS, y2 * SS)], fill=EDGE, width=int(18 * SS))
    # keyhole: the guard key is what opens it
    d.ellipse([(cx - 46) * SS, (cy - 60) * SS, (cx + 46) * SS, (cy + 32) * SS], fill=OK)
    d.polygon([((cx - 26) * SS, (cy + 10) * SS), ((cx + 26) * SS, (cy + 10) * SS), ((cx + 14) * SS, (cy + 110) * SS), ((cx - 14) * SS, (cy + 110) * SS)], fill=OK)
    wordmark(d, "SPENDGUARD", "two keys, one vault")
    return im.resize((S, S), Image.Resampling.LANCZOS)


# ---------------------------------------------------------------- D: quiet wordmark
def variant_d():
    im, d = canvas()
    d.rounded_rectangle([256 * SS, 300 * SS, 768 * SS, 616 * SS], radius=44 * SS, fill=FILL, outline=EDGE, width=int(9 * SS))
    # a bar that stops short of the wall, with the stop line drawn as part of the frame
    d.rounded_rectangle([318 * SS, 430 * SS, 700 * SS, 486 * SS], radius=28 * SS, fill=(28, 40, 60))
    d.rounded_rectangle([318 * SS, 430 * SS, 596 * SS, 486 * SS], radius=28 * SS, fill=EDGE)
    d.rectangle([700 * SS, 400 * SS, 720 * SS, 516 * SS], fill=STOP)
    d.text((318 * SS, 340 * SS), "BUDGET", font=ImageFont.truetype(BOLD, int(34 * SS)), fill=DIM)
    d.text((604 * SS, 340 * SS), "LIMIT", font=ImageFont.truetype(BOLD, int(34 * SS)), fill=STOP)
    wordmark(d, "SPENDGUARD", "an on-chain spend policy for agents", y=700)
    return im.resize((S, S), Image.Resampling.LANCZOS)


here = pathlib.Path(__file__).resolve().parent
made = []
for label, fn in (("a-split-shield", variant_a), ("b-budget-bar", variant_b),
                  ("c-vault-door", variant_c), ("d-wordmark", variant_d)):
    im = fn()
    p = here / f"logo-variant-{label}.png"
    im.save(p, "PNG", optimize=True)
    made.append((label, im))
    print(f"  wrote {p.name}")

# contact sheet 2x2 so the four can be judged side by side
sheet = Image.new("RGB", (S * 2 + 60, S * 2 + 60), (9, 12, 17))
for i, (label, im) in enumerate(made):
    sheet.paste(im.resize((S, S), Image.Resampling.LANCZOS), ((i % 2) * (S + 20) + 20, (i // 2) * (S + 20) + 20))
sheet.resize((1400, 1400), Image.Resampling.LANCZOS).save(here / "logo-variants-sheet.png")
print("  wrote logo-variants-sheet.png")
