#!/usr/bin/env bash
# Монтаж рекламного ролика МонтажПро из фотографий сайта (ffmpeg).
#
# Использование:
#   bash video/make_video.sh                      # горизонтальное видео 1920x1080
#   FORMAT=vertical bash video/make_video.sh      # вертикальное 1080x1920 (Reels, Telegram, TikTok)
#   MUSIC=/путь/к/музыке.mp3 bash video/make_video.sh
#   OUT=ролик.mp4 bash video/make_video.sh
#
# Слайды и подписи меняются в массиве SLIDES ниже: "файл|подпись".
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${OUT:-$ROOT/video/montazhpro-promo.mp4}"
FORMAT="${FORMAT:-horizontal}"
MUSIC="${MUSIC:-}"
DUR="${DUR:-3.2}"     # сколько секунд длится слайд
FADE="${FADE:-0.6}"   # длительность перехода
FPS=25
PHONE="+7 964 292-02-80"

FONT="${FONT:-/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf}"
[ -f "$FONT" ] || { echo "Нет шрифта $FONT, задайте FONT=путь_к_ttf"; exit 1; }

if [ "$FORMAT" = "vertical" ]; then W=1080; H=1920; else W=1920; H=1080; fi

SLIDES=(
  "public/Main/main.webp|МонтажПро"
  "public/Main/services_1.webp|Монтажные работы"
  "public/Main/services_3.webp|Электромонтажные работы"
  "public/Main/services_2.webp|Сварочные работы"
  "public/Main/gallery_1.webp|Наши работы"
  "public/Main/gallery_2.webp|Наши работы"
  "public/Main/gallery_3.webp|Наши работы"
  "public/Main/gallery_4.webp|Наши работы"
  "public/Main/gallery_5.webp|Звоните: $PHONE"
)

N=${#SLIDES[@]}
STEP=$(awk -v d="$DUR" -v f="$FADE" 'BEGIN{print d-f}')
FRAMES=$(awk -v d="$DUR" -v f="$FPS" 'BEGIN{printf "%d", d*f}')
TOTAL=$(awk -v n="$N" -v s="$STEP" -v f="$FADE" 'BEGIN{print n*s+f}')

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

INPUTS=()
FILTER=""
i=0
for entry in "${SLIDES[@]}"; do
  file="${entry%%|*}"
  [ -f "$ROOT/$file" ] || { echo "Нет файла $ROOT/$file"; exit 1; }
  INPUTS+=(-i "$ROOT/$file")
  # вписать фото в кадр, добавить плавное приближение
  FILTER+="[$i:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,"
  FILTER+="zoompan=z='min(zoom+0.0007,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${FRAMES}:s=${W}x${H}:fps=${FPS}[v$i];"
  i=$((i+1))
done

# склейка с кроссфейдом
prev="v0"
for ((k=1; k<N; k++)); do
  off=$(awk -v k="$k" -v s="$STEP" 'BEGIN{printf "%.2f", k*s}')
  FILTER+="[$prev][v$k]xfade=transition=fade:duration=${FADE}:offset=${off}[x$k];"
  prev="x$k"
done

# подписи: каждая показывается в своём слайде
FS=$((H / 15))
[ "$FORMAT" = "vertical" ] && FS=$((W / 12))
cur="$prev"
i=0
for entry in "${SLIDES[@]}"; do
  text="${entry#*|}"
  printf '%s' "$text" > "$TMP/t$i.txt"
  start=$(awk -v k="$i" -v s="$STEP" 'BEGIN{printf "%.2f", k*s+0.4}')
  end=$(awk -v k="$i" -v s="$STEP" -v d="$DUR" 'BEGIN{printf "%.2f", k*s+d-0.3}')
  FILTER+="[$cur]drawtext=fontfile=${FONT}:textfile=$TMP/t$i.txt:fontsize=${FS}:fontcolor=white:"
  FILTER+="box=1:boxcolor=black@0.55:boxborderw=28:x=(w-text_w)/2:y=h-text_h-$((H/9)):"
  FILTER+="enable='between(t,${start},${end})'[t$i];"
  cur="t$i"
  i=$((i+1))
done

FILTER="${FILTER%;}"
FILTER+=";[$cur]format=yuv420p[vout]"

AUDIO=()
if [ -n "$MUSIC" ]; then
  [ -f "$MUSIC" ] || { echo "Нет файла музыки $MUSIC"; exit 1; }
  AUDIO=(-stream_loop -1 -i "$MUSIC")
fi

CMD=(ffmpeg -y -hide_banner -loglevel warning "${INPUTS[@]}" "${AUDIO[@]}" -filter_complex "$FILTER" -map "[vout]")
if [ -n "$MUSIC" ]; then
  CMD+=(-map "$N:a" -af "afade=t=out:st=$(awk -v t="$TOTAL" 'BEGIN{print t-1.5}'):d=1.5" -c:a aac -b:a 160k)
fi
CMD+=(-t "$TOTAL" -r "$FPS" -c:v libx264 -preset medium -crf 20 -movflags +faststart "$OUT")

"${CMD[@]}"
echo "Готово: $OUT (длительность ~${TOTAL} c, ${W}x${H})"
