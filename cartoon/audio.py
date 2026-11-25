"""Voice (Kokoro TTS), sound effects and procedural music for 'The Box'."""
import os, hashlib, math
import numpy as np
import soundfile as sf

SR = 24000
HERE = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.environ.get("KOKORO_DIR", os.path.join(HERE, "models"))
CACHE = os.path.join(HERE, "cache_tts")
os.makedirs(CACHE, exist_ok=True)
_k = None

VOICES = {  # name -> (kokoro voice, speed, lang, volume)
    "kubik": ("am_liam", 0.98, "en-us", 1.0),
    "lime": ("am_puck", 1.08, "en-us", 1.0),
    "tiktak": ("bm_george", 0.9, "en-gb", 1.0),
    "tsap": ("am_onyx", 1.0, "en-us", 1.15),
    "tisha": ("af_nicole", 0.95, "en-us", 0.9),
    "iskra": ("af_nova", 1.12, "en-us", 1.0),
}


def _kokoro():
    global _k
    if _k is None:
        from kokoro_onnx import Kokoro
        _k = Kokoro(os.path.join(MODEL_DIR, "kokoro.onnx"), os.path.join(MODEL_DIR, "voices.bin"))
    return _k


def trim(x, thr=0.012, pad=0.04):
    idx = np.where(np.abs(x) > thr)[0]
    if len(idx) == 0:
        return x
    a = max(0, idx[0] - int(pad * SR))
    b = min(len(x), idx[-1] + int(pad * SR))
    return x[a:b]


def tts(text, who, speed=None):
    voice, sp, lang, _ = VOICES[who]
    sp = speed or sp
    key = hashlib.md5(f"{text}|{voice}|{sp}|{lang}".encode()).hexdigest()
    path = os.path.join(CACHE, key + ".wav")
    if not os.path.exists(path):
        s, sr = _kokoro().create(text, voice=voice, speed=sp, lang=lang)
        assert sr == SR
        sf.write(path, s, sr)
    x, _ = sf.read(path, dtype="float32")
    return trim(x)


def breathy(x, amount=0.35, seed=1):
    rng = np.random.default_rng(seed)
    env = np.abs(x)
    k = int(0.02 * SR)
    env = np.convolve(env, np.ones(k) / k, mode="same")
    noise = rng.standard_normal(len(x)).astype(np.float32)
    noise = np.diff(noise, prepend=0)  # crude high-pass
    return x * 0.45 + noise * env * amount


def lipsync_env(x, fps):
    n = int(math.ceil(len(x) / SR * fps)) + 1
    out = np.zeros(n)
    hop = SR / fps
    for i in range(n):
        seg = x[int(i * hop - hop * 0.6): int(i * hop + hop * 0.9)]
        out[i] = np.sqrt(np.mean(seg ** 2)) if len(seg) else 0
    ref = np.percentile(out[out > 0], 90) if np.any(out > 0) else 1
    out = np.clip(out / (ref * 1.1), 0, 1)
    out = np.convolve(out, [0.25, 0.5, 0.25], mode="same")
    return np.where(out < 0.12, 0, np.clip(out * 1.15, 0.18, 1))


# ----------------------------------------------------------------- synth helpers
def tarr(dur):
    return np.arange(int(dur * SR)) / SR


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def pluck(f, dur=0.6, amp=0.3, bright=1.0):
    t = tarr(dur)
    s = (np.sin(2 * np.pi * f * t) * np.exp(-t * 5.5)
         + 0.35 * bright * np.sin(4 * np.pi * f * t) * np.exp(-t * 9)
         + 0.12 * bright * np.sin(6 * np.pi * f * t) * np.exp(-t * 14))
    att = np.minimum(1, t / 0.004)
    return (s * att * amp).astype(np.float32)


def pad(freqs, dur, amp=0.12, attack=0.8):
    t = tarr(dur)
    s = np.zeros_like(t)
    for f in freqs:
        s += np.sin(2 * np.pi * f * t) + 0.3 * np.sin(2 * np.pi * f * 2.003 * t) + 0.2 * np.sin(2 * np.pi * f * 0.999 * t)
    env = np.minimum(1, t / attack) * np.minimum(1, (dur - t) / attack)
    return (s / max(1, len(freqs)) * env * amp).astype(np.float32)


def put(buf, t, arr, gain=1.0):
    i = int(t * SR)
    if i >= len(buf):
        return
    j = min(len(buf), i + len(arr))
    if i < 0:
        arr = arr[-i:]
        i = 0
        j = min(len(buf), i + len(arr))
    buf[i:j] += arr[: j - i] * gain


def lowpass(x, k):
    return np.convolve(x, np.ones(k) / k, mode="same")


# ----------------------------------------------------------------- sfx
def sfx_hop(a=0.3):
    t = tarr(0.16)
    f = 320 + 340 * (t / 0.16)
    return (np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 18) * a).astype(np.float32)


def sfx_land(a=0.25):
    t = tarr(0.12)
    f = 190 - 90 * (t / 0.12)
    return (np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 24) * a).astype(np.float32)


def sfx_ding(a=0.35, base=1180):
    t = tarr(1.8)
    s = sum(np.sin(2 * np.pi * base * r * t) * np.exp(-t * d) * w
            for r, d, w in ((1, 2.2, 1), (2.76, 3.4, 0.5), (5.4, 5.5, 0.3), (8.9, 8, 0.15)))
    return (s * a / 2).astype(np.float32)


def sfx_creak(dur=2.2, a=0.3):
    t = tarr(dur)
    f = 90 + 60 * np.sin(2 * np.pi * 0.9 * t) + 40 * (t / dur)
    saw = 2 * ((np.cumsum(f) / SR) % 1) - 1
    rng = np.random.default_rng(3)
    n = lowpass(rng.standard_normal(len(t)), 40)
    env = np.minimum(1, t / 0.2) * np.minimum(1, (dur - t) / 0.4)
    s = lowpass(saw, 6) * 0.6 + n * 4
    return (s * env * a).astype(np.float32)


def sfx_rumble(dur=3.0, a=0.35):
    t = tarr(dur)
    rng = np.random.default_rng(5)
    n = lowpass(rng.standard_normal(len(t)), 220) * 18
    env = np.minimum(1, t / 0.6) * np.minimum(1, (dur - t) / 0.8)
    return ((n + np.sin(2 * np.pi * 46 * t) * 0.6) * env * a).astype(np.float32)


def sfx_slam(a=0.6):
    t = tarr(1.0)
    rng = np.random.default_rng(9)
    n = lowpass(rng.standard_normal(len(t)), 30) * 6
    s = np.sin(2 * np.pi * (70 - 35 * t) * t) * np.exp(-t * 6) + n * np.exp(-t * 9)
    return (s * a).astype(np.float32)


def sfx_bzzt(dur=0.5, a=0.22):
    t = tarr(dur)
    rng = np.random.default_rng(11)
    s = np.sign(np.sin(2 * np.pi * 130 * t)) * (0.5 + 0.5 * np.sign(np.sin(2 * np.pi * 37 * t)))
    s += np.diff(rng.standard_normal(len(t)), prepend=0) * 0.4
    env = np.minimum(1, t / 0.01) * np.minimum(1, (dur - t) / 0.05)
    return (s * env * a).astype(np.float32)


def sfx_whoosh(dur=0.9, a=0.3, down=True):
    t = tarr(dur)
    rng = np.random.default_rng(13)
    n = rng.standard_normal(len(t))
    k = 8 if down else 24
    s = lowpass(n, k) * 4
    env = np.sin(np.pi * t / dur) ** 2
    return (s * env * a).astype(np.float32)


def sfx_fall(dur=1.3, a=0.25):
    t = tarr(dur)
    f = 1100 - 750 * (t / dur) ** 0.7
    return (np.sin(2 * np.pi * np.cumsum(f) / SR) * np.minimum(1, t / 0.05) * np.minimum(1, (dur - t) / 0.1) * a).astype(np.float32)


def sfx_splat(a=0.5):
    t = tarr(0.25)
    rng = np.random.default_rng(17)
    n = lowpass(rng.standard_normal(len(t)), 12) * 5
    f = 220 - 120 * (t / 0.25)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 14) + n * np.exp(-t * 20)
    return (s * a).astype(np.float32)


def sfx_grab(a=0.5):
    t = tarr(0.6)
    rng = np.random.default_rng(19)
    n = lowpass(rng.standard_normal(len(t)), 60) * 7
    sq = np.sin(2 * np.pi * (900 + 500 * np.sin(2 * np.pi * 7 * t)) * t) * np.exp(-t * 7) * 0.25
    return ((n * np.exp(-t * 6) + sq) * a).astype(np.float32)


def sfx_twinkle(a=0.2):
    out = np.zeros(int(1.2 * SR), np.float32)
    for i, m in enumerate((84, 88, 91, 96)):
        put(out, i * 0.07, pluck(mtof(m), 0.9, 1.0, 0.4))
    return out * a


def sfx_tick(a=0.3):
    t = tarr(0.06)
    return (np.sin(2 * np.pi * 1700 * t) * np.exp(-t * 90) * a).astype(np.float32)


def sfx_sting(a=0.35):
    out = np.zeros(int(3.0 * SR), np.float32)
    for m in (50, 53, 56, 59):
        put(out, 0, pad([mtof(m), mtof(m + 12)], 3.0, 0.35, 0.05))
    put(out, 0, sfx_slam(0.5))
    return out * a


def sfx_logo(a=0.35):
    out = np.zeros(int(3.0 * SR), np.float32)
    for i, m in enumerate((72, 76, 79, 84)):
        put(out, i * 0.12, pluck(mtof(m), 1.4, 1.0))
    put(out, 0.5, pad([mtof(60), mtof(64), mtof(67), mtof(72)], 2.4, 0.25, 0.05))
    return out * a


SFX = dict(hop=sfx_hop, land=sfx_land, ding=sfx_ding, creak=sfx_creak, rumble=sfx_rumble, slam=sfx_slam,
           bzzt=sfx_bzzt, whoosh=sfx_whoosh, fall=sfx_fall, splat=sfx_splat, grab=sfx_grab, twinkle=sfx_twinkle,
           tick=sfx_tick, sting=sfx_sting, logo=sfx_logo)


# ----------------------------------------------------------------- music
def music_segment(mode, dur):
    out = np.zeros(int(dur * SR), np.float32)
    if mode == "day":
        bpm = 112
        beat = 60 / bpm
        chords = [(60, 64, 67), (57, 60, 64), (53, 57, 60), (55, 59, 62)]
        melody = [
            [(0, 76, 1), (1, 79, .5), (1.5, 76, .5), (2, 74, 1), (3, 72, 1)],
            [(0, 72, 1.5), (1.5, 69, .5), (2, 72, 1), (3, 76, 1)],
            [(0, 77, 1), (1, 76, .5), (1.5, 74, .5), (2, 72, 1), (3, 69, 1)],
            [(0, 67, 1), (1, 71, 1), (2, 74, 1.5), (3.5, 71, .5)],
        ]
        bars = int(dur / (beat * 4)) + 1
        for b in range(bars):
            ch = chords[b % 4]
            t0 = b * beat * 4
            put(out, t0, pluck(mtof(ch[0] - 24), 0.7, 0.35, 0.3))
            put(out, t0 + 2 * beat, pluck(mtof(ch[2] - 24), 0.7, 0.28, 0.3))
            for i in range(8):
                put(out, t0 + i * beat / 2, pluck(mtof(ch[[0, 1, 2, 1, 0, 1, 2, 1][i]] + 12), 0.35, 0.10, 0.6))
            for (bt, m, d) in melody[b % 4]:
                put(out, t0 + bt * beat, pluck(mtof(m), 0.8, 0.17, 0.9))
    elif mode == "tense":
        t = tarr(dur)
        drone = np.sin(2 * np.pi * 55 * t) * 0.25 + np.sin(2 * np.pi * 82.4 * t) * 0.14 + np.sin(2 * np.pi * 110.5 * t) * 0.08
        drone *= 0.7 + 0.3 * np.sin(2 * np.pi * 0.17 * t)
        out += drone.astype(np.float32)
        beat = 1.15
        for i in range(int(dur / beat) + 1):
            put(out, i * beat, sfx_land(0.55))
            put(out, i * beat + 0.22, sfx_land(0.35))
        rng = np.random.default_rng(23)
        for i in range(int(dur / 1.9)):
            put(out, i * 1.9 + rng.uniform(0, 0.8), pluck(mtof(rng.choice([88, 91, 84, 93])), 1.8, 0.05, 0.3))
    elif mode == "warm":
        prog = [(57, 60, 64), (53, 57, 60), (60, 64, 67), (55, 59, 62)]
        seg = 4.0
        for i in range(int(dur / seg) + 1):
            ch = prog[i % 4]
            put(out, i * seg, pad([mtof(m) for m in ch], seg + 0.8, 0.16, 1.0))
            put(out, i * seg, pluck(mtof(ch[0] - 12), 2.5, 0.2, 0.2))
            for j, m in enumerate((ch[2] + 12, ch[1] + 12, ch[2] + 12, ch[0] + 24)):
                put(out, i * seg + 0.5 + j * 0.9, pluck(mtof(m), 1.2, 0.12, 0.5))
    elif mode == "drone":
        t = tarr(dur)
        out += (np.sin(2 * np.pi * 55 * t) * 0.25 + np.sin(2 * np.pi * 58.3 * t) * 0.15).astype(np.float32)
    return out


def echo(x, taps=((0.083, 0.28), (0.151, 0.18), (0.233, 0.1))):
    y = x.copy()
    for d, g in taps:
        k = int(d * SR)
        y[k:] += x[:-k] * g
    return y


def mix(D, total):
    n = int(total * SR) + SR
    voice = np.zeros(n, np.float32)
    for (t, x, vol) in D.voice:
        put(voice, t, x, vol)
    sfx = np.zeros(n, np.float32)
    for (t, name, kw) in D.sfx:
        put(sfx, t, SFX[name](**kw))
    music = np.zeros(n, np.float32)
    for (t0, t1, mode, vol) in D.music:
        seg = music_segment(mode, t1 - t0 + 1.0)
        k = int(0.9 * SR)
        L = int((t1 - t0) * SR)
        env = np.ones(len(seg), np.float32)
        env[:k] = np.linspace(0, 1, k)
        env[L - k:L] = np.linspace(1, 0, k)
        env[L:] = 0
        put(music, t0, seg * env, vol)
    music = echo(music)
    # sidechain: duck music/sfx slightly under voice
    env = np.abs(voice)
    k = int(0.25 * SR)
    env = np.convolve(env, np.ones(k) / k, mode="same")
    duck = 1 - 0.55 * np.clip(env / 0.08, 0, 1)
    duck = np.convolve(duck, np.ones(int(0.2 * SR)) / int(0.2 * SR), mode="same")
    out = voice * 1.0 + music * duck + sfx * (0.6 + 0.4 * duck)
    peak = np.max(np.abs(out))
    out = out / peak * 0.9 if peak > 0.9 else out
    return out.astype(np.float32)
