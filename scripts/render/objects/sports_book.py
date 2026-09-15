"""Sports Book -- 3x2 footprint, final display 275x250 px, 1.1x wider than tall.

Brief: a dark wood betting counter with three brass-grilled teller windows, and behind it
a wall unit carrying six flat screens in two rows of three, each showing a simple blocky
green pitch or track. Beneath the screens runs a long dark odds board printed with rows of
white and yellow names and numbers. Racing forms and pens on the counter.

Animated regions: the screen wall (six screens, croppable as two rows) and the odds board
in three bands. Rule C governs both -- flat rectangles, hard bezels, nothing overlapping,
drawn fully ON.
"""

import lib
import palette as pal

# 3x2. Screen width = (a+b)*0.7071; a 2.85 x 1.9 mass with H ~= 1.59 lands 1.1:1. Tall,
# because most of the object is a wall of screens rather than furniture.
A = 2.85
B = 1.9
H = 1.59

WALL_Y = B * 0.30
# The wall carcass spans WALL_Y-0.01 .. WALL_Y+0.09, so everything mounted on it has to
# sit in FRONT of that front face or it renders buried inside the cabinet.
FACE_Y = WALL_Y - 0.075
COUNTER_H = 0.52


def build() -> None:
    # --- betting counter along the front (-Y).
    cy = -B * 0.22
    lib.box("counter", (0, cy, COUNTER_H / 2), (A * 0.86, B * 0.26, COUNTER_H), pal.WOOD_DARK)
    lib.box("counter_top", (0, cy, COUNTER_H + 0.02), (A * 0.90, B * 0.30, 0.04), pal.WOOD)
    lib.box("kick", (0, cy, 0.04), (A * 0.84, B * 0.28, 0.08), pal.BLACK)

    # Three brass-grilled teller windows. The grille is a run of thin bars — enough to
    # read as a grille at final size without becoming noise.
    for w in range(3):
        wx = -A * 0.28 + w * A * 0.28
        lib.box(f"window_{w}", (wx, cy - B * 0.14, COUNTER_H + 0.30),
                (A * 0.20, 0.03, 0.26), pal.BEZEL, flat=True)
        lib.box(f"window_{w}_frame", (wx, cy - B * 0.13, COUNTER_H + 0.30),
                (A * 0.22, 0.02, 0.29), pal.BRASS)
        for bar in range(5):
            lib.box(
                f"grille_{w}_{bar}",
                (wx - A * 0.07 + bar * A * 0.035, cy - B * 0.15, COUNTER_H + 0.30),
                (0.014, 0.012, 0.23),
                pal.BRASS,
                flat=True,
            )

    # Racing forms and pens on the counter.
    lib.box("forms", (-A * 0.34, cy - B * 0.04, COUNTER_H + 0.05), (0.22, 0.15, 0.014), pal.WHITE)
    lib.cylinder("pen_cup", (-A * 0.22, cy - B * 0.02, COUNTER_H + 0.09), 0.045, 0.09, pal.RED, verts=12)

    # --- wall unit behind the counter.
    wall_lo = COUNTER_H + 0.10
    lib.box("wall", (0, WALL_Y + 0.04, (wall_lo + H) / 2), (A * 0.94, 0.10, H - wall_lo), pal.CABINET_DARK)

    # Six screens, two rows of three. Identical, evenly spaced, level, each a flat
    # rectangle with a hard bezel and a clear band of housing between them so each row
    # crops separately.
    scr_w, scr_h = A * 0.26, 0.30
    for row in range(2):
        sz = H - 0.30 - row * 0.42
        made = []
        for col in range(3):
            sx = -A * 0.30 + col * A * 0.30
            face, bezel = lib.panel(
                f"screen_{row}_{col}",
                (sx, FACE_Y, sz),
                (scr_w, scr_h),
                pal.SCREEN_GREEN,
                pal.BEZEL,
            )
            made += [face, bezel]
            # A blocky pitch: a darker centre stripe and two end zones. Readable as sport
            # at 275px wide, which is all it has to do.
            made.append(lib.box(f"pitch_{row}_{col}", (sx, FACE_Y - 0.012, sz),
                                (scr_w * 0.86, 0.006, scr_h * 0.12), pal.WHITE, flat=True))
        lib.mark_light_box("light", f"screens-{row}", made)

    # --- odds board beneath the screens, three bands of printed rows.
    odds_lo = wall_lo + 0.06
    odds_hi = H - 0.84
    board_w = A * 0.86
    lib.box("odds_ground", (0, FACE_Y - 0.006, (odds_lo + odds_hi) / 2),
            (board_w, 0.012, odds_hi - odds_lo), pal.BLACK, flat=True)
    band_h = (odds_hi - odds_lo) / 3
    for band in range(3):
        cz = odds_lo + band_h * (band + 0.5)
        made = []
        for c in range(6):
            cx = -board_w / 2 + board_w * (c + 0.5) / 6
            made.append(lib.box(
                f"odds_{band}_{c}", (cx, FACE_Y - 0.016, cz),
                (board_w * 0.11, 0.006, band_h * 0.34),
                pal.YELLOW if c % 2 else pal.WHITE, flat=True))
        lib.mark_light_box("light", f"odds-{band}", made)
        if band < 2:
            lib.box(f"odds_div_{band}", (0, FACE_Y - 0.014, cz + band_h / 2),
                    (board_w, 0.006, 0.012), pal.BEZEL, flat=True)
