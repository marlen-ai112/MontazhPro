"""2D cartoon engine: timeline tracks + skia vector drawing for 'The Box'."""
import math, bisect
import numpy as np
import skia

FPS, W, H = 24, 1280, 720
FONT_PATH = "/usr/share/fonts/opentype/comic-neue/ComicNeue-Bold.otf"
GROUND = 1180
_font_cache = {}


def font(size):
    if size not in _font_cache:
        _font_cache[size] = skia.Font(skia.Typeface.MakeFromFile(FONT_PATH), size)
    return _font_cache[size]


# ------------------------------------------------------------------ helpers
def col(c, a=1.0):
    r, g, b = c[:3]
    return skia.Color(int(max(0, min(255, r))), int(max(0, min(255, g))), int(max(0, min(255, b))),
                      int(max(0, min(1, a)) * 255))


def mixc(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def shade(c, f):
    return tuple(max(0, min(255, v * f)) for v in c)


def fill(c, a=1.0, shader=None, blend=None):
    p = skia.Paint(AntiAlias=True, Color=col(c, a))
    if shader is not None:
        p.setShader(shader)
    if blend is not None:
        p.setBlendMode(blend)
    return p


def stroke(c, w, a=1.0, cap=skia.Paint.kRound_Cap, blend=None):
    p = skia.Paint(AntiAlias=True, Color=col(c, a), Style=skia.Paint.kStroke_Style, StrokeWidth=w)
    p.setStrokeCap(cap)
    p.setStrokeJoin(skia.Paint.kRound_Join)
    if blend is not None:
        p.setBlendMode(blend)
    return p


def lingrad(p0, p1, c0, c1, a0=1.0, a1=1.0):
    return skia.GradientShader.MakeLinear([p0, p1], [col(c0, a0), col(c1, a1)])


def radgrad(cx, cy, r, c0, c1, a0=1.0, a1=0.0):
    return skia.GradientShader.MakeRadial((cx, cy), r, [col(c0, a0), col(c1, a1)])


def R(l, t, r, b):
    return skia.Rect.MakeLTRB(l, t, r, b)


def poly(pts):
    p = skia.Path()
    p.moveTo(*pts[0])
    for q in pts[1:]:
        p.lineTo(*q)
    p.close()
    return p


def ell(c, cx, cy, rx, ry, paint):
    c.drawOval(R(cx - rx, cy - ry, cx + rx, cy + ry), paint)


def rrect(c, l, t, r, b, rad, paint):
    c.drawRoundRect(R(l, t, r, b), rad, rad, paint)


# ------------------------------------------------------------------ timeline
def ease(name, u):
    u = max(0.0, min(1.0, u))
    if name == "lin":
        return u
    if name == "io":
        return u * u * (3 - 2 * u)
    if name == "out":
        return 1 - (1 - u) ** 3
    if name == "in":
        return u ** 3
    if name == "back":
        c = 1.70158
        return 1 + (c + 1) * (u - 1) ** 3 + c * (u - 1) ** 2
    return u


class Track:
    def __init__(self, v=0.0):
        self.k = [(-1e9, float(v), "lin")]
        self.ts = None

    def key(self, t, v, e="io"):
        self.k.append((t, float(v), e))
        self.ts = None

    def set(self, t, v):
        self.key(t, v, "step")

    def at(self, t):
        if self.ts is None:
            self.k.sort(key=lambda a: a[0])
            self.ts = [a[0] for a in self.k]
        i = bisect.bisect_right(self.ts, t)
        if i == 0:
            return self.k[0][1]
        if i == len(self.k):
            return self.k[-1][1]
        t0, v0, _ = self.k[i - 1]
        t1, v1, e = self.k[i]
        if e == "step" or t1 <= t0:
            return v0
        return v0 + (v1 - v0) * ease(e, (t - t0) / (t1 - t0))

    def anim(self, t0, t1, v1, e="io"):
        v0 = self.at(t0)
        self.key(t0, v0, "lin")
        self.key(t1, v1, e)


MOODS = {  # brow angle(px), brow lift(px), eye open, smile, mouth width, pupil scale
    "neutral": (0, 0, 1.0, 0.30, 1.0, 1.0),
    "happy": (-5, -7, 1.0, 0.95, 1.15, 1.0),
    "scared": (-24, -14, 1.25, -0.55, 0.9, 0.55),
    "sad": (-20, -3, 0.85, -0.7, 0.9, 1.0),
    "angry": (22, 3, 0.8, -0.5, 1.0, 1.0),
    "surprised": (-6, -18, 1.3, 0.0, 0.75, 0.65),
    "sly": (14, -2, 0.62, 0.8, 1.0, 1.0),
    "determined": (12, 0, 1.0, 0.15, 1.0, 1.0),
    "worried": (-15, -6, 1.05, -0.15, 0.9, 1.0),
    "smug": (8, -3, 0.72, 0.6, 1.0, 1.0),
    "cheeky": (-8, -8, 1.0, 1.0, 1.25, 1.0),
}
ACTOR_DEFAULTS = dict(x=0, y=GROUND, s=1.0, rot=0, vis=1, dy=0, sqx=1, sqy=1, lx=1e6, ly=1e6,
                      talk=0, freeze=0, a=0, b=0, over=0)


class Actor:
    def __init__(self, name, kind, x, y=GROUND, s=1.0, mood="neutral"):
        self.name, self.kind = name, kind
        self.tr = {k: Track(v) for k, v in ACTOR_DEFAULTS.items()}
        self.tr["x"].key(0, x, "lin")
        self.tr["y"].key(0, y, "lin")
        self.tr["s"].key(0, s, "lin")
        self.moods = [(-1e9, "neutral"), (0.0, mood)]
        self.seed = (sum(ord(ch) for ch in name) * 37) % 100 / 100.0

    def state(self, t):
        st = {k: tr.at(t) for k, tr in self.tr.items()}
        ts = [m[0] for m in self.moods]
        i = max(0, bisect.bisect_right(ts, t) - 1)
        cur = MOODS[self.moods[i][1]]
        prev = MOODS[self.moods[max(0, i - 1)][1]]
        u = ease("io", (t - self.moods[i][0]) / 0.18)
        st["mood"] = tuple(prev[j] + (cur[j] - prev[j]) * u for j in range(6))
        return st


# ------------------------------------------------------------------ faces
def face(c, st, t, name_seed, ex, ey, er, mx, my, mw, brow=(45, 30, 30), eye_ry=1.15, blinkable=True):
    ba, bl, eo, smile, mwid, ps = st["mood"]
    # blink
    blink = 0.0
    if blinkable and not st["freeze"]:
        per = 3.1 + name_seed * 2.2
        ph = (t + name_seed * 9) % per
        if ph < 0.15:
            blink = math.sin(math.pi * ph / 0.15)
    ry = er * eye_ry * eo * (1 - 0.92 * blink)
    lx, ly = st["lx"], st["ly"]
    if lx > 1e5:
        dx = dy = 0.0
    else:
        vx, vy = lx - st["x"], ly - (st["y"] - 100 * st["s"])
        d = math.hypot(vx, vy) + 1e-6
        k = min(1.0, d / 260.0)
        dx, dy = vx / d * k, vy / d * k
    for sgn in (-1, 1):
        cx = sgn * ex
        ell(c, cx, ey, er, ry, fill((255, 255, 255)))
        ell(c, cx, ey, er, ry, stroke((40, 30, 30), 2.5))
        pr = er * 0.52 * ps
        px = cx + dx * (er - pr) * 0.85
        py = ey + dy * max(ry - pr, 0) * 0.85
        if blink < 0.7:
            ell(c, px, py, pr, min(pr, ry * 0.95), fill((25, 20, 25)))
            ell(c, px - pr * 0.3, py - pr * 0.35, pr * 0.28, pr * 0.28, fill((255, 255, 255)))
        # brows: inner end toward center
        inner = -sgn
        bx_in, bx_out = cx + inner * er * 0.85, cx - inner * er * 0.95
        by = ey - er * 1.55 + bl * er / 20.0
        k2 = ba * er / 20.0 * 0.45
        c.drawLine(bx_out, by - k2, bx_in, by + k2, stroke(brow, max(3.5, er * 0.24)))
    # mouth
    w = mw * mwid
    open_v = st["talk"]
    cyc = my - smile * 0.2 * w
    if open_v < 0.07:
        p = skia.Path()
        p.moveTo(mx - w, cyc)
        p.quadTo(mx, my + smile * 0.62 * w, mx + w, cyc)
        c.drawPath(p, stroke((60, 25, 30), 5.0))
    else:
        h = open_v * w * 0.95
        p = skia.Path()
        p.moveTo(mx - w * 0.9, cyc)
        p.quadTo(mx, my + smile * 0.25 * w - 2, mx + w * 0.9, cyc)
        p.quadTo(mx, cyc + 2 * h + max(smile, 0) * 0.3 * w, mx - w * 0.9, cyc)
        p.close()
        c.save()
        c.clipPath(p, doAntiAlias=True)
        c.drawPath(p, fill((70, 20, 30)))
        ell(c, mx, cyc + h * 1.25 + 2, w * 0.55, h * 0.7, fill((235, 110, 120)))
        c.restore()
        c.drawPath(p, stroke((50, 20, 25), 3.0))


# ------------------------------------------------------------------ characters
# each draw fn: feet at (0,0), up is negative y. returns nothing. height defined in HEIGHT.
HEIGHT = dict(kubik=150, lime=170, tiktak=290, tsap=270, tisha=100, iskra=200, hand=0)


def draw_kubik(c, st, t, seed):
    red = (214, 38, 40)
    # side face (right)
    c.drawPath(poly([(100, -110), (130, -148), (130, -38), (100, 0)]), fill(shade(red, 0.62)))
    # front
    rrect(c, -100, -112, 100, 0, 9, fill(red, shader=lingrad((0, -112), (0, 0), shade(red, 1.12), shade(red, 0.9))))
    # top face
    c.drawPath(poly([(-100, -110), (100, -110), (130, -148), (-70, -148)]), fill(shade(red, 1.3)))
    def stud(u, v, hole=False):
        x = -100 + 200 * u + 30 * v
        y = -110 - 38 * v
        if hole:
            ell(c, x, y, 17, 8, fill(shade(red, 0.35)))
            ell(c, x, y + 1.5, 13, 5.5, fill((30, 5, 10)))
            return
        rrect(c, x - 18, y - 13, x + 18, y + 1, 4, fill(shade(red, 1.0)))
        ell(c, x, y + 1, 18, 8, fill(shade(red, 0.85)))
        ell(c, x, y - 13, 18, 8, fill(shade(red, 1.4)))
        ell(c, x - 5, y - 15, 6, 2.5, fill((255, 190, 190), 0.7))
    for i in range(4):
        stud((i + 0.5) / 4, 0.76)
    for i in range(4):
        stud((i + 0.5) / 4, 0.27, hole=(i == 2))
    face(c, st, t, seed, 34, -64, 20, 0, -26, 23)


def draw_lime(c, st, t, seed):
    age = st["a"]
    base = mixc((120, 205, 40), (165, 150, 45), age * 1.2)
    base = mixc(base, (110, 75, 30), max(0, age - 0.55) * 1.6)
    rim = shade(base, 0.62)
    cx, cy, r = 0, -88, 88
    c.drawCircle(cx, cy, r, fill(rim))
    c.drawCircle(cx, cy, r - 5, fill(base, shader=radgrad(-22, -112, 130, shade(base, 1.35), base, 1.0, 1.0)))
    c.save()
    c.clipPath(skia.Path().addCircle(cx, cy, r - 4), doAntiAlias=True)
    rot = st["b"]
    c.translate(cx, cy)
    c.rotate(rot)
    for i in range(46):  # pores
        a = i * 2.399
        d = 20 + (i * 37 % 60)
        px, py = math.cos(a) * d, math.sin(a) * d
        ell(c, px, py, 2.2, 1.5, fill(shade(base, 0.72), 0.55))
    # wrinkles & dark patches grow with age
    n = int(age * 14)
    for i in range(n):
        a = i * 1.7 + 0.4
        d = 38 + (i * 23 % 40)
        px, py = math.cos(a) * d, math.sin(a) * d
        p = skia.Path()
        p.moveTo(px - 16, py - 5)
        p.quadTo(px, py + 8 * (1 if i % 2 else -1), px + 16, py - 3)
        c.drawPath(p, stroke(shade(base, 0.5), 2.6, 0.7))
    c.restore()
    c.save()
    c.clipPath(skia.Path().addCircle(cx, cy, r - 4), doAntiAlias=True)
    ell(c, -34, -128, 22, 10, fill((255, 255, 255), 0.35 * (1 - age)))
    c.restore()
    c.drawCircle(0, cy - r + 6, 5, fill((90, 80, 30)))
    face(c, st, t, seed, 28, -96, 22, 0, -52, 27)
    # dark spots (grow with age): first one is on the right cheek
    spots = [(52, -62, 15), (-56, -54, 12), (30, -26, 10), (-40, -138, 9), (62, -108, 8), (0, -20, 7)]
    ns = 0 if age < 0.03 else 1 + int(age * 12)
    for (sx, sy, sr) in spots[:ns]:
        k = min(1.0, (age - 0.03) * 30) if ns == 1 else 1.0
        ell(c, sx, sy, sr * k, sr * 0.8 * k, fill((70, 45, 20), 0.9))


def draw_tiktak(c, st, t, seed):
    gold = (206, 160, 58)
    # feet
    for sx in (-1, 1):
        c.drawPath(poly([(sx * 64, -28), (sx * 100, 0), (sx * 78, 0), (sx * 48, -22)]), fill((120, 90, 40), 1))
    # bells (ears)
    ring = 0.0
    if st["a"] > 0:
        ring = math.sin(t * 90) * 5 * st["a"]
    for sx in (-1, 1):
        c.save()
        c.translate(sx * 78, -246)
        c.rotate(sx * (32 + ring))
        p = skia.Path()
        p.moveTo(-52, 0)
        p.cubicTo(-52, -60, 52, -60, 52, 0)
        p.close()
        c.drawPath(p, fill((215, 190, 120), shader=lingrad((0, -50), (0, 0), (245, 225, 150), (170, 135, 60))))
        c.drawPath(p, stroke((120, 90, 40), 3.5))
        ell(c, 0, -55, 9, 7, fill((170, 135, 60)))
        c.restore()
    # hammer
    c.drawLine(0, -250, 0, -285, stroke((90, 70, 40), 5))
    c.drawCircle(0, -288, 8, fill((90, 70, 40)))
    # body
    c.drawCircle(0, -135, 124, fill(shade(gold, 0.6)))
    c.drawCircle(0, -135, 120, fill(gold, shader=radgrad(-30, -165, 150, (255, 225, 140), gold, 1, 1)))
    c.drawCircle(0, -135, 98, fill((252, 243, 220)))
    c.drawCircle(0, -135, 98, stroke((150, 110, 50), 3))
    for i in range(12):
        a = math.radians(i * 30)
        r1, r2 = (84, 94) if i % 3 else (78, 94)
        c.drawLine(math.sin(a) * r1, -135 - math.cos(a) * r1, math.sin(a) * r2, -135 - math.cos(a) * r2,
                   stroke((120, 90, 50), 3 if i % 3 else 5))
    # stuck hands at 3:47
    for ang, ln, wd in ((3 * 30 + 47 * 0.5, 52, 8), (47 * 6, 78, 5)):
        a = math.radians(ang)
        c.drawLine(0, -135, math.sin(a) * ln, -135 - math.cos(a) * ln, stroke((100, 70, 45), wd, 0.55))
    c.drawCircle(0, -135, 6, fill((100, 70, 45), 0.6))
    # crack
    p = skia.Path()
    p.moveTo(52, -208); p.lineTo(66, -188); p.lineTo(58, -172); p.lineTo(74, -150)
    c.drawPath(p, stroke((120, 130, 140), 1.8, 0.7))
    face(c, st, t, seed, 36, -160, 20, 0, -98, 24, brow=(120, 120, 120), blinkable=True)
    # moustache
    p = skia.Path()
    for sx in (-1, 1):
        p.moveTo(0, -116)
        p.cubicTo(sx * 18, -126, sx * 40, -124, sx * 50, -110)
    c.drawPath(p, stroke((90, 80, 80), 4))


def draw_tsap(c, st, t, seed):
    snip = st["a"] + st["talk"] * 0.8
    ang = 7 + 17 * snip
    blade = (190, 205, 225)
    for sgn in (-1, 1):
        c.save()
        c.translate(0, -140)
        c.rotate(sgn * ang)
        p = skia.Path()
        p.moveTo(-22 * sgn if sgn else 0, 0)
        p.lineTo(sgn * 8, 0)
        p.lineTo(sgn * 24, -112)
        p.cubicTo(sgn * 26, -138, sgn * 6, -142, sgn * -4, -128)
        p.lineTo(sgn * -16, -20)
        p.close()
        c.drawPath(p, fill(blade, shader=lingrad((-30, 0), (30, 0), (225, 235, 250), (150, 165, 195))))
        c.drawPath(p, stroke((90, 100, 130), 3))
        c.restore()
    # handles
    for sgn, hc in ((-1, (245, 130, 40)), (1, (60, 160, 90))):
        c.save()
        c.translate(sgn * 48, -62)
        c.rotate(sgn * -8)
        ell(c, 0, 0, 40, 52, stroke(hc, 20))
        ell(c, 0, 0, 40, 52, stroke(shade(hc, 0.7), 3, 0.8))
        c.restore()
    c.drawCircle(0, -140, 64, fill((60, 90, 170), shader=radgrad(-18, -162, 80, (110, 150, 235), (50, 80, 160), 1, 1)))
    c.drawCircle(0, -140, 64, stroke((30, 50, 110), 4))
    c.drawCircle(0, -140, 6, fill((200, 205, 215)))
    face(c, st, t, seed, 26, -150, 19, 0, -108, 24, brow=(15, 20, 40))


def draw_tisha(c, st, t, seed):
    cx, cy, r = 0, -52, 52
    c.drawCircle(cx, cy, r + 3, fill((170, 160, 175)))
    sh = skia.GradientShader.MakeSweep(cx, cy, [col((255, 235, 245)), col((200, 225, 255)), col((255, 245, 225)),
                                                  col((230, 215, 255)), col((255, 235, 245))])
    c.drawCircle(cx, cy, r, fill((240, 235, 240), shader=sh))
    c.drawCircle(cx, cy, r - 9, fill((250, 246, 250), shader=radgrad(-14, -66, 70, (255, 255, 255), (232, 226, 238), 1, 1)))
    c.drawCircle(cx, cy, r - 9, stroke((190, 180, 200), 2))
    # thread
    p = skia.Path()
    p.moveTo(r - 14, -20); p.quadTo(r + 12, -4, r - 2, 6); p.quadTo(r - 14, 14, r + 6, 12)
    c.drawPath(p, stroke((220, 120, 150), 3.2))
    face(c, st, t, seed, 19, -62, 13, 0, -33, 13, brow=(120, 100, 130))


def draw_iskra(c, st, t, seed):
    volt = st["a"]
    body = (230, 150, 40)
    c.drawPath(skia.Path().addRRect(skia.RRect.MakeRectXY(R(-26, -208, 26, -192), 4, 4)), fill((190, 195, 205)))
    rrect(c, -50, -194, 50, -8, 20, fill(shade(body, 0.7)))
    rrect(c, -46, -190, 46, -12, 17, fill(body, shader=lingrad((-46, 0), (46, 0), shade(body, 1.2), shade(body, 0.85))))
    # charge gauge (half empty)
    rrect(c, 32, -176, 44, -30, 4, fill((60, 40, 20), 0.75))
    rrect(c, 34, -102, 42, -32, 3, fill((255, 230, 90)))
    rrect(c, -46, -52, 46, -12, 14, fill((50, 45, 60), 0.9))
    c.drawLine(-30, -32, 30, -32, stroke((255, 230, 90), 4, 0.8))
    shake = math.sin(t * 70) * 2.2 * volt
    c.translate(shake, 0)
    face(c, st, t, seed, 22, -130, 16, 0, -92, 15, brow=(70, 40, 10))
    # sparks
    if volt > 0.02:
        for i in range(int(3 + volt * 7)):
            ph = (t * 11 + i * 1.37 + seed * 7)
            if int(ph * 2) % 2 == 0 or volt > 0.8:
                ang = (int(ph * 2) * 2.1 + i * 1.9) % 6.283
                r0, r1 = 55, 55 + 28 * volt + (i % 3) * 8
                pts = [(math.cos(ang) * r0, -120 + math.sin(ang) * r0 * 1.3)]
                for j in range(1, 4):
                    rr = r0 + (r1 - r0) * j / 3
                    pts.append((math.cos(ang + 0.25 * (-1) ** j) * rr, -120 + math.sin(ang + 0.25 * (-1) ** j) * rr * 1.3))
                p = skia.Path()
                p.moveTo(*pts[0])
                for q in pts[1:]:
                    p.lineTo(*q)
                c.drawPath(p, stroke((255, 245, 130), 5, 0.4, blend=skia.BlendMode.kPlus))
                c.drawPath(p, stroke((255, 255, 220), 2.4, 1.0))


DRAW = dict(kubik=draw_kubik, lime=draw_lime, tiktak=draw_tiktak, tsap=draw_tsap, tisha=draw_tisha, iskra=draw_iskra)


def draw_actor(c, act, t):
    st = act.state(t)
    if st["vis"] < 0.5:
        return
    h = HEIGHT[act.kind]
    x, y, s = st["x"], st["y"] + st["dy"], st["s"]
    # shadow
    sy_ground = st["y"]
    lift = min(1.0, abs(st["dy"]) / 160.0)
    sw = {"kubik": 110, "lime": 78, "tiktak": 118, "tsap": 80, "tisha": 50, "iskra": 52}[act.kind] * s * (1 - 0.35 * lift)
    c.save()
    c.translate(x, sy_ground)
    ell(c, 0, 2, sw, 14 * s * (1 - 0.3 * lift), fill((0, 0, 0), 0.28 * (1 - 0.5 * lift)))
    c.restore()
    idle = 0.0 if st["freeze"] else math.sin(2 * math.pi * (t * 0.55 + act.seed)) * 0.018
    c.save()
    c.translate(x, y)
    c.scale(s * st["sqx"] * (1 - idle * 0.5), s * st["sqy"] * (1 + idle))
    c.translate(0, -h / 2)
    c.rotate(st["rot"])
    c.translate(0, h / 2)
    DRAW[act.kind](c, st, t, act.seed)
    c.restore()


# ------------------------------------------------------------------ hand
def draw_hand(c, t, hx, hy, curl, night):
    skin = mixc((250, 205, 170), (190, 175, 190), night * 0.55)
    edge = shade(skin, 0.68)
    cr = max(0.0, min(1.0, curl))
    # arm
    c.drawPath(skia.Path().addRRect(skia.RRect.MakeRectXY(R(hx - 125, hy - 1700, hx + 125, hy - 60), 40, 40)),
               fill(edge))
    c.drawPath(skia.Path().addRRect(skia.RRect.MakeRectXY(R(hx - 118, hy - 1700, hx + 118, hy - 60), 36, 36)),
               fill(skin))
    # fingers
    fx = [-110, -38, 36, 106]
    ang = [-13, -4, 5, 14]
    ln = [215, 255, 240, 190]
    for i in range(4):
        L = ln[i] * (1 - 0.5 * cr)
        bx = hx + fx[i] * (1 - 0.32 * cr)
        by = hy + 90
        a = math.radians(ang[i] * (1 - 0.6 * cr))
        ex, ey = bx + math.sin(a) * L * -1, by + math.cos(a) * L
        wid = 66 + 12 * cr
        c.drawLine(bx, by, ex, ey, stroke(edge, wid + 8))
        c.drawLine(bx, by, ex, ey, stroke(skin, wid))
        ell(c, ex, ey + 4 - 10 * cr, 13, 17, fill(shade(skin, 1.08)))
        c.drawLine(bx - 14, by + L * 0.55, bx + 14, by + L * 0.55, stroke(edge, 2.5, 0.6))
    # palm
    c.drawPath(skia.Path().addRRect(skia.RRect.MakeRectXY(R(hx - 150, hy - 150, hx + 150, hy + 130), 80, 80)), fill(edge))
    c.drawPath(skia.Path().addRRect(skia.RRect.MakeRectXY(R(hx - 144, hy - 144, hx + 144, hy + 124), 76, 76)),
               fill(skin, shader=lingrad((hx - 140, hy - 140), (hx + 140, hy + 130), shade(skin, 1.06), shade(skin, 0.9))))
    # palm lines
    p = skia.Path()
    p.moveTo(hx - 90, hy - 20); p.quadTo(hx - 10, hy + 40, hx + 80, hy - 40)
    c.drawPath(p, stroke(edge, 4, 0.5))
    # thumb
    tx0, ty0 = hx + 128, hy + 20
    tl = 190 * (1 - 0.45 * cr)
    ta = math.radians(-38 + 28 * cr)
    tx1, ty1 = tx0 + math.sin(ta) * -tl * 0.0 + (-math.sin(ta)) * tl * -1 * 0.0, 0
    tx1, ty1 = tx0 + 70 * (1 - 0.5 * cr), ty0 + tl * 0.9
    c.drawLine(tx0, ty0, tx1, ty1, stroke(edge, 82))
    c.drawLine(tx0, ty0, tx1, ty1, stroke(skin, 74))


# ------------------------------------------------------------------ world
def draw_world_back(c, t, G):
    night = G["night"].at(t)
    lid = G["lid"].at(t)
    beam = G["beam"].at(t)
    # attic dark above
    c.drawRect(R(-3000, -2400, 5000, 0), fill((10, 8, 16)))
    # back wall
    wall_top, wall_bot = (176, 132, 88), (96, 70, 52)
    c.drawRect(R(-300, 0, 2300, 2300), fill((0, 0, 0), shader=lingrad((0, 360), (0, 1900), wall_top, wall_bot)))
    for i in range(0, 2400, 46):
        c.drawLine(i - 300, 300, i - 300, 2300, stroke((60, 40, 25), 3, 0.10))
    # side walls
    for sx0, sx1 in ((-300, 70), (1930, 2300)):
        c.drawRect(R(sx0, 0, sx1, 2300), fill((0, 0, 0), shader=lingrad((sx0, 0), (sx1, 0), (120, 88, 58), (86, 62, 42))))
    for y in range(380, 2200, 38):
        c.drawLine(-300, y, 70, y, stroke((70, 48, 30), 2.5, 0.22))
        c.drawLine(1930, y, 2300, y, stroke((70, 48, 30), 2.5, 0.22))
    # wall stains / old tape
    c.save()
    c.translate(400, 560); c.rotate(-6)
    c.drawRect(R(-70, -22, 70, 22), fill((236, 220, 160), 0.55))
    c.restore()
    c.save()
    c.translate(1300, 700); c.rotate(9)
    c.drawRect(R(-60, -20, 60, 20), fill((236, 220, 160), 0.5))
    c.restore()
    # background toy silhouettes (rocking horse head, tin drum)
    c.drawCircle(220, 1080, 70, fill((120, 84, 56)))
    c.drawRect(R(150, 1080, 290, 1180), fill((120, 84, 56)))
    c.drawLine(150, 1090, 290, 1090, stroke((150, 110, 76), 6))
    # lid ceiling
    hw = 14 + lid * 300
    lid_dark = (80, 58, 40)
    for side in (-1, 1):
        # lid flap polygons (rise as it opens)
        lift = lid * 150
        x_in = 1000 + side * hw
        x_out = 1000 + side * 1100
        pts = [(x_in, 300 - lift * 0.9), (x_out, 300 - lift * 0.9 - 20), (x_out, 0), (x_in, 0)] if False else None
        c.drawPath(poly([(1000 + side * hw, 380 - lift * 0.35), (1000 + side * 1200, 380), (1000 + side * 1200, -400),
                         (1000 + side * hw, -400)]), fill(lid_dark, shader=lingrad((0, 0), (0, 380), (60, 44, 30), (110, 80, 54))))
        c.drawPath(poly([(1000 + side * hw, 380 - lift * 0.35), (1000 + side * 1200, 380), (1000 + side * 1200, 395),
                         (1000 + side * hw, 400 - lift * 0.35)]), fill((50, 36, 26)))
    # light through the slit / opening
    wide = lid
    hole_l, hole_r = 1000 - hw, 1000 + hw
    open_col = mixc((255, 238, 190), (225, 235, 255), night)
    strength = max(beam, wide)
    if strength > 0.01:
        c.drawRect(R(hole_l, -300, hole_r, 395), fill(open_col, shader=lingrad((0, -300), (0, 395), (255, 255, 255), open_col)))
    # beam cone to the ground (additive)
    if strength > 0.01:
        spread_top = hw
        spread_bot = hw + 90 + wide * 520
        shift = -240 if wide < 0.3 else -240 * (1 - wide * 0.6)
        pts = [(1000 - spread_top, 395), (1000 + spread_top, 395), (1000 + shift + spread_bot, GROUND), (1000 + shift - spread_bot, GROUND)]
        a_top = 0.55 * strength
        sh = lingrad((0, 395), (0, GROUND), open_col, open_col, a_top, 0.08 * strength)
        c.drawPath(poly(pts), fill(open_col, shader=sh, blend=skia.BlendMode.kPlus))
        # dust motes
        for i in range(34):
            ph = (t * (6 + i % 5) * 4 + i * 97) % 780
            fy = 395 + ph
            u = (fy - 395) / (GROUND - 395)
            cx = 1000 + shift * u + math.sin(t * 0.8 + i) * (spread_top + (spread_bot - spread_top) * u) * 0.8
            c.drawCircle(cx, fy, 2.0 + (i % 3), fill((255, 250, 220), 0.45 * strength, blend=skia.BlendMode.kPlus))


def draw_matchbox(c, cx, w, h, label, lit, night):
    base = 1180
    top = base - h
    wood = (212, 170, 118)
    # side face
    c.drawPath(poly([(cx + w / 2, base), (cx + w / 2 + 30, base - 38), (cx + w / 2 + 30, top - 38), (cx + w / 2, top)]),
               fill((120, 80, 58)))
    c.drawPath(poly([(cx + w / 2, base - 20), (cx + w / 2 + 30, base - 58), (cx + w / 2 + 30, base - 44), (cx + w / 2, base - 6)]) if False else poly([(cx + w / 2, top + h * 0.15), (cx + w / 2 + 30, top - 38 + h * 0.15), (cx + w / 2 + 30, top - 38 + h * 0.85), (cx + w / 2, top + h * 0.85)]),
               fill((60, 52, 50)))
    # front
    rrect(c, cx - w / 2, top, cx + w / 2, base, 6, fill(wood, shader=lingrad((0, top), (0, base), (232, 192, 140), (190, 148, 100))))
    # label band
    rrect(c, cx - w / 2 + 10, top + 14, cx + w / 2 - 10, top + 62, 5, fill(label))
    c.drawCircle(cx, top + 38, 15, fill((255, 255, 255), 0.85))
    # window & door
    wc = mixc((255, 240, 180), (255, 214, 110), night)
    rrect(c, cx - w / 2 + 28, top + 84, cx - w / 2 + 84, top + 134, 4, fill(wc if lit else (120, 150, 170)))
    c.drawLine(cx - w / 2 + 56, top + 84, cx - w / 2 + 56, top + 134, stroke((110, 80, 55), 3))
    rrect(c, cx + w / 2 - 80, base - 98, cx + w / 2 - 24, base, 6, fill((130, 88, 58)))
    c.drawCircle(cx + w / 2 - 36, base - 50, 4, fill((235, 200, 90)))
    # roof (top face)
    c.drawPath(poly([(cx - w / 2, top), (cx + w / 2, top), (cx + w / 2 + 30, top - 38), (cx - w / 2 + 30, top - 38)]),
               fill((236, 200, 150)))
    c.drawPath(poly([(cx - w / 2, top), (cx + w / 2, top), (cx + w / 2 + 30, top - 38), (cx - w / 2 + 30, top - 38)]),
               stroke((150, 110, 76), 2.5))
    return (cx - w / 2 + 14, top + 109, lit)


def draw_tower(c, cx):
    cols = [(210, 60, 70), (60, 120, 200), (240, 190, 50)]
    y = GROUND
    for i, tc in enumerate(cols):
        top = y - 150
        # flanges
        rrect(c, cx - 112, y - 18, cx + 112, y, 5, fill((176, 126, 78)))
        rrect(c, cx - 112, top, cx + 112, top + 18, 5, fill((196, 146, 92)))
        # thread
        rrect(c, cx - 86, top + 18, cx + 86, y - 18, 4, fill(tc, shader=lingrad((cx - 86, 0), (cx + 86, 0), shade(tc, 1.2), shade(tc, 0.75))))
        for k in range(top + 28, y - 18, 11):
            c.drawLine(cx - 86, k, cx + 86, k + 3, stroke(shade(tc, 0.7), 1.8, 0.55))
        y = top
    # top plate
    ell(c, cx, y + 4, 112, 20, fill((206, 156, 100)))
    ell(c, cx, y + 2, 100, 14, fill((226, 182, 126)))
    return y  # top height


def draw_town(c, t, G):
    night = G["night"].at(t)
    # shelf
    c.drawRect(R(70, GROUND, 1930, GROUND + 130), fill((0, 0, 0), shader=lingrad((0, GROUND), (0, GROUND + 130), (206, 160, 108), (150, 108, 68))))
    for x in range(70, 1930, 24):
        c.drawLine(x, GROUND + 6, x + 12, GROUND + 124, stroke((120, 84, 52), 2.5, 0.4))
    c.drawRect(R(70, GROUND - 2, 1930, GROUND + 10), fill((230, 188, 132)))
    # stairs hole at the left (forbidden Bottom)
    c.drawPath(poly([(90, GROUND), (330, GROUND), (330, GROUND + 130), (90, GROUND + 130)]), fill((12, 8, 12)))
    for i in range(5):
        c.drawRect(R(90 + i * 40, GROUND + 10 + i * 22, 330, GROUND + 28 + i * 22), fill((40, 28, 24)))
    # sign
    c.drawRect(R(338, GROUND - 130, 346, GROUND), fill((100, 70, 40)))
    c.save()
    c.translate(342, GROUND - 150)
    c.rotate(-5)
    rrect(c, -62, -34, 62, 34, 6, fill((235, 235, 225)))
    c.drawCircle(0, 0, 22, stroke((210, 40, 40), 6))
    c.drawLine(-16, 16, 16, -16, stroke((210, 40, 40), 6))
    c.restore()
    # ground props: marble, crayon
    c.drawCircle(1385, GROUND - 18, 18, fill((70, 140, 220), shader=radgrad(1378, GROUND - 26, 22, (200, 230, 255), (60, 120, 210), 1, 1)))
    c.save(); c.translate(1230, GROUND - 14); c.rotate(-8)
    rrect(c, -50, -9, 50, 9, 4, fill((220, 70, 160))); c.drawPath(poly([(50, -9), (72, 0), (50, 9)]), fill((220, 70, 160)))
    c.restore()
    # houses
    wins = []
    wins.append(draw_matchbox(c, 640, 300, 210, (60, 120, 190), True, night))   # Kubik's
    wins.append(draw_matchbox(c, 960, 220, 170, (200, 70, 60), False, night))
    wins.append(draw_matchbox(c, 1250, 200, 190, (70, 160, 90), True, night))
    wins.append(draw_matchbox(c, 430, 210, 160, (230, 170, 50), False, night))
    top = draw_tower(c, 1640)
    return wins


def draw_bottom(c, t, G):
    # cliff below the shelf: darkness with Forgotten things
    c.drawRect(R(70, GROUND + 130, 1930, 2300), fill((0, 0, 0), shader=lingrad((0, GROUND + 130), (0, 2000), (62, 44, 34), (6, 4, 8))))
    # silhouettes
    sil = (18, 12, 18)
    c.drawCircle(560, 1620, 60, fill(sil))
    c.drawRect(R(520, 1620, 600, 1700), fill(sil))
    c.drawLine(500, 1700, 660, 1700, stroke(sil, 26))
    c.drawCircle(1200, 1780, 44, stroke(sil, 20))
    c.drawLine(1160, 1780, 1380, 1820, stroke(sil, 18))
    c.drawCircle(980, 1900, 56, fill(sil))
    c.drawCircle(300, 1860, 34, stroke(sil, 12))
    e = G["eyes"].at(t)
    if e > 0.01:
        for (x, y) in ((545, 1608), (575, 1608), (968, 1888), (994, 1888), (1186, 1768), (1212, 1768)):
            blink = 0.2 if int(t * 3) % 7 == 0 else 1.0
            ell(c, x, y, 6, 8 * blink, fill((255, 250, 200), e, blend=skia.BlendMode.kPlus))


def world_overlay(c, t, G, wins):
    night = G["night"].at(t)
    if night > 0.01:
        c.drawRect(R(-3000, -2400, 5000, 4000), fill((14, 22, 62), 0.62 * night))
        for (wx, wy, lit) in wins:
            if lit:
                c.drawCircle(wx + 14, wy, 120, fill((255, 190, 90), shader=radgrad(wx + 14, wy, 120, (255, 190, 90), (255, 190, 90), 0.30 * night, 0.0), blend=skia.BlendMode.kPlus))
    # inside-lid beam brightens hand scene
    lid = G["lid"].at(t)
    if lid > 0.01:
        c.drawRect(R(-3000, -2400, 5000, 4000), fill((20, 30, 70), 0.0))


def draw_vignette(c, G, t):
    sh = skia.GradientShader.MakeRadial((W / 2, H / 2), 760, [col((0, 0, 0), 0.0), col((0, 0, 0), 0.55)], [0.55, 1.0])
    c.drawRect(R(0, 0, W, H), fill((0, 0, 0), shader=sh))


def wrap(text, f, maxw):
    words, lines, cur = text.split(), [], ""
    for w in words:
        trial = (cur + " " + w).strip()
        if f.measureText(trial) <= maxw:
            cur = trial
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def draw_caption(c, name, text, color, alpha=1.0):
    f = font(34)
    lines = wrap(text, f, 1000)
    lh = 42
    bh = lh * len(lines) + 20
    y0 = H - 34 - bh
    rrect(c, 120, y0, W - 120, y0 + bh, 16, fill((0, 0, 0), 0.58 * alpha))
    for i, ln in enumerate(lines):
        w = f.measureText(ln)
        x = (W - w) / 2
        c.drawString(ln, x + 2, y0 + 14 + lh * (i + 0.78) + 2, f, fill((0, 0, 0), alpha))
        c.drawString(ln, x, y0 + 14 + lh * (i + 0.78), f, fill((255, 255, 255), alpha))
    nf = font(22)
    rrect(c, 120, y0 - 30, 120 + nf.measureText(name) + 24, y0 + 2, 10, fill(color, alpha))
    c.drawString(name, 132, y0 - 7, nf, fill((20, 20, 20), alpha))


def draw_title(c, text, sub, a, big=120):
    c.drawRect(R(0, 0, W, H), fill((0, 0, 0), 0.55 * a))
    f = font(big)
    w = f.measureText(text)
    c.drawString(text, (W - w) / 2 + 5, 340 + 5, f, fill((0, 0, 0), a))
    c.drawString(text, (W - w) / 2, 340, f, fill((255, 214, 80), a))
    if sub:
        f2 = font(46)
        w2 = f2.measureText(sub)
        c.drawString(sub, (W - w2) / 2, 420, f2, fill((255, 255, 255), a))


def draw_card(c, lines, a, head):
    rrect(c, 300, 120, W - 300, 450, 22, fill((250, 240, 210), 0.96 * a))
    rrect(c, 300, 120, W - 300, 450, 22, stroke((120, 80, 40), 5, a))
    f = font(40)
    c.drawString(head, (W - f.measureText(head)) / 2, 180, f, fill((150, 60, 40), a))
    f2 = font(36)
    for i, ln in enumerate(lines):
        c.drawString(ln, 340, 250 + i * 66, f2, fill((60, 40, 30), a))
