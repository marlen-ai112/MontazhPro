// Личный бот-помощник в Telegram. Отвечает через Claude.
// Инструменты подключаются через registerTool(), пока их нет.
//
// Запуск:
//   TELEGRAM_BOT_TOKEN=... ANTHROPIC_API_KEY=... node bot/index.js
// Необязательно:
//   ALLOWED_CHAT_IDS=123456789   (кто может пользоваться ботом, через запятую)
//   AGENT_MODEL=claude-sonnet-5-5

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY
const MODEL = process.env.AGENT_MODEL || 'claude-sonnet-5-5'
const ALLOWED = (process.env.ALLOWED_CHAT_IDS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

const MAX_HISTORY = 20
const MAX_TOOL_STEPS = 5
const TG_API = `https://api.telegram.org/bot${TG_TOKEN}`

const SYSTEM_PROMPT = `Ты личный помощник пользователя. Отвечай по-русски, коротко и по делу.
Когда пользователь спрашивает, что делать, давай понятный пронумерованный список шагов.
Если чего-то не знаешь, так и скажи, не выдумывай.`

// ---- Реестр инструментов -------------------------------------------------
// Чтобы подключить инструмент, вызовите registerTool(definition, run) до запуска:
//   definition: { name, description, input_schema }  (формат Anthropic tools)
//   run: async (input) => строка с результатом
const toolMap = new Map()

export function registerTool(definition, run) {
  toolMap.set(definition.name, { definition, run })
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
    return sendText(chatId, `Привет! Напишите, что нужно сделать, и я помогу с планом.\nВаш chat id: ${chatId}\n/reset — очистить историю.`)
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
