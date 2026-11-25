// Личный бот-помощник в Telegram. Отвечает через Claude.
// Инструменты подключаются через registerTool(), пока их нет.
//
// Запуск:
//   TELEGRAM_BOT_TOKEN=... ANTHROPIC_API_KEY=... node bot/index.js
// Необязательно:
//   ALLOWED_CHAT_IDS=123456789   (кто может пользоваться ботом, через запятую)
//   AGENT_MODEL=claude-sonnet-5-5
//
// Автопоиск закупок (zakup.sk.kz): бот сам ищет по расписанию и присылает только НОВЫЕ закупки.
//   TENDERS_NOTIFY_MINUTES=60     как часто искать (0 = выключить), по умолчанию 60
//   TENDERS_CHAT_IDS=...          кому слать (по умолчанию ALLOWED_CHAT_IDS)
//   TENDERS_MIN_PRICE=1500000     сумма от, тг
//   TENDERS_MAX_PRICE=5000000     сумма до, тг
//   TENDERS_PAGES=6               сколько страниц портала просматривать
// Команда /tenders присылает весь текущий список по запросу.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY
const MODEL = process.env.AGENT_MODEL || 'claude-sonnet-5-5'
const ALLOWED = (process.env.ALLOWED_CHAT_IDS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

const MAX_HISTORY = 20
const MAX_TOOL_STEPS = 5
const TG_API = `${process.env.TELEGRAM_API_BASE || 'https://api.telegram.org'}/bot${TG_TOKEN}`

const SYSTEM_PROMPT = `Ты личный помощник пользователя. Отвечай по-русски, коротко и по делу.
Когда пользователь спрашивает, что делать, давай понятный пронумерованный список шагов.
Если чего-то не знаешь, так и скажи, не выдумывай.
Для поиска закупок на портале zakup.sk.kz (товары, запрос ценовых предложений) используй инструмент search_tenders. Не выдумывай тендеры, суммы и ссылки: показывай только то, что вернул инструмент. Если инструмент вернул ошибку, так и скажи.`

// ---- Реестр инструментов -------------------------------------------------
// Чтобы подключить инструмент, вызовите registerTool(definition, run) до запуска:
//   definition: { name, description, input_schema }  (формат Anthropic tools)
//   run: async (input) => строка с результатом
const toolMap = new Map()

export function registerTool(definition, run) {
  toolMap.set(definition.name, { definition, run })
}

// ---- Инструмент: поиск закупок через Playwright (Python) -----------------
// Запускает tenders/zakup_sk.py: он открывает портал в браузере и забирает список объявлений.
// Нужно: Python 3, pip install -r tenders/requirements.txt, playwright install chromium.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PYTHON = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3')

const TENDERS = {
  min: Number(process.env.TENDERS_MIN_PRICE ?? 1500000),
  max: Number(process.env.TENDERS_MAX_PRICE ?? 5000000),
  pages: Number(process.env.TENDERS_PAGES ?? 6),
}

// Запускает Python-коннектор и возвращает разобранный JSON ({ ok, items, error, ... }).
function fetchTenders({ min = TENDERS.min, max = TENDERS.max, pages = TENDERS.pages } = {}) {
  return new Promise(resolve => {
    const args = [
      path.join(ROOT, 'tenders', 'zakup_sk.py'),
      '--price', String(max), '--min-price', String(min), '--pages', String(pages), '--max-items', '200',
    ]
    if (process.env.TENDERS_URL) args.push('--url', process.env.TENDERS_URL)
    if (process.env.TENDERS_HEADED === '1') args.push('--headed')
    const p = spawn(PYTHON, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => p.kill(), 60000 * Math.max(2, pages))
    p.stdout.on('data', d => (out += d))
    p.stderr.on('data', d => (err += d))
    p.on('error', e => {
      clearTimeout(timer)
      resolve({ ok: false, items: [], error: `Не удалось запустить Python (${PYTHON}): ${e.message}` })
    })
    p.on('close', () => {
      clearTimeout(timer)
      try {
        resolve(JSON.parse(out))
      } catch {
        resolve({ ok: false, items: [], error: err.trim().slice(-500) || 'Пустой ответ коннектора' })
      }
    })
  })
}

registerTool(
  {
    name: 'search_tenders',
    description:
      'Ищет опубликованные закупки на zakup.sk.kz: предмет «товар», способ «запрос ценовых предложений». ' +
      'Открывает портал в браузере и возвращает список объявлений или ошибку портала.',
    input_schema: {
      type: 'object',
      properties: {
        min_price: { type: 'number', description: 'Минимальная сумма в тенге (по умолчанию 1500000)' },
        max_price: { type: 'number', description: 'Максимальная сумма в тенге (по умолчанию 5000000)' },
      },
      required: [],
    },
  },
  async input => {
    const res = await fetchTenders({
      min: Number(input?.min_price) >= 0 && input?.min_price !== undefined ? Number(input.min_price) : TENDERS.min,
      max: Number(input?.max_price) > 0 ? Number(input.max_price) : TENDERS.max,
    })
    const items = (res.items || []).map(i => ({
      number: i.number,
      name: i.nameRu,
      sum_tg: i.sumTruNoNds,
      accept_until: i.acceptanceEndDateTime,
    }))
    return JSON.stringify({ ok: res.ok, error: res.error, count: items.length, items })
  },
)

// ---- Автопоиск и рассылка закупок ------------------------------------------
const STATE_FILE = path.join(ROOT, 'bot', '.state', 'tenders-seen.json')

function loadSeen() {
  try {
    return new Set(JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')).ids.map(String))
  } catch {
    return null // файла нет: это первый запуск
  }
}

function saveSeen(set) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
  fs.writeFileSync(STATE_FILE, JSON.stringify({ ids: [...set] }))
}

const fmtSum = n => `${Math.round(n).toLocaleString('ru-RU').replace(/\s/g, ' ')} тг`
function fmtDate(iso) {
  const d = new Date(iso)
  if (isNaN(d)) return '—'
  try {
    return d.toLocaleDateString('ru-RU', { timeZone: 'Asia/Almaty' })
  } catch {
    return d.toLocaleDateString('ru-RU')
  }
}

async function sendTenders(chatId, header, items) {
  await sendText(chatId, header)
  for (let i = 0; i < items.length; i += 8) {
    const text = items
      .slice(i, i + 8)
      .map((t, k) => `${i + k + 1}. ${t.nameRu}\n№${t.number} · ${fmtSum(t.sumTruNoNds)} · приём до ${fmtDate(t.acceptanceEndDateTime)}`)
      .join('\n\n')
    await sendText(chatId, text)
  }
}

let tendersBusy = false
let tendersFailures = 0

// all=false: слать только новые закупки (автопоиск); all=true: весь список (команда /tenders).
async function checkTenders(targets, { all = false } = {}) {
  if (tendersBusy) return
  tendersBusy = true
  try {
    const res = await fetchTenders()
    if (!res.ok) {
      tendersFailures++
      console.error('[tenders]', res.error)
      if (all || tendersFailures === 3) {
        for (const id of targets) await sendText(id, `Не удалось получить закупки: ${res.error}`).catch(() => {})
      }
      return
    }
    tendersFailures = 0

    const seen = loadSeen()
    const first = seen === null
    const items = res.items
    const fresh = all || first ? items : items.filter(i => !seen.has(String(i.id)))
    saveSeen(new Set([...(seen || []), ...items.map(i => String(i.id))]))

    if (!fresh.length) {
      if (all) for (const id of targets) await sendText(id, 'Подходящих закупок не найдено.').catch(() => {})
      return
    }
    const header = all
      ? `Найдено закупок: ${items.length} (товар, запрос ценовых предложений, ${fmtSum(TENDERS.min)} – ${fmtSum(TENDERS.max)})`
      : first
        ? `Первый список закупок: ${fresh.length}`
        : `Новых закупок: ${fresh.length}`
    for (const id of targets) await sendTenders(id, header, fresh).catch(e => console.error('[tenders]', e.message))
  } finally {
    tendersBusy = false
  }
}

function startTenderSchedule() {
  const minutes = process.env.TENDERS_NOTIFY_MINUTES === undefined ? 60 : Number(process.env.TENDERS_NOTIFY_MINUTES)
  const targets = (process.env.TENDERS_CHAT_IDS || ALLOWED.join(',')).split(',').map(s => s.trim()).filter(Boolean)
  if (!(minutes > 0)) return console.log('[tenders] автопоиск выключен')
  if (!targets.length) return console.warn('[tenders] автопоиск выключен: задайте ALLOWED_CHAT_IDS или TENDERS_CHAT_IDS')
  console.log(`[tenders] автопоиск каждые ${minutes} мин, получателей: ${targets.length}`)
  setTimeout(() => checkTenders(targets), 5000)
  setInterval(() => checkTenders(targets), minutes * 60 * 1000)
}

// ---- Claude --------------------------------------------------------------
async function ask(history) {
  const convo = [...history]
  const tools = [...toolMap.values()].map(t => t.definition)

  for (let step = 0; step < MAX_TOOL_STEPS; step++) {
    const body = { model: MODEL, max_tokens: 1024, system: SYSTEM_PROMPT, messages: convo }
    if (tools.length) body.tools = tools

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`)

    const data = await res.json()

    if (data.stop_reason === 'tool_use' && tools.length) {
      convo.push({ role: 'assistant', content: data.content })
      const results = []
      for (const block of data.content) {
        if (block.type !== 'tool_use') continue
        const tool = toolMap.get(block.name)
        let output
        try {
          output = tool ? await tool.run(block.input) : JSON.stringify({ error: `Неизвестный инструмент: ${block.name}` })
        } catch (e) {
          output = JSON.stringify({ error: e.message })
        }
        results.push({ type: 'tool_result', tool_use_id: block.id, content: String(output) })
      }
      convo.push({ role: 'user', content: results })
      continue
    }

    const text = data.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim()
    return text || 'Не получилось сформировать ответ.'
  }
  return 'Не удалось завершить запрос.'
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

async function sendText(chatId, text) {
  // Telegram принимает до 4096 символов в одном сообщении.
  for (let i = 0; i < text.length; i += 4000) {
    await tg('sendMessage', { chat_id: chatId, text: text.slice(i, i + 4000) })
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const histories = new Map()

// История должна начинаться с сообщения пользователя.
function trimHistory(hist) {
  const sliced = hist.slice(-MAX_HISTORY)
  while (sliced.length && sliced[0].role !== 'user') sliced.shift()
  return sliced
}

async function handleMessage(chatId, text) {
  if (text === '/start') {
    return sendText(chatId, `Привет! Напишите, что нужно сделать, и я помогу с планом.\nВаш chat id: ${chatId}\n/tenders — список закупок (товар, запрос ценовых предложений).\n/reset — очистить историю.`)
  }
  if (text === '/tenders') {
    await sendText(chatId, 'Ищу закупки на портале, это займёт около минуты…')
    return checkTenders([chatId], { all: true })
  }
  if (text === '/reset') {
    histories.delete(chatId)
    return sendText(chatId, 'История очищена.')
  }

  const hist = histories.get(chatId) || []
  hist.push({ role: 'user', content: text })

  try {
    const reply = await ask(trimHistory(hist))
    hist.push({ role: 'assistant', content: reply })
    histories.set(chatId, trimHistory(hist))
    await sendText(chatId, reply)
  } catch (e) {
    console.error('[bot] ask failed:', e.message)
    await sendText(chatId, 'Произошла ошибка, попробуйте ещё раз позже.')
  }
}

async function main() {
  if (!TG_TOKEN || !ANTHROPIC_KEY) {
    console.error('Нужны переменные TELEGRAM_BOT_TOKEN и ANTHROPIC_API_KEY')
    process.exit(1)
  }
  if (!ALLOWED.length) {
    console.warn('[bot] ALLOWED_CHAT_IDS не задан: отвечаем любому. Задайте свой chat id.')
  }

  console.log(`Бот запущен, модель ${MODEL}, инструментов: ${toolMap.size}`)
  startTenderSchedule()
  let offset = 0

  while (true) {
    let updates
    try {
      updates = await tg('getUpdates', { offset, timeout: 30 })
    } catch (e) {
      console.error('[bot]', e.message)
      await sleep(5000)
      continue
    }

    for (const update of updates) {
      offset = update.update_id + 1
      const msg = update.message
      if (!msg?.text) continue

      const chatId = String(msg.chat.id)
      if (ALLOWED.length && !ALLOWED.includes(chatId)) {
        if (msg.text === '/start') await sendText(chatId, `Доступ закрыт. Ваш chat id: ${chatId}`).catch(() => {})
        continue
      }

      await handleMessage(chatId, msg.text).catch(e => console.error('[bot]', e.message))
    }
  }
}

main()
