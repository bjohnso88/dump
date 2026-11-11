# Generates the app icons. Run once: python3 make_icons.py
from PIL import Image, ImageDraw
for size, name in [(180, "apple-touch-icon.png"), (192, "icon-192.png"), (512, "icon-512.png")]:
    img = Image.new("RGB", (size, size), "#1f2a2e")
    d = ImageDraw.Draw(img)
    r = size * 0.28
    c = size / 2
    d.ellipse([c - r, c - r, c + r, c + r], fill="#8fbcb0")
    img.quantize(colors=4).save(name, optimize=True)  # tiny file, same look
