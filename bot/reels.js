// Монтаж рилс (вертикальное видео 9:16) без ИИ: нарезка пауз, зум-акценты, резкая цветокоррекция,
// заголовок в начале, по желанию субтитры по речи. Всё делает ffmpeg по правилам, платные ключи не нужны
// (субтитры включаются, только если задан ключ распознавания речи STT_API_KEY).
//
// Настройки (необязательно):
//   REELS_MAX_SEC=90      сколько секунд исходника брать (ограничение по памяти и времени)
//   REELS_CRF=21          качество (меньше = лучше и тяжелее)
//   FONT=...              путь к жирному шрифту (по умолчанию DejaVu Sans Bold, там есть кириллица)
//   STT_API_KEY, STT_BASE_URL, STT_MODEL, STT_LANGUAGE  распознавание речи (Whisper-совместимый API, например Groq)
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const W = 1080
const H = 1920
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
export const sttConfigured = () => Boolean(process.env.STT_API_KEY)

async function transcribe(file, dir) {
  const audio = path.join(dir, 'speech.mp3')
  await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', file, '-t', String(MAX_SEC), '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', audio])
  const form = new FormData()
  form.append('file', new Blob([fs.readFileSync(audio)], { type: 'audio/mpeg' }), 'audio.mp3')
  form.append('model', process.env.STT_MODEL || 'whisper-1')
  form.append('response_format', 'verbose_json')
  const lang = process.env.STT_LANGUAGE === undefined ? 'ru' : process.env.STT_LANGUAGE
  if (lang) form.append('language', lang)
  const base = (process.env.STT_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
  const res = await fetch(`${base}/audio/transcriptions`, { method: 'POST', headers: { authorization: `Bearer ${process.env.STT_API_KEY}` }, body: form })
  if (!res.ok) throw new Error(`распознавание речи: HTTP ${res.status}`)
  const data = await res.json()
  return (data.segments || []).map(s => ({ start: Number(s.start), end: Number(s.end), text: String(s.text || '').trim() })).filter(s => s.text && s.end > s.start)
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
  let subStatus = 'off'
  if (subtitles && info.hasAudio) {
    if (!sttConfigured()) subStatus = 'no_key'
    else {
      try {
        const parts = await transcribe(input, dir)
        for (const p of parts) {
          const a = mapTime(p.start + 0.02, segs)
          const b = mapTime(Math.max(p.start + 0.05, p.end - 0.02), segs)
          if (a !== null && b !== null && b > a) cues.push({ start: a, end: b, text: p.text })
        }
        subStatus = cues.length ? 'ok' : 'no_speech'
      } catch (e) {
        subStatus = `error: ${e.message}`
      }
    }
  }

  // 3. Граф фильтров: каждый участок = отдельный вход со своим -ss/-t (память не раздувается)
  const args = ['-y', '-hide_banner', '-loglevel', 'error']
  segs.forEach(([s, e]) => args.push('-ss', s.toFixed(3), '-t', (e - s).toFixed(3), '-i', input))
  let g = ''
  const vl = []
  const al = []
  segs.forEach((_, i) => {
    const zoom = i % 2 === 1 ? `,scale=${Math.round(W * 1.1)}:${Math.round(H * 1.1)},crop=${W}:${H}` : ''
    g += `[${i}:v]fps=30,scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}${zoom},setsar=1[v${i}];`
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
  if (info.hasAudio) g += '[ca]loudnorm=I=-14:TP=-1.5:LRA=11[la];'
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
  // субтитры: крупно, белым с чёрной обводкой, в нижней трети
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

  return {
    file: out,
    info: {
      sourceSec: Math.round(info.duration),
      resultSec: Math.round(total),
      segments: segs.length,
      cutSilence: auto.length > 1 && cuts,
      style: st.label,
      title: Boolean(title),
      subtitles: subStatus === 'ok' ? cues.length : subStatus,
      sizeMb: Math.round((fs.statSync(out).size / 1024 / 1024) * 10) / 10,
    },
  }
}
