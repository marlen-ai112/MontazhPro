#!/usr/bin/env python3
"""Аватар для Instagram (1080x1080) из кадра видео: лицо по центру, фон слегка размыт.
python3 edit/make_avatar.py input/reels.mp4 output/avatar.jpg --t 7.5
Нужно: edit/models/selfie_segmenter.tflite, mediapipe, opencv.
"""
import argparse, os, subprocess, numpy as np, cv2, mediapipe as mp
from mediapipe.tasks import python as mpt
from mediapipe.tasks.python import vision

ap = argparse.ArgumentParser()
ap.add_argument("video"); ap.add_argument("dst"); ap.add_argument("--t", type=float, required=True)
ap.add_argument("--zoom", type=float, default=2.3, help="сторона кропа = zoom * ширина лица")
ap.add_argument("--blur", type=float, default=14); ap.add_argument("--no-bg", action="store_true")
a = ap.parse_args()
raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", str(a.t), "-i", a.video, "-frames:v", "1",
                      "-f", "image2pipe", "-vcodec", "png", "-"], capture_output=True, check=True).stdout
fr = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
H, W = fr.shape[:2]
if not a.no_bg:
    model = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "selfie_segmenter.tflite")
    seg = vision.ImageSegmenter.create_from_options(vision.ImageSegmenterOptions(
        base_options=mpt.BaseOptions(model_asset_path=model), running_mode=vision.RunningMode.IMAGE,
        output_category_mask=False, output_confidence_masks=True))
    m = seg.segment(mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(fr, cv2.COLOR_BGR2RGB))
                    ).confidence_masks[0].numpy_view().reshape(H, W).astype(np.float32)
    t = np.clip((m - 0.35) / 0.4, 0, 1); t = t * t * (3 - 2 * t); t = cv2.GaussianBlur(t, (0, 0), 3)
    w = (1 - cv2.dilate((t > 0.15).astype(np.uint8), np.ones((21, 21), np.uint8))).astype(np.float32)
    s = a.blur * W / 1080
    num = cv2.GaussianBlur(fr.astype(np.float32) * w[..., None], (0, 0), s)
    den = cv2.GaussianBlur(w, (0, 0), s)[..., None]
    bg = np.where(den > 0.02, num / np.maximum(den, 0.02), cv2.GaussianBlur(fr, (0, 0), s)).astype(np.uint8)
    al = t[..., None]; fr = (fr * al + bg * (1 - al)).astype(np.uint8)
# лицо ищем на уменьшенной копии
sc = 540 / W; sm = cv2.resize(fr, (540, int(H * sc)))
fc = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
fs = fc.detectMultiScale(cv2.cvtColor(sm, cv2.COLOR_BGR2GRAY), 1.1, 6, minSize=(60, 60))
if len(fs) == 0: raise SystemExit("лицо не найдено")
x, y, w_, h_ = max(fs, key=lambda b: b[2]); x, y, w_, h_ = [v / sc for v in (x, y, w_, h_)]
side = int(min(w_ * a.zoom, W, H)); cx, cy = x + w_ / 2, y + h_ / 2 + h_ * 0.06
x0 = int(min(max(cx - side / 2, 0), W - side)); y0 = int(min(max(cy - side / 2, 0), H - side))
out = cv2.resize(fr[y0:y0 + side, x0:x0 + side], (1080, 1080), interpolation=cv2.INTER_LANCZOS4)
os.makedirs(os.path.dirname(os.path.abspath(a.dst)), exist_ok=True)
cv2.imwrite(a.dst, out, [cv2.IMWRITE_JPEG_QUALITY, 95]); print("ok", a.dst, side, "px источник")
os._exit(0)
