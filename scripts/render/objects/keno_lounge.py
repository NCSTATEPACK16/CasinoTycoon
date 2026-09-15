"""Keno Lounge -- 2x2 footprint, final display 220x200 px, roughly square.

Brief: "a low padded lounge counter in dark wood and burgundy vinyl, with a large flat keno
results board mounted on a post rising behind it. The board is a dark panel printed with a
grid of 80 small numbered circles in 4 rows of 20, drawn in bright yellow on black. A round
glass ball-blower dome sits on the counter at one end. Keno paper slips and a cup of
crayons sit on the counter surface."

Animated regions: the number board in 4 horizontal bands (so it can light row by row) plus
the ball-blower dome as a spinner. The board is the main event and rule A governs it: four
straight level rows of equal height with a clear dark gap between each.
"""

import math

import lib
import palette as pal

# 2x2 footprint. Screen width = (a+b)*0.7071 and height = (a+b)*0.3536 + H*sin60, so with
# a 1.9 x 1.5 mass H ~= 1.14 lands the 220x200 proportion.
A = 2.25  # counter run, along X
B = 1.5   # depth, along Y
H = 1.10

COUNTER_H = 0.36
FRONT = -B / 2 - 0.008

ROWS, PER_ROW = 4, 20


def build() -> None:
    # --- low padded lounge counter: dark wood carcass, burgundy vinyl front pad.
    lib.box("counter", (0, 0.10, COUNTER_H / 2), (A, B * 0.42, COUNTER_H), pal.WOOD_DARK)
    lib.box("counter_top", (0, 0.10, COUNTER_H + 0.018), (A + 0.05, B * 0.42 + 0.05, 0.036), pal.WOOD)
    lib.box(
        "vinyl_pad",
        (0, 0.10 - B * 0.21 - 0.022, COUNTER_H * 0.62),
        (A * 0.96, 0.045, COUNTER_H * 0.46),
        pal.RED,
    )
    lib.box("kick", (0, 0.10, 0.035), (A * 0.98, B * 0.42 + 0.02, 0.07), pal.BLACK)

    # --- the board, on a post rising behind the counter. The post is deliberately narrow
    # and sits behind, so nothing crosses the board's face.
    board_y = 0.10 + B * 0.21 - 0.05
    board_w = A * 0.90
    board_lo, board_hi = COUNTER_H + 0.12, H
    board_h = board_hi - board_lo
    board_cz = (board_lo + board_hi) / 2

    lib.box("post_l", (-board_w * 0.34, board_y + 0.03, board_lo / 2 + 0.10), (0.055, 0.055, board_lo), pal.CHROME_DARK)
    lib.box("post_r", (board_w * 0.34, board_y + 0.03, board_lo / 2 + 0.10), (0.055, 0.055, board_lo), pal.CHROME_DARK)
    lib.box(
        "board_bezel",
        (0, board_y, board_cz),
        (board_w + 0.05, 0.03, board_h + 0.05),
        pal.BEZEL,
        flat=True,
    )
    lib.box("board_ground", (0, board_y - 0.018, board_cz), (board_w, 0.012, board_h), pal.BLACK, flat=True)

    # 80 numbers, 4 straight level rows of 20, each a hard-edged flat yellow disc in a dark
    # ring, drawn fully lit. Each row is one crop and one tween phase.
    row_h = board_h / ROWS
    disc_r = min(board_w / PER_ROW, row_h) * 0.30
    for r in range(ROWS):
        cz = board_lo + row_h * (r + 0.5)
        made = []
        for c in range(PER_ROW):
            cx = -board_w / 2 + board_w * (c + 0.5) / PER_ROW
            made.append(
                lib.cylinder(
                    f"num_{r}_{c}_ring",
                    (cx, board_y - 0.026, cz),
                    disc_r * 1.35,
                    0.006,
                    pal.BEZEL,
                    rotation=(math.radians(90), 0, 0),
                    verts=8,
                    flat=True,
                )
            )
            made.append(
                lib.cylinder(
                    f"num_{r}_{c}",
                    (cx, board_y - 0.034, cz),
                    disc_r,
                    0.006,
                    pal.YELLOW,
                    rotation=(math.radians(90), 0, 0),
                    verts=8,
                    flat=True,
                )
            )
        lib.mark_light_box("light", f"row-{r}", made)

    # --- ball-blower dome. Rule B: a complete unoccluded circle, centred in its own square
    # area with clear margin, radially regular so rotation reads as spin, and with its base,
    # tube and frame entirely below it. Drawn as a true circle rather than an iso ellipse --
    # the brief's deliberate cheat, because rotating an ellipse in 2D wobbles.
    dome_x = A / 2 - 0.30
    dome_y = 0.10 - B * 0.22
    dome_z = COUNTER_H + 0.30
    dome_r = 0.23

    lib.box("dome_base", (dome_x, dome_y, COUNTER_H + 0.06), (0.20, 0.14, 0.08), pal.CHROME_DARK)
    lib.cylinder(
        "dome_tube", (dome_x, dome_y, COUNTER_H + 0.035), 0.030, 0.07, pal.CHROME,
        rotation=(0, 0, 0), verts=12,
    )
    glass = lib.cylinder(
        "dome_glass", (dome_x, dome_y - 0.02, dome_z), dome_r, 0.02, pal.BEZEL,
        rotation=(math.radians(90), 0, 0), verts=28, flat=True,
    )
    lib.cylinder(
        "dome_rim", (dome_x, dome_y - 0.012, dome_z), dome_r * 1.08, 0.02, pal.CHROME,
        rotation=(math.radians(90), 0, 0), verts=28, flat=True,
    )
    # Balls arranged evenly on a ring so the pattern is rotationally regular. A dome with
    # one feature in it reads as a picture being spun, not as a spin.
    for i in range(8):
        ang = 2 * math.pi * i / 8
        lib.cylinder(
            f"dome_ball_{i}",
            (dome_x + math.cos(ang) * dome_r * 0.55, dome_y - 0.032, dome_z + math.sin(ang) * dome_r * 0.55),
            dome_r * 0.15,
            0.01,
            pal.WHITE,
            rotation=(math.radians(90), 0, 0),
            verts=10,
            flat=True,
        )
    lib.mark_light_box("spin", "dome", glass)

    # --- keno slips and a cup of crayons on the counter surface, at the far end from the
    # dome so neither sits inside the spinner's square.
    lib.box("slips", (-A / 2 + 0.34, 0.10 - B * 0.16, COUNTER_H + 0.045), (0.26, 0.18, 0.014), pal.WHITE)
    lib.cylinder(
        "crayon_cup", (-A / 2 + 0.68, 0.10 - B * 0.14, COUNTER_H + 0.08), 0.055, 0.09, pal.RED, verts=12
    )
