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
import { renderPlan, TRANSITIONS, COLORS } from './render.js'

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

Команды: /status — что загружено, /reset — начать заново.
Ограничение Telegram: файлы до 20 МБ.`

const PLAN_TOOL = {
  name: 'create_edit_plan',
  description: 'Создаёт план монтажа из загруженных клипов.',
  input_schema: {
    type: 'object',
    properties: {
      orientation: { type: 'string', enum: ['vertical', 'horizontal', 'square'] },
      segments: {
        type: 'array',
        description: 'Фрагменты в порядке показа.',
        items: {
          type: 'object',
          properties: {
            clip: { type: 'integer', description: 'Номер клипа из списка (с нуля)' },
            start: { type: 'number', description: 'Начало фрагмента в клипе, сек (для фото 0)' },
            duration: { type: 'number', description: 'Длительность фрагмента, сек' },
          },
          required: ['clip', 'start', 'duration'],
        },
      },
      transition: { type: 'string', enum: TRANSITIONS },
      transition_duration: { type: 'number', description: 'Длительность перехода, 0.2–1.5 сек' },
      color: { type: 'string', enum: Object.keys(COLORS) },
      audio: { type: 'string', enum: ['keep', 'mute'] },
      captions: {
        type: 'array',
        description: 'Подписи; время в итоговом видео.',
        items: {
          type: 'object',
          properties: { text: { type: 'string' }, start: { type: 'number' }, end: { type: 'number' } },
          required: ['text', 'start', 'end'],
        },
      },
      summary: { type: 'string', description: 'Короткое описание монтажа для пользователя, по-русски.' },
    },
    required: ['orientation', 'segments', 'transition', 'color', 'audio', 'captions', 'summary'],
  },
}

const SYSTEM_PROMPT = `Ты видеомонтажёр. По списку клипов, кадрам из них и (если есть) анализу референса составь план монтажа через инструмент create_edit_plan.

Правила:
- Используй только клипы из списка и только внутри их длительности. Не выдумывай клипы.
- Если есть референс, повторяй его темп (длину планов, формат, настроение, стиль подписей и цвет). Если референса нет, ориентируйся на задачу пользователя.
- Формат (orientation) выбирай по референсу или задаче. Для Reels, TikTok, Shorts, Stories это vertical.
- Общая длительность по умолчанию 15–30 секунд, если пользователь не назвал другую. Не больше 60.
- Подписи короткие (до 6 слов), на русском, время указывай по итоговому видео. Не добавляй подписи, если их не просили и референс без текста.
- Если пользователь просит правку к прошлому монтажу, возьми прошлый план за основу и измени только нужное.
- В summary по-русски в 1–2 предложениях опиши, что сделано.`

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

// ---- Claude: план монтажа -------------------------------------------------
const b64 = file => fs.readFileSync(file).toString('base64')
const imageBlock = file => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64(file) } })

async function planEdit(session, instruction) {
  const content = []
  content.push({ type: 'text', text: `Задача пользователя: ${instruction}` })

  if (session.reference) {
    content.push({ type: 'text', text: session.reference.text + '\nКадры референса:' })
    for (const f of session.reference.frames) {
      content.push({ type: 'text', text: `Референс, ${f.time.toFixed(1)} с:` }, imageBlock(f.file))
    }
  } else {
    content.push({ type: 'text', text: 'Референса нет.' })
  }

  content.push({ type: 'text', text: 'Загруженные клипы:' })
  for (const [i, c] of session.clips.entries()) {
    const kind = c.type === 'image' ? 'фото' : `видео ${c.duration.toFixed(1)} с, звук: ${c.hasAudio ? 'есть' : 'нет'}`
    content.push({ type: 'text', text: `Клип ${i}: ${kind}, ${c.width}x${c.height}` })
    for (const t of c.thumbs) {
      content.push({ type: 'text', text: c.type === 'image' ? `Клип ${i}:` : `Клип ${i}, ${t.time.toFixed(1)} с:` }, imageBlock(t.file))
    }
  }

  if (session.lastPlan) {
    content.push({ type: 'text', text: `Прошлый план монтажа (для правок):\n${JSON.stringify(session.lastPlan)}` })
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 3000,
      system: SYSTEM_PROMPT,
      tools: [PLAN_TOOL],
      tool_choice: { type: 'tool', name: PLAN_TOOL.name },
      messages: [{ role: 'user', content }],
    }),
  })
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const data = await res.json()
  const block = data.content.find(b => b.type === 'tool_use')
  if (!block) throw new Error('Claude не вернул план монтажа')
  return block.input
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
