"""Penny Slots -- 1x1 footprint, final display 72x120 px, 1.7x taller than wide.

Brief: "a short, stubby, budget slot cabinet, visibly cheaper and smaller than a full-size
machine. Scuffed cream and faded orange plastic housing, a chrome pull handle on the right
side, a coin tray at the bottom, a three-reel window in the middle showing cherry and bar
symbols, a rectangular illuminated sign panel across the very top reading 1c, and a
straight vertical strip of round bulbs down each side."

Animated regions: the top marquee band, the two vertical side bulb strips (three groups
each, so they pulse out of phase like the shipped slot machine's three banks), and the
reel window.
"""

import math

import lib
import palette as pal

# Footprint side and cabinet height, solved for the brief's 1.7:1 proportion. With the
# fixed camera, screen width = S*sqrt(2)*k and screen height = (S*sqrt(2)/2 + H*sin60)*k,
# so H ~= 1.96*S puts the silhouette on 1.7. Confirmed by measuring the render.
S = 0.52
H = 1.04

W = S * 0.92  # body width
D = S * 0.90  # body depth
FRONT = -D / 2 - 0.008  # the near (-Y) face, where every light-bearing part is mounted


def build() -> None:
    # Housing: stubby and bottom-heavy -- a wider dark plinth under a narrower cream body
    # is what reads as "cheaper and smaller" beside the full-size slot machine.
    lib.box("base", (0, 0, 0.10), (S, S, 0.20), pal.CABINET_DARK)
    lib.box("body", (0, 0, 0.20 + (H - 0.20) / 2), (W, D, H - 0.20), pal.CREAM)

    # Faded orange belly band -- the cheap-plastic tell, and it breaks up a tall flat face.
    lib.box("belly", (0, 0, 0.31), (W + 0.012, D + 0.012, 0.15), pal.ORANGE)

    # Coin tray, and the chrome lip over it.
    lib.box("tray", (0, FRONT - 0.03, 0.235), (W * 0.62, 0.07, 0.075), pal.CABINET_DARK)
    lib.box("tray_lip", (0, FRONT - 0.045, 0.275), (W * 0.66, 0.04, 0.018), pal.CHROME)

    # --- top sign panel reading "1c": one flat horizontal rectangle spanning the full
    # width, hard dark border, drawn fully ON. This is the marquee crop.
    sign_z = H - 0.075
    sign = lib.panel("sign", (0, FRONT, sign_z), (W * 0.90, 0.125), pal.BULB, pal.BEZEL)
    lib.box("sign_one", (-0.035, FRONT - 0.012, sign_z), (0.022, 0.006, 0.065), pal.RED, flat=True)
    lib.box("sign_c", (0.030, FRONT - 0.012, sign_z), (0.050, 0.006, 0.050), pal.RED, flat=True)
    lib.mark_light_box("light", "marquee", list(sign))

    # --- reel window: a plain flat rectangle with a hard bezel and nothing overlapping it.
    reel_z = H * 0.60
    reel_w, reel_h = W * 0.74, 0.24
    reel = lib.panel("reel", (0, FRONT, reel_z), (reel_w, reel_h), pal.BEZEL, pal.CABINET_DARK)
    for i, (col, x) in enumerate(
        ((pal.RED, -reel_w / 3.1), (pal.YELLOW, 0.0), (pal.RED, reel_w / 3.1))
    ):
        lib.box(f"symbol_{i}", (x, FRONT - 0.012, reel_z), (reel_w * 0.20, 0.006, 0.085), col, flat=True)
    lib.mark_light_box("light", "reel", list(reel))

    # --- two vertical bulb strips, one down each side of the cabinet face.
    # Rule A: perfectly vertical, equal width, split into evenly spaced groups with a
    # visible dark gap between them, so each group is its own crop and its own tween phase.
    strip_x = W * 0.40
    groups, per_group = 3, 3
    span_lo, span_hi = 0.41, H - 0.155
    group_h = (span_hi - span_lo) / groups
    for side, x in (("l", -strip_x), ("r", strip_x)):
        for g in range(groups):
            lo = span_lo + g * group_h + group_h * 0.24
            hi = span_lo + (g + 1) * group_h - group_h * 0.24
            made = lib.bulb_strip(
                f"bulbs_{side}{g}",
                (x, FRONT - 0.004, lo),
                (x, FRONT - 0.004, hi),
                per_group,
                0.028,
                pal.BULB,
                pal.BEZEL,
            )
            lib.mark_light_box("light", f"bulbs-{side}{g}", made)

    # --- chrome pull handle on the right (+X) flank, well clear of every light box so no
    # crop can catch it.
    lib.cylinder(
        "handle_arm", (W / 2 + 0.055, 0, H * 0.52), 0.014, 0.12, pal.CHROME,
        rotation=(0, math.radians(90), 0),
    )
    lib.sphere("handle_knob", (W / 2 + 0.118, 0, H * 0.52), 0.030, pal.RED)
