#!/usr/bin/env python3
"""
Final logo files for SpendGuard.

Two lockups, both built on the same idea: spending fills a bar, and the bar stops at a hard limit. The first
states it with a label pair, the second with a shield whose seam is interrupted by a lock (the 2-of-2 authority).
A mark-only file is also written for the favicon and the X avatar, where any label would be illegible.

Everything is measured from the centre rather than eyeballed, drawn at 3x and downsampled.

Usage: python3 demo/make_logo_final.py
"""
import pathlib

from PIL import Image, ImageDraw, ImageFont

S, SS = 1024, 3
BG = (13, 17, 23)
PANEL = (22, 27, 34)
EDGE = (88, 166, 255)
EDGE_D = (35, 78, 130)
FILL = (17, 32, 54)
TRACK = (28, 40, 60)
OK = (63, 185, 80)
STOP = (248, 81, 73)
FG = (230, 237, 243)
DIM = (139, 148, 158)
BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

HERE = pathlib.Path(__file__).resolve().parent


def new():
    im = Image.new("RGB", (S * SS, S * SS), BG)
    return im, ImageDraw.Draw(im)


def label(d, text, cx, y, size, colour, anchor="mm"):
    d.text((cx * SS, y * SS), text, font=ImageFont.truetype(BOLD, int(size * SS)), fill=colour, anchor=anchor)


def wordmark(d, tag, y=700):
    label(d, "SPENDGUARD", S / 2, y, 72, FG)
    label(d, tag, S / 2, y + 92, 28, DIM)


def budget_bar(d, y0=430, y1=492, x0=300, x1=724, fill_ratio=0.62, in_card=True):
    """Track, the spent portion, and the hard limit the bar cannot pass. All inside the card."""
    if in_card:
        d.rounded_rectangle([236 * SS, 300 * SS, 788 * SS, 620 * SS], radius=46 * SS,
                            fill=FILL, outline=EDGE, width=int(9 * SS))
    d.rounded_rectangle([x0 * SS, y0 * SS, x1 * SS, y1 * SS], radius=(y1 - y0) / 2 * SS, fill=TRACK)
    d.rounded_rectangle([x0 * SS, y0 * SS, (x0 + (x1 - x0) * fill_ratio) * SS, y1 * SS],
                        radius=(y1 - y0) / 2 * SS, fill=EDGE)
    # the limit line sits inside the track, so nothing breaks the silhouette
    d.rectangle([(x1 - 12) * SS, (y0 - 22) * SS, (x1 + 12) * SS, (y1 + 22) * SS], fill=STOP)
    if in_card:
        label(d, "BUDGET", 300, 352, 32, DIM, anchor="lm")
        label(d, "LIMIT", 724, 352, 32, STOP, anchor="rm")


# ---------------------------------------------------------------- lockup 1: the bar, labelled
def lockup_bar():
    im, d = new()
    budget_bar(d)
    wordmark(d, "an on-chain spend policy for agents", y=760)
    return im.resize((S, S), Image.Resampling.LANCZOS)


# ---------------------------------------------------------------- mark only (favicon / avatar)
def mark_only():
    im, d = new()
    # same bar, no labels, filling the square: legible at 32px
    d.rounded_rectangle([132 * SS, 330 * SS, 892 * SS, 694 * SS], radius=70 * SS,
                        fill=FILL, outline=EDGE, width=int(16 * SS))
    d.rounded_rectangle([212 * SS, 476 * SS, 812 * SS, 548 * SS], radius=36 * SS, fill=TRACK)
    d.rounded_rectangle([212 * SS, 476 * SS, 585 * SS, 548 * SS], radius=36 * SS, fill=EDGE)
    d.rectangle([792 * SS, 440 * SS, 832 * SS, 584 * SS], fill=STOP)
    return im.resize((512, 512), Image.Resampling.LANCZOS)


# ---------------------------------------------------------------- lockup 2: shield, seam interrupted by the lock
def lockup_shield():
    im, d = new()
    cx, top, shoulder, tip, half = S / 2, 150, 470, 800, 290
    pts = [((cx - half) * SS, top * SS), ((cx + half) * SS, top * SS),
           ((cx + half) * SS, shoulder * SS), (cx * SS, tip * SS), ((cx - half) * SS, shoulder * SS)]
    d.polygon(pts, fill=FILL)
    d.line(pts + [pts[0]], fill=EDGE, width=int(9 * SS), joint="curve")

    # the seam exists only where the lock does not sit: above it and below it
    d.rectangle([(cx - 5) * SS, (top + 4) * SS, (cx + 5) * SS, 300 * SS], fill=BG)
    d.rectangle([(cx - 5) * SS, 600 * SS, (cx + 5) * SS, (tip - 26) * SS], fill=BG)

    # the lock, centred on the seam and large enough to read
    d.rounded_rectangle([(cx - 150) * SS, 380 * SS, (cx + 150) * SS, 600 * SS],
                        radius=30 * SS, fill=PANEL, outline=EDGE, width=int(9 * SS))
    d.arc([(cx - 66) * SS, 300 * SS, (cx + 66) * SS, 440 * SS], start=180, end=360, fill=EDGE, width=int(22 * SS))
    # keyhole, exactly centred
    d.ellipse([(cx - 26) * SS, 452 * SS, (cx + 26) * SS, 504 * SS], fill=OK)
    d.polygon([((cx - 13) * SS, 496 * SS), ((cx + 13) * SS, 496 * SS),
               ((cx + 7) * SS, 556 * SS), ((cx - 7) * SS, 556 * SS)], fill=OK)

    wordmark(d, "two keys, one vault", y=846)
    return im.resize((S, S), Image.Resampling.LANCZOS)


made = {}
for name, fn, size in (("spendguard-logo.png", lockup_bar, 1024),
                       ("spendguard-mark.png", mark_only, 512),
                       ("spendguard-logo-alt.png", lockup_shield, 1024)):
    im = fn()
    p = HERE / name
    im.save(p, "PNG", optimize=True)
    made[name] = im
    print(f"  wrote {name} ({im.size[0]}x{im.size[1]}, {p.stat().st_size/1024:.0f} KB)")

# comparison sheet: the two lockups, plus the mark at the size a favicon actually uses
sheet = Image.new("RGB", (2200, 1120), (9, 12, 17))
sheet.paste(made["spendguard-logo.png"], (30, 40))
sheet.paste(made["spendguard-logo-alt.png"], (1090, 40))
sheet.paste(made["spendguard-mark.png"].resize((320, 320), Image.Resampling.LANCZOS), (1120, 700))
for px, x in ((64, 1520), (32, 1640), (24, 1720)):
    sheet.paste(made["spendguard-mark.png"].resize((px, px), Image.Resampling.LANCZOS), (x, 700 + (320 - px) // 2))
sheet.save(HERE / "logo-final-sheet.png", "PNG", optimize=True)
print("  wrote logo-final-sheet.png")
