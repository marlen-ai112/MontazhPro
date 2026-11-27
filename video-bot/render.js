// Монтаж по плану: план (структура) -> безопасные команды ffmpeg.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run, ensureDir } from './media.js'
import { textFilters } from './text.js'
import { addSubtitles } from './subtitles.js'

const SIZES = { vertical: [1080, 1920], horizontal: [1920, 1080], square: [1080, 1080] }
export const TRANSITIONS = ['none', 'fade', 'wipeleft', 'wiperight', 'slideleft', 'slideright', 'circleopen', 'dissolve']
export const COLORS = {
  none: '',
  warm: 'eq=saturation=1.15:contrast=1.05,colorbalance=rs=0.08:bs=-0.08',
  cool: 'eq=saturation=1.05,colorbalance=rs=-0.06:bs=0.1',
  bw: 'hue=s=0,eq=contrast=1.1',
  contrast: 'eq=contrast=1.2:saturation=1.2',
}

const MAX_SEGMENTS = 20
const MAX_TOTAL = 90
const FPS = 30

const num = (v, min, max, dflt) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt
}

// Проверка и ограничение плана от Claude. Всё, что не из белого списка, отбрасывается.
export function normalizePlan(plan, clips) {
  const orientation = SIZES[plan.orientation] ? plan.orientation : 'vertical'
  const transition = TRANSITIONS.includes(plan.transition) ? plan.transition : 'fade'
  const color = COLORS[plan.color] !== undefined ? plan.color : 'none'
  const audio = plan.audio === 'mute' ? 'mute' : 'keep'
  const tdur = transition === 'none' ? 0 : num(plan.transition_duration, 0.2, 1.5, 0.5)

  const segments = []
  let total = 0
  for (const s of (plan.segments || []).slice(0, MAX_SEGMENTS)) {
    const clip = clips[Number(s.clip)]
    if (!clip) continue
    let start = clip.type === 'image' ? 0 : num(s.start, 0, Math.max(0, clip.duration - 0.5), 0)
    let duration = num(s.duration, 0.8, 30, 3)
    if (clip.type === 'video') duration = Math.min(duration, Math.max(0.5, clip.duration - start))
    duration = Math.max(duration, tdur * 2 + 0.1)
    if (total + duration > MAX_TOTAL) break
    total += duration - tdur
    segments.push({ clip: Number(s.clip), start, duration })
  }
  if (!segments.length) throw new Error('В плане нет ни одного корректного фрагмента')

  const finalLen = segments.reduce((a, s) => a + s.duration, 0) - tdur * (segments.length - 1)
  const captions = (plan.captions || []).slice(0, 12).map(c => ({
    text: String(c.text || '').slice(0, 90),
    start: num(c.start, 0, finalLen, 0),
    end: num(c.end, 0, finalLen, finalLen),
  })).filter(c => c.text && c.end > c.start)

  const subtitles = plan.subtitles === true && audio === 'keep'
  return { orientation, transition, tdur, color, audio, segments, captions, subtitles, finalLen, summary: String(plan.summary || '').slice(0, 600) }
}

// Шаг 1: каждый фрагмент в одинаковый формат (размер, fps, звук).
async function renderSegment(clip, seg, i, dir, [W, H], plan) {
  const out = path.join(dir, `seg${i}.mp4`)
  const vf = [
    `scale=${W}:${H}:force_original_aspect_ratio=increase`,
    `crop=${W}:${H}`,
    'setsar=1',
    `fps=${FPS}`,
    COLORS[plan.color],
    'format=yuv420p',
  ].filter(Boolean).join(',')

  const args = ['-y', '-hide_banner', '-loglevel', 'error']
  if (clip.type === 'image') args.push('-loop', '1', '-t', String(seg.duration), '-i', clip.path)
  else args.push('-ss', String(seg.start), '-t', String(seg.duration), '-i', clip.path)

  let audioMap = null
  if (plan.audio === 'keep') {
    if (clip.hasAudio) {
      audioMap = '0:a:0'
    } else {
      args.push('-f', 'lavfi', '-t', String(seg.duration), '-i', 'anullsrc=r=44100:cl=stereo')
      audioMap = '1:a:0'
    }
  }
  args.push('-map', '0:v:0')
  if (audioMap) args.push('-map', audioMap, '-af', 'aresample=44100,aformat=channel_layouts=stereo', '-c:a', 'aac', '-b:a', '160k')
  else args.push('-an')
  args.push('-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-t', String(seg.duration), out)

  await run('ffmpeg', args)
  return out
}

// Шаг 2: склейка с переходами, подписи, финальное кодирование.
async function join(files, plan, dir, out, crf, [W, H]) {
  const n = files.length
  const keep = plan.audio === 'keep'
  const args = ['-y', '-hide_banner', '-loglevel', 'error']
  for (const f of files) args.push('-i', f)

  let filter = ''
  let vlabel
  let alabel
  if (n === 1) {
    vlabel = '0:v'
    alabel = keep ? '0:a' : null
  } else if (plan.transition === 'none') {
    filter += files.map((_, i) => `[${i}:v]${keep ? `[${i}:a]` : ''}`).join('')
    filter += `concat=n=${n}:v=1:a=${keep ? 1 : 0}[cv]${keep ? '[ca]' : ''};`
    vlabel = 'cv'
    alabel = keep ? 'ca' : null
  } else {
    const T = plan.tdur
    let acc = plan.segments[0].duration
    let prevV = '0:v'
    let prevA = '0:a'
    for (let k = 1; k < n; k++) {
      const offset = (acc - T).toFixed(3)
      filter += `[${prevV}][${k}:v]xfade=transition=${plan.transition}:duration=${T}:offset=${offset}[v${k}];`
      prevV = `v${k}`
      if (keep) {
        filter += `[${prevA}][${k}:a]acrossfade=d=${T}[a${k}];`
        prevA = `a${k}`
      }
      acc += plan.segments[k].duration - T
    }
    vlabel = prevV
    alabel = keep ? prevA : null
  }

  // подписи: если будут субтитры по речи, подписи уходят наверх, чтобы не перекрываться
  const t = textFilters(vlabel, plan.captions, dir, 'cap', [W, H], plan.subtitles ? 'top' : 'bottom')
  filter += t.filter + `[${t.label}]format=yuv420p[vout]`

  args.push('-filter_complex', filter, '-map', '[vout]')
  if (alabel) args.push('-map', n === 1 ? alabel : `[${alabel}]`, '-c:a', 'aac', '-b:a', '160k')
  else args.push('-an')
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf), '-r', String(FPS), '-movflags', '+faststart', out)
  await run('ffmpeg', args)
}

export async function renderPlan(rawPlan, clips, workDir) {
  const plan = normalizePlan(rawPlan, clips)
  const dir = ensureDir(fs.mkdtempSync(path.join(workDir || os.tmpdir(), 'render-')))
  const size = SIZES[plan.orientation]

  const files = []
  for (let i = 0; i < plan.segments.length; i++) {
    const seg = plan.segments[i]
    files.push(await renderSegment(clips[seg.clip], seg, i, dir, size, plan))
  }

  const out = path.join(dir, 'result.mp4')
  await join(files, plan, dir, out, 21, size)
  // Telegram принимает файлы до 50 МБ: при превышении пережимаем сильнее.
  if (fs.statSync(out).size > 49 * 1024 * 1024) await join(files, plan, dir, out, 29, size)

  // Субтитры по речи (если просили и есть ключ распознавания)
  let subtitles = { status: 'off', count: 0 }
  let file = out
  if (plan.subtitles) {
    subtitles = await addSubtitles(out, size, dir, plan.finalLen)
    file = subtitles.file
    if (fs.statSync(file).size > 49 * 1024 * 1024) {
      // слишком большой файл: пережать сильнее
      const smaller = path.join(dir, 'result_small.mp4')
      await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', file, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-c:a', 'copy', '-movflags', '+faststart', smaller])
      file = smaller
    }
  }
  return { file, dir, plan, subtitles }
}
