"""Pai Gow Poker -- 2x2 footprint, final display 220x150 px, 1.45x wider than tall.

Brief: a broad oval card table with deep jade green felt and a red-and-gold oriental
border printed around the rim. Six player positions evenly spaced around the outer edge,
each with one large betting circle and smaller HIGH and LOW hand boxes above it. Dealer's
chip rack, card shoe and a small dice cup holding three dice at the dealer position.

No animated regions -- dealing FX only, so rule E applies: printed layout, no loose cards
or chips on the felt.
"""

import math

import lib
import palette as pal

A = B = 1.9
H = 0.60

SEATS = 6


def build() -> None:
    felt, _rail, top = lib.table_base(
        "paigow", A, B, H, pal.FELT, oval=True, trim=pal.BRASS
    )
    del felt

    # Red-and-gold oriental border around the rim, as alternating segments. Radially
    # regular, which is what keeps it reading as a border rather than as decoration that
    # happens to be arranged in a circle.
    rim_r = min(A, B) * 0.415
    for i in range(24):
        ang = 2 * math.pi * i / 24
        lib.box(
            f"border_{i}",
            (math.cos(ang) * rim_r, math.sin(ang) * rim_r, top + 0.002),
            (0.055, 0.055, 0.006),
            pal.RED if i % 2 else pal.BRASS,
            flat=True,
        )

    # Six positions evenly spaced around the outer edge. Each: one large betting circle
    # with a HIGH and a LOW hand box sitting inboard of it.
    radius = min(A, B) * 0.30
    for seat in range(SEATS):
        ang = 2 * math.pi * seat / SEATS + math.pi / SEATS
        sx, sy = math.cos(ang) * radius, math.sin(ang) * radius
        lib.cylinder(f"bet_{seat}", (sx, sy, top), 0.050, 0.006, pal.BRASS, verts=14, flat=True)
        lib.cylinder(
            f"bet_{seat}_in", (sx, sy, top + 0.004), 0.037, 0.006, pal.FELT, verts=14, flat=True
        )
        # HIGH and LOW boxes, pushed toward the table centre so they never overlap the
        # betting circle the dealing FX targets.
        inx, iny = -math.cos(ang), -math.sin(ang)
        tx, ty = -math.sin(ang), math.cos(ang)
        for j, off in enumerate((-0.062, 0.062)):
            lib.box(
                f"hand_{seat}_{j}",
                (sx + inx * 0.135 + tx * off, sy + iny * 0.135 + ty * off, top + 0.002),
                (0.055, 0.038, 0.006),
                pal.WHITE,
                flat=True,
            )

    lib.chip_rack("rack", (0, B * 0.30, top + 0.02), A * 0.34, pal.CHROME_DARK, pal.RED)
    lib.box("shoe", (A * 0.24, B * 0.28, top + 0.05), (0.14, 0.10, 0.09), pal.CHROME_DARK)
    # Dice cup — pai gow uses dice to set the deal order. A fixture, not a spinner: it is
    # small, opaque and never animated, so it carries no light box.
    lib.cylinder("dice_cup", (-A * 0.24, B * 0.28, top + 0.055), 0.055, 0.10, pal.RED, verts=14)
