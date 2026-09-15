"""Bingo Hall -- 4x3 footprint, final display 385x260 px, 1.5x wider than tall.

Brief: a long low bank of twelve player desks in two rows of six, pale wood with red vinyl
edging, each carrying a printed card and a dauber. Behind them on a low platform, a
caller's podium with a wire-cage ball tumbler, and a large flat number board on a post
above and behind it, printed with numbered circles in 4 rows and B I N G O down the edge.

The brief warns this is the object most at risk of being drawn as a room. It is furniture
with a low surround, not architecture: desks, a platform, a podium, a board on a post.

Animated regions: the number board in 4 bands (rule A) plus the ball tumbler as a spinner.
"""

import math

import lib
import palette as pal

# 4x3. Screen width = (a+b)*0.7071; with a 3.8 x 2.85 mass and H ~= 0.91 the silhouette
# lands on 1.5:1.
A = 3.8
B = 2.85
H = 0.91

ROWS, PER_ROW = 4, 9
DESK_H = 0.34


def build() -> None:
    # --- twelve player desks, two rows of six, on the player (-Y) half.
    desk_w, desk_d = A * 0.150, B * 0.125
    for row in range(2):
        dy = -B * 0.30 + row * B * 0.17
        for col in range(6):
            dx = -A * 0.42 + col * A * 0.168
            lib.box(f"desk_{row}_{col}", (dx, dy, DESK_H / 2), (desk_w, desk_d, DESK_H), pal.CREAM)
            lib.box(
                f"desk_{row}_{col}_edge",
                (dx, dy, DESK_H + 0.012),
                (desk_w + 0.02, desk_d + 0.02, 0.026),
                pal.RED,
            )
            # Printed card and dauber. Small, but they are what say "bingo" at a glance.
            lib.box(
                f"card_{row}_{col}",
                (dx, dy - desk_d * 0.14, DESK_H + 0.028),
                (desk_w * 0.52, desk_d * 0.46, 0.006),
                pal.WHITE,
                flat=True,
            )
            lib.cylinder(
                f"dauber_{row}_{col}",
                (dx + desk_w * 0.32, dy + desk_d * 0.18, DESK_H + 0.05),
                0.018,
                0.05,
                pal.BLUE,
                verts=8,
            )

    # --- low platform and caller's podium at the back (+Y). A platform, not a floor:
    # it is under the podium only, not under the desks.
    plat_y = B * 0.12
    lib.box("platform", (0, plat_y, 0.055), (A * 0.60, B * 0.26, 0.11), pal.WOOD_DARK)
    lib.box("podium", (0, plat_y, 0.11 + 0.22), (0.44, 0.30, 0.44), pal.WOOD)
    lib.box("podium_top", (0, plat_y, 0.11 + 0.46), (0.50, 0.36, 0.03), pal.WOOD_DARK)

    # --- ball tumbler on the podium. Rule B: a complete unoccluded circle, centred in its
    # own clear area, with the podium entirely below it.
    tum_z = 0.11 + 0.46 + 0.20
    tum_r = 0.19
    cage = lib.cylinder(
        "tumbler", (0, plat_y - 0.02, tum_z), tum_r, 0.02, pal.BEZEL,
        rotation=(math.radians(90), 0, 0), verts=26, flat=True,
    )
    lib.cylinder(
        "tumbler_rim", (0, plat_y - 0.012, tum_z), tum_r * 1.08, 0.02, pal.BRASS,
        rotation=(math.radians(90), 0, 0), verts=26, flat=True,
    )
    for i in range(8):
        ang = 2 * math.pi * i / 8
        lib.cylinder(
            f"ball_{i}",
            (math.cos(ang) * tum_r * 0.55, plat_y - 0.032, tum_z + math.sin(ang) * tum_r * 0.55),
            tum_r * 0.16, 0.01, pal.WHITE,
            rotation=(math.radians(90), 0, 0), verts=10, flat=True,
        )
    lib.mark_light_box("spin", "tumbler", cage)

    # --- number board on a post above and behind the podium, facing the players (-Y).
    board_y = plat_y + 0.42
    board_w = A * 0.68
    board_lo, board_hi = 0.96, H + 0.24
    board_h = board_hi - board_lo
    board_cz = (board_lo + board_hi) / 2

    for side in (-1, 1):
        lib.box(
            f"post_{side}",
            (side * board_w * 0.36, board_y + 0.03, board_lo / 2 + 0.10),
            (0.06, 0.06, board_lo),
            pal.CHROME_DARK,
        )
    lib.box("board_bezel", (0, board_y, board_cz), (board_w + 0.06, 0.03, board_h + 0.06),
            pal.BEZEL, flat=True)
    lib.box("board_ground", (0, board_y - 0.018, board_cz), (board_w, 0.012, board_h),
            pal.BLACK, flat=True)

    # B I N G O down the left edge, outside every row crop so a lit row never takes the
    # letters with it.
    row_h = board_h / ROWS
    for r in range(ROWS):
        lib.box(
            f"letter_{r}",
            (-board_w / 2 + 0.05, board_y - 0.026, board_lo + row_h * (r + 0.5)),
            (0.05, 0.006, row_h * 0.46),
            pal.BRASS,
            flat=True,
        )

    # Four straight level rows of numbers, each one crop and one tween phase.
    num_lo = -board_w / 2 + 0.13
    num_w = board_w - 0.18
    disc_r = min(num_w / PER_ROW, row_h) * 0.30
    for r in range(ROWS):
        cz = board_lo + row_h * (r + 0.5)
        made = []
        for c in range(PER_ROW):
            cx = num_lo + num_w * (c + 0.5) / PER_ROW
            made.append(lib.cylinder(
                f"num_{r}_{c}_ring", (cx, board_y - 0.026, cz), disc_r * 1.34, 0.006,
                pal.BEZEL, rotation=(math.radians(90), 0, 0), verts=8, flat=True))
            made.append(lib.cylinder(
                f"num_{r}_{c}", (cx, board_y - 0.034, cz), disc_r, 0.006,
                pal.YELLOW, rotation=(math.radians(90), 0, 0), verts=8, flat=True))
        lib.mark_light_box("light", f"row-{r}", made)
