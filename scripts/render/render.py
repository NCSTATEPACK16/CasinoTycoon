"""Entry point. Run headless:

    blender --background --python scripts/render/render.py -- --object penny-slots \
        --out assets/penny-slots.png --boxes assets/penny-slots.boxes.json --res 1024

Normally driven by `npm run render-sprites`, which finds Blender and runs the pixel
post-pass afterwards.
"""

import argparse
import importlib
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import lib  # noqa: E402

BUILDERS = {
    "penny-slots": "objects.penny_slots",
    "pachinko": "objects.pachinko",
    "keno-lounge": "objects.keno_lounge",
    "video-poker": "objects.video_poker",
}


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--object", required=True, choices=sorted(BUILDERS))
    ap.add_argument("--out", required=True)
    ap.add_argument("--boxes", required=True)
    ap.add_argument("--res", type=int, default=1024)
    args = ap.parse_args(argv)

    lib.reset_scene()
    _, margin = lib.setup()
    importlib.import_module(BUILDERS[args.object]).build()
    lib.render(args.out, args.boxes, args.res, margin)


main()
