# Автомонтаж Reels

1. Положить исходник в `input/reels.mp4` (и `input/reels.srt`, если есть).
2. `python3 edit/reels_edit.py input/reels.mp4 output/reels_edit.mp4`

Что делает: вырезает паузы, чередует планы (лёгкий наезд), мягкая цветокоррекция,
выравнивание громкости (-14 LUFS), плавные fade in/out. Шумодав не применяется.
Параметры: `--silence-db`, `--min-silence`, `--zoom`, `--no-cut`, `--srt`.
Требуется ffmpeg.

## Для роликов с вшитыми субтитрами
`python3 edit/reels_render.py input/reels.mp4 output/reels_edit.mp4` — без зума (не режет субтитры):
вырезает паузы, растворение на смене сцены в паузе, вспышка + whoosh на смене сцены в речи,
мягкая цветокоррекция, 1080x1920, -14 LUFS (двухпроходно).
