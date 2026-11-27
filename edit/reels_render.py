#!/usr/bin/env python3
"""Монтаж вертикального ролика с вшитыми субтитрами (зум не используем — обрежет текст).

- вырезает паузы (по звуку), оставляя короткий воздух
- смена сцены внутри паузы -> плавное растворение (видео + звук)
- смена сцены посреди речи -> короткая вспышка + тихий whoosh (речь не прерывается)
- мягкая цветокоррекция, лёгкая резкость, без шумодава
- 1080x1920, громкость -14 LUFS

python3 edit/reels_render.py input/reels.mp4 output/reels_edit.mp4
"""
import argparse, os, re, subprocess, sys

def sh(cmd):
    r = subprocess.run(cmd, text=True, capture_output=True)
    if r.returncode:
        sys.exit(r.stderr[-3000:])
    return r.stderr + r.stdout

def duration(p):
    return float(sh(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                     "-of", "csv=p=0", p]).strip())

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src"); ap.add_argument("dst")
    ap.add_argument("--min-silence", type=float, default=0.5)
    ap.add_argument("--noise-db", type=float, default=-35)
    ap.add_argument("--pad", type=float, default=0.12)
    ap.add_argument("--xf", type=float, default=0.15, help="длина растворения, c")
    ap.add_argument("--crf", type=int, default=17)
    a = ap.parse_args()
    T = duration(a.src)

    log = sh(["ffmpeg", "-hide_banner", "-i", a.src, "-af",
              f"silencedetect=noise={a.noise_db}dB:d={a.min_silence}", "-vn", "-f", "null", "-"])
    ss = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", log)]
    se = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", log)]
    if len(se) < len(ss): se.append(T)
    sil = list(zip(ss, se))

    log = sh(["ffmpeg", "-hide_banner", "-i", a.src, "-vf",
              "scale=360:-1,select='gt(scene,0.25)',metadata=print:file=-", "-an", "-f", "null", "-"])
    scenes = [float(x) for x in re.findall(r"pts_time:([\d.]+)", log)]

    # сегменты речи
    segs, cur = [], 0.0
    for s, e in sil:
        if s <= 0.01:
            cur = max(0, e - a.pad); continue
        end = min(T, s + a.pad)
        if end - cur > 0.4: segs.append([cur, end])
        cur = max(0, e - a.pad)
    if T - cur > 0.4: segs.append([cur, T])
    segs[-1][1] = min(T, segs[-1][1] + 0.1)

    # тип границы: растворение, если смена сцены попала в вырезанную паузу
    dis = []
    for i in range(len(segs) - 1):
        gap = (segs[i][1], segs[i + 1][0])
        dis.append(any(gap[0] - 0.05 <= t <= gap[1] + 0.05 for t in scenes))
    # смещения сегментов на итоговой шкале
    off, c = [], 0.0
    for k, (s, e) in enumerate(segs):
        if k and dis[k - 1]: c -= a.xf
        off.append(c); c += e - s
    total = c
    # вспышки на сменах сцены внутри сегментов
    flashes = []
    for t in scenes:
        for k, (s, e) in enumerate(segs):
            if s + 0.1 < t < e - 0.1:
                flashes.append(off[k] + t - s)
    print("сегментов:", len(segs), "растворений:", sum(dis), "вспышек:", len(flashes),
          f"длина {T:.1f}->{total:.1f}")

    W, H = 1080, 1920
    f = []
    for k, (s, e) in enumerate(segs):
        f.append(f"[0:v]trim={s:.3f}:{e:.3f},setpts=PTS-STARTPTS,scale={W}:{H}:flags=lanczos,fps=24,setsar=1[v{k}]")
        d = min(0.025, (e - s) / 4)
        f.append(f"[0:a]atrim={s:.3f}:{e:.3f},asetpts=PTS-STARTPTS,aresample=48000,"
                 f"afade=t=in:d={d},afade=t=out:st={e-s-d:.3f}:d={d}[a{k}]")
    # группы между растворениями
    runs, run = [], [0]
    for k in range(1, len(segs)):
        if dis[k - 1]: runs.append(run); run = [k]
        else: run.append(k)
    runs.append(run)
    for r, ks in enumerate(runs):
        f.append("".join(f"[v{k}]" for k in ks) + f"concat=n={len(ks)}:v=1:a=0[rv{r}]")
        f.append("".join(f"[a{k}]" for k in ks) + f"concat=n={len(ks)}:v=0:a=1[ra{r}]")
    vlab, alab = "rv0", "ra0"
    runlen = [sum(segs[k][1] - segs[k][0] for k in ks) for ks in runs]
    acc = runlen[0]
    for r in range(1, len(runs)):
        f.append(f"[{vlab}][rv{r}]xfade=transition=fade:duration={a.xf}:offset={acc-a.xf:.3f}[xv{r}]")
        f.append(f"[{alab}][ra{r}]acrossfade=d={a.xf}[xa{r}]")
        vlab, alab = f"xv{r}", f"xa{r}"
        acc += runlen[r] - a.xf
    # цвет: мягкий контраст/насыщенность + резкость; вспышки; fade in/out
    flash = "+".join(f"0.28*max(0,1-abs(t-{t:.3f})/0.09)" for t in flashes) or "0"
    f.append(f"[{vlab}]eq=contrast=1.05:saturation=1.10:gamma=1.03,"
             f"unsharp=5:5:0.45:5:5:0.0,"
             f"eq=brightness='{flash}':eval=frame,"
             f"fade=t=in:d=0.25,fade=t=out:st={total-0.4:.3f}:d=0.4,format=yuv420p[vout]")
    # whoosh на вспышках и растворениях
    marks = list(flashes) + [off[k] - 0.0 for k in range(1, len(segs)) if dis[k - 1]]
    mix_in = [f"[{alab}]"]
    for i, t in enumerate(marks):
        ms = max(0, int((t - 0.3) * 1000))
        f.append(f"anoisesrc=d=0.6:c=pink:r=48000:a=0.5,highpass=f=500,lowpass=f=7000,"
                 f"afade=t=in:d=0.3,afade=t=out:st=0.3:d=0.3,volume=0.35,"
                 f"adelay={ms}|{ms},apad=whole_dur={total:.3f}[w{i}]")
        mix_in.append(f"[w{i}]")
    f.append("".join(mix_in) + f"amix=inputs={len(mix_in)}:normalize=0:duration=first,"
             f"loudnorm=I=-14:TP=-1.5:LRA=11,afade=t=in:d=0.15,afade=t=out:st={total-0.4:.3f}:d=0.4[aout]")
    os.makedirs(os.path.dirname(os.path.abspath(a.dst)), exist_ok=True)
    fs = a.dst + ".filter.txt"
    open(fs, "w").write(";\n".join(f))
    sh(["ffmpeg", "-y", "-v", "error", "-i", a.src, "-filter_complex_script", fs,
        "-map", "[vout]", "-map", "[aout]", "-c:v", "libx264", "-preset", "medium",
        "-crf", str(a.crf), "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
        "-movflags", "+faststart", a.dst])
    os.remove(fs)
    # второй проход громкости: точно -14 LUFS
    out = sh(["ffmpeg", "-hide_banner", "-i", a.dst, "-vn", "-af",
              "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"])
    import json
    m = json.loads(out[out.rindex("{"):out.rindex("}") + 1])
    tmp = a.dst + ".tmp.mp4"
    sh(["ffmpeg", "-y", "-v", "error", "-i", a.dst, "-c:v", "copy", "-af",
        f"loudnorm=I=-14:TP=-1.5:LRA=11:measured_I={m['input_i']}:measured_TP={m['input_tp']}:"
        f"measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true",
        "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", tmp])
    os.replace(tmp, a.dst)
    print("готово:", a.dst, f"{duration(a.dst):.1f}s")

if __name__ == "__main__":
    main()
