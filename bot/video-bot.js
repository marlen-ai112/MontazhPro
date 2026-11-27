// Отдельный Telegram-бот «Видеомонтажёр»: присылаете видео, получаете готовый рилс 9:16.
// Всё бесплатно: ffmpeg, подписи по словам (faster-whisper на сервере), кадрирование по лицу (OpenCV).
//
// Запуск:  VIDEO_BOT_TOKEN=... node bot/video-bot.js
// Настройки:
//   VIDEO_BOT_TOKEN          токен бота от @BotFather (отдельный бот, не основной)
//   VIDEO_ALLOWED_CHAT_IDS   кто может пользоваться (через запятую); если пусто, берётся ALLOWED_CHAT_IDS
//   REELS_WIDTH=720          ускоряет монтаж на слабом сервере (по умолчанию 1080)
//   остальное см. bot/reels.js (STT_LOCAL_MODEL, REELS_MAX_SEC, REELS_DENOISE, REELS_FACE)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeReels, parseCaption, describeResult } from './reels.js'

const TOKEN = process.env.VIDEO_BOT_TOKEN
const BASE = process.env.TELEGRAM_API_BASE || 'https://api.telegram.org'
const ALLOWED = (process.env.VIDEO_ALLOWED_CHAT_IDS || process.env.ALLOWED_CHAT_IDS || '').split(',').map(s => s.trim()).filter(Boolean)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const IN_DIR = path.join(ROOT, 'bot', '.state', 'video-bot-in')
const OUT_DIR = path.join(ROOT, 'bot', '.state', 'video-bot-out')

const HELP = `Я монтирую рилсы из вашего видео, бесплатно.
Пришлите видео (до 20 МБ). Что сделаю:
• вырежу паузы в речи, соберу вертикальный кадр 9:16 (горизонтальное видео кадрирую по лицу);
• добавлю подписи по словам с подсветкой звучащего слова;
• сделаю резкую цветокоррекцию, очищу и выровняю звук, добавлю заголовок.

В подписи к видео можно написать:
• заголовок: просто текст, например «Как выбрать насос»;
• стиль: кино | тёплый | чб | резкий (по умолчанию резкий яркий);
• без субтитров, без нарезки.
Пример подписи: Как выбрать насос, стиль: кино`

async function tg(method, body) {
  const res = await fetch(`${BASE}/bot${TOKEN}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const json = await res.json()
  if (!json.ok) throw new Error(`${method}: ${json.description}`)
  return json.result
}
const say = (chatId, text) => tg('sendMessage', { chat_id: chatId, text: text.slice(0, 4000) })

async function sendVideo(chatId, file, caption) {
  const form = new FormData()
  form.append('chat_id', String(chatId))
  form.append('caption', caption.slice(0, 1000))
  form.append('supports_streaming', 'true')
  form.append('video', new Blob([fs.readFileSync(file)], { type: 'video/mp4' }), path.basename(file))
  const res = await fetch(`${BASE}/bot${TOKEN}/sendVideo`, { method: 'POST', body: form })
  const json = await res.json()
  if (!json.ok) throw new Error(`sendVideo: ${json.description}`)
}

function cleanOld() {
  for (const dir of [IN_DIR, OUT_DIR]) {
    try {
      for (const f of fs.readdirSync(dir)) {
        const fp = path.join(dir, f)
        if (Date.now() - fs.statSync(fp).mtimeMs > 2 * 24 * 3600 * 1000) fs.rmSync(fp, { recursive: true, force: true })
      }
    } catch { /* папки нет */ }
  }
}

// Монтаж идёт по одному: серверу не хватит памяти на несколько роликов сразу.
let chain = Promise.resolve()
let queued = 0

function enqueue(chatId, file, caption) {
  queued++
  const ahead = queued - 1
  if (ahead > 0) say(chatId, `Принял. Перед вами в очереди: ${ahead}. Начну сразу, как освобожусь.`).catch(() => {})
  chain = chain.then(async () => {
    try {
      const opts = parseCaption(caption)
      await say(chatId, `Монтирую: ${opts.cuts ? 'режу паузы, ' : ''}кадр 9:16${opts.title ? `, заголовок «${opts.title}»` : ''}. Это займёт 1–5 минут.`)
      const { file: out, info } = await makeReels(file, { ...opts, workDir: path.join(IN_DIR, `work_${Date.now()}`), out: path.join(OUT_DIR, `reels_${Date.now()}.mp4`) })
      await sendVideo(chatId, out, describeResult(info))
    } catch (e) {
      console.error('[video-bot]', e.message)
      await say(chatId, `Не удалось смонтировать видео: ${String(e.message).slice(0, 300)}`).catch(() => {})
    } finally {
      queued--
      cleanOld()
    }
  })
}

async function handleVideo(chatId, msg) {
  const media = msg.video || msg.video_note || (msg.document?.mime_type?.startsWith('video/') ? msg.document : null)
  if (!media) return say(chatId, 'Пришлите видео. Справка: /help')
  const mb = (media.file_size || 0) / 1024 / 1024
  if (mb > 20) return say(chatId, `Видео ${mb.toFixed(0)} МБ: Telegram не даёт боту скачивать файлы больше 20 МБ. Сожмите видео или отправьте короче.`)
  try {
    const f = await tg('getFile', { file_id: media.file_id })
    const res = await fetch(`${BASE}/file/bot${TOKEN}/${f.file_path}`)
    if (!res.ok) throw new Error(`скачивание: HTTP ${res.status}`)
    fs.mkdirSync(IN_DIR, { recursive: true })
    const file = path.join(IN_DIR, `in_${Date.now()}${path.extname(f.file_path) || '.mp4'}`)
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()))
    enqueue(chatId, file, msg.caption || '')
  } catch (e) {
    await say(chatId, `Не удалось получить видео: ${e.message}`)
  }
}

async function main() {
  if (!TOKEN) {
    // Без токена не падаем (иначе контейнер бесконечно перезапускался бы): просто ждём, пока токен зададут.
    console.log('[video-bot] VIDEO_BOT_TOKEN не задан: бот-монтажёр выключен. Создайте бота в @BotFather и добавьте токен в .env.bot')
    await new Promise(() => {})
  }
  if (!ALLOWED.length) console.warn('[video-bot] VIDEO_ALLOWED_CHAT_IDS не задан: отвечаем любому. Задайте свой chat id.')
  console.log('Бот-монтажёр запущен')
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
      const msg = u.message
      if (!msg) continue
      const chatId = String(msg.chat.id)
      if (ALLOWED.length && !ALLOWED.includes(chatId)) {
        if (msg.text === '/start') await say(chatId, `Доступ закрыт. Ваш chat id: ${chatId}`).catch(() => {})
        continue
      }
      if (msg.text === '/start' || msg.text === '/help') await say(chatId, HELP).catch(() => {})
      else if (msg.text) await say(chatId, 'Пришлите видео, я смонтирую рилс. Справка: /help').catch(() => {})
      else await handleVideo(chatId, msg).catch(e => console.error('[video-bot]', e.message))
    }
  }
}

main()
