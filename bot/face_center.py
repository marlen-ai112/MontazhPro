#!/usr/bin/env python3
"""Где в кадре лицо говорящего: для умного кадрирования горизонтального видео в вертикальное (9:16).

Берёт несколько кадров в заданные моменты, ищет лица классическим детектором OpenCV (лёгкий, без скачивания моделей)
и возвращает положение центра самого крупного лица как долю ширины кадра (0 = левый край, 1 = правый).

Использование:  python3 bot/face_center.py video.mp4 1.0 2.5 4.0
Результат: JSON [0.41, 0.43, null] (null = лицо не найдено). Нужен пакет opencv-python-headless (версии 4.x).
"""
import json
import sys


def main():
    import cv2

    path = sys.argv[1]
    times = [float(x) for x in sys.argv[2:]]
    cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    if cascade.empty():
        print("[]")
        return
    cap = cv2.VideoCapture(path)
    out = []
    for t in times:
        cap.set(cv2.CAP_PROP_POS_MSEC, max(0.0, t) * 1000)
        ok, frame = cap.read()
        if not ok or frame is None:
            out.append(None)
            continue
        h, w = frame.shape[:2]
        scale = 360.0 / w if w > 360 else 1.0  # на уменьшенном кадре быстрее и достаточно точно
        small = cv2.resize(frame, (int(w * scale), int(h * scale))) if scale != 1.0 else frame
        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
        faces = cascade.detectMultiScale(gray, scaleFactor=1.15, minNeighbors=5, minSize=(max(24, int(gray.shape[1] * 0.05)),) * 2)
        if len(faces) == 0:
            out.append(None)
            continue
        x, y, fw, fh = max(faces, key=lambda f: f[2] * f[3])
        out.append(round((x + fw / 2) / gray.shape[1], 4))
    cap.release()
    print(json.dumps(out))


if __name__ == "__main__":
    main()
