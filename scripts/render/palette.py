"""The casino floor's colours, sampled from the sprites already shipped.

These are not invented and they are deliberately not taken from a reference image. The
authoritative palette is in the repo: public/sprites/roulette-table.png and its siblings
hold the exact wood browns, felt greens and brass golds the floor is built from, so
sampling those is what guarantees new objects read as the same business. The values below
are the brightest lit surface of each family in those files, which is the right anchor
because the rig's SHADE_TOP factor is 1.0 -- a top face renders at exactly the base colour.

Sampled 2026-09-13 from roulette-table, blackjack-table, slot-machine, poker-table,
high-limit-table and food-stall. Checked in as literals so a render never depends on
reading public/sprites.
"""


def _linear(srgb8: tuple[int, int, int]) -> tuple[float, float, float]:
    """sRGB 0-255 -> linear 0-1.

    Blender's Emission colour input is linear and the render is encoded back to sRGB on
    write. Feeding it sRGB values directly is the classic way to get output that is
    visibly washed out, which on flat unlit art shows up immediately.
    """
    out = []
    for v in srgb8:
        c = v / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (out[0], out[1], out[2])


# --- structure -------------------------------------------------------------------------
WOOD = _linear((112, 40, 0))  # roulette/blackjack cabinet mahogany
WOOD_DARK = _linear((72, 24, 0))
BRASS = _linear((208, 160, 56))  # roulette rail, high-limit trim
BRASS_DARK = _linear((144, 96, 48))
CHROME = _linear((176, 184, 184))
CHROME_DARK = _linear((96, 104, 104))

# --- surfaces --------------------------------------------------------------------------
FELT = _linear((24, 104, 56))  # blackjack felt
FELT_DARK = _linear((8, 72, 40))
FELT_BLUE = _linear((28, 68, 112))
FELT_BLUE_DARK = _linear((12, 30, 56))

# --- cabinet plastics ------------------------------------------------------------------
CABINET = _linear((56, 56, 56))  # slot-machine body grey
CABINET_DARK = _linear((28, 28, 28))
CREAM = _linear((216, 200, 160))  # penny-slots budget housing
ORANGE = _linear((200, 104, 32))
RED = _linear((176, 40, 32))
BLUE = _linear((48, 88, 168))
YELLOW = _linear((216, 176, 48))
PURPLE = _linear((96, 32, 120))  # high-limit plum

# --- lights and screens ----------------------------------------------------------------
# Drawn fully ON at full brightness, per the brief's animation contract: the build derives
# the OFF state by multiplying the base down to ~34%, so art that arrives pre-dimmed gives
# a dim overlay over a very dim base and the blink disappears.
BULB = _linear((255, 236, 168))
BULB_RED = _linear((255, 96, 72))
SCREEN = _linear((72, 224, 232))
SCREEN_GREEN = _linear((104, 240, 128))
SCREEN_AMBER = _linear((255, 184, 48))
DIGIT = _linear((255, 72, 56))

# --- bezels and shadow -----------------------------------------------------------------
# Every light box crops against one of these, so the crop edge lands on dark pixels.
BEZEL = _linear((16, 14, 14))
BLACK = _linear((8, 8, 8))
WHITE = _linear((240, 240, 240))
