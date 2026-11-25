"""Director: sequential scripting API on top of the engine + final render/mux."""
import math, os, subprocess, multiprocessing as mp
import numpy as np
import skia
import soundfile as sf
import engine as E
import audio as A
from engine import FPS, W, H, GROUND

CAP_COLORS = {"kubik": (235, 90, 80), "lime": (140, 215, 60), "tiktak": (230, 190, 90), "tsap": (110, 150, 235),
              "tisha": (225, 200, 240), "iskra": (255, 200, 70)}
CAP_NAMES = {"kubik": "KUBIK", "lime": "LIME", "tiktak": "TIK-TAK", "tsap": "TSAP", "tisha": "TISHA", "iskra": "ISKRA"}
HOME_COLOR = (240, 240, 240)


class Director:
    def __init__(self):
        self.t = 0.0
        self.actors = {}
        self.order = []
        d = dict(night=0, lid=0, beam=1, shake=0, fade=1, eyes=0, cx=1000, cy=700, cz=0.62,
                 hand_x=1000, hand_y=-900, hand_curl=0, hand_vis=0, hand_night=0)
        self.G = {k: E.Track(v) for k, v in d.items()}
        self.voice, self.sfx, self.music, self.caps, self.titles, self.cards = [], [], [], [], [], []

    # ---- scene
    def add(self, name, kind, x, y=GROUND, s=1.0, mood="neutral"):
        a = E.Actor(name, kind, x, y, s, mood)
        self.actors[name] = a
        self.order.append(a)
        return a

    def wait(self, d):
        self.t += d

    def cam(self, cx, cy, z, dur=1.2, e="io"):
        for k, v in (("cx", cx), ("cy", cy), ("cz", z)):
            self.G[k].anim(self.t, self.t + dur, v, e)

    def cut(self, cx, cy, z):
        for k, v in (("cx", cx), ("cy", cy), ("cz", z)):
            self.G[k].key(self.t - 0.001, self.G[k].at(self.t - 0.002), "lin")
            self.G[k].key(self.t, v, "lin")

    def g(self, key, v, dur=1.0, e="io"):
        self.G[key].anim(self.t, self.t + dur, v, e)

    def fade(self, to, dur=1.0):
        self.G["fade"].anim(self.t, self.t + dur, to, "io")

    def snd(self, name, dt=0.0, **kw):
        self.sfx.append((self.t + dt, name, kw))

    def music_play(self, mode, dur, vol=1.0):
        self.music.append((self.t, self.t + dur, mode, vol))

    def mood(self, a, m):
        a = self.actors[a] if isinstance(a, str) else a
        a.moods.append((self.t, m))

    def look(self, a, target):
        a = self.actors[a] if isinstance(a, str) else a
        if target is None:
            a.tr["lx"].set(self.t, 1e6); a.tr["ly"].set(self.t, 1e6)
        else:
            if isinstance(target, str):
                o = self.actors[target]
                target = (o.tr["x"].at(self.t), o.tr["y"].at(self.t) - 90)
            a.tr["lx"].set(self.t, target[0]); a.tr["ly"].set(self.t, target[1])

    def freeze(self, names, on=True):
        for n in names:
            self.actors[n].tr["freeze"].set(self.t, 1 if on else 0)

    def show(self, a, on=True):
        self.actors[a].tr["vis"].set(self.t, 1 if on else 0)

    def pos(self, a, x, y=None):
        a = self.actors[a]
        a.tr["x"].key(self.t, a.tr["x"].at(self.t), "lin"); a.tr["x"].key(self.t + 0.001, x, "lin")
        if y is not None:
            a.tr["y"].key(self.t, a.tr["y"].at(self.t), "lin"); a.tr["y"].key(self.t + 0.001, y, "lin")

    def set(self, a, prop, v, dur=0.0):
        tr = self.actors[a].tr[prop]
        if dur > 0:
            tr.anim(self.t, self.t + dur, v, "io")
        else:
            tr.set(self.t, v)

    def pulse(self, a, prop, v, dur):  # go to v and come back
        tr = self.actors[a].tr[prop]
        v0 = tr.at(self.t)
        tr.key(self.t, v0, "lin"); tr.key(self.t + dur * 0.4, v, "io"); tr.key(self.t + dur, v0, "io")

    # ---- movement
    def hop(self, a, x, y=None, dur=1.0, h=55, n=None, sound=True):
        a = self.actors[a] if isinstance(a, str) else a
        t0 = self.t
        x0, y0 = a.tr["x"].at(t0), a.tr["y"].at(t0)
        y = y0 if y is None else y
        n = n or max(1, round(math.hypot(x - x0, y - y0) / 150))
        per = dur / n
        for i in range(n):
            xa = x0 + (x - x0) * i / n; xb = x0 + (x - x0) * (i + 1) / n
            ya = y0 + (y - y0) * i / n; yb = y0 + (y - y0) * (i + 1) / n
            ts = t0 + i * per
            a.tr["x"].key(ts, xa, "lin"); a.tr["x"].key(ts + per, xb, "lin")
            a.tr["y"].key(ts, ya, "lin"); a.tr["y"].key(ts + per, yb, "lin")
            steps = max(2, int(per * FPS))
            for f in range(steps + 1):
                u = f / steps
                tt = ts + u * per
                dy = -h * 4 * u * (1 - u)
                land = max(0, 0.14 - u) / 0.14 + max(0, u - 0.86) / 0.14
                sq = 1 + 0.13 * math.sin(math.pi * u) - 0.2 * land
                a.tr["dy"].key(tt, dy, "lin"); a.tr["sqy"].key(tt, sq, "lin"); a.tr["sqx"].key(tt, 1 / math.sqrt(sq), "lin")
            if sound:
                self.sfx.append((ts, "hop", {"a": 0.16}))
                self.sfx.append((ts + per, "land", {"a": 0.12}))
        end = t0 + dur
        for p, v in (("dy", 0), ("sqy", 1), ("sqx", 1)):
            a.tr[p].key(end + 0.001, v, "lin")

    def roll(self, a, x, dur=1.0, radius=88, y=None, tilt=0):
        a = self.actors[a] if isinstance(a, str) else a
        t0 = self.t
        x0 = a.tr["x"].at(t0)
        a.tr["x"].anim(t0, t0 + dur, x, "io")
        if y is not None:
            a.tr["y"].anim(t0, t0 + dur, y, "io")
        a.tr["b"].anim(t0, t0 + dur, a.tr["b"].at(t0) + (x - x0) / radius * 57.3, "io")
        steps = int(dur * FPS)
        for f in range(steps + 1):
            u = f / max(1, steps)
            a.tr["dy"].key(t0 + u * dur, -abs(math.sin(u * math.pi * max(1, abs(x - x0) / 160))) * 10, "lin")
            if tilt:
                a.tr["rot"].key(t0 + u * dur, tilt * math.sin(u * math.pi), "lin")
        a.tr["dy"].key(t0 + dur + 0.001, 0, "lin")
        if tilt:
            a.tr["rot"].key(t0 + dur + 0.001, 0, "lin")

    def slide(self, a, x, y=None, dur=1.0, e="io"):
        a = self.actors[a] if isinstance(a, str) else a
        a.tr["x"].anim(self.t, self.t + dur, x, e)
        if y is not None:
            a.tr["y"].anim(self.t, self.t + dur, y, e)

    def fall(self, a, x, y, dur, spin=360):
        a = self.actors[a] if isinstance(a, str) else a
        a.tr["x"].anim(self.t, self.t + dur, x, "lin")
        a.tr["y"].anim(self.t, self.t + dur, y, "in")
        a.tr["b"].anim(self.t, self.t + dur, a.tr["b"].at(self.t) + spin, "lin")

    def squash(self, a, amt=0.25, dur=0.25):
        a = self.actors[a] if isinstance(a, str) else a
        t0 = self.t
        for p, v0, v1 in (("sqy", 1, 1 - amt), ("sqx", 1, 1 + amt * 0.8)):
            a.tr[p].key(t0, v0, "lin"); a.tr[p].key(t0 + dur * 0.35, v1, "out"); a.tr[p].key(t0 + dur, v0, "back")

    def shiver(self, a, dur=1.0, amt=4):
        a = self.actors[a] if isinstance(a, str) else a
        t0 = self.t
        for f in range(int(dur * FPS) + 1):
            a.tr["rot"].key(t0 + f / FPS, amt * math.sin(f * 2.3), "lin")
        a.tr["rot"].key(t0 + dur + 0.001, 0, "lin")

    # ---- hand
    def hand_to(self, x, y, dur=1.5, curl=None, e="io"):
        self.G["hand_x"].anim(self.t, self.t + dur, x, e)
        self.G["hand_y"].anim(self.t, self.t + dur, y, e)
        if curl is not None:
            self.G["hand_curl"].anim(self.t, self.t + dur, curl, e)

    # ---- dialogue
    def say(self, who, text, mood=None, tts=None, adv=True, gap=0.28, vol=1.0, whisper=False, speed=None,
            caption=True, fade_out=0.0, lip=True):
        a = self.actors[who]
        if mood:
            self.mood(a, mood)
        x = A.tts(tts or text, who, speed)
        if whisper:
            x = A.breathy(x, 0.5, seed=len(text))
            vol *= 0.6
        if fade_out > 0:
            n = len(x); k = int(min(n, fade_out * A.SR))
            x = x.copy(); x[-k:] *= np.linspace(1, 0, k) ** 1.5
        vol *= A.VOICES[who][3]
        dur = len(x) / A.SR
        if lip:
            env = A.lipsync_env(x, FPS)
            for i, v in enumerate(env):
                a.tr["talk"].key(self.t + i / FPS, float(v), "lin")
            a.tr["talk"].key(self.t + dur + 0.04, 0.0, "lin")
        self.voice.append((self.t, x, vol))
        if caption:
            self.caps.append((self.t, self.t + dur + 0.2, who, text))
        if adv:
            self.t += dur + gap
        return dur

    def title(self, text, sub=None, dur=3.0, big=120):
        self.titles.append((self.t, self.t + dur, text, sub, big))

    def card(self, head, lines, dur=4.0):
        self.cards.append((self.t, self.t + dur, head, lines))

    def end(self):
        return self.t


# ------------------------------------------------------------------ rendering
def render_frame(D, f, surface):
    t = f / FPS
    c = surface.getCanvas()
    G = D.G
    c.clear(skia.ColorBLACK)
    cx, cy, cz = G["cx"].at(t), G["cy"].at(t), G["cz"].at(t)
    sk = G["shake"].at(t)
    sx, sy = math.sin(t * 61) * sk, math.cos(t * 47) * sk
    c.save()
    c.translate(W / 2, H / 2)
    c.scale(cz, cz)
    c.translate(-cx + sx, -cy + sy)
    E.draw_world_back(c, t, G)
    E.draw_bottom(c, t, G)
    wins = E.draw_town(c, t, G)
    for a in D.order:
        E.draw_actor(c, a, t)
    if G["hand_vis"].at(t) > 0.5:
        E.draw_hand(c, t, G["hand_x"].at(t), G["hand_y"].at(t), G["hand_curl"].at(t), G["night"].at(t))
    E.world_overlay(c, t, G, wins)
    c.restore()
    E.draw_vignette(c, G, t)
    for (t0, t1, text, sub, big) in D.titles:
        if t0 <= t <= t1:
            al = min(1, (t - t0) / 0.5, (t1 - t) / 0.5)
            E.draw_title(c, text, sub, max(0, al), big)
    for (t0, t1, head, lines) in D.cards:
        if t0 <= t <= t1:
            E.draw_card(c, lines, max(0, min(1, (t - t0) / 0.4, (t1 - t) / 0.4)), head)
    for (t0, t1, who, text) in D.caps:
        if t0 <= t <= t1:
            E.draw_caption(c, CAP_NAMES[who], text, CAP_COLORS[who], min(1, (t - t0) / 0.1, (t1 - t) / 0.1))
            break
    fd = G["fade"].at(t)
    if fd > 0.003:
        c.drawRect(E.R(0, 0, W, H), E.fill((0, 0, 0), fd))
    img = surface.makeImageSnapshot()
    return img.toarray(colorType=skia.kRGBA_8888_ColorType)


_D = None


def _worker(args):
    idx, f0, f1, outdir = args
    surface = skia.Surface(W, H)
    path = os.path.join(outdir, f"part{idx:02d}.mp4")
    p = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{W}x{H}",
                          "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "veryfast", "-crf", "19",
                          "-pix_fmt", "yuv420p", "-g", str(FPS), path], stdin=subprocess.PIPE)
    for f in range(f0, f1):
        p.stdin.write(render_frame(_D, f, surface).tobytes())
    p.stdin.close()
    p.wait()
    return path


def render(D, out_path, workdir, procs=4, frames=None, tail=1.5):
    global _D
    _D = D
    os.makedirs(workdir, exist_ok=True)
    total = D.end() + tail
    nf = frames or int(total * FPS)
    # audio
    mixed = A.mix(D, total)
    wav = os.path.join(workdir, "audio.wav")
    sf.write(wav, mixed, A.SR)
    chunk = math.ceil(nf / (procs * 3))
    jobs = [(i, s, min(nf, s + chunk), workdir) for i, s in enumerate(range(0, nf, chunk))]
    ctx = mp.get_context("fork")
    with ctx.Pool(procs) as pool:
        parts = pool.map(_worker, jobs, chunksize=1)
    lst = os.path.join(workdir, "parts.txt")
    with open(lst, "w") as fh:
        for p in parts:
            fh.write(f"file '{p}'\n")
    subprocess.check_call(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst, "-i", wav,
                           "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", out_path])
    return out_path


def still(D, t, path):
    surface = skia.Surface(W, H)
    arr = render_frame(D, int(t * FPS), surface)
    from PIL import Image
    Image.fromarray(arr[:, :, :3]).save(path)
