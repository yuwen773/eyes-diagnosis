#!/usr/bin/env python
"""Re-grade the landing ScrollExpand artwork from its original masters.

This is the exact processing used for `scroll-expand-{dark,light}.webp`
(Iris ScrollExpand · Blue Optical Glass v2, 2026-11-16). Geometry is untouched;
only hue/saturation/value and shadow/highlight tints are shifted so the artwork
sits in the Iris 2.0 Blue Optical Glass palette (cobalt / ice cyan / local
aurora violet) instead of the old copper-gold grade.

The script ships as provenance, not as a build step: the WebP files in
`web/public/` are the deliverable. To regenerate, pass the original masters:

    python color_grade.py \\
        --dark-source /path/to/Scroll-Expand-dark.png \\
        --light-source /path/to/scroll-expand-light.png \\
        --out-dir ./out

Reproducing the shipped artifacts from the same masters was verified at
max per-pixel delta 1/255 (PNG encoder rounding).

Requires: Pillow, numpy, opencv-python.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


def smoothstep(a: float, b: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def grade(src: Path, dark: bool) -> Image.Image:
    rgb = np.asarray(Image.open(src).convert("RGB"), dtype=np.float32)
    h, w = rgb.shape[:2]
    orig = np.clip(rgb, 0, 255).astype(np.uint8)
    hsv = cv2.cvtColor(orig, cv2.COLOR_RGB2HSV).astype(np.float32)
    hue, sat, val = [hsv[:, :, i] for i in range(3)]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    xx /= w
    yy /= h
    s = sat / 255.0
    v = val / 255.0

    # Old copper/orange highlights -> cool optic-fiber / aurora accents.
    warm = smoothstep(0.03, 0.26, s) * (1 - smoothstep(26, 47, hue))
    teal = smoothstep(0.06, 0.28, s) * smoothstep(38, 65, hue) * (1 - smoothstep(99, 118, hue))
    # Aurora violet stays local to the outer-right iris rim, never the whole frame.
    violet_zone = smoothstep(0.73, 0.98, xx) * smoothstep(0.12, 0.45, s)

    target_warm = 97 + 30 * violet_zone + 5 * smoothstep(0.3, 0.86, v)
    hue2 = np.where(warm > 0.06, hue * (1 - warm) + target_warm * warm, hue)
    target_teal = 91 + 9 * smoothstep(0.63, 0.92, xx)
    hue2 = np.where(teal > 0.04, hue2 * (1 - teal * 0.55) + target_teal * teal * 0.55, hue2)

    sat2 = sat * (1 - 0.20 * teal - 0.35 * warm)
    # Silver-white speculars instead of gold ones.
    sat2 *= 1 - 0.35 * smoothstep(0.82, 0.99, v) * warm
    sat2 += 25 * warm * violet_zone * (1 - smoothstep(0.8, 1, v))

    if dark:
        sat2 = np.clip(sat2 * 1.08, 0, 250)
        # Deepen mid-shadows, keep optical highlights.
        val2 = np.clip(val * (0.91 + 0.16 * smoothstep(0.22, 0.82, v)), 0, 255)
    else:
        sat2 = np.clip(sat2 * 0.92, 0, 240)
        val2 = np.clip(val * (0.99 + 0.035 * (1 - smoothstep(0.45, 0.90, v))), 0, 255)

    hh = np.stack([np.mod(hue2, 180), np.clip(sat2, 0, 255), val2], axis=2).astype(np.uint8)
    graded = cv2.cvtColor(hh, cv2.COLOR_HSV2RGB).astype(np.float32)

    lum = cv2.cvtColor(orig, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255
    if dark:
        # Midnight-blue shadows instead of warm brown/black.
        shadows = 1 - smoothstep(0.075, 0.5, lum)
        graded += np.stack([shadows * 0.5, shadows * 4.5, shadows * 13.0], axis=2)
        # Icy cyan lift on high-frequency iris features; geometry untouched.
        highlights = smoothstep(0.22, 0.82, lum) * smoothstep(0.35, 0.75, xx) * warm
        graded += np.stack([highlights * (-4), highlights * 3, highlights * 9], axis=2)
    else:
        # Cream-to-glacier cool grade, not a flat recolour.
        pale = smoothstep(0.58, 0.95, lum)
        graded += np.stack([-4 * pale, 2 * pale, 12 * pale], axis=2)
        shadows = 1 - smoothstep(0.09, 0.38, lum)
        graded += np.stack([-1.5 * shadows, 1 * shadows, 7 * shadows], axis=2)

    graded = np.clip(graded, 0, 255).astype(np.uint8)
    return Image.fromarray(graded, "RGB")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dark-source", required=True, type=Path)
    parser.add_argument("--light-source", required=True, type=Path)
    parser.add_argument("--out-dir", required=True, type=Path)
    parser.add_argument("--webp-quality", type=int, default=86)
    args = parser.parse_args()

    args.out_dir.mkdir(parents=True, exist_ok=True)
    for name, src, dark in (
        ("dark", args.dark_source, True),
        ("light", args.light_source, False),
    ):
        out = grade(src, dark)
        out.save(args.out_dir / f"scroll-expand-{name}.png", optimize=True)
        out.save(
            args.out_dir / f"scroll-expand-{name}.webp",
            format="WEBP",
            quality=args.webp_quality,
            method=6,
        )
        print(name, out.size, "written")


if __name__ == "__main__":
    main()
