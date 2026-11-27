# Автомонтаж Reels

1. Положить исходник в `input/reels.mp4` (и `input/reels.srt`, если есть).
2. `python3 edit/reels_edit.py input/reels.mp4 output/reels_edit.mp4`

Что делает: вырезает паузы, чередует планы (лёгкий наезд), мягкая цветокоррекция,
выравнивание громкости (-14 LUFS), плавные fade in/out. Шумодав не применяется.
Параметры: `--silence-db`, `--min-silence`, `--zoom`, `--no-cut`, `--srt`.
Требуется ffmpeg.
