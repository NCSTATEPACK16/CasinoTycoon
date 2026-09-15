"""Sic Bo Table -- 2x2 footprint, final display 220x158 px, 1.4x wider than tall.

Brief: bright blue felt printed with a dense grid of rectangular betting cells, a
chrome-and-glass dice shaker dome at the dealer's end holding three white dice, padded
black leather armrest rail, dark wood base, dealer's chip rack.

Animated regions: the printed layout in three horizontal bands (rule A -- level, parallel,
equal, gapped, so they can light in sequence) plus the dice dome as a spinner (rule B --
a complete unoccluded circle with its stand entirely below it).
"""

import math

import lib
import palette as pal

# 2x2. Screen width = (a+b)*0.7071, height = (a+b)*0.3536 + H*sin60. With a 1.9 square
# footprint, H ~= 0.66 lands the 1.4:1 silhouette.
A = B = 1.9
H = 0.66

BANDS = 3


def build() -> None:
    felt, _rail, top = lib.table_base("sicbo", A, B, H, pal.FELT_BLUE, trim=pal.BRASS)
    del felt

    # --- printed layout: three straight horizontal bands of equal height, separated by a
    # visible darker divider running the full width. No diagonal or radial arrangement --
    # an uneven layout cannot be sequenced.
    lay_w, lay_d = A * 0.70, B * 0.52
    band_d = lay_d / BANDS
    for band in range(BANDS):
        cy = -lay_d / 2 + band_d * (band + 0.5)
        made = []
        # A row of betting cells, each with a hard bright border, drawn fully ON.
        for c in range(6):
            cx = -lay_w / 2 + lay_w * (c + 0.5) / 6
            made += lib.felt_cell(
                f"cell_{band}_{c}",
                (cx, cy, top),
                (lay_w / 7.4, band_d * 0.56),
                pal.FELT_BLUE_DARK if band % 2 else pal.FELT_BLUE,
                edge=pal.WHITE if band != 1 else pal.YELLOW,
            )
        lib.mark_light_box("light", f"layout-{band}", made)
        # The divider between bands. Not part of either crop.
        if band < BANDS - 1:
            lib.box(
                f"divider_{band}",
                (0, cy + band_d / 2, top),
                (lay_w + 0.04, 0.018, 0.006),
                pal.BEZEL,
                flat=True,
            )

    # --- dice shaker dome at the dealer's end (+Y), clear of every layout band so no crop
    # can catch it, with its stand entirely outside and below the circle.
    dome_y = B * 0.34
    dome_z = top + 0.20
    dome_r = 0.16
    lib.box("dome_stand", (0, dome_y, top + 0.035), (0.17, 0.12, 0.07), pal.CHROME_DARK)
    glass = lib.cylinder(
        "dome_glass", (0, dome_y - 0.02, dome_z), dome_r, 0.02, pal.BEZEL,
        rotation=(math.radians(90), 0, 0), verts=26, flat=True,
    )
    lib.cylinder(
        "dome_rim", (0, dome_y - 0.012, dome_z), dome_r * 1.09, 0.02, pal.CHROME,
        rotation=(math.radians(90), 0, 0), verts=26, flat=True,
    )
    # Three dice, arranged evenly on a ring so the pattern is rotationally regular --
    # a dome with one feature in it reads as a picture being spun, not as a spin.
    for i in range(3):
        ang = 2 * math.pi * i / 3 + math.pi / 6
        lib.box(
            f"die_{i}",
            (math.cos(ang) * dome_r * 0.48, dome_y - 0.032, dome_z + math.sin(ang) * dome_r * 0.48),
            (0.052, 0.01, 0.052),
            pal.WHITE,
            flat=True,
        )
    lib.mark_light_box("spin", "dome", glass)

    # --- dealer's chip rack, a fixture at the dealer edge and outside every betting spot.
    lib.chip_rack("rack", (0, B * 0.30, top + 0.02), A * 0.34, pal.CHROME_DARK, pal.RED)
