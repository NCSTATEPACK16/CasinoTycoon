"""Pachinko Machine -- 1x1 footprint, final display 78x140 px, 1.8x taller than wide.

Brief: "a tall narrow upright cabinet with a large vertical glass playfield facing the
viewer, covered in a regular grid of small metal pins with a scattering of silver balls
resting among them, painted in bright red, blue and yellow decorative panels behind the
pins. A small square digital score panel at the top showing three numerals, a chrome ball
tray across the bottom, and a round chrome launch knob at the lower right."

Animated regions: the three horizontal playfield bands (each its own backing colour, so
they can light in sequence) and the digital score panel.
"""

import math

import lib
import palette as pal

# Narrow and tall. Screen height = (a+b)*0.3536 + H*sin60, screen width = (a+b)*0.7071,
# so with a square 0.44 footprint H ~= 0.94 lands the silhouette on 1.8.
S = 0.44
H = 0.94

W = S * 0.94
D = S * 0.86
FRONT = -D / 2 - 0.008

# Three bands of equal height with a visible dark divider between them -- rule A's
# requirement for a sequence: even, parallel, equal, gapped. Uneven scattering cannot be
# sequenced.
BAND_COLOURS = (pal.RED, pal.BLUE, pal.YELLOW)


def build() -> None:
    lib.box("base", (0, 0, 0.075), (S, S, 0.15), pal.CABINET_DARK)
    lib.box("body", (0, 0, 0.15 + (H - 0.15) / 2), (W, D, H - 0.15), pal.CABINET)

    # Ball tray along the bottom, and the chrome lip over it.
    lib.box("tray", (0, FRONT - 0.028, 0.195), (W * 0.72, 0.065, 0.07), pal.CABINET_DARK)
    lib.box("tray_lip", (0, FRONT - 0.042, 0.232), (W * 0.76, 0.038, 0.016), pal.CHROME)

    # --- playfield: three horizontal bands, straight, level, full playfield width.
    field_lo, field_hi = 0.28, H - 0.20
    field_w = W * 0.84
    band_h = (field_hi - field_lo) / 3.0
    gap = band_h * 0.13

    lib.box(
        "field_bezel",
        (0, FRONT + 0.004, (field_lo + field_hi) / 2),
        (field_w + 0.028, 0.008, (field_hi - field_lo) + 0.028),
        pal.BEZEL,
        flat=True,
    )

    for b in range(3):
        lo = field_lo + b * band_h + gap / 2
        hi = field_lo + (b + 1) * band_h - gap / 2
        cz = (lo + hi) / 2
        band = lib.box(
            f"band_{b}",
            (0, FRONT - 0.006, cz),
            (field_w, 0.006, hi - lo),
            BAND_COLOURS[b],
            flat=True,
        )
        # Pins: a regular grid of small chrome studs over the backing panel. Drawn on the
        # band so the crop that brightens the band brightens its pins with it.
        pins = []
        rows = 3
        for r in range(rows):
            pz = lo + (hi - lo) * (r + 0.5) / rows
            for c in range(5):
                px = -field_w / 2 + field_w * (c + 0.5) / 5 + (0.012 if r % 2 else -0.012)
                pins.append(
                    lib.cylinder(
                        f"pin_{b}_{r}_{c}",
                        (px, FRONT - 0.014, pz),
                        0.008,
                        0.005,
                        pal.CHROME,
                        rotation=(math.radians(90), 0, 0),
                        verts=8,
                        flat=True,
                    )
                )
        # A few silver balls resting among the pins.
        for i in range(2):
            pins.append(
                lib.cylinder(
                    f"ball_{b}_{i}",
                    (-field_w / 4 + i * field_w / 2, FRONT - 0.016, lo + (hi - lo) * 0.25),
                    0.013,
                    0.005,
                    pal.CHROME,
                    rotation=(math.radians(90), 0, 0),
                    verts=10,
                    flat=True,
                )
            )
        lib.mark_light_box("light", f"band-{b}", [band] + pins)

    # --- digital score panel: a flat rectangle with a hard dark bezel, nothing overlapping.
    score_z = H - 0.085
    score = lib.panel("score", (0, FRONT, score_z), (W * 0.46, 0.085), pal.BEZEL, pal.CABINET_DARK)
    for i in range(3):
        lib.box(
            f"digit_{i}",
            (-W * 0.13 + i * W * 0.13, FRONT - 0.012, score_z),
            (0.026, 0.006, 0.048),
            pal.DIGIT,
            flat=True,
        )
    lib.mark_light_box("light", "score", list(score))

    # --- round chrome launch knob at the lower right, clear of every band crop.
    lib.cylinder(
        "knob",
        (W * 0.32, FRONT - 0.022, 0.345),
        0.038,
        0.03,
        pal.CHROME,
        rotation=(math.radians(90), 0, 0),
        verts=16,
    )
    lib.cylinder(
        "knob_hub",
        (W * 0.32, FRONT - 0.040, 0.345),
        0.014,
        0.01,
        pal.CHROME_DARK,
        rotation=(math.radians(90), 0, 0),
        verts=12,
        flat=True,
    )
