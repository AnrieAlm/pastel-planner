# icons.py - gives the app its icons.
# 1. If the folder app_icons/ has a ready-made picture with the right name (icon-192.png and so on),
#    that picture is used. This is how your own artwork gets in.
# 2. If not, the icon is drawn here with Python (Pillow): a simple "calyx" flower, so the app
#    always has icons.
# Each icon is prepared once, the first time it is asked for, then kept in memory.

import io
import math
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw

ICON_FOLDER = Path("app_icons")     # your own ready-made icons go here
SAGE = (93, 118, 84)                # #5D7654  (Cottagecore primary)
CREAM = (253, 251, 247)             # #FDFBF7  (Cottagecore background)
DRAW_SIZE = 1024                    # the flower is drawn big, then shrunk, so the edges are smooth

# name -> (pixel size, style)
#   "rounded":  rounded square with see-through corners (normal icons and the browser tab)
#   "maskable": full square, mark kept small in the middle (Android crops it into a circle or squircle)
#   "full":     full square (iPhone rounds the corners itself)
ICONS = {
    "icon-192.png": (192, "rounded"),
    "icon-512.png": (512, "rounded"),
    "icon-maskable-512.png": (512, "maskable"),
    "apple-touch-icon.png": (180, "full"),
    "favicon-32.png": (32, "rounded"),
}


# One pointed leaf (sepal), pointing outwards at a given angle from the centre
def leafPoints(cx, cy, angle, length, width):
    steps = 28
    side = []
    for i in range(steps + 1):
        t = i / steps
        side.append((length * t, width * math.sin(math.pi * t) ** 0.85))
    points = [(d, s) for d, s in side] + [(d, -s) for d, s in reversed(side)]
    return [(cx + d * math.cos(angle) - s * math.sin(angle), cy + d * math.sin(angle) + s * math.cos(angle))
            for d, s in points]


# The simple flower icon, used only when there is no ready-made picture
def drawFlower(pixels, style):
    image = Image.new("RGBA", (DRAW_SIZE, DRAW_SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    if style == "rounded":
        draw.rounded_rectangle([0, 0, DRAW_SIZE - 1, DRAW_SIZE - 1], radius=int(DRAW_SIZE * 0.22), fill=SAGE)
    else:
        draw.rectangle([0, 0, DRAW_SIZE, DRAW_SIZE], fill=SAGE)
    scale = 0.50 if style == "maskable" else 0.66
    length = DRAW_SIZE * scale / 2
    for i in range(5):
        angle = -math.pi / 2 + i * (2 * math.pi / 5)
        draw.polygon(leafPoints(DRAW_SIZE / 2, DRAW_SIZE / 2, angle, length, length * 0.30), fill=CREAM)
    dot = length * 0.17
    draw.ellipse([DRAW_SIZE / 2 - dot, DRAW_SIZE / 2 - dot, DRAW_SIZE / 2 + dot, DRAW_SIZE / 2 + dot], fill=SAGE)

    image = image.resize((pixels, pixels), Image.LANCZOS)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


# Returns one icon as PNG bytes (None if the name is not an icon we have):
# your picture from app_icons/ if it is there, otherwise the drawn flower
@lru_cache(maxsize=None)
def makeIcon(name):
    if name not in ICONS:
        return None

    ready = ICON_FOLDER / name
    if ready.is_file():
        return ready.read_bytes()

    pixels, style = ICONS[name]
    return drawFlower(pixels, style)
