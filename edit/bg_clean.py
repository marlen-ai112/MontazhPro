#!/usr/bin/env python3
"""Чистка фона: человек остаётся резким, фон мягко размывается и упрощается.
Полоса вшитых субтитров не затрагивается.

python3 edit/bg_clean.py input/reels.mp4 output/reels_bg.mp4
Нужно: pip install mediapipe opencv-python-headless numpy; apt install libegl1 libgles2
Модель: edit/models/selfie_segmenter.tflite
(https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite)
"""
import argparse, subprocess, sys, os
import cv2, numpy as np, mediapipe as mp
from mediapipe.tasks import python as mpt
from mediapipe.tasks.python import vision

ap = argparse.ArgumentParser()
ap.add_argument("src"); ap.add_argument("dst")
ap.add_argument("--blur", type=float, default=11, help="сила размытия фона")
ap.add_argument("--flat", type=float, default=0.12, help="доля упрощения фона к среднему цвету")
ap.add_argument("--sub-band", type=float, nargs=2, default=[0.785, 0.88], help="полоса субтитров (доли высоты)")
ap.add_argument("--crf", type=int, default=13)
a = ap.parse_args()
W, H = 1080, 1920
model = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "selfie_segmenter.tflite")
seg = vision.ImageSegmenter.create_from_options(vision.ImageSegmenterOptions(
    base_options=mpt.BaseOptions(model_asset_path=model),
    running_mode=vision.RunningMode.IMAGE, output_category_mask=False, output_confidence_masks=True))

cap = cv2.VideoCapture(a.src)
fps = cap.get(cv2.CAP_PROP_FPS) or 24
n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
os.makedirs(os.path.dirname(os.path.abspath(a.dst)), exist_ok=True)
ff = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "bgr24",
    "-s", f"{W}x{H}", "-r", str(fps), "-i", "-", "-i", a.src, "-map", "0:v", "-map", "1:a",
    "-c:v", "libx264", "-preset", "fast", "-crf", str(a.crf), "-pix_fmt", "yuv420p",
    "-c:a", "copy", "-shortest", a.dst], stdin=subprocess.PIPE)

# вертикальная маска защиты субтитров с мягкими краями
yy = np.arange(H, dtype=np.float32) / H
y0, y1 = a.sub_band; f = 0.025
band = np.clip((yy - (y0 - f)) / f, 0, 1) * np.clip(((y1 + f) - yy) / f, 0, 1)
band = band[:, None]

prev, prev_frame, i = None, None, 0
while True:
    ok, fr = cap.read()
    if not ok: break
    fr = cv2.resize(fr, (W, H), interpolation=cv2.INTER_AREA)
    # смена сцены: сбрасываем сглаживание маски
    if prev_frame is not None:
        d = cv2.absdiff(cv2.resize(fr, (54, 96)), prev_frame).mean()
        if d > 25: prev = None
    prev_frame = cv2.resize(fr, (54, 96))
    rgb = cv2.cvtColor(fr, cv2.COLOR_BGR2RGB)
    m = seg.segment(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)).confidence_masks[0].numpy_view()
    m = m.reshape(H, W).astype(np.float32)
    if prev is not None: m = 0.6 * m + 0.4 * prev   # временное сглаживание против дрожания
    prev = m
    t = np.clip((m - 0.35) / 0.4, 0, 1); t = t * t * (3 - 2 * t)      # smoothstep
    t = cv2.GaussianBlur(t, (0, 0), 2.5)
    alpha = np.maximum(t, band)[..., None]
    # размытие фона БЕЗ пикселей человека (нормированная свёртка) - нет цветной каймы у контура
    hard = cv2.dilate((t > 0.15).astype(np.uint8), np.ones((15, 15), np.uint8))
    w = (1 - hard).astype(np.float32)
    sm = cv2.resize(fr, (W // 2, H // 2), interpolation=cv2.INTER_AREA).astype(np.float32)
    ws = cv2.resize(w, (W // 2, H // 2), interpolation=cv2.INTER_AREA)
    num = cv2.GaussianBlur(sm * ws[..., None], (0, 0), a.blur / 2)
    den = cv2.GaussianBlur(ws, (0, 0), a.blur / 2)[..., None]
    bgs = np.where(den > 0.02, num / np.maximum(den, 0.02), cv2.GaussianBlur(sm, (0, 0), a.blur / 2))
    bg = cv2.resize(bgs, (W, H), interpolation=cv2.INTER_LINEAR).astype(np.uint8)
    mean = np.full_like(bg, bg.reshape(-1, 3).mean(0).astype(np.uint8))
    bg = cv2.addWeighted(bg, 1 - a.flat, mean, a.flat, 0)
    out = (fr * alpha + bg * (1 - alpha)).astype(np.uint8)
    ff.stdin.write(out.tobytes())
    i += 1
    if i % 200 == 0: print(f"{i}/{n}", flush=True)
ff.stdin.close(); ff.wait()
print("готово:", a.dst)
os._exit(0)
