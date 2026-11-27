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
// Приложение «AI-офис» (папка office/): задайте APP_KEY (ключ доступа, от 12 символов) и при необходимости APP_PORT (8787).
// Оно открывается в браузере iPhone по адресу http://IP_сервера:8787 и получает те же результаты, что и Telegram.
// По новым закупкам бот дополнительно присылает точный товар, техническую спецификацию и PDF лотов:
//   TENDERS_DETAILS=0             выключить подробности (только список)
//   TENDERS_DETAILS_MAX=10        сколько закупок за раз разбирать подробно
//   TENDERS_LOTS_FULL=3           у скольких лотов закупки показывать спецификацию текстом (остальные списком)
//   TENDERS_PDF_MAX=5             сколько PDF спецификаций слать на закупку
// Команда /tender 1275177 присылает подробности нужной закупки. Если задан ANTHROPIC_API_KEY, добавляется разбор ИИ.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { track, pushFeed, agents } from './office.js'
import { startApi } from './api.js'
import { makeReels, parseCaption, sttConfigured } from './reels.js'
import { spawnSync } from 'node:child_process'

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY
const MODEL = process.env.AGENT_MODEL || 'claude-sonnet-5-5'
const ALLOWED = (process.env.ALLOWED_CHAT_IDS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

const MAX_HISTORY = 20
const MAX_TOOL_STEPS = 5
const TG_BASE = process.env.TELEGRAM_API_BASE || 'https://api.telegram.org'
const TG_API = `${TG_BASE}/bot${TG_TOKEN}`
// Отдельный бот только для рассылки закупок (необязательно): создайте его в @BotFather, откройте его в Telegram
// и нажмите «Запустить» (иначе Telegram не даст ему писать вам). Команды по-прежнему принимает основной бот.
const TENDERS_BOT_TOKEN = process.env.TENDERS_BOT_TOKEN || ''

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
function fetchTendersRaw({ min = TENDERS.min, max = TENDERS.max, pages = TENDERS.pages } = {}) {
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
  await sendText(chatId, header, 'tenders')
  for (let i = 0; i < items.length; i += 8) {
    const text = items
      .slice(i, i + 8)
      .map((t, k) => {
        const head = `${i + k + 1}. ${t.nameRu}${t.source === 'goszakup' ? ' [госзакупки]' : ''}`
        const line = `№${t.number} · ${t.sumTruNoNds != null ? fmtSum(t.sumTruNoNds) : '—'} · приём до ${fmtDate(t.acceptanceEndDateTime)}`
        return t.source === 'goszakup' ? `${head}\n${line}${t.customer ? `\n${t.customer}` : ''}\n${t.url}` : `${head}\n${line}`
      })
      .join('\n\n')
    await sendText(chatId, text, 'tenders')
  }
}

// ---- Подробности закупки: точный товар и техническая спецификация -----------
// Запускает tenders/zakup_details.py: он открывает карточку закупки, читает лоты и скачивает PDF спецификаций.
const SPECS_DIR = path.join(ROOT, 'bot', '.state', 'specs')
const DETAILS_MAX = Number(process.env.TENDERS_DETAILS_MAX ?? 10) // сколько закупок за раз разбирать подробно
const LOTS_FULL = Number(process.env.TENDERS_LOTS_FULL ?? 3) // у скольких лотов закупки показывать спецификацию текстом
const PDF_MAX = Number(process.env.TENDERS_PDF_MAX ?? 5) // сколько PDF слать на закупку

function fetchDetailsRaw(ids) {
  return new Promise(resolve => {
    const args = [path.join(ROOT, 'tenders', 'zakup_details.py'), '--ids', ids.join(','), '--out-dir', SPECS_DIR]
    if (process.env.TENDERS_HEADED === '1') args.push('--headed')
    const p = spawn(PYTHON, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => p.kill(), 60000 * Math.max(2, ids.length))
    p.stdout.on('data', d => (out += d))
    p.stderr.on('data', d => (err += d))
    p.on('error', e => {
      clearTimeout(timer)
      resolve({ ok: false, tenders: [], error: `Не удалось запустить Python (${PYTHON}): ${e.message}` })
    })
    p.on('close', () => {
      clearTimeout(timer)
      try {
        resolve(JSON.parse(out))
      } catch {
        resolve({ ok: false, tenders: [], error: err.trim().slice(-500) || 'Пустой ответ коннектора' })
      }
    })
  })
}

// Оставляет в тексте спецификации раздел «Описание и требуемые … характеристики».
function specSection(text) {
  if (!text) return ''
  const m = text.search(/\n\s*2\.\s*Описание и требуемые/)
  return (m >= 0 ? text.slice(m) : text).replace(/\n{2,}/g, '\n').trim()
}

// Текст по закупке без ИИ: что именно нужно и какие требования.
function describeTender(t) {
  const lines = [
    `📦 №${t.number} · ${t.name || ''}`,
    `Заказчик: ${t.customer || '—'}`,
    `Сумма: ${t.sum != null ? fmtSum(t.sum) : '—'} · приём до ${fmtDate(t.accept_until)}`,
  ]
  const contacts = [t.customer_phone, t.customer_email].filter(Boolean).join(', ')
  if (contacts) lines.push(`Контакты: ${contacts}`)
  const lots = t.lots || []
  if (lots.length > LOTS_FULL) lines.push('', `Лотов: ${t.lots_total || lots.length}. Подробно разобраны первые ${LOTS_FULL}, остальные списком ниже.`)
  if (t.lots_warning) lines.push(`⚠ ${t.lots_warning}`)
  for (const [i, l] of lots.entries()) {
    if (i >= LOTS_FULL) {
      const prod = l.exact_product?.length ? l.exact_product.map(x => x.trim()).join('; ') : l.name
      lines.push(`${i + 1}. (${l.number}) ${prod} — ${l.quantity ?? '—'} ${l.unit || ''} · ${l.sum != null ? fmtSum(l.sum) : '—'}`)
      continue
    }
    lines.push('', `— Лот ${i + 1} (${l.number}): ${l.name || ''}`)
    lines.push(`ТОЧНЫЙ ТОВАР: ${l.exact_product?.length ? l.exact_product.join('; ') : [l.name, l.brief].filter(Boolean).join(', ')}`)
    if (l.oktru_category) lines.push(`Категория ОКТРУ: ${l.oktru_category}`)
    lines.push(`Количество: ${l.quantity ?? '—'} ${l.unit || ''} · цена за ед. ${l.price_per_unit != null ? fmtSum(l.price_per_unit) : '—'} · всего ${l.sum != null ? fmtSum(l.sum) : '—'}`)
    if (l.delivery) lines.push(`Доставка: ${l.delivery}${l.duration ? ` (срок: ${l.duration})` : ''}`)
    const spec = specSection(l.spec_text)
    if (l.digest_lines?.length) lines.push('', 'Разбор спецификации (по правилам, без ИИ):', ...l.digest_lines)
    else if (spec) lines.push('', 'Техническая спецификация:', spec.slice(0, 1800) + (spec.length > 1800 ? '\n… (полный текст в PDF)' : ''))
    else if (!l.spec_pdf) lines.push('Техническая спецификация: не удалось получить' + (l.spec_error ? ` (${l.spec_error})` : ''))
  }
  return lines.join('\n')
}

// Агент «Спецификации»: читает спецификацию каждого лота и определяет, какой именно товар нужен.
// Нужен ключ Anthropic (ANTHROPIC_API_KEY). Режим расходов задаёт TENDERS_AI:
//   demand (по умолчанию) — ИИ работает только по команде /tender номер, auto — ещё и по каждой новой закупке, off — выключен.
// AGENT_MODEL выбирает модель (дешевле: claude-haiku-5-5). TENDERS_AI_LOTS — сколько лотов разбирать (3).
const AI_MODE = (process.env.TENDERS_AI || 'demand').toLowerCase()
const AI_LOTS = Number(process.env.TENDERS_AI_LOTS ?? 3)

const LOT_TOOL = {
  name: 'lot_analysis',
  description: 'Результат разбора лотов закупки по их спецификациям.',
  input_schema: {
    type: 'object',
    properties: {
      lots: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            lot: { type: 'string', description: 'Номер лота' },
            product: { type: 'string', description: 'Какой именно товар нужен: тип, марка или модель если указаны, главные параметры' },
            key_params: { type: 'array', items: { type: 'string' }, description: 'Обязательные параметры и стандарты, кратко (до 8 пунктов)' },
            analogs: { type: 'string', description: 'Допускаются ли аналоги и на каких условиях; если не указано, так и написать' },
            checks: { type: 'array', items: { type: 'string' }, description: 'Что проверить при поставке: сертификаты, гарантия, срок, упаковка, комплектность (до 5 пунктов)' },
            search_query: { type: 'string', description: 'Короткий запрос (3–8 слов) для поиска этого товара в интернет-магазине, с главным параметром' },
          },
          required: ['lot', 'product', 'key_params', 'analogs', 'checks', 'search_query'],
        },
      },
    },
    required: ['lots'],
  },
}

// Возвращает { text, queries } или null. queries: номер лота -> запрос для поиска цен.
async function analyzeLots(t) {
  if (!ANTHROPIC_KEY) return null
  const lots = (t.lots || []).slice(0, AI_LOTS).filter(l => l.spec_text || l.exact_product?.length)
  if (!lots.length) return null
  const payload = lots.map(l => ({
    lot: String(l.number),
    name: l.name,
    product_from_portal: l.exact_product,
    quantity: `${l.quantity} ${l.unit || ''}`,
    spec: specSection(l.spec_text).slice(0, 5000),
  }))
  try {
    const res = await fetch(`${process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        system:
          'Ты агент «Спецификации» в команде поставщика. По данным закупки определи ТОЧНЫЙ товар, который нужен заказчику, для каждого лота. ' +
          'Опирайся только на текст спецификации и данные портала. Ничего не выдумывай: если марка, модель или условие не указаны, так и напиши. ' +
          'Пиши по-русски кратко. Запрос для поиска делай коротким и с главным параметром, без слов «ГОСТ» и без лишних уточнений.',
        tools: [LOT_TOOL],
        tool_choice: { type: 'tool', name: 'lot_analysis' },
        messages: [{ role: 'user', content: `Закупка: ${t.name}\n${JSON.stringify(payload)}` }],
      }),
    })
    if (!res.ok) throw new Error(`Anthropic ${res.status}`)
    const data = await res.json()
    const out = data.content.find(b => b.type === 'tool_use')?.input?.lots
    if (!Array.isArray(out) || !out.length) throw new Error('пустой ответ модели')
    const queries = {}
    const blocks = out.map(r => {
      if (r.search_query) queries[String(r.lot)] = String(r.search_query).trim()
      const list = (a, label) => (a?.length ? `${label}: ${a.join('; ')}` : '')
      return [
        `Лот ${r.lot}: ${r.product}`,
        list(r.key_params, 'Параметры'),
        r.analogs ? `Аналоги: ${r.analogs}` : '',
        list(r.checks, 'Проверить'),
        r.search_query ? `Запрос для поиска цен: ${r.search_query}` : '',
      ].filter(Boolean).join('\n')
    })
    return { text: `🔎 Разбор агента «Спецификации»:\n\n${blocks.join('\n\n')}`, queries }
  } catch (e) {
    console.error('[tenders] разбор лота не удался:', e.message)
    return { text: `Агент «Спецификации» не смог разобрать лоты: ${e.message}`, queries: {} }
  }
}

async function sendDocument(chatId, filePath, caption) {
  if (chatId === 'app') return void pushFeed('specs', caption || 'Файл', { name: path.basename(filePath), url: `/files/${encodeURIComponent(path.basename(filePath))}` })
  const via2 = String(chatId).match(/^t2:(.+)$/)
  const token = via2 && TENDERS_BOT_TOKEN ? TENDERS_BOT_TOKEN : TG_TOKEN
  const form = new FormData()
  form.append('chat_id', String(via2 ? via2[1] : chatId))
  if (caption) form.append('caption', caption.slice(0, 1000))
  form.append('document', new Blob([fs.readFileSync(filePath)], { type: 'application/pdf' }), path.basename(filePath))
  const res = await fetch(`${TG_BASE}/bot${token}/sendDocument`, { method: 'POST', body: form })
  const json = await res.json()
  if (!json.ok) throw new Error(`sendDocument: ${json.description}`)
}

// Разбирает закупки подробно и шлёт каждому получателю: описание, спецификацию и PDF.
async function sendDetails(targets, ids, { ai: useAi = false } = {}) {
  if (!ids.length) return
  const list = ids.slice(0, DETAILS_MAX)
  const res = await fetchDetails(list)
  if (!res.ok) {
    console.error('[tenders] подробности:', res.error)
    for (const id of targets) await sendText(id, `Не удалось получить подробности закупок: ${res.error}`, 'specs').catch(() => {})
    return
  }
  for (const t of res.tenders) {
    if (!t.ok) {
      for (const id of targets) await sendText(id, `№${t.id}: подробности недоступны (${t.error})`, 'specs').catch(() => {})
      continue
    }
    const analysis = useAi && ANTHROPIC_KEY && AI_MODE !== 'off' ? await track('specs', 'ИИ разбирает лот', analyzeLots(t)) : null
    const prices = await lotPriceBlocks(t, analysis?.queries)
    for (const id of targets) {
      await sendText(id, describeTender(t), 'specs').catch(e => console.error('[tenders]', e.message))
      if (analysis?.text) await sendText(id, analysis.text, 'specs').catch(() => {})
      else if (useAi && (!ANTHROPIC_KEY || AI_MODE === 'off')) await sendText(id, 'Разбор агента «Спецификации» выключен: не задан ключ ANTHROPIC_API_KEY (или TENDERS_AI=off).', 'specs').catch(() => {})
      for (const pb of prices) await sendText(id, pb, 'prices').catch(() => {})
      for (const l of (t.lots || []).slice(0, PDF_MAX)) {
        if (l.spec_pdf) await sendDocument(id, l.spec_pdf, `Техническая спецификация, лот ${l.number}`).catch(e => console.error('[tenders]', e.message))
      }
    }
  }
  if (ids.length > list.length) {
    const rest = ids.length - list.length
    for (const id of targets) await sendText(id, `Ещё ${rest} закупок не разобраны подробно. Пришлите /tender <номер>, чтобы получить спецификацию нужной.`, 'specs').catch(() => {})
  }
}

// ---- Цены на товар и маржа ------------------------------------------------------
// tenders/prices.py ищет товар на Satu.kz; бот считает маржу относительно цены заказчика.
//   TENDERS_PRICES=0         выключить поиск цен
//   TENDER_TAX_PERCENT=3     налог, % от выручки (уточните у бухгалтера: зависит от режима ИП)
//   TENDER_EXTRA_PERCENT=5   доставка и прочие расходы, % от выручки
//   TENDERS_PRICE_LOTS=5     для скольких лотов закупки искать цены
const TAX = Number(process.env.TENDER_TAX_PERCENT ?? 3) / 100
const EXTRA = Number(process.env.TENDER_EXTRA_PERCENT ?? 5) / 100
const PRICE_LOTS = Number(process.env.TENDERS_PRICE_LOTS ?? 5)

function fetchPricesRaw(queries) {
  return new Promise(resolve => {
    const args = [path.join(ROOT, 'tenders', 'prices.py')]
    for (const q of queries) args.push('--query', q)
    if (process.env.TENDERS_HEADED === '1') args.push('--headed')
    const p = spawn(PYTHON, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => p.kill(), 60000 * Math.max(2, queries.length))
    p.stdout.on('data', d => (out += d))
    p.stderr.on('data', d => (err += d))
    p.on('error', e => {
      clearTimeout(timer)
      resolve({ ok: false, results: [], error: `Не удалось запустить Python (${PYTHON}): ${e.message}` })
    })
    p.on('close', () => {
      clearTimeout(timer)
      try {
        resolve(JSON.parse(out))
      } catch {
        resolve({ ok: false, results: [], error: err.trim().slice(-300) || 'Пустой ответ' })
      }
    })
  })
}

const median = a => {
  const s = [...a].sort((x, y) => x - y)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// Запрос для поиска цен: точное название товара из лота.
const priceQuery = l => (l.exact_product?.length ? l.exact_product[0] : [l.name, l.brief].filter(Boolean).join(' ')).trim()

// Считает маржу и возвращает текст по лоту. res — результат prices.py по этому лоту.
function priceBlock(lot, res) {
  if (!res) return ''
  if (!res.ok) return `💰 Цены: не удалось получить (${res.error || 'нет данных'})`
  const similar = res.offers.filter(o => o.relevance >= 0.6)
  // Сначала точные совпадения (все слова и числа запроса); если их нет, берём похожие и предупреждаем.
  const exact = similar.filter(o => o.relevance >= 0.99)
  const rel = exact.length ? exact : similar
  const approx = !exact.length
  if (!rel.length) return `💰 Цены Satu.kz по запросу «${res.used_query}»: подходящих товаров не найдено. Нужен ручной поиск или уточнение модели.`
  // Отсекаем явные ошибки в данных магазина (цена в разы ниже или выше типичной).
  const med0 = median(rel.map(o => o.price))
  const clean = rel.length >= 3 ? rel.filter(o => o.price >= med0 * 0.2 && o.price <= med0 * 5) : rel
  const dropped = rel.length - clean.length
  const prices = clean.map(o => o.price)
  const min = Math.min(...prices)
  const med = median(prices)
  const max = Math.max(...prices)
  const lines = [
    `💰 Цены Satu.kz по запросу «${res.used_query}»: ${approx ? 'ПОХОЖИХ товаров' : 'точных совпадений'}: ${clean.length}${dropped ? ` (отброшено подозрительных цен: ${dropped})` : ''}`,
    `Мин ${fmtSum(min)} · медиана ${fmtSum(med)} · макс ${fmtSum(max)} за единицу`,
    'Дешевле всего:',
    ...clean.slice(0, 3).map((o, i) => `${i + 1}) ${o.name} — ${fmtSum(o.price)}${o.price_from ? ' (от)' : ''}${o.in_stock ? '' : ' (под заказ)'}\n   ${o.url}`),
  ]
  if (approx) lines.push('⚠ Точного совпадения с названием из закупки нет: показаны похожие товары (объём, мощность и модель могут отличаться от спецификации). Маржа ориентировочная, сверьте параметры с PDF.')
  else if (clean.length < 3) lines.push('⚠ Мало предложений, оценка приблизительная.')
  lines.push('Поиск идёт по названию товара и не сверяет все параметры спецификации, проверьте соответствие по ссылке.')
  const rev = lot.price_per_unit
  if (typeof rev === 'number' && rev > 0) {
    const qty = Number(lot.quantity) || 1
    lines.push('', `📊 Маржа (цена заказчика ${fmtSum(rev)} за ед.; налог ${Math.round(TAX * 100)}% + прочее ${Math.round(EXTRA * 100)}%):`)
    for (const [label, cost] of [['при закупке по минимальной цене', min], ['при закупке по медианной цене', med]]) {
      const profit = rev * (1 - TAX - EXTRA) - cost
      const pct = (profit / rev) * 100
      const mark = pct >= 15 ? '✅' : pct >= 0 ? '⚠' : '❌'
      lines.push(`${mark} ${label}: ${profit >= 0 ? '+' : '−'}${fmtSum(Math.abs(profit))}/ед. (${pct.toFixed(1)}%), на ${qty} шт.: ${profit >= 0 ? '+' : '−'}${fmtSum(Math.abs(profit * qty))}`)
    }
    lines.push('Проверьте: цены в магазине обычно с НДС, сумма закупки заказчика указана без НДС; доставка и гарантия не учтены.')
  }
  return lines.join('\n')
}

// Для лотов закупки ищет цены и возвращает тексты (по одному на лот).
async function lotPriceBlocks(t, aiQueries = {}) {
  if (process.env.TENDERS_PRICES === '0') return []
  const lots = (t.lots || []).slice(0, PRICE_LOTS)
  if (!lots.length) return []
  const queryFor = l => aiQueries[String(l.number)] || priceQuery(l)
  const res = await fetchPrices(lots.map(queryFor))
  if (!res.ok && !(res.results || []).length) return [`💰 Цены: не удалось получить (${res.error})`]
  return lots.map((l, i) => `Лот ${l.number}: ${l.exact_product?.[0]?.trim() || l.name}\n${priceBlock(l, res.results?.[i])}`)
}

// Госзакупки (goszakup.gov.kz): второй источник. GOSZAKUP=0 выключает, GOSZAKUP_PAGES=3 — сколько страниц читать.
function fetchGoszakupRaw({ min = TENDERS.min, max = TENDERS.max } = {}) {
  return new Promise(resolve => {
    const pages = Number(process.env.GOSZAKUP_PAGES ?? 3)
    const args = [path.join(ROOT, 'tenders', 'goszakup.py'), '--price', String(max), '--min-price', String(min), '--pages', String(pages)]
    if (process.env.TENDERS_HEADED === '1') args.push('--headed')
    const p = spawn(PYTHON, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => p.kill(), 170000 * Math.max(2, pages)) // сайт бывает очень медленным
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
        resolve({ ok: false, items: [], error: err.trim().slice(-300) || 'Пустой ответ коннектора' })
      }
    })
  })
}

// Обёртки: пока работает коннектор, сотрудник в приложении «AI-офис» сидит за компьютером.
const fetchTenders = o => track('tenders', 'Ищу закупки на портале', fetchTendersRaw(o))
const fetchGoszakup = o => track('tenders', 'Ищу на госзакупках', fetchGoszakupRaw(o))
const fetchDetails = ids => track('specs', `Читаю спецификацию №${ids.join(', ')}`.slice(0, 40), fetchDetailsRaw(ids))
const fetchPrices = qs => track('prices', 'Ищу цены и считаю маржу', fetchPricesRaw(qs))

let tendersBusy = false
let tendersFailures = 0
let gzFailures = 0

// all=false: слать только новые закупки (автопоиск); all=true: весь список (команда /tenders).
async function checkTenders(targets, { all = false, report = false } = {}) {
  if (tendersBusy) return
  tendersBusy = true
  try {
    // Оба источника опрашиваем одновременно: госзакупки бывают очень медленными.
    const [sk, gz] = await Promise.all([fetchTenders(), process.env.GOSZAKUP === '0' ? null : fetchGoszakup()])
    // Ошибки источников: сообщаем при /tenders сразу, при автопоиске после 3 неудач подряд.
    const problems = []
    const short = e => String(e || 'ошибка').replace(/ at https?:\S+/g, '').slice(0, 160)
    if (!sk.ok) problems.push(`zakup.sk.kz: ${short(sk.error)}`)
    if (gz && !gz.ok) problems.push(`goszakup.gov.kz: ${short(gz.error)}`)
    if (!sk.ok) tendersFailures++
    else tendersFailures = 0
    if (gz) gzFailures = gz.ok ? 0 : gzFailures + 1
    if (problems.length) console.error('[tenders]', problems.join(' | '))
    const failedOnce = (!sk.ok && tendersFailures === 3) || (gz && !gz.ok && gzFailures === 3)
    if (problems.length && (all || failedOnce)) {
      for (const id of targets) await sendText(id, `Не удалось получить закупки с части источников:\n${problems.join('\n')}`, 'tenders').catch(() => {})
    }
    if (!sk.ok && !(gz && gz.ok)) return

    const seen = loadSeen()
    const first = seen === null
    const okSk = sk.ok ? sk.items : []
    const okGz = gz && gz.ok ? gz.items : []
    saveSeen(new Set([...(seen || []), ...okSk.map(i => String(i.id)), ...okGz.map(i => String(i.id))]))

    // Отдельный список на каждый портал, по возрастанию суммы (с самых дешёвых, от нижней границы и выше).
    const byPrice = (a, b) => (a.sumTruNoNds ?? Infinity) - (b.sumTruNoNds ?? Infinity)
    const pick = list => (all || first ? list : list.filter(i => !seen.has(String(i.id)))).sort(byPrice)
    const sections = []
    if (gz) sections.push({ title: '🏛 Госзакупки (goszakup.gov.kz)', items: pick(okGz), ok: gz.ok, details: false })
    sections.push({ title: '🏢 Самрук-Қазына (zakup.sk.kz)', items: pick(okSk), ok: sk.ok, details: true })

    const range = `от ${fmtSum(TENDERS.min)}${TENDERS.max > 0 ? ` до ${fmtSum(TENDERS.max)}` : ' и выше'}`
    const what = all ? 'найдено' : first ? 'первый список' : 'новых'
    const total = sections.reduce((n, x) => n + x.items.length, 0)

    if (!total) {
      if (all) for (const id of targets) await sendText(id, 'Подходящих закупок не найдено.', 'tenders').catch(() => {})
      else if (report) {
        const when = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: TZ })
        for (const id of targets) await sendText(id, `Проверка ${when}: новых закупок нет (${range}).`, 'tenders').catch(() => {})
      }
      return
    }
    for (const sec of sections) {
      if (!sec.items.length) {
        if (all || report) for (const id of targets) await sendText(id, `${sec.title}: ${sec.ok ? 'новых закупок нет' : 'источник не ответил'}.`, 'tenders').catch(() => {})
        continue
      }
      const header = `${sec.title}: ${what} ${sec.items.length}. Товар, запрос ценовых предложений, ${range}. По возрастанию суммы.`
      for (const id of targets) await sendTenders(id, header, sec.items).catch(e => console.error('[tenders]', e.message))
      // Самрук-Қазына: сразу присылаем спецификацию и точный товар по новым закупкам. Для /tenders (весь список) — по запросу /tender <номер>.
      if (sec.details && !all && process.env.TENDERS_DETAILS !== '0') {
        await sendDetails(targets, sec.items.map(i => String(i.id)), { ai: AI_MODE === 'auto' })
      }
    }
  } finally {
    tendersBusy = false
  }
}

// Расписание: TENDERS_TIMES=09:00,13:00 (по умолчанию), часовой пояс TENDERS_TZ=Asia/Almaty.
// TENDERS_NOTIFY_MINUTES=0 выключает автопоиск. TENDERS_RUN_ON_START=1 — ещё и проверка сразу при запуске.
const TZ = process.env.TENDERS_TZ || 'Asia/Almaty'
function nowInTz() {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const p = Object.fromEntries(f.formatToParts(new Date()).map(x => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}` }
}

function startTenderSchedule() {
  const enabled = process.env.TENDERS_NOTIFY_MINUTES === undefined || Number(process.env.TENDERS_NOTIFY_MINUTES) > 0
  const times = (process.env.TENDERS_TIMES || '09:00,13:00')
    .split(',')
    .map(t => t.trim())
    .filter(t => /^\d{1,2}:\d{2}$/.test(t))
    .map(t => t.padStart(5, '0'))
  let targets = (process.env.TENDERS_CHAT_IDS || ALLOWED.join(',')).split(',').map(s => s.trim()).filter(Boolean)
  if (TENDERS_BOT_TOKEN) targets = targets.map(id => `t2:${id}`) // рассылка идёт через отдельный бот
  if (process.env.APP_KEY) targets.push('app') // командный пункт приложения «AI-офис»
  if (!enabled || !times.length) return console.log('[tenders] автопоиск выключен')
  if (!targets.length) return console.warn('[tenders] автопоиск выключен: задайте ALLOWED_CHAT_IDS или TENDERS_CHAT_IDS')
  console.log(`[tenders] автопоиск в ${times.join(' и ')} (${TZ}), получателей: ${targets.length}${TENDERS_BOT_TOKEN ? ', через отдельный бот' : ''}`)
  const done = new Set()
  setInterval(() => {
    const n = nowInTz()
    const key = `${n.date} ${n.hm}`
    if (times.includes(n.hm) && !done.has(key)) {
      done.add(key)
      checkTenders(targets, { report: true })
    }
  }, 20000)
  if (process.env.TENDERS_RUN_ON_START === '1') setTimeout(() => checkTenders(targets, { report: true }), 5000)
}

// ---- Агент «Видеомонтаж»: рилс из присланного видео ---------------------------------------------
// Видео можно прислать боту в Telegram (до 20 МБ) или загрузить кнопкой 📎 в приложении AI-офис (до VIDEO_MAX_MB, 150).
// Подпись к видео: заголовок, «стиль: кино|тёплый|чб|резкий», «без субтитров», «без нарезки».
// Что делает: режет паузы в речи, вертикальный кадр 9:16, зум-акценты, резкая цветокоррекция, заголовок, субтитры по речи
// (субтитры только если задан STT_API_KEY). Платные ключи для монтажа не нужны.
const VIDEO_OUT = path.join(ROOT, 'bot', '.state', 'video-out')
const VIDEO_IN = path.join(ROOT, 'bot', '.state', 'video-in')
const ffmpegOk = ['ffmpeg', 'ffprobe'].every(t => !spawnSync(t, ['-version']).error)
if (!ffmpegOk) agents.video.task = 'ffmpeg не установлен'
else agents.video.status = 'idle'

// Старые файлы (старше 3 дней) удаляем, чтобы не заполнить диск.
function cleanOldVideos() {
  for (const dir of [VIDEO_IN, VIDEO_OUT]) {
    try {
      for (const f of fs.readdirSync(dir)) {
        const fp = path.join(dir, f)
        if (Date.now() - fs.statSync(fp).mtimeMs > 3 * 24 * 3600 * 1000) fs.rmSync(fp, { recursive: true, force: true })
      }
    } catch { /* папки ещё нет */ }
  }
}

let reelsChain = Promise.resolve() // монтаж идёт по одному: серверу не хватит памяти на несколько сразу

async function sendVideo(chatId, filePath, caption) {
  const via2 = String(chatId).match(/^t2:(.+)$/)
  const token = via2 && TENDERS_BOT_TOKEN ? TENDERS_BOT_TOKEN : TG_TOKEN
  const form = new FormData()
  form.append('chat_id', String(via2 ? via2[1] : chatId))
  if (caption) form.append('caption', caption.slice(0, 1000))
  form.append('supports_streaming', 'true')
  form.append('video', new Blob([fs.readFileSync(filePath)], { type: 'video/mp4' }), path.basename(filePath))
  const res = await fetch(`${TG_BASE}/bot${token}/sendVideo`, { method: 'POST', body: form })
  const json = await res.json()
  if (!json.ok) throw new Error(`sendVideo: ${json.description}`)
}

// Монтирует ролик из файла и отправляет результат туда, откуда пришло видео (и в командный пункт приложения).
function processVideo(chatId, file, captionText) {
  const job = reelsChain.then(async () => {
    const targets = chatId === 'app' ? ['app'] : [chatId, ...(process.env.APP_KEY ? ['app'] : [])]
    const say = async (text, f) => { for (const id of targets) await sendText(id, text, 'video').catch(() => {}); return f }
    if (!ffmpegOk) return say('Монтаж недоступен: на сервере не установлен ffmpeg.')
    const opts = parseCaption(captionText)
    await say(`Принял видео. Монтирую: ${opts.cuts ? 'режу паузы, ' : ''}вертикальный кадр 9:16, стиль «${({ sharp: 'резкий яркий', cinema: 'кино', warm: 'тёплый', bw: 'чёрно-белый' })[opts.style]}»${opts.title ? `, заголовок «${opts.title}»` : ''}. Это займёт 1–3 минуты…`)
    try {
      const { file: out, info } = await track('video', 'Монтирую рилс', makeReels(file, { ...opts, workDir: path.join(VIDEO_IN, `work_${Date.now()}`), out: path.join(VIDEO_OUT, `reels_${Date.now()}.mp4`) }))
      const subs = info.subtitles === 'ok' ? `субтитры: ${opts.subtitles ? 'есть' : 'нет'}`
        : info.subtitles === 'no_key' ? 'субтитры не добавлены (на сервере не установлено распознавание речи faster-whisper и нет ключа STT_API_KEY)'
        : info.subtitles === 'off' ? 'без субтитров' : `субтитры: ${info.subtitles}`
      const text = `✅ Рилс готов: ${info.resultSec} с (было ${info.sourceSec} с), ${info.segments} фрагм., ${info.cutSilence ? 'паузы вырезаны' : 'без вырезания пауз'}, стиль «${info.style}», ${info.title ? 'заголовок есть' : 'без заголовка'}, ${subs}. ${info.sizeMb} МБ.`
      for (const id of targets) {
        if (id === 'app') pushFeed('video', text, { name: path.basename(out), url: `/files/${encodeURIComponent(path.basename(out))}` })
        else {
          await sendVideo(id, out, text).catch(async e => {
            console.error('[video]', e.message)
            await sendText(id, `${text}\nФайл не удалось отправить в Telegram (${e.message}). Он лежит в приложении AI-офис.`, 'video').catch(() => {})
          })
        }
      }
      if (chatId !== 'app' && process.env.APP_KEY) { /* в ленте приложения уже есть ссылка на файл */ }
    } catch (e) {
      console.error('[video]', e.message)
      await say(`Не удалось смонтировать видео: ${String(e.message).slice(0, 300)}`)
    } finally {
      cleanOldVideos()
    }
  })
  reelsChain = job.catch(() => {})
  return job
}

// Видео из Telegram: скачиваем (лимит Bot API 20 МБ) и отдаём на монтаж.
async function handleTelegramVideo(chatId, msg) {
  const media = msg.video || msg.video_note || (msg.document?.mime_type?.startsWith('video/') ? msg.document : null)
  if (!media) return false
  const sizeMb = (media.file_size || 0) / 1024 / 1024
  if (sizeMb > 20) {
    await sendText(chatId, `Видео ${sizeMb.toFixed(0)} МБ: Telegram не даёт боту скачивать файлы больше 20 МБ. Загрузите его в приложении AI-офис кнопкой 📎 (до ${process.env.VIDEO_MAX_MB || 150} МБ).`, 'video')
    return true
  }
  try {
    const f = await tg('getFile', { file_id: media.file_id })
    const res = await fetch(`${TG_BASE}/file/bot${TG_TOKEN}/${f.file_path}`)
    if (!res.ok) throw new Error(`скачивание: HTTP ${res.status}`)
    fs.mkdirSync(VIDEO_IN, { recursive: true })
    const ext = path.extname(f.file_path) || '.mp4'
    const file = path.join(VIDEO_IN, `in_${Date.now()}${ext}`)
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()))
    processVideo(chatId, file, msg.caption || '').catch(e => console.error('[video]', e.message))
  } catch (e) {
    await sendText(chatId, `Не удалось получить видео: ${e.message}`, 'video')
  }
  return true
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
async function tg(method, body, token = TG_TOKEN) {
  const res = await fetch(`${TG_BASE}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  if (!json.ok) throw new Error(`${method}: ${json.description}`)
  return json.result
}

async function sendText(chatId, text, agent = 'system') {
  // Командный пункт приложения «AI-офис» — виртуальный чат 'app': пишем в ленту, а не в Telegram.
  if (chatId === 'app') return void pushFeed(agent, text)
  // 't2:ID' — через отдельный бот рассылки закупок. Если он недоступен, отправляем основным ботом.
  const via2 = String(chatId).match(/^t2:(.+)$/)
  const token = via2 && TENDERS_BOT_TOKEN ? TENDERS_BOT_TOKEN : TG_TOKEN
  const chat = via2 ? via2[1] : chatId
  // Telegram принимает до 4096 символов в одном сообщении.
  for (let i = 0; i < text.length; i += 4000) {
    const part = text.slice(i, i + 4000)
    try {
      await tg('sendMessage', { chat_id: chat, text: part }, token)
    } catch (e) {
      if (token === TG_TOKEN) throw e
      console.error('[tenders] отдельный бот не смог отправить, шлю основным:', e.message)
      await tg('sendMessage', { chat_id: chat, text: part })
    }
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

// Разведка сайта: бот открывает страницу своим браузером и присылает поля поиска, таблицы и запросы к API.
// Нужна, чтобы подключить новый источник закупок (команда /explore https://сайт [текст ссылки для нажатия]).
async function explore(chatId, url, clickText) {
  await sendText(chatId, `Изучаю страницу ${url}, это займёт 1–2 минуты…`, 'tenders')
  const out = path.join(ROOT, 'bot', '.state', 'explore.txt')
  fs.mkdirSync(path.dirname(out), { recursive: true })
  const args = [path.join(ROOT, 'tenders', 'explore.py'), url, '--out', out, '--wait', '6']
  if (clickText) args.push('--click', clickText)
  const res = await track('tenders', 'Изучаю сайт', new Promise(resolve => {
    const p = spawn(PYTHON, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
    let err = ''
    const timer = setTimeout(() => p.kill(), 150000)
    p.stderr.on('data', d => (err += d))
    p.on('error', e => resolve({ ok: false, error: e.message }))
    p.on('close', code => {
      clearTimeout(timer)
      resolve(code === 0 ? { ok: true } : { ok: false, error: err.trim().split('\n').slice(-3).join(' ').slice(0, 400) || `код ${code}` })
    })
  }))
  if (!res.ok) return sendText(chatId, `Не удалось открыть страницу: ${res.error}`, 'tenders')
  const text = fs.readFileSync(out, 'utf8')
  for (let i = 0; i < text.length; i += 3500) await sendText(chatId, text.slice(i, i + 3500), 'tenders')
}

const HELP = `Команды:
/tenders — найти закупки (товар, запрос ценовых предложений)
/tender 1275177 — точный товар, спецификация, цены и маржа по закупке
/price насос ручной гидравлический 2л | 130000 — цены на товар; после «|» цена заказчика за единицу для расчёта маржи
/explore https://сайт — изучить страницу нового источника закупок (служебная)
Видео: пришлите видео боту (до 20 МБ) или загрузите кнопкой 📎 в AI-офисе. В подписи: заголовок, «стиль: кино|тёплый|чб|резкий», «без субтитров», «без нарезки». Бот вернёт рилс 9:16: паузы вырезаны, резкая цветокоррекция, заголовок.
/reset — очистить историю чата с ИИ
Можно писать и словами: «тендеры», «тендер 1275177», «цены кабель ВВГ».`

async function handleMessage(chatId, text) {
  // Простые слова вместо команд
  const w = text.trim()
  if (/^(найди|найти)?\s*тендеры?$/i.test(w)) text = '/tenders'
  else if (/^тендер\s*№?\s*(\d{5,9})$/i.test(w)) text = '/tender ' + w.match(/(\d{5,9})/)[1]
  else if (/^цены?\s+.+/i.test(w)) text = '/price ' + w.replace(/^цены?\s+/i, '')

  if (text === '/help') return sendText(chatId, HELP, 'assistant')
  const ex = text.match(/^\/explore\s+(https?:\/\/\S+)(?:\s+(.+))?$/)
  if (ex) return explore(chatId, ex[1], ex[2])
  const pm = text.match(/^\/price\s+([\s\S]+)$/)
  // /price 1275177: если вместо названия товара вставили номер закупки, разбираем закупку целиком
  if (pm && /^№?\s*\d{6,9}$/.test(pm[1].trim())) {
    const num = pm[1].match(/\d{6,9}/)[0]
    await sendText(chatId, `«${num}» похоже на номер закупки. Цены ищутся по названию товара, поэтому разбираю закупку целиком (точный товар, спецификация, цены, маржа).`, 'prices')
    return handleMessage(chatId, '/tender ' + num)
  }
  if (pm) {
    const [q, revStr] = pm[1].split('|').map(x => x.trim())
    const rev = Number((revStr || '').replace(/[^\d.]/g, '')) || undefined
    await sendText(chatId, `Ищу цены на «${q}»…`, 'prices')
    const res = await fetchPrices([q])
    return sendText(chatId, res.ok ? priceBlock({ price_per_unit: rev, quantity: 1 }, res.results?.[0]) : `Не удалось получить цены: ${res.error}`, 'prices')
  }
  if (text === '/price') return sendText(chatId, 'Укажите товар: /price насос ручной гидравлический 2л | 130000', 'prices')

  if (text === '/start') {
    return sendText(chatId, `Привет! Напишите, что нужно сделать, и я помогу с планом.\nВаш chat id: ${chatId}\n/tenders — список закупок (товар, запрос ценовых предложений).\n/tender 1275177 — точный товар, спецификация, цены и маржа.\n/price товар | цена заказчика — цены и маржа.\n/help — все команды.\n/reset — очистить историю.`)
  }
  if (text === '/tenders') {
    await sendText(chatId, 'Ищу закупки на портале, это займёт около минуты…', 'tenders')
    return checkTenders([chatId], { all: true })
  }
  const one = text.match(/^\/tender\s+№?(\d{5,9})\b/)
  if (one) {
    await sendText(chatId, `Открываю закупку №${one[1]} на портале, это займёт около минуты…`, 'specs')
    return sendDetails([chatId], [one[1]], { ai: true })
  }
  if (text === '/tender') {
    return sendText(chatId, 'Укажите номер закупки: /tender 1275177')
  }
  if (text === '/reset') {
    histories.delete(chatId)
    return sendText(chatId, 'История очищена.')
  }

  if (!ANTHROPIC_KEY) {
    return sendText(chatId, 'Чат с ИИ сейчас отключён (не задан ключ Anthropic). Доступны команды: /help.', 'assistant')
  }

  const hist = histories.get(chatId) || []
  hist.push({ role: 'user', content: text })

  try {
    const reply = await track('assistant', 'Отвечаю на вопрос', ask(trimHistory(hist)))
    hist.push({ role: 'assistant', content: reply })
    histories.set(chatId, trimHistory(hist))
    await sendText(chatId, reply, 'assistant')
  } catch (e) {
    console.error('[bot] ask failed:', e.message)
    await sendText(chatId, 'Произошла ошибка, попробуйте ещё раз позже.', 'assistant')
  }
}

async function main() {
  if (!TG_TOKEN) {
    console.error('Нужна переменная TELEGRAM_BOT_TOKEN')
    process.exit(1)
  }
  if (!ANTHROPIC_KEY) {
    console.warn('[bot] ANTHROPIC_API_KEY не задан: чат с ИИ отключён, работают /tenders и автопоиск закупок.')
  }
  if (!ALLOWED.length) {
    console.warn('[bot] ALLOWED_CHAT_IDS не задан: отвечаем любому. Задайте свой chat id.')
  }

  console.log(`Бот запущен, модель ${MODEL}, инструментов: ${toolMap.size}`)
  if (process.env.APP_KEY) {
    if (process.env.APP_KEY.length < 12) console.warn('[api] APP_KEY короткий: задайте не менее 12 символов.')
    startApi({
      key: process.env.APP_KEY,
      port: Number(process.env.APP_PORT || 8787),
      officeDir: path.join(ROOT, 'office'),
      specsDir: SPECS_DIR,
      videoOutDir: VIDEO_OUT,
      videoInDir: VIDEO_IN,
      onCommand: t => handleMessage('app', t),
      onVideo: (file, caption) => processVideo('app', file, caption),
    })
  } else {
    console.log('[api] приложение AI-офис выключено (не задан APP_KEY)')
  }
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
      if (!msg || (!msg.text && !msg.video && !msg.video_note && !msg.document)) continue

      const chatId = String(msg.chat.id)
      if (ALLOWED.length && !ALLOWED.includes(chatId)) {
        if (msg.text === '/start') await sendText(chatId, `Доступ закрыт. Ваш chat id: ${chatId}`).catch(() => {})
        continue
      }

      if (!msg.text) {
        await handleTelegramVideo(chatId, msg).catch(e => console.error('[bot]', e.message))
        continue
      }
      await handleMessage(chatId, msg.text).catch(e => console.error('[bot]', e.message))
    }
  }
}

main()
