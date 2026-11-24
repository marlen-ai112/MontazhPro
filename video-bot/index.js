// Telegram-бот для видеомонтажа с ИИ.
// Вы присылаете клипы/фото и (по желанию) референс, пишете задачу, бот монтирует и присылает видео.
//
// Запуск:
//   TELEGRAM_BOT_TOKEN=... ANTHROPIC_API_KEY=... node video-bot/index.js
// Нужен ffmpeg (ffmpeg и ffprobe в PATH). Необязательно:
//   ALLOWED_CHAT_IDS=123456789   (кто может пользоваться ботом)
//   AGENT_MODEL=claude-sonnet-5-5
//   FONT=путь к .ttf шрифту для подписей

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkTools, probe, analyzeReference, clipThumbs, ensureDir } from './media.js'
import { renderPlan } from './render.js'
import { planEdit } from './agent.js'

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY
const MODEL = process.env.AGENT_MODEL || 'claude-sonnet-5-5'
const ALLOWED = (process.env.ALLOWED_CHAT_IDS || '').split(',').map(s => s.trim()).filter(Boolean)
const BASE = ensureDir(path.join(os.tmpdir(), 'montazh-video-bot'))
const TG_API = `https://api.telegram.org/bot${TG_TOKEN}`
const TG_FILE = `https://api.telegram.org/file/bot${TG_TOKEN}`
const MAX_DOWNLOAD = 20 * 1024 * 1024 // лимит Bot API на скачивание
const MAX_CLIPS = 12

const HELP = `Я монтирую видео.

1. Пришлите клипы или фото (можно несколько).
2. Если есть образец стиля, пришлите видео с подписью «референс».
3. Напишите задачу, например: «сделай динамичный ролик 20 секунд для Reels с подписями».

Я смонтирую и пришлю видео. Потом можно писать правки: «сделай короче», «убери подписи», «чёрно-белое».
Субтитры по речи: добавьте в задачу «с субтитрами» (нужен ключ распознавания речи STT_API_KEY).

Команды: /status — что загружено, /reset — начать заново.
Ограничение Telegram: файлы до 20 МБ.`

const sessions = new Map() // chatId -> { dir, clips[], reference, lastPlan, busy }

function getSession(chatId) {
  let s = sessions.get(chatId)
  if (!s) {
    s = { dir: ensureDir(path.join(BASE, chatId)), clips: [], reference: null, lastPlan: null, busy: false }
    sessions.set(chatId, s)
  }
  return s
}

function resetSession(chatId) {
  const s = sessions.get(chatId)
  if (s) fs.rmSync(s.dir, { recursive: true, force: true })
  sessions.delete(chatId)
}

// ---- Telegram ------------------------------------------------------------
async function tg(method, body) {
  const res = await fetch(`${TG_API}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  if (!json.ok) throw new Error(`${method}: ${json.description}`)
  return json.result
}

const say = (chatId, text) => tg('sendMessage', { chat_id: chatId, text: text.slice(0, 4000) })

async function downloadFile(fileId, dest) {
  const info = await tg('getFile', { file_id: fileId })
  if (info.file_size && info.file_size > MAX_DOWNLOAD) throw new Error('Файл больше 20 МБ, пришлите поменьше')
  const res = await fetch(`${TG_FILE}/${info.file_path}`)
  if (!res.ok) throw new Error(`Не удалось скачать файл (${res.status})`)
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
}

async function sendVideo(chatId, file, caption) {
  const send = async method => {
    const form = new FormData()
    form.append('chat_id', chatId)
    form.append('caption', caption.slice(0, 900))
    form.append(method === 'sendVideo' ? 'video' : 'document', new Blob([fs.readFileSync(file)]), 'montage.mp4')
    if (method === 'sendVideo') form.append('supports_streaming', 'true')
    const res = await fetch(`${TG_API}/${method}`, { method: 'POST', body: form })
    const json = await res.json()
    if (!json.ok) throw new Error(`${method}: ${json.description}`)
  }
  try { await send('sendVideo') } catch { await send('sendDocument') }
}

// ---- Обработка сообщений --------------------------------------------------
const REF_RE = /референс|образец|reference/i

function pickMedia(msg) {
  if (msg.video) return { id: msg.video.file_id, ext: '.mp4' }
  if (msg.video_note) return { id: msg.video_note.file_id, ext: '.mp4' }
  if (msg.animation) return { id: msg.animation.file_id, ext: '.mp4' }
  if (msg.photo?.length) return { id: msg.photo[msg.photo.length - 1].file_id, ext: '.jpg' }
  const d = msg.document
  if (d?.mime_type?.startsWith('video/')) return { id: d.file_id, ext: path.extname(d.file_name || '') || '.mp4' }
  if (d?.mime_type?.startsWith('image/')) return { id: d.file_id, ext: path.extname(d.file_name || '') || '.jpg' }
  return null
}

async function handleMedia(chatId, msg, media) {
  const s = getSession(chatId)
  const isRef = REF_RE.test(msg.caption || '')
  if (!isRef && s.clips.length >= MAX_CLIPS) return say(chatId, `Максимум ${MAX_CLIPS} клипов. Начните заново: /reset`)

  const name = `${isRef ? 'ref' : 'clip'}_${Date.now()}${media.ext}`
  const dest = path.join(s.dir, name)
  await downloadFile(media.id, dest)

  if (isRef) {
    await say(chatId, 'Референс получен, анализирую темп и стиль…')
    s.reference = await analyzeReference(dest, s.dir)
    return say(chatId, `${s.reference.text}\nТеперь пришлите свои клипы и напишите задачу.`)
  }

  const info = await probe(dest)
  info.thumbs = await clipThumbs(info, s.dir, `clip${s.clips.length}`)
  s.clips.push(info)
  return say(chatId, `Клип ${s.clips.length} добавлен (${info.type === 'image' ? 'фото' : info.duration.toFixed(1) + ' с'}). ` +
    'Присылайте ещё или напишите, что смонтировать.')
}

async function handleEdit(chatId, instruction) {
  const s = getSession(chatId)
  if (!s.clips.length) return say(chatId, 'Сначала пришлите клипы или фото, потом напишите задачу.')
  if (s.busy) return say(chatId, 'Предыдущий монтаж ещё идёт, подождите.')
  s.busy = true
  try {
    await say(chatId, 'Составляю план монтажа…')
    const plan = await planEdit(s, instruction)
    s.lastPlan = plan
    await say(chatId, `План: ${plan.summary || 'монтаж по референсу'}\nМонтирую, это может занять до минуты…`)
    const out = await renderPlan(plan, s.clips, s.dir)
    await sendVideo(chatId, out.file, out.plan.summary || 'Готово')
    fs.rmSync(out.dir, { recursive: true, force: true })

    const notes = {
      no_key: 'Субтитры не добавлены: не задан STT_API_KEY (ключ сервиса распознавания речи). См. README.',
      no_speech: 'Субтитры не добавлены: речь в видео не найдена.',
      error: `Субтитры не добавлены: ${out.subtitles.error || 'ошибка распознавания'}`,
    }
    if (notes[out.subtitles.status]) await say(chatId, notes[out.subtitles.status])
    else if (out.subtitles.status === 'ok') await say(chatId, `Субтитры по речи добавлены (${out.subtitles.count} реплик).`)
    else if (plan.subtitles && s.clips.every(c => !c.hasAudio)) await say(chatId, 'Субтитры не добавлены: в клипах нет звука.')
  } finally {
    s.busy = false
  }
}

async function handleMessage(msg) {
  const chatId = String(msg.chat.id)
  if (ALLOWED.length && !ALLOWED.includes(chatId)) {
    if (msg.text === '/start') await say(chatId, `Доступ закрыт. Ваш chat id: ${chatId}`).catch(() => {})
    return
  }

  const text = (msg.text || '').trim()
  if (text === '/start' || text === '/help') return say(chatId, `${HELP}\n\nВаш chat id: ${chatId}`)
  if (text === '/reset') { resetSession(chatId); return say(chatId, 'Всё очищено. Присылайте новые клипы.') }
  if (text === '/status') {
    const s = getSession(chatId)
    return say(chatId, `Клипов: ${s.clips.length}. Референс: ${s.reference ? 'есть' : 'нет'}.`)
  }

  const media = pickMedia(msg)
  if (media) return handleMedia(chatId, msg, media)
  if (text && !text.startsWith('/')) return handleEdit(chatId, text)
}

async function main() {
  if (!TG_TOKEN || !ANTHROPIC_KEY) {
    console.error('Нужны переменные TELEGRAM_BOT_TOKEN и ANTHROPIC_API_KEY')
    process.exit(1)
  }
  if (!checkTools()) {
    console.error('Не найден ffmpeg/ffprobe. Установите ffmpeg и добавьте его в PATH (Windows: winget install ffmpeg).')
    process.exit(1)
  }
  if (!ALLOWED.length) console.warn('[video-bot] ALLOWED_CHAT_IDS не задан: бот отвечает любому. Задайте свой chat id.')
  console.log(`Видеобот запущен, модель ${MODEL}`)

  let offset = 0
  while (true) {
    let updates
    try {
      updates = await tg('getUpdates', { offset, timeout: 30 })
    } catch (e) {
      console.error('[video-bot]', e.message)
      await new Promise(r => setTimeout(r, 5000))
      continue
    }
    for (const u of updates) {
      offset = u.update_id + 1
      if (!u.message) continue
      handleMessage(u.message).catch(async e => {
        console.error('[video-bot]', e.message)
        await say(String(u.message.chat.id), `Ошибка: ${e.message.slice(0, 300)}`).catch(() => {})
      })
    }
  }
}

main()
