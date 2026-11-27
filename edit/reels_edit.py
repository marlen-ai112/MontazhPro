#!/usr/bin/env python3
"""Автомонтаж ролика на ffmpeg: вырезает паузы, чередует планы (лёгкий наезд),
делает цветокоррекцию и выравнивает громкость. Без шумодава.

Использование:
    python3 edit/reels_edit.py input/reels.mp4 output/reels_edit.mp4 [--srt input/reels.srt]
"""
import argparse, os, re, subprocess, sys, tempfile

def run(cmd, capture=False):
    r = subprocess.run(cmd, text=True, capture_output=capture)
    if r.returncode != 0:
        sys.exit(f"ffmpeg error:\n{r.stderr or ''}")
    return r

def duration(path):
    out = run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
               "-of", "csv=p=0", path], True).stdout
    return float(out.strip())

def detect_silence(path, db, min_len):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", path, "-af",
                        f"silencedetect=noise={db}dB:d={min_len}", "-f", "null", "-"],
                       text=True, capture_output=True)
    starts = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", r.stderr)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", r.stderr)]
    return list(zip(starts, ends))

def keep_segments(total, silences, pad, min_seg):
    segs, cur = [], 0.0
    for s, e in silences:
        a, b = cur, min(total, s + pad)
        if b - a >= min_seg:
            segs.append((a, b))
        cur = max(0.0, e - pad)
    if total - cur >= min_seg:
        segs.append((cur, total))
    return segs or [(0.0, total)]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src"); ap.add_argument("dst")
    ap.add_argument("--srt", help="вшить субтитры")
    ap.add_argument("--silence-db", type=float, default=-35)
    ap.add_argument("--min-silence", type=float, default=0.6)
    ap.add_argument("--pad", type=float, default=0.12)
    ap.add_argument("--zoom", type=float, default=1.08, help="наезд на каждом втором плане")
    ap.add_argument("--no-cut", action="store_true", help="не вырезать паузы")
    ap.add_argument("--crf", type=int, default=18)
    a = ap.parse_args()

    total = duration(a.src)
    wh = run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
              "stream=width,height", "-of", "csv=p=0:s=x", a.src], True).stdout.strip()
    W, H = (int(x) // 2 * 2 for x in wh.split("x"))
    segs = [(0.0, total)] if a.no_cut else keep_segments(
        total, detect_silence(a.src, a.silence_db, a.min_silence), a.pad, 0.4)
    print(f"{total:.1f}s -> {sum(e-s for s,e in segs):.1f}s, сегментов: {len(segs)}")

    # мягкая цветокоррекция + чуть резкости, без шумодава
    grade = "eq=contrast=1.06:saturation=1.12:gamma=1.02,unsharp=5:5:0.5:5:5:0.0,vignette=PI/9"
    os.makedirs(os.path.dirname(os.path.abspath(a.dst)), exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        parts = []
        for i, (s, e) in enumerate(segs):
            vf = grade
            if i % 2 == 1 and a.zoom > 1:  # чередование планов
                z = a.zoom
                cw, ch = int(W / z) // 2 * 2, int(H / z) // 2 * 2
                vf = f"crop={cw}:{ch},scale={W}:{H}:flags=lanczos," + vf
            vf = f"scale={W}:{H}," + vf if i % 2 == 0 else vf
            vf += ",setsar=1"
            fade = min(0.03, (e - s) / 4)
            af = f"afade=t=in:d={fade},afade=t=out:st={max(0,e-s-fade):.3f}:d={fade}"
            out = os.path.join(tmp, f"p{i:04d}.mp4")
            run(["ffmpeg", "-y", "-v", "error", "-ss", f"{s:.3f}", "-to", f"{e:.3f}",
                 "-i", a.src, "-vf", vf, "-af", af, "-c:v", "libx264", "-preset", "medium",
                 "-crf", str(a.crf), "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
                 "-ar", "48000", out])
            parts.append(out)
        lst = os.path.join(tmp, "list.txt")
        with open(lst, "w") as f:
            f.writelines(f"file '{p}'\n" for p in parts)
        joined = os.path.join(tmp, "joined.mp4")
        run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", lst,
             "-c", "copy", joined])
        d = duration(joined)
        vf = f"fade=t=in:d=0.4,fade=t=out:st={d-0.5:.2f}:d=0.5"
        if a.srt:  # NB: тайминги .srt относятся к исходнику; при вырезании пауз сдвигаются
            vf += f",subtitles='{a.srt}'"
        # громкость по стандарту соцсетей
        af = f"loudnorm=I=-14:TP=-1.5:LRA=11,afade=t=in:d=0.3,afade=t=out:st={d-0.5:.2f}:d=0.5"
        run(["ffmpeg", "-y", "-v", "error", "-i", joined, "-vf", vf, "-af", af,
             "-c:v", "libx264", "-preset", "medium", "-crf", str(a.crf), "-pix_fmt", "yuv420p",
             "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", a.dst])
    print("готово:", a.dst)

if __name__ == "__main__":
    main()
