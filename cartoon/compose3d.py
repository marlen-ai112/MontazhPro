"""Compose rendered 3D frames + 2D overlays (captions, titles, fade) + audio into the final mp4.

usage: python3 compose3d.py FRAMEDIR OUT.mp4 [STEP]
"""
import sys, os, json, subprocess
import numpy as np
import skia
import soundfile as sf
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import engine as E
import audio as A
from director import CAP_COLORS, CAP_NAMES
from episode01 import build

W, H, FPS = E.W, E.H, E.FPS


def main():
    framedir, out = sys.argv[1], sys.argv[2]
    step = int(sys.argv[3]) if len(sys.argv) > 3 else 3
    D = build()
    total = D.end() + 1.5
    nf = int(total * FPS)
    mapping = json.load(open(os.path.join(framedir, "map.json")))
    keys = sorted(int(k) for k in mapping)
    if os.environ.get("PARTIAL"):
        nf = min(nf, int(os.environ["PARTIAL"]))
    wav = os.path.join(framedir, "audio.wav")
    sf.write(wav, A.mix(D, total), A.SR)
    surface = skia.Surface(W, H)
    c = surface.getCanvas()
    cache = {}
    p = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{W}x{H}",
                          "-r", str(FPS), "-i", "-", "-i", wav, "-c:v", "libx264", "-preset", "medium", "-crf", "17",
                          "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", out],
                         stdin=subprocess.PIPE)
    import bisect
    last_img = None
    for f in range(nf):
        t = f / FPS
        k = f - f % step
        src = mapping.get(str(k))
        if src is None:  # not rendered yet (partial run): use latest earlier key
            i = bisect.bisect_right(keys, k) - 1
            src = mapping[str(keys[i])] if i >= 0 else "black"
        c.clear(skia.ColorBLACK)
        if src != "black" and os.path.exists(src):
            if src not in cache:
                cache.clear()
                cache[src] = skia.Image.MakeFromEncoded(skia.Data.MakeFromFileName(src))
            img = cache[src]
            c.drawImageRect(img, skia.Rect.MakeWH(img.width(), img.height()), skia.Rect.MakeWH(W, H),
                            skia.SamplingOptions(skia.FilterMode.kLinear, skia.MipmapMode.kNone))
        # soft vignette
        sh = skia.GradientShader.MakeRadial((W / 2, H / 2), 760, [E.col((0, 0, 0), 0.0), E.col((0, 0, 0), 0.4)], [0.6, 1.0])
        c.drawRect(E.R(0, 0, W, H), E.fill((0, 0, 0), shader=sh))
        for (t0, t1, text, sub, big) in D.titles:
            if t0 <= t <= t1:
                E.draw_title(c, text, sub, max(0, min(1, (t - t0) / 0.5, (t1 - t) / 0.5)), big)
        for (t0, t1, head, lines) in D.cards:
            if t0 <= t <= t1:
                E.draw_card(c, lines, max(0, min(1, (t - t0) / 0.4, (t1 - t) / 0.4)), head)
        for (t0, t1, who, text) in D.caps:
            if t0 <= t <= t1:
                E.draw_caption(c, CAP_NAMES[who], text, CAP_COLORS[who], min(1, (t - t0) / 0.1, (t1 - t) / 0.1))
                break
        fd = D.G["fade"].at(t)
        if fd > 0.003:
            c.drawRect(E.R(0, 0, W, H), E.fill((0, 0, 0), fd))
        p.stdin.write(surface.makeImageSnapshot().toarray(colorType=skia.kRGBA_8888_ColorType).tobytes())
    p.stdin.close()
    p.wait()
    print("done", out)


if __name__ == "__main__":
    main()
