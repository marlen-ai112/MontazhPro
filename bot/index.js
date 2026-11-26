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

// ---- Подробности закупки: точный товар и техническая спецификация -----------
// Запускает tenders/zakup_details.py: он открывает карточку закупки, читает лоты и скачивает PDF спецификаций.
const SPECS_DIR = path.join(ROOT, 'bot', '.state', 'specs')
const DETAILS_MAX = Number(process.env.TENDERS_DETAILS_MAX ?? 10) // сколько закупок за раз разбирать подробно
const LOTS_FULL = Number(process.env.TENDERS_LOTS_FULL ?? 3) // у скольких лотов закупки показывать спецификацию текстом
const PDF_MAX = Number(process.env.TENDERS_PDF_MAX ?? 5) // сколько PDF слать на закупку

function fetchDetails(ids) {
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
    if (spec) lines.push('', 'Техническая спецификация:', spec.slice(0, 1800) + (spec.length > 1800 ? '\n… (полный текст в PDF)' : ''))
    else if (!l.spec_pdf) lines.push('Техническая спецификация: не удалось получить' + (l.spec_error ? ` (${l.spec_error})` : ''))
  }
  return lines.join('\n')
}

// Необязательно: если задан ключ Anthropic, ИИ определяет точный товар по спецификации.
async function identifyProduct(t) {
  if (!ANTHROPIC_KEY) return ''
  const lots = (t.lots || []).slice(0, LOTS_FULL).map(l => ({
    lot: l.number,
    name: l.name,
    exact_product_from_portal: l.exact_product,
    quantity: `${l.quantity} ${l.unit || ''}`,
    spec: specSection(l.spec_text).slice(0, 5000),
  }))
  try {
    const res = await fetch(`${process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1200,
        system:
          'Ты помощник поставщика. По данным закупки определи ТОЧНЫЙ товар, который нужен заказчику. ' +
          'Для каждого лота ответь по-русски кратко: 1) Что за товар (тип, модель/артикул/марка если указаны, ключевые параметры и стандарты); ' +
          '2) Что обязательно проверить при поставке (допустимы ли аналоги, сертификаты, гарантия, упаковка); ' +
          '3) Под какой запрос искать этот товар у поставщиков. Используй только данные из спецификации, ничего не выдумывай; если чего-то не указано, так и напиши.',
        messages: [{ role: 'user', content: JSON.stringify({ закупка: t.name, лоты: lots }) }],
      }),
    })
    if (!res.ok) throw new Error(`Anthropic ${res.status}`)
    const data = await res.json()
    const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim()
    return text ? `🔎 Разбор ИИ:\n${text}` : ''
  } catch (e) {
    console.error('[tenders] разбор ИИ не удался:', e.message)
    return ''
  }
}

async function sendDocument(chatId, filePath, caption) {
  const form = new FormData()
  form.append('chat_id', String(chatId))
  if (caption) form.append('caption', caption.slice(0, 1000))
  form.append('document', new Blob([fs.readFileSync(filePath)], { type: 'application/pdf' }), path.basename(filePath))
  const res = await fetch(`${TG_API}/sendDocument`, { method: 'POST', body: form })
  const json = await res.json()
  if (!json.ok) throw new Error(`sendDocument: ${json.description}`)
}

// Разбирает закупки подробно и шлёт каждому получателю: описание, спецификацию и PDF.
async function sendDetails(targets, ids) {
  const list = ids.slice(0, DETAILS_MAX)
  const res = await fetchDetails(list)
  if (!res.ok) {
    console.error('[tenders] подробности:', res.error)
    for (const id of targets) await sendText(id, `Не удалось получить подробности закупок: ${res.error}`).catch(() => {})
    return
  }
  for (const t of res.tenders) {
    if (!t.ok) {
      for (const id of targets) await sendText(id, `№${t.id}: подробности недоступны (${t.error})`).catch(() => {})
      continue
    }
    const ai = await identifyProduct(t)
    const prices = await lotPriceBlocks(t)
    for (const id of targets) {
      await sendText(id, describeTender(t)).catch(e => console.error('[tenders]', e.message))
      if (ai) await sendText(id, ai).catch(() => {})
      for (const pb of prices) await sendText(id, pb).catch(() => {})
      for (const l of (t.lots || []).slice(0, PDF_MAX)) {
        if (l.spec_pdf) await sendDocument(id, l.spec_pdf, `Техническая спецификация, лот ${l.number}`).catch(e => console.error('[tenders]', e.message))
      }
    }
  }
  if (ids.length > list.length) {
    const rest = ids.length - list.length
    for (const id of targets) await sendText(id, `Ещё ${rest} закупок не разобраны подробно. Пришлите /tender <номер>, чтобы получить спецификацию нужной.`).catch(() => {})
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

function fetchPrices(queries) {
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
async function lotPriceBlocks(t) {
  if (process.env.TENDERS_PRICES === '0') return []
  const lots = (t.lots || []).slice(0, PRICE_LOTS)
  if (!lots.length) return []
  const res = await fetchPrices(lots.map(priceQuery))
  if (!res.ok && !(res.results || []).length) return [`💰 Цены: не удалось получить (${res.error})`]
  return lots.map((l, i) => `Лот ${l.number}: ${l.exact_product?.[0]?.trim() || l.name}\n${priceBlock(l, res.results?.[i])}`)
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
    // Автопоиск: по новым закупкам сразу присылаем спецификацию и точный товар. Для /tenders (весь список) — по запросу /tender <номер>.
    if (!all && process.env.TENDERS_DETAILS !== '0') await sendDetails(targets, fresh.map(i => String(i.id)))
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
    return sendText(chatId, `Привет! Напишите, что нужно сделать, и я помогу с планом.\nВаш chat id: ${chatId}\n/tenders — список закупок (товар, запрос ценовых предложений).\n/tender 1275177 — точный товар и техническая спецификация закупки.\n/reset — очистить историю.`)
  }
  if (text === '/tenders') {
    await sendText(chatId, 'Ищу закупки на портале, это займёт около минуты…')
    return checkTenders([chatId], { all: true })
  }
  const one = text.match(/^\/tender\s+№?(\d{5,9})\b/)
  if (one) {
    await sendText(chatId, `Открываю закупку №${one[1]} на портале, это займёт около минуты…`)
    return sendDetails([chatId], [one[1]])
  }
  if (text === '/tender') {
    return sendText(chatId, 'Укажите номер закупки: /tender 1275177')
  }
  if (text === '/reset') {
    histories.delete(chatId)
    return sendText(chatId, 'История очищена.')
  }

  if (!ANTHROPIC_KEY) {
    return sendText(chatId, 'Чат с ИИ сейчас отключён (не задан ключ Anthropic). Доступны команды /tenders и автоматическая рассылка закупок.')
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
