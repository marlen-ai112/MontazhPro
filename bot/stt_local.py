#!/usr/bin/env python3
"""Распознавание речи на самом сервере (faster-whisper), рассчитано на слабый сервер: 1 процессор, 2 ГБ памяти.

Экономия: модель int8, один поток, поиск без перебора вариантов (beam_size=1), тишина пропускается (VAD),
язык задан заранее. Процесс запускается на время распознавания и освобождает память после.
Модель скачивается один раз при первом запуске и хранится в STT_MODEL_DIR (по умолчанию bot/.state/models).

Использование:  python3 bot/stt_local.py audio.mp3 [--model base] [--language ru]
Результат: JSON-массив [{"start":0.0,"end":2.4,"text":"..."}] в stdout.
Модели: tiny (самая лёгкая, хуже понимает русский), base (по умолчанию), small (точнее, но заметно медленнее и тяжелее).
"""
import argparse
import json
import os
import sys


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("audio")
    ap.add_argument("--model", default=os.environ.get("STT_LOCAL_MODEL", "base"))
    ap.add_argument("--language", default=os.environ.get("STT_LANGUAGE", "ru"))
    args = ap.parse_args()

    from faster_whisper import WhisperModel  # импорт здесь: проверка доступности идёт отдельно

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    model_dir = os.environ.get("STT_MODEL_DIR", os.path.join(root, "bot", ".state", "models"))
    os.makedirs(model_dir, exist_ok=True)
    threads = int(os.environ.get("STT_THREADS", "1"))
    model = WhisperModel(args.model, device="cpu", compute_type="int8", cpu_threads=threads, num_workers=1, download_root=model_dir)
    segments, _info = model.transcribe(
        args.audio,
        language=args.language or None,
        beam_size=1,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500},
        condition_on_previous_text=False,
        word_timestamps=True,  # время каждого слова: для подписей с подсветкой слов
    )
    out = []
    for s in segments:
        if not s.text.strip():
            continue
        words = [{"start": float(w.start), "end": float(w.end), "text": w.word.strip()} for w in (getattr(s, "words", None) or []) if w.word.strip()]
        out.append({"start": float(s.start), "end": float(s.end), "text": s.text.strip(), "words": words})
    json.dump(out, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
