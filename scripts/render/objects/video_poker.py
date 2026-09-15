"""Video Poker Bank -- 1x2 footprint, final display 170x180 px, roughly square.

Brief: "three identical upright video poker cabinets bolted side by side into one unit,
sharing a single continuous base and a single continuous sign header across the top reading
JACKS OR BETTER in chunky white letters on dark blue. Each cabinet has a rectangular screen
showing five playing cards face up in a row, and below each screen a row of five square
coloured buttons. Brushed steel and dark blue plastic housing, a coin tray along the bottom."

Animated regions: three screens, three button rows, and the header sign -- seven crops.
Rule C governs the screens: identical in size, evenly spaced, level, each a flat rectangle
with a hard dark bezel and nothing overlapping it, with a clear band of plain housing
between them at least a card wide so each crops separately.
"""

import lib
import palette as pal

# Screen width = (a+b)*0.7071, height = (a+b)*0.3536 + H*sin60. A 1.7 x 0.75 mass with
# H ~= 1.12 lands the 170x180 proportion.
A = 1.70   # the run of three cabinets, along X
B = 0.75   # depth, along Y
H = 1.12

FRONT = -B / 2 - 0.008
BAYS = 3
BAY_W = A / BAYS

# Five square buttons per row: yellow, red, yellow, red, yellow.
BUTTON_COLOURS = (pal.YELLOW, pal.RED, pal.YELLOW, pal.RED, pal.YELLOW)


def build() -> None:
    # One continuous base and one continuous housing -- the brief's "bolted side by side
    # into one unit", not three machines standing near each other.
    lib.box("base", (0, 0, 0.10), (A + 0.05, B + 0.05, 0.20), pal.CABINET_DARK)
    lib.box("body", (0, 0, 0.20 + (H - 0.20) / 2), (A, B, H - 0.20), pal.FELT_BLUE)
    lib.box("steel_band", (0, 0, 0.30), (A + 0.02, B + 0.02, 0.075), pal.CHROME_DARK)

    # Coin tray along the whole bottom.
    lib.box("tray", (0, FRONT - 0.03, 0.255), (A * 0.92, 0.07, 0.062), pal.CABINET_DARK)
    lib.box("tray_lip", (0, FRONT - 0.045, 0.292), (A * 0.94, 0.04, 0.016), pal.CHROME)

    # --- one continuous header sign spanning the full width, hard dark border, fully ON.
    head_z = H - 0.085
    header = lib.panel("header", (0, FRONT, head_z), (A * 0.94, 0.115), pal.FELT_BLUE_DARK, pal.BEZEL)
    # "JACKS OR BETTER" as chunky high-contrast blocks. The brief is explicit that every
    # word downscales to near-illegibility, so the lettering is texture, not information --
    # the silhouette and colour say what the object is.
    for i in range(9):
        lib.box(
            f"head_letter_{i}",
            (-A * 0.40 + i * A * 0.10, FRONT - 0.012, head_z),
            (0.042, 0.006, 0.055),
            pal.WHITE,
            flat=True,
        )
    lib.mark_light_box("light", "header", list(header))

    screen_z = H * 0.60
    button_z = H * 0.415
    screen_w, screen_h = BAY_W * 0.66, 0.21

    for bay in range(BAYS):
        cx = -A / 2 + BAY_W * (bay + 0.5)

        # --- screen: flat rectangle, hard dark bezel, nothing overlapping it. The gap to
        # the next bay is BAY_W*0.34, comfortably wider than one card, so the crops are
        # separable.
        screen = lib.panel(
            f"screen_{bay}",
            (cx, FRONT, screen_z),
            (screen_w, screen_h),
            pal.FELT_DARK,
            pal.BEZEL,
        )
        # Five cards in one straight horizontal row, evenly spaced, equal size, none
        # overlapping. Rule D's proportions are about printed felt on tables, but the same
        # instinct applies: keep them chunky enough to survive the downscale.
        cards = []
        for c in range(5):
            cards.append(
                lib.box(
                    f"card_{bay}_{c}",
                    (cx - screen_w * 0.40 + c * screen_w * 0.20, FRONT - 0.012, screen_z),
                    (screen_w * 0.145, 0.006, screen_h * 0.60),
                    pal.WHITE,
                    flat=True,
                )
            )
            cards.append(
                lib.box(
                    f"pip_{bay}_{c}",
                    (cx - screen_w * 0.40 + c * screen_w * 0.20, FRONT - 0.018, screen_z - screen_h * 0.09),
                    (screen_w * 0.055, 0.006, screen_h * 0.14),
                    pal.RED if c % 2 else pal.BLACK,
                    flat=True,
                )
            )
        lib.mark_light_box("light", f"screen-{bay}", list(screen) + cards)

        # --- button row: a straight horizontal strip of equal square buttons with a dark
        # gap above and below, so it crops without catching the screen or the tray.
        strip = lib.box(
            f"buttons_{bay}",
            (cx, FRONT - 0.004, button_z),
            (screen_w, 0.008, 0.062),
            pal.BEZEL,
            flat=True,
        )
        keys = [strip]
        for c, col in enumerate(BUTTON_COLOURS):
            keys.append(
                lib.box(
                    f"button_{bay}_{c}",
                    (cx - screen_w * 0.34 + c * screen_w * 0.17, FRONT - 0.014, button_z),
                    (screen_w * 0.115, 0.008, 0.040),
                    col,
                    flat=True,
                )
            )
        lib.mark_light_box("light", f"buttons-{bay}", keys)

        # A brushed-steel divider between bays, so three cabinets read as three.
        if bay < BAYS - 1:
            lib.box(
                f"divider_{bay}",
                (-A / 2 + BAY_W * (bay + 1), FRONT + 0.004, (0.30 + head_z) / 2),
                (0.022, 0.012, head_z - 0.30),
                pal.CHROME_DARK,
            )
