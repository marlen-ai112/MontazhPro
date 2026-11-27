#!/usr/bin/env python3
"""Обложка 1080x1920 из кадра готового ролика.
python3 edit/make_cover.py output/reels_final.mp4 output/cover.png [--t 44]
Текст держим в безопасной зоне (центральный кроп 3:4 в сетке профиля: y 240..1680).
"""
import argparse, subprocess, io
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance

ap = argparse.ArgumentParser()
ap.add_argument("video"); ap.add_argument("dst"); ap.add_argument("--t", type=float, default=44)
ap.add_argument("--scale", type=float, default=1.06); ap.add_argument("--dy", type=int, default=110)
ap.add_argument("--top", default="ХОТЕЛИ ПРОДАТЬ ЗА 250 000 ₸", help="плашка сверху")
ap.add_argument("--strike", type=int, default=1, help="зачеркнуть текст верхней плашки")
ap.add_argument("--h1", default="ИИ-ОФИС"); ap.add_argument("--h2", default="ЗА НЕДЕЛЮ")
ap.add_argument("--pill", default="сам ищет тендеры")
ap.add_argument("--cta", default="ПОКАЖУ, КАК ЭТО РАБОТАЕТ  →")
a = ap.parse_args()
W, H = 1080, 1920
png = subprocess.run(["ffmpeg", "-v", "error", "-ss", str(a.t), "-i", a.video, "-frames:v", "1",
                      "-f", "image2pipe", "-vcodec", "png", "-"], capture_output=True, check=True).stdout
img = Image.open(io.BytesIO(png)).convert("RGB")
# чуть крупнее и выше: лицо уходит от текстового блока
S, DY = a.scale, a.dy
img = img.resize((int(W * S), int(H * S)), Image.LANCZOS)
ox = (img.width - W) // 2
img = img.crop((ox, DY, ox + W, DY + H))
img = ImageEnhance.Contrast(img).enhance(1.08)
img = ImageEnhance.Color(img).enhance(1.12)

F = "/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf"
PINK = (255, 31, 109)
def font(sz): return ImageFont.truetype(F, sz)
def fit(text, max_w, start):
    sz = start
    while font(sz).getlength(text) > max_w: sz -= 2
    return font(sz)

# затемнение низа: градиент, плавный от лица к тексту
grad = Image.new("L", (1, H))
for y in range(H):
    t = min(max((y - 1050) / 330, 0), 1)
    grad.putpixel((0, y), int(255 * t * t * (3 - 2 * t)))
grad = grad.resize((W, H))
img = Image.composite(Image.new("RGB", (W, H), (9, 9, 20)), img, grad)
# лёгкая виньетка сверху
vg = Image.new("L", (1, H))
for y in range(H):
    vg.putpixel((0, y), int(70 * max(0, 1 - y / 380) ** 2))
img = Image.composite(Image.new("RGB", (W, H), (0, 0, 0)), img, vg.resize((W, H)))

d = ImageDraw.Draw(img)
cx, left = W // 2, 60
def centered(text, y, f, fill):
    w = f.getlength(text); d.text((cx - w / 2, y), text, font=f, fill=fill); return w

# 1) зачёркнутая цена - плашка сверху (на спокойной стене)
txt = a.top
f1 = fit(txt, 800, 58)
w = f1.getlength(txt)
ov = Image.new("RGBA", (W, H), (0, 0, 0, 0)); od = ImageDraw.Draw(ov)
od.rounded_rectangle([cx - w / 2 - 36, 250, cx + w / 2 + 36, 250 + f1.size + 44], radius=30, fill=(9, 9, 20, 175))
img = Image.alpha_composite(img.convert("RGBA"), ov).convert("RGB"); d = ImageDraw.Draw(img)
centered(txt, 250 + 20, f1, (255, 255, 255))
yl = 250 + 20 + f1.size * 0.62
if a.strike: d.line([(cx - w / 2, yl), (cx + w / 2, yl)], fill=PINK, width=8)

# 2) главный заголовок
lines = [a.h1, a.h2]
fsz = min(fit(l, 940, 230).size for l in lines)   # одинаковый размер строк
f = font(fsz)
for i, line in enumerate(lines):
    block = fsz * (1.0 * (len(lines) - 1) + 1)
    y = int(1200 + max(0, (440 - block) / 2) + i * fsz * 1.0)
    # тень для читаемости
    d.text((cx - f.getlength(line) / 2 + 5, y + 6), line, font=f, fill=(0, 0, 0))
    centered(line, y, f, (255, 255, 255))

# 3) розовая плашка
t3 = a.pill
f3 = fit(t3, 900, 78); w3 = f3.getlength(t3)
px, py, ph = cx - w3 / 2 - 40, 1655, f3.size + 44
d.rounded_rectangle([px, py, px + w3 + 80, py + ph], radius=26, fill=PINK)
d.text((cx - w3 / 2, py + 12), t3, font=f3, fill=(255, 255, 255))

# 4) призыв внизу (вне безопасной зоны сетки, но видно в ленте)
f4 = font(46); t4 = a.cta
centered(t4, 1808, f4, (255, 255, 255))
img.save(a.dst)
img.convert("RGB").save(a.dst.rsplit(".", 1)[0] + ".jpg", quality=94)
print("ok", a.dst)
