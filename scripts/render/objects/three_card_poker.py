"""Three-Card Poker -- 2x2 footprint, final display 220x150 px, 1.45x wider than tall.

Brief: a compact semicircular card table with royal blue felt. Four player positions in an
even arc along the curved edge, each with three labelled betting circles in a row (ANTE,
PLAY, PAIR PLUS). Curved dealer's chip rack and a card shoe at the flat dealer edge.

No animated regions -- this one gets the card/chip dealing FX instead, which is why rule E
matters here: betting circles and printed layout, but no loose cards and no chips lying on
the felt, or the animated pieces have nowhere clean to land.
"""

import math

import lib
import palette as pal

A = B = 1.9
H = 0.60

SEATS = 4


def build() -> None:
    felt, _rail, top = lib.table_base(
        "tcp", A, B, H, pal.FELT_BLUE, oval=True, trim=pal.BRASS
    )
    del felt

    # Four player positions in an even arc along the curved (-Y) player edge. The arc
    # spans the front half only, which is what makes it read as semicircular even though
    # the carcass is a full cylinder.
    radius = min(A, B) * 0.30
    for seat in range(SEATS):
        t = (seat + 0.5) / SEATS
        ang = math.pi * (0.10 + 0.80 * t) + math.pi  # front half, -Y side
        sx, sy = math.cos(ang) * radius, math.sin(ang) * radius

        # ANTE / PLAY / PAIR PLUS, in a row, running tangentially so they read as one
        # position rather than three unrelated spots.
        tx, ty = -math.sin(ang), math.cos(ang)
        for i, colour in enumerate((pal.WHITE, pal.BRASS, pal.RED)):
            off = (i - 1) * 0.105
            lib.cylinder(
                f"spot_{seat}_{i}",
                (sx + tx * off, sy + ty * off, top),
                0.042,
                0.006,
                colour,
                verts=14,
                flat=True,
            )
            lib.cylinder(
                f"spot_{seat}_{i}_in",
                (sx + tx * off, sy + ty * off, top + 0.004),
                0.030,
                0.006,
                pal.FELT_BLUE,
                verts=14,
                flat=True,
            )

    # Flat dealer edge: chip rack and card shoe, both fixtures, both well outside every
    # betting circle.
    lib.chip_rack("rack", (0, B * 0.30, top + 0.02), A * 0.36, pal.CHROME_DARK, pal.RED)
    lib.box("shoe", (A * 0.26, B * 0.28, top + 0.05), (0.15, 0.11, 0.09), pal.CHROME_DARK)
    lib.box("shoe_lid", (A * 0.26, B * 0.28, top + 0.10), (0.16, 0.12, 0.014), pal.CHROME)
