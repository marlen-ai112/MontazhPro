// Монтаж рилс (вертикальное видео 9:16) без ИИ: нарезка пауз, зум-акценты, резкая цветокоррекция,
// заголовок в начале, по желанию субтитры по речи. Всё делает ffmpeg по правилам, платные ключи не нужны
// (субтитры включаются, только если задан ключ распознавания речи STT_API_KEY).
//
// Настройки (необязательно):
//   REELS_MAX_SEC=90      сколько секунд исходника брать (ограничение по памяти и времени)
//   REELS_CRF=21          качество (меньше = лучше и тяжелее)
//   FONT=...              путь к жирному шрифту (по умолчанию DejaVu Sans Bold, там есть кириллица)
//   STT_API_KEY, STT_BASE_URL, STT_MODEL, STT_LANGUAGE  распознавание речи (Whisper-совместимый API, например Groq)
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'

// Размер кадра: REELS_WIDTH=1080 (по умолчанию) или 720 — на слабом сервере монтаж заметно быстрее.
const W = Number(process.env.REELS_WIDTH || 1080)
const H = Math.round((W * 16) / 9 / 2) * 2
const MAX_SEC = Number(process.env.REELS_MAX_SEC || 90)
const CRF = Number(process.env.REELS_CRF || 21)
const FONT = process.env.FONT || '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'

// Запуск без shell: аргументы массивом.
function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    p.stdout.on('data', d => (out += d))
    p.stderr.on('data', d => (err += d))
    p.on('error', reject)
    p.on('close', code => (code === 0 ? resolve({ out, err }) : reject(new Error(`${cmd} завершился с кодом ${code}: ${err.slice(-600)}`))))
  })
}

async function probe(file) {
  const { out } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', file])
  const j = JSON.parse(out)
  const v = (j.streams || []).find(s => s.codec_type === 'video')
  if (!v) throw new Error('В файле нет видео')
  return { width: v.width, height: v.height, duration: Number(j.format?.duration) || 0, hasAudio: (j.streams || []).some(s => s.codec_type === 'audio') }
}

// ---- Стили цветокоррекции (ключ -> фильтры ffmpeg) -----------------------------------
const STYLES = {
  sharp: { label: 'резкий яркий', vf: 'eq=contrast=1.14:saturation=1.35:gamma=0.97:brightness=0.01,curves=preset=medium_contrast,unsharp=5:5:1.1:5:5:0.0,vignette=PI/7' },
  cinema: { label: 'кино', vf: 'eq=contrast=1.1:saturation=0.95,colorbalance=rs=-0.08:gs=-0.02:bs=0.10:rm=0.03:bm=-0.03:rh=0.12:gh=0.04:bh=-0.10,unsharp=5:5:0.7:5:5:0.0,vignette=PI/5' },
  warm: { label: 'тёплый', vf: 'eq=contrast=1.08:saturation=1.25:brightness=0.02,colorbalance=rm=0.05:rh=0.09:bh=-0.08,unsharp=5:5:0.8:5:5:0.0,vignette=PI/8' },
  bw: { label: 'чёрно-белый', vf: 'hue=s=0,eq=contrast=1.25,unsharp=5:5:0.9:5:5:0.0,vignette=PI/6' },
}

// Разбирает подпись к видео: «заголовок: ...», «стиль: кино», «без субтитров», «без нарезки».
// Если ключевых слов нет, вся подпись становится заголовком.
export function parseCaption(text) {
  const t = String(text || '').trim()
  const r = { title: '', style: 'sharp', subtitles: true, cuts: true }
  if (!t) return r
  let rest = t
  const style = rest.match(/стиль\s*[:\-]?\s*(резк\S*|ярк\S*|кино\S*|тепл\S*|тёпл\S*|чб|ч\/б|чёрно\S*|черно\S*)/i)
  if (style) {
    const s = style[1].toLowerCase()
    r.style = /кино/.test(s) ? 'cinema' : /тепл|тёпл/.test(s) ? 'warm' : /чб|ч\/б|чёрно|черно/.test(s) ? 'bw' : 'sharp'
    rest = rest.replace(style[0], '')
  }
  if (/без\s+субтитр/i.test(rest)) { r.subtitles = false; rest = rest.replace(/без\s+субтитр\S*/i, '') }
  if (/без\s+нарезк/i.test(rest)) { r.cuts = false; rest = rest.replace(/без\s+нарезк\S*/i, '') }
  const title = rest.match(/заголовок\s*[:\-]\s*([^\n]+)/i)
  r.title = (title ? title[1] : rest).replace(/[;,]\s*$/g, '').replace(/\s+/g, ' ').trim().slice(0, 80)
  return r
}

// ---- Нарезка: оставляем участки с речью, паузы убираем -------------------------------
async function speechSegments(file, duration) {
  const { err } = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-t', String(duration), '-af', 'silencedetect=noise=-32dB:d=0.4', '-f', 'null', '-']).catch(e => ({ err: e.message }))
  const silences = []
  let start = null
  for (const m of err.matchAll(/silence_(start|end): (-?[\d.]+)/g)) {
    if (m[1] === 'start') start = Math.max(0, Number(m[2]))
    else if (start !== null) { silences.push([start, Number(m[2])]); start = null }
  }
  if (start !== null) silences.push([start, duration])
  // Речь = промежутки между паузами, с небольшим запасом по краям.
  const pad = 0.08
  const segs = []
  let t = 0
  for (const [s, e] of silences) {
    if (s - t > 0.5) segs.push([Math.max(0, t - pad), Math.min(duration, s + pad)])
    t = e
  }
  if (duration - t > 0.5) segs.push([Math.max(0, t - pad), duration])
  return segs
}

// Если пауз нет или нарезка выключена, делим на равные куски (контент не теряется), чтобы чередовать зум-акценты.
function evenChunks(duration, step = 3) {
  const out = []
  for (let t = 0; t < duration - 0.01; t += step) out.push([t, Math.min(duration, t + step)])
  return out
}

function planSegments(auto, duration, cuts) {
  let segs = cuts ? auto : []
  const kept = segs.reduce((a, [s, e]) => a + (e - s), 0)
  // Паузы не найдены (почти всё осталось) или речи нет: режем по времени без потерь.
  if (!segs.length || kept > duration * 0.97) segs = evenChunks(duration)
  // Не более 40 участков: длинные склеиваем крупнее.
  while (segs.length > 40) segs = segs.filter((_, i) => i % 2 === 0).map(([s], i, arr) => [s, arr[i + 1] ? arr[i + 1][0] : duration])
  return segs
}

// Время исходника -> время результата (для субтитров). null, если момент вырезан.
function mapTime(t, segs) {
  let acc = 0
  for (const [s, e] of segs) {
    if (t >= s && t <= e) return acc + (t - s)
    acc += e - s
  }
  return null
}

// ---- Субтитры по речи (необязательно) ---------------------------------------------------
// Распознавание речи: облачное (STT_API_KEY, Whisper-совместимый API) или на самом сервере (faster-whisper, без ключа).
// STT_LOCAL=0 выключает локальное; STT_LOCAL_MODEL=tiny|base|small (base по умолчанию); STT_THREADS=1 — потоки процессора.
const HERE = path.dirname(fileURLToPath(import.meta.url))
const PYTHON = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
let localOk
function localSttAvailable() {
  if (process.env.STT_LOCAL === '0') return false
  if (localOk === undefined) localOk = spawnSync(PYTHON, ['-c', 'import faster_whisper'], { stdio: 'ignore' }).status === 0
  return localOk
}
export const sttConfigured = () => Boolean(process.env.STT_API_KEY) || localSttAvailable()

async function transcribeLocal(audio) {
  const args = [path.join(HERE, 'stt_local.py'), audio]
  // Первый запуск скачивает модель (разово), поэтому ожидание большое.
  const { out } = await new Promise((resolve, reject) => {
    const p = spawn(PYTHON, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let o = ''
    let e = ''
    const timer = setTimeout(() => p.kill(), 10 * 60 * 1000)
    p.stdout.on('data', d => (o += d))
    p.stderr.on('data', d => (e += d))
    p.on('error', reject)
    p.on('close', code => {
      clearTimeout(timer)
      code === 0 ? resolve({ out: o }) : reject(new Error(`локальное распознавание речи: ${e.trim().split('\n').slice(-2).join(' ').slice(0, 300) || `код ${code}`}`))
    })
  })
  return JSON.parse(out || '[]').filter(s => s.text && s.end > s.start)
}

async function transcribe(file, dir) {
  const audio = path.join(dir, 'speech.mp3')
  await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', file, '-t', String(MAX_SEC), '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', audio])
  if (!process.env.STT_API_KEY) return transcribeLocal(audio)
  const form = new FormData()
  form.append('file', new Blob([fs.readFileSync(audio)], { type: 'audio/mpeg' }), 'audio.mp3')
  form.append('model', process.env.STT_MODEL || 'whisper-1')
  form.append('response_format', 'verbose_json')
  form.append('timestamp_granularities[]', 'word')
  form.append('timestamp_granularities[]', 'segment')
  const lang = process.env.STT_LANGUAGE === undefined ? 'ru' : process.env.STT_LANGUAGE
  if (lang) form.append('language', lang)
  const base = (process.env.STT_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
  const res = await fetch(`${base}/audio/transcriptions`, { method: 'POST', headers: { authorization: `Bearer ${process.env.STT_API_KEY}` }, body: form })
  if (!res.ok) throw new Error(`распознавание речи: HTTP ${res.status}`)
  const data = await res.json()
  const allWords = (data.words || []).map(w => ({ start: Number(w.start), end: Number(w.end), text: String(w.word || w.text || '').trim() })).filter(w => w.text)
  return (data.segments || [])
    .map(s => ({ start: Number(s.start), end: Number(s.end), text: String(s.text || '').trim(), words: allWords.filter(w => w.start >= Number(s.start) - 0.05 && w.start < Number(s.end)) }))
    .filter(s => s.text && s.end > s.start)
}

// ---- Подписи по словам (ASS): текущее слово подсвечивается, как в роликах топовых авторов -----------------
const assTime = t => {
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  return `${h}:${String(m).padStart(2, '0')}:${(t % 60).toFixed(2).padStart(5, '0')}`
}
const assSafe = x => String(x).replace(/[{}\\]/g, '').toUpperCase()

// Слова исходника -> слова на смонтированной дорожке (вырезанные участки пропускаются).
function mapWords(parts, segs) {
  const out = []
  for (const p of parts) {
    for (const w of p.words || []) {
      const a = mapTime(w.start + 0.005, segs)
      if (a === null) continue
      let b = mapTime(Math.max(w.start + 0.02, w.end - 0.005), segs)
      if (b === null || b <= a) b = a + 0.12
      out.push({ start: a, end: b, text: w.text })
    }
  }
  return out.sort((x, y) => x.start - y.start)
}

// Группировка слов в строки: конец предложения, пауза, не больше 4 слов и около 22 знаков.
function groupWords(words, maxChars = 22) {
  const lines = []
  let cur = []
  for (const w of words) {
    const prev = cur[cur.length - 1]
    const chars = cur.reduce((n, x) => n + x.text.length + 1, 0) + w.text.length
    if (prev && (/[.!?…]$/.test(prev.text) || w.start - prev.end > 0.45 || cur.length >= 4 || chars > maxChars)) { lines.push(cur); cur = [] }
    cur.push(w)
  }
  if (cur.length) lines.push(cur)
  return lines
}

function buildAss(lines) {
  const size = Math.round(W * 0.07)
  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Word,DejaVu Sans,${size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,${Math.round(size * 0.1)},3,2,${Math.round(W * 0.06)},${Math.round(W * 0.06)},${Math.round(H * 0.22)},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`
  const ev = []
  lines.forEach((line, li) => {
    const nextLineStart = lines[li + 1]?.[0]?.start ?? Infinity
    line.forEach((w, i) => {
      const start = w.start
      const end = i + 1 < line.length ? line[i + 1].start : Math.min(w.end + 0.35, nextLineStart)
      if (end <= start) return
      const text = line.map((x, j) => (j === i ? `{\\c&H00D4FF&\\fscx112\\fscy112}${assSafe(x.text)}{\\r}` : assSafe(x.text))).join(' ')
      ev.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Word,,0,0,0,,${text}`)
    })
  })
  return head + ev.join('\n') + '\n'
}

// ---- Кадрирование по лицу (горизонтальное видео -> вертикальное) ---------------------------------------
// Для каждого фрагмента ищем лицо и ставим кадр так, чтобы говорящий оказался в центре. Нужен opencv (python), иначе кадр по центру.
let cvOk
function faceTrackAvailable() {
  if (process.env.REELS_FACE === '0') return false
  if (cvOk === undefined) cvOk = spawnSync(PYTHON, ['-c', 'import cv2'], { stdio: 'ignore' }).status === 0
  return cvOk
}
async function faceCenters(input, segs, info) {
  const none = segs.map(() => null)
  if (info.width / info.height < 0.8) return none // вертикальное видео не режем
  if (process.env.REELS_FACE_STUB) return segs.map(() => Number(process.env.REELS_FACE_STUB)) // только для проверок
  if (!faceTrackAvailable()) return none
  const times = segs.flatMap(([a, b]) => [a + (b - a) * 0.25, a + (b - a) * 0.5, a + (b - a) * 0.75])
  let found
  try {
    const { out } = await run(PYTHON, [path.join(HERE, 'face_center.py'), input, ...times.map(t => t.toFixed(2))])
    found = JSON.parse(out || '[]')
  } catch {
    return none
  }
  const med = a => { const v = a.filter(x => typeof x === 'number').sort((p, q) => p - q); return v.length ? v[Math.floor(v.length / 2)] : null }
  const per = segs.map((_, i) => med(found.slice(i * 3, i * 3 + 3)))
  let last = med(per)
  return per.map(c => { if (c !== null) last = c; return c ?? last })
}

async function qualityCheck(file) {
  const p = await probe(file)
  let mean = null
  let max = null
  try {
    const { err } = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', '-']).catch(e => ({ err: e.message }))
    mean = Number(err.match(/mean_volume: (-?[\d.]+) dB/)?.[1])
    max = Number(err.match(/max_volume: (-?[\d.]+) dB/)?.[1])
  } catch { /* без измерения громкости */ }
  const warn = []
  if (p.hasAudio && Number.isFinite(max) && max > -0.3) warn.push('возможны перегрузки звука')
  if (p.hasAudio && Number.isFinite(mean) && mean < -30) warn.push('звук очень тихий')
  if (!p.hasAudio) warn.push('нет звука')
  if (p.duration < 1) warn.push('ролик слишком короткий')
  return { width: p.width, height: p.height, duration: Math.round(p.duration * 10) / 10, hasAudio: p.hasAudio, mean: Number.isFinite(mean) ? mean : null, warn }
}

function wrapText(text, width) {
  const lines = []
  let line = ''
  for (const w of String(text).split(/\s+/)) {
    if (line && (line + ' ' + w).length > width) { lines.push(line); line = w } else line = line ? `${line} ${w}` : w
  }
  if (line) lines.push(line)
  return lines.join('\n')
}
const fp = p => p.replace(/\\/g, '/').replace(/:/g, '\\:')

// ---- Главная функция ----------------------------------------------------------------------------
// Возвращает { file, info } (info: что сделано). Бросает ошибку с понятным текстом.
export async function makeReels(input, opts = {}) {
  const { title = '', style = 'sharp', subtitles = true, cuts = true } = opts
  const dir = opts.workDir || path.dirname(input)
  fs.mkdirSync(dir, { recursive: true })
  const info = await probe(input)
  if (!info.duration) throw new Error('Не удалось определить длительность видео')
  const duration = Math.min(info.duration, MAX_SEC)
  const st = STYLES[style] || STYLES.sharp

  // 1. Участки
  const auto = info.hasAudio && cuts ? await speechSegments(input, duration) : []
  const segs = planSegments(auto, duration, cuts && info.hasAudio)
  const total = segs.reduce((a, [s, e]) => a + (e - s), 0)

  // 2. Субтитры (если есть ключ): распознаём исходное аудио и переносим время на смонтированную дорожку
  let cues = []
  let words = []
  let subStatus = 'off'
  if (subtitles && info.hasAudio) {
    if (!sttConfigured()) subStatus = 'no_key'
    else {
      try {
        const parts = await transcribe(input, dir)
        words = mapWords(parts, segs)
        for (const p of parts) {
          const a = mapTime(p.start + 0.02, segs)
          const b = mapTime(Math.max(p.start + 0.05, p.end - 0.02), segs)
          if (a !== null && b !== null && b > a) cues.push({ start: a, end: b, text: p.text })
        }
        subStatus = words.length || cues.length ? 'ok' : 'no_speech'
      } catch (e) {
        subStatus = `error: ${e.message}`
      }
    }
  }

  // 2б. Где лицо говорящего (для умного кадра 9:16)
  const faces = await faceCenters(input, segs, info)
  const scaledW = Math.round((info.width * H) / info.height / 2) * 2

  // 3. Граф фильтров: каждый участок = отдельный вход со своим -ss/-t (память не раздувается)
  const args = ['-y', '-hide_banner', '-loglevel', 'error']
  segs.forEach(([s, e]) => args.push('-ss', s.toFixed(3), '-t', (e - s).toFixed(3), '-i', input))
  let g = ''
  const vl = []
  const al = []
  segs.forEach((_, i) => {
    const zoom = i % 2 === 1 ? `,scale=${Math.round(W * 1.1)}:${Math.round(H * 1.1)},crop=${W}:${H}` : ''
    const cx = faces[i]
    const fit = cx !== null && scaledW > W
      ? `scale=${scaledW}:${H},crop=${W}:${H}:${Math.max(0, Math.min(scaledW - W, Math.round(cx * scaledW - W / 2)))}:0`
      : `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`
    g += `[${i}:v]fps=30,${fit}${zoom},setsar=1[v${i}];`
    vl.push(`[v${i}]`)
    if (info.hasAudio) {
      g += `[${i}:a]aresample=48000,aformat=channel_layouts=stereo[a${i}];`
      al.push(`[a${i}]`)
    }
  })
  g += info.hasAudio
    ? segs.map((_, i) => `${vl[i]}${al[i]}`).join('') + `concat=n=${segs.length}:v=1:a=1[cv][ca];`
    : vl.join('') + `concat=n=${segs.length}:v=1:a=0[cv];`

  // нормализация громкости (для соцсетей) и цветокоррекция
  // голос: срезаем гул, подавляем шум, выравниваем динамику, затем громкость под соцсети. REELS_DENOISE=0 выключает шумоподавление.
  const denoise = process.env.REELS_DENOISE === '0' ? '' : 'afftdn=nf=-28,'
  if (info.hasAudio) g += `[ca]highpass=f=70,${denoise}acompressor=threshold=0.125:ratio=3:attack=5:release=80:makeup=2,loudnorm=I=-14:TP=-1.5:LRA=11[la];`
  g += `[cv]${st.vf},format=yuv420p[g0];`
  let cur = 'g0'

  // заголовок в начале (плавно появляется и исчезает)
  if (title) {
    const tf = path.join(dir, 'title.txt')
    fs.writeFileSync(tf, wrapText(title.toUpperCase(), 16), 'utf8')
    g += `[${cur}]drawtext=fontfile='${fp(FONT)}':textfile='${fp(tf)}':fontsize=84:fontcolor=white:borderw=6:bordercolor=black@0.9:` +
      `box=1:boxcolor=black@0.35:boxborderw=24:line_spacing=10:x=(w-text_w)/2:y=h*0.12:` +
      `alpha='if(lt(t,0.3),t/0.3,if(gt(t,2.6),max(0,(3.0-t)/0.4),1))':enable='lt(t,3.0)'[t0];`
    cur = 't0'
  }
  // подписи по словам (ASS): подсвечивается слово, которое сейчас звучит
  if (words.length) {
    const ass = path.join(dir, 'words.ass')
    fs.writeFileSync(ass, buildAss(groupWords(words)), 'utf8')
    g += `[${cur}]subtitles='${fp(ass)}':fontsdir='${fp(path.dirname(FONT))}'[sw];`
    cur = 'sw'
  } else
  // запасной вариант без точных времён слов: целые фразы
  cues.forEach((c, i) => {
    const sf = path.join(dir, `sub${i}.txt`)
    fs.writeFileSync(sf, wrapText(c.text, 22), 'utf8')
    g += `[${cur}]drawtext=fontfile='${fp(FONT)}':textfile='${fp(sf)}':fontsize=62:fontcolor=white:borderw=5:bordercolor=black:` +
      `line_spacing=8:x=(w-text_w)/2:y=h*0.68:enable='between(t,${c.start.toFixed(2)},${c.end.toFixed(2)})'[s${i}];`
    cur = `s${i}`
  })
  g = g.replace(/;$/, '')

  const out = opts.out || path.join(dir, `reels_${Date.now()}.mp4`)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  const encode = crf => [
    ...args,
    '-filter_complex', g,
    '-map', `[${cur}]`,
    ...(info.hasAudio ? ['-map', '[la]', '-c:a', 'aac', '-b:a', '160k'] : ['-an']),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf), '-r', '30', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out,
  ]
  await run('ffmpeg', encode(CRF))
  // Telegram принимает файлы до 50 МБ: если больше, пережимаем сильнее.
  if (fs.statSync(out).size > 48 * 1024 * 1024) await run('ffmpeg', encode(29))

  const qa = await qualityCheck(out)
  return {
    file: out,
    info: {
      qa,
      faceTracked: faces.filter(c => c !== null).length,
      captions: words.length ? 'по словам' : cues.length ? 'фразами' : 'нет',
      sourceSec: Math.round(info.duration),
      resultSec: Math.round(total),
      segments: segs.length,
      cutSilence: auto.length > 1 && cuts,
      style: st.label,
      title: Boolean(title),
      subtitles: subStatus === 'ok' ? words.length || cues.length : subStatus,
      sizeMb: Math.round((fs.statSync(out).size / 1024 / 1024) * 10) / 10,
    },
  }
}

// Текст отчёта о готовом ролике (для основного бота и бота-монтажёра).
export function describeResult(info, opts = {}) {
  const subs =
    info.subtitles === 'off' ? 'без подписей'
    : info.subtitles === 'no_key' ? 'подписи не добавлены (на сервере нет распознавания речи)'
    : typeof info.subtitles === 'number' ? `подписи ${info.captions} (${info.subtitles})`
    : `подписи: ${info.subtitles}`
  const qa = info.qa || {}
  const check = [
    `${qa.width}×${qa.height}, ${String(qa.duration).replace('.', ',')} с`,
    qa.hasAudio ? `звук ок${qa.mean !== null && qa.mean !== undefined ? `, средняя громкость ${qa.mean} дБ` : ''}` : 'без звука',
  ]
  if (qa.warn?.length) check.push(`⚠ ${qa.warn.join(', ')}`)
  return [
    `✅ Рилс готов: ${info.resultSec} с (было ${info.sourceSec} с), ${info.segments} фрагм., ${info.cutSilence ? 'паузы вырезаны' : 'без вырезания пауз'}.`,
    `Стиль «${info.style}», ${info.title ? 'заголовок есть' : 'без заголовка'}, ${subs}.`,
    `Кадр: ${info.faceTracked ? `по лицу (${info.faceTracked} фрагм.)` : 'по центру'}. Звук очищен и выровнен.`,
    `Проверка: ${check.join(', ')}. ${info.sizeMb} МБ.`,
  ].join('\n')
}
