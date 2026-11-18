"""Deterministic geometry-only image for browser authorization/aspect tests; no patient input."""
from pathlib import Path
from PIL import Image, ImageDraw

image = Image.new("RGB", (640, 640), (18, 20, 22))
draw = ImageDraw.Draw(image)
for radius in range(244, 0, -1):
    value = int(85 + 65 * (1 - radius / 244))
    draw.ellipse((320 - radius, 300 - radius, 320 + radius, 300 + radius), fill=(value, int(value * .48), int(value * .28)))
for points in [((420, 270), (350, 220), (240, 140)), ((420, 270), (340, 345), (195, 405)), ((420, 270), (470, 390), (445, 480))]:
    draw.line(points, fill=(60, 35, 30), width=7)
draw.ellipse((390, 242, 450, 302), fill=(180, 135, 85))
draw.text((180, 580), "SYNTHETIC / NOT CLINICAL", fill=(220, 220, 220))
image.save(Path(__file__).with_name("collaboration-synthetic.png"))
