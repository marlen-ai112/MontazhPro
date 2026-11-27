// Работа с ffmpeg/ffprobe: запуск, информация о файлах, анализ референса, превью.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp'])

export function isImage(file) {
  return IMAGE_EXT.has(path.extname(file).toLowerCase())
}

export function checkTools() {
  for (const tool of ['ffmpeg', 'ffprobe']) {
    const r = spawnSync(tool, ['-version'], { encoding: 'utf8' })
    if (r.error || r.status !== 0) return false
  }
  return true
}

// Запуск без shell: аргументы передаются массивом, подстановка команд невозможна.
export function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    p.stdout.on('data', d => (stdout += d))
    p.stderr.on('data', d => (stderr += d))
    p.on('error', reject)
    p.on('close', code => {
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`${cmd} завершился с кодом ${code}: ${stderr.slice(-800)}`))
    })
  })
}

// Информация о файле: размеры, длительность, есть ли звук.
export async function probe(file) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration:stream=codec_type,width,height',
    '-of', 'json',
    file,
  ])
  const j = JSON.parse(stdout)
  const video = (j.streams || []).find(s => s.codec_type === 'video')
  const hasAudio = (j.streams || []).some(s => s.codec_type === 'audio')
  const image = isImage(file)
  return {
    path: file,
    type: image ? 'image' : 'video',
    width: video?.width || 0,
    height: video?.height || 0,
    duration: image ? 0 : Number(j.format?.duration) || 0,
    hasAudio: image ? false : hasAudio,
  }
}

// Один кадр в виде jpg заданной ширины.
export async function frameAt(file, time, out, width = 512) {
  await run('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-ss', String(Math.max(0, time)),
    '-i', file,
    '-frames:v', '1',
    '-vf', `scale=${width}:-2`,
    '-q:v', '4',
    out,
  ])
  return out
}

// Превью клипа для Claude: 2 кадра у видео, 1 у фото.
export async function clipThumbs(info, dir, tag) {
  const out = []
  if (info.type === 'image') {
    out.push(await frameAt(info.path, 0, path.join(dir, `${tag}_a.jpg`), 384))
  } else {
    const times = [info.duration * 0.25, info.duration * 0.75]
    for (let i = 0; i < times.length; i++) {
      out.push({ time: times[i], file: await frameAt(info.path, times[i], path.join(dir, `${tag}_${i}.jpg`), 384) })
    }
    return out
  }
  return out.map(file => ({ time: 0, file }))
}

// Анализ референса: темп монтажа (склейки), формат, кадры.
export async function analyzeReference(file, dir) {
  const info = await probe(file)
  const { stderr } = await run('ffmpeg', [
    '-hide_banner', '-i', file,
    '-vf', "select='gt(scene,0.3)',showinfo",
    '-an', '-f', 'null', '-',
  ]).catch(e => ({ stderr: e.message }))

  const cuts = [...stderr.matchAll(/pts_time:([0-9.]+)/g)].map(m => Number(m[1]))
  const bounds = [0, ...cuts.filter(t => t > 0.3 && t < info.duration - 0.3), info.duration]
  const shots = []
  for (let i = 0; i < bounds.length - 1; i++) shots.push([bounds[i], bounds[i + 1]])
  const avgShot = info.duration / Math.max(1, shots.length)

  // до 6 кадров: из середины равномерно выбранных планов
  const picked = []
  const step = Math.max(1, Math.ceil(shots.length / 6))
  for (let i = 0; i < shots.length && picked.length < 6; i += step) picked.push((shots[i][0] + shots[i][1]) / 2)
  const frames = []
  for (let i = 0; i < picked.length; i++) {
    frames.push({ time: picked[i], file: await frameAt(file, picked[i], path.join(dir, `ref_${i}.jpg`)) })
  }

  const orientation = info.width > info.height ? 'горизонтальное' : info.width < info.height ? 'вертикальное' : 'квадратное'
  return {
    info,
    shots: shots.length,
    avgShot,
    frames,
    text:
      `Референс: ${orientation} видео ${info.width}x${info.height}, длительность ${info.duration.toFixed(1)} с, ` +
      `${shots.length} планов, средняя длина плана ${avgShot.toFixed(1)} с, звук: ${info.hasAudio ? 'есть' : 'нет'}.`,
  }
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}
