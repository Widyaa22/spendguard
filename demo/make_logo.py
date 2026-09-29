#!/usr/bin/env python3
"""
Generate the SpendGuard project logo.

The mark states the product: a shield split down the middle into two halves with a gap between them, one lock per
half, which is the 2-of-2 authority an agent cannot cross. Geometry is computed symmetrically about x = centre
rather than eyeballed, and the whole thing is drawn at 3x and downsampled so the edges are clean.

Also writes a square 512 version and a wide 1600x900 banner for the public project page.
"""
import pathlib

from PIL import Image, ImageDraw, ImageFont

SIZE = 1024
SS = 3  # supersample factor
BG = (13, 17, 23)
PANEL = (22, 27, 34)
EDGE = (88, 166, 255)
FILL = (17, 32, 54)
OK = (63, 185, 80)
FG = (230, 237, 243)
DIM = (139, 148, 158)
FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

# shield geometry, in 1024-space, symmetric about x = CX
CX = 512.0
TOP = 150.0
SHOULDER = 470.0
TIP = 800.0
HALF_W = 290.0
GAP = 24.0  # the seam: background shows through here, i.e. two halves, not one


def taper_y(x: float) -> float:
    """y of the shield's lower taper at horizontal position x (between the shoulder and the tip)."""
    return SHOULDER + (abs(x - CX) / HALF_W) * (TIP - SHOULDER)


def draw_shield(d: ImageDraw.ImageDraw, scale: float) -> None:
    half = GAP / 2

    def poly(sign: int):
        x_out = CX + sign * HALF_W
        x_in = CX + sign * half
        return [
            (x_out, TOP), (x_in, TOP),
            (x_in, taper_y(x_in)), (x_out, SHOULDER),
        ]

    for sign in (-1, 1):
        pts = [(x * scale, y * scale) for x, y in poly(sign)]
        d.polygon(pts, fill=FILL)
        d.line(pts + [pts[0]], fill=EDGE, width=int(9 * scale), joint="curve")

    # one lock per half, mirrored exactly about the centre
    for sign in (-1, 1):
        lx = CX + sign * 150
        body = [lx - 54, 400, lx + 54, 556]
        d.rounded_rectangle([v * scale for v in body], radius=18 * scale, fill=EDGE)
        d.arc([(lx - 38) * scale, 334 * scale, (lx + 38) * scale, 470 * scale],
              start=180, end=360, fill=EDGE, width=int(17 * scale))
        # keyhole
        d.ellipse([(lx - 11) * scale, 452 * scale, (lx + 11) * scale, 474 * scale], fill=BG)

    # guard armed: a single status dot exactly on the seam
    d.ellipse([(CX - 17) * scale, 640 * scale, (CX + 17) * scale, 674 * scale], fill=OK)


def render_square() -> Image.Image:
    im = Image.new("RGB", (SIZE * SS, SIZE * SS), BG)
    d = ImageDraw.Draw(im)
    draw_shield(d, SS)

    f = ImageFont.truetype(FONT_BOLD, int(72 * SS))
    text = "SPENDGUARD"
    d.text((CX * SS - d.textlength(text, font=f) / 2, 852 * SS), text, font=f, fill=FG)

    f2 = ImageFont.truetype(FONT_BOLD, int(30 * SS))
    tag = "an agent cannot exceed it"
    d.text((CX * SS - d.textlength(tag, font=f2) / 2, 946 * SS), tag, font=f2, fill=DIM)

    return im.resize((SIZE, SIZE), Image.Resampling.LANCZOS)


def render_banner() -> Image.Image:
    w, h = 1600, 900
    im = Image.new("RGB", (w * SS, h * SS), BG)
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, w * SS, 6 * SS], fill=EDGE)

    f = ImageFont.truetype(FONT_BOLD, int(96 * SS))
    f2 = ImageFont.truetype(FONT_BOLD, int(40 * SS))
    f3 = ImageFont.truetype(FONT_BOLD, int(34 * SS))
    d.text((90 * SS, 300 * SS), "SPENDGUARD", font=f, fill=FG)
    d.text((94 * SS, 430 * SS), "a budget your agent cannot exceed", font=f2, fill=EDGE)
    d.text((94 * SS, 500 * SS), "Solana · 2-of-2 SPL Token multisig vault · on-chain audit trail",
           font=f3, fill=DIM)

    # the mark, drawn to the right of the wordmark using the same geometry
    mark = Image.new("RGB", (SIZE, SIZE), BG)
    md = ImageDraw.Draw(mark)
    draw_shield(md, 1.0)
    mark = mark.resize((560, 560), Image.Resampling.LANCZOS)
    im.paste(mark, (1010 * SS, 170 * SS))

    return im.resize((w, h), Image.Resampling.LANCZOS)


here = pathlib.Path(__file__).resolve().parent
for img, name in ((render_square(), "spendguard-logo.png"),
                  (render_square().resize((512, 512), Image.Resampling.LANCZOS), "spendguard-logo-512.png"),
                  (render_banner(), "spendguard-banner.png")):
    p = here / name
    img.save(p, "PNG", optimize=True)
    print(f"  wrote {p.name} ({p.stat().st_size/1024:.0f} KB, {img.size[0]}x{img.size[1]})")
