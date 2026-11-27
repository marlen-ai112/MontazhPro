// Субтитры по речи: звук из готового видео -> распознавание -> наложение текста.
//
// Распознавание идёт через Whisper-совместимый API (OpenAI или Groq и т.п.):
//   STT_API_KEY    ключ (обязателен)
//   STT_BASE_URL   по умолчанию https://api.openai.com/v1  (Groq: https://api.groq.com/openai/v1)
//   STT_MODEL      по умолчанию whisper-1                  (Groq: whisper-large-v3)
//   STT_LANGUAGE   по умолчанию ru (пусто = определять автоматически)
import fs from 'node:fs'
import path from 'node:path'
import { run } from './media.js'
import { textFilters } from './text.js'

const STT_KEY = () => process.env.STT_API_KEY
const STT_BASE = () => (process.env.STT_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
const STT_MODEL = () => process.env.STT_MODEL || 'whisper-1'
const STT_LANG = () => (process.env.STT_LANGUAGE === undefined ? 'ru' : process.env.STT_LANGUAGE)

export const sttConfigured = () => Boolean(STT_KEY())

// Звук из видео в компактный mp3 (для 90 с это меньше 1 МБ).
export async function extractAudio(video, out) {
  await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', video, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', out])
  return out
}

// Возвращает [{start, end, text}].
export async function transcribe(audioFile, totalDuration) {
  const form = new FormData()
  form.append('file', new Blob([fs.readFileSync(audioFile)], { type: 'audio/mpeg' }), 'audio.mp3')
  form.append('model', STT_MODEL())
  form.append('response_format', 'verbose_json')
  if (STT_LANG()) form.append('language', STT_LANG())

  const res = await fetch(`${STT_BASE()}/audio/transcriptions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${STT_KEY()}` },
    body: form,
  })
  if (!res.ok) throw new Error(`Распознавание речи: ${res.status} ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()

  if (Array.isArray(data.segments) && data.segments.length) {
    return data.segments
      .map(s => ({ start: Number(s.start), end: Number(s.end), text: String(s.text || '').trim() }))
      .filter(s => s.text && s.end > s.start)
  }
  // Если сервис не вернул тайминги, растягиваем текст на всю длительность.
  const text = String(data.text || '').trim()
  return text ? [{ start: 0, end: totalDuration, text }] : []
}

// Режет длинные реплики на короткие (до maxChars символов), время делит пропорционально длине.
export function buildCues(segments, maxChars = 42) {
  const cues = []
  for (const seg of segments) {
    const words = seg.text.split(/\s+/).filter(Boolean)
    const chunks = []
    let line = ''
    for (const w of words) {
      if (line && (line + ' ' + w).length > maxChars) { chunks.push(line); line = w } else line = line ? `${line} ${w}` : w
    }
    if (line) chunks.push(line)
    const totalChars = chunks.reduce((a, c) => a + c.length, 0) || 1
    let t = seg.start
    for (const c of chunks) {
      const d = ((seg.end - seg.start) * c.length) / totalChars
      cues.push({ text: c, start: t, end: t + d })
      t += d
    }
  }
  return cues
}

// Накладывает реплики на видео. Звук копируется без перекодирования.
export async function burnSubtitles(video, cues, out, [W, H], dir, crf = 21) {
  const t = textFilters('0:v', cues, dir, 'sub', [W, H], 'subtitle')
  const filter = `${t.filter}[${t.label}]format=yuv420p[vout]`
  await run('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error', '-i', video,
    '-filter_complex', filter, '-map', '[vout]', '-map', '0:a?',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf), '-c:a', 'copy', '-movflags', '+faststart', out,
  ])
  return out
}

// Полный шаг: возвращает { file, status, count }.
// status: ok | no_speech | no_key | error
export async function addSubtitles(video, size, dir, totalDuration, crf = 21) {
  if (!sttConfigured()) return { file: video, status: 'no_key', count: 0 }
  try {
    const audio = await extractAudio(video, path.join(dir, 'speech.mp3'))
    const segments = await transcribe(audio, totalDuration)
    const cues = buildCues(segments, size[0] < size[1] ? 22 : 40)
    if (!cues.length) return { file: video, status: 'no_speech', count: 0 }
    const out = path.join(dir, 'result_sub.mp4')
    await burnSubtitles(video, cues, out, size, dir, crf)
    return { file: out, status: 'ok', count: cues.length }
  } catch (e) {
    return { file: video, status: 'error', count: 0, error: e.message }
  }
}
