import { SERVICES, COMPANY_NAME, COMPANY_PHONE_DISPLAY } from '../../utils/company'

// ИИ-агент сайта: отвечает на вопросы клиентов и собирает заявки.
// Ключ API хранится только на сервере (runtimeConfig.anthropicApiKey, env NUXT_ANTHROPIC_API_KEY).

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string }

interface AnthropicResponse {
  stop_reason: string
  content: ContentBlock[]
}

const MAX_STEPS = 5
const MAX_HISTORY = 20
const MAX_MESSAGE_LENGTH = 2000

const SYSTEM_PROMPT = `Ты — виртуальный помощник компании «${COMPANY_NAME}» на сайте. Компания выполняет сварочные, монтажные и электромонтажные работы для бизнеса и частных клиентов.

Правила:
- Отвечай по-русски, вежливо и коротко.
- Информацию об услугах бери из инструмента get_services. Не выдумывай цены, сроки и гарантии. Если точной информации нет, предложи оставить заявку или позвонить ${COMPANY_PHONE_DISPLAY}.
- Если клиент хочет заказать работы или консультацию, попроси имя, телефон и кратко описать задачу. Когда все три данных есть, вызови create_lead.
- Не вызывай create_lead без телефона клиента и без описания задачи.
- Не обсуждай темы, не связанные с услугами компании.`

const TOOLS = [
  {
    name: 'get_services',
    description: 'Возвращает список услуг компании с кратким описанием.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'create_lead',
    description: 'Сохраняет заявку клиента, чтобы менеджер связался с ним.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Имя клиента' },
        phone: { type: 'string', description: 'Телефон клиента' },
        task: { type: 'string', description: 'Краткое описание задачи' },
      },
      required: ['name', 'phone', 'task'],
    },
  },
]

function runTool(name: string, input: Record<string, unknown>): string {
  if (name === 'get_services') {
    return JSON.stringify(SERVICES)
  }
  if (name === 'create_lead') {
    const lead = {
      name: String(input.name ?? '').slice(0, 200),
      phone: String(input.phone ?? '').slice(0, 50),
      task: String(input.task ?? '').slice(0, 2000),
      createdAt: new Date().toISOString(),
    }
    // Заявка пока пишется в лог сервера. Для хранения подключите БД или CRM здесь.
    console.info('[agent] new lead', lead)
    return JSON.stringify({ ok: true, message: 'Заявка принята, менеджер свяжется с клиентом.' })
  }
  return JSON.stringify({ error: `Неизвестный инструмент: ${name}` })
}

function sanitizeMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(
      (m): m is ChatMessage =>
        !!m &&
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string' &&
        m.content.trim().length > 0,
    )
    .map(m => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_LENGTH) }))
    .slice(-MAX_HISTORY)
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const apiKey = config.anthropicApiKey
  if (!apiKey) {
    throw createError({ statusCode: 500, message: 'ANTHROPIC_API_KEY не задан на сервере' })
  }

  const body = await readBody<{ messages?: unknown }>(event)
  const messages = sanitizeMessages(body?.messages)
  if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
    throw createError({ statusCode: 400, message: 'Нужно передать историю с сообщением пользователя' })
  }

  // Рабочая история для цикла инструментов (формат Anthropic Messages API).
  const convo: { role: 'user' | 'assistant'; content: string | ContentBlock[] }[] = messages.map(m => ({
    role: m.role,
    content: m.content,
  }))

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: config.agentModel,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages: convo,
      }),
    })

    if (!res.ok) {
      const details = await res.text()
      console.error('[agent] Anthropic API error', res.status, details)
      throw createError({ statusCode: 502, message: 'Ошибка ИИ-сервиса, попробуйте позже' })
    }

    const data = (await res.json()) as AnthropicResponse

    if (data.stop_reason === 'tool_use') {
      convo.push({ role: 'assistant', content: data.content })

      const results: ContentBlock[] = data.content
        .filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use')
        .map(b => ({
          type: 'tool_result',
          tool_use_id: b.id,
          content: runTool(b.name, b.input),
        }))

      convo.push({ role: 'user', content: results })
      continue
    }

    const reply = data.content
      .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim()

    return { reply: reply || 'Извините, не удалось сформировать ответ. Позвоните нам: ' + COMPANY_PHONE_DISPLAY }
  }

  return { reply: 'Не удалось завершить запрос. Позвоните нам: ' + COMPANY_PHONE_DISPLAY }
})
